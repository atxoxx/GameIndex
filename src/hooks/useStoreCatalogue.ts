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
import { tokenizeSearchQuery } from "../components/store/storeSearchQuery";
import {
  parseStoreSearchQuery,
  getStoreSearchQueryFromSearchParams,
  setStoreSearchQueryInSearchParams,
  STORE_SEARCH_QUERY_PARAM,
} from "../components/store/storeSearchQuery";

const MAX_AUTO_EMPTY_FETCHES = 3;

// ─── Tokenized + expanded fields helpers ───────────────────────────────────

function getStoreGameSearchFieldsLower(g: StoreGameSummary): string[] {
  const fields: string[] = [];
  if (g.name) fields.push(g.name.toLowerCase());
  if (g.summary) fields.push(g.summary.toLowerCase());
  for (const x of g.genres ?? []) if (x) fields.push(x.toLowerCase());
  for (const x of g.platforms ?? []) if (x) fields.push(x.toLowerCase());
  const anyG = g as unknown as Record<string, unknown>;
  const themes = anyG["themes"] as string[] | undefined;
  if (Array.isArray(themes)) for (const x of themes) if (x) fields.push(String(x).toLowerCase());
  const gameModes = anyG["gameModes"] as string[] | undefined;
  if (Array.isArray(gameModes)) for (const x of gameModes) if (x) fields.push(String(x).toLowerCase());
  const alt = anyG["alternativeNames"] as string[] | undefined;
  if (Array.isArray(alt)) for (const x of alt) if (x) fields.push(String(x).toLowerCase());
  const coll = anyG["collection"] as string | null | undefined;
  if (coll) fields.push(String(coll).toLowerCase());
  const fr = anyG["franchise"] as string | null | undefined;
  if (fr) fields.push(String(fr).toLowerCase());
  const tags = anyG["tags"] as string[] | undefined;
  if (Array.isArray(tags)) for (const x of tags) if (x) fields.push(String(x).toLowerCase());
  return fields;
}

// Lightweight Levenshtein distance ≤1 check (early exit, no dep).
function levenshteinLeq1(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  // Single char diff
  let i = 0, j = 0, edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i++; j++; }
    else {
      if (edits === 1) return false;
      edits++;
      if (la > lb) i++;
      else if (lb > la) j++;
      else { i++; j++; }
    }
  }
  if (i < la || j < lb) edits++;
  return edits <= 1;
}

function isFuzzyTitleMatch(nameLower: string, tokens: string[]): boolean {
  if (!nameLower || tokens.length === 0) return false;
  const titleWords = nameLower.split(/[\W_]+/).filter(Boolean);
  if (titleWords.length === 0) return false;
  // Every query token must fuzzy-match some title word (AND)
  return tokens.every((tok) =>
    titleWords.some((w) => levenshteinLeq1(tok, w) || w.startsWith(tok) || tok.startsWith(w))
  );
}

/**
 * Tier score for a store game given query + tokens.
 * 0 exact title → 1 prefix → 2 substring → 3 genre → 4 platform → 5 summary/expanded → 6 fuzzy
 */
function getStoreRelevanceScore(g: StoreGameSummary, qLower: string, tokens: string[]): number {
  const nameLower = (g.name || "").toLowerCase();
  if (nameLower === qLower) return 0;
  if (qLower && nameLower.startsWith(qLower)) return 1;
  if (qLower && nameLower.includes(qLower)) return 2;

  const genreLowers = (g.genres ?? []).map((x) => x.toLowerCase());
  if (tokens.length > 0 && tokens.every((tok) => genreLowers.some((f) => f.includes(tok)))) return 3;

  const platformLowers = (g.platforms ?? []).map((x) => x.toLowerCase());
  if (tokens.length > 0 && tokens.every((tok) => platformLowers.some((f) => f.includes(tok)))) return 4;

  const anyG = g as unknown as Record<string, unknown>;
  const expanded: string[] = [];
  if (g.summary) expanded.push(g.summary.toLowerCase());
  const themes = anyG["themes"] as string[] | undefined;
  if (Array.isArray(themes)) for (const x of themes) if (x) expanded.push(String(x).toLowerCase());
  const gameModes = anyG["gameModes"] as string[] | undefined;
  if (Array.isArray(gameModes)) for (const x of gameModes) if (x) expanded.push(String(x).toLowerCase());
  const alt = anyG["alternativeNames"] as string[] | undefined;
  if (Array.isArray(alt)) for (const x of alt) if (x) expanded.push(String(x).toLowerCase());
  const coll = anyG["collection"] as string | null | undefined;
  if (coll) expanded.push(String(coll).toLowerCase());
  const fr = anyG["franchise"] as string | null | undefined;
  if (fr) expanded.push(String(fr).toLowerCase());
  const tags = anyG["tags"] as string[] | undefined;
  if (Array.isArray(tags)) for (const x of tags) if (x) expanded.push(String(x).toLowerCase());

  if (tokens.length > 0 && tokens.every((tok) => expanded.some((f) => f.includes(tok)))) return 5;

  if (isFuzzyTitleMatch(nameLower, tokens)) return 6;

  // Cross-field fallback: if we reached here but every token still appears somewhere across all fields,
  // treat as expanded tier (5) so tokenized AND filtering still returns the game.
  const allFields = getStoreGameSearchFieldsLower(g);
  if (tokens.length > 0 && tokens.every((tok) => allFields.some((f) => f.includes(tok)))) return 5;

  return 999; // unreachable for filtered set
}

// Re-export for testing / external use
export { tokenizeSearchQuery };

/**
 * Local relevance search over an in-memory game list. Tokenized AND across
 * expanded fields (name, genres, platforms, summary, themes, gameModes,
 * alternativeNames, collection, franchise, tags). Returns matches sorted by
 * relevance tier (0 exact→1 prefix→2 substring→3 genre→4 platform→5 summary→6 fuzzy).
 */
export function localSearchGames(
  games: StoreGameSummary[],
  query: string
): StoreGameSummary[] {
  const tokens = tokenizeSearchQuery(query);
  const qLower = query.trim().toLowerCase();
  if (!qLower || tokens.length === 0) return [];
  const scored: { game: StoreGameSummary; score: number; idx: number }[] = [];
  for (let idx = 0; idx < games.length; idx++) {
    const g = games[idx];
    const allFields = getStoreGameSearchFieldsLower(g);
    const everyTokenMatches = tokens.every((tok) => allFields.some((f) => f.includes(tok)));
    const fuzzyOk = !everyTokenMatches && isFuzzyTitleMatch((g.name || "").toLowerCase(), tokens);
    if (!everyTokenMatches && !fuzzyOk) continue;
    const score = getStoreRelevanceScore(g, qLower, tokens);
    if (score === 999) continue;
    scored.push({ game: g, score, idx });
  }
  scored.sort(
    (a, b) => a.score - b.score || (a.game.name || "").localeCompare(b.game.name || "") || a.idx - b.idx
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
 * Client-side sort applied to search results. Tier-first stable sort:
 * primary = relevance tier (0→6), secondary = selected sort within same tier,
 * tertiary = stable original order. Does not destroy IGDB relevance when
 * sort=default (keeps original order within tier).
 */
export function sortSearchResults(
  games: StoreGameSummary[],
  sort: StoreSort,
  query = ""
): StoreGameSummary[] {
  const qLower = query.trim().toLowerCase();
  const tokens = tokenizeSearchQuery(query);
  const useTier = !!qLower && tokens.length > 0;
  // Decorate with tier + idx for stable sort
  const decorated = games.map((g, idx) => ({
    game: g,
    idx,
    tier: useTier ? getStoreRelevanceScore(g, qLower, tokens) : 999,
  }));
  decorated.sort((a, b) => {
    if (useTier && a.tier !== b.tier) return a.tier - b.tier;
    // Within same tier, apply selected sort
    switch (sort) {
      case "rating":
        return (b.game.rating ?? -1) - (a.game.rating ?? -1) || a.idx - b.idx;
      case "popularity":
        return (
          (b.game.totalRatingCount ?? 0) - (a.game.totalRatingCount ?? 0) ||
          (b.game.hypes ?? 0) - (a.game.hypes ?? 0) ||
          a.idx - b.idx
        );
      case "trending":
      case "follows":
        return (b.game.hypes ?? 0) - (a.game.hypes ?? 0) || a.idx - b.idx;
      case "release_new": {
        const av = releaseDateMs(a.game.firstReleaseDate);
        const bv = releaseDateMs(b.game.firstReleaseDate);
        if (av === null && bv === null) return a.idx - b.idx;
        if (av === null) return 1;
        if (bv === null) return -1;
        return bv - av || a.idx - b.idx;
      }
      case "release_old": {
        const av = releaseDateMs(a.game.firstReleaseDate);
        const bv = releaseDateMs(b.game.firstReleaseDate);
        if (av === null && bv === null) return a.idx - b.idx;
        if (av === null) return 1;
        if (bv === null) return -1;
        return av - bv || a.idx - b.idx;
      }
      case "name":
        return (a.game.name || "").localeCompare(b.game.name || "") || a.idx - b.idx;
      case "name_desc":
        return (b.game.name || "").localeCompare(a.game.name || "") || a.idx - b.idx;
      default:
        return a.idx - b.idx;
    }
  });
  return decorated.map((d) => d.game);
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
  /** Immediate flush bypassing debounce (Enter). */
  setSearchQueryImmediate: (q: string) => void;
  /** Apply an external query (e.g., from ?q=) — reacts immediately. */
  applyExternalQuery: (q: string) => void;
  /** Flush current query immediately (Enter bypass). */
  flushSearch: () => void;
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

  // ── URL sync foundation (Lane B) ─────────────────────────────────────
  parseStoreSearchQuery: typeof parseStoreSearchQuery;
  getStoreSearchQueryFromSearchParams: typeof getStoreSearchQueryFromSearchParams;
  setStoreSearchQueryInSearchParams: typeof setStoreSearchQueryInSearchParams;
  STORE_SEARCH_QUERY_PARAM: typeof STORE_SEARCH_QUERY_PARAM;
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
    applyExternalQuery: applyExternalQueryRaw,
    flushSearch: flushSearchRaw,
    setSearchQueryImmediate: setSearchQueryImmediateRaw,
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
    // non-default sort re-orders the merged results locally via tier-first sort.
    const base =
      isSearching
        ? sortSearchResults(visibleGames, sort, searchQuery)
        : visibleGames;
    if (showHidden || hiddenGames.count === 0) return base;
    return base.filter((g) => !hiddenGames.hiddenSet.has(g.slug));
  }, [
    visibleGames,
    isSearching,
    sort,
    searchQuery,
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

  const lastRecordedRef = useRef<string>("");

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

  const handleSearchChangeImmediate = useCallback(
    (value: string) => {
      const q = value.trim();
      if (q.length >= 2) {
        // Immediate record on explicit submit (Enter / external ?q=)
        const lower = q.toLowerCase();
        if (lastRecordedRef.current !== lower) {
          lastRecordedRef.current = lower;
          recentSearches.record(q);
        }
      }
      if (setSearchQueryImmediateRaw) setSearchQueryImmediateRaw(value);
      else (setSearchQuery as unknown as (q: string, opts?: { immediate: boolean }) => void)(value, { immediate: true });
    },
    [setSearchQuery, setSearchQueryImmediateRaw, recentSearches]
  );

  const applyExternalQuery = useCallback(
    (q: string) => {
      if (applyExternalQueryRaw) applyExternalQueryRaw(q);
      else handleSearchChangeImmediate(q);
    },
    [applyExternalQueryRaw, handleSearchChangeImmediate]
  );

  const flushSearch = useCallback(() => {
    const q = searchQuery.trim();
    if (q.length >= 2) {
      const lower = q.toLowerCase();
      if (lastRecordedRef.current !== lower) {
        lastRecordedRef.current = lower;
        recentSearches.record(q);
      }
    }
    if (flushSearchRaw) flushSearchRaw(searchQuery);
    else handleSearchChangeImmediate(searchQuery);
  }, [flushSearchRaw, handleSearchChangeImmediate, searchQuery, recentSearches]);

  // ── Recent searches: record on committed search (debounced 280ms then immediate) ─
  useEffect(() => {
    if (!isSearching) return;
    const q = searchQuery.trim();
    if (q.length < 2) return;
    const lower = q.toLowerCase();
    if (lastRecordedRef.current === lower) return;
    // Debounce with the unified 280ms window so intermediate keystrokes
    // ("el" → "elde" → "elden") don't pollute recents; only the settled
    // query is recorded, but immediately after the debounce (no extra 1s idle).
    const t = setTimeout(() => {
      if (lastRecordedRef.current === lower) return;
      lastRecordedRef.current = lower;
      recentSearches.record(q);
    }, 280);
    return () => clearTimeout(t);
  }, [searchQuery, isSearching, recentSearches]);

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
      // Enter flushes debounce immediately (instant search)
      if (e.key === "Enter" && searchQuery.trim()) {
        const el = document.activeElement as HTMLElement | null;
        if (el?.classList.contains("store-search-input")) {
          // Allow flushSearch to cancel pending debounce and fetch now
          flushSearch();
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
  }, [focusSearch, searchQuery, setSearchQuery, flushSearch]);

  // ── Live filter application ────────────────────────────────────────────
  // Backend facets (genre / platform / year / rating) re-fetch the catalogue
  // as soon as they change — there's no Apply button, so each change is
  // debounced briefly to coalesce slider drags and year-input keystrokes.
  // Refs mirror the latest facet state so the debounced callback reads fresh
  // values instead of a stale closure captured when the timer was scheduled.
  const selectedGenresRef = useRef(selectedGenres);
  const selectedPlatformsRef = useRef(selectedPlatforms);
  const yearMinRef = useRef(yearMin);
  const yearMaxRef = useRef(yearMax);
  const ratingMinRef = useRef(ratingMin);
  const platformIdByNameRef = useRef(platformIdByName);
  useEffect(() => {
    selectedGenresRef.current = selectedGenres;
    selectedPlatformsRef.current = selectedPlatforms;
    yearMinRef.current = yearMin;
    yearMaxRef.current = yearMax;
    ratingMinRef.current = ratingMin;
    platformIdByNameRef.current = platformIdByName;
  }, [
    selectedGenres,
    selectedPlatforms,
    yearMin,
    yearMax,
    ratingMin,
    platformIdByName,
  ]);

  const applyFiltersNow = useCallback(() => {
    clearSearch();
    applyFiltersRaw({
      genres: selectedGenresRef.current,
      // The backend filters by IGDB platform ID, so resolve the selected
      // names against the live platform list. Names that aren't on the
      // list yet (or failed to load) are dropped rather than crashing.
      platforms: selectedPlatformsRef.current
        .map((name) => platformIdByNameRef.current.get(name))
        .filter((id): id is number => id != null),
      yearMin: yearMinRef.current,
      yearMax: yearMaxRef.current,
      ratingMin: ratingMinRef.current,
    });
  }, [clearSearch, applyFiltersRaw]);

  const applyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleApply = useCallback(() => {
    if (applyTimerRef.current) clearTimeout(applyTimerRef.current);
    applyTimerRef.current = setTimeout(() => {
      applyTimerRef.current = null;
      applyFiltersNow();
    }, 300);
  }, [applyFiltersNow]);
  useEffect(() => {
    return () => {
      if (applyTimerRef.current) clearTimeout(applyTimerRef.current);
    };
  }, []);

  const setSelectedGenresLive = useCallback(
    (g: string[]) => {
      setSelectedGenres(g);
      scheduleApply();
    },
    [scheduleApply]
  );
  const setSelectedPlatformsLive = useCallback(
    (p: string[]) => {
      setSelectedPlatforms(p);
      scheduleApply();
    },
    [scheduleApply]
  );
  const setYearRangeLive = useCallback(
    (min: number | null, max: number | null) => {
      setYearMin(min);
      setYearMax(max);
      scheduleApply();
    },
    [scheduleApply]
  );
  const setRatingMinLive = useCallback(
    (r: number | null) => {
      setRatingMin(r);
      scheduleApply();
    },
    [scheduleApply]
  );

  const resetFilters = useCallback(() => {
    if (applyTimerRef.current) clearTimeout(applyTimerRef.current);
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
    setSearchQueryImmediate: handleSearchChangeImmediate,
    applyExternalQuery,
    flushSearch,
    isSearching,
    sort,
    setSort,
    resultsTitle,
    selectedGenres,
    setSelectedGenres: setSelectedGenresLive,
    selectedPlatforms,
    setSelectedPlatforms: setSelectedPlatformsLive,
    platformNames,
    yearMin,
    yearMax,
    setYearRange: setYearRangeLive,
    ratingMin,
    setRatingMin: setRatingMinLive,
    selectedSourceIds,
    setSelectedSourceIds,
    sourceMatchMode,
    setSourceMatchMode,
    sourceCounts,
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
    // Re-export URL helpers for Lane B to sync ?q= without touching internals
    parseStoreSearchQuery,
    getStoreSearchQueryFromSearchParams,
    setStoreSearchQueryInSearchParams,
    STORE_SEARCH_QUERY_PARAM,
  };
}
