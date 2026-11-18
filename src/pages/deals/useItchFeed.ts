import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usePersistedJson } from "../../hooks/usePersistedJson";
import type { ItchFeed, ItchGameSummary, ItchOwnedFeed } from "../../types/itch";
import {
  DEFAULT_ITCH_FILTERS,
  ITCH_FILTER_KEY,
  buildItchPayload,
  type ItchFiltersState,
} from "./itchConstants";

/** Matches the Store page's search debounce so typing feels consistent. */
const QUERY_DEBOUNCE_MS = 300;

interface ItchFeedState {
  games: ItchGameSummary[];
  total: number;
  hasMore: boolean;
  nextOffset: number;
  authenticated: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  key: string | null;
}

const EMPTY: ItchFeedState = {
  games: [],
  total: 0,
  hasMore: false,
  nextOffset: 1,
  authenticated: true,
  loading: false,
  loadingMore: false,
  error: null,
  key: null,
};

function message(err: unknown, fallback: string): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return fallback;
}

/**
 * itch.io feed: first page + server-side "load more" pages.
 *
 * The store paginates with `?page=N`, so unlike the other deals sources this
 * one accumulates pages in state. Any filter change (or the debounced search
 * query) starts a fresh first page.
 */
export function useItchFeed(enabled: boolean, fallbackError: string) {
  const [filters, setFilters] = usePersistedJson<ItchFiltersState>(
    ITCH_FILTER_KEY,
    DEFAULT_ITCH_FILTERS,
  );

  const [query, setQuery] = useState(filters.query);
  useEffect(() => {
    const id = window.setTimeout(() => setQuery(filters.query), QUERY_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [filters.query]);

  const payload = useMemo(
    () => ({ ...buildItchPayload({ ...filters, query }), page: 1 }),
    [filters, query],
  );

  const [nonce, setNonce] = useState(0);
  // Start in the loading state so the first paint is a skeleton, not a flash of
  // "no games match these filters" before the effect runs.
  const [state, setState] = useState<ItchFeedState>({ ...EMPTY, loading: true });
  const requestRef = useRef(0);

  const key = `${JSON.stringify(payload)}|${filters.ownedOnly ? "owned" : "browse"}#${nonce}`;
  const payloadRef = useRef(payload);
  payloadRef.current = payload;
  const ownedRef = useRef(filters.ownedOnly);
  ownedRef.current = filters.ownedOnly;

  const loadPage = useCallback(async (page: number): Promise<ItchFeed> => {
    if (ownedRef.current) {
      const feed = await invoke<ItchOwnedFeed>("fetch_itch_owned_games", { page });
      return feed;
    }
    return invoke<ItchFeed>("fetch_itch_games", {
      filters: { ...payloadRef.current, page },
    });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (state.key === key) return;

    const request = ++requestRef.current;
    setState((prev) => ({ ...prev, loading: true, error: null }));

    void (async () => {
      try {
        const feed = await loadPage(1);
        if (request !== requestRef.current) return;
        setState({
          games: feed.games,
          total: feed.total ?? feed.games.length,
          hasMore: feed.hasMore,
          nextOffset: feed.nextOffset,
          authenticated: (feed as ItchOwnedFeed).authenticated ?? true,
          loading: false,
          loadingMore: false,
          error: null,
          key,
        });
      } catch (err) {
        if (request !== requestRef.current) return;
        setState({
          ...EMPTY,
          loading: false,
          error: message(err, fallbackError),
          key: null,
        });
      }
    })();
  }, [enabled, key, state.key, loadPage, fallbackError]);

  const loadMore = useCallback(async () => {
    if (!state.hasMore || state.loading || state.loadingMore) return;
    const request = requestRef.current;
    const page = state.nextOffset;
    setState((prev) => ({ ...prev, loadingMore: true }));
    try {
      const feed = await loadPage(page);
      if (request !== requestRef.current) return;
      setState((prev) => {
        const seen = new Set(prev.games.map((game) => game.id));
        const fresh = feed.games.filter((game) => !seen.has(game.id));
        const games = [...prev.games, ...fresh];
        return {
          ...prev,
          games,
          // Browsing keeps the catalogue's own total; the library has no count
          // printed, so it grows with what is on screen.
          total: Math.max(prev.total, games.length),
          hasMore: feed.hasMore,
          nextOffset: feed.nextOffset,
          loadingMore: false,
        };
      });
    } catch (err) {
      if (request !== requestRef.current) return;
      setState((prev) => ({
        ...prev,
        loadingMore: false,
        error: prev.games.length === 0 ? message(err, fallbackError) : prev.error,
      }));
    }
  }, [state.hasMore, state.loading, state.loadingMore, state.nextOffset, loadPage, fallbackError]);

  const reload = useCallback(() => setNonce((current) => current + 1), []);

  return {
    filters,
    setFilters,
    games: state.games,
    total: state.total,
    hasMore: state.hasMore,
    loading: state.loading,
    loadingMore: state.loadingMore,
    error: state.error,
    authenticated: state.authenticated,
    loadMore,
    reload,
  };
}

export type ItchFeedController = ReturnType<typeof useItchFeed>;
