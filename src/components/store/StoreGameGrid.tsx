import { useRef, useEffect, useCallback, useContext } from "react";
import StoreGameCard from "./StoreGameCard";
import { Button } from "../ui";
import { DensityContext } from "../../context/DensityContext";
import { WishlistContext } from "../../context/WishlistContext";
import { useLanguage } from "../../context/LanguageContext";
import { useStoreSearchQuery } from "./storeSearchQuery";
import type { StoreGameSummary } from "../../types/game";

interface StoreGameGridProps {
  games: StoreGameSummary[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  onLoadMore: () => void;
  onCardClick: (game: StoreGameSummary) => void;
  isSourceFilterActive?: boolean;
  isSourceCheckPending?: boolean;
  isInLibrary?: (game: StoreGameSummary) => boolean;
  onHide?: (game: StoreGameSummary) => void;
  onCompare?: (game: StoreGameSummary) => void;
  bulkMode?: boolean;
  selectedSlugs?: Set<string>;
  onToggleSelect?: (game: StoreGameSummary) => void;
  onClearFilters?: () => void;
  /** Clear just the active search query (leaves facet filters intact). Clears URL ?q= via applyExternalQuery("") in StorePage. */
  onClearSearch?: () => void;
}

function CardSkeleton({ list = false }: { list?: boolean }) {
  if (list) {
    return (
      <div className="store-game-card store-game-card-skeleton store-game-card-list">
        <div className="store-card-list-thumb">
          <div className="store-card-cover-skeleton" />
        </div>
        <div className="store-card-list-info">
          <div className="skeleton-line skeleton-title" style={{ width: "60%" }} />
          <div className="skeleton-line skeleton-subtitle" style={{ width: "35%" }} />
        </div>
        <div className="store-card-list-genres">
          <div className="skeleton-line skeleton-subtitle" style={{ width: "80%" }} />
        </div>
        <div className="store-card-list-platforms">
          <div className="skeleton-line skeleton-subtitle" style={{ width: "70%" }} />
        </div>
        <div className="store-card-list-badges">
          <div className="skeleton-line skeleton-subtitle" style={{ width: "40px" }} />
        </div>
        <div className="store-card-list-price">
          <div className="skeleton-line skeleton-subtitle" style={{ width: "50px" }} />
        </div>
        <div className="store-card-list-actions">
          <div className="skeleton-line skeleton-subtitle" style={{ width: "28px" }} />
        </div>
      </div>
    );
  }

  return (
    <div className="store-game-card store-game-card-skeleton">
      <div className="store-card-cover">
        <div className="store-card-cover-skeleton" />
      </div>
      <div className="store-card-body">
        <div className="skeleton-line skeleton-title" />
        <div className="skeleton-line skeleton-subtitle" />
        <div className="skeleton-line skeleton-subtitle short" />
      </div>
    </div>
  );
}

export default function StoreGameGrid({
  games,
  loading,
  error,
  hasMore,
  onLoadMore,
  onCardClick,
  isSourceFilterActive = false,
  isSourceCheckPending = false,
  isInLibrary,
  onHide,
  onCompare,
  bulkMode = false,
  selectedSlugs,
  onToggleSelect,
  onClearFilters,
  onClearSearch,
}: StoreGameGridProps) {
  const { t } = useLanguage();
  const sentinelRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const density = useContext(DensityContext)?.density ?? "cozy";
  const wishlistCtx = useContext(WishlistContext);
  const searchQuery = useStoreSearchQuery();
  const isList = density === "list";
  const isCompact = density === "compact";

  const handleGridKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const grid = gridRef.current;
      if (!grid) return;
      const cards = Array.from(
        grid.querySelectorAll<HTMLElement>(".store-game-card")
      );
      if (cards.length === 0) return;
      const active = document.activeElement as HTMLElement | null;
      const currentIndex = active ? cards.indexOf(active) : -1;

      let cols = 1;
      if (!isList && cards.length > 1) {
        const firstTop = cards[0].offsetTop;
        cols = cards.filter((c) => c.offsetTop === firstTop).length || 1;
      }

      let nextIndex = currentIndex;
      switch (e.key) {
        case "ArrowRight":
          nextIndex = currentIndex < 0 ? 0 : Math.min(currentIndex + 1, cards.length - 1);
          break;
        case "ArrowLeft":
          nextIndex = currentIndex < 0 ? 0 : Math.max(currentIndex - 1, 0);
          break;
        case "ArrowDown":
          nextIndex = currentIndex < 0 ? 0 : Math.min(currentIndex + cols, cards.length - 1);
          break;
        case "ArrowUp":
          nextIndex = currentIndex < 0 ? 0 : Math.max(currentIndex - cols, 0);
          break;
        case "w":
        case "W": {
          if (currentIndex >= 0 && wishlistCtx) {
            const game = games[currentIndex];
            if (game) wishlistCtx.toggle(game);
            e.preventDefault();
          }
          return;
        }
        default:
          return;
      }

      if (nextIndex !== currentIndex && cards[nextIndex]) {
        e.preventDefault();
        cards[nextIndex].focus();
        cards[nextIndex].scrollIntoView({ block: "nearest" });
      }
    },
    [games, wishlistCtx, isList]
  );

  const handleIntersect = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0].isIntersecting && hasMore && !loading) {
        onLoadMore();
      }
    },
    [hasMore, loading, onLoadMore]
  );

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(handleIntersect, {
      rootMargin: "300px",
    });
    observer.observe(sentinel);

    return () => observer.disconnect();
  }, [handleIntersect]);

  // Error state
  if (error && games.length === 0) {
    return (
      <div className="store-empty">
        <div className="store-empty-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <h3>{t("store.errorTitle")}</h3>
        <p>{error}</p>
        <Button variant="secondary" size="sm" onClick={onLoadMore}>
          {t("store.errorTryAgain")}
        </Button>
      </div>
    );
  }

  // Empty state
  if (!loading && games.length === 0) {
    // Search-specific empty state: no matches for the active query.
    const activeQuery = searchQuery.trim();
    if (activeQuery) {
      return (
        <div className="store-empty">
          <div className="store-empty-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
          <h3>{t("store.search.noResults", { query: activeQuery })}</h3>
          <p>{t("store.search.noResultsHint")}</p>
          {onClearSearch && (
            <button type="button" className="store-empty-action" onClick={onClearSearch}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
              <span>{t("store.search.clearSearch")}</span>
            </button>
          )}
        </div>
      );
    }
    if (isSourceFilterActive) {
      return (
        <div className="store-empty">
          <div className="store-empty-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </div>
          <h3>{t("store.noSourceMatch")}</h3>
          <p>
            {isSourceCheckPending
              ? t("store.noSourceMatchHint")
              : t("store.noSourceMatchHintStrict")}
          </p>
          {onClearFilters && (
            <button type="button" className="store-empty-action" onClick={onClearFilters}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
              <span>{t("store.clearFilters")}</span>
            </button>
          )}
        </div>
      );
    }
    return (
      <div className="store-empty">
        <div className="store-empty-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
        </div>
        <h3>{t("store.noGames")}</h3>
        <p>{t("store.noGamesHint")}</p>
        {onClearFilters && (
          <button type="button" className="store-empty-action" onClick={onClearFilters}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            <span>{t("store.clearFilters")}</span>
          </button>
        )}
      </div>
    );
  }

  // Initial loading
  if (loading && games.length === 0) {
    return (
      <div className={`store-game-grid${isList ? " density-list" : isCompact ? " density-compact" : ""}`}>
        {Array.from({ length: 12 }).map((_, i) => (
          <CardSkeleton key={i} list={isList} />
        ))}
      </div>
    );
  }

  return (
    <div className="store-game-grid-container">
      {/* Subtle source-availability pending cue — shown while useSourceAvailabilityCache
          is still checking the current page against the selected download sources.
          Placed above the grid so it reads as a toolbar-adjacent status line rather than
          a card, and hidden when no source filter is active. */}
      {isSourceFilterActive && isSourceCheckPending && (
        <div
          className="store-source-pending"
          role="status"
          aria-live="polite"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "8px 2px 10px",
            fontSize: "13px",
            color: "var(--color-text-muted)",
          }}
        >
          <span
            className="store-spinner"
            aria-hidden="true"
            style={{ width: "14px", height: "14px", borderWidth: "2px" }}
          />
          <span>Filtering by sources…</span>
        </div>
      )}

      {/* Table list header row when in list density */}
      {isList && (
        <div className="store-list-table-header" aria-hidden="true">
          <div className="store-th-thumb" />
          <div className="store-th-title">{t("store.table.title")}</div>
          <div className="store-th-genres">{t("store.table.genres")}</div>
          <div className="store-th-platforms">{t("store.table.platforms")}</div>
          <div className="store-th-rating">{t("store.table.rating")}</div>
          <div className="store-th-price">{t("store.table.price")}</div>
          <div className="store-th-actions">{t("store.table.actions")}</div>
        </div>
      )}

      <div
        className={`store-game-grid${isList ? " density-list" : isCompact ? " density-compact" : ""}`}
        ref={gridRef}
        onKeyDown={handleGridKeyDown}
      >
        {games.map((game, i) => (
          <div
            key={game.id}
            className="store-game-cell"
            style={{ animationDelay: `${Math.min(i, 20) * 20}ms` }}
          >
            <StoreGameCard
              game={game}
              onClick={onCardClick}
              searchQuery={searchQuery}
              inLibrary={isInLibrary ? isInLibrary(game) : false}
              onHide={onHide}
              onCompare={onCompare}
              selectable={bulkMode}
              selected={selectedSlugs ? selectedSlugs.has(game.slug) : false}
              onToggleSelect={onToggleSelect}
            />
          </div>
        ))}
      </div>

      {/* Sentinel div for infinite scroll */}
      <div ref={sentinelRef} className="store-sentinel" />

      {/* Loading more indicator */}
      {loading && games.length > 0 && (
        <div className="store-loading-more">
          <div className="store-spinner" />
          <span>{t("store.loadingMore")}</span>
        </div>
      )}

      {/* End of list message */}
      {!hasMore && games.length > 0 && (
        <p className="store-end-message">
          {t("store.endOfList")}
        </p>
      )}
    </div>
  );
}
