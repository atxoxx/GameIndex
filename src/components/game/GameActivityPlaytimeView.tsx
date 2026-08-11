import { useMemo } from "react";
import type { ReactNode } from "react";
import { type GameSession, formatPlayTime } from "../../types/game";
import BarChart from "../charts/BarChart";
import LineChart from "../charts/LineChart";
import { useLanguage } from "../../context/LanguageContext";
import { SectionHead } from "./GameActivityShared";
import type { Stats, Timeframe, PlaytimeAggregation, PlaytimeChartStyle } from "./GameActivityShared";

interface GameActivityPlaytimeViewProps {
  stats: Stats;
  playtimeChartData: { data: number[]; labels: string[] };
  filteredSessions: GameSession[];
  sessionsWithHw: GameSession[];
  timeframe: Timeframe;
  playtimeAgg: PlaytimeAggregation;
  onAggChange: (agg: PlaytimeAggregation) => void;
  playtimeChartStyle: PlaytimeChartStyle;
  onStyleChange: (style: PlaytimeChartStyle) => void;
  isolatedSessionIndex: number | null;
  setIsolatedSessionIndex: (index: number | null) => void;
  onRequestDelete: (sessionId: string) => void;
}

/**
 * The "Playtime" sub-view: a framed identity header, the headline summary
 * band, then a two-column layout — session insights + recent sessions on
 * the left, playtime trend + weekly heatmap on the right.
 */
export function GameActivityPlaytimeView({
  stats,
  playtimeChartData,
  filteredSessions,
  sessionsWithHw,
  timeframe,
  playtimeAgg,
  onAggChange,
  playtimeChartStyle,
  onStyleChange,
  isolatedSessionIndex,
  setIsolatedSessionIndex,
  onRequestDelete,
}: GameActivityPlaytimeViewProps) {
  const { t, language } = useLanguage();

  const timeframeDays = timeframe === "7d" ? 7 : timeframe === "30d" ? 30 : timeframe === "90d" ? 90 : 365;
  const timeframeLabel =
    timeframe === "all"
      ? t("activity.allTime")
      : t("gameActivity.lastDays", { count: timeframe === "7d" ? 7 : timeframe === "30d" ? 30 : 90 });
  const sessionCountLabel = t("gameActivity.sessionCount", {
    count: filteredSessions.length,
    s: filteredSessions.length > 1 ? "s" : "",
  });

  const trendLabel =
    stats.trendDirection === "up"
      ? t("activity.increasing")
      : stats.trendDirection === "down"
        ? t("activity.decreasing")
        : t("activity.flat");

  return (
    <div
      id="game-activity-panel-playtime"
      className="game-activity-view game-activity-view--playtime"
      role="tabpanel"
      aria-labelledby="game-activity-tab-playtime"
    >
      {/* View identity header — always tells you which sub-tab you're in */}
      <div className="game-activity-view-head">
        <span className="game-activity-view-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </span>
        <div className="game-activity-view-titles">
          <h2 className="game-activity-view-title">{t("activity.playtime")}</h2>
          <p className="game-activity-view-sub">{t("gameActivity.playtimeSubtitle")}</p>
        </div>
      </div>

      {/* Headline stats band */}
      <div className="game-activity-summary">
        <div className="game-activity-summary-zone game-activity-summary-zone--hero">
          <div className="game-activity-summary-head">
            <span className="game-activity-summary-glyph">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
            </span>
            <span className="game-activity-summary-label">{t("activity.totalPlaytime")}</span>
          </div>
          <div className="game-activity-summary-value">{formatPlayTime(stats.totalPlayTimeMin)}</div>
          <div className="game-activity-summary-meta">
            <span className={`game-activity-trend game-activity-trend--${stats.trendDirection}`}>
              {stats.trendDirection === "up" ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></svg>
              ) : stats.trendDirection === "down" ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6" /><polyline points="17 18 23 18 23 12" /></svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="5" y1="12" x2="19" y2="12" /></svg>
              )}
              {trendLabel}
            </span>
            <span className="game-activity-summary-sub">{timeframeLabel}</span>
          </div>
        </div>

        <div className="game-activity-summary-zone">
          <div className="game-activity-summary-head">
            <span className="game-activity-summary-glyph">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>
            </span>
            <span className="game-activity-summary-label">{t("activity.sessions")}</span>
          </div>
          <div className="game-activity-summary-value">{stats.totalSessions}</div>
          <div className="game-activity-summary-meta">
            <span className="game-activity-summary-sub">{t("gameActivity.activeDaysSub", { count: stats.activeDaysCount, s: stats.activeDaysCount === 1 ? "" : "s" })}</span>
          </div>
        </div>

        <div className="game-activity-summary-zone">
          <div className="game-activity-summary-head">
            <span className="game-activity-summary-glyph">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
            </span>
            <span className="game-activity-summary-label">{t("activity.avgSession")}</span>
          </div>
          <div className="game-activity-summary-value">{stats.avgSessionMin > 0 ? `${stats.avgSessionMin}m` : "—"}</div>
          <div className="game-activity-summary-meta">
            <span className="game-activity-summary-sub">{t("gameActivity.perSession")}</span>
          </div>
        </div>

        <div className="game-activity-summary-zone">
          <div className="game-activity-summary-head">
            <span className="game-activity-summary-glyph">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.45 1-1 1H4v2h16v-2h-5c-.55 0-1-.45-1-1v-2.34" /><path d="M12 2a6 6 0 0 1 6 6v5a6 6 0 0 1-6 6 6 6 0 0 1-6-6V8a6 6 0 0 1 6-6z" /></svg>
            </span>
            <span className="game-activity-summary-label">{t("activity.longestSession")}</span>
          </div>
          <div className="game-activity-summary-value">{stats.longestSessionMin > 0 ? formatPlayTime(stats.longestSessionMin) : "—"}</div>
          <div className="game-activity-summary-meta">
            <span className="game-activity-summary-sub">{t("gameActivity.singleSession")}</span>
          </div>
        </div>

        <div className="game-activity-summary-zone">
          <div className="game-activity-summary-head">
            <span className="game-activity-summary-glyph">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
            </span>
            <span className="game-activity-summary-label">{t("activity.currentStreak")}</span>
          </div>
          <div className="game-activity-summary-value">{stats.currentStreak > 0 ? `${stats.currentStreak}d` : "—"}</div>
          <div className="game-activity-summary-meta">
            {stats.bestStreak > 0 && <span className="game-activity-summary-sub">{t("gameActivity.bestStreakSub", { days: stats.bestStreak })}</span>}
          </div>
        </div>
      </div>

      {/* Two-column layout: insights + sessions | trend + heatmap */}
      <div className="game-activity-layout">
        <div className="game-activity-left-col">
          <section className="game-activity-section">
            <SectionHead
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
                </svg>
              }
              title={t("gameActivity.statsTitle")}
              sub={sessionCountLabel}
            />
            <div className="game-activity-stats-grid">
              <StatCard
                label={t("activity.bestStreak")}
                value={stats.bestStreak > 0 ? `${stats.bestStreak}d` : "—"}
                icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>}
              />
              <StatCard
                label={t("activity.trend")}
                value={trendLabel}
                icon={
                  stats.trendDirection === "up" ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></svg>
                  ) : stats.trendDirection === "down" ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6" /><polyline points="17 18 23 18 23 12" /></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12" /></svg>
                  )
                }
              />
              <StatCard
                label={t("activity.mostActiveDay")}
                value={stats.mostActiveDay}
                icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="3" y1="10" x2="21" y2="10" /></svg>}
              />
              <StatCard
                label={t("activity.activeDays")}
                value={stats.activeDaysCount}
                icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="3" y1="10" x2="21" y2="10" /></svg>}
              />
              <StatCard
                label={t("activity.firstSession")}
                value={stats.firstPlayed}
                icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="3" y1="10" x2="21" y2="10" /></svg>}
              />
              <StatCard
                label={t("activity.lastSession")}
                value={stats.lastPlayed}
                icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="3" y1="10" x2="21" y2="10" /></svg>}
              />
            </div>
          </section>

          {/* Recent sessions */}
          <section className="game-activity-sessions-panel">
            <SectionHead
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><polyline points="3 3 3 8 8 8" /><path d="M12 7v5l3 2" />
                </svg>
              }
              title={t("activity.recentSessions")}
              sub={sessionsWithHw.length > 0 ? t("gameActivity.sessionsHint") : undefined}
              tools={<span className="game-activity-sessions-count">{sessionCountLabel}</span>}
            />
            <div className="game-activity-sessions-list">
              {filteredSessions.map((session) => {
                const hwIndex = sessionsWithHw.findIndex((s) => s.id === session.id);
                const isSelected = isolatedSessionIndex === hwIndex && hwIndex !== -1;
                const hasHw = hwIndex !== -1;

                const formattedDate = new Date(session.date).toLocaleDateString(language, {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                });
                const startTimeStr = new Date(session.date).toLocaleTimeString(language, {
                  hour: "2-digit",
                  minute: "2-digit",
                });
                const endTimeStr = new Date(new Date(session.date).getTime() + session.durationMin * 60000).toLocaleTimeString(language, {
                  hour: "2-digit",
                  minute: "2-digit",
                });

                return (
                  <div
                    key={session.id}
                    className={`game-activity-session-card${isSelected ? " active" : ""}${hasHw ? " game-activity-session-card--selectable" : " game-activity-session-card--muted"}`}
                    onClick={() => {
                      if (hasHw) {
                        setIsolatedSessionIndex(isSelected ? null : hwIndex);
                      }
                    }}
                  >
                    <div className="game-activity-session-info">
                      <span className="game-activity-session-date">
                        {formattedDate}
                        {hasHw && (
                          <span className="game-activity-session-badge">{t("activity.telemetry")}</span>
                        )}
                      </span>
                      <span className="game-activity-session-time">{startTimeStr} — {endTimeStr}</span>
                    </div>
                    <span className="game-activity-session-duration">{formatPlayTime(session.durationMin)}</span>
                    {hasHw && (
                      <span className="game-activity-session-chevron" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
                      </span>
                    )}
                    <button
                      className="game-activity-session-delete-btn"
                      title={t("activity.deleteSessionBtn")}
                      aria-label={t("activity.deleteSessionBtn")}
                      onClick={(e) => {
                        e.stopPropagation();
                        onRequestDelete(session.id);
                      }}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <div className="game-activity-right-col">
          {/* Playtime trend chart */}
          <section className="game-activity-panel">
            <SectionHead
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" />
                </svg>
              }
              title={t("gameActivity.playtimeTitle")}
              sub={<span className="game-activity-section-value">{t("gameActivity.playtimeTotal", { total: formatPlayTime(stats.totalPlayTimeMin) })}</span>}
              tools={
                <>
                  <div className="game-activity-seg game-activity-seg--sm">
                    {(["AGG_DAY", "AGG_WEEK", "AGG_MONTH"] as const).map((agg) => (
                      <button
                        key={agg}
                        className={`game-activity-seg-btn${playtimeAgg === agg ? " active" : ""}`}
                        aria-pressed={playtimeAgg === agg}
                        onClick={() => onAggChange(agg)}
                      >
                        {agg === "AGG_DAY" ? t("activity.1d") : agg === "AGG_WEEK" ? t("activity.1w") : t("activity.1m")}
                      </button>
                    ))}
                  </div>
                  <div className="game-activity-seg game-activity-seg--sm game-activity-seg--icons">
                    <button
                      className={`game-activity-seg-btn${playtimeChartStyle === "bar" ? " active" : ""}`}
                      aria-pressed={playtimeChartStyle === "bar"}
                      onClick={() => onStyleChange("bar")}
                      title={t("activity.barChart")}
                      aria-label={t("activity.barChart")}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
                      </svg>
                    </button>
                    <button
                      className={`game-activity-seg-btn${playtimeChartStyle === "line" ? " active" : ""}`}
                      aria-pressed={playtimeChartStyle === "line"}
                      onClick={() => onStyleChange("line")}
                      title={t("activity.lineChart")}
                      aria-label={t("activity.lineChart")}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                      </svg>
                    </button>
                  </div>
                </>
              }
            />

            {playtimeChartData.data.length > 0 ? (
              playtimeChartStyle === "bar" ? (
                <BarChart
                  data={playtimeChartData.data}
                  labels={playtimeChartData.labels}
                  formatValue={formatPlayTime}
                  height={220}
                />
              ) : (
                <LineChart
                  series={[
                    { data: playtimeChartData.data, color: "var(--color-accent)", label: t("activity.playtime") }
                  ]}
                  labels={playtimeChartData.labels}
                  formatValue={formatPlayTime}
                  height={220}
                />
              )
            ) : (
              <div className="game-activity-chart-empty">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                </svg>
                <span>{t("activity.noPlaytimeData")}</span>
              </div>
            )}
          </section>

          {/* Weekly heatmap */}
          <section className="game-activity-panel">
            <SectionHead
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
                </svg>
              }
              title={t("gameActivity.weeklyActivity")}
              tools={<span className="game-activity-heatmap-range">{timeframeLabel}</span>}
            />
            <WeeklyHeatmap sessions={filteredSessions} timeframeDays={timeframeDays} />
          </section>
        </div>
      </div>
    </div>
  );
}

// ─── Stats Card Helper ────────────────────────────────────────────────────────
function StatCard({
  label,
  value,
  icon,
  className = "",
}: {
  label: string;
  value: string | number;
  icon: ReactNode;
  className?: string;
}) {
  return (
    <div className={`game-activity-stat-card ${className}`}>
      <span className="game-activity-stat-icon">{icon}</span>
      <span className="game-activity-stat-value">{value}</span>
      <span className="game-activity-stat-label">{label}</span>
    </div>
  );
}

// ─── Heatmap Subcomponent ─────────────────────────────────────────────────────
function WeeklyHeatmap({ sessions, timeframeDays = 365 }: { sessions: GameSession[]; timeframeDays?: number }) {
  const { t, language } = useLanguage();
  // Cell geometry must mirror the `.weekly-heatmap-grid` CSS
  // (grid-template-rows: repeat(7, 12px); gap: 3px) so the month
  // label strip lines up with the day columns below it.
  const CELL = 12;
  const GAP = 3;

  const cells = useMemo(() => {
    const list: { date: string; duration: number }[] = [];
    const dayMap = new Map<string, number>();

    sessions.forEach((s) => {
      if (s.date) {
        const key = s.date.slice(0, 10);
        dayMap.set(key, (dayMap.get(key) || 0) + s.durationMin);
      }
    });

    const start = new Date();
    start.setDate(start.getDate() - timeframeDays + 1);

    const cursor = new Date(start);
    for (let i = 0; i < timeframeDays; i++) {
      const dateStr = cursor.toISOString().slice(0, 10);
      list.push({
        date: dateStr,
        duration: dayMap.get(dateStr) || 0,
      });
      cursor.setDate(cursor.getDate() + 1);
    }

    return list;
  }, [sessions, timeframeDays]);

  const paddedCells = useMemo(() => {
    const list: ({ date: string; duration: number } | null)[] = [];
    if (cells.length === 0) return list;

    const firstDate = new Date(cells[0].date + "T00:00:00");
    const firstDayOfWeek = firstDate.getDay();

    for (let i = 0; i < firstDayOfWeek; i++) {
      list.push(null);
    }

    list.push(...cells);
    return list;
  }, [cells]);

  // Month labels sit above the grid, anchored to the first column of
  // each month. The offset accounts for leading padding cells that push
  // later columns to the right (columns flow top-to-bottom, 7 rows).
  const monthLabels = useMemo(() => {
    const list: { left: number; label: string }[] = [];
    if (cells.length === 0) return list;
    const padCount = paddedCells.filter((c) => c === null).length;
    let prevMonth = "";
    cells.forEach((c, i) => {
      const monthKey = c.date.slice(0, 7);
      if (monthKey !== prevMonth) {
        const col = Math.floor((padCount + i) / 7);
        list.push({
          left: col * (CELL + GAP),
          label: new Date(c.date + "T00:00:00").toLocaleDateString(language, { month: "short" }),
        });
        prevMonth = monthKey;
      }
    });
    return list;
  }, [cells, paddedCells, language]);

  const getIntensityClass = (minutes: number) => {
    if (minutes <= 0) return "weekly-heatmap-cell-empty";
    if (minutes < 15) return "weekly-heatmap-cell-low";
    if (minutes < 45) return "weekly-heatmap-cell-medium";
    if (minutes < 120) return "weekly-heatmap-cell-high";
    return "weekly-heatmap-cell-peak";
  };

  return (
    <div className="game-activity-heatmap">
      <div className="weekly-heatmap-container">
        <div className="weekly-heatmap-row-labels">
          <span className="weekly-heatmap-row-spacer" />
          <span>{t("activityDash.sun")}</span>
          <span>{t("activityDash.mon")}</span>
          <span>{t("activityDash.tue")}</span>
          <span>{t("activityDash.wed")}</span>
          <span>{t("activityDash.thu")}</span>
          <span>{t("activityDash.fri")}</span>
          <span>{t("activityDash.sat")}</span>
        </div>
        <div className="weekly-heatmap-scroll">
          <div className="weekly-heatmap-months" aria-hidden="true">
            {monthLabels.map((m) => (
              <span
                key={m.label + m.left}
                style={{ "--heatmap-label-left": `${m.left}px` } as React.CSSProperties}
              >
                {m.label}
              </span>
            ))}
          </div>
          <div className="weekly-heatmap-grid">
            {paddedCells.map((cell, index) => {
              if (!cell) {
                return <div key={`pad-${index}`} className="weekly-heatmap-cell weekly-heatmap-cell-padded" />;
              }
              return (
                <div
                  key={cell.date}
                  className={`weekly-heatmap-cell ${getIntensityClass(cell.duration)}`}
                  title={`${new Date(cell.date).toLocaleDateString(language, { month: "short", day: "numeric", year: "numeric" })} : ${formatPlayTime(cell.duration)}`}
                />
              );
            })}
          </div>
        </div>
      </div>
      <div className="weekly-heatmap-footer">
        <span>{t("activityDash.less")}</span>
        <div className="weekly-heatmap-cell weekly-heatmap-cell-empty" />
        <div className="weekly-heatmap-cell weekly-heatmap-cell-low" />
        <div className="weekly-heatmap-cell weekly-heatmap-cell-medium" />
        <div className="weekly-heatmap-cell weekly-heatmap-cell-high" />
        <div className="weekly-heatmap-cell weekly-heatmap-cell-peak" />
        <span>{t("activityDash.more")}</span>
      </div>
    </div>
  );
}
