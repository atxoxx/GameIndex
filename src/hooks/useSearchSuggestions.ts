import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { StoreGameSummary } from "../types/game";
import { STORE_SEARCH_DEBOUNCE_MS, STORE_SEARCH_SUGGESTION_LIMIT } from "../types/game";
import {
  getCachedSearch,
  setCachedSearch,
  dedupedSearchFetch,
} from "./useStoreCache";

const DEBOUNCE_MS = STORE_SEARCH_DEBOUNCE_MS;

/**
 * Debounced live search suggestions for the store search bar. Returns up
 * to `limit` IGDB matches (cover + name + release year) so the bar can
 * show a live dropdown as the user types. Only fires when
 * `enabled` (the search field is focused / active) and the query is at
 * least 2 characters, minimizing IGDB traffic.
 *
 * Tier C dedup: shares the unified 280ms debounce window with `useStoreGames`
 * and reuses the in-memory search cache / deduped pending map so a single
 * keystroke produces at most ONE `search_store_games` IGDB call — the grid's
 * fetch and the autocomplete slice the same cached 20-result payload.
 * Limit-5 is derived locally from the cached 20 (or fetched with limit 5 when
 * the grid is not active, e.g. ImportModal).
 */
export function useSearchSuggestions(
  query: string,
  enabled = true,
  limit = STORE_SEARCH_SUGGESTION_LIMIT
) {
  const [suggestions, setSuggestions] = useState<StoreGameSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const reqId = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (!enabled || q.length < 2) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    const id = ++reqId.current;
    setLoading(true);
    const t = setTimeout(() => {
      const qLower = q.toLowerCase();
      const dedupKey = `q:${qLower}`;
      // Prefer cached grid results (20) — slice to suggestion limit without network.
      // Grid populates the same dedupKey after its 280ms debounced fetch.
      const cached = getCachedSearch(dedupKey);
      if (cached && id === reqId.current) {
        setSuggestions(cached.slice(0, limit));
        setLoading(false);
        return;
      }
      // Check for limit-specific cached entry (suggestion's own prior fetch)
      const cachedLimited = getCachedSearch(`${dedupKey}|l:${limit}`);
      if (cachedLimited && id === reqId.current) {
        setSuggestions(cachedLimited.slice(0, limit));
        setLoading(false);
        return;
      }

      dedupedSearchFetch(dedupKey, () =>
        invoke<StoreGameSummary[]>("search_store_games", {
          query: q,
          offset: 0,
          limit,
        })
      )
        .then((res) => {
          if (id !== reqId.current) return;
          // Cache both the limit-specific slice and the generic query cache for grid reuse
          const sliced = res.slice(0, limit);
          setCachedSearch(`${dedupKey}|l:${limit}`, sliced);
          // Also prime the generic cache if empty so future grid fetches can slice
          if (!getCachedSearch(dedupKey)) {
            setCachedSearch(dedupKey, res);
          }
          setSuggestions(sliced);
          setLoading(false);
        })
        .catch(() => {
          if (id !== reqId.current) return;
          setSuggestions([]);
          setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, enabled, limit]);

  return { suggestions, loading };
}

/**
 * Pure helper to derive suggestions from an already-fetched result list
 * without firing IGDB again. Used when the caller already owns search
 * results (e.g., `useStoreGames` grid cache).
 */
export function deriveSearchSuggestions(
  results: StoreGameSummary[],
  limit = STORE_SEARCH_SUGGESTION_LIMIT
): StoreGameSummary[] {
  return results.slice(0, limit);
}
