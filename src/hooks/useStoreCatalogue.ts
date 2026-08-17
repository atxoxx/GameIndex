import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { useLanguage } from "../context/LanguageContext";
import { useStoreGames } from "./useStoreGames";
import { useIgdbPlatforms } from "./useIgdbPlatforms";
import { useSourceAvailabilityCache } from "./useSourceAvailabilityCache";
import { useDensityContext } from "../context/DensityContext";
import { useSources } from "../context/SourceContext";
import { useWishlistContext } from "../context/WishlistContext";
import { useToast } from "../context/ToastContext";
import { useGames } from "../context/GameContext";
import { useLibraryIndex } from "./useLibraryIndex";
import { useHiddenGames } from "./useHiddenGames";
import { useRecentlyViewed } from "./useRecentlyViewed";
import { useRecentSearches } from "./useRecentSearches";
import { STORE_SOURCE_FILTER_KEY } from "../types/game";
import type {
  GameMetadataResult,
  StoreGameSummary,
  StoreSort,
  ViewDensity,
} from "../types/game";

const MAX_AUTO_EMPTY_FETCHES = 3;

/**
 * Local relevance search over an in-memory game list. Matches the query
 * against the title, genres, platforms, and summary so typing a genre
 * ("action") or platform ("switch") surfaces already-loaded games even
 * when their titles don't contain the words. Returns matches sorted by
 * relevance (exact title → prefix → substring → genre → platform → summary).
 */
function localSearchGames(
  games: StoreGameSummary[],
  query: string
): StoreGameSummary[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: { game: StoreGameSummary; score: number }[] = [];
  for (const g of games) {
    const name = (g.name || "").toLowerCase();
    let score: number | null = null;
    if (name === q) score = 0;
    else if (name.startsWith(q)) score = 1;
    else if (name.includes(q)) score = 2;
    else if ((g.genres || []).some((x) => x.toLowerCase().includes(q))) score = 3;
    else if ((g.platforms || []).some((x) => x.toLowerCase().includes(q))) score = 4;
    else if (g.summary && g.summary.toLowerCase().includes(q)) score = 5;
    if (score !== null) scored.push({ game: g, score });
  }
  scored.sort(
    (a, b) => a.score - b.score || (a.game.name || "").localeCompare(b.game.name || "")
  );
  return scored.map((s) => s.game);
}

/**
 * Combine server-side IGDB name matches with local genre/platform matches,
 * de-duplicating by game id. Server results come first (they're the
 * canonical name matches); local-only matches are appended in relevance
 * order.
 */
function mergeSearchResults(
  server: StoreGameSummary[],
  local: StoreGameSummary[]
): StoreGameSummary[] {
  if (local.length === 0) return server;
  const seen = new Set(server.map((g) => g.id));
  const localOnly = local.filter((g) => !seen.has(g.id));
  return localOnly.length === 0 ? server : [...server, ...localOnly];
}

function releaseDateMs(d: string | null): number | null {
  return d ? new Date(d).getTime() : null;
}

/**
 * Client-side sort applied to search results. The IGDB search endpoint has
 * its own ranking and ignores sort clauses, so a sort change during a live
 * search re-orders the loaded results locally instead of re-fetching.
 * Nulls sort last for both date directions.
 */
function sortSearchResults(
  games: StoreGameSummary[],
  sort: StoreSort
): StoreGameSummary[] {
  const arr = [...games];
  switch (sort) {
    case "rating":
      return arr.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
    case "popularity":
      return arr.sort(
        (a, b) =>
          (b.totalRatingCount ?? 0) - (a.totalRatingCount ?? 0) ||
          (b.hypes ?? 0) - (a.hypes ?? 0)
      );
    case "trending":
    case "follows":
      return arr.sort((a, b) => (b.hypes ?? 0) - (a.hypes ?? 0));
    case "release_new":
      return arr.sort((a, b) => {
        const av = releaseDateMs(a.firstReleaseDate);
        const bv = releaseDateMs(b.firstReleaseDate);
        if (av === null && bv === null) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        return bv - av;
      });
    case "release_old":
      return arr.sort((a, b) => {
        const av = releaseDateMs(a.firstReleaseDate);
        const bv = releaseDateMs(b.firstReleaseDate);
        if (av === null && bv === null) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        return av - bv;
      });
    case "name":
      return arr.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    case "name_desc":
      return arr.sort((a, b) => (b.name || "").localeCompare(a.name || ""));
    default:
      return arr;
  }
}

/**
 * Read the persisted download-source filter selection
 * (`{ sourceIds: string[], matchMode: "all" | "any" }`). Returns `null`
 * when nothing is stored or the payload is unparsable. `matchMode` is
 * validated and falls back to "all" for legacy/garbage values.
 */
function loadStoredSourceFilter(): {
  sourceIds: string[];
  matchMode: "all" | "any";
} | null {
  try {
    const raw = localStorage.getItem(STORE_SOURCE_FILTER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      sourceIds?: unknown;
      matchMode?: unknown;
    };
    return {
      sourceIds: Array.isArray(parsed.sourceIds)
        ? parsed.sourceIds.filter((s): s is string => typeof s === "string")
        : [],
      matchMode:
        parsed.matchMode === "all" || parsed.matchMode === "any"
          ? parsed.matchMode
          : "all",
    };
  } catch {
    return null;
  }
}

export interface StoreCatalogue {
  // ── Data ───────────────────────────────────────────────────────────
  games: StoreGameSummary[];
  displayedGames: StoreGameSummary[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;

  // ── Search / sort ──────────────────────────────────────────────────
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  isSearching: boolean;
  sort: StoreSort;
  setSort: (s: StoreSort) => void;
  resultsTitle: string;

  // ── Filters ────────────────────────────────────────────────────────
  selectedGenres: string[];
  setSelectedGenres: (g: string[]) => void;
  selectedPlatforms: string[];
  setSelectedPlatforms: (p: string[]) => void;
  /** All IGDB platforms (names) for the filter sidebar, fetched live. */
  platformNames: string[];
  yearMin: number | null;
  yearMax: number | null;
  setYearRange: (min: number | null, max: number | null) => void;
  ratingMin: number | null;
  setRatingMin: (r: number | null) => void;
  selectedSourceIds: string[];
  setSelectedSourceIds: (ids: string[]) => void;
  /** Match semantics for the source filter: "all" (AND) or "any" (OR). */
  sourceMatchMode: "all" | "any";
  setSourceMatchMode: (m: "all" | "any") => void;
  /** Real per-source match counts from `useSourceAvailabilityCache`. */
  sourceCounts: Record<string, { checked: number; available: number }>;
  applyFilters: () => void;
  resetFilters: () => void;
  activeFilterCount: number;
  filtersOpen: boolean;
  setFiltersOpen: (open: boolean) => void;
  filtersCollapsed: boolean;
  setFiltersCollapsed: (c: boolean) => void;
  sourceFilterChipCount: number | undefined;
  isSourceFilterActive: boolean;
  sourceChecksPending: number;

  // ── Hidden / recently viewed ───────────────────────────────────────
  showHidden: boolean;
  setShowHidden: (v: boolean) => void;
  hiddenCount: number;
  recentlyViewed: StoreGameSummary[];
  recentSearches: string[];
  removeRecentSearch: (q: string) => void;
  clearRecentSearches: () => void;

  // ── Density ────────────────────────────────────────────────────────
  density: ViewDensity;
  setDensity: (d: ViewDensity) => void;

  // ── Bulk / compare ─────────────────────────────────────────────────
  bulkMode: boolean;
  setBulkMode: (v: boolean) => void;
  selectedSlugs: Set<string>;
  toggleSelect: (g: StoreGameSummary) => void;
  clearSelection: () => void;
  selectAllVisible: () => void;
  selectedGames: StoreGameSummary[];
  wishlistAll: () => void;
  hideAll: () => void;
  addAll: () => Promise<void>;
  addingAll: boolean;
  compareGames: StoreGameSummary[];
  addCompare: (g: StoreGameSummary) => void;
  removeCompare: (slug: string) => void;
  clearCompare: () => void;
  compareOpen: boolean;
  setCompareOpen: (v: boolean) => void;

  // ── Card-level actions ─────────────────────────────────────────────
  onCardClick: (g: StoreGameSummary) => void;
  onHide: (g: StoreGameSummary) => void;
  isInLibrary: (g: StoreGameSummary) => boolean;

  // ── Search focus shortcut ──────────────────────────────────────────
  focusSearch: () => void;
}

/**
 * Central state + behavior owner for the rebuilt Store catalogue.
 *
 * Previously this logic lived inline in `StorePage.tsx` (800+ lines).
 * Extracting it keeps the page component a thin view and makes the
 * (tab-less) browse state easy to reason about and
 * test. The hook reuses `useStoreGames` for data fetching/pagination and
 * the deferred `useSourceAvailabilityCache` for the source filter.
 */
export function useStoreCatalogue(): StoreCatalogue {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { density, setDensity } = useDensityContext();
  const { sources, loading: sourcesLoading } = useSources();
  const wishlist = useWishlistContext();
  const { showToast } = useToast();
  const { addStoreGame } = useGames();

  const {
    games,
    loading,
    error,
    hasMore,
    loadMore,
    searchQuery,
    setSearchQuery,
    isSearching,
    applyFilters: applyFiltersRaw,
    resetFilters: resetFiltersRaw,
    clearSearch,
    sort,
    setSort,
  } = useStoreGames();

  const libraryIndex = useLibraryIndex();
  const hiddenGames = useHiddenGames();
  const recentlyViewed = useRecentlyViewed();
  const recentSearches = useRecentSearches();

  // Full IGDB platform list for the filter sidebar. The sidebar toggles
  // by name (so match counts line up with `games[].platforms`), and we
  // resolve names → IGDB IDs when applying the filter.
  const igdbPlatforms = useIgdbPlatforms();
  const platformNames = useMemo(
    () => igdbPlatforms.map((p) => p.name),
    [igdbPlatforms]
  );
  const platformIdByName = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of igdbPlatforms) map.set(p.name, p.id);
    return map;
  }, [igdbPlatforms]);

  // Snapshot of the last category-browsing list so a live search can match
  // against already-loaded games (by title, genre, or platform) and merge
  // those hits with the fresh IGDB name matches. Updated only while NOT
  // searching so it always holds the pre-search catalogue.
  const lastBrowseGamesRef = useRef<StoreGameSummary[]>([]);
  useEffect(() => {
    if (!isSearching) lastBrowseGamesRef.current = games;
  }, [isSearching, games]);

  const searchMergedGames = useMemo(() => {
    if (!isSearching) return games;
    const q = searchQuery.trim();
    if (!q) return games;
    return mergeSearchResults(
      games,
      localSearchGames(lastBrowseGamesRef.current, q)
    );
  }, [isSearching, games, searchQuery]);

  const [showHidden, setShowHidden] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedSlugs, setSelectedSlugs] = useState<Set<string>>(new Set());
  const [compareGames, setCompareGames] = useState<StoreGameSummary[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [addingAll, setAddingAll] = useState(false);

  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [yearMin, setYearMin] = useState<number | null>(null);
  const [yearMax, setYearMax] = useState<number | null>(null);
  const [ratingMin, setRatingMin] = useState<number | null>(null);

  // Restore the persisted source-filter selection (ids + match mode) on
  // first render. `loadStoredSourceFilter` returns null when unset, so a
  // fresh install still defaults to an empty selection with "all" mode.
  const storedSourceFilter = useMemo(() => loadStoredSourceFilter(), []);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>(
    () => storedSourceFilter?.sourceIds ?? []
  );
  const [sourceMatchMode, setSourceMatchMode] = useState<"all" | "any">(
    () => storedSourceFilter?.matchMode ?? "all"
  );

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filtersCollapsed, setFiltersCollapsed] = useState(false);

  const enabledSourceIds = useMemo(
    () => new Set(sources.filter((s) => s.enabled).map((s) => s.id)),
    [sources]
  );
  useEffect(() => {
    // Only prune against KNOWN sources. `sources` loads asynchronously and
    // starts empty — pruning before it resolves would wipe the restored
    // source filter (and re-persist it as empty) on every mount.
    if (sourcesLoading) return;
    setSelectedSourceIds((prev) => {
      const filtered = prev.filter((id) => enabledSourceIds.has(id));
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [enabledSourceIds, sourcesLoading]);

  // Persist the source-filter selection + match mode across sessions.
  // Empty selection is a valid state, so always write.
  useEffect(() => {
    try {
      localStorage.setItem(
        STORE_SOURCE_FILTER_KEY,
        JSON.stringify({ sourceIds: selectedSourceIds, matchMode: sourceMatchMode })
      );
    } catch {
      /* ignore */
    }
  }, [selectedSourceIds, sourceMatchMode]);

  const {
    visibleGames,
    pending: sourceChecksPending,
    isFilterActive: isSourceFilterActive,
    sourceCounts,
  } = useSourceAvailabilityCache(
    searchMergedGames,
    selectedSourceIds,
    sourceMatchMode
  );

  const displayedGames = useMemo(() => {
    // During a live search the IGDB endpoint ignores sort clauses, so a
    // non-default sort re-orders the merged results locally.
    const base =
      isSearching && sort !== "default"
        ? sortSearchResults(visibleGames, sort)
        : visibleGames;
    if (showHidden || hiddenGames.count === 0) return base;
    return base.filter((g) => !hiddenGames.hiddenSet.has(g.slug));
  }, [
    visibleGames,
    isSearching,
    sort,
    showHidden,
    hiddenGames.hiddenSet,
    hiddenGames.count,
  ]);

  const activeFilterCount = useMemo(
    () =>
      selectedGenres.length +
      selectedPlatforms.length +
      (yearMin != null ? 1 : 0) +
      (yearMax != null ? 1 : 0) +
      (ratingMin != null ? 1 : 0) +
      selectedSourceIds.length,
    [selectedGenres, selectedPlatforms, yearMin, yearMax, ratingMin, selectedSourceIds]
  );

  // ── Empty-page auto-load guard (source filter narrowing) ─────────────
  const autoEmptyFetchesRef = useRef(0);
  const autoEmptyDispatchedRef = useRef(false);
  useEffect(() => {
    if (visibleGames.length > 0) {
      autoEmptyFetchesRef.current = 0;
      autoEmptyDispatchedRef.current = false;
      return;
    }
    if (!isSourceFilterActive) return;
    if (!hasMore || loading) return;
    if (games.length === 0) return;
    // Don't auto-load while availability checks are still narrowing the
    // list — "empty so far" during a cold cache is transient, not a real
    // no-match state, and each loadMore here is a wasted catalogue fetch.
    if (sourceChecksPending > 0) return;
    if (autoEmptyFetchesRef.current >= MAX_AUTO_EMPTY_FETCHES) return;
    if (autoEmptyDispatchedRef.current) return;

    autoEmptyDispatchedRef.current = true;
    autoEmptyFetchesRef.current += 1;
    loadMore();
  }, [isSourceFilterActive, visibleGames.length, hasMore, loading, games.length, sourceChecksPending, loadMore]);

  const onCardClick = useCallback(
    (game: StoreGameSummary) => {
      recentlyViewed.record(game);
      navigate(`/store/${game.slug}`);
    },
    [navigate, recentlyViewed]
  );

  const handleSearchChange = useCallback(
    (value: string) => setSearchQuery(value),
    [setSearchQuery]
  );

  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) return;
    const t = setTimeout(() => recentSearches.record(q), 1000);
    return () => clearTimeout(t);
  }, [searchQuery, recentSearches]);

  const focusSearch = useCallback(() => {
    setFiltersOpen(false);
    setTimeout(() => {
      document.querySelector<HTMLInputElement>(".store-search-input")?.focus();
    }, 0);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape clears a non-empty search while the search input is focused.
      // Route through setSearchQuery("") (NOT clearSearch) so the empty-query
      // restore branch re-fetches/restores the category list — clearSearch
      // alone would leave stale search results that loadMore/setSort could
      // then mix with category pages.
      if (e.key === "Escape" && searchQuery.trim()) {
        const el = document.activeElement as HTMLElement | null;
        if (el?.classList.contains("store-search-input")) {
          e.preventDefault();
          setSearchQuery("");
          return;
        }
      }
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return;
      e.preventDefault();
      focusSearch();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusSearch, searchQuery, setSearchQuery]);

  const applyFilters = useCallback(() => {
    clearSearch();
    applyFiltersRaw({
      genres: selectedGenres,
      // The backend filters by IGDB platform ID, so resolve the selected
      // names against the live platform list. Names that aren't on the
      // list yet (or failed to load) are dropped rather than crashing.
      platforms: selectedPlatforms
        .map((name) => platformIdByName.get(name))
        .filter((id): id is number => id != null),
      yearMin,
      yearMax,
      ratingMin,
    });
  }, [
    clearSearch,
    applyFiltersRaw,
    selectedGenres,
    selectedPlatforms,
    platformIdByName,
    yearMin,
    yearMax,
    ratingMin,
  ]);

  const resetFilters = useCallback(() => {
    clearSearch();
    setSelectedGenres([]);
    setSelectedPlatforms([]);
    setYearMin(null);
    setYearMax(null);
    setRatingMin(null);
    // Deliberately NOT resetting sourceMatchMode — it's a persisted
    // preference (like sort) that stays inert with 0 sources selected
    // and re-applies once >=2 sources are chosen again.
    setSelectedSourceIds([]);
    autoEmptyFetchesRef.current = 0;
    resetFiltersRaw();
  }, [clearSearch, resetFiltersRaw]);

  const handleHide = useCallback((game: StoreGameSummary) => hiddenGames.hide(game.slug), [hiddenGames]);

  const toggleSelect = useCallback((game: StoreGameSummary) => {
    setSelectedSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(game.slug)) next.delete(game.slug);
      else next.add(game.slug);
      return next;
    });
  }, []);

  const selectedGames = useMemo(
    () => displayedGames.filter((g) => selectedSlugs.has(g.slug)),
    [displayedGames, selectedSlugs]
  );
  const clearSelection = useCallback(() => setSelectedSlugs(new Set()), []);

  const addCompare = useCallback((game: StoreGameSummary) => {
    setCompareGames((prev) => {
      if (prev.some((g) => g.slug === game.slug)) return prev;
      if (prev.length >= 3) return prev;
      return [...prev, game];
    });
  }, []);
  const removeCompare = useCallback((slug: string) => {
    setCompareGames((prev) => prev.filter((g) => g.slug !== slug));
  }, []);
  const clearCompare = useCallback(() => setCompareGames([]), []);

  const selectAllVisible = useCallback(() => {
    setSelectedSlugs(new Set(displayedGames.map((g) => g.slug)));
  }, [displayedGames]);

  const wishlistAll = useCallback(() => {
    let added = 0;
    selectedGames.forEach((g) => {
      if (!wishlist.isWishlisted(g.slug)) {
        wishlist.toggle(g);
        added += 1;
      }
    });
    showToast(`Added ${added} game${added !== 1 ? "s" : ""} to wishlist`, "success");
    clearSelection();
  }, [selectedGames, wishlist, showToast, clearSelection]);

  const hideAll = useCallback(() => {
    const count = selectedGames.length;
    selectedGames.forEach((g) => hiddenGames.hide(g.slug));
    showToast(`Hid ${count} game${count !== 1 ? "s" : ""}`, "info");
    clearSelection();
  }, [selectedGames, hiddenGames, showToast, clearSelection]);

  const addAll = useCallback(async () => {
    if (addingAll || selectedGames.length === 0) return;
    setAddingAll(true);
    let added = 0;
    let skipped = 0;
    try {
      for (const g of selectedGames) {
        if (libraryIndex.isInLibrary(g)) {
          skipped += 1;
          continue;
        }
        try {
          const detail = await invoke<GameMetadataResult | null>(
            "get_store_game_detail",
            { slug: g.slug }
          );
          if (detail) {
            await addStoreGame(detail);
            added += 1;
          }
        } catch {
          /* resilience: continue on individual failure */
        }
      }
      const parts: string[] = [];
      if (added > 0) parts.push(`added ${added}`);
      if (skipped > 0) parts.push(`skipped ${skipped} already owned`);
      showToast(
        parts.length > 0
          ? `Library: ${parts.join(", ")}`
          : "No games were added",
        added > 0 ? "success" : "info"
      );
    } finally {
      setAddingAll(false);
      clearSelection();
    }
  }, [addingAll, selectedGames, libraryIndex, addStoreGame, showToast, clearSelection]);

  const sourceFilterChipCount = isSourceFilterActive ? visibleGames.length : undefined;

  const resultsTitle = useMemo(() => {
    if (isSearching) {
      const q = searchQuery.trim();
      return q
        ? t("store.search.resultsFor", { query: q })
        : t("store.resultsTitle.search");
    }
    if (sort === "trending") return t("store.resultsTitle.trending");
    if (sort === "popularity") return t("store.resultsTitle.popular");
    if (sort === "rating") return t("store.resultsTitle.topRated");
    if (sort === "release_new") return t("store.resultsTitle.newReleases");
    if (sort === "follows") return t("store.resultsTitle.mostFollowed");
    return t("store.resultsTitle.allGames");
  }, [isSearching, searchQuery, sort, t]);

  const isInLibrary = useCallback(
    (g: StoreGameSummary) => libraryIndex.isInLibrary(g),
    [libraryIndex]
  );

  return {
    games,
    displayedGames,
    loading,
    error,
    hasMore,
    loadMore,
    searchQuery,
    setSearchQuery: handleSearchChange,
    isSearching,
    sort,
    setSort,
    resultsTitle,
    selectedGenres,
    setSelectedGenres,
    selectedPlatforms,
    setSelectedPlatforms,
    platformNames,
    yearMin,
    yearMax,
    setYearRange: (min, max) => {
      setYearMin(min);
      setYearMax(max);
    },
    ratingMin,
    setRatingMin,
    selectedSourceIds,
    setSelectedSourceIds,
    sourceMatchMode,
    setSourceMatchMode,
    sourceCounts,
    applyFilters,
    resetFilters,
    activeFilterCount,
    filtersOpen,
    setFiltersOpen,
    filtersCollapsed,
    setFiltersCollapsed,
    sourceFilterChipCount,
    isSourceFilterActive,
    sourceChecksPending,
    showHidden,
    setShowHidden,
    hiddenCount: hiddenGames.count,
    recentlyViewed: recentlyViewed.items,
    recentSearches: recentSearches.searches,
    removeRecentSearch: recentSearches.remove,
    clearRecentSearches: recentSearches.clear,
    density,
    setDensity,
    bulkMode,
    setBulkMode,
    selectedSlugs,
    toggleSelect,
    clearSelection,
    selectAllVisible,
    selectedGames,
    wishlistAll,
    hideAll,
    addAll,
    addingAll,
    compareGames,
    addCompare,
    removeCompare,
    clearCompare,
    compareOpen,
    setCompareOpen,
    onCardClick,
    onHide: handleHide,
    isInLibrary,
    focusSearch,
  };
}
