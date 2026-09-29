import { useMemo, useState } from "react";
import { useLanguage } from "../../context/LanguageContext";
import type { MonthlyActivityItem } from "./achievementUtils";

interface AchievementsActivityChartProps {
  activity: MonthlyActivityItem[];
}

export default function AchievementsActivityChart({
  activity,
}: AchievementsActivityChartProps) {
  const { t } = useLanguage();
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const maxCount = useMemo(() => Math.max(...activity.map((a) => a.count), 1), [activity]);
  const totalRecent = useMemo(() => activity.reduce((sum, a) => sum + a.count, 0), [activity]);
  const avgMonthly = useMemo(
    () => (activity.length > 0 ? Math.round(totalRecent / activity.length) : 0),
    [activity, totalRecent]
  );
  const peakMonth = useMemo(() => {
    let best = -1;
    let peakIdx = -1;
    activity.forEach((a, i) => {
      if (a.count > best) {
        best = a.count;
        peakIdx = i;
      }
    });
    return best > 0 ? peakIdx : -1;
  }, [activity]);

  const avgHeightPct = maxCount > 0 ? Math.round((avgMonthly / maxCount) * 100) : 0;

  return (
    <div className="ach-card-section ach-activity-widget">
      <div className="ach-card-section-head">
        <div className="ach-card-section-title-wrap">
          <h3 className="achievements-section-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
              <line x1="18" y1="20" x2="18" y2="10" />
              <line x1="12" y1="20" x2="12" y2="4" />
              <line x1="6" y1="20" x2="6" y2="14" />
            </svg>
            {t("achievementsPage.unlockActivity")}
          </h3>
          <span className="ach-section-subtitle">
            {t("achievementsPage.recentUnlocksCount", { count: totalRecent })}
            {avgMonthly > 0 && ` · Ø ${avgMonthly} / ${t("activity.1m").toLowerCase()}`}
          </span>
        </div>
      </div>

      <div className="ach-activity-chart-body" style={{ position: "relative" }}>
        {/* Average horizontal dashed guide */}
        {avgMonthly > 0 && (
          <div
            className="ach-activity-avg-line"
            style={{ bottom: `calc(${avgHeightPct}% + 32px)` }}
            title={`${t("charts.average")}: ${avgMonthly}`}
          >
            <span className="ach-activity-avg-label">Ø {avgMonthly}</span>
          </div>
        )}

        <div className="ach-activity-bars">
          {activity.map((item, idx) => {
            const heightPct = Math.max(
              item.count > 0 ? (item.count / maxCount) * 100 : 4,
              4
            );
            const isPeak = idx === peakMonth;
            const isHovered = hoveredIdx === idx;

            return (
              <div
                key={item.monthKey}
                className={`ach-activity-col ${item.count > 0 ? "has-data" : "empty"} ${
                  isPeak ? "is-peak" : ""
                } ${isHovered ? "is-hovered" : ""}`}
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
              >
                {/* Modern tooltip */}
                <div className="ach-activity-col-tooltip">
                  <span className="ach-tooltip-count">{item.count}</span>
                  <span className="ach-tooltip-pts">+{item.points} pts</span>
                  <span className="ach-tooltip-month">{item.label}</span>
                </div>

                <div className="ach-activity-bar-track">
                  {isPeak && <span className="ach-activity-peak-star">★</span>}
                  <div
                    className="ach-activity-bar-fill"
                    style={{
                      height: `${heightPct}%`,
                      filter: isHovered ? "brightness(1.2) drop-shadow(0 0 6px var(--color-accent))" : "none",
                    }}
                  />
                </div>
                <span className="ach-activity-col-label">{item.shortLabel}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
