import { useState, useMemo, useRef, useCallback } from "react";
import { captureAndSaveScreenshot } from "../../utils/screenshot";
import { useToast } from "../../context/ToastContext";
import { useSessionNotes } from "../../context/SessionNotesContext";
import { useLanguage } from "../../context/LanguageContext";
import type { Game, GameSession, SessionMetrics } from "../../types/game";
import { formatPlayTime, gameDisplayName } from "../../types/game";
import { SessionInspectorModal } from "../../components/activity/SessionInspectorModal";
import { GameThumbnail } from "./GameThumbnail";
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
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [minDurationFilter, setMinDurationFilter] = useState<number>(0);
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
  const [inspectedSessionId, setInspectedSessionId] = useState<string | null>(null);
  const [hover, setHover] = useState<{
    seg: Segment;
    bucketKey: string;
    pct: number;
    clientX: number;
    clientY: number;
  } | null>(null);

  // Density dimensions (px)
  const isCompact = density === "compact";
  const rowPad = isCompact ? 3 : 5;
  const laneStep = isCompact ? 13 : 18;
  const barH = isCompact ? 10 : 15;

  // 1. Build id → Game lookup
  const gameById = useMemo(() => {
    const m = new Map<string, Game>();
    games.forEach((g) => m.set(g.id, g));
    return m;
  }, [games]);

  const hoverGame = hover ? gameById.get(hover.seg.gameId) : undefined;

  // 2. Filter sessions by range, source, game filter, search query & min duration
  const filtered = useMemo(() => {
    const rangeStart = new Date(startDate + "T00:00:00").getTime();
    const rangeEnd = new Date(endDate + "T23:59:59.999").getTime();
    const query = searchQuery.trim().toLowerCase();

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
      if (minDurationFilter > 0 && s.durationMin < minDurationFilter) {
        return false;
      }
      if (query) {
        const g = gameById.get(s.gameId);
        const gName = (g ? gameDisplayName(g) : s.gameName || "").toLowerCase();
        if (!gName.includes(query)) return false;
      }
      return true;
    });
  }, [sessions, startDate, endDate, sourceFilter, selectedGameFilter, minDurationFilter, searchQuery, gameById]);

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

  const maxHourMinutes = useMemo(() => {
    return Math.max(1, ...hourBuckets.map((b) => b.mins));
  }, [hourBuckets]);

  // Peak gaming hours calculation (best 3-hour window)
  const peakWindow = useMemo(() => {
    let bestSum = 0;
    let bestStart = 20;
    for (let h = 0; h < 24; h++) {
      const sum =
        (hourBuckets[h]?.mins ?? 0) +
        (hourBuckets[(h + 1) % 24]?.mins ?? 0) +
        (hourBuckets[(h + 2) % 24]?.mins ?? 0);
      if (sum > bestSum) {
        bestSum = sum;
        bestStart = h;
      }
    }
    if (bestSum === 0) return null;
    const endH = (bestStart + 3) % 24;
    return `${String(bestStart).padStart(2, "0")}:00 – ${String(endH).padStart(2, "0")}:00`;
  }, [hourBuckets]);

  // Longest single session
  const longestSession = useMemo(() => {
    if (filtered.length === 0) return null;
    return filtered.reduce((max, s) => (s.durationMin > max.durationMin ? s : max), filtered[0]);
  }, [filtered]);

  // Peak day bucket
  const peakBucket = useMemo(() => {
    if (buckets.length === 0) return null;
    return buckets.reduce((max, b) => (b.totalMin > max.totalMin ? b : max), buckets[0]);
  }, [buckets]);

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
      topGames: ranked.slice(0, 10),
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
      .map((id) => {
        const game = gameById.get(id);
        return {
          id,
          name: game ? gameDisplayName(game) : sessions.find((s) => s.gameId === id)?.gameName || id,
        };
      })
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

  const handleScrollToPeak = () => {
    if (!rowsRef.current || !peakBucket) return;
    const el = rowsRef.current.querySelector(`[data-day="${peakBucket.key}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
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
      const filePath = await captureAndSaveScreenshot({
        element: el,
        fileName: "gameindex_timeline",
        title: t("activityGantt.saveTimeline"),
        filterLabel: t("activity.pngImage"),
        width: fullWidth,
        height: fullHeight,
        fallbackBackground: "#11131a",
        prepareClone: (clonedDoc) => {
          const clonedRows = clonedDoc.querySelector<HTMLElement>(".activity-gantt__rows");
          if (clonedRows) clonedRows.style.maxHeight = "none";
          clonedDoc
            .querySelectorAll<HTMLElement>(".activity-gantt__tooltip, .modal-backdrop, .act-modal-backdrop")
            .forEach((n) => {
              n.style.display = "none";
            });
        },
      });
      if (filePath) showToast(t("activityGantt.timelineSaved"), "success");
    } catch (error) {
      console.error("Timeline export error:", error);
      showToast(t("activityGantt.timelineFailed", { error: String(error) }), "error");
    }
  };

  const nowMin = useMemo(() => {
    const n = new Date();
    return n.getHours() * 60 + n.getMinutes() + n.getSeconds() / 60;
  }, []);

  const tickHours = [0, 4, 8, 12, 16, 20, 24];

  const inspectedSession = useMemo(() => {
    if (!inspectedSessionId) return null;
    return sessions.find((s) => s.id === inspectedSessionId) || null;
  }, [inspectedSessionId, sessions]);

  const inspectedGame = useMemo(() => {
    if (!inspectedSession) return undefined;
    return gameById.get(inspectedSession.gameId);
  }, [inspectedSession, gameById]);

  if (totalPlayedMinutes === 0 && !searchQuery) {
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
    <div className={`activity-gantt ${isCompact ? "activity-gantt--compact" : ""}`} ref={ganttRef}>
      {/* ── KPI Hero Strip ────────────────────────────────────────── */}
      <div className="activity-gantt__kpi-strip">
        <div className="activity-gantt__kpi-card">
          <span className="activity-gantt__kpi-icon"><Icons.Clock size={16} /></span>
          <div className="activity-gantt__kpi-body">
            <span className="activity-gantt__kpi-val">{formatPlayTime(totalPlayedMinutes)}</span>
            <span className="activity-gantt__kpi-label">{t("activityGantt.totalInRange")}</span>
          </div>
        </div>

        <div className="activity-gantt__kpi-card">
          <span className="activity-gantt__kpi-icon"><Icons.Calendar size={16} /></span>
          <div className="activity-gantt__kpi-body">
            <span className="activity-gantt__kpi-val">{filtered.length}</span>
            <span className="activity-gantt__kpi-label">
              {filtered.length === 1 ? t("activity.sessionOne") : t("activity.sessionsMany")}
            </span>
          </div>
        </div>

        {peakWindow && (
          <div className="activity-gantt__kpi-card">
            <span className="activity-gantt__kpi-icon" style={{ color: "var(--color-warning)" }}>
              <Icons.Flame size={16} />
            </span>
            <div className="activity-gantt__kpi-body">
              <span className="activity-gantt__kpi-val">{peakWindow}</span>
              <span className="activity-gantt__kpi-label">{t("activityGantt.peakWindow")}</span>
            </div>
          </div>
        )}

        {longestSession && (
          <div className="activity-gantt__kpi-card">
            <span className="activity-gantt__kpi-icon" style={{ color: "var(--color-accent)" }}>
              <Icons.Trophy size={16} />
            </span>
            <div className="activity-gantt__kpi-body">
              <span className="activity-gantt__kpi-val">{formatPlayTime(longestSession.durationMin)}</span>
              <span className="activity-gantt__kpi-label">
                {longestSession.gameName ? `${longestSession.gameName.slice(0, 16)}…` : t("activityGantt.longestSession")}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ── Toolbar / Controls ───────────────────────────────────── */}
      <div className="activity-gantt__toolbar">
        <div className="activity-gantt__tools-left">
          {/* Real-time search box */}
          <div className="activity-gantt__search-wrap">
            <Icons.Search size={13} className="activity-gantt__search-icon" />
            <input
              type="text"
              className="activity-gantt__search-input"
              placeholder={t("activityGantt.searchGame")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                className="activity-gantt__search-clear"
                onClick={() => setSearchQuery("")}
                title={t("activityGantt.clearFilter")}
              >
                <Icons.X size={12} />
              </button>
            )}
          </div>

          {/* Game selector */}
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

          {/* Min duration filter */}
          <select
            className="act-toolbar__select"
            value={minDurationFilter}
            onChange={(e) => setMinDurationFilter(Number(e.target.value))}
            aria-label={t("activityGantt.filterDuration")}
          >
            <option value={0}>{t("activityGantt.allDurations")}</option>
            <option value={15}>≥ 15 min</option>
            <option value={30}>≥ 30 min</option>
            <option value={60}>≥ 1 hour</option>
          </select>
        </div>

        <div className="activity-gantt__tools">
          {/* Density toggle */}
          <div className="activity-gantt__density-toggle" role="group" aria-label={t("activityGantt.density")}>
            <button
              type="button"
              className={`activity-gantt__density-btn ${density === "comfortable" ? "is-active" : ""}`}
              onClick={() => setDensity("comfortable")}
              title={t("activityGantt.comfortable")}
            >
              <Icons.Menu size={12} />
            </button>
            <button
              type="button"
              className={`activity-gantt__density-btn ${density === "compact" ? "is-active" : ""}`}
              onClick={() => setDensity("compact")}
              title={t("activityGantt.compact")}
            >
              <Icons.Grid size={12} />
            </button>
          </div>

          <button
            type="button"
            className="activity-gantt__tool-btn"
            onClick={handleScrollToToday}
            title={t("activityGantt.jumpToToday")}
          >
            <Icons.Calendar size={13} />
            <span>{t("activityGantt.jumpToToday")}</span>
          </button>

          {peakBucket && peakBucket.totalMin > 0 && (
            <button
              type="button"
              className="activity-gantt__tool-btn"
              onClick={handleScrollToPeak}
              title={t("activityGantt.jumpToPeak")}
            >
              <Icons.Zap size={13} />
              <span>{t("activityGantt.jumpToPeak")}</span>
            </button>
          )}

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

      {/* ── 24h Visualizer Intensity Strip ───────────────────────── */}
      <div className="activity-gantt__heatmap-strip">
        <div className="activity-gantt__heatmap-header">
          <span className="activity-gantt__heatmap-title">
            <Icons.Clock size={13} /> {t("activityGantt.hourlyIntensity")}
          </span>
          {peakWindow && (
            <span className="activity-gantt__heatmap-peak-badge">
              <Icons.Flame size={11} /> {t("activityGantt.peakWindow")}: {peakWindow}
            </span>
          )}
        </div>
        <div className="activity-gantt__visualizer-grid">
          {hourBuckets.map((b) => {
            const heightPct = Math.max(12, Math.round((b.mins / maxHourMinutes) * 100));
            const isPeak = b.mins >= maxHourMinutes * 0.8 && b.mins > 0;
            return (
              <div
                key={b.hour}
                className={`activity-gantt__visualizer-col ${isPeak ? "is-peak" : ""}`}
                title={`${String(b.hour).padStart(2, "0")}:00 – ${String((b.hour + 1) % 24).padStart(2, "0")}:00: ${formatPlayTime(b.mins)}`}
              >
                <div className="activity-gantt__visualizer-track">
                  <div
                    className="activity-gantt__visualizer-fill"
                    style={{
                      height: `${b.mins > 0 ? heightPct : 6}%`,
                      opacity: b.mins > 0 ? 1 : 0.25,
                    }}
                  />
                </div>
                <span className="activity-gantt__visualizer-hour">{b.hour}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Legend ───────────────────────────────────────────────── */}
      <div className="activity-gantt__legend">
        {topGames.map(([id, mins]) => {
          const game = gameById.get(id);
          const name = game ? gameDisplayName(game) : sessions.find((s) => s.gameId === id)?.gameName || id;
          const isDim = highlightGame !== null && highlightGame !== id;
          const gameColor = colorForGame(id);

          return (
            <button
              key={id}
              type="button"
              className={`activity-gantt__legend-item${isDim ? " activity-gantt__legend-item--dim" : ""}`}
              onClick={() => setHighlightGame(highlightGame === id ? null : id)}
            >
              <span
                className="activity-gantt__legend-dot"
                style={{
                  background: gameColor,
                  boxShadow: isDim ? "none" : `0 0 6px ${gameColor}`,
                }}
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
          const rowHeight = rowPad * 2 + bucket.maxLane * laneStep;
          const isPeakDay = peakBucket?.key === bucket.key && bucket.totalMin > 0;

          return (
            <div
              key={bucket.key}
              data-day={bucket.key}
              className={`activity-gantt__row${bucket.isToday ? " activity-gantt__row--today" : ""}${
                isPeakDay ? " activity-gantt__row--peak" : ""
              }`}
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
                {/* 6-hour vertical grid guides */}
                <div className="activity-gantt__hour-guide" style={{ left: "25%" }} />
                <div className="activity-gantt__hour-guide" style={{ left: "50%" }} />
                <div className="activity-gantt__hour-guide" style={{ left: "75%" }} />

                {bucket.isToday && (
                  <div
                    className="activity-gantt__now-line"
                    style={{ left: `${(nowMin / 1440) * 100}%` }}
                    title={t("activityGantt.currentTime")}
                  >
                    <span className="activity-gantt__now-head" />
                  </div>
                )}

                {bucket.segments.map((seg) => {
                  const leftPct = (seg.startMin / 1440) * 100;
                  const widthPct = Math.max(
                    MIN_BAR_W_PCT,
                    ((seg.endMin - seg.startMin) / 1440) * 100,
                  );
                  const topPx = rowPad + seg.lane * laneStep;
                  const isDimmed = highlightGame !== null && highlightGame !== seg.gameId;
                  const note = getNote(seg.sessionId);
                  const hasNote = Boolean(note.note || note.tags.length > 0);
                  const segGame = gameById.get(seg.gameId);
                  const gameColor = colorForGame(seg.gameId);

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
                        height: `${barH}px`,
                        background: gameColor,
                        boxShadow: `0 1px 3px rgba(0, 0, 0, 0.25)`,
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
                      aria-label={`${segGame ? gameDisplayName(segGame) : seg.gameName}: ${formatPlayTime(seg.durationMin)}`}
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
            top: `${hover.clientY - 10}px`,
          }}
        >
          <div className="activity-gantt__tooltip-header">
            {hoverGame && (
              <GameThumbnail
                iconUrl={hoverGame.iconUrl}
                coverArtUrl={hoverGame.coverArtUrl}
                steamAppId={hoverGame.steamAppId}
                name={gameDisplayName(hoverGame)}
                className="activity-gantt__tooltip-thumb"
              />
            )}
            <div className="activity-gantt__tooltip-title-wrap">
              <span
                className="activity-gantt__tooltip-dot"
                style={{ background: colorForGame(hover.seg.gameId) }}
              />
              <span className="activity-gantt__tooltip-name">
                {hoverGame ? gameDisplayName(hoverGame) : hover.seg.gameName}
              </span>
            </div>
          </div>

          <div className="activity-gantt__tooltip-time">
            <Icons.Clock size={11} style={{ display: "inline-block", marginRight: "4px", verticalAlign: "middle" }} />
            {hover.seg.absoluteStart.toLocaleTimeString(language, {
              hour: "2-digit",
              minute: "2-digit",
            })}{" "}
            –{" "}
            {hover.seg.absoluteEnd.toLocaleTimeString(language, {
              hour: "2-digit",
              minute: "2-digit",
            })}{" "}
            <strong className="activity-gantt__tooltip-duration">
              ({formatPlayTime(hover.seg.durationMin)})
            </strong>
          </div>

          {hover.seg.metrics && (
            <div className="activity-gantt__tooltip-chips">
              {hover.seg.metrics.avgFps ? (
                <span className="activity-gantt__tooltip-chip activity-gantt__tooltip-chip--fps">
                  <Icons.Gauge size={10} /> {hover.seg.metrics.avgFps} FPS
                </span>
              ) : null}
              {hover.seg.metrics.avgCpuUsage ? (
                <span className="activity-gantt__tooltip-chip">
                  <Icons.Cpu size={10} /> {Math.round(hover.seg.metrics.avgCpuUsage)}%
                </span>
              ) : null}
              {hover.seg.metrics.avgGpuUsage ? (
                <span className="activity-gantt__tooltip-chip">
                  <Icons.Activity size={10} /> {Math.round(hover.seg.metrics.avgGpuUsage)}%
                </span>
              ) : null}
            </div>
          )}

          <div className="activity-gantt__tooltip-footer">
            <span className="activity-gantt__tooltip-prompt">{t("activityGantt.inspectPrompt")}</span>
          </div>
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
