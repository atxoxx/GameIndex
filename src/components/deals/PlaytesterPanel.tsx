import { useMemo } from "react";
import type { PlaytesterGame } from "../../types/deals";
import type {
  PlaytesterFiltersState,
  PlaytesterSortOption,
} from "../../pages/deals/dealsConstants";
import { titleToSlug } from "../../pages/deals/dealsConstants";
import { useLanguage } from "../../context/LanguageContext";
import { useWishlist } from "../../hooks/useWishlist";
import { useGames } from "../../context/GameContext";
import { Button } from "../ui";
import PlaytesterCard from "./PlaytesterCard";
import DealsSkeletonGrid from "./DealsSkeletonGrid";
import DealsEmptyState, { DealsErrorState } from "./DealsEmptyState";

interface PlaytesterPanelProps {
  filters: PlaytesterFiltersState;
  setFilters: React.Dispatch<React.SetStateAction<PlaytesterFiltersState>>;
  games: PlaytesterGame[];
  loading: boolean;
  error: string | null;
  empty: boolean;
  density: string;
  onInspect: (game: PlaytesterGame) => void;
  onReload: () => void;
}

export default function PlaytesterPanel({
  filters,
  setFilters,
  games,
  loading,
  error,
  empty,
  density,
  onInspect,
  onReload,
}: PlaytesterPanelProps) {
  const { t } = useLanguage();
  const { isWishlisted } = useWishlist();
  const { games: libraryGames } = useGames();

  const ownedNames = useMemo(() => {
    return new Set(libraryGames.map((g) => g.name.toLowerCase().trim()));
  }, [libraryGames]);

  // Filter options derived from the loaded catalog (matches how the
  // giveaways tab builds its store filter).
  const platformOptions = useMemo(() => {
    const set = new Set<string>();
    for (const g of games) {
      if (g.platform) set.add(g.platform);
      for (const p of g.platforms ?? []) if (p) set.add(p);
    }
    return Array.from(set).sort();
  }, [games]);

  const genreOptions = useMemo(() => {
    const set = new Set<string>();
    for (const g of games) for (const genre of g.genres) set.add(genre);
    return Array.from(set).sort();
  }, [games]);

  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    for (const g of games) if (g.status) set.add(g.status);
    return Array.from(set).sort();
  }, [games]);

  const kindOptions = useMemo(() => {
    const set = new Set<string>();
    for (const g of games) if (g.kind) set.add(g.kind);
    return Array.from(set).sort();
  }, [games]);

  const processedGames = useMemo(() => {
    let list = [...games];

    const q = filters.searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (g) =>
          g.title.toLowerCase().includes(q) ||
          (g.description && g.description.toLowerCase().includes(q)) ||
          g.genres.some((c) => c.toLowerCase().includes(q)) ||
          g.platform.toLowerCase().includes(q) ||
          g.platforms.some((p) => p.toLowerCase().includes(q)),
      );
    }

    if (filters.platform !== "all") {
      list = list.filter((g) => {
        const plats =
          g.platforms && g.platforms.length > 0
            ? g.platforms
            : g.platform
              ? [g.platform]
              : [];
        return plats.some(
          (p) => p.toLowerCase() === filters.platform.toLowerCase(),
        );
      });
    }

    if (filters.genre !== "all") {
      list = list.filter((g) =>
        g.genres.some((c) => c.toLowerCase() === filters.genre.toLowerCase()),
      );
    }

    if (filters.status !== "all") {
      list = list.filter(
        (g) => g.status.toLowerCase() === filters.status.toLowerCase(),
      );
    }

    if (filters.kind !== "all") {
      list = list.filter(
        (g) => g.kind.toLowerCase() === filters.kind.toLowerCase(),
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
        case "newest_desc": {
          const ta = a.dateAdded ? new Date(a.dateAdded).getTime() : 0;
          const tb = b.dateAdded ? new Date(b.dateAdded).getTime() : 0;
          return tb - ta;
        }
        case "newest_asc": {
          const ta = a.dateAdded ? new Date(a.dateAdded).getTime() : 0;
          const tb = b.dateAdded ? new Date(b.dateAdded).getTime() : 0;
          return ta - tb;
        }
        case "title_asc":
          return a.title.localeCompare(b.title);
        case "title_desc":
          return b.title.localeCompare(a.title);
        default:
          return 0;
      }
    });

    return list;
  }, [games, filters, isWishlisted, ownedNames]);

  const hasActiveFilters =
    filters.searchQuery !== "" ||
    filters.platform !== "all" ||
    filters.genre !== "all" ||
    filters.status !== "all" ||
    filters.kind !== "all" ||
    filters.wishlistOnly ||
    filters.hideOwned;

  return (
    <section className="deals-section" aria-label={t("deals.playtester")}>
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
            placeholder={t("deals.searchPlaytesterPlaceholder")}
            aria-label={t("deals.searchPlaytesterPlaceholder")}
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
            <label htmlFor="pt-platform">{t("deals.platform")}</label>
            <select
              id="pt-platform"
              className="deals-filter-select"
              value={filters.platform}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, platform: e.target.value }))
              }
            >
              <option value="all">{t("deals.allPlatforms")}</option>
              {platformOptions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          <div className="deals-filter-group">
            <label htmlFor="pt-genre">{t("deals.genre")}</label>
            <select
              id="pt-genre"
              className="deals-filter-select"
              value={filters.genre}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, genre: e.target.value }))
              }
            >
              <option value="all">{t("deals.allGenres")}</option>
              {genreOptions.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>

          <div className="deals-filter-group">
            <label htmlFor="pt-status">{t("deals.status")}</label>
            <select
              id="pt-status"
              className="deals-filter-select"
              value={filters.status}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, status: e.target.value }))
              }
            >
              <option value="all">{t("deals.allStatuses")}</option>
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div className="deals-filter-group">
            <label htmlFor="pt-kind">{t("deals.type")}</label>
            <select
              id="pt-kind"
              className="deals-filter-select"
              value={filters.kind}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, kind: e.target.value }))
              }
            >
              <option value="all">{t("deals.allTypes")}</option>
              {kindOptions.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>

          <div className="deals-filter-group">
            <label htmlFor="pt-sort">{t("deals.sortBy")}</label>
            <select
              id="pt-sort"
              className="deals-filter-select"
              value={filters.sortBy}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  sortBy: e.target.value as PlaytesterSortOption,
                }))
              }
            >
              <option value="newest_desc">{t("deals.sortNewestDesc")}</option>
              <option value="newest_asc">{t("deals.sortNewestAsc")}</option>
              <option value="title_asc">{t("deals.sortTitleAsc")}</option>
              <option value="title_desc">{t("deals.sortTitleDesc")}</option>
            </select>
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
            title={t("deals.refreshPlaytester")}
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
          {hasActiveFilters && (
            <button
              type="button"
              className="deals-clear-all-btn"
              onClick={() =>
                setFilters((prev) => ({
                  ...prev,
                  searchQuery: "",
                  platform: "all",
                  genre: "all",
                  status: "all",
                  kind: "all",
                  wishlistOnly: false,
                  hideOwned: false,
                }))
              }
            >
              {t("deals.resetFilters")}
            </button>
          )}
        </div>
      )}

      {loading && (
        <DealsSkeletonGrid density={density} variant="deal" count={10} />
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
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          }
          message={
            processedGames.length === 0 && games.length > 0
              ? t("deals.noMatchingDeals")
              : t("deals.emptyPlaytester")
          }
          onRetry={onReload}
        />
      )}

      {!loading && !error && processedGames.length > 0 && (
        <div className={`deals-grid density-${density}`}>
          {processedGames.map((game, i) => (
            <PlaytesterCard
              key={game.id}
              game={game}
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
