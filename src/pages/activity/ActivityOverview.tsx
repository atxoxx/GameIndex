import { useMemo } from "react";
import {
  Calendar,
  Clock,
  Gamepad2,
  Plus,
  Target,
  TrendingUp,
  Zap,
} from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import type { Game, GameSession } from "../../types/game";
import { formatPlayTime } from "../../types/game";
import PageWidget from "../../components/PageWidget";
import { Button, Panel, StatBand, type StatBandItem } from "../../components/ui";
import DonutChart from "../../components/charts/DonutChart";
import {
  BacklogCompletionHub,
  DayOfWeekDistribution,
  GamerPersonaCard,
  Milestones,
  RecordsStrip,
  SessionLengthDistribution,
  TimeOfDayDistribution,
  WeeklyHeatmap,
  buildDayOfWeekDistribution,
  buildGamerPersona,
  buildMilestoneLadders,
  buildRecords,
  buildSessionLengthDistribution,
  buildTimeOfDayDistribution,
} from "../../components/activity";
import { computeDelta, type Delta } from "../../components/activity/insights";
import { ActivityGameRail } from "../../components/activity/ActivityGameRail";
import { ActivityGoalRing } from "../../components/activity/ActivityGoalRing";
import { ActivityLiveStrip } from "../../components/activity/ActivityLiveStrip";
import { ActivityPlaytimeChart, type PlaytimeChartMode, type PlaytimeChartStyle } from "../../components/activity/ActivityPlaytimeChart";
import { ActivityValueCard } from "../../components/activity/ActivityValueCard";
import type { ActivityGameSummary } from "../../utils/activity/scoping";
import type { ActivityRange } from "../../utils/activity/range";
import { rangeDayCount } from "../../utils/activity/range";
import { buildRangeComparison } from "../../utils/activity/comparison";
import { longestDayStreak, sessionDayKey } from "../../utils/activity/sessionTime";
import type { PlaytimeAggregation } from "../../utils/activity/chartSeries";
import type { WeeklyGoalProgress } from "../../utils/activity/weeklyGoal";

export interface ActivityOverviewProps {
  /** Range + source scoped sessions (all games in the scope). */
  sessions: GameSession[];
  /** Every session, unfiltered, for all-time backlog progress. */
  allSessions: GameSession[];
  /** Range + source + game scoped sessions. */
  scopedSessions: GameSession[];
  games: Game[];
  range: ActivityRange;
  gameSummaries: ActivityGameSummary[];
  selectedGameId: string | null;
  selectedGameName?: string;
  railCollapsed: boolean;
  onToggleRail: () => void;
  aggregation: PlaytimeAggregation;
  onAggregationChange: (value: PlaytimeAggregation) => void;
  chartStyle: PlaytimeChartStyle;
  onChartStyleChange: (value: PlaytimeChartStyle) => void;
  chartMode: PlaytimeChartMode;
  onChartModeChange: (value: PlaytimeChartMode) => void;
  goal: {
    progress: WeeklyGoalProgress;
    setTarget: (minutes: number) => void;
    clear: () => void;
  };
  onSelectGame: (gameId: string | null) => void;
  onOpenGame: (gameId: string) => void;
  onLaunchGame: (gameId: string) => void;
  onRequestDeleteGame: (gameId: string, name: string) => void;
  onRequestLink: (gameId: string, name: string) => void;
  onRequestAdd: (gameId: string, name: string) => void;
  onLogSession: () => void;
}

function DeltaNote({ delta, label }: { delta?: Delta | null; label: string }) {
  if (!delta) return null;
  const arrow = delta.direction === "up" ? "▲" : delta.direction === "down" ? "▼" : "•";
  return (
    <span className={`activity-delta activity-delta--${delta.direction}`}>
      {arrow} {delta.pct}%
      <span className="activity-delta__label">{label}</span>
    </span>
  );
}

/**
 * Trend first: live state, the period figures, the playtime curve and the
 * game rail. Records, persona, backlog and breakdown follow in descending
 * importance so the first screen answers the scanning questions.
 */
export function ActivityOverview({
  sessions,
  allSessions,
  scopedSessions,
  games,
  range,
  gameSummaries,
  selectedGameId,
  selectedGameName,
  railCollapsed,
  onToggleRail,
  aggregation,
  onAggregationChange,
  chartStyle,
  onChartStyleChange,
  chartMode,
  onChartModeChange,
  goal,
  onSelectGame,
  onOpenGame,
  onLaunchGame,
  onRequestDeleteGame,
  onRequestLink,
  onRequestAdd,
  onLogSession,
}: ActivityOverviewProps) {
  const { t, language } = useLanguage();
  const days = rangeDayCount(range);
  const hasData = scopedSessions.length > 0;
  const gameById = useMemo(() => new Map(games.map((game) => [game.id, game])), [games]);

  const comparison = useMemo(
    () => buildRangeComparison(scopedSessions, range),
    [scopedSessions, range],
  );

  const stats = useMemo(() => {
    const totalMinutes = scopedSessions.reduce((sum, session) => sum + session.durationMin, 0);
    const activeDays = new Set(scopedSessions.map((session) => sessionDayKey(session)));
    return {
      totalMinutes,
      games: new Set(scopedSessions.map((session) => session.gameId)).size,
      sessions: scopedSessions.length,
      avgPerDay: Math.round(totalMinutes / Math.max(1, days)),
      longestStreak: longestDayStreak(activeDays),
      activeDays: activeDays.size,
    };
  }, [scopedSessions, days]);

  const avgDelta = useMemo(() => {
    if (!comparison) return null;
    return computeDelta(comparison.current.avgPerDay, comparison.previous.avgPerDay);
  }, [comparison]);

  const records = useMemo(
    () =>
      buildRecords({
        sessions: scopedSessions,
        games,
        language,
        scope: selectedGameId ? "game" : "all",
      }),
    [scopedSessions, games, language, selectedGameId],
  );

  const milestones = useMemo(
    () => buildMilestoneLadders(scopedSessions, selectedGameId ? "game" : "all"),
    [scopedSessions, selectedGameId],
  );

  const persona = useMemo(() => buildGamerPersona(sessions, games), [sessions, games]);

  const timeOfDay = useMemo(() => buildTimeOfDayDistribution(scopedSessions), [scopedSessions]);
  const sessionLengths = useMemo(
    () => buildSessionLengthDistribution(scopedSessions),
    [scopedSessions],
  );
  const dayOfWeek = useMemo(
    () => buildDayOfWeekDistribution(scopedSessions, language),
    [scopedSessions, language],
  );

  const platformSlices = useMemo(() => {
    const byPlatform = new Map<string, number>();
    for (const session of scopedSessions) {
      const platform = gameById.get(session.gameId)?.platform || "Local";
      byPlatform.set(platform, (byPlatform.get(platform) || 0) + session.durationMin);
    }
    return Array.from(byPlatform.entries()).map(([label, minutes]) => ({
      label,
      value: Math.round((minutes / 60) * 10) / 10,
      color: "",
    }));
  }, [scopedSessions, gameById]);

  const genreSlices = useMemo(() => {
    const byGenre = new Map<string, number>();
    for (const session of scopedSessions) {
      const game = gameById.get(session.gameId);
      const genres = game?.genres?.length ? game.genres : [t("splash.unknown")];
      for (const genre of genres) {
        byGenre.set(genre, (byGenre.get(genre) || 0) + session.durationMin);
      }
    }
    return Array.from(byGenre.entries())
      .map(([label, minutes]) => ({
        label,
        value: Math.round((minutes / 60) * 10) / 10,
        color: "",
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [scopedSessions, gameById, t]);

  const statItems: StatBandItem[] = [
    {
      id: "playtime",
      icon: <Clock size={15} />,
      label: t("activityDash.totalPlaytime"),
      value: formatPlayTime(stats.totalMinutes),
      detail: (
        <DeltaNote
          delta={comparison?.playtime}
          label={t("activityWs.overview.vsPrevious")}
        />
      ),
    },
    {
      id: "games",
      icon: <Gamepad2 size={15} />,
      label: t("activityDash.gamesPlayed"),
      value: stats.games,
      detail: (
        <DeltaNote delta={comparison?.games} label={t("activityWs.overview.vsPrevious")} />
      ),
    },
    {
      id: "average",
      icon: <TrendingUp size={15} />,
      label: t("activityDash.averagePerDay"),
      value: formatPlayTime(stats.avgPerDay),
      detail: <DeltaNote delta={avgDelta} label={t("activityWs.overview.vsPrevious")} />,
    },
    {
      id: "sessions",
      icon: <Calendar size={15} />,
      label: t("activityDash.sessions"),
      value: stats.sessions,
      detail: (
        <DeltaNote delta={comparison?.sessions} label={t("activityWs.overview.vsPrevious")} />
      ),
    },
    {
      id: "streak",
      icon: <Zap size={15} />,
      label: t("activityDash.longestStreak"),
      value: stats.longestStreak > 0 ? `${stats.longestStreak}d` : "—",
      detail: (
        <span className="activity-delta activity-delta--muted">
          {stats.activeDays} {t("activity.activeDays").toLowerCase()}
        </span>
      ),
    },
  ];

  const heatmapDays = Math.min(365, days);

  return (
    <div className="activity-overview">
      <PageWidget page="activity" widget="activityKpis">
        <div className="ui-item-activityKpis">
          <ActivityLiveStrip onOpenGame={onOpenGame} />
          <div className="activity-kpis">
            <StatBand items={statItems} ariaLabel={t("activity.title")} />
            <ActivityGoalRing
              progress={goal.progress}
              setTarget={goal.setTarget}
              clear={goal.clear}
            />
          </div>
        </div>
      </PageWidget>

      <PageWidget page="activity" widget="activityChart">
        <div className={`ui-item-activityChart activity-overview__main${railCollapsed || gameSummaries.length === 0 ? " is-rail-collapsed" : ""}${gameSummaries.length === 0 ? " is-rail-hidden" : ""}`}>
          {gameSummaries.length > 0 && (
            <ActivityGameRail
              games={gameSummaries}
              selectedGameId={selectedGameId}
              collapsed={railCollapsed}
              onToggleCollapsed={onToggleRail}
              onSelect={onSelectGame}
              onOpenGame={onOpenGame}
              onLaunchGame={onLaunchGame}
              onRequestDelete={onRequestDeleteGame}
              onRequestLink={onRequestLink}
              onRequestAdd={onRequestAdd}
            />
          )}
          <ActivityPlaytimeChart
            sessions={scopedSessions}
            range={range}
            aggregation={aggregation}
            onAggregationChange={onAggregationChange}
            style={chartStyle}
            onStyleChange={onChartStyleChange}
            mode={chartMode}
            onModeChange={onChartModeChange}
            title={
              selectedGameId
                ? t("activityWs.overview.gameChartTitle", {
                    game: selectedGameName ?? t("activityDash.unknownGame"),
                  })
                : t("activityWs.overview.chartTitle")
            }
            emptyAction={
              <Button
                variant="primary"
                size="sm"
                leftIcon={<Plus size={13} />}
                onClick={onLogSession}
              >
                {t("activityManual.logSessionBtn")}
              </Button>
            }
          />
        </div>
      </PageWidget>

      {hasData && (
        <>
          <PageWidget page="activity" widget="activityInsights">
        <div className="ui-item-activityInsights activity-overview__insights">
          <Panel
            heading={t("activityInsights.timeOfDayTitle")}
            icon={<Clock size={15} />}
          >
            <TimeOfDayDistribution distribution={timeOfDay} compact />
          </Panel>
          <Panel
            heading={t("activityInsights.sessionLengthsTitle")}
            icon={<Target size={15} />}
          >
            <SessionLengthDistribution
              buckets={sessionLengths.buckets}
              averageMinutes={sessionLengths.averageMinutes}
              longestMinutes={sessionLengths.longestMinutes}
              totalSessions={sessionLengths.totalSessions}
            />
          </Panel>
          <Panel
            heading={t("activityInsights.dayOfWeekTitle")}
            icon={<Calendar size={15} />}
          >
            <DayOfWeekDistribution distribution={dayOfWeek} compact />
          </Panel>
        </div>
      </PageWidget>

      <PageWidget page="activity" widget="activityRecords">
        <div className="ui-item-activityRecords activity-overview__records">
          <RecordsStrip records={records} />
          <Milestones ladders={milestones} />
        </div>
      </PageWidget>

      {!selectedGameId && (
        <div className="activity-overview__lower">
          <div className="activity-overview__lower-side">
            <PageWidget page="activity" widget="activityPersona">
              <div className="ui-item-activityPersona activity-overview__persona">
                <GamerPersonaCard persona={persona} />
              </div>
            </PageWidget>
            <PageWidget page="activity" widget="activityValue">
              <div className="ui-item-activityValue activity-overview__value">
                <ActivityValueCard games={games} />
              </div>
            </PageWidget>
          </div>
          <PageWidget page="activity" widget="activityBacklog">
            <div className="ui-item-activityBacklog activity-overview__backlog">
              <BacklogCompletionHub
                games={games}
                sessions={allSessions}
                onLaunchGame={(game: Game) => onLaunchGame(game.id)}
              />
            </div>
          </PageWidget>
        </div>
      )}

      <PageWidget page="activity" widget="activityBreakdown">
        <div className="ui-item-activityBreakdown activity-overview__breakdown">
          <Panel heading={t("activityDash.platformBreakdown")}>
            {platformSlices.length > 0 ? (
              <DonutChart
                slices={platformSlices}
                size={168}
                formatValue={(value) => `${Math.round(value * 10) / 10}h`}
              />
            ) : (
              <p className="activity-panel-empty">{t("activityDash.noPlatformData")}</p>
            )}
          </Panel>
          <Panel heading={t("activityDash.playtimeByGenre")}>
            {genreSlices.length > 0 ? (
              <DonutChart
                slices={genreSlices}
                size={168}
                formatValue={(value) => `${Math.round(value * 10) / 10}h`}
              />
            ) : (
              <p className="activity-panel-empty">{t("activityDash.noGenreData")}</p>
            )}
          </Panel>
          <Panel
            className="activity-overview__heatmap"
            heading={t("activityDash.weeklyHeatmap")}
            icon={<Calendar size={15} />}
          >
            <WeeklyHeatmap
              sessions={scopedSessions}
              timeframeDays={heatmapDays}
              endDate={range.endDate}
            />
          </Panel>
        </div>
      </PageWidget>
        </>
      )}
    </div>
  );
}

export default ActivityOverview;
