import { useLanguage } from "../../context/LanguageContext";
import type { TimelineGroup } from "./achievementUtils";
import AchievementItemCard from "./AchievementItemCard";

interface AchievementTimelineGroupProps {
  group: TimelineGroup;
  globalRevealSecret?: boolean;
}

export default function AchievementTimelineGroup({
  group,
  globalRevealSecret = false,
}: AchievementTimelineGroupProps) {
  const { t } = useLanguage();

  return (
    <div className="ach-journey-group">
      <div className="ach-journey-date-marker">
        <div className="ach-journey-dot" />
        <span className="ach-journey-date-label">{group.dateLabel}</span>
        <span className="ach-journey-count-badge">
          {t("achievements.unlockedCount", { count: group.items.length })}
        </span>
      </div>

      <div className="ach-journey-grid">
        {group.items.map((item) => (
          <AchievementItemCard
            key={item.apiName}
            achievement={item}
            globalRevealSecret={globalRevealSecret}
          />
        ))}
      </div>
    </div>
  );
}
