import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Gauge, Play, Plus, Trash2 } from "lucide-react";
import { useDownloads } from "../../context/DownloadContext";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import {
  formatBytesShort,
  formatScheduleTimestamp,
  getStatusClassSuffix,
  getStatusLabel,
  isScheduleHeld,
  type BandwidthRule,
  type ScheduleDays,
  type SchedulerConfig,
  type TorrentDownload,
} from "../../types/download";

const DAY_LABEL_KEYS = [
  "scheduler.dayMon",
  "scheduler.dayTue",
  "scheduler.dayWed",
  "scheduler.dayThu",
  "scheduler.dayFri",
  "scheduler.daySat",
  "scheduler.daySun",
] as const;

/** Seconds → the `datetime-local` input value ("YYYY-MM-DDTHH:MM"). */
function toLocalInputValue(seconds: number): string {
  const date = new Date(seconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** `datetime-local` input value → Unix seconds (or null when empty/invalid). */
function fromLocalInputValue(value: string): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / 1000);
}

function DayChips({
  days,
  onToggle,
  compact = false,
}: {
  days: ScheduleDays;
  onToggle: (index: number) => void;
  compact?: boolean;
}) {
  const { t } = useLanguage();
  return (
    <div className={`dl-sched-days${compact ? " dl-sched-days--compact" : ""}`}>
      {days.map((on, index) => (
        <button
          key={index}
          type="button"
          className={`dl-sched-day${on ? " active" : ""}`}
          aria-pressed={on}
          title={t(DAY_LABEL_KEYS[index])}
          onClick={() => onToggle(index)}
        >
          {t(DAY_LABEL_KEYS[index]).slice(0, 3)}
        </button>
      ))}
    </div>
  );
}

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`dl-sched-switch${checked ? " active" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="dl-sched-switch-knob" />
    </button>
  );
}

/**
 * DownloadsScheduledTab — the scheduler control surface: the global
 * start window + concurrency cap + time-of-day bandwidth rules, plus
 * the queue of downloads waiting on their start time.
 */
export default function DownloadsScheduledTab() {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { unit } = useSizeUnit();
  const {
    downloads,
    schedulerConfig,
    setSchedulerConfig,
    scheduleDownload,
    resumeDownload,
  } = useDownloads();

  const [draft, setDraft] = useState<SchedulerConfig>(schedulerConfig);

  // Adopt external changes (e.g. the config loaded from the backend on
  // mount) without clobbering in-progress edits when values already match.
  useEffect(() => {
    setDraft(schedulerConfig);
  }, [schedulerConfig]);

  const commit = async (next: SchedulerConfig) => {
    setDraft(next);
    try {
      await setSchedulerConfig(next);
    } catch (err) {
      showToast(t("scheduler.saveFailed", { error: String(err) }), "error");
    }
  };

  const patch = (partial: Partial<SchedulerConfig>) => {
    void commit({ ...draft, ...partial });
  };

  const toggleDay = (index: number) => {
    const days = [...draft.days] as ScheduleDays;
    days[index] = !days[index];
    patch({ days });
  };

  const waiting = useMemo(() => {
    return downloads
      .filter((d) => d.status.kind === "queued" || d.status.kind === "paused")
      .sort((a, b) => {
        const aAt = a.scheduledStartAt ?? Number.MAX_SAFE_INTEGER;
        const bAt = b.scheduledStartAt ?? Number.MAX_SAFE_INTEGER;
        if (aAt !== bAt) return aAt - bAt;
        return b.addedAt - a.addedAt;
      });
  }, [downloads]);

  const addRule = () => {
    const rule: BandwidthRule = {
      id: `rule-${Date.now()}`,
      label: "",
      days: [true, true, true, true, true, true, true],
      start: "00:00",
      end: "06:00",
      downloadKbps: 0,
      uploadKbps: 0,
      disableUpload: false,
    };
    patch({ bandwidthRules: [...draft.bandwidthRules, rule] });
  };

  const updateRule = (id: string, partial: Partial<BandwidthRule>) => {
    patch({
      bandwidthRules: draft.bandwidthRules.map((rule) =>
        rule.id === id ? { ...rule, ...partial } : rule,
      ),
    });
  };

  const removeRule = (id: string) => {
    patch({ bandwidthRules: draft.bandwidthRules.filter((rule) => rule.id !== id) });
  };

  const setStartTime = async (download: TorrentDownload, value: string) => {
    const seconds = fromLocalInputValue(value);
    try {
      await scheduleDownload(download.id, seconds);
    } catch (err) {
      showToast(t("scheduler.saveFailed", { error: String(err) }), "error");
    }
  };

  const startNow = async (download: TorrentDownload) => {
    try {
      await scheduleDownload(download.id, null);
      await resumeDownload(download.id);
    } catch (err) {
      showToast(t("downloads.resumeFailed", { error: String(err) }), "error");
    }
  };

  return (
    <div className="dl-sched">
      <div className="dl-sched-grid">
        {/* Start window & queue policy */}
        <div className="dl-sched-card">
          <div className="dl-sched-card-head">
            <div className="dl-sched-card-title">
              <CalendarClock size={16} aria-hidden="true" />
              <span>{t("scheduler.title")}</span>
            </div>
            <Switch
              checked={draft.enabled}
              onChange={(next) => patch({ enabled: next })}
              label={t("scheduler.enabled")}
            />
          </div>
          <p className="dl-sched-hint">{t("scheduler.subtitle")}</p>

          <label className="dl-sched-row">
            <span className="dl-sched-row-label">{t("scheduler.windowEnabled")}</span>
            <Switch
              checked={draft.windowEnabled}
              onChange={(next) => patch({ windowEnabled: next })}
              label={t("scheduler.windowEnabled")}
            />
          </label>

          <div className={`dl-sched-window${draft.windowEnabled ? "" : " is-dim"}`}>
            <label className="dl-sched-field">
              <span>{t("scheduler.windowStart")}</span>
              <input
                type="time"
                value={draft.windowStart}
                onChange={(e) => setDraft({ ...draft, windowStart: e.target.value })}
                onBlur={(e) => patch({ windowStart: e.target.value })}
              />
            </label>
            <label className="dl-sched-field">
              <span>{t("scheduler.windowEnd")}</span>
              <input
                type="time"
                value={draft.windowEnd}
                onChange={(e) => setDraft({ ...draft, windowEnd: e.target.value })}
                onBlur={(e) => patch({ windowEnd: e.target.value })}
              />
            </label>
            <div className="dl-sched-days-wrap">
              <span className="dl-sched-row-label">{t("scheduler.days")}</span>
              <DayChips days={draft.days} onToggle={toggleDay} />
            </div>
          </div>

          <label className="dl-sched-row">
            <span className="dl-sched-row-label">{t("scheduler.maxConcurrent")}</span>
            <input
              className="dl-sched-number"
              type="number"
              min={0}
              max={64}
              value={draft.maxConcurrent}
              onChange={(e) =>
                setDraft({ ...draft, maxConcurrent: Math.max(0, Number(e.target.value) || 0) })
              }
              onBlur={(e) =>
                patch({ maxConcurrent: Math.max(0, Number(e.target.value) || 0) })
              }
            />
          </label>
          <p className="dl-sched-hint">{t("scheduler.maxConcurrentHint")}</p>

          <label className="dl-sched-row">
            <span className="dl-sched-row-label">{t("scheduler.autoStart")}</span>
            <Switch
              checked={draft.autoStartQueued}
              onChange={(next) => patch({ autoStartQueued: next })}
              label={t("scheduler.autoStart")}
            />
          </label>
          <p className="dl-sched-hint">{t("scheduler.autoStartHint")}</p>
        </div>

        {/* Time-of-day bandwidth rules */}
        <div className="dl-sched-card">
          <div className="dl-sched-card-head">
            <div className="dl-sched-card-title">
              <Gauge size={16} aria-hidden="true" />
              <span>{t("scheduler.rulesTitle")}</span>
            </div>
            <button type="button" className="dl-sched-add-btn" onClick={addRule}>
              <Plus size={13} aria-hidden="true" />
              <span>{t("scheduler.addRule")}</span>
            </button>
          </div>
          <p className="dl-sched-hint">{t("scheduler.rulesHint")}</p>

          {draft.bandwidthRules.length === 0 ? (
            <div className="dl-sched-empty">{t("scheduler.noRules")}</div>
          ) : (
            <div className="dl-sched-rules">
              {draft.bandwidthRules.map((rule) => (
                <div className="dl-sched-rule" key={rule.id}>
                  <div className="dl-sched-rule-top">
                    <input
                      className="dl-sched-rule-label"
                      type="text"
                      placeholder={t("scheduler.ruleLabel")}
                      value={rule.label}
                      onChange={(e) => setDraft({
                        ...draft,
                        bandwidthRules: draft.bandwidthRules.map((r) =>
                          r.id === rule.id ? { ...r, label: e.target.value } : r,
                        ),
                      })}
                      onBlur={(e) => updateRule(rule.id, { label: e.target.value })}
                    />
                    <button
                      type="button"
                      className="dl-sched-icon-btn"
                      aria-label={t("scheduler.removeRule")}
                      title={t("scheduler.removeRule")}
                      onClick={() => removeRule(rule.id)}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </div>
                  <DayChips
                    compact
                    days={rule.days}
                    onToggle={(index) => {
                      const days = [...rule.days] as ScheduleDays;
                      days[index] = !days[index];
                      updateRule(rule.id, { days });
                    }}
                  />
                  <div className="dl-sched-rule-grid">
                    <label className="dl-sched-field">
                      <span>{t("scheduler.windowStart")}</span>
                      <input
                        type="time"
                        value={rule.start}
                        onChange={(e) => updateRule(rule.id, { start: e.target.value })}
                      />
                    </label>
                    <label className="dl-sched-field">
                      <span>{t("scheduler.windowEnd")}</span>
                      <input
                        type="time"
                        value={rule.end}
                        onChange={(e) => updateRule(rule.id, { end: e.target.value })}
                      />
                    </label>
                    <label className="dl-sched-field">
                      <span>{t("scheduler.ruleDownload")}</span>
                      <input
                        type="number"
                        min={0}
                        value={rule.downloadKbps}
                        onChange={(e) =>
                          updateRule(rule.id, { downloadKbps: Math.max(0, Number(e.target.value) || 0) })
                        }
                      />
                    </label>
                    <label className="dl-sched-field">
                      <span>{t("scheduler.ruleUpload")}</span>
                      <input
                        type="number"
                        min={0}
                        value={rule.uploadKbps}
                        onChange={(e) =>
                          updateRule(rule.id, { uploadKbps: Math.max(0, Number(e.target.value) || 0) })
                        }
                      />
                    </label>
                  </div>
                  <label className="dl-sched-row">
                    <span className="dl-sched-row-label">{t("scheduler.ruleDisableUpload")}</span>
                    <Switch
                      checked={rule.disableUpload}
                      onChange={(next) => updateRule(rule.id, { disableUpload: next })}
                      label={t("scheduler.ruleDisableUpload")}
                    />
                  </label>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Waiting queue */}
      <div className="dl-sched-card dl-sched-queue-card">
        <div className="dl-sched-card-head">
          <div className="dl-sched-card-title">
            <CalendarClock size={16} aria-hidden="true" />
            <span>{t("scheduler.queueTitle")}</span>
            {waiting.length > 0 && <span className="dl-tab-count">{waiting.length}</span>}
          </div>
        </div>

        {waiting.length === 0 ? (
          <div className="dl-sched-empty dl-sched-empty--roomy">
            <p>{t("scheduler.queueEmpty")}</p>
            <span>{t("scheduler.queueEmptyHint")}</span>
          </div>
        ) : (
          <div className="dl-sched-queue">
            {waiting.map((download) => {
              const held = isScheduleHeld(download);
              return (
                <div className="dl-sched-queue-row" key={download.id}>
                  <div className="dl-sched-queue-main">
                    <span className="dl-sched-queue-name" title={download.name}>
                      {download.name}
                    </span>
                    <span className={`dl-status-badge dl-status-badge--${getStatusClassSuffix(download.status)}`}>
                      {getStatusLabel(download.status, t)}
                    </span>
                    <span className="dl-sched-queue-size">
                      {formatBytesShort(download.downloaded, unit)}
                      {download.totalSize ? ` / ${formatBytesShort(download.totalSize, unit)}` : ""}
                    </span>
                  </div>

                  <div className="dl-sched-queue-controls">
                    <span className={`dl-sched-queue-when${held ? " is-held" : ""}`}>
                      {held && download.scheduledStartAt
                        ? formatScheduleTimestamp(download.scheduledStartAt)
                        : t("scheduler.noSchedule")}
                    </span>
                    <input
                      className="dl-sched-datetime"
                      type="datetime-local"
                      value={
                        download.scheduledStartAt
                          ? toLocalInputValue(download.scheduledStartAt)
                          : ""
                      }
                      onChange={(e) => void setStartTime(download, e.target.value)}
                      aria-label={t("scheduler.startAt")}
                    />
                    <button
                      type="button"
                      className="dl-sched-now-btn"
                      onClick={() => void startNow(download)}
                    >
                      <Play size={13} aria-hidden="true" />
                      <span>{t("scheduler.startNow")}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
