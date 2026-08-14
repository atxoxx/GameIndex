import { useState, useMemo } from "react";
import { useLanguage } from "../../../context/LanguageContext";
import { Card } from "../../../components/ui";
import BarChart from "../../../components/charts/BarChart";
import DonutChart from "../../../components/charts/DonutChart";
import {
  formatHours,
  computeMonthlyTrend,
  computeWeeklyTrend,
  computeHabitMatrix,
  computeSessionLengthBuckets,
  computeLibraryHealth,
  computePerformanceStats,
} from "../statsCalculations";
import type { Game, GameSession } from "../statsTypes";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const HEALTH_COLORS = [
  "var(--color-text-muted)",
  "var(--color-info)",
  "var(--color-success)",
  "var(--color-accent)",
];

interface TrendsTabProps {
  sessions: GameSession[];
  games: Game[];
}

export function TrendsTab({ sessions, games }: TrendsTabProps) {
  const { t } = useLanguage();
  const [trendHorizon, setTrendHorizon] = useState<"6m" | "12m" | "8w">("6m");

  // Trends calculation
  const monthlyTrend6 = useMemo(() => computeMonthlyTrend(sessions, 6), [sessions]);
  const monthlyTrend12 = useMemo(() => computeMonthlyTrend(sessions, 12), [sessions]);
  const weeklyTrend = useMemo(() => computeWeeklyTrend(sessions, 8), [sessions]);

  const activeTrendData = useMemo(() => {
    if (trendHorizon === "6m") {
      return {
        data: monthlyTrend6.map((m) => Math.round((m.minutes / 60) * 10) / 10),
        labels: monthlyTrend6.map((m) => m.label),
        color: "var(--color-accent)",
        unit: "h",
      };
    }
    if (trendHorizon === "12m") {
      return {
        data: monthlyTrend12.map((m) => Math.round((m.minutes / 60) * 10) / 10),
        labels: monthlyTrend12.map((m) => m.label),
        color: "var(--color-info)",
        unit: "h",
      };
    }
    return {
      data: weeklyTrend.map((w) => Math.round((w.minutes / 60) * 10) / 10),
      labels: weeklyTrend.map((w) => w.label),
      color: "var(--color-success)",
      unit: "h",
    };
  }, [trendHorizon, monthlyTrend6, monthlyTrend12, weeklyTrend]);

  // Habit matrix (7 days x 24 hours)
  const habitMatrix = useMemo(() => computeHabitMatrix(sessions), [sessions]);

  // Session length buckets
  const sessionBuckets = useMemo(() => computeSessionLengthBuckets(sessions), [sessions]);

  // Library health
  const libraryHealth = useMemo(() => computeLibraryHealth(games, sessions), [games, sessions]);
  const healthSlices = useMemo(() => [
    { label: t("stats.health.unplayed"), value: libraryHealth.unplayed, color: HEALTH_COLORS[0] },
    { label: t("stats.health.inProgress"), value: libraryHealth.inProgress, color: HEALTH_COLORS[1] },
    { label: t("stats.health.completed"), value: libraryHealth.completed, color: HEALTH_COLORS[2] },
    { label: t("stats.health.mastered"), value: libraryHealth.mastered, color: HEALTH_COLORS[3] },
  ], [libraryHealth, t]);

  // Performance telemetry
  const performance = useMemo(() => computePerformanceStats(sessions, games), [sessions, games]);

  return (
    <div className="stats-tab-trends">
      {/* ── Trend Progression Chart Card ─────────────────────────── */}
      <Card variant="surface" elevation="1" className="stats-trend-chart-card">
        <div className="stats-card-header stats-trend-header-row">
          <div>
            <h3>{t("stats.trend.playtimeOverTime")}</h3>
            <span className="stats-card-sub">{t("stats.trend.playtimeOverTimeDesc")}</span>
          </div>

          <div className="stats-trend-horizon-pills">
            <button
              type="button"
              className={`stats-trend-pill${trendHorizon === "6m" ? " active" : ""}`}
              onClick={() => setTrendHorizon("6m")}
            >
              {t("stats.trend.last6Months")}
            </button>
            <button
              type="button"
              className={`stats-trend-pill${trendHorizon === "12m" ? " active" : ""}`}
              onClick={() => setTrendHorizon("12m")}
            >
              {t("stats.trend.last12Months")}
            </button>
            <button
              type="button"
              className={`stats-trend-pill${trendHorizon === "8w" ? " active" : ""}`}
              onClick={() => setTrendHorizon("8w")}
            >
              {t("stats.trend.last8Weeks")}
            </button>
          </div>
        </div>

        <div className="stats-trend-chart-body">
          <BarChart
            data={activeTrendData.data}
            labels={activeTrendData.labels}
            height={220}
            color={activeTrendData.color}
            formatValue={(v) => `${v}${activeTrendData.unit}`}
          />
        </div>
      </Card>

      {/* ── 24/7 Gaming Habit Matrix ──────────────────────────────── */}
      <Card variant="surface" elevation="1" className="stats-habit-matrix-card">
        <div className="stats-card-header">
          <div>
            <h3>{t("stats.habit.title")}</h3>
            <span className="stats-card-sub">{t("stats.habit.desc")}</span>
          </div>
          <div className="stats-habit-legend">
            <span>{t("activityDash.less")}</span>
            {[0, 1, 2, 3, 4].map((l) => (
              <span key={l} className={`stats-habit-cell level-${l}`} />
            ))}
            <span>{t("activityDash.more")}</span>
          </div>
        </div>

        <div className="stats-habit-matrix-table-wrap">
          <div className="stats-habit-hours-header">
            <span className="stats-habit-day-spacer" />
            {Array.from({ length: 24 }).map((_, h) => (
              <span key={h} className="stats-habit-hour-lbl">
                {h % 3 === 0 ? `${h}h` : ""}
              </span>
            ))}
          </div>

          <div className="stats-habit-rows">
            {DAY_NAMES.map((dayName, dayIdx) => (
              <div key={dayName} className="stats-habit-row">
                <span className="stats-habit-day-name">{t(`communityExtras.weekday.${dayName.toLowerCase()}`)}</span>
                <div className="stats-habit-day-cells">
                  {Array.from({ length: 24 }).map((_, hour) => {
                    const cell = habitMatrix.cells.find((c) => c.dayIndex === dayIdx && c.hour === hour);
                    const minutes = cell?.minutes || 0;
                    const intensity = cell?.intensity || 0;
                    return (
                      <div
                        key={hour}
                        className={`stats-habit-cell level-${intensity}`}
                        title={`${t(`communityExtras.weekday.${dayName.toLowerCase()}`)} @ ${hour}:00 — ${formatHours(minutes)}`}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* ── Middle Row: Session Lengths & Library Health ──────────── */}
      <div className="stats-trends-split-grid">
        {/* Session Length Distribution */}
        <Card variant="surface" elevation="1" className="stats-card">
          <div className="stats-card-header">
            <div>
              <h3>{t("stats.sessionLengths.title")}</h3>
              <span className="stats-card-sub">{t("stats.sessionLengths.desc")}</span>
            </div>
          </div>

          <div className="stats-session-buckets-list">
            {sessionBuckets.map((bucket) => (
              <div key={bucket.key} className="stats-session-bucket-row">
                <div className="stats-session-bucket-left">
                  <span className="stats-session-bucket-name">{t(bucket.labelKey)}</span>
                  <span className="stats-session-bucket-range">{bucket.rangeKey}</span>
                </div>
                <div className="stats-session-bucket-track">
                  <div
                    className="stats-session-bucket-fill"
                    style={{ width: `${bucket.percentage}%`, background: bucket.color }}
                  />
                </div>
                <div className="stats-session-bucket-right">
                  <span className="stats-session-bucket-count">{bucket.count} ({bucket.percentage}%)</span>
                  <span className="stats-session-bucket-time">{formatHours(bucket.minutes)}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Library Health & Backlog */}
        <Card variant="surface" elevation="1" className="stats-card stats-library-health-card">
          <div className="stats-card-header">
            <div>
              <h3>{t("stats.health.title")}</h3>
              <span className="stats-card-sub">
                {t("stats.health.completionSummary", { rate: libraryHealth.completionRate, total: libraryHealth.total })}
              </span>
            </div>
          </div>

          <div className="stats-health-content">
            <div className="stats-health-donut-wrap">
              <DonutChart
                slices={healthSlices}
                size={180}
                innerRadius={50}
                formatValue={(v) => `${v} ${t("bigscreen.friends.games")}`}
              />
            </div>

            <div className="stats-health-stats-grid">
              <div className="stats-health-stat-box">
                <span className="stats-health-stat-val stats-health-val--completed">{libraryHealth.completed}</span>
                <span className="stats-health-stat-lbl">{t("stats.health.completed")}</span>
              </div>
              <div className="stats-health-stat-box">
                <span className="stats-health-stat-val stats-health-val--mastered">{libraryHealth.mastered}</span>
                <span className="stats-health-stat-lbl">{t("stats.health.mastered")}</span>
              </div>
              <div className="stats-health-stat-box">
                <span className="stats-health-stat-val stats-health-val--progress">{libraryHealth.inProgress}</span>
                <span className="stats-health-stat-lbl">{t("stats.health.inProgress")}</span>
              </div>
              <div className="stats-health-stat-box">
                <span className="stats-health-stat-val stats-health-val--unplayed">{libraryHealth.unplayed}</span>
                <span className="stats-health-stat-lbl">{t("stats.health.unplayed")}</span>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* ── Performance & Telemetry Radar ─────────────────────────── */}
      <Card variant="surface" elevation="1" className="stats-card stats-performance-card">
        <div className="stats-card-header">
          <div>
            <h3>{t("stats.perf.title")}</h3>
            <span className="stats-card-sub">
              {performance.metricsSessionCount > 0
                ? t("stats.perf.trackedSessions", { count: performance.metricsSessionCount })
                : t("stats.perf.noTelemetryYet")}
            </span>
          </div>
          {performance.avgFpsOverall > 0 && (
            <span className="stats-fps-overall-pill">
              ⚡ {performance.avgFpsOverall} FPS {t("stats.perf.avgFps")}
            </span>
          )}
        </div>

        <div className="stats-perf-grid">
          <div className="stats-perf-metric-box">
            <span className="stats-perf-icon">🖥️</span>
            <span className="stats-perf-val">{performance.avgFpsOverall > 0 ? `${performance.avgFpsOverall} FPS` : "—"}</span>
            <span className="stats-perf-lbl">{t("stats.perf.avgFps")}</span>
          </div>

          <div className="stats-perf-metric-box">
            <span className="stats-perf-icon">⚙️</span>
            <span className="stats-perf-val">{performance.avgCpuUsage > 0 ? `${performance.avgCpuUsage}%` : "—"}</span>
            <span className="stats-perf-lbl">{t("stats.perf.avgCpu")}</span>
          </div>

          <div className="stats-perf-metric-box">
            <span className="stats-perf-icon">🎮</span>
            <span className="stats-perf-val">{performance.avgGpuUsage > 0 ? `${performance.avgGpuUsage}%` : "—"}</span>
            <span className="stats-perf-lbl">{t("stats.perf.avgGpu")}</span>
          </div>

          <div className="stats-perf-metric-box">
            <span className="stats-perf-icon">🌡️</span>
            <span className="stats-perf-val">{performance.avgGpuTemp > 0 ? `${performance.avgGpuTemp}°C` : "—"}</span>
            <span className="stats-perf-lbl">{t("stats.perf.avgGpuTemp")}</span>
          </div>
        </div>

        {performance.smoothestGames.length > 0 && (
          <div className="stats-smoothest-games-section">
            <h4 className="stats-smoothest-title">{t("stats.perf.smoothestTitles")}</h4>
            <div className="stats-smoothest-grid">
              {performance.smoothestGames.map((g) => (
                <div key={g.gameName} className="stats-smoothest-card">
                  <div className="stats-smoothest-cover">
                    {g.coverArtUrl ? (
                      <img src={g.coverArtUrl} alt="" loading="lazy" />
                    ) : (
                      <div className="stats-smoothest-fallback">🎮</div>
                    )}
                  </div>
                  <div className="stats-smoothest-info">
                    <span className="stats-smoothest-name" title={g.gameName}>{g.gameName}</span>
                    <span className="stats-smoothest-fps">{g.avgFps} FPS</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
