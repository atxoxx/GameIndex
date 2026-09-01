import { useMemo } from "react";
import { formatPlayTime } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";
import { type TimeOfDayDistribution as TimeOfDayDistType } from "./insights";
import * as Icons from "./Icons";

export function TimeOfDayDistribution({
  distribution,
  compact = false,
}: {
  distribution: TimeOfDayDistType;
  compact?: boolean;
}) {
  const { t } = useLanguage();

  const maxSlotMinutes = useMemo(() => {
    let max = 1;
    for (const s of distribution.slots) {
      if (s.minutes > max) max = s.minutes;
    }
    return max;
  }, [distribution.slots]);

  const renderIcon = (icon: "sunrise" | "sun" | "sunset" | "moon") => {
    switch (icon) {
      case "sunrise":
        return <Icons.Sunrise size={14} />;
      case "sun":
        return <Icons.Sun size={14} />;
      case "sunset":
        return <Icons.Sunset size={14} />;
      case "moon":
        return <Icons.Moon size={14} />;
    }
  };

  return (
    <div className={`act-tod${compact ? " act-tod--compact" : ""}`}>
      <div className="act-tod__slots">
        {distribution.slots.map((slot) => {
          const fillPct = Math.max(3, (slot.minutes / maxSlotMinutes) * 100);
          const isPeak = distribution.peakSlot?.key === slot.key && slot.minutes > 0;

          return (
            <div
              key={slot.key}
              className={`act-tod__slot${isPeak ? " act-tod__slot--peak" : ""}`}
            >
              <div className="act-tod__slot-header">
                <span className="act-tod__slot-icon" aria-hidden="true">
                  {renderIcon(slot.icon)}
                </span>
                <span className="act-tod__slot-title">{t(slot.labelKey)}</span>
                <span className="act-tod__slot-time">{slot.hoursLabel}</span>
              </div>

              <div className="act-tod__slot-bar-wrap">
                <div
                  className="act-tod__slot-bar"
                  style={{ width: `${slot.minutes > 0 ? fillPct : 0}%` }}
                />
              </div>

              <div className="act-tod__slot-meta">
                <span className="act-tod__slot-val">{formatPlayTime(slot.minutes)}</span>
                <span className="act-tod__slot-pct">{slot.pct}%</span>
              </div>
            </div>
          );
        })}
      </div>

      {!compact && distribution.totalMinutes > 0 && (
        <div className="act-tod__split">
          <div className="act-tod__split-header">
            <span className="act-tod__split-title">{t("activityInsights.routineSplit")}</span>
            <span className="act-tod__split-ratio">
              {distribution.weekendRatioPct}% {t("activityInsights.weekends")}
            </span>
          </div>

          <div className="act-tod__split-bar-track">
            <div
              className="act-tod__split-bar act-tod__split-bar--weekday"
              style={{ width: `${100 - distribution.weekendRatioPct}%` }}
              title={`${t("activityInsights.weekdays")}: ${formatPlayTime(distribution.weekdayMinutes)}`}
            />
            <div
              className="act-tod__split-bar act-tod__split-bar--weekend"
              style={{ width: `${distribution.weekendRatioPct}%` }}
              title={`${t("activityInsights.weekends")}: ${formatPlayTime(distribution.weekendMinutes)}`}
            />
          </div>

          <div className="act-tod__split-legend">
            <div className="act-tod__split-legend-item">
              <span className="act-tod__split-dot act-tod__split-dot--weekday" />
              <span>
                {t("activityInsights.weekdays")}: <strong>{formatPlayTime(distribution.weekdayMinutes)}</strong>
              </span>
            </div>
            <div className="act-tod__split-legend-item">
              <span className="act-tod__split-dot act-tod__split-dot--weekend" />
              <span>
                {t("activityInsights.weekends")}: <strong>{formatPlayTime(distribution.weekendMinutes)}</strong>
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
