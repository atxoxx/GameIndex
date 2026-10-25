import { useCallback, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * useSteamPlayerCount
 * ───────────────────
 * Live Steam concurrent-player count for an appid, plus the per-appid
 * freshness timestamp the player-count modal uses for "Updated 12s ago".
 *
 * Shared store
 * ────────────
 * The same game routinely shows up in several rails/heroes/session rows at
 * once. Each of those used to mount its own 60s interval, its own `window`
 * focus listener and its own invoke — the Activity page alone could open
 * 60+ listeners for one screen. This hook keeps a module-level store keyed
 * by appid: one timer, one in-flight request and one cached reading per
 * appid, fanned out to every subscriber, plus a single global focus
 * listener. The last subscriber to leave drops the entry so the map stays
 * bounded by what is currently on screen.
 *
 * `count` is `null` when the appid is missing, Steam reported no players,
 * or the fetch failed. Steam counts of 0 are treated as "no data" because a
 * "0 playing" badge is noise.
 */

/** Keep in lockstep with `PLAYER_COUNT_CACHE_TTL` in `src-tauri/src/lib.rs`. */
const REFRESH_INTERVAL_MS = 60_000;

export interface SteamPlayerCountInfo {
  /** Live count, or `null` when there is nothing worth showing. */
  count: number | null;
  /** Unix-ms of the last successful fetch. `null` before the first one. */
  updatedAt: number | null;
}

const EMPTY_INFO: SteamPlayerCountInfo = { count: null, updatedAt: null };

interface PlayerCountEntry {
  /** Stable snapshot object so `useSyncExternalStore` never loops. */
  info: SteamPlayerCountInfo;
  listeners: Set<() => void>;
  timer: number | null;
  inFlight: boolean;
  pending: Promise<void> | null;
}

const entries = new Map<number, PlayerCountEntry>();
let focusBound = false;

function publish(entry: PlayerCountEntry, next: SteamPlayerCountInfo) {
  if (entry.info.count === next.count && entry.info.updatedAt === next.updatedAt) {
    return;
  }
  entry.info = next;
  entry.listeners.forEach((listener) => listener());
}

function ensureFocusListener() {
  if (focusBound || typeof window === "undefined") return;
  focusBound = true;
  window.addEventListener("focus", () => {
    for (const appId of entries.keys()) {
      void fetchCount(appId);
    }
  });
}

async function fetchCount(appId: number, force = false): Promise<void> {
  if (!force && typeof document !== "undefined" && document.hidden) return;
  const entry = entries.get(appId);
  if (!entry) return;
  if (entry.inFlight) return entry.pending ?? Promise.resolve();

  entry.inFlight = true;
  entry.pending = (async () => {
    try {
      const result = await invoke<number | null>("get_steam_player_count", {
        appId,
      });
      // Guard against the entry being torn down while the request was in flight.
      if (entries.get(appId) !== entry) return;
      const next = result && result > 0 ? result : null;
      publish(entry, { count: next, updatedAt: Date.now() });
    } catch (err) {
      console.warn(`[useSteamPlayerCount] fetch failed for appid ${appId}:`, err);
      if (entries.get(appId) === entry) {
        publish(entry, EMPTY_INFO);
      }
    } finally {
      entry.inFlight = false;
      entry.pending = null;
    }
  })();

  return entry.pending;
}

function subscribe(appId: number, listener: () => void): () => void {
  let entry = entries.get(appId);
  if (!entry) {
    entry = { info: EMPTY_INFO, listeners: new Set(), timer: null, inFlight: false, pending: null };
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

/** Count + freshness for an appid, shared across every mounted badge. */
export function useSteamPlayerCountInfo(appId?: number): SteamPlayerCountInfo {
  const subscribeFn = useCallback(
    (listener: () => void) => (appId ? subscribe(appId, listener) : () => undefined),
    [appId]
  );
  const getSnapshot = useCallback(
    () => (appId ? entries.get(appId)?.info ?? EMPTY_INFO : EMPTY_INFO),
    [appId]
  );

  return useSyncExternalStore(subscribeFn, getSnapshot, getSnapshot);
}

/**
 * Force a fresh reading for an appid without waiting for the 60s tick.
 * Used by the modal's refresh action; resolves once the request settles.
 */
export async function refreshSteamPlayerCount(appId?: number): Promise<void> {
  if (!appId) return;
  await fetchCount(appId, true);
}

export default function useSteamPlayerCount(appId?: number): number | null {
  return useSteamPlayerCountInfo(appId).count;
}
