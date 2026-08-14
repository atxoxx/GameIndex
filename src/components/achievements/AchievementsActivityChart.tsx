import { useLanguage } from "../../context/LanguageContext";
import type { MonthlyActivityItem } from "./achievementUtils";

interface AchievementsActivityChartProps {
  activity: MonthlyActivityItem[];
}

export default function AchievementsActivityChart({
  activity,
}: AchievementsActivityChartProps) {
  const { t } = useLanguage();

  const maxCount = Math.max(...activity.map((a) => a.count), 1);
  const totalRecent = activity.reduce((sum, a) => sum + a.count, 0);

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
          </span>
        </div>
      </div>

      <div className="ach-activity-chart-body">
        <div className="ach-activity-bars">
          {activity.map((item) => {
            const heightPct = Math.max(
              item.count > 0 ? (item.count / maxCount) * 100 : 4,
              4
            );
            return (
              <div
                key={item.monthKey}
                className={`ach-activity-col ${item.count > 0 ? "has-data" : "empty"}`}
                title={`${item.label}: ${item.count} ${t("achievements.unlocked").toLowerCase()} (${item.points} pts)`}
              >
                <div className="ach-activity-col-tooltip">
                  <span className="ach-tooltip-count">{item.count}</span>
                  <span className="ach-tooltip-pts">+{item.points} pts</span>
                  <span className="ach-tooltip-month">{item.shortLabel}</span>
                </div>
                <div className="ach-activity-bar-track">
                  <div
                    className="ach-activity-bar-fill"
                    style={{ height: `${heightPct}%` }}
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
