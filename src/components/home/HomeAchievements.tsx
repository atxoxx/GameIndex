import { useMemo } from "react";
import { useAchievements } from "../../context/AchievementContext";
import { useGames } from "../../context/GameContext";
import { useLanguage } from "../../context/LanguageContext";
import AchievementsRecentFeed, {
  type RecentAchievementFeedItem,
} from "../achievements/AchievementsRecentFeed";

const MAX_RECENT = 6;

/**
 * HomeAchievements — the most recent achievement unlocks across the
 * library, shown as a sidebar widget. Reuses the full Achievements page's
 * `AchievementsRecentFeed` (header + cards), which navigates to the
 * owning game on click and renders nothing when there is nothing to show.
 */
export default function HomeAchievements() {
  const { cache } = useAchievements();
  const { games } = useGames();
  const { t } = useLanguage();

  const recent = useMemo<RecentAchievementFeedItem[]>(() => {
    const all: RecentAchievementFeedItem[] = [];
    for (const [gameId, data] of Object.entries(cache.games)) {
      const game = games.find((g) => g.id === gameId);
      for (const a of data.achievements ?? []) {
        if (a.achieved && a.unlockTime > 0) {
          all.push({
            achievement: a,
            gameName: game?.name ?? t("splash.unknown"),
            gameId,
            gameCover: game?.coverArtUrl,
          });
        }
      }
    }
    return all
      .sort((a, b) => b.achievement.unlockTime - a.achievement.unlockTime)
      .slice(0, MAX_RECENT);
  }, [cache, games, t]);

  return (
    <div className="home-achievements">
      <AchievementsRecentFeed recentAchievements={recent} />
    </div>
  );
}
