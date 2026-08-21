import { useSyncExternalStore } from "react";
import { STORE_SEARCH_QUERY_PARAM as PARAM } from "../../types/game";

/**
 * Tiny external store for the live Store search query.
 *
 * The Store page owns search state in `useStoreCatalogue`, and the game
 * grid/cards can't reach it without threading new props through
 * `StorePage`. `StoreSearchBar` publishes the raw input value here on every
 * change (typing, clear button, Escape, recent/popular chips — all flow
 * through the `value` prop), and `StoreGameGrid` subscribes with
 * `useSyncExternalStore` so card titles can highlight the active search
 * term. The bar and the grid only mount together on the desktop Store
 * page, so there's no cross-page leakage.
 */

let currentQuery = "";
const listeners = new Set<() => void>();

export function publishSearchQuery(query: string): void {
  if (query === currentQuery) return;
  currentQuery = query;
  for (const listener of listeners) listener();
}

function getSnapshot(): string {
  return currentQuery;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Returns the current Store search query; re-renders on every change. */
export function useStoreSearchQuery(): string {
  return useSyncExternalStore(subscribe, getSnapshot);
}

// ─── Tokenization ─────────────────────────────────────────────────────────

/**
 * Split a free-text query into normalized tokens.
 * Lower-cases, trims, splits on whitespace. Empty query → [].
 * Shared single source of truth for Store local search (mirrors
 * libraryFilters.ts tokenization) so grid and suggestions agree on
 * what constitutes a token.
 */
export function tokenizeSearchQuery(query: string): string[] {
  if (!query) return [];
  return query.toLowerCase().trim().split(/\s+/).filter(Boolean);
}

// ─── URL sync foundation ──────────────────────────────────────────────────
// Lane B (StorePage) will use these to keep ?q= in sync without
// touching hook internals. Helpers are pure and framework-agnostic
// so they work with both react-router `useSearchParams` and plain
// `window.location.search`.

/** Re-export param key for convenience (single source of truth lives in types/game.ts). */
export const STORE_SEARCH_QUERY_PARAM = PARAM;

/** Extract the store search query from a raw `location.search` string. */
export function parseStoreSearchQuery(search: string): string {
  try {
    const params = new URLSearchParams(search.startsWith("?") ? search : `?${search}`);
    return params.get(STORE_SEARCH_QUERY_PARAM)?.trim() ?? "";
  } catch {
    return "";
  }
}

/** Extract query from an existing `URLSearchParams` instance. */
export function getStoreSearchQueryFromSearchParams(params: URLSearchParams): string {
  return params.get(STORE_SEARCH_QUERY_PARAM)?.trim() ?? "";
}

/** Write (or clear) the query param on a `URLSearchParams`. Mutates `params`. */
export function setStoreSearchQueryInSearchParams(params: URLSearchParams, query: string): void {
  const trimmed = query.trim();
  if (trimmed) {
    params.set(STORE_SEARCH_QUERY_PARAM, trimmed);
  } else {
    params.delete(STORE_SEARCH_QUERY_PARAM);
  }
}

/** Serialize a query into a `?q=...` string (empty → ""). */
export function serializeStoreSearchQuery(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) return "";
  const p = new URLSearchParams();
  p.set(STORE_SEARCH_QUERY_PARAM, trimmed);
  return `?${p.toString()}`;
}

/**
 * Build a URL with the search query merged into an existing search string.
 * `basePath` should be the pathname (e.g. "/store"); `existingSearch` is the
 * current `location.search` so unrelated params are preserved.
 */
export function buildStoreSearchUrl(
  basePath: string,
  query: string,
  existingSearch?: string
): string {
  const params = new URLSearchParams(existingSearch ?? "");
  setStoreSearchQueryInSearchParams(params, query);
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

// ─── Helper: derive suggestions locally (no network) ───────────────────────
/**
 * Derive up to `limit` suggestions by slicing a pre-fetched result list.
 * Used by the deduplicated `useSearchSuggestions` so the bar doesn't fire
 * a second IGDB call per keystroke — it reuses the grid's search cache.
 */
export function deriveSearchSuggestions<T>(results: T[], limit: number): T[] {
  return results.slice(0, limit);
}
