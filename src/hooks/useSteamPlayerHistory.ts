import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SteamPlayerHistory } from "../types/game";

/**
 * useSteamPlayerHistory
 *
 *  Fetches the long-range concurrent-player history for a single Steam
 *  appid via the Rust `get_steam_player_history` command (steamcharts.com
 *  feed). Powers the modal's Overview sparkline and Activity chart.
 *
 *  Range
 *  ─────
 *  `rangeDays` is forwarded to the backend: `0` = all-time, otherwise the
 *  trailing N days (7 / 30 / 90 / 180). The backend re-filters its cached
 *  full series in-memory, so switching ranges never re-hits the network
 *  within the 6h cache TTL.
 *
 *  Contract
 *  ────────
 *  - `appId` of `undefined` → `null` data, no fetch.
 *  - `enabled: false` keeps any cached data but avoids fetching. The modal
 *    uses it so the Activity tab does not fetch until it is opened.
 *  - `isLoading` is `true` only while there is no data to show yet. Range
 *    switches and refreshes update in place without flashing a skeleton.
 *  - Errors are surfaced via `error` so the caller can render a quiet
 *    fallback instead of blanking the modal.
 *  - Polling is intentionally absent: the series changes slowly (a new
 *    daily sample at most), so we fetch on mount, on range change, on
 *    window focus, and on explicit `refresh()`.
 */

export type PlayerHistoryRange = 7 | 30 | 90 | 180 | 0;

export interface UseSteamPlayerHistoryResult {
  data: SteamPlayerHistory | null;
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  lastUpdated: number;
  /** Force a refetch for the current range. Resolves when settled. */
  refresh: () => Promise<void>;
}

export function useSteamPlayerHistory(
  appId: number | undefined,
  rangeDays: PlayerHistoryRange,
  enabled = true
): UseSteamPlayerHistoryResult {
  const cancelledRef = useRef(false);
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const [data, setData] = useState<SteamPlayerHistory | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState(0);
  const requestIdRef = useRef(0);

  const appIdRef = useRef(appId);
  appIdRef.current = appId;
  const rangeRef = useRef(rangeDays);
  rangeRef.current = rangeDays;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const hasDataRef = useRef(false);
  hasDataRef.current = data !== null;
  const previousAppIdRef = useRef(appId);

  const fetchNow = useCallback(async () => {
    const id = appIdRef.current;
    const range = rangeRef.current;
    if (!id || !enabledRef.current) {
      if (!id) {
        setData(null);
        setError(null);
      }
      return;
    }
    const requestId = ++requestIdRef.current;
    try {
      const result = await invoke<SteamPlayerHistory>("get_steam_player_history", {
        appId: id,
        rangeDays: range,
      });
      // A range switch while this request was in flight must not let the
      // older series overwrite the newly selected one.
      if (cancelledRef.current || requestId !== requestIdRef.current) return;
      setData(result);
      setError(null);
      setLastUpdated(Date.now());
    } catch (err) {
      if (cancelledRef.current || requestId !== requestIdRef.current) return;
      const msg = typeof err === "string" ? err : "Failed to load player history";
      console.warn(`[useSteamPlayerHistory] fetch failed for appid ${id}:`, msg);
      setError(msg);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!appIdRef.current || !enabledRef.current) return;
    setIsRefreshing(true);
    try {
      await fetchNow();
    } finally {
      if (!cancelledRef.current) setIsRefreshing(false);
    }
  }, [fetchNow]);

  useEffect(() => {
    if (previousAppIdRef.current !== appId) {
      previousAppIdRef.current = appId;
      hasDataRef.current = false;
      setData(null);
      setError(null);
    }
  }, [appId]);

  useEffect(() => {
    if (!appId) {
      setData(null);
      setIsLoading(false);
      setError(null);
      return;
    }
    if (!enabled) {
      // Keep whatever we already cached for this appid, but do not fetch:
      // the modal opens on Overview, so the Activity tab stays idle until
      // the user asks for it.
      return;
    }

    // Only cover the plot with a skeleton on the first load for this appid;
    // range switches keep the previous series on screen while the backend
    // re-filters its in-memory cache.
    setIsLoading(!hasDataRef.current);
    setError(null);
    void fetchNow().finally(() => {
      if (!cancelledRef.current) setIsLoading(false);
    });

    const onFocus = () => void fetchNow();
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
    };
  }, [appId, rangeDays, enabled, fetchNow]);

  return { data, isLoading, isRefreshing, error, lastUpdated, refresh };
}
