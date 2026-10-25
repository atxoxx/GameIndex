import { useMemo } from "react";
import {
  CalendarDays,
  CalendarRange,
  ChartColumn,
  Flame,
  Gamepad2,
  Monitor,
  Settings,
  Sparkles,
  Tag,
  Thermometer,
  Timer,
  Zap,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { Card } from "../../../components/ui";
import { usePersistedState } from "../../../hooks/usePersistedState";
import BarChart from "../../../components/charts/BarChart";
import DonutChart from "../../../components/charts/DonutChart";
import {
  buildHeatmap,
  classifyGamerPersona,
  computeLibraryHealth,
  computeMonthlyTrend,
  computePerformanceStats,
  computePersonalRecords,
  computeSessionLengthBuckets,
  computeStreaks,
  computeTimeOfDay,
  computeWeeklyTrend,
  formatHours,
} from "../statsCalculations";
import { PersonaIcon } from "../statsIcons";
import { HabitsMatrix } from "../insights/HabitsMatrix";
import type { Game, GameSession, TimeframePreset } from "../statsTypes";

const HEALTH_COLORS = [
  "var(--color-text-muted)",
  "var(--color-info)",
  "var(--color-success)",
  "var(--color-accent)",
];

type TrendHorizon = "6m" | "12m" | "8w";

interface InsightsTabProps {
  sessions: GameSession[];
  allSessions: GameSession[];
  games: Game[];
  range: TimeframePreset;
  onResetRange: () => void;
}

/**
 * Insights — everything that needs a chart or a record.
 *
 * The old Trends and Milestones tabs were two halves of the same question
 * ("how do I play?"), so they share one canvas: progression, habits, session
 * shape, library health, telemetry, records and playstyle.
 */
export function InsightsTab({ sessions, allSessions, games, range, onResetRange }: InsightsTabProps) {
  const { t } = useLanguage();
  const [horizon, setHorizon] = usePersistedState<TrendHorizon>(
    "gamelib.community.trends.horizon_v1",
    "6m",
    ["6m", "12m", "8w"]
  );

  const monthlyTrend6 = useMemo(() => computeMonthlyTrend(sessions, 6), [sessions]);
  const monthlyTrend12 = useMemo(() => computeMonthlyTrend(sessions, 12), [sessions]);
  const weeklyTrend = useMemo(() => computeWeeklyTrend(sessions, 8), [sessions]);

  const activeTrend = useMemo(() => {
    if (horizon === "12m") {
      return {
        data: monthlyTrend12.map((month) => Math.round((month.minutes / 60) * 10) / 10),
        labels: monthlyTrend12.map((month) => month.label),
        color: "var(--color-info)",
      };
    }
    if (horizon === "8w") {
      return {
        data: weeklyTrend.map((week) => Math.round((week.minutes / 60) * 10) / 10),
        labels: weeklyTrend.map((week) => week.label),
        color: "var(--color-success)",
      };
    }
    return {
      data: monthlyTrend6.map((month) => Math.round((month.minutes / 60) * 10) / 10),
      labels: monthlyTrend6.map((month) => month.label),
      color: "var(--color-accent)",
    };
  }, [horizon, monthlyTrend6, monthlyTrend12, weeklyTrend]);

  const sessionBuckets = useMemo(() => computeSessionLengthBuckets(sessions), [sessions]);  const libraryHealth = useMemo(() => computeLibraryHealth(games, sessions), [games, sessions]);
  const performance = useMemo(() => computePerformanceStats(sessions, games), [sessions, games]);

  const streak = useMemo(() => computeStreaks(sessions), [sessions]);
  const timeOfDay = useMemo(() => computeTimeOfDay(sessions), [sessions]);
  const heatmap = useMemo(() => buildHeatmap(sessions, 16), [sessions]);
  const genreBreakdown = useMemo(() => {
    const gameById = new Map(games.map((game) => [game.id, game]));
    const byGenre = new Map<string, number>();
    for (const session of sessions) {
      const genre = gameById.get(session.gameId)?.genres?.[0] || "Uncategorized";
      byGenre.set(genre, (byGenre.get(genre) || 0) + session.durationMin);
    }
    return Array.from(byGenre.entries())
      .map(([genre, minutes]) => ({ genre, minutes }))
      .sort((a, b) => b.minutes - a.minutes);
  }, [sessions, games]);

  const records = useMemo(
    () => computePersonalRecords(sessions, heatmap.cells, streak, genreBreakdown),
    [sessions, heatmap.cells, streak, genreBreakdown]
  );
  const persona = useMemo(
    () => classifyGamerPersona(sessions, games, genreBreakdown, timeOfDay),
    [sessions, games, genreBreakdown, timeOfDay]
  );

  const healthSlices = useMemo(
    () => [
      { label: t("stats.health.unplayed"), value: libraryHealth.unplayed, color: HEALTH_COLORS[0] },
      { label: t("stats.health.inProgress"), value: libraryHealth.inProgress, color: HEALTH_COLORS[1] },
      { label: t("stats.health.completed"), value: libraryHealth.completed, color: HEALTH_COLORS[2] },
      { label: t("stats.health.mastered"), value: libraryHealth.mastered, color: HEALTH_COLORS[3] },
    ],
    [libraryHealth, t]
  );

  const ranges: { id: TrendHorizon; label: string }[] = [
    { id: "6m", label: t("stats.trend.last6Months") },
    { id: "12m", label: t("stats.trend.last12Months") },
    { id: "8w", label: t("stats.trend.last8Weeks") },
  ];

  if (sessions.length === 0) {
    return (
      <div className="profile-insights">
        <div className="profile-empty profile-empty--page">
          <ChartColumn size={24} aria-hidden="true" />
          <h3>{t("profile.tab.insights")}</h3>
          <p>{range === "all" ? t("community.emptyMostPlayed") : t("profile.noSessionsInRange")}</p>
          {range !== "all" && (
            <button type="button" className="profile-link" onClick={onResetRange}>
              {t("activity.allTime")}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="profile-insights">
      {/* Progression */}
      <Card variant="surface" elevation="1" className="profile-card profile-trend">
        <div className="profile-card__head">
          <div>
            <h3>{t("stats.trend.playtimeOverTime")}</h3>
            <span className="profile-card__sub">{t("stats.trend.playtimeOverTimeDesc")}</span>
          </div>
          <div className="profile-segmented" role="group" aria-label={t("stats.timeframeLabel")}>
            {ranges.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`profile-segmented__pill${horizon === option.id ? " is-active" : ""}`}
                aria-pressed={horizon === option.id}
                onClick={() => setHorizon(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <BarChart
          data={activeTrend.data}
          labels={activeTrend.labels}
          height={230}
          color={activeTrend.color}
          formatValue={(value) => `${value}h`}
        />
      </Card>

      {/* Habits */}
      <HabitsMatrix sessions={sessions} />

      {/* Records */}
      <section className="profile-section" aria-label={t("stats.records.title")}>
        <div className="profile-section__head">
          <h2>{t("stats.records.title")}</h2>
        </div>
        <div className="profile-records">
          <div className="profile-record">
            <span className="profile-record__icon"><Timer size={18} aria-hidden="true" /></span>
            <span className="profile-record__label">{t("community.longestSession")}</span>
            <span className="profile-record__value">
              {records.longestSession ? formatHours(records.longestSession.minutes) : "—"}
            </span>
            <span className="profile-record__sub" title={records.longestSession?.gameName}>
              {records.longestSession?.gameName ?? ""}
            </span>
          </div>

          <div className="profile-record">
            <span className="profile-record__icon"><CalendarDays size={18} aria-hidden="true" /></span>
            <span className="profile-record__label">{t("communityExtras.bestDay")}</span>
            <span className="profile-record__value">
              {records.bestDay ? formatHours(records.bestDay.minutes) : "—"}
            </span>
            <span className="profile-record__sub">
              {records.bestDay
                ? records.bestDay.date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
                : ""}
            </span>
          </div>

          <div className="profile-record">
            <span className="profile-record__icon"><Flame size={18} aria-hidden="true" /></span>
            <span className="profile-record__label">{t("stats.records.longestStreak")}</span>
            <span className="profile-record__value">
              {records.longestStreak} {t("communityExtras.dayStreak")}
            </span>
            <span className="profile-record__sub">{t("stats.records.consecutiveDailyPlay")}</span>
          </div>

          <div className="profile-record">
            <span className="profile-record__icon"><CalendarRange size={18} aria-hidden="true" /></span>
            <span className="profile-record__label">{t("stats.records.peakMonth")}</span>
            <span className="profile-record__value">
              {records.mostActiveMonth ? formatHours(records.mostActiveMonth.minutes) : "—"}
            </span>
            <span className="profile-record__sub">{records.mostActiveMonth?.label ?? ""}</span>
          </div>

          <div className="profile-record">
            <span className="profile-record__icon"><Tag size={18} aria-hidden="true" /></span>
            <span className="profile-record__label">{t("communityExtras.topGenreLabel")}</span>
            <span className="profile-record__value">
              {records.mostPlayedGenre?.genre ?? "—"}
            </span>
            <span className="profile-record__sub">
              {records.mostPlayedGenre ? formatHours(records.mostPlayedGenre.minutes) : ""}
            </span>
          </div>

          <div className="profile-record">
            <span className="profile-record__icon"><Gamepad2 size={18} aria-hidden="true" /></span>
            <span className="profile-record__label">{t("community.gamesPlayed")}</span>
            <span className="profile-record__value">{records.totalGamesConquered}</span>
            <span className="profile-record__sub">{t("stats.records.distinctTitlesPlayed")}</span>
          </div>
        </div>
      </section>

      {/* Session shape + library health */}
      <div className="profile-insights__split">
        <Card variant="surface" elevation="1" className="profile-card">
          <div className="profile-card__head">
            <div>
              <h3>{t("stats.sessionLengths.title")}</h3>
              <span className="profile-card__sub">{t("stats.sessionLengths.desc")}</span>
            </div>
          </div>

          <div className="profile-buckets">
            {sessionBuckets.map((bucket) => (
              <div key={bucket.key} className="profile-bucket">
                <div className="profile-bucket__labels">
                  <span>{t(bucket.labelKey)}</span>
                  <span className="profile-bucket__range">{bucket.rangeKey}</span>
                </div>
                <div className="profile-bucket__track">
                  <span style={{ width: `${bucket.percentage}%`, background: bucket.color }} />
                </div>
                <div className="profile-bucket__values">
                  <span>{bucket.count} ({bucket.percentage}%)</span>
                  <span>{formatHours(bucket.minutes)}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card variant="surface" elevation="1" className="profile-card">
          <div className="profile-card__head">
            <div>
              <h3>{t("stats.health.title")}</h3>
              <span className="profile-card__sub">
                {t("stats.health.completionSummary", {
                  rate: libraryHealth.completionRate,
                  total: libraryHealth.total,
                })}
              </span>
            </div>
          </div>

          <div className="profile-health">
            <DonutChart
              slices={healthSlices}
              size={170}
              innerRadius={46}
              showLegend={false}
              formatValue={(value) => `${value} ${t("bigscreen.friends.games")}`}
            />
            <div className="profile-health__legend">
              <div className="profile-health__box">
                <span className="is-completed">{libraryHealth.completed}</span>
                <span>{t("stats.health.completed")}</span>
              </div>
              <div className="profile-health__box">
                <span className="is-mastered">{libraryHealth.mastered}</span>
                <span>{t("stats.health.mastered")}</span>
              </div>
              <div className="profile-health__box">
                <span className="is-progress">{libraryHealth.inProgress}</span>
                <span>{t("stats.health.inProgress")}</span>
              </div>
              <div className="profile-health__box">
                <span className="is-unplayed">{libraryHealth.unplayed}</span>
                <span>{t("stats.health.unplayed")}</span>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Performance */}
      <Card variant="surface" elevation="1" className="profile-card">
        <div className="profile-card__head">
          <div>
            <h3>{t("stats.perf.title")}</h3>
            <span className="profile-card__sub">
              {performance.metricsSessionCount > 0
                ? t("stats.perf.trackedSessions", { count: performance.metricsSessionCount })
                : t("stats.perf.noTelemetryYet")}
            </span>
          </div>
          {performance.avgFpsOverall > 0 && (
            <span className="profile-pill">
              <Zap size={13} aria-hidden="true" /> {performance.avgFpsOverall} FPS {t("stats.perf.avgFps")}
            </span>
          )}
        </div>

        <div className="profile-perf">
          <div className="profile-perf__box">
            <span className="profile-perf__icon"><Monitor size={16} aria-hidden="true" /></span>
            <span className="profile-perf__value">
              {performance.avgFpsOverall > 0 ? `${performance.avgFpsOverall} FPS` : "—"}
            </span>
            <span className="profile-perf__label">{t("stats.perf.avgFps")}</span>
          </div>
          <div className="profile-perf__box">
            <span className="profile-perf__icon"><Settings size={16} aria-hidden="true" /></span>
            <span className="profile-perf__value">
              {performance.avgCpuUsage > 0 ? `${performance.avgCpuUsage}%` : "—"}
            </span>
            <span className="profile-perf__label">{t("stats.perf.avgCpu")}</span>
          </div>
          <div className="profile-perf__box">
            <span className="profile-perf__icon"><Gamepad2 size={16} aria-hidden="true" /></span>
            <span className="profile-perf__value">
              {performance.avgGpuUsage > 0 ? `${performance.avgGpuUsage}%` : "—"}
            </span>
            <span className="profile-perf__label">{t("stats.perf.avgGpu")}</span>
          </div>
          <div className="profile-perf__box">
            <span className="profile-perf__icon"><Thermometer size={16} aria-hidden="true" /></span>
            <span className="profile-perf__value">
              {performance.avgGpuTemp > 0 ? `${performance.avgGpuTemp}°C` : "—"}
            </span>
            <span className="profile-perf__label">{t("stats.perf.avgGpuTemp")}</span>
          </div>
        </div>

        {performance.smoothestGames.length > 0 && (
          <div className="profile-smooth">
            <h4>{t("stats.perf.smoothestTitles")}</h4>
            <div className="profile-smooth__grid">
              {performance.smoothestGames.map((game) => (
                <div key={game.gameName} className="profile-smooth__card">
                  <span className="profile-smooth__cover">
                    {game.coverArtUrl ? (
                      <img src={game.coverArtUrl} alt="" loading="lazy" />
                    ) : (
                      <Gamepad2 size={16} aria-hidden="true" />
                    )}
                  </span>
                  <span className="profile-smooth__info">
                    <span className="profile-smooth__name" title={game.gameName}>{game.gameName}</span>
                    <span className="profile-smooth__fps">{game.avgFps} FPS</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Playstyle */}
      <section className="profile-section" aria-label={t("stats.persona.playstyleTitle")}>
        <div className="profile-section__head">
          <h2><Sparkles size={15} aria-hidden="true" /> {t("stats.persona.playstyleTitle")}</h2>
        </div>

        <Card variant="surface" elevation="1" className="profile-card profile-persona">
          <div className="profile-persona__head">
            <span className="profile-persona__badge">
              <PersonaIcon persona={persona} size={26} />
            </span>
            <div>
              <h3>{t(persona.titleKey)}</h3>
              <p>{t(persona.subtitleKey)}</p>
            </div>
          </div>

          <div className="profile-persona__traits">
            {persona.traits.map((trait) => (
              <div key={trait.nameKey} className="profile-trait">
                <div className="profile-trait__labels">
                  <span>{t(trait.nameKey)}</span>
                  <span>{trait.score} / 100</span>
                </div>
                <div className="profile-trait__track">
                  <span style={{ width: `${trait.score}%` }} />
                </div>
                <p>{t(trait.descriptionKey)}</p>
              </div>
            ))}
          </div>
        </Card>
      </section>

      {range !== "all" && allSessions.length !== sessions.length && (
        <p className="profile-note">{t("profile.insightsRangeNote")}</p>
      )}
    </div>
  );
}
