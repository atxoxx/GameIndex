import { useEffect, useMemo, useState } from "react";
import { CalendarClock, ChevronDown, ChevronUp, Gauge, Play, Plus, Trash2 } from "lucide-react";
import { useDownloads } from "../../context/DownloadContext";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import {
  formatBytesShort,
  formatScheduleTimestamp,
  getDownloadDisplayName,
  getStatusClassSuffix,
  getStatusLabel,
  isScheduleHeld,
  isWithinScheduleWindow,
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

/** Short weekday labels for the active locale, Monday first. */
function weekdayShortLabels(language: string): string[] {
  const formatter = new Intl.DateTimeFormat(language, { weekday: "short" });
  return Array.from({ length: 7 }, (_, index) =>
    formatter.format(new Date(2024, 0, 1 + index)),
  );
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
  const { t, language } = useLanguage();
  const labels = useMemo(() => weekdayShortLabels(language), [language]);
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
          {labels[index]}
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
  const { t, language } = useLanguage();
  const { showToast } = useToast();
  const { unit } = useSizeUnit();
  const {
    downloads,
    schedulerConfig,
    setSchedulerConfig,
    scheduleDownload,
    resumeDownload,
    setPriority,
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
        const pa = a.priority ?? 0;
        const pb = b.priority ?? 0;
        if (pa !== pb) return pb - pa;
        const aAt = a.scheduledStartAt ?? Number.MAX_SAFE_INTEGER;
        const bAt = b.scheduledStartAt ?? Number.MAX_SAFE_INTEGER;
        if (aAt !== bAt) return aAt - bAt;
        return b.addedAt - a.addedAt;
      });
  }, [downloads]);

  const changePriority = async (download: TorrentDownload, delta: number) => {
    try {
      await setPriority(download.id, (download.priority ?? 0) + delta);
    } catch (err) {
      showToast(t("scheduler.saveFailed", { error: String(err) }), "error");
    }
  };

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

  const status = !draft.enabled
    ? { label: t("scheduler.statusInactive"), className: "is-off" }
    : draft.windowEnabled
      ? isWithinScheduleWindow(draft)
        ? { label: t("scheduler.statusWindowOpen"), className: "is-open" }
        : { label: t("scheduler.statusWindowClosed"), className: "is-closed" }
      : { label: t("scheduler.statusActive"), className: "is-open" };

  const weekdayLabels = weekdayShortLabels(language);

  // The window can cross midnight; split it into the two pieces of the day
  // so the week strip can paint them without special-casing midnight.
  const windowSegments = useMemo(() => {
    const toMinutes = (value: string) => {
      const [hours, minutes] = value.split(":").map(Number);
      return (Number.isFinite(hours) ? hours : 0) * 60 + (Number.isFinite(minutes) ? minutes : 0);
    };
    const start = toMinutes(draft.windowStart);
    const end = toMinutes(draft.windowEnd);
    if (start === end) return [];
    return start < end
      ? [{ from: start, to: end }]
      : [
          { from: start, to: 1440 },
          { from: 0, to: end },
        ];
  }, [draft.windowStart, draft.windowEnd]);

  const windowHours =
    Math.round(
      (windowSegments.reduce((total, segment) => total + segment.to - segment.from, 0) / 60) * 10,
    ) / 10;

  const now = new Date();
  const nowPercent = ((now.getHours() * 60 + now.getMinutes()) / 1440) * 100;

  return (
    <div className="dl-sched dsc">
      <header className="dsc-header">
        <div className="dsc-head-icon">
          <CalendarClock size={18} aria-hidden="true" />
        </div>
        <div className="dsc-head-text">
          <h3 className="dsc-title">{t("scheduler.title")}</h3>
          <p className="dsc-subtitle">{t("scheduler.subtitle")}</p>
        </div>
        <div className="dsc-head-actions">
          <span className={`dsc-status ${status.className}`}>
            <span className="dsc-status-dot" aria-hidden="true" />
            {status.label}
          </span>
          <Switch
            checked={draft.enabled}
            onChange={(next) => patch({ enabled: next })}
            label={t("scheduler.enabled")}
          />
        </div>
      </header>

      <div className="dsc-grid">
        <section className="dsc-card">
          <header className="dsc-card-head">
            <div className="dsc-card-title">
              <CalendarClock size={15} aria-hidden="true" />
              <span>{t("scheduler.groupWindow")}</span>
            </div>
            <div className="dsc-card-actions">
              {draft.windowEnabled && (
                <span className="dsc-window-badge">
                  {draft.windowStart}–{draft.windowEnd} · {windowHours}h
                </span>
              )}
              <Switch
                checked={draft.windowEnabled}
                onChange={(next) => patch({ windowEnabled: next })}
                label={t("scheduler.windowEnabled")}
              />
            </div>
          </header>

          <div className={`dsc-week${draft.windowEnabled ? "" : " is-off"}`}>
            <div className="dsc-week-axis">
              <span className="dsc-week-day" />
              <div className="dsc-week-hours">
                <span>00</span>
                <span>06</span>
                <span>12</span>
                <span>18</span>
                <span>24</span>
              </div>
            </div>

            {weekdayLabels.map((label, index) => (
              <div className="dsc-week-row" key={label + index}>
                <span className="dsc-week-day">{label}</span>
                <div className="dsc-week-track">
                  {draft.windowEnabled &&
                    draft.days[index] &&
                    windowSegments.map((segment, segmentIndex) => (
                      <span
                        key={segmentIndex}
                        className="dsc-week-band"
                        style={{
                          left: `${(segment.from / 1440) * 100}%`,
                          width: `${((segment.to - segment.from) / 1440) * 100}%`,
                        }}
                      />
                    ))}
                  <span
                    className="dsc-week-now"
                    style={{ left: `${nowPercent}%` }}
                    aria-hidden="true"
                  />
                </div>
              </div>
            ))}
          </div>

          <div className={`dsc-window${draft.windowEnabled ? "" : " is-dim"}`}>
            <label className="dsc-field">
              <span>{t("scheduler.windowStart")}</span>
              <input
                type="time"
                value={draft.windowStart}
                onChange={(e) => setDraft({ ...draft, windowStart: e.target.value })}
                onBlur={(e) => patch({ windowStart: e.target.value })}
              />
            </label>

            <label className="dsc-field">
              <span>{t("scheduler.windowEnd")}</span>
              <input
                type="time"
                value={draft.windowEnd}
                onChange={(e) => setDraft({ ...draft, windowEnd: e.target.value })}
                onBlur={(e) => patch({ windowEnd: e.target.value })}
              />
            </label>

            <div className="dsc-days">
              <span className="dsc-field-label">{t("scheduler.days")}</span>
              <DayChips days={draft.days} onToggle={toggleDay} />
            </div>
          </div>

        </section>

        <section className="dsc-card">
          <header className="dsc-card-head">
            <div className="dsc-card-title">
              <Gauge size={15} aria-hidden="true" />
              <span>{t("scheduler.rulesTitle")}</span>
            </div>
            <button type="button" className="dsc-add-btn" onClick={addRule}>
              <Plus size={13} aria-hidden="true" />
              <span>{t("scheduler.addRule")}</span>
            </button>
          </header>
          <p className="dsc-hint">{t("scheduler.rulesHint")}</p>

          {draft.bandwidthRules.length === 0 ? (
            <div className="dsc-empty">
              <span className="dsc-empty-icon" aria-hidden="true">
                <Gauge size={20} />
              </span>
              <p>{t("scheduler.noRules")}</p>
              <span>{t("scheduler.noRulesHint")}</span>
            </div>
          ) : (
            <div className="dsc-rules">
              {draft.bandwidthRules.map((rule) => (
                <div className="dsc-rule" key={rule.id}>
                  <div className="dsc-rule-head">
                    <input
                      className="dsc-rule-label"
                      type="text"
                      placeholder={t("scheduler.ruleLabel")}
                      value={rule.label}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          bandwidthRules: draft.bandwidthRules.map((r) =>
                            r.id === rule.id ? { ...r, label: e.target.value } : r,
                          ),
                        })
                      }
                      onBlur={(e) => updateRule(rule.id, { label: e.target.value })}
                    />
                    <button
                      type="button"
                      className="dsc-icon-btn"
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

                  <div className="dsc-rule-grid">
                    <label className="dsc-field">
                      <span>{t("scheduler.windowStart")}</span>
                      <input
                        type="time"
                        value={rule.start}
                        onChange={(e) => updateRule(rule.id, { start: e.target.value })}
                      />
                    </label>
                    <label className="dsc-field">
                      <span>{t("scheduler.windowEnd")}</span>
                      <input
                        type="time"
                        value={rule.end}
                        onChange={(e) => updateRule(rule.id, { end: e.target.value })}
                      />
                    </label>
                    <label className="dsc-field">
                      <span>{t("scheduler.ruleDownload")}</span>
                      <input
                        type="number"
                        min={0}
                        value={rule.downloadKbps}
                        onChange={(e) =>
                          updateRule(rule.id, {
                            downloadKbps: Math.max(0, Number(e.target.value) || 0),
                          })
                        }
                      />
                    </label>
                    <label className="dsc-field">
                      <span>{t("scheduler.ruleUpload")}</span>
                      <input
                        type="number"
                        min={0}
                        value={rule.uploadKbps}
                        onChange={(e) =>
                          updateRule(rule.id, {
                            uploadKbps: Math.max(0, Number(e.target.value) || 0),
                          })
                        }
                      />
                    </label>
                  </div>

                  <div className="dsc-setting dsc-setting--inline">
                    <span className="dsc-setting-label">{t("scheduler.ruleDisableUpload")}</span>
                    <Switch
                      checked={rule.disableUpload}
                      onChange={(next) => updateRule(rule.id, { disableUpload: next })}
                      label={t("scheduler.ruleDisableUpload")}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="dsc-card">
        <header className="dsc-card-head">
          <div className="dsc-card-title">
            <Gauge size={15} aria-hidden="true" />
            <span>{t("scheduler.groupAutomation")}</span>
          </div>
        </header>

        <div className="dsc-settings">
          <div className="dsc-setting">
            <div className="dsc-setting-text">
              <span className="dsc-setting-label">{t("scheduler.maxConcurrent")}</span>
              <span className="dsc-setting-hint">{t("scheduler.maxConcurrentHint")}</span>
            </div>
            <input
              className="dsc-number"
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
          </div>

          <div className="dsc-setting">
            <div className="dsc-setting-text">
              <span className="dsc-setting-label">{t("scheduler.autoStart")}</span>
              <span className="dsc-setting-hint">{t("scheduler.autoStartHint")}</span>
            </div>
            <Switch
              checked={draft.autoStartQueued}
              onChange={(next) => patch({ autoStartQueued: next })}
              label={t("scheduler.autoStart")}
            />
          </div>

          <div className={`dsc-setting${draft.windowEnabled ? "" : " is-dim"}`}>
            <div className="dsc-setting-text">
              <span className="dsc-setting-label">{t("scheduler.pauseOutsideWindow")}</span>
              <span className="dsc-setting-hint">{t("scheduler.pauseOutsideWindowHint")}</span>
            </div>
            <Switch
              checked={draft.pauseOutsideWindow}
              onChange={(next) => patch({ pauseOutsideWindow: next })}
              label={t("scheduler.pauseOutsideWindow")}
            />
          </div>

          <div className="dsc-setting">
            <div className="dsc-setting-text">
              <span className="dsc-setting-label">{t("scheduler.pauseOnGame")}</span>
              <span className="dsc-setting-hint">{t("scheduler.pauseOnGameHint")}</span>
            </div>
            <Switch
              checked={draft.pauseOnGame}
              onChange={(next) => patch({ pauseOnGame: next })}
              label={t("scheduler.pauseOnGame")}
            />
          </div>
        </div>
      </section>

      <section className="dsc-card dsc-queue">
        <header className="dsc-card-head">
          <div className="dsc-card-title">
            <CalendarClock size={15} aria-hidden="true" />
            <span>{t("scheduler.queueTitle")}</span>
            {waiting.length > 0 && <span className="dsc-count">{waiting.length}</span>}
          </div>
        </header>

        {waiting.length === 0 ? (
          <div className="dsc-empty">
            <span className="dsc-empty-icon" aria-hidden="true">
              <CalendarClock size={20} />
            </span>
            <p>{t("scheduler.queueEmpty")}</p>
            <span>{t("scheduler.queueEmptyHint")}</span>
          </div>
        ) : (
          <div className="dsc-queue-list">
            {waiting.map((download) => {
              const held = isScheduleHeld(download);
              return (
                <div className={`dsc-queue-row${held ? " is-held" : ""}`} key={download.id}>
                  <div className="dsc-queue-main">
                    <div className="dsc-queue-title">
                      <span
                        className="dsc-queue-name"
                        title={getDownloadDisplayName(download, t)}
                      >
                        {getDownloadDisplayName(download, t)}
                      </span>
                      <span
                        className={`dsc-pill dsc-pill--${getStatusClassSuffix(download.status)}`}
                      >
                        {getStatusLabel(download.status, t)}
                      </span>
                    </div>
                    <span className="dsc-queue-size">
                      {formatBytesShort(download.downloaded, unit)}
                      {download.totalSize
                        ? ` / ${formatBytesShort(download.totalSize, unit)}`
                        : ""}
                    </span>
                  </div>

                  <div className="dsc-queue-controls">
                    <div className="dsc-stepper" title={t("scheduler.priorityHint")}>
                      <button
                        type="button"
                        className="dsc-icon-btn"
                        aria-label={t("scheduler.priorityUp")}
                        title={t("scheduler.priorityUp")}
                        onClick={() => void changePriority(download, 1)}
                      >
                        <ChevronUp size={14} aria-hidden="true" />
                      </button>
                      <span className="dsc-stepper-value">{download.priority ?? 0}</span>
                      <button
                        type="button"
                        className="dsc-icon-btn"
                        aria-label={t("scheduler.priorityDown")}
                        title={t("scheduler.priorityDown")}
                        onClick={() => void changePriority(download, -1)}
                      >
                        <ChevronDown size={14} aria-hidden="true" />
                      </button>
                    </div>

                    <span className={`dsc-queue-when${held ? " is-held" : ""}`}>
                      {held && download.scheduledStartAt
                        ? formatScheduleTimestamp(download.scheduledStartAt)
                        : t("scheduler.noSchedule")}
                    </span>

                    <input
                      className="dsc-datetime"
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
                      className="dsc-now-btn"
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
      </section>
    </div>
  );
}
