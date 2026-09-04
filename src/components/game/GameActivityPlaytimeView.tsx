import { useState, useMemo } from "react";
import { type GameSession, type Game, formatPlayTime, parsePlayTime } from "../../types/game";
import BarChart from "../charts/BarChart";
import LineChart from "../charts/LineChart";
import { useLanguage } from "../../context/LanguageContext";
import {
  SectionPanel,
  Segmented,
  StatBand,
  StatCell,
  RecordsStrip,
  Milestones,
  WeeklyHeatmap,
  TimeToBeatProgress,
  buildCumulativeSeries,
  buildGameCompletionProgress,
  calculateCompletionForecast,
  type PeriodComparison,
  type RecordItem,
  type MilestoneLadder,
} from "../activity";
import type { Stats, Timeframe, PlaytimeAggregation, PlaytimeChartStyle } from "./GameActivityShared";
import * as Icons from "../activity/Icons";

interface GameActivityPlaytimeViewProps {
  game: Game;
  stats: Stats;
  allSessions?: GameSession[];
  playtimeChartData: { data: number[]; labels: string[] };
  filteredSessions: GameSession[];
  timeframe: Timeframe;
  playtimeAgg: PlaytimeAggregation;
  onAggChange: (agg: PlaytimeAggregation) => void;
  playtimeChartStyle: PlaytimeChartStyle;
  onStyleChange: (style: PlaytimeChartStyle) => void;
  onNavigateToSessions?: () => void;
  comparison: PeriodComparison | null;
  records: RecordItem[];
  milestones: MilestoneLadder[];
}

export function GameActivityPlaytimeView({
  game,
  stats,
  allSessions,
  playtimeChartData,
  filteredSessions,
  timeframe,
  playtimeAgg,
  onAggChange,
  playtimeChartStyle,
  onStyleChange,
  onNavigateToSessions,
  comparison,
  records,
  milestones,
}: GameActivityPlaytimeViewProps) {
  const { t, language } = useLanguage();
  const [chartMode, setChartMode] = useState<"periodic" | "cumulative">("periodic");

  const timeframeDays = timeframe === "7d" ? 7 : timeframe === "30d" ? 30 : timeframe === "90d" ? 90 : 365;
  const timeframeLabel =
    timeframe === "all"
      ? t("activity.allTime")
      : t("gameActivity.lastDays", { count: timeframe === "7d" ? 7 : timeframe === "30d" ? 30 : 90 });

  const totalAllTimeMinutes = useMemo(() => {
    const fromSessions = (allSessions ?? filteredSessions).reduce((acc, s) => acc + s.durationMin, 0);
    const fromGame = game.playTime ? parsePlayTime(game.playTime) : 0;
    return Math.max(fromGame, fromSessions);
  }, [game.playTime, allSessions, filteredSessions]);

  const completionProgress = useMemo(() => {
    return buildGameCompletionProgress(totalAllTimeMinutes, game.timeToBeat);
  }, [totalAllTimeMinutes, game.timeToBeat]);

  const twoWeeksAgoMs = Date.now() - 14 * 86_400_000;
  const recentSessions = (allSessions ?? filteredSessions).filter(
    (s) => new Date(s.date).getTime() >= twoWeeksAgoMs,
  );
  const recentMinutes = recentSessions.reduce((acc, s) => acc + s.durationMin, 0);
  const recentWeeklyMinutes = Math.round(recentMinutes / 2);

  const forecast = useMemo(() => {
    return calculateCompletionForecast(totalAllTimeMinutes, game.timeToBeat, recentWeeklyMinutes);
  }, [totalAllTimeMinutes, game.timeToBeat, recentWeeklyMinutes]);

  const { startDate, endDate } = useMemo(() => {
    const today = new Date();
    const endStr = today.toISOString().slice(0, 10);
    const start = new Date(today);
    start.setDate(today.getDate() - (timeframeDays - 1));
    return { startDate: start.toISOString().slice(0, 10), endDate: endStr };
  }, [timeframeDays]);

  const aggKey = playtimeAgg === "AGG_MONTH" ? "month" : playtimeAgg === "AGG_WEEK" ? "week" : "day";

  const cumulativeSeries = useMemo(() => {
    return buildCumulativeSeries(filteredSessions, startDate, endDate, aggKey, language);
  }, [filteredSessions, startDate, endDate, aggKey, language]);

  return (
    <div id="game-activity-panel-playtime" role="tabpanel" className="act-stack">
      {/* Hero Stat Band */}
      <StatBand>
        <StatCell
          hero
          icon={<Icons.Clock size={15} />}
          label={t("activity.totalPlaytime")}
          value={formatPlayTime(stats.totalPlayTimeMin)}
          sub={timeframeLabel}
          delta={comparison?.playtime}
        />
        <StatCell
          icon={<Icons.Calendar size={15} />}
          label={t("activity.sessions")}
          value={stats.totalSessions}
          sub={t("gameActivity.activeDaysSub", { count: stats.activeDaysCount, s: stats.activeDaysCount === 1 ? "" : "s" })}
          delta={comparison?.sessions}
        />
        <StatCell
          icon={<Icons.Clock size={15} />}
          label={t("activity.avgSession")}
          value={stats.avgSessionMin > 0 ? `${stats.avgSessionMin}m` : "—"}
          sub={t("gameActivity.perSession")}
        />
        <StatCell
          icon={<Icons.Trophy size={15} />}
          label={t("activity.longestSession")}
          value={stats.longestSessionMin > 0 ? formatPlayTime(stats.longestSessionMin) : "—"}
        />
        <StatCell
          icon={<Icons.Zap size={15} />}
          label={t("activity.currentStreak")}
          value={stats.currentStreak > 0 ? `${stats.currentStreak}d` : "—"}
          sub={stats.bestStreak > 0 ? t("gameActivity.bestStreakSub", { days: stats.bestStreak }) : undefined}
        />
      </StatBand>

      {/* Completion & Pacing Forecast Section */}
      {completionProgress.hasTimeToBeat && (
        <SectionPanel
          icon={<Icons.Target size={14} />}
          title={t("gameActivity.ttb.title")}
          sub={t("gameActivity.ttb.subtitle")}
          tools={
            <div className="act-ttb-forecast-badges">
              {forecast.status === "completed" ? (
                <span className="act-ttb__status-badge act-ttb__status-badge--completionistComplete">
                  <Icons.Check size={11} /> {t("activityBacklog.storyCompleted")}
                </span>
              ) : forecast.estimatedDaysRemaining != null ? (
                <span className="act-ttb__status-badge act-ttb__status-badge--inProgress">
                  <Icons.Clock size={11} /> ~{forecast.estimatedDaysRemaining}d {t("activityBacklog.toFinish")} ({forecast.weeklyVelocityHours}h/{t("activity.1w")})
                </span>
              ) : (
                <span className={`act-ttb__status-badge act-ttb__status-badge--${completionProgress.status}`}>
                  {completionProgress.status === "mainStoryComplete"
                    ? t("gameActivity.ttb.statusMainDone")
                    : completionProgress.status === "inProgress"
                      ? t("gameActivity.ttb.statusInProgress")
                      : t("gameActivity.ttb.statusNotStarted")}
                </span>
              )}
            </div>
          }
        >
          <TimeToBeatProgress progress={completionProgress} showHeader={false} />
        </SectionPanel>
      )}

      {/* Records Strip & Milestones */}
      <RecordsStrip records={records} />
      <Milestones ladders={milestones} />

      {/* Main Playtime Chart & Weekly Heatmap */}
      <div className="act-cols">
        <SectionPanel
          icon={<Icons.TrendingUp size={14} />}
          title={t("gameActivity.playtimeTitle")}
          sub={t("gameActivity.playtimeTotal", { total: formatPlayTime(stats.totalPlayTimeMin) })}
          tools={
            <div className="act-panel-tools-row">
              <div className="act-chart-mode-toggle">
                <button
                  type="button"
                  className={`act-chart-mode-btn ${chartMode === "periodic" ? "active" : ""}`}
                  onClick={() => setChartMode("periodic")}
                >
                  {t("activityDash.modePeriodic")}
                </button>
                <button
                  type="button"
                  className={`act-chart-mode-btn ${chartMode === "cumulative" ? "active" : ""}`}
                  onClick={() => setChartMode("cumulative")}
                >
                  {t("activityDash.modeCumulative")}
                </button>
              </div>

              {chartMode === "periodic" && (
                <>
                  <Segmented<PlaytimeAggregation>
                    size="sm"
                    ariaLabel={t("activity.interval")}
                    value={playtimeAgg}
                    onChange={onAggChange}
                    options={[
                      { value: "AGG_DAY", label: t("activity.1d") },
                      { value: "AGG_WEEK", label: t("activity.1w") },
                      { value: "AGG_MONTH", label: t("activity.1m") },
                    ]}
                  />
                  <Segmented<PlaytimeChartStyle>
                    size="sm"
                    ariaLabel={t("activity.barChart")}
                    value={playtimeChartStyle}
                    onChange={onStyleChange}
                    options={[
                      { value: "bar", label: <Icons.BarChart3 size={13} />, title: t("activity.barChart") },
                      { value: "line", label: <Icons.TrendingUp size={13} />, title: t("activity.lineChart") },
                    ]}
                  />
                </>
              )}
            </div>
          }
        >
          {filteredSessions.length > 0 ? (
            chartMode === "cumulative" ? (
              <LineChart
                series={[
                  {
                    data: cumulativeSeries.map((p) => p.cumulativeHours),
                    color: "var(--color-brand-teal)",
                    label: t("activityDash.cumulativeHours"),
                  },
                ]}
                labels={cumulativeSeries.map((p) => p.label)}
                formatValue={(v) => `${v}h`}
                height={240}
                legend={false}
                smooth
              />
            ) : playtimeChartStyle === "bar" ? (
              <BarChart
                data={playtimeChartData.data.map((m) => Math.round((m / 60) * 10) / 10)}
                labels={playtimeChartData.labels}
                formatValue={(v) => `${v}h`}
                height={240}
              />
            ) : (
              <LineChart
                series={[
                  {
                    data: playtimeChartData.data.map((m) => Math.round((m / 60) * 10) / 10),
                    color: "var(--color-accent)",
                    label: t("activity.playtime"),
                  },
                ]}
                labels={playtimeChartData.labels}
                formatValue={(v) => `${v}h`}
                height={240}
                smooth
              />
            )
          ) : (
            <div className="act-empty act-empty--compact">
              <div className="act-empty__icon">
                <Icons.Clock size={18} />
              </div>
              <div className="act-empty__title">{t("activity.noPlaytimeData")}</div>
            </div>
          )}
        </SectionPanel>

        <SectionPanel
          icon={<Icons.CalendarRange size={14} />}
          title={t("gameActivity.weeklyActivity")}
          tools={<span className="act-panel__sub">{timeframeLabel}</span>}
        >
          <WeeklyHeatmap sessions={filteredSessions} timeframeDays={timeframeDays} />
        </SectionPanel>
      </div>

      {/* Jump to Full Session Log Banner */}
      {filteredSessions.length > 0 && onNavigateToSessions && (
        <div className="act-jump-banner">
          <div className="act-jump-banner__info">
            <Icons.History size={16} />
            <div>
              <span className="act-jump-banner__title">
                {t("gameActivity.sessionLogBannerTitle", { count: filteredSessions.length })}
              </span>
              <span className="act-jump-banner__sub">
                {t("gameActivity.sessionLogBannerSub")}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="act-inspector-btn act-inspector-btn--secondary"
            onClick={onNavigateToSessions}
          >
            <Icons.Maximize2 size={12} /> {t("gameActivity.viewSessionLog")}
          </button>
        </div>
      )}
    </div>
  );
}
