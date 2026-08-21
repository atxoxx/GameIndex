import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useStoreCache } from "./useStoreCache";
import {
  getCachedSearch,
  setCachedSearch,
  dedupedSearchFetch,
  buildSearchCacheKey,
  buildFiltersKey,
} from "./useStoreCache";
import type { StoreGameSummary, StoreSort } from "../types/game";
import type { StoreCategory } from "../types/game";
import { STORE_PAGE_SIZE, STORE_SEARCH_DEBOUNCE_MS } from "../types/game";

const SEARCH_DEBOUNCE_MS = STORE_SEARCH_DEBOUNCE_MS;

/**
 * Active filter set used to narrow the IGDB catalog browse in
 * `fetch_store_games`. The Rust command receives these as optional
 * arguments; an empty value means "no constraint from this facet."
 * Genres/platforms are sent by name (mapped to IGDB IDs in the Rust
 * scraper via static lookup tables), so the frontend doesn't need to
 * mirror IGDB's ID space.
 */
export interface StoreGamesFilters {
  /** Genre names exactly as they appear in `StoreFilterSidebar.GENRES`. */
  genres: string[];
  /** IGDB platform IDs, resolved on the frontend from the live `/platforms` fetch. */
  platforms: number[];
  /** Lower bound on `first_release_date` year (e.g. 2020 → 2020-01-01 UTC). */
  yearMin: number | null;
  /** Upper bound on `first_release_date` year (e.g. 2024 → 2024-12-31 UTC). */
  yearMax: number | null;
  /** Minimum IGDB user/critic rating (0–100 inclusive). */
  ratingMin: number | null;
}

/** Sentinel for "no filter selected from any facet". */
export const EMPTY_STORE_FILTERS: StoreGamesFilters = {
  genres: [],
  platforms: [],
  yearMin: null,
  yearMax: null,
  ratingMin: null,
};

/**
 * Primary data-fetching hook for the Store page.
 *
 * Orchestrates category browsing, live search, infinite-scroll pagination,
 * disk caching (via `useStoreCache`), and error handling.
 *
 * Returns a flat API:
 * - **games** — current list of loaded games
 * - **loading** — true while a fetch is in flight
 * - **error** — error message string or null
 * - **hasMore** — whether more pages are available
 * - **loadMore** — call to fetch the next page (idempotent while loading)
 * - **category** — the active category (trending / popular / top / all)
 * - **setCategory** — switch category (resets the game list)
 * - **searchQuery** — current live-search text
 * - **setSearchQuery** — triggers a debounced search
 * - **clearSearch** — clear the search state without triggering a fetch
 * - **isSearching** — true when a search is active (vs. category browsing)
 */
export function useStoreGames() {
  const { getCategoryCache, setCategoryCache } = useStoreCache();

  // ── State ──────────────────────────────────────────────────────────────
  const [games, setGames] = useState<StoreGameSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [category, setCategoryState] = useState<StoreCategory>("all");
  const [searchQuery, setSearchQueryRaw] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [sort, setSortState] = useState<StoreSort>("default");

  // ── Mutable refs (avoid stale closures) ────────────────────────────────
  const offsetRef = useRef(0);
  const requestIdRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeCategoryRef = useRef<StoreCategory>("all");
  const mountedRef = useRef(true);
  const gamesRef = useRef<StoreGameSummary[]>([]);
  const sortRef = useRef<StoreSort>("default");

  // Keep gamesRef in sync so performFetch can read latest games without
  // needing games in its dependency array (avoids cascading re-creations).
  useEffect(() => {
    gamesRef.current = games;
  }, [games]);

  // Track mount status so we don't setState after unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // ── Helper: perform a fetch (shared by category & search) ──────────────
  const performFetch = useCallback(
    async (
      reqId: number,
      fetchCategory: StoreCategory | null,
      query: string,
      offset: number,
      append: boolean
    ) => {
      if (!mountedRef.current) return;

      setLoading(true);
      setError(null);

      try {
        let results: StoreGameSummary[];
        // Snapshot current filter state so the invoke call is consistent
        // even if React state changes mid-flight. The Rust command treats
        // null/empty as "unconstrained" on each facet.
        const f = filtersRef.current;
        const filterArgs = {
          genres: f.genres.length > 0 ? f.genres : null,
          platforms: f.platforms.length > 0 ? f.platforms : null,
          yearMin: f.yearMin,
          yearMax: f.yearMax,
          ratingMin: f.ratingMin,
          sort: sortRef.current === "default" ? null : sortRef.current,
        };
        if (query) {
          // ── Search with in-memory cache (10 min TTL) ────────────────
          const filtersKey = buildFiltersKey(f);
          const sortVal = sortRef.current;
          const cacheKey = buildSearchCacheKey(query, STORE_PAGE_SIZE, filtersKey, sortVal, offset);
          const dedupKey = `q:${query.trim().toLowerCase()}|f:${filtersKey}|s:${sortVal}`;

          // Serve from cache on initial page (offset 0) if fresh
          if (offset === 0) {
            const cached = getCachedSearch(cacheKey) ?? getCachedSearch(dedupKey);
            if (cached) {
              if (reqId !== requestIdRef.current || !mountedRef.current) return;
              const currentGames = gamesRef.current;
              const newList = append ? [...currentGames, ...cached] : cached;
              setGames(newList);
              offsetRef.current = newList.length;
              setHasMore(cached.length >= STORE_PAGE_SIZE);
              if (mountedRef.current && reqId === requestIdRef.current) setLoading(false);
              return;
            }
          }

          const fetcher = () =>
            invoke<StoreGameSummary[]>("search_store_games", {
              query,
              offset,
              limit: STORE_PAGE_SIZE,
              ...filterArgs,
            });

          // Dedup concurrent identical queries (grid + suggestions share this)
          results = await dedupedSearchFetch(cacheKey, fetcher);

          // Populate caches for reuse by suggestions (derived limit 5)
          if (offset === 0) {
            setCachedSearch(cacheKey, results);
            setCachedSearch(dedupKey, results);
            // Also prime a query-only entry for suggestion derivation when unfiltered
            const qOnly = `q:${query.trim().toLowerCase()}`;
            if (!getCachedSearch(qOnly)) setCachedSearch(qOnly, results);
          }
        } else {
          // Category browsing — pass full filter context.
          results = await invoke<StoreGameSummary[]>("fetch_store_games", {
            category: fetchCategory ?? "all",
            offset,
            limit: STORE_PAGE_SIZE,
            ...filterArgs,
          });
        }

        // Discard stale responses
        if (reqId !== requestIdRef.current || !mountedRef.current) return;

        const currentGames = gamesRef.current;
        const newList = append ? [...currentGames, ...results] : results;

        setGames(newList);
        offsetRef.current = newList.length;
        setHasMore(results.length >= STORE_PAGE_SIZE);

        // Persist to cache (only for unfiltered category browsing).
        //
        // We deliberately skip the cache write when filters are active so
        // a filtered fetch doesn't poison the unfiltered cache for the
        // same category — otherwise the next visit with cleared filters
        // would show the stale filtered slice from disk. Filtered
        // results are short-lived (re-fetched on every Apply click) and
        // aren't worth a disk round-trip.
        const isUnfiltered = !recomputeHasFilters(filtersRef.current);
        const isDefaultSort = sortRef.current === "default";
        if (fetchCategory && !query && isUnfiltered && isDefaultSort) {
          setCategoryCache(fetchCategory, newList);
        }
      } catch (err) {
        if (reqId !== requestIdRef.current || !mountedRef.current) return;
        setError(String(err));
      } finally {
        if (reqId === requestIdRef.current && mountedRef.current) {
          setLoading(false);
        }
      }
    },
    [setCategoryCache]
  );

  // ── Category change: load from cache or fetch fresh ────────────────────
  const setCategory = useCallback(
    (newCategory: StoreCategory) => {
      // Cancel any in-flight request
      requestIdRef.current += 1;
      const reqId = requestIdRef.current;

      // Reset state
      activeCategoryRef.current = newCategory;
      setCategoryState(newCategory);
      setIsSearching(false);
      setSearchQueryRaw("");
      setError(null);

      // Try cache first (only valid for the default sort — a custom sort
      // must always re-fetch since we never persist sorted slices).
      const cached =
        sortRef.current === "default" ? getCategoryCache(newCategory) : null;
      if (cached) {
        setGames(cached);
        offsetRef.current = cached.length;
        setHasMore(cached.length >= STORE_PAGE_SIZE);
        setLoading(false);
        return;
      }

      // No cache — fetch fresh
      setGames([]);
      offsetRef.current = 0;
      performFetch(reqId, newCategory, "", 0, false);
    },
    [getCategoryCache, performFetch]
  );

  // ── Filter state + apply/reset ───────────────────────────────────────
  // `filtersRef` is the source of truth used by `performFetch` so we don't
  // recreate the closure every time filters change. `hasFilters` is the
  // React-visible re-render flag for the chips/clear button affordances.
  const filtersRef = useRef<StoreGamesFilters>(EMPTY_STORE_FILTERS);
  const [hasFilters, setHasFilters] = useState(false);

  const recomputeHasFilters = useCallback((f: StoreGamesFilters) => {
    return (
      f.genres.length > 0 ||
      f.platforms.length > 0 ||
      f.yearMin !== null ||
      f.yearMax !== null ||
      f.ratingMin !== null
    );
  }, []);

  const applyFilters = useCallback(
    (next: StoreGamesFilters) => {
      filtersRef.current = next;
      setHasFilters(recomputeHasFilters(next));
      // Kick a fresh fetch from the active category so the rail re-narrows.
      requestIdRef.current += 1;
      const reqId = requestIdRef.current;
      setGames([]);
      offsetRef.current = 0;
      setHasMore(true);
      setError(null);
      performFetch(reqId, activeCategoryRef.current, "", 0, false);
    },
    [performFetch, recomputeHasFilters]
  );

  const resetFilters = useCallback(() => {
    applyFilters(EMPTY_STORE_FILTERS);
  }, [applyFilters]);

  // ── Sort: update the active sort and re-fetch the current context ──────
  const setSort = useCallback(
    (next: StoreSort) => {
      sortRef.current = next;
      setSortState(next);
      // During a live search the IGDB endpoint ignores sort clauses — the
      // catalogue re-orders the loaded results client-side, so a sort
      // change is a pure state update with no re-fetch. Category browsing
      // re-queries with the new IGDB sort clause.
      if (isSearching && searchQuery) return;
      requestIdRef.current += 1;
      const reqId = requestIdRef.current;
      offsetRef.current = 0;
      setHasMore(true);
      setError(null);
      setGames([]);
      performFetch(reqId, activeCategoryRef.current, "", 0, false);
    },
    [performFetch, isSearching, searchQuery]
  );

  // ── Initial load on mount ──────────────────────────────────────────────
  useEffect(() => {
    const cached = getCategoryCache("all");
    if (cached) {
      setGames(cached);
      offsetRef.current = cached.length;
      setHasMore(cached.length >= STORE_PAGE_SIZE);
      setLoading(false);
    } else {
      const reqId = ++requestIdRef.current;
      performFetch(reqId, "all", "", 0, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Infinite scroll: load next page ────────────────────────────────────
  const loadMore = useCallback(() => {
    if (loading || !hasMore) return;

    const reqId = ++requestIdRef.current;
    const currentCategory = isSearching ? null : activeCategoryRef.current;
    const currentQuery = isSearching ? searchQuery : "";

    performFetch(reqId, currentCategory, currentQuery, offsetRef.current, true);
  }, [loading, hasMore, isSearching, searchQuery, performFetch]);

  // ── Internal: immediate fetch without debounce (Enter bypass) ───────────
  const flushSearchImmediate = useCallback(
    (query: string) => {
      const q = query.trim();
      if (!q) {
        // Empty → restore category (reuse setSearchQuery empty path)
        if (debounceRef.current) {
          clearTimeout(debounceRef.current);
          debounceRef.current = null;
        }
        setIsSearching(false);
        setSearchQueryRaw("");
        requestIdRef.current += 1;
        const cached =
          recomputeHasFilters(filtersRef.current) || sortRef.current !== "default"
            ? null
            : getCategoryCache(activeCategoryRef.current);
        if (cached) {
          setGames(cached);
          offsetRef.current = cached.length;
          setHasMore(cached.length >= STORE_PAGE_SIZE);
          setLoading(false);
        } else {
          const reqId = ++requestIdRef.current;
          setGames([]);
          offsetRef.current = 0;
          performFetch(reqId, activeCategoryRef.current, "", 0, false);
        }
        return;
      }
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      setIsSearching(true);
      const reqId = ++requestIdRef.current;
      offsetRef.current = 0;
      performFetch(reqId, null, q, 0, false);
    },
    [getCategoryCache, performFetch, recomputeHasFilters]
  );

  // ── Search with debounce ───────────────────────────────────────────────
  const setSearchQuery = useCallback(
    (query: string, opts?: { immediate?: boolean }) => {
      setSearchQueryRaw(query);

      if (debounceRef.current) clearTimeout(debounceRef.current);

      if (!query.trim()) {
        // Empty query — go back to category browsing
        setIsSearching(false);
        requestIdRef.current += 1;
        // With facet filters active the category cache is unfiltered and
        // stale — bypass it so clearing search re-fetches the filtered list.
        // A non-default sort also bypasses the cache: sorted slices are
        // never persisted, so the cached list would show default order.
        const cached =
          recomputeHasFilters(filtersRef.current) ||
          sortRef.current !== "default"
            ? null
            : getCategoryCache(activeCategoryRef.current);
        if (cached) {
          setGames(cached);
          offsetRef.current = cached.length;
          setHasMore(cached.length >= STORE_PAGE_SIZE);
          setLoading(false);
        } else {
          // No cache — fetch fresh from the current category
          const reqId = ++requestIdRef.current;
          setGames([]);
          offsetRef.current = 0;
          performFetch(reqId, activeCategoryRef.current, "", 0, false);
        }
        return;
      }

      setIsSearching(true);

      if (opts?.immediate) {
        debounceRef.current = null;
        const reqId = ++requestIdRef.current;
        offsetRef.current = 0;
        performFetch(reqId, null, query, 0, false);
        return;
      }

      debounceRef.current = setTimeout(() => {
        if (!mountedRef.current) return;
        const reqId = ++requestIdRef.current;
        offsetRef.current = 0;
        performFetch(reqId, null, query, 0, false);
      }, SEARCH_DEBOUNCE_MS);
    },
    [getCategoryCache, performFetch, recomputeHasFilters]
  );

  // ── URL sync helper: apply an external query (e.g., from ?q=) ──────────
  const applyExternalQuery = useCallback(
    (query: string) => {
      const q = query.trim();
      // Treat external empty same as clear → restore category
      if (!q) {
        setSearchQuery("", { immediate: true });
        return;
      }
      setSearchQuery(q, { immediate: true });
    },
    [setSearchQuery]
  );

  // ── Clear search (no refetch) ──────────────────────────────────────────
  /**
   * Clear the search box and search state without triggering a fetch:
   * cancels the pending debounce timer and discards any in-flight search
   * response via the request-id bump. Callers (filter apply/reset/preset,
   * Escape-to-clear) handle the re-fetch themselves.
   */
  const clearSearch = useCallback(() => {
    setSearchQueryRaw("");
    setIsSearching(false);
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    // Discard any in-flight response so it can't overwrite the new list.
    requestIdRef.current += 1;
  }, []);

  return {
    games,
    loading,
    error,
    hasMore,
    loadMore,
    category,
    setCategory,
    searchQuery,
    setSearchQuery,
    /** Immediate flush (Enter bypass) — cancels debounce and fetches now. */
    flushSearch: flushSearchImmediate,
    /** Alias for setSearchQuery with immediate:true (URL sync / Enter). */
    setSearchQueryImmediate: flushSearchImmediate,
    /** Apply an external query (e.g. from ?q=) and fetch immediately. */
    applyExternalQuery,
    /** Clear the search box without triggering a fetch. */
    clearSearch,
    isSearching,
    /** Apply the supplied filter set and re-fetch from the active category. */
    applyFilters,
    /** Clear all filters and re-fetch the un-narrowed category list. */
    resetFilters,
    /** True when any filter facet is currently active. */
    hasFilters,
    /** Active sort order for category browsing. */
    sort,
    /** Change the sort order and re-fetch the active category. */
    setSort,
    /** Shared debounce window (280ms) — single source of truth for grid + suggestions. */
    SEARCH_DEBOUNCE_MS,
  };
}
