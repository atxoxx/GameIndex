import { useCallback, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * useSteamPlayerCount
 * ───────────────────
 * Live Steam concurrent-player count for an appid, extracted from the
 * original `<SteamPlayerCount>` badge so `PlayerCountBadge` can share
 * the exact same polling behavior.
 *
 * Shared store
 * ────────────
 * The same game routinely shows up in several rails/heroes/session rows at
 * once. Each of those used to mount its own 60s interval, its own `window`
 * focus listener and its own invoke — the Activity page alone could open
 * 60+ listeners for one screen. This hook now keeps a module-level store
 * keyed by appid: one timer, one in-flight request and one cached count per
 * appid, fanned out to every subscriber, plus a single global focus
 * listener. The last subscriber to leave drops the entry so the map stays
 * bounded by what is currently on screen.
 *
 * Returns `null` when:
 *  - appId is missing / falsy
 *  - the backend reports `Ok(None)` (Steam-tracked-but-quiet title)
 *  - Steam confirmed 0 players (a "0 playing" badge is noise)
 *  - the fetch errored (offline, invalid appid, …)
 */

/** Keep in lockstep with `PLAYER_COUNT_CACHE_TTL` in `src-tauri/src/lib.rs`. */
const REFRESH_INTERVAL_MS = 60_000;

interface PlayerCountEntry {
  count: number | null;
  listeners: Set<() => void>;
  timer: number | null;
  inFlight: boolean;
}

const entries = new Map<number, PlayerCountEntry>();
let focusBound = false;

function ensureFocusListener() {
  if (focusBound || typeof window === "undefined") return;
  focusBound = true;
  window.addEventListener("focus", () => {
    for (const appId of entries.keys()) {
      void fetchCount(appId);
    }
  });
}

async function fetchCount(appId: number) {
  const entry = entries.get(appId);
  if (!entry || entry.inFlight) return;

  entry.inFlight = true;
  try {
    const result = await invoke<number | null>("get_steam_player_count", {
      appId,
    });
    // Guard against the entry being torn down while the request was in flight.
    if (entries.get(appId) !== entry) return;
    const next = result && result > 0 ? result : null;
    if (next !== entry.count) {
      entry.count = next;
      entry.listeners.forEach((listener) => listener());
    }
  } catch (err) {
    console.warn(`[useSteamPlayerCount] fetch failed for appid ${appId}:`, err);
    if (entries.get(appId) === entry && entry.count !== null) {
      entry.count = null;
      entry.listeners.forEach((listener) => listener());
    }
  } finally {
    entry.inFlight = false;
  }
}

function subscribe(appId: number, listener: () => void): () => void {
  let entry = entries.get(appId);
  if (!entry) {
    entry = { count: null, listeners: new Set(), timer: null, inFlight: false };
    entries.set(appId, entry);
  }
  entry.listeners.add(listener);
  ensureFocusListener();

  if (entry.timer === null) {
    entry.timer = window.setInterval(
      () => void fetchCount(appId),
      REFRESH_INTERVAL_MS
    );
  }
  // The first subscriber for an appid owns the initial fetch.
  if (entry.listeners.size === 1) {
    void fetchCount(appId);
  }

  return () => {
    const current = entries.get(appId);
    if (!current) return;
    current.listeners.delete(listener);
    if (current.listeners.size === 0) {
      if (current.timer !== null) window.clearInterval(current.timer);
      entries.delete(appId);
    }
  };
}

export default function useSteamPlayerCount(appId?: number): number | null {
  const subscribeFn = useCallback(
    (listener: () => void) => (appId ? subscribe(appId, listener) : () => undefined),
    [appId]
  );
  const getSnapshot = useCallback(
    () => (appId ? entries.get(appId)?.count ?? null : null),
    [appId]
  );

  return useSyncExternalStore(subscribeFn, getSnapshot, getSnapshot);
}
