import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAchievements } from "../../context/AchievementContext";
import { useGames } from "../../context/GameContext";
import { useLanguage } from "../../context/LanguageContext";
import {
  type Achievement,
  type AchievementRarity,
  gameDisplayName,
  getAchievementRarity,
  RARITY_COLORS,
} from "../../types/game";
import { formatRelativeTime } from "../achievements/achievementUtils";
import HomeSection from "./HomeSection";

const MAX_RECENT = 5;

interface HomeAchievementItem {
  achievement: Achievement;
  gameName: string;
  gameId: string;
  gameCover?: string | null;
}

export default function HomeAchievements() {
  const { recentUnlocks } = useAchievements();
  const { games } = useGames();
  const { t } = useLanguage();
  const navigate = useNavigate();

  const recent = useMemo<HomeAchievementItem[]>(() => {
    return recentUnlocks.slice(0, MAX_RECENT).map((r) => {
      const game = games.find((g) => g.id === r.gameId);
      return {
        achievement: r.achievement,
        gameName: game ? gameDisplayName(game) : t("splash.unknown"),
        gameId: r.gameId,
        gameCover: game?.coverArtUrl,
      };
    });
  }, [recentUnlocks, games, t]);

  if (recent.length === 0) return null;

  return (
    <HomeSection
      className="home-achievements"
      icon={
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="8" r="7" />
          <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" />
        </svg>
      }
      title={t("achievementsPage.recentUnlocks")}
      subtitle={t("achievementsPage.recentUnlocksSubtitle")}
      viewAllPath="/achievements"
    >
      <div className="home-achievements__list">
        {recent.map((item, i) => {
          const rarity: AchievementRarity = getAchievementRarity(item.achievement.percent);
          const rarityColor = RARITY_COLORS[rarity];

          return (
            <div
              key={`${item.gameId}-${item.achievement.apiName}-${i}`}
              className="home-achievement-row"
              style={{
                borderColor: `color-mix(in srgb, ${rarityColor} 32%, var(--color-border))`,
              }}
              onClick={() => navigate(`/library/${item.gameId}`)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  navigate(`/library/${item.gameId}`);
                }
              }}
            >
              <div className="home-achievement-row__icon-wrap">
                <img
                  className="home-achievement-row__icon"
                  src={item.achievement.icon}
                  alt=""
                  loading="lazy"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
                {item.gameCover && (
                  <img
                    className="home-achievement-row__thumb"
                    src={item.gameCover}
                    alt=""
                    loading="lazy"
                  />
                )}
              </div>

              <div className="home-achievement-row__body">
                <div className="home-achievement-row__head">
                  <span className="home-achievement-row__name" title={item.achievement.displayName}>
                    {item.achievement.displayName}
                  </span>
                  <span
                    className="home-achievement-row__rarity"
                    style={{ color: rarityColor, borderColor: rarityColor }}
                  >
                    {item.achievement.percent.toFixed(1)}%
                  </span>
                </div>
                <div className="home-achievement-row__meta">
                  <span className="home-achievement-row__game" title={item.gameName}>
                    {item.gameName}
                  </span>
                  {item.achievement.unlockTime > 0 && (
                    <span className="home-achievement-row__time">
                      {formatRelativeTime(item.achievement.unlockTime)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </HomeSection>
  );
}
