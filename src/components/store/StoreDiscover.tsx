import { memo } from "react";
import type { StoreGameSummary, StoreCategory } from "../../types/game";
import StoreHero from "./StoreHero";
import StoreRail from "./StoreRail";
import StoreLocalRail from "./StoreLocalRail";
import { useForYou } from "../../hooks/useForYou";
import { useLanguage } from "../../context/LanguageContext";

/**
 * The Discover sections shown on the landing, in display order. Kept as data
 * so the render is a single `.map()` — adding/removing/reordering a section
 * is a one-line edit here rather than a copy-paste of a whole block.
 */
const DISCOVER_RAILS: ReadonlyArray<{
  title: string;
  category: StoreCategory;
  badge: string;
}> = [
  { title: "store.rail.trendingNow", category: "trending", badge: "🔥" },
  { title: "store.rail.mostPopular", category: "popular", badge: "⭐" },
  { title: "store.rail.topCritics", category: "top", badge: "🏆" },
  { title: "store.tab.comingSoon", category: "coming_soon", badge: "🎮" },
  { title: "store.rail.newReleases", category: "new_releases", badge: "✨" },
];

interface StoreDiscoverProps {
  /** Navigate to a game's detail page. */
  onCardClick: (game: StoreGameSummary) => void;
  /** Switch to a category grid (used by the rail "See all" links). */
  onSeeAll: (category: StoreCategory) => void;
  /** Recently-viewed games for the top rail (may be empty). */
  recentlyViewed?: StoreGameSummary[];
  /** Predicate for the "In Library" badge on cards. */
  isInLibrary?: (game: StoreGameSummary) => boolean;
}

/**
 * StoreDiscover: the landing shown as the Store tab's default "Discover" mode.
 *
 * Layout (top → bottom):
 *   1. StoreHero          — auto-rotating featured banner (navigable).
 *   2. Recently Viewed    — from localStorage (hidden when empty).
 *   3. For You            — personalized from library genres (hidden when empty).
 *   4. Category rails     — Trending / Popular / Top / Coming Soon / New.
 *
 * Presentational: category-rail data lives inside the children (shared
 * `useDiscoverSection` hook); local rails receive their data as props /
 * from `useForYou`. Navigation is delegated to StorePage.
 */
function StoreDiscover({
  onCardClick,
  onSeeAll,
  recentlyViewed = [],
  isInLibrary,
}: StoreDiscoverProps) {
  const { t } = useLanguage();
  const forYou = useForYou();

  return (
    <div className="store-discover">
      <StoreHero onCardClick={onCardClick} />

      <div className="store-rails">
        {recentlyViewed.length > 0 && (
          <StoreLocalRail
            title={t("store.rail.recentlyViewed")}
            badge="🕑"
            games={recentlyViewed}
            onCardClick={onCardClick}
            isInLibrary={isInLibrary}
          />
        )}

        {forYou.games.length > 0 && (
          <StoreLocalRail
            title={forYou.genre ? t("store.rail.forYouMore", { genre: forYou.genre }) : t("store.rail.forYou")}
            badge="💜"
            games={forYou.games}
            onCardClick={onCardClick}
            isInLibrary={isInLibrary}
          />
        )}

        {DISCOVER_RAILS.map((rail) => (
          <StoreRail
            key={rail.category}
            title={t(rail.title)}
            category={rail.category}
            onCardClick={onCardClick}
            onSeeAll={onSeeAll}
            badge={rail.badge}
          />
        ))}
      </div>
    </div>
  );
}

export default memo(StoreDiscover);
