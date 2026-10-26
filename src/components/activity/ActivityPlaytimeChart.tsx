import { useMemo } from "react";
import type { ReactNode } from "react";
import { BarChart3, TrendingUp } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import type { GameSession } from "../../types/game";
import { formatPlayTime } from "../../types/game";
import BarChart from "../charts/BarChart";
import LineChart from "../charts/LineChart";
import { Panel } from "../ui";import { ActivityViewSwitch } from "./ActivityViewSwitch";
import type { ActivityRange } from "../../utils/activity/range";
import {
  buildPlaytimeSeries,
  cumulativeHours,
  periodHours,
  type PlaytimeAggregation,
} from "../../utils/activity/chartSeries";

export type PlaytimeChartMode = "periodic" | "cumulative";
export type PlaytimeChartStyle = "bar" | "line";

export interface ActivityPlaytimeChartProps {
  sessions: GameSession[];
  range: ActivityRange;
  aggregation: PlaytimeAggregation;
  onAggregationChange: (value: PlaytimeAggregation) => void;
  style: PlaytimeChartStyle;
  onStyleChange: (value: PlaytimeChartStyle) => void;
  mode: PlaytimeChartMode;
  onModeChange: (value: PlaytimeChartMode) => void;
  title?: string;
  /** A quiet line under the title; defaults to the total in range. */
  subtitle?: string;
  height?: number;
  emptyTitle?: string;
  emptyHint?: string;
  /** Optional call to action shown in the empty chart (Log session). */
  emptyAction?: ReactNode;
}

/**
 * The playtime chart shared by the library overview and a game's overview.
 * It owns the series, the mode and the resolution control; the surrounding
 * page decides what sits beside it.
 */
export function ActivityPlaytimeChart({
  sessions,
  range,
  aggregation,
  onAggregationChange,
  style,
  onStyleChange,
  mode,
  onModeChange,
  title,
  subtitle,
  height = 248,
  emptyTitle,
  emptyHint,
  emptyAction,
}: ActivityPlaytimeChartProps) {
  const { t, language } = useLanguage();
  const points = useMemo(
    () => buildPlaytimeSeries(sessions, range, aggregation, language),
    [sessions, range, aggregation, language],
  );
  const totalMinutes = useMemo(
    () => points.reduce((sum, point) => sum + point.minutes, 0),
    [points],
  );
  const values = mode === "cumulative" ? cumulativeHours(points) : periodHours(points);
  const labels = points.map((point) => point.label);
  const hasData = totalMinutes > 0;

  return (
    <Panel
      className="activity-chart-card"
      heading={title ?? t("activityWs.overview.chartTitle")}
      icon={<TrendingUp size={15} />}
      actions={
        <span className="activity-chart-card__total">
          {formatPlayTime(totalMinutes)}
        </span>
      }
    >
      <p className="activity-chart-card__sub">
        {subtitle ?? t("activityWs.overview.chartSub", { time: formatPlayTime(totalMinutes) })}
      </p>

      <div className="activity-chart-card__tools">
        <ActivityViewSwitch<PlaytimeChartMode>
          ariaLabel={t("activityWs.overview.chartMode")}
          value={mode}
          onChange={onModeChange}
          items={[
            { id: "periodic", label: t("activityDash.modePeriodic") },
            { id: "cumulative", label: t("activityDash.modeCumulative") },
          ]}
        />

        <ActivityViewSwitch<PlaytimeAggregation>
          ariaLabel={t("activity.interval")}
          value={aggregation}
          onChange={onAggregationChange}
          items={[
            { id: "day", label: t("activityWs.overview.daily") },
            { id: "week", label: t("activityWs.overview.weekly") },
            { id: "month", label: t("activityWs.overview.monthly") },
          ]}
        />

        <div className="activity-chart-card__style" role="group" aria-label={t("activity.barChart")}>
          <button
            type="button"
            className={style === "bar" ? "is-active" : ""}
            aria-pressed={style === "bar"}
            aria-label={t("activity.barChart")}
            title={t("activity.barChart")}
            onClick={() => onStyleChange("bar")}
          >
            <BarChart3 size={14} />
          </button>
          <button
            type="button"
            className={style === "line" ? "is-active" : ""}
            aria-pressed={style === "line"}
            aria-label={t("activity.lineChart")}
            title={t("activity.lineChart")}
            onClick={() => onStyleChange("line")}
          >
            <TrendingUp size={14} />
          </button>
        </div>
      </div>

      <div className="activity-chart-card__body">
        {hasData ? (
          mode === "cumulative" || style === "line" ? (
            <LineChart
              series={[
                {
                  data: values,
                  color: "var(--color-accent)",
                  label:
                    mode === "cumulative"
                      ? t("activityDash.cumulativeHours")
                      : t("activityDash.playtimeHours"),
                },
              ]}
              labels={labels}
              formatValue={(value) => `${value}h`}
              height={height}
              legend={false}
              smooth
            />
          ) : (
            <BarChart
              data={values}
              labels={labels}
              formatValue={(value) => `${value}h`}
              height={height}
              color="var(--color-accent)"
            />
          )
        ) : (
          <div className="activity-chart-card__empty">
            <span className="activity-chart-card__empty-icon" aria-hidden="true">
              <BarChart3 size={22} />
            </span>
            <h3>{emptyTitle ?? t("activityWs.overview.emptyTitle")}</h3>
            <p>{emptyHint ?? t("activityWs.overview.emptyHint")}</p>
            {emptyAction}
          </div>
        )}
      </div>
    </Panel>
  );
}

export default ActivityPlaytimeChart;
