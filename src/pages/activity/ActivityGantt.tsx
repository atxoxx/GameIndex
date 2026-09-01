import { useState, useMemo, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { prepareClonedDocumentForCanvasCapture, resolveColorForCapture } from "../../utils/color";
import { useToast } from "../../context/ToastContext";
import { useSessionNotes } from "../../context/SessionNotesContext";
import { useLanguage } from "../../context/LanguageContext";
import type { Game, GameSession, SessionMetrics } from "../../types/game";
import { formatPlayTime } from "../../types/game";
import { SessionInspectorModal } from "../../components/activity/SessionInspectorModal";
import * as Icons from "./Icons";

export interface ActivityGanttProps {
  sessions: GameSession[];
  games: Game[];
  startDate: string;
  endDate: string;
  /** Platform/source filter from the global toolbar. "all" = no filter. */
  sourceFilter?: string;
  onLaunchGame?: (game: Game) => void;
  onDeleteSession?: (sessionId: string) => void;
}

/** A single within-day slice of a session (a session may span multiple days). */
interface Segment {
  id: string; // unique per day: `${sessionId}#${dayIndex}`
  sessionId: string;
  gameId: string;
  gameName: string;
  startMin: number; // minutes from local midnight [0, 1440)
  endMin: number; // minutes from local midnight (<= 1440)
  lane: number; // vertical lane for overlap stacking
  absoluteStart: Date;
  absoluteEnd: Date;
  durationMin: number; // full session duration
  isContinuation: boolean; // started on a previous day
  continuationTail: boolean; // continues onto the next day
  metrics?: SessionMetrics;
}

interface DayBucket {
  key: string; // YYYY-MM-DD
  label: string;
  sortKey: number; // ms
  isToday: boolean;
  segments: Segment[];
  maxLane: number; // number of lanes used
  totalMin: number; // total played minutes that day
}

const MINUTE = 60_000;
const DAY_MS = 24 * 60 * MINUTE;
const MAX_CONTINUOUS_DAYS = 120;
const SAMPLED_CAP = 60;

// Lane geometry (px)
const ROW_PAD = 4;
const LANE_STEP = 16;
const BAR_H = 14;
const MIN_BAR_W_PCT = 0.4;

const TINT = (c: string) => `color-mix(in srgb, ${c} 45%, var(--color-bg-primary))`;
const MIX = (a: string, b: string) => `color-mix(in srgb, ${a} 50%, ${TINT(b)})`;
const PALETTE = [
  TINT("var(--color-info)"),
  TINT("var(--color-danger)"),
  TINT("var(--color-success)"),
  TINT("var(--color-warning)"),
  TINT("var(--color-accent)"),
  MIX("var(--color-info)", "var(--color-accent)"),
  MIX("var(--color-success)", "var(--color-info)"),
  MIX("var(--color-warning)", "var(--color-success)"),
  MIX("var(--color-danger)", "var(--color-warning)"),
  MIX("var(--color-accent)", "var(--color-danger)"),
  MIX("var(--color-info)", "var(--color-success)"),
  MIX("var(--color-warning)", "var(--color-danger)"),
  MIX("var(--color-accent)", "var(--color-info)"),
  MIX("var(--color-success)", "var(--color-accent)"),
  MIX("var(--color-danger)", "var(--color-info)"),
];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function formatDateLabel(date: Date, language: string): string {
  return date.toLocaleDateString(language, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function getHourBuckets(
  sessions: GameSession[],
  startDate?: string,
  endDate?: string,
): { hour: number; mins: number }[] {
  const counts = new Array(24).fill(0);
  const rangeStart = startDate ? new Date(startDate + "T00:00:00").getTime() : 0;
  const rangeEnd = endDate ? new Date(endDate + "T23:59:59.999").getTime() : Infinity;

  for (const s of sessions) {
    const end = new Date(s.date).getTime();
    const start = end - s.durationMin * MINUTE;
    const effectiveStart = Math.max(start, rangeStart);
    const effectiveEnd = Math.min(end, rangeEnd);
    if (effectiveEnd <= effectiveStart) continue;

    let cursor = effectiveStart;
    while (cursor < effectiveEnd) {
      const d = new Date(cursor);
      const hour = d.getHours();
      const hourStart = new Date(d);
      hourStart.setHours(hour, 0, 0, 0);
      const hourEnd = hourStart.getTime() + 60 * MINUTE;
      const overlap = Math.max(0, Math.min(effectiveEnd, hourEnd) - Math.max(cursor, hourStart.getTime()));
      if (overlap > 0) {
        counts[hour] += overlap / MINUTE;
      }
      cursor = hourEnd;
      if (cursor <= hourStart.getTime()) break;
    }
  }
  return counts.map((mins, hour) => ({ hour, mins: Math.round(mins) }));
}

function getHeatmapIntensity(mins: number): string {
  if (mins <= 0) return "activity-gantt__heatmap-cell--empty";
  if (mins < 15) return "activity-gantt__heatmap-cell--low";
  if (mins < 45) return "activity-gantt__heatmap-cell--medium";
  if (mins < 90) return "activity-gantt__heatmap-cell--high";
  return "activity-gantt__heatmap-cell--peak";
}

function prepareGanttClone(clonedDoc: Document): void {
  prepareClonedDocumentForCanvasCapture(clonedDoc);
  const rows = clonedDoc.querySelector<HTMLElement>(".activity-gantt__rows");
  if (rows) rows.style.maxHeight = "none";
  clonedDoc
    .querySelectorAll<HTMLElement>(".activity-gantt__tooltip, .modal-backdrop, .act-modal-backdrop")
    .forEach((n) => {
      n.style.display = "none";
    });
}

export function ActivityGantt({
  sessions,
  games,
  startDate,
  endDate,
  sourceFilter = "all",
  onLaunchGame,
  onDeleteSession,
}: ActivityGanttProps) {
  const { showToast } = useToast();
  const { getNote } = useSessionNotes();
  const { t, language } = useLanguage();
  const ganttRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);

  const [highlightGame, setHighlightGame] = useState<string | null>(null);
  const [selectedGameFilter, setSelectedGameFilter] = useState<string>("all");
  const [inspectedSessionId, setInspectedSessionId] = useState<string | null>(null);
  const [hover, setHover] = useState<{
    seg: Segment;
    bucketKey: string;
    pct: number;
    clientX: number;
    clientY: number;
  } | null>(null);

  // 1. Build id→Game lookup
  const gameById = useMemo(() => {
    const m = new Map<string, Game>();
    games.forEach((g) => m.set(g.id, g));
    return m;
  }, [games]);

  // 2. Filter sessions by range + source/platform + game filter
  const filtered = useMemo(() => {
    const rangeStart = new Date(startDate + "T00:00:00").getTime();
    const rangeEnd = new Date(endDate + "T23:59:59.999").getTime();

    return sessions.filter((s) => {
      const endTime = new Date(s.date).getTime();
      const startTime = endTime - s.durationMin * MINUTE;
      if (endTime < rangeStart || startTime > rangeEnd) return false;
      if (sourceFilter !== "all") {
        const plat = gameById.get(s.gameId)?.platform;
        if (plat !== sourceFilter) return false;
      }
      if (selectedGameFilter !== "all" && s.gameId !== selectedGameFilter) {
        return false;
      }
      return true;
    });
  }, [sessions, startDate, endDate, sourceFilter, selectedGameFilter, gameById]);

  // 3. Split into per-day segments
  const { buckets } = useMemo(() => {
    const todayKey = ymd(new Date());
    const rangeStart = new Date(startDate + "T00:00:00");
    const rangeEnd = new Date(endDate + "T23:59:59.999");
    const startMs = rangeStart.getTime();
    const endMs = rangeEnd.getTime();

    const segmentsByDay = new Map<string, Segment[]>();
    const dayMeta = new Map<string, { sortKey: number; label: string }>();

    for (const sess of filtered) {
      const endT = new Date(sess.date).getTime();
      const startT = endT - sess.durationMin * MINUTE;
      const totalDays = Math.ceil((endT - startT) / DAY_MS) + 1;
      const cursor = new Date(startT);
      cursor.setHours(0, 0, 0, 0);

      for (let d = 0; d < totalDays; d++) {
        const dayStart = new Date(cursor);
        dayStart.setDate(cursor.getDate() + d);
        const dayStartMs = dayStart.getTime();
        const dayEndMs = dayStartMs + DAY_MS;

        const segStart = Math.max(startT, dayStartMs);
        const segEnd = Math.min(endT, dayEndMs);
        if (segEnd - segStart < MINUTE) continue;

        const key = ymd(dayStart);
        const startMin = (segStart - dayStartMs) / MINUTE;
        const endMin = (segEnd - dayStartMs) / MINUTE;

        const seg: Segment = {
          id: `${sess.id}#${d}`,
          sessionId: sess.id,
          gameId: sess.gameId,
          gameName: sess.gameName,
          startMin,
          endMin,
          lane: 0,
          absoluteStart: new Date(segStart),
          absoluteEnd: new Date(segEnd),
          durationMin: sess.durationMin,
          isContinuation: segStart > startT + MINUTE,
          continuationTail: segEnd < endT - MINUTE,
          metrics: sess.metrics,
        };

        if (!segmentsByDay.has(key)) {
          segmentsByDay.set(key, []);
          dayMeta.set(key, { sortKey: dayStartMs, label: formatDateLabel(dayStart, language) });
        }
        segmentsByDay.get(key)!.push(seg);
      }
    }

    const makeBucket = (key: string, segs: Segment[]): DayBucket => {
      const sorted = [...segs].sort((a, b) => a.startMin - b.startMin);
      const laneEnds: number[] = [];
      for (const s of sorted) {
        let lane = laneEnds.findIndex((e) => e <= s.startMin + 0.01);
        if (lane === -1) {
          lane = laneEnds.length;
          laneEnds.push(s.endMin);
        } else {
          laneEnds[lane] = s.endMin;
        }
        s.lane = lane;
      }
      const maxLane = Math.max(1, laneEnds.length);
      const totalMin = Math.round(segs.reduce((a, s) => a + (s.endMin - s.startMin), 0));
      const meta = dayMeta.get(key);
      const sortKey = meta ? meta.sortKey : new Date(key + "T00:00:00").getTime();
      const label = meta ? meta.label : formatDateLabel(new Date(sortKey), language);
      return {
        key,
        label,
        sortKey,
        isToday: key === todayKey,
        segments: sorted,
        maxLane,
        totalMin,
      };
    };

    const windowDays = Math.round((endMs - startMs) / DAY_MS) + 1;

    if (windowDays <= MAX_CONTINUOUS_DAYS) {
      const out: DayBucket[] = [];
      const cur = new Date(rangeStart);
      for (let d = 0; d < windowDays; d++) {
        const day = new Date(cur);
        day.setDate(cur.getDate() + d);
        const key = ymd(day);
        out.push(makeBucket(key, segmentsByDay.get(key) ?? []));
      }
      return { buckets: out, sampled: false, totalDayCount: out.length };
    }

    const sampledBuckets = Array.from(segmentsByDay.keys())
      .map((k) => ({ k, sortKey: dayMeta.get(k)?.sortKey ?? 0 }))
      .sort((a, b) => a.sortKey - b.sortKey)
      .slice(-SAMPLED_CAP)
      .map(({ k }) => makeBucket(k, segmentsByDay.get(k)!));

    return {
      buckets: sampledBuckets,
    };
  }, [filtered, startDate, endDate, language]);

  // 3b. Time-of-day play-pattern heatmap
  const hourBuckets = useMemo(
    () => getHourBuckets(filtered, startDate, endDate),
    [filtered, startDate, endDate],
  );

  // 4. Color map
  const { colorMap, topGames } = useMemo(() => {
    const totals = new Map<string, number>();
    for (const b of buckets) {
      for (const s of b.segments) {
        totals.set(s.gameId, (totals.get(s.gameId) || 0) + (s.endMin - s.startMin));
      }
    }
    const ranked = Array.from(totals.entries())
      .map(([id, mins]) => [id, Math.round(mins)] as [string, number])
      .sort((a, b) => b[1] - a[1]);
    const map = new Map<string, string>();
    ranked.forEach(([id], i) => {
      map.set(id, PALETTE[i % PALETTE.length]);
    });
    return {
      colorMap: map,
      topGames: ranked.slice(0, 8),
    };
  }, [buckets]);

  const colorForGame = useCallback(
    (id: string) => colorMap.get(id) ?? PALETTE[0],
    [colorMap],
  );

  const totalPlayedMinutes = useMemo(
    () => Math.round(buckets.reduce((sum, b) => sum + b.totalMin, 0)),
    [buckets],
  );

  const availableGamesForFilter = useMemo(() => {
    const gameIds = new Set(sessions.map((s) => s.gameId));
    return Array.from(gameIds)
      .map((id) => ({
        id,
        name: gameById.get(id)?.name || sessions.find((s) => s.gameId === id)?.gameName || id,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [sessions, gameById]);

  const handleScrollToToday = () => {
    if (!rowsRef.current) return;
    const todayEl = rowsRef.current.querySelector(".activity-gantt__row--today");
    if (todayEl) {
      todayEl.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      rowsRef.current.scrollTop = rowsRef.current.scrollHeight;
    }
  };

  const handleExportImage = async () => {
    const el = ganttRef.current;
    if (!el) return;
    try {
      const fullWidth = el.scrollWidth;
      const rows = el.querySelector<HTMLElement>(".activity-gantt__rows");
      const fullHeight = rows
        ? el.offsetHeight - rows.offsetHeight + rows.scrollHeight
        : el.scrollHeight;
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(el, {
        backgroundColor: resolveColorForCapture("var(--color-bg-primary)", "#11131a"),
        scale: 2,
        logging: false,
        useCORS: true,
        width: fullWidth,
        height: fullHeight,
        windowWidth: fullWidth,
        windowHeight: fullHeight,
        onclone: prepareGanttClone,
      });
      const dataUrl = canvas.toDataURL("image/png");
      const filePath = await save({
        title: t("activityGantt.saveTimeline"),
        defaultPath: `gameindex_timeline_${new Date().toISOString().slice(0, 10)}.png`,
        filters: [{ name: t("activity.pngImage"), extensions: ["png"] }],
      });
      if (!filePath) return;
      await invoke("save_screenshot", { filePath, base64Data: dataUrl });
      showToast(t("activityGantt.timelineSaved"), "success");
    } catch (error) {
      console.error("Timeline export error:", error);
      showToast(t("activityGantt.timelineFailed", { error: String(error) }), "error");
    }
  };

  const nowMin = useMemo(() => {
    const n = new Date();
    return n.getHours() * 60 + n.getMinutes() + n.getSeconds() / 60;
  }, []);

  const tickHours = [0, 6, 12, 18, 24];

  const inspectedSession = useMemo(() => {
    if (!inspectedSessionId) return null;
    return sessions.find((s) => s.id === inspectedSessionId) || null;
  }, [inspectedSessionId, sessions]);

  const inspectedGame = useMemo(() => {
    if (!inspectedSession) return undefined;
    return gameById.get(inspectedSession.gameId);
  }, [inspectedSession, gameById]);

  if (totalPlayedMinutes === 0) {
    return (
      <div className="section-panel">
        <div className="activity-empty">
          <div className="activity-empty__icon">
            <Icons.GanttChart size={24} />
          </div>
          <div className="activity-empty__title">{t("activityGantt.noSessions")}</div>
          <div className="activity-empty__hint">{t("activity.emptyRangeHint")}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="activity-gantt" ref={ganttRef}>
      {/* ── Toolbar / Controls ───────────────────────────────────── */}
      <div className="activity-gantt__toolbar">
        <div className="activity-gantt__summary">
          <span className="activity-gantt__stat">
            <strong className="activity-gantt__stat-val">
              {formatPlayTime(totalPlayedMinutes)}
            </strong>
            <span className="activity-gantt__stat-lbl">
              {t("activityGantt.totalInRange")}
            </span>
          </span>
          <span className="activity-gantt__stat-sep">•</span>
          <span className="activity-gantt__stat">
            <strong className="activity-gantt__stat-val">{filtered.length}</strong>
            <span className="activity-gantt__stat-lbl">
              {filtered.length === 1 ? t("activity.sessionOne") : t("activity.sessionsMany")}
            </span>
          </span>
        </div>

        <div className="activity-gantt__tools">
          <select
            className="act-toolbar__select"
            value={selectedGameFilter}
            onChange={(e) => setSelectedGameFilter(e.target.value)}
            aria-label={t("activityPerf.gameLabel")}
          >
            <option value="all">{t("activityPerf.allGames")}</option>
            {availableGamesForFilter.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="activity-gantt__tool-btn"
            onClick={handleScrollToToday}
            title={t("activityGantt.jumpToToday")}
          >
            <Icons.Calendar size={13} />
            <span>{t("activityGantt.jumpToToday")}</span>
          </button>

          <button
            type="button"
            className="activity-gantt__tool-btn"
            onClick={handleExportImage}
            title={t("activityGantt.exportImage")}
          >
            <Icons.Camera size={13} />
            <span>{t("activityGantt.exportImage")}</span>
          </button>
        </div>
      </div>

      {/* ── Hourly Intensity Heatmap Strip ───────────────────────── */}
      <div className="activity-gantt__heatmap-strip">
        <div className="activity-gantt__heatmap-header">
          <span className="activity-gantt__heatmap-title">
            <Icons.Clock size={12} /> {t("activityGantt.hourlyIntensity")}
          </span>
        </div>
        <div className="activity-gantt__heatmap-grid">
          {hourBuckets.map((b) => (
            <div
              key={b.hour}
              className={`activity-gantt__heatmap-cell ${getHeatmapIntensity(b.mins)}`}
              title={`${String(b.hour).padStart(2, "0")}:00 — ${formatPlayTime(b.mins)}`}
            >
              <span className="activity-gantt__heatmap-hour">{b.hour}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Legend ───────────────────────────────────────────────── */}
      <div className="activity-gantt__legend">
        {topGames.map(([id, mins]) => {
          const game = gameById.get(id);
          const name = game?.name || sessions.find((s) => s.gameId === id)?.gameName || id;
          const isDim = highlightGame !== null && highlightGame !== id;
          return (
            <button
              key={id}
              type="button"
              className={`activity-gantt__legend-item${isDim ? " activity-gantt__legend-item--dim" : ""}`}
              onClick={() => setHighlightGame(highlightGame === id ? null : id)}
            >
              <span
                className="activity-gantt__legend-dot"
                style={{ background: colorForGame(id) }}
              />
              <span className="activity-gantt__legend-name">{name}</span>
              <span className="activity-gantt__legend-mins">{formatPlayTime(mins)}</span>
            </button>
          );
        })}
      </div>

      {/* ── Time scale ticks ─────────────────────────────────────── */}
      <div className="activity-gantt__ticks-row">
        <div className="activity-gantt__day-label-space" />
        <div className="activity-gantt__ticks-track">
          {tickHours.map((h) => (
            <div
              key={h}
              className="activity-gantt__tick"
              style={{ left: `${(h / 24) * 100}%` }}
            >
              <span className="activity-gantt__tick-label">
                {String(h === 24 ? 0 : h).padStart(2, "0")}:00
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Day Rows ─────────────────────────────────────────────── */}
      <div className="activity-gantt__rows" ref={rowsRef}>
        {buckets.map((bucket) => {
          const rowHeight = ROW_PAD * 2 + bucket.maxLane * LANE_STEP;

          return (
            <div
              key={bucket.key}
              className={`activity-gantt__row${bucket.isToday ? " activity-gantt__row--today" : ""}`}
              style={{ minHeight: `${rowHeight}px` }}
            >
              <div className="activity-gantt__row-label">
                <span className="activity-gantt__row-date">{bucket.label}</span>
                {bucket.totalMin > 0 && (
                  <span className="activity-gantt__row-mins">
                    {formatPlayTime(bucket.totalMin)}
                  </span>
                )}
              </div>

              <div
                className="activity-gantt__row-track"
                style={{ height: `${rowHeight}px` }}
              >
                {bucket.isToday && (
                  <div
                    className="activity-gantt__now-line"
                    style={{ left: `${(nowMin / 1440) * 100}%` }}
                    title={t("activityGantt.currentTime")}
                  />
                )}

                {bucket.segments.map((seg) => {
                  const leftPct = (seg.startMin / 1440) * 100;
                  const widthPct = Math.max(
                    MIN_BAR_W_PCT,
                    ((seg.endMin - seg.startMin) / 1440) * 100,
                  );
                  const topPx = ROW_PAD + seg.lane * LANE_STEP;
                  const isDimmed = highlightGame !== null && highlightGame !== seg.gameId;
                  const note = getNote(seg.sessionId);
                  const hasNote = Boolean(note.note || note.tags.length > 0);

                  const barClasses = [
                    "activity-gantt__bar",
                    isDimmed ? "activity-gantt__bar--dim" : "",
                    seg.isContinuation ? "activity-gantt__bar--cont-head" : "",
                    seg.continuationTail ? "activity-gantt__bar--cont-tail" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");

                  return (
                    <button
                      key={seg.id}
                      type="button"
                      className={barClasses}
                      style={{
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                        top: `${topPx}px`,
                        height: `${BAR_H}px`,
                        backgroundColor: colorForGame(seg.gameId),
                      }}
                      onClick={() => setInspectedSessionId(seg.sessionId)}
                      onMouseEnter={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setHover({
                          seg,
                          bucketKey: bucket.key,
                          pct: leftPct,
                          clientX: rect.left + rect.width / 2,
                          clientY: rect.top,
                        });
                      }}
                      onMouseLeave={() => setHover(null)}
                      aria-label={`${seg.gameName}: ${formatPlayTime(seg.durationMin)}`}
                    >
                      {hasNote && (
                        <span className="activity-gantt__bar-note-dot" title={t("sessionNotes.title")} />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Hover Tooltip ────────────────────────────────────────── */}
      {hover && (
        <div
          className="activity-gantt__tooltip"
          style={{
            left: `${hover.clientX}px`,
            top: `${hover.clientY - 8}px`,
          }}
        >
          <div className="activity-gantt__tooltip-header">
            <span
              className="activity-gantt__tooltip-dot"
              style={{ background: colorForGame(hover.seg.gameId) }}
            />
            <span className="activity-gantt__tooltip-name">{hover.seg.gameName}</span>
          </div>
          <div className="activity-gantt__tooltip-time">
            {hover.seg.absoluteStart.toLocaleTimeString(language, {
              hour: "2-digit",
              minute: "2-digit",
            })}{" "}
            –{" "}
            {hover.seg.absoluteEnd.toLocaleTimeString(language, {
              hour: "2-digit",
              minute: "2-digit",
            })}{" "}
            ({formatPlayTime(hover.seg.durationMin)})
          </div>
          {hover.seg.metrics && (
            <div className="activity-gantt__tooltip-chips">
              {hover.seg.metrics.avgFps ? (
                <span className="activity-gantt__tooltip-chip">
                  {hover.seg.metrics.avgFps} FPS
                </span>
              ) : null}
              {hover.seg.metrics.avgCpuUsage ? (
                <span className="activity-gantt__tooltip-chip">
                  CPU {Math.round(hover.seg.metrics.avgCpuUsage)}%
                </span>
              ) : null}
              {hover.seg.metrics.avgGpuUsage ? (
                <span className="activity-gantt__tooltip-chip">
                  GPU {Math.round(hover.seg.metrics.avgGpuUsage)}%
                </span>
              ) : null}
            </div>
          )}
        </div>
      )}

      {/* ── Session Inspector Modal ───────────────────────────────── */}
      <SessionInspectorModal
        session={inspectedSession}
        game={inspectedGame}
        onClose={() => setInspectedSessionId(null)}
        onLaunchGame={onLaunchGame}
        onDeleteSession={onDeleteSession}
      />
    </div>
  );
}
