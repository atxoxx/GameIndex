import { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { StoreGameSummary, StoreSort } from "../../types/game";
import StoreGameCard from "./StoreGameCard";
import { useLanguage } from "../../context/LanguageContext";

interface StoreDiscoveryRailsProps {
  onPickGame: (game: StoreGameSummary) => void;
  onViewAllCategory?: (category: string, sort?: StoreSort) => void;
  isInLibrary?: (game: StoreGameSummary) => boolean;
  onHide?: (game: StoreGameSummary) => void;
  onCompare?: (game: StoreGameSummary) => void;
}

interface RailConfig {
  id: string;
  titleKey: string;
  subKey: string;
  category: string;
  sort?: string;
  storeSort?: StoreSort;
  icon: React.ReactNode;
}

const RAILS: RailConfig[] = [
  {
    id: "trending",
    titleKey: "store.rails.trendingTitle",
    subKey: "store.rails.trendingSub",
    category: "trending",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
        <polyline points="17 6 23 6 23 12" />
      </svg>
    ),
  },
  {
    id: "top-rated",
    titleKey: "store.rails.topRatedTitle",
    subKey: "store.rails.topRatedSub",
    category: "top",
    sort: "rating",
    storeSort: "rating",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    ),
  },
  {
    id: "new-releases",
    titleKey: "store.rails.newReleasesTitle",
    subKey: "store.rails.newReleasesSub",
    category: "all",
    sort: "release_new",
    storeSort: "release_new",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
];

const RAIL_LIMIT = 10;

function SingleDiscoveryRail({
  config,
  onPickGame,
  onViewAll,
  isInLibrary,
  onHide,
  onCompare,
}: {
  config: RailConfig;
  onPickGame: (game: StoreGameSummary) => void;
  onViewAll?: () => void;
  isInLibrary?: (game: StoreGameSummary) => boolean;
  onHide?: (game: StoreGameSummary) => void;
  onCompare?: (game: StoreGameSummary) => void;
}) {
  const { t } = useLanguage();
  const [games, setGames] = useState<StoreGameSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const trackRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);

    invoke<StoreGameSummary[]>("fetch_store_games", {
      category: config.category,
      offset: 0,
      limit: RAIL_LIMIT,
      sort: config.sort,
    })
      .then((res) => {
        if (active) {
          setGames(res);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [config]);

  const scroll = useCallback((direction: "left" | "right") => {
    const track = trackRef.current;
    if (!track) return;
    const scrollAmount = track.clientWidth * 0.75;
    track.scrollBy({
      left: direction === "left" ? -scrollAmount : scrollAmount,
      behavior: "smooth",
    });
  }, []);

  if (!loading && games.length === 0) return null;

  return (
    <div className="store-discovery-rail">
      <div className="store-discovery-rail-head">
        <div className="store-discovery-rail-title-row">
          <div className="store-discovery-rail-icon" aria-hidden="true">
            {config.icon}
          </div>
          <div>
            <h3 className="store-discovery-rail-title">{t(config.titleKey)}</h3>
            <p className="store-discovery-rail-sub">{t(config.subKey)}</p>
          </div>
        </div>

        <div className="store-discovery-rail-actions">
          {onViewAll && (
            <button
              type="button"
              className="store-discovery-rail-view-all"
              onClick={onViewAll}
            >
              <span>{t("store.rails.viewAll")}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          )}

          <button
            type="button"
            className="store-discovery-rail-nav"
            onClick={() => scroll("left")}
            aria-label="Scroll left"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>

          <button
            type="button"
            className="store-discovery-rail-nav"
            onClick={() => scroll("right")}
            aria-label="Scroll right"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
      </div>

      <div className="store-discovery-rail-track-wrap">
        <div className="store-discovery-rail-track" ref={trackRef}>
          {loading && games.length === 0
            ? Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="store-game-card store-game-card-skeleton density-cozy">
                  <div className="store-card-cover">
                    <div className="store-card-cover-skeleton" />
                  </div>
                  <div className="store-card-body">
                    <div className="skeleton-line skeleton-title" />
                    <div className="skeleton-line skeleton-subtitle short" />
                  </div>
                </div>
              ))
            : games.map((g) => (
                <div key={g.id} className="store-discovery-rail-item">
                  <StoreGameCard
                    game={g}
                    onClick={onPickGame}
                    density="cozy"
                    inLibrary={isInLibrary ? isInLibrary(g) : false}
                    onHide={onHide ? (game, e) => { e.stopPropagation(); onHide(game); } : undefined}
                    onCompare={onCompare ? (game, e) => { e.stopPropagation(); onCompare(game); } : undefined}
                  />
                </div>
              ))}
        </div>
        <div className="store-discovery-rail-fade store-discovery-rail-fade--left" aria-hidden="true" />
        <div className="store-discovery-rail-fade store-discovery-rail-fade--right" aria-hidden="true" />
      </div>
    </div>
  );
}

export default function StoreDiscoveryRails({
  onPickGame,
  onViewAllCategory,
  isInLibrary,
  onHide,
  onCompare,
}: StoreDiscoveryRailsProps) {
  return (
    <section className="store-discovery-rails" aria-label="Curated Store Rails">
      {RAILS.map((config) => (
        <SingleDiscoveryRail
          key={config.id}
          config={config}
          onPickGame={onPickGame}
          onViewAll={
            onViewAllCategory
              ? () => onViewAllCategory(config.category, config.storeSort)
              : undefined
          }
          isInLibrary={isInLibrary}
          onHide={onHide}
          onCompare={onCompare}
        />
      ))}
    </section>
  );
}
