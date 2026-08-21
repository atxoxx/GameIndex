import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { StoreCache, StoreCacheEntry, StoreGameSummary, GameMetadataResult } from "../types/game";
import { STORE_CACHE_TTL_MS, STORE_SEARCH_CACHE_TTL_MS } from "../types/game";

/** Empty cache factory — used as initial state and when cache is absent. */
function emptyCache(): StoreCache {
  return { categories: {}, detailCache: {} };
}

// ─── In-memory search cache (10 min TTL) ───────────────────────────────────
// Key: normalized `query|filters|sort|offset|limit`. Value: results + fetchedAt.
// Module-level singleton so `useStoreGames` and `useSearchSuggestions` share
// the same map and deduplicate per debounced query window.

const searchMemoryCache = new Map<string, { data: StoreGameSummary[]; fetchedAt: number }>();
const searchCacheListeners = new Set<() => void>();
const pendingSearchRequests = new Map<string, Promise<StoreGameSummary[]>>();

function notifySearchCache(): void {
  for (const l of searchCacheListeners) l();
}

export function subscribeSearchCache(listener: () => void): () => void {
  searchCacheListeners.add(listener);
  return () => searchCacheListeners.delete(listener);
}

export function buildSearchCacheKey(
  query: string,
  limit: number,
  filtersKey?: string,
  sort?: string | null,
  offset?: number
): string {
  const q = query.trim().toLowerCase();
  const fk = filtersKey ?? "";
  const s = sort ?? "default";
  const o = offset ?? 0;
  return `q:${q}|f:${fk}|s:${s}|o:${o}|l:${limit}`;
}

/** Simple filtersKey helper for callers that have a StoreGamesFilters object. */
export function buildFiltersKey(filters: {
  genres?: string[];
  platforms?: number[];
  yearMin?: number | null;
  yearMax?: number | null;
  ratingMin?: number | null;
}): string {
  // Stable JSON: sorted genres, sorted platforms
  const genres = [...(filters.genres ?? [])].sort();
  const platforms = [...(filters.platforms ?? [])].sort((a, b) => a - b);
  return JSON.stringify({
    g: genres,
    p: platforms,
    yMin: filters.yearMin ?? null,
    yMax: filters.yearMax ?? null,
    rMin: filters.ratingMin ?? null,
  });
}

export function getCachedSearch(key: string): StoreGameSummary[] | null {
  const entry = searchMemoryCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt >= STORE_SEARCH_CACHE_TTL_MS) {
    searchMemoryCache.delete(key);
    return null;
  }
  return entry.data;
}

export function setCachedSearch(key: string, data: StoreGameSummary[]): void {
  searchMemoryCache.set(key, { data, fetchedAt: Date.now() });
  notifySearchCache();
}

export function clearSearchCache(): void {
  searchMemoryCache.clear();
  notifySearchCache();
}

export function isSearchCacheFresh(key: string): boolean {
  const entry = searchMemoryCache.get(key);
  if (!entry) return false;
  return Date.now() - entry.fetchedAt < STORE_SEARCH_CACHE_TTL_MS;
}

/**
 * Deduped fetch: if a request for `key` is already in-flight, reuse its Promise
 * instead of firing a second IGDB hit. This is the core dedup for
 * grid+suggestions sharing the same debounced query window.
 */
export function dedupedSearchFetch(
  key: string,
  fetcher: () => Promise<StoreGameSummary[]>
): Promise<StoreGameSummary[]> {
  const existing = pendingSearchRequests.get(key);
  if (existing) return existing;
  const p = fetcher().finally(() => {
    pendingSearchRequests.delete(key);
  });
  pendingSearchRequests.set(key, p);
  return p;
}

/**
 * Hook for persisting the store browser cache to disk via the Tauri backend.
 *
 * On mount it loads the cache from `<app_data>/store_cache.json`.  The
 * returned `saveCache` function writes the entire cache object back to disk.
 *
 * Cached entries are considered **stale** after `STORE_CACHE_TTL_MS` (6 h).
 * The caller is responsible for checking TTL with `isStale()` before using
 * cached data.
 */
export function useStoreCache() {
  const [cache, setCache] = useState<StoreCache>(emptyCache);
  const loadedRef = useRef(false);

  // ── Load cache from disk on mount ──────────────────────────────────────
  useEffect(() => {
    invoke<string>("load_store_cache")
      .then((raw) => {
        if (raw) {
          try {
            const parsed: StoreCache = JSON.parse(raw);
            setCache(parsed);
          } catch {
            // Corrupt cache — start fresh
            setCache(emptyCache());
          }
        }
      })
      .catch((err) => console.error("Failed to load store cache:", err))
      .finally(() => {
        loadedRef.current = true;
      });
  }, []);

  // ── Save helper — writes the full cache to disk ────────────────────────
  const saveCache = useCallback(
    async (newCache: StoreCache) => {
      setCache(newCache);
      try {
        await invoke("save_store_cache", {
          data: JSON.stringify(newCache),
        });
      } catch (err) {
        console.error("Failed to save store cache:", err);
      }
    },
    []
  );

  // ── Check if a cached entry is still fresh ─────────────────────────────
  const isFresh = useCallback((entry: StoreCacheEntry<unknown> | undefined): boolean => {
    if (!entry || !entry.fetchedAt) return false;
    return Date.now() - entry.fetchedAt < STORE_CACHE_TTL_MS;
  }, []);

  // ── Retrieve category games from cache (returns null if missing/stale) ─
  const getCategoryCache = useCallback(
    (category: string): StoreGameSummary[] | null => {
      const entry = cache.categories[category];
      return isFresh(entry) ? entry.data : null;
    },
    [cache, isFresh]
  );

  // ── Store category games in cache ──────────────────────────────────────
  const setCategoryCache = useCallback(
    async (category: string, games: StoreGameSummary[]) => {
      const next: StoreCache = {
        ...cache,
        categories: {
          ...cache.categories,
          [category]: { data: games, fetchedAt: Date.now() },
        },
      };
      await saveCache(next);
    },
    [cache, saveCache]
  );

  // ── Retrieve a detail entry from cache ─────────────────────────────────
  const getDetailCache = useCallback(
    (slug: string) => {
      const entry = cache.detailCache[slug];
      return isFresh(entry) ? entry.data : null;
    },
    [cache, isFresh]
  );

  // ── Store a detail entry in cache ──────────────────────────────────────
  const setDetailCache = useCallback(
    async (slug: string, data: GameMetadataResult) => {
      const next: StoreCache = {
        ...cache,
        detailCache: {
          ...cache.detailCache,
          [slug]: { data, fetchedAt: Date.now() },
        },
      };
      await saveCache(next);
    },
    [cache, saveCache]
  );

  // ── In-memory search cache helpers (reactive wrappers) ─────────────────
  const getSearchCache = useCallback((key: string): StoreGameSummary[] | null => {
    return getCachedSearch(key);
  }, []);

  const setSearchCache = useCallback((key: string, data: StoreGameSummary[]) => {
    setCachedSearch(key, data);
  }, []);

  return {
    cache,
    saveCache,
    isFresh,
    getCategoryCache,
    setCategoryCache,
    getDetailCache,
    setDetailCache,
    // ── Search memory cache ──────────────────────────────────────────────
    getSearchCache,
    setSearchCache,
    clearSearchCache: useCallback(() => clearSearchCache(), []),
    isSearchCacheFresh: useCallback((key: string) => isSearchCacheFresh(key), []),
    buildSearchCacheKey,
    buildFiltersKey,
  };
}
