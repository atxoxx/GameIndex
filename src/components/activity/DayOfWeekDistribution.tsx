import { useMemo, useState } from "react";
import { formatPlayTime } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";
import type { DayOfWeekDistribution as DOWDistType } from "./insights";
import * as Icons from "./Icons";

export interface DayOfWeekDistributionProps {
  distribution: DOWDistType;
  compact?: boolean;
}

export function DayOfWeekDistribution({
  distribution,
  compact = false,
}: DayOfWeekDistributionProps) {
  const { t } = useLanguage();
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const maxMinutes = useMemo(() => {
    return distribution.days.reduce((max, d) => Math.max(max, d.minutes), 0) || 1;
  }, [distribution.days]);

  const avgMinutes = useMemo(() => {
    return Math.round(distribution.totalMinutes / 7);
  }, [distribution.totalMinutes]);

  if (distribution.totalMinutes === 0) {
    return (
      <div className="act-empty act-empty--compact">
        <div className="act-empty__icon">
          <Icons.Calendar size={18} />
        </div>
        <div className="act-empty__title">{t("activityInsights.noRoutineData")}</div>
      </div>
    );
  }

  const avgHeightPct = Math.round((avgMinutes / maxMinutes) * 100);

  return (
    <div className={`act-dow-container ${compact ? "act-dow-container--compact" : ""}`}>
      {/* Rhythm Header / Split Bar */}
      <div className="act-dow-header">
        <div className="act-dow-split-stat">
          <span className="act-dow-split-label">
            <Icons.CalendarRange size={13} /> {t("activityInsights.weekdayVsWeekend")}
          </span>
          <div className="act-dow-split-bar">
            <div
              className="act-dow-split-fill act-dow-split-fill--weekday"
              style={{ width: `${100 - distribution.weekendRatioPct}%` }}
              title={`${t("activityInsights.weekdays")}: ${formatPlayTime(distribution.weekdayMinutes)} (${100 - distribution.weekendRatioPct}%)`}
            />
            <div
              className="act-dow-split-fill act-dow-split-fill--weekend"
              style={{ width: `${distribution.weekendRatioPct}%` }}
              title={`${t("activityInsights.weekends")}: ${formatPlayTime(distribution.weekendMinutes)} (${distribution.weekendRatioPct}%)`}
            />
          </div>
        </div>

        <div className="act-dow-split-legend">
          <span className="act-dow-legend-item">
            <span className="act-dow-legend-dot act-dow-legend-dot--weekday" />
            {t("activityInsights.weekdays")} {100 - distribution.weekendRatioPct}%
          </span>
          <span className="act-dow-legend-item">
            <span className="act-dow-legend-dot act-dow-legend-dot--weekend" />
            {t("activityInsights.weekends")} {distribution.weekendRatioPct}%
          </span>
        </div>
      </div>

      {/* 7 Days of the Week Bars with Average Guideline */}
      <div className="act-dow-chart-wrapper" style={{ position: "relative" }}>
        {avgMinutes > 0 && (
          <div
            className="act-dow-avg-line"
            style={{ bottom: `calc(${avgHeightPct}% + 42px)` }}
            title={`${t("charts.average")}: ${formatPlayTime(avgMinutes)}`}
          >
            <span className="act-dow-avg-label">{t("activity.avg")}: {formatPlayTime(avgMinutes)}</span>
          </div>
        )}

        <div className="act-dow-grid">
          {distribution.days.map((day, idx) => {
            const barHeightPct = Math.round((day.minutes / maxMinutes) * 100);
            const isPeak = distribution.peakDay?.dayIndex === day.dayIndex && day.minutes > 0;
            const isWeekend = day.dayIndex === 5 || day.dayIndex === 6;
            const isHovered = hoveredIdx === idx;
            const diffVsAvg = avgMinutes > 0 ? Math.round(((day.minutes - avgMinutes) / avgMinutes) * 100) : 0;

            return (
              <div
                key={day.dayIndex}
                className={`act-dow-col ${isPeak ? "act-dow-col--peak" : ""} ${
                  isWeekend ? "act-dow-col--weekend" : ""
                } ${isHovered ? "is-hovered" : ""}`}
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
              >
                {/* Floating tooltip on hover */}
                {isHovered && (
                  <div className="act-dow-col__tooltip">
                    <div className="act-dow-col__tooltip-title">{day.dayName}</div>
                    <div className="act-dow-col__tooltip-val">{formatPlayTime(day.minutes)}</div>
                    <div className="act-dow-col__tooltip-meta">
                      {day.sessionsCount} {day.sessionsCount === 1 ? t("activity.sessionOne") : t("activity.sessionsMany")}
                      {diffVsAvg !== 0 && (
                        <span className={`act-dow-col__tooltip-diff ${diffVsAvg > 0 ? "is-pos" : "is-neg"}`}>
                          {diffVsAvg > 0 ? `+${diffVsAvg}%` : `${diffVsAvg}%`}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                <div className="act-dow-bar-track">
                  {isPeak && (
                    <span className="act-dow-peak-star" title={t("charts.peak")}>
                      ★
                    </span>
                  )}
                  <div
                    className="act-dow-bar-fill"
                    style={{ height: `${Math.max(6, barHeightPct)}%` }}
                  />
                </div>
                <span className="act-dow-day-name">{day.dayName}</span>
                <span className="act-dow-day-time">{formatPlayTime(day.minutes)}</span>
              </div>
            );
          })}
        </div>
      </div>

      {distribution.peakDay && distribution.peakDay.minutes > 0 && (
        <div className="act-dow-peak-banner">
          <Icons.Zap size={13} />
          <span>
            {t("activityInsights.mostActiveDayIs", {
              day: distribution.peakDay.dayName,
              time: formatPlayTime(distribution.peakDay.minutes),
            })}
          </span>
        </div>
      )}
    </div>
  );
}
