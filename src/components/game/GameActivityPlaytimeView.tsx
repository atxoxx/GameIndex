import { useState } from "react";
import { type GameSession, type Game, formatPlayTime } from "../../types/game";
import BarChart from "../charts/BarChart";
import LineChart from "../charts/LineChart";
import { useLanguage } from "../../context/LanguageContext";
import type { TempUnit } from "../../context/SettingsContext";
import {
  SectionPanel,
  Segmented,
  StatBand,
  StatCell,
  RecordsStrip,
  Milestones,
  WeeklyHeatmap,
  GameThumbnail,
  type PeriodComparison,
  type RecordItem,
  type MilestoneLadder,
} from "../activity";
import type { Stats, Timeframe, PlaytimeAggregation, PlaytimeChartStyle } from "./GameActivityShared";
import { GameSessionDetail } from "./GameSessionDetail";
import * as Icons from "../activity/Icons";

interface GameActivityPlaytimeViewProps {
  game: Game;
  stats: Stats;
  playtimeChartData: { data: number[]; labels: string[] };
  filteredSessions: GameSession[];
  sessionsWithHw: GameSession[];
  timeframe: Timeframe;
  playtimeAgg: PlaytimeAggregation;
  onAggChange: (agg: PlaytimeAggregation) => void;
  playtimeChartStyle: PlaytimeChartStyle;
  onStyleChange: (style: PlaytimeChartStyle) => void;
  onRequestDelete: (sessionId: string) => void;
  comparison: PeriodComparison | null;
  records: RecordItem[];
  milestones: MilestoneLadder[];
  hasTemps: boolean;
  tempUnit: TempUnit;
}

export function GameActivityPlaytimeView({
  game,
  stats,
  playtimeChartData,
  filteredSessions,
  sessionsWithHw,
  timeframe,
  playtimeAgg,
  onAggChange,
  playtimeChartStyle,
  onStyleChange,
  onRequestDelete,
  comparison,
  records,
  milestones,
  hasTemps,
  tempUnit,
}: GameActivityPlaytimeViewProps) {
  const { t, language } = useLanguage();
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);

  const timeframeDays = timeframe === "7d" ? 7 : timeframe === "30d" ? 30 : timeframe === "90d" ? 90 : 365;
  const timeframeLabel =
    timeframe === "all"
      ? t("activity.allTime")
      : t("gameActivity.lastDays", { count: timeframe === "7d" ? 7 : timeframe === "30d" ? 30 : 90 });
  const sessionCountLabel = t("gameActivity.sessionCount", {
    count: filteredSessions.length,
    s: filteredSessions.length > 1 ? "s" : "",
  });

  return (
    <div id="game-activity-panel-playtime" role="tabpanel" className="act-stack">
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

      <RecordsStrip records={records} />
      <Milestones ladders={milestones} />

      <div className="act-cols">
        <SectionPanel
          icon={<Icons.TrendingUp size={14} />}
          title={t("gameActivity.playtimeTitle")}
          sub={t("gameActivity.playtimeTotal", { total: formatPlayTime(stats.totalPlayTimeMin) })}
          tools={
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
          }
        >
          {playtimeChartData.data.length > 0 ? (
            playtimeChartStyle === "bar" ? (
              <BarChart data={playtimeChartData.data} labels={playtimeChartData.labels} formatValue={formatPlayTime} height={240} />
            ) : (
              <LineChart
                series={[{ data: playtimeChartData.data, color: "var(--color-accent)", label: t("activity.playtime") }]}
                labels={playtimeChartData.labels}
                formatValue={formatPlayTime}
                height={240}
              />
            )
          ) : (
            <div className="act-empty act-empty--compact">
              <div className="act-empty__icon"><Icons.Clock size={18} /></div>
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

      <SectionPanel
        icon={<Icons.History size={14} />}
        title={t("activity.recentSessions")}
        sub={sessionsWithHw.length > 0 ? t("gameActivity.sessionsHint") : undefined}
        tools={<span className="act-panel__sub">{sessionCountLabel}</span>}
      >
        <div className="act-session-list">
          {filteredSessions.map((session) => {
            const hasHw = sessionsWithHw.some((s) => s.id === session.id);
            const isExpanded = expandedSessionId === session.id && hasHw;

            const formattedDate = new Date(session.date).toLocaleDateString(language, {
              weekday: "short",
              day: "numeric",
              month: "short",
            });
            const startTimeStr = new Date(session.date).toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" });
            const endTimeStr = new Date(new Date(session.date).getTime() + session.durationMin * 60000).toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" });

            return (
              <div
                key={session.id}
                className={`act-session-wrap${isExpanded ? " act-session-wrap--expanded" : ""}`}
              >
                <div
                  className={`act-session${isExpanded ? " act-session--active" : ""}${hasHw ? " act-session--selectable" : ""}`}
                  role={hasHw ? "button" : undefined}
                  tabIndex={hasHw ? 0 : undefined}
                  aria-expanded={hasHw ? isExpanded : undefined}
                  title={hasHw ? (isExpanded ? t("gameActivity.sessionDetail.collapse") : t("gameActivity.sessionDetail.expand")) : undefined}
                  onClick={() => {
                    if (hasHw) setExpandedSessionId(isExpanded ? null : session.id);
                  }}
                  onKeyDown={(e) => {
                    if (hasHw && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      setExpandedSessionId(isExpanded ? null : session.id);
                    }
                  }}
                >
                  <GameThumbnail
                    iconUrl={game.iconUrl}
                    coverArtUrl={game.coverArtUrl}
                    steamAppId={game.steamAppId}
                    name={session.gameName}
                    className="act-session__thumb"
                  />
                  <div className="act-session__info">
                    <span className="act-session__date">
                      {formattedDate}
                      {hasHw && <span className="act-session__badge">{t("activity.telemetry")}</span>}
                    </span>
                    <span className="act-session__time">{startTimeStr} — {endTimeStr}</span>
                  </div>
                  <span className="act-session__duration">{formatPlayTime(session.durationMin)}</span>
                  {hasHw && (
                    <span
                      className={`act-session__chevron${isExpanded ? " act-session__chevron--open" : ""}`}
                      aria-hidden="true"
                    >
                      <Icons.ChevronRight size={14} />
                    </span>
                  )}
                  <button
                    type="button"
                    className="act-session__delete"
                    title={t("activity.deleteSessionBtn")}
                    aria-label={t("activity.deleteSessionBtn")}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRequestDelete(session.id);
                    }}
                  >
                    <Icons.Trash2 size={13} />
                  </button>
                </div>

                {isExpanded && (
                  <GameSessionDetail session={session} tempUnit={tempUnit} hasTemps={hasTemps} />
                )}
              </div>
            );
          })}
        </div>
      </SectionPanel>
    </div>
  );
}
