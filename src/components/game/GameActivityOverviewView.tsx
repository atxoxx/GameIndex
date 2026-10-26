import { useMemo } from "react";
import { CalendarRange, Target, TrendingUp } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { parsePlayTime, type Game, type GameSession } from "../../types/game";import { Panel } from "../ui";
import {
  Milestones,
  RecordsStrip,
  TimeToBeatProgress,
  WeeklyHeatmap,
  buildGameCompletionProgress,
  buildMilestoneLadders,
  buildRecords,
  calculateCompletionForecast,
} from "../activity";
import { ActivityPlaytimeChart, type PlaytimeChartMode, type PlaytimeChartStyle } from "../activity/ActivityPlaytimeChart";
import type { ActivityRange } from "../../utils/activity/range";
import { rangeDayCount } from "../../utils/activity/range";
import type { PlaytimeAggregation } from "../../utils/activity/chartSeries";

export interface GameActivityOverviewViewProps {
  game: Game;
  sessions: GameSession[];
  allSessions: GameSession[];
  range: ActivityRange;
  rangeLabel: string;
  aggregation: PlaytimeAggregation;
  onAggregationChange: (value: PlaytimeAggregation) => void;
  chartStyle: PlaytimeChartStyle;
  onChartStyleChange: (value: PlaytimeChartStyle) => void;
  chartMode: PlaytimeChartMode;
  onChartModeChange: (value: PlaytimeChartMode) => void;
}

/** A single game's trend-first overview: curve, completion pacing, rhythm. */
export function GameActivityOverviewView({
  game,
  sessions,
  allSessions,
  range,
  rangeLabel,
  aggregation,
  onAggregationChange,
  chartStyle,
  onChartStyleChange,
  chartMode,
  onChartModeChange,
}: GameActivityOverviewViewProps) {
  const { t, language } = useLanguage();
  const days = Math.min(365, rangeDayCount(range));

  const totalAllTimeMinutes = useMemo(() => {
    const fromSessions = allSessions.reduce((sum, session) => sum + session.durationMin, 0);
    return Math.max(game.playTime ? parsePlayTime(game.playTime) : 0, fromSessions);
  }, [allSessions, game.playTime]);

  const completion = useMemo(
    () => buildGameCompletionProgress(totalAllTimeMinutes, game.timeToBeat),
    [totalAllTimeMinutes, game.timeToBeat],
  );

  const forecast = useMemo(() => {
    const twoWeeksAgo = Date.now() - 14 * 86_400_000;
    const recentMinutes = allSessions
      .filter((session) => new Date(session.date).getTime() >= twoWeeksAgo)
      .reduce((sum, session) => sum + session.durationMin, 0);
    return calculateCompletionForecast(
      totalAllTimeMinutes,
      game.timeToBeat,
      Math.round(recentMinutes / 2),
    );
  }, [allSessions, game.timeToBeat, totalAllTimeMinutes]);

  const records = useMemo(
    () => buildRecords({ sessions, games: [game], language, scope: "game" }),
    [sessions, game, language],
  );
  const milestones = useMemo(() => buildMilestoneLadders(allSessions, "game"), [allSessions]);

  return (
    <div className="activity-game-overview">
      <ActivityPlaytimeChart
        sessions={sessions}
        range={range}
        aggregation={aggregation}
        onAggregationChange={onAggregationChange}
        style={chartStyle}
        onStyleChange={onChartStyleChange}
        mode={chartMode}
        onModeChange={onChartModeChange}
        title={t("activityWs.overview.chartTitle")}
        height={228}
      />

      <div className="activity-game-overview__side">
        {completion.hasTimeToBeat && (
          <Panel
            heading={t("gameActivity.ttb.title")}
            icon={<Target size={15} />}
            actions={
              forecast.status === "completed" ? (
                <span className="activity-chip activity-chip--success">
                  {t("activityBacklog.storyCompleted")}
                </span>
              ) : forecast.estimatedDaysRemaining != null ? (
                <span className="activity-chip">
                  <TrendingUp size={11} />
                  {t("activityWs.gameTab.forecast", {
                    days: forecast.estimatedDaysRemaining,
                  })}
                </span>
              ) : undefined
            }
          >
            <TimeToBeatProgress progress={completion} showHeader={false} />
          </Panel>
        )}

        <Panel
          heading={t("gameActivity.weeklyActivity")}
          icon={<CalendarRange size={15} />}
          actions={<span className="activity-panel-meta">{rangeLabel}</span>}
        >
          <WeeklyHeatmap
            sessions={sessions}
            timeframeDays={days}
            endDate={range.endDate}
          />
        </Panel>
      </div>

      <div className="activity-game-overview__records">
        <RecordsStrip records={records} />
        <Milestones ladders={milestones} />
      </div>
    </div>
  );
}

export default GameActivityOverviewView;
