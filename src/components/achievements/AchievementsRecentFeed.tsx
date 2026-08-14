import { useNavigate } from "react-router-dom";
import { useLanguage } from "../../context/LanguageContext";
import {
  type Achievement,
  type AchievementRarity,
  getAchievementRarity,
  RARITY_COLORS,
} from "../../types/game";
import { formatRelativeTime, formatUnlockDate } from "./achievementUtils";

export interface RecentAchievementFeedItem {
  achievement: Achievement;
  gameName: string;
  gameId: string;
  gameCover?: string | null;
}

interface AchievementsRecentFeedProps {
  recentAchievements: RecentAchievementFeedItem[];
}

export default function AchievementsRecentFeed({
  recentAchievements,
}: AchievementsRecentFeedProps) {
  const { t } = useLanguage();
  const navigate = useNavigate();

  if (recentAchievements.length === 0) return null;

  return (
    <div className="ach-card-section ach-recent-feed-section">
      <div className="ach-card-section-head">
        <div className="ach-card-section-title-wrap">
          <h3 className="achievements-section-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            {t("achievementsPage.recentUnlocks")}
          </h3>
          <span className="ach-section-subtitle">
            {t("achievementsPage.recentUnlocksSubtitle")}
          </span>
        </div>
      </div>

      <div className="ach-recent-feed-grid">
        {recentAchievements.map((item, i) => {
          const rarity: AchievementRarity = getAchievementRarity(item.achievement.percent);
          const rarityColor = RARITY_COLORS[rarity];

          return (
            <div
              key={`${item.gameId}-${item.achievement.apiName}-${i}`}
              className="ach-recent-feed-card"
              data-rarity={rarity}
              style={{
                borderColor: `color-mix(in srgb, ${rarityColor} 35%, var(--color-border))`,
              }}
              onClick={() => navigate(`/library/${item.gameId}`)}
            >
              <div className="ach-recent-feed-icon-wrap">
                <img
                  className="ach-recent-feed-icon"
                  src={item.achievement.icon}
                  alt={item.achievement.displayName}
                  loading="lazy"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
                {item.gameCover && (
                  <img
                    className="ach-recent-feed-game-thumb"
                    src={item.gameCover}
                    alt={item.gameName}
                    loading="lazy"
                  />
                )}
              </div>

              <div className="ach-recent-feed-body">
                <div className="ach-recent-feed-top">
                  <span className="ach-recent-feed-name" title={item.achievement.displayName}>
                    {item.achievement.displayName}
                  </span>
                  <span
                    className="ach-recent-feed-rarity-pill"
                    style={{ color: rarityColor, borderColor: rarityColor }}
                  >
                    {item.achievement.percent.toFixed(1)}%
                  </span>
                </div>

                <span className="ach-recent-feed-game" title={item.gameName}>
                  {item.gameName}
                </span>

                {item.achievement.description && (
                  <p className="ach-recent-feed-desc" title={item.achievement.description}>
                    {item.achievement.description}
                  </p>
                )}

                <div className="ach-recent-feed-footer">
                  <span className="ach-recent-feed-date" title={formatUnlockDate(item.achievement.unlockTime)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="11" height="11">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                    {formatRelativeTime(item.achievement.unlockTime)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
