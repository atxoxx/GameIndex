import { useMemo } from "react";
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

  const maxMinutes = useMemo(() => {
    return distribution.days.reduce((max, d) => Math.max(max, d.minutes), 0) || 1;
  }, [distribution.days]);

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

      {/* 7 Days of the Week Bars */}
      <div className="act-dow-grid">
        {distribution.days.map((day) => {
          const barHeightPct = Math.round((day.minutes / maxMinutes) * 100);
          const isPeak = distribution.peakDay?.dayIndex === day.dayIndex && day.minutes > 0;
          const isWeekend = day.dayIndex === 5 || day.dayIndex === 6;

          return (
            <div
              key={day.dayIndex}
              className={`act-dow-col ${isPeak ? "act-dow-col--peak" : ""} ${isWeekend ? "act-dow-col--weekend" : ""}`}
              title={`${day.dayName}: ${formatPlayTime(day.minutes)} (${day.sessionsCount} sessions)`}
            >
              <div className="act-dow-bar-track">
                <div
                  className="act-dow-bar-fill"
                  style={{ height: `${Math.max(4, barHeightPct)}%` }}
                />
              </div>
              <span className="act-dow-day-name">{day.dayName}</span>
              <span className="act-dow-day-time">{formatPlayTime(day.minutes)}</span>
            </div>
          );
        })}
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
