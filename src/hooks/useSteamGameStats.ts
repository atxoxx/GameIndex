import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SteamGameStats } from "../types/game";

/**
 * useSteamGameStats
 *
 *  React hook that fetches the combined `get_steam_game_stats` payload
 *  for a single Steam appid. The payload includes developer / publisher /
 *  release date / price (the `details` block) and the aggregate review
 *  breakdown (the `reviews` block). Each block degrades independently —
 *  a Steam hiccup on `appdetails` blanks only its own fields, leaving
 *  the reviews intact.
 *
 *  Shared between the Game page's stat cards:
 *   - `InfoKpiCard`      (the 4th KPI tile showing price)
 *   - `RatingsKpiCard` / `GameQuickStatsBar` (review score)
 *
 *  The Rust backend caches `appdetails` for 24h, so it's safe for both
 *  consumers to call this hook simultaneously — the second call returns
 *  from cache and never re-hits Steam.
 *
 *  Behavior
 *  ────────
 *  - `appId` of `undefined` returns `null` data and does no fetching.
 *  - `refresh()` re-runs the request without blanking the current data,
 *    so the drawer can show a spinner over live numbers instead of a
 *    skeleton. It resolves when the request settles.
 *  - Stale responses are dropped via a request id, which also covers the
 *    case where a manual refresh races an appid change.
 */

export interface UseSteamGameStatsResult {
  data: SteamGameStats | null;
  isLoading: boolean;
  /** Last fetch error message, or `null`. */
  error: string | null;
  /** Re-fetch in the background. Resolves when the request settles. */
  refresh: () => Promise<void>;
}

export function useSteamGameStats(
  appId: number | undefined
): UseSteamGameStatsResult {
  const [data, setData] = useState<SteamGameStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(
    async (showLoading: boolean) => {
      if (!appId) {
        setData(null);
        setError(null);
        setIsLoading(false);
        return;
      }

      const requestId = ++requestIdRef.current;
      if (showLoading) setIsLoading(true);
      setError(null);

      try {
        const result = await invoke<SteamGameStats>("get_steam_game_stats", {
          appId,
        });
        if (requestIdRef.current !== requestId) return;
        setData(result);
      } catch (err) {
        if (requestIdRef.current !== requestId) return;
        console.warn(
          `[useSteamGameStats] stats fetch failed for appid ${appId}:`,
          err
        );
        setError(String(err));
      } finally {
        if (requestIdRef.current === requestId) setIsLoading(false);
      }
    },
    [appId]
  );

  useEffect(() => {
    if (!appId) {
      requestIdRef.current += 1;
      setData(null);
      setError(null);
      setIsLoading(false);
      return;
    }
    // A different game must not show the previous game's facts while the
    // request is in flight.
    setData(null);
    void load(true);
    return () => {
      // Invalidate any in-flight response from this appid.
      requestIdRef.current += 1;
    };
  }, [appId, load]);

  const refresh = useCallback(async () => {
    await load(false);
  }, [load]);

  return { data, isLoading, error, refresh };
}

/**
 * Format a price-overview cents value into a human-readable string.
 * Renders as "Free" when `isFree`, falls back to a plain `N.NN` number
 * when no currency symbol matches the small map below.
 *
 * Shared between the drawer's context facts and the InfoKpiCard's 4th
 * KPI tile.
 */
export function formatSteamPrice(
  cents: number | null | undefined,
  currency: string | null | undefined,
  isFree: boolean | null | undefined
): string {
  if (isFree) return "Free";
  if (cents == null || cents <= 0) return "—";
  const major = cents / 100;
  const symbols: Record<string, string> = {
    USD: "$",
    EUR: "€",
    GBP: "£",
    JPY: "¥",
    CNY: "¥",
    RUB: "₽",
    BRL: "R$",
    AUD: "A$",
    CAD: "C$",
  };
  const symbol = currency ? symbols[currency] ?? "" : "";
  return `${symbol}${major.toFixed(2)}`;
}
