import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useSearchParams } from "react-router-dom";
import { usePresence } from "../context/PresenceContext";
import { useStoreCatalogue } from "../hooks/useStoreCatalogue";
import {
  getStoreSearchQueryFromSearchParams,
  setStoreSearchQueryInSearchParams,
} from "../components/store/storeSearchQuery";
import { setStoreCardHover } from "../components/store/storeCardHover";
import StoreHeader from "../components/store/StoreHeader";
import StoreToolbar from "../components/store/StoreToolbar";
import StoreFilterPanel from "../components/store/StoreFilterPanel";
import StoreFilterChips, {
  type StoreFilterChipType,
} from "../components/store/StoreFilterChips";
import StoreFeaturedHero, {
  type StoreHeroControls,
} from "../components/store/StoreFeaturedHero";
import StoreHeroBanner from "../components/store/StoreHeroBanner";
import StoreQuickPicks from "../components/store/StoreQuickPicks";
import StoreGameGrid from "../components/store/StoreGameGrid";
import StoreBulkBar from "../components/store/StoreBulkBar";
import StoreCompareTray from "../components/store/StoreCompareTray";
import StoreCompareModal from "../components/store/StoreCompareModal";
import PageWidget from "../components/PageWidget";
import type { StoreGameSummary } from "../types/game";
import "../styles/page-store.css";

const HERO_EXPANDED_KEY = "store.hero.manuallyExpanded";
const QUICK_PICKS_KEY = "store.quickPicks.hidden";

function readSessionFlag(key: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeSessionFlag(key: string, value: boolean) {
  if (typeof window === "undefined") return;
  try {
    if (value) window.sessionStorage.setItem(key, "1");
    else window.sessionStorage.removeItem(key);
  } catch {
    // Session storage can be unavailable in hardened webviews.
  }
}

export default function StorePage() {
  const c = useStoreCatalogue();
  const { setStorePlatforms } = usePresence();
  const [searchParams, setSearchParams] = useSearchParams();

  // ── Spotlight collapse ────────────────────────────────────────────────
  // The hero is a browse-on-entry surface, not a permanent masthead. Once it
  // scrolls away, a slim sticky banner takes over so the current pick and
  // its CTA stay reachable while the catalogue keeps the rest of the height.
  const [heroAnchor, setHeroAnchor] = useState<HTMLDivElement | null>(null);
  const heroControlsRef = useRef<StoreHeroControls | null>(null);
  const [heroGame, setHeroGame] = useState<StoreGameSummary | null>(null);
  const [heroSlideCount, setHeroSlideCount] = useState(0);
  const [heroOutOfView, setHeroOutOfView] = useState(false);
  const [heroPinnedOpen, setHeroPinnedOpen] = useState(() =>
    readSessionFlag(HERO_EXPANDED_KEY)
  );
  const heroCollapsed = heroOutOfView && !heroPinnedOpen;

  const handleActiveGameChange = useCallback(
    (game: StoreGameSummary | null, total: number) => {
      setHeroGame(game);
      setHeroSlideCount(total);
    },
    []
  );

  const expandHero = useCallback(() => {
    setHeroPinnedOpen(true);
    writeSessionFlag(HERO_EXPANDED_KEY, true);
    heroAnchor?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [heroAnchor]);

  useEffect(() => {
    if (!heroAnchor) return;

    const setCollapsed = (collapsed: boolean) => {
      setHeroOutOfView(collapsed);
      if (!collapsed && readSessionFlag(HERO_EXPANDED_KEY)) {
        setHeroPinnedOpen(false);
        writeSessionFlag(HERO_EXPANDED_KEY, false);
      }
    };

    // IntersectionObserver keeps this off the scroll path: no per-event
    // getBoundingClientRect, which matters on a grid this tall.
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setCollapsed(!entry.isIntersecting),
      { threshold: 0 }
    );
    observer.observe(heroAnchor);
    return () => observer.disconnect();
  }, [heroAnchor]);

  // ── Quick picks dismissal ─────────────────────────────────────────────
  const [quickPicksHidden, setQuickPicksHidden] = useState(() =>
    readSessionFlag(QUICK_PICKS_KEY)
  );
  const dismissQuickPicks = useCallback(() => {
    setQuickPicksHidden(true);
    writeSessionFlag(QUICK_PICKS_KEY, true);
  }, []);

  const showQuickPicks =
    !quickPicksHidden &&
    !c.bulkMode &&
    c.searchQuery.trim() === "" &&
    c.activeFilterCount === 0;

  // Keep Presence in sync with the selected platform filter (for Discord etc.)
  useEffect(() => {
    setStorePlatforms(c.selectedPlatforms);
  }, [c.selectedPlatforms, setStorePlatforms]);

  // ── URL ↔ catalogue sync ──────────────────────────────────────────────
  // Lane A provides: unified 280ms debounce, deduped IGDB via searchMemoryCache/
  // dedupedSearchFetch, instant Enter via flushSearch/setSearchQueryImmediate/
  // applyExternalQuery. Lane B (this file) owns URL shareability.
  //
  //  - On mount and on searchParams change, consume ?q= and call
  //    catalogue.applyExternalQuery(q) (immediate, no debounce).
  //  - On catalogue.searchQuery change, debounce 300ms and write ?q=
  //    via setSearchParams({ replace: true }) so typing doesn't spam history
  //    but distinct queries are still deep-linkable and back/forward works.
  //  - Empty query removes the param (delete).
  //  - BigScreen overlay navigates via buildStoreSearchUrl("/store", q) which
  //    lands here as ?q=; Lane A's cache ensures no duplicate IGDB fetch
  //    if the same query was fetched recently (10-min TTL).

  const lastAppliedUrlRef = useRef<string | null>(null);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // URL → catalogue (mount + back/forward). Apply externally so highlights
  // and grid show the shared query immediately without a second debounce.
  useEffect(() => {
    const urlQ = getStoreSearchQueryFromSearchParams(searchParams).trim();
    const currentQ = c.searchQuery.trim();
    if (urlQ === currentQ) {
      lastAppliedUrlRef.current = urlQ;
      return;
    }
    // Avoid echo after our own catalogue→URL sync (lastAppliedUrlRef guards)
    if (lastAppliedUrlRef.current === urlQ) return;
    lastAppliedUrlRef.current = urlQ;
    c.applyExternalQuery(urlQ);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, c.applyExternalQuery]);

  // catalogue → URL (debounced 300ms, replaceState-style, shareable)
  useEffect(() => {
    const q = c.searchQuery.trim();
    const currentUrlQ = getStoreSearchQueryFromSearchParams(searchParams).trim();
    if (q === currentUrlQ) {
      lastAppliedUrlRef.current = q;
      return;
    }
    // Cancel any pending URL write
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    // Empty query → remove param immediately (no debounce) so the address bar
    // reflects the cleared state promptly while still using replace.
    if (q === "") {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          setStoreSearchQueryInSearchParams(next, "");
          return next;
        },
        { replace: true }
      );
      lastAppliedUrlRef.current = "";
      return;
    }
    // Debounce non-empty writes to coalesce rapid typing and avoid history spam
    syncTimerRef.current = setTimeout(() => {
      syncTimerRef.current = null;
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          setStoreSearchQueryInSearchParams(next, q);
          return next;
        },
        { replace: true }
      );
      lastAppliedUrlRef.current = q;
    }, 300);
    return () => {
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
      }
    };
  }, [c.searchQuery, searchParams, setSearchParams]);

  const removeFilter = useCallback(
    (type: StoreFilterChipType, value?: string) => {
      if (type === "genre" && value) {
        c.setSelectedGenres(c.selectedGenres.filter((g) => g !== value));
      } else if (type === "platform" && value) {
        c.setSelectedPlatforms(c.selectedPlatforms.filter((p) => p !== value));
      } else if (type === "year") {
        c.setYearRange(null, null);
      } else if (type === "rating") {
        c.setRatingMin(null);
      }
    },
    [c]
  );

  return (
    <div
      className={`store-page page${
        c.bulkMode || c.compareGames.length > 0 ? " store-page--docked" : ""
      }${heroCollapsed ? " store-page--hero-collapsed" : ""}`}
    >
      <StoreHeroBanner
        game={heroGame}
        visible={heroCollapsed}
        canCycle={heroSlideCount > 1}
        onPrev={() => heroControlsRef.current?.prev()}
        onNext={() => heroControlsRef.current?.next()}
        onExpand={expandHero}
        onPickGame={c.onCardClick}
      />

      <PageWidget page="store" widget="storeHeader">
        <div className="ui-item-storeHeader">
          <StoreHeader catalogue={c} onPickGame={c.onCardClick} />
        </div>
      </PageWidget>

      {/* Featured Spotlight Showcase */}
      <PageWidget page="store" widget="hero">
        <div
          ref={setHeroAnchor}
          className="fade-up ui-complete-only store-hero-anchor ui-item-hero"
          style={{ "--d": "120ms" } as CSSProperties}
        >
          <StoreFeaturedHero
            onPickGame={c.onCardClick}
            onActiveGameChange={handleActiveGameChange}
            controlsRef={heroControlsRef}
          />
        </div>
      </PageWidget>

      {showQuickPicks && (
        <StoreQuickPicks
          onPickGame={c.onCardClick}
          onDismiss={dismissQuickPicks}
        />
      )}

      <div className="store-main">
        <PageWidget page="store" widget="storeToolbar">
          <div className="ui-item-storeToolbar">
            <StoreToolbar catalogue={c} />
          </div>
        </PageWidget>

        <StoreFilterChips
          genres={c.selectedGenres}
          platforms={c.selectedPlatforms}
          yearMin={c.yearMin}
          yearMax={c.yearMax}
          ratingMin={c.ratingMin}
          onRemove={removeFilter}
          onClearAll={c.resetFilters}
          onOpenFilters={() => c.setFiltersOpen(true)}
        />

        <PageWidget page="store" widget="storeGrid">
          <div className="ui-item-storeGrid">
            <StoreGameGrid
              games={c.displayedGames}
              loading={c.loading}
              error={c.error}
              hasMore={c.hasMore}
              onLoadMore={c.loadMore}
              onCardClick={c.onCardClick}
              isSourceFilterActive={c.isSourceFilterActive}
              isSourceCheckPending={c.sourceChecksPending > 0}
              isInLibrary={c.isInLibrary}
              onHide={c.onHide}
              onCompare={c.toggleCompare}
              compareSlugs={c.compareSlugs}
              bulkMode={c.bulkMode}
              selectedSlugs={c.selectedSlugs}
              onToggleSelect={c.toggleSelect}
              onClearFilters={c.resetFilters}
              onClearSearch={() => c.applyExternalQuery("")}
              onCardHover={setStoreCardHover}
            />
          </div>
        </PageWidget>
      </div>

      <PageWidget page="store" widget="storeFilters">
        <StoreFilterPanel catalogue={c} />
      </PageWidget>

      {c.bulkMode && (
        <StoreBulkBar
          selectedCount={c.selectedSlugs.size}
          totalCount={c.displayedGames.length}
          onSelectAll={c.selectAllVisible}
          onClear={c.clearSelection}
          onWishlistAll={c.wishlistAll}
          onHideAll={c.hideAll}
          onAddAll={c.addAll}
          onExit={() => {
            c.setBulkMode(false);
            c.clearSelection();
          }}
          addingAll={c.addingAll}
        />
      )}

      <div className="ui-complete-only">
        {!c.bulkMode && c.compareGames.length > 0 && (
          <StoreCompareTray
            games={c.compareGames}
            onRemove={c.removeCompare}
            onClear={c.clearCompare}
            onOpen={() => c.setCompareOpen(true)}
          />
        )}

        {c.compareOpen && c.compareGames.length > 0 && (
          <StoreCompareModal
            games={c.compareGames}
            availableGames={c.games}
            isInLibrary={c.isInLibrary}
            onClose={() => c.setCompareOpen(false)}
            onRemove={c.removeCompare}
            onAdd={c.addCompare}
            onClear={c.clearCompare}
            onOpenGame={(g) => {
              c.setCompareOpen(false);
              c.onCardClick(g);
            }}
          />
        )}
      </div>
    </div>
  );
}
