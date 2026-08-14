import { useMemo } from "react";
import type { GamePassGame } from "../../types/deals";
import type {
  GamePassFiltersState,
  GamePassSortOption,
} from "../../pages/deals/dealsConstants";
import {
  GP_REGIONS,
  GP_CATEGORIES,
  GP_CATEGORY_KEYS,
  GP_PLATFORMS,
  titleToSlug,
} from "../../pages/deals/dealsConstants";
import { useLanguage } from "../../context/LanguageContext";
import { useWishlist } from "../../hooks/useWishlist";
import { useGames } from "../../context/GameContext";
import { Button } from "../ui";
import GamePassCard from "./GamePassCard";
import DealsSkeletonGrid from "./DealsSkeletonGrid";
import DealsEmptyState, { DealsErrorState } from "./DealsEmptyState";

interface GamePassPanelProps {
  filters: GamePassFiltersState;
  setFilters: React.Dispatch<React.SetStateAction<GamePassFiltersState>>;
  games: GamePassGame[];
  loading: boolean;
  error: string | null;
  empty: boolean;
  density: string;
  onOpenUrl: (url: string | null | undefined) => void;
  onInspect: (game: GamePassGame) => void;
  onReload: () => void;
}

export default function GamePassPanel({
  filters,
  setFilters,
  games,
  loading,
  error,
  empty,
  density,
  onOpenUrl,
  onInspect,
  onReload,
}: GamePassPanelProps) {
  const { t } = useLanguage();
  const { isWishlisted } = useWishlist();
  const { games: libraryGames } = useGames();

  const ownedNames = useMemo(() => {
    return new Set(libraryGames.map((g) => g.name.toLowerCase().trim()));
  }, [libraryGames]);

  const toggleCategory = (category: string) => {
    setFilters((prev) => ({
      ...prev,
      categories: prev.categories.includes(category)
        ? prev.categories.filter((c) => c !== category)
        : [...prev.categories, category],
    }));
  };

  // Client-side search & filtering
  const processedGames = useMemo(() => {
    let list = [...games];

    const q = filters.searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (g) =>
          g.title.toLowerCase().includes(q) ||
          (g.developer && g.developer.toLowerCase().includes(q)) ||
          (g.publisher && g.publisher.toLowerCase().includes(q)) ||
          g.categories.some((c) => c.toLowerCase().includes(q)),
      );
    }

    if (filters.wishlistOnly) {
      list = list.filter((g) => isWishlisted(titleToSlug(g.title)));
    }

    if (filters.hideOwned) {
      list = list.filter(
        (g) => !ownedNames.has(g.title.toLowerCase().trim()),
      );
    }

    list.sort((a, b) => {
      switch (filters.sortBy) {
        case "title_asc":
          return a.title.localeCompare(b.title);
        case "title_desc":
          return b.title.localeCompare(a.title);
        case "release_desc": {
          const da = a.releaseDate ? new Date(a.releaseDate).getTime() : 0;
          const db = b.releaseDate ? new Date(b.releaseDate).getTime() : 0;
          return db - da;
        }
        case "release_asc": {
          const da = a.releaseDate ? new Date(a.releaseDate).getTime() : 0;
          const db = b.releaseDate ? new Date(b.releaseDate).getTime() : 0;
          return da - db;
        }
        default:
          return 0;
      }
    });

    return list;
  }, [games, filters.searchQuery, filters.wishlistOnly, filters.hideOwned, filters.sortBy, isWishlisted, ownedNames]);

  return (
    <section className="deals-section" aria-label={t("deals.gamepass")}>
      <div className="deals-toolbar">
        {/* Search input */}
        <div className="deals-search">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="deals-search-icon"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="search"
            className="deals-search-input"
            value={filters.searchQuery}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, searchQuery: e.target.value }))
            }
            placeholder={t("deals.searchGamePassPlaceholder")}
            aria-label={t("deals.searchGamePassPlaceholder")}
          />
          {filters.searchQuery && (
            <button
              type="button"
              className="deals-search-clear"
              onClick={() =>
                setFilters((prev) => ({ ...prev, searchQuery: "" }))
              }
              aria-label={t("common.clearSearch")}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        {/* Filters row */}
        <div className="deals-filters-row">
          <div className="deals-filter-group">
            <label htmlFor="gp-region">{t("deals.region")}</label>
            <select
              id="gp-region"
              className="deals-filter-select"
              value={filters.region}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, region: e.target.value }))
              }
            >
              {GP_REGIONS.map((r) => (
                <option key={r.code} value={r.code}>
                  {t(r.label)} ({r.code})
                </option>
              ))}
            </select>
          </div>

          <div className="deals-filter-group">
            <label htmlFor="gp-platform">{t("deals.platform")}</label>
            <select
              id="gp-platform"
              className="deals-filter-select"
              value={filters.platform}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  platform: e.target.value,
                }))
              }
            >
              {GP_PLATFORMS.map((p) => (
                <option key={p.value} value={p.value}>
                  {t(p.label)}
                </option>
              ))}
            </select>
          </div>

          <div className="deals-filter-group">
            <label htmlFor="gp-sort">{t("deals.sortBy")}</label>
            <select
              id="gp-sort"
              className="deals-filter-select"
              value={filters.sortBy}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  sortBy: e.target.value as GamePassSortOption,
                }))
              }
            >
              <option value="title_asc">{t("deals.sortTitleAsc")}</option>
              <option value="title_desc">{t("deals.sortTitleDesc")}</option>
              <option value="release_desc">{t("deals.sortReleaseDesc")}</option>
              <option value="release_asc">{t("deals.sortReleaseAsc")}</option>
            </select>
          </div>
        </div>

        {/* Category chips carousel */}
        <div className="deals-category-chips-strip">
          <label className="deals-category-label">{t("deals.categories")}:</label>
          <div className="deals-category-chips">
            {GP_CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`deals-category-chip ${
                  filters.categories.includes(cat) ? "active" : ""
                }`}
                onClick={() => toggleCategory(cat)}
                aria-pressed={filters.categories.includes(cat)}
              >
                {t(GP_CATEGORY_KEYS[cat] ?? cat)}
              </button>
            ))}
          </div>
        </div>

        {/* Quick Toggles */}
        <div className="deals-quick-toggles">
          <button
            type="button"
            className={`deals-toggle-chip ${filters.wishlistOnly ? "active" : ""}`}
            onClick={() =>
              setFilters((prev) => ({
                ...prev,
                wishlistOnly: !prev.wishlistOnly,
              }))
            }
            aria-pressed={filters.wishlistOnly}
          >
            <svg
              viewBox="0 0 24 24"
              fill={filters.wishlistOnly ? "currentColor" : "none"}
              stroke="currentColor"
              strokeWidth="2"
            >
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            {t("deals.wishlistOnly")}
          </button>

          <button
            type="button"
            className={`deals-toggle-chip ${filters.hideOwned ? "active" : ""}`}
            onClick={() =>
              setFilters((prev) => ({
                ...prev,
                hideOwned: !prev.hideOwned,
              }))
            }
            aria-pressed={filters.hideOwned}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
            {t("deals.hideOwned")}
          </button>

          <Button
            variant="secondary"
            size="sm"
            isLoading={loading}
            onClick={onReload}
            title={t("deals.refreshGamepass")}
            leftIcon={
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            }
          >
            {t("common.refresh")}
          </Button>
        </div>
      </div>

      {/* Results Meta */}
      {!loading && !error && games.length > 0 && (
        <div className="deals-results-meta">
          <span>
            {t("deals.showingCount", {
              count: processedGames.length,
              total: games.length,
            })}
          </span>
          {(filters.searchQuery || filters.wishlistOnly || filters.hideOwned || filters.categories.length > 0) && (
            <button
              type="button"
              className="deals-clear-all-btn"
              onClick={() =>
                setFilters((prev) => ({
                  ...prev,
                  searchQuery: "",
                  wishlistOnly: false,
                  hideOwned: false,
                  categories: [],
                }))
              }
            >
              {t("deals.resetFilters")}
            </button>
          )}
        </div>
      )}

      {loading && (
        <DealsSkeletonGrid density={density} variant="gamepass" count={8} />
      )}

      {!loading && error && (
        <DealsErrorState message={error} onRetry={onReload} />
      )}

      {!loading && !error && (empty || processedGames.length === 0) && (
        <DealsEmptyState
          icon={
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          }
          message={
            processedGames.length === 0 && games.length > 0
              ? t("deals.noMatchingDeals")
              : t("deals.emptyGamepass")
          }
          onRetry={onReload}
        />
      )}

      {!loading && !error && processedGames.length > 0 && (
        <div className={`deals-grid density-${density}`}>
          {processedGames.map((game, i) => (
            <GamePassCard
              key={game.id}
              game={game}
              onOpenUrl={onOpenUrl}
              onInspect={onInspect}
              index={i}
              density={density}
            />
          ))}
        </div>
      )}
    </section>
  );
}
