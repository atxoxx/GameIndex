// Per-game update check for installed games.
//
// Runs once per game page visit: reads the file version from the
// installed executable, searches the download sources for the same
// title, and compares the newest version found in the result titles
// against the installed one. The outcome feeds the "Update available"
// label on the DownloadButton and the version rows in the Info card.
//
// The result is cached per game in localStorage with a 6h TTL (same
// convention as the store cache) so page revisits don't re-hit the
// sources. The exe read + source search are both best-effort: any
// failure degrades to "unknown", which simply keeps the default
// Download label. `refresh()` clears the cached entry and re-runs the
// check immediately (used by the "Check for updates" button).
//
// Several components on the game page mount this hook for the same
// game (the hero DownloadButton and the Info card). A module-level
// in-flight map dedupes the source search so it fires once per page
// visit instead of once per consumer.

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Game } from "../types/game";
import { compareVersions, findLatestVersion } from "../utils/gameVersions";
import { searchDownloads } from "../context/SourceContext";

export type GameUpdateStatus =
  /** Not an installed game with an exe path — no check runs. */
  | "idle"
  /** Version check in flight. */
  | "checking"
  /** A newer version exists in the sources. */
  | "update-available"
  /** Installed version is current. */
  | "up-to-date"
  /** Installed or latest version couldn't be determined. */
  | "unknown";

export interface GameUpdateResult {
  status: GameUpdateStatus;
  /** File version read from the installed exe (e.g. "1.2.3"). */
  installedVersion: string | null;
  /** Newest version parsed from the download result titles. */
  latestVersion: string | null;
  /** Re-run the check now, ignoring the 6h cache. */
  refresh: () => void;
}

/** localStorage key for the per-game update check cache. */
const UPDATE_CACHE_KEY = "gamelib_game_updates_v1";
/** TTL for cached update checks (mirrors the 6h store-cache convention). */
const UPDATE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

interface UpdateCacheEntry {
  status: GameUpdateStatus;
  installedVersion: string | null;
  latestVersion: string | null;
  checkedAt: number;
}

function loadCache(): Record<string, UpdateCacheEntry> {
  try {
    const raw = localStorage.getItem(UPDATE_CACHE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, UpdateCacheEntry>) : {};
  } catch {
    return {};
  }
}

function saveCache(cache: Record<string, UpdateCacheEntry>) {
  try {
    localStorage.setItem(UPDATE_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Cache is best-effort; a full/quota'd store must not break the check.
  }
}

/** Matches a plain dotted-numeric version (e.g. "1.2.3"). Unreal/Unity
 *  exes often tag version strings like "UE5-CL-0" or "2020.3.49f1 …" that
 *  can't be compared component-wise — treat those as unknown instead of
 *  silently reporting "up-to-date". */
const NUMERIC_VERSION_RE = /^\d+(\.\d+)*$/;

function isComparableVersion(v: string): boolean {
  return NUMERIC_VERSION_RE.test(v.trim());
}

/**
 * Decide the update status from the installed and latest versions.
 * Pure so the comparison logic is unit-testable in isolation.
 */
export function deriveUpdateStatus(
  installedVersion: string | null,
  latestVersion: string | null
): GameUpdateStatus {
  if (
    installedVersion &&
    latestVersion &&
    isComparableVersion(installedVersion) &&
    isComparableVersion(latestVersion) &&
    compareVersions(latestVersion, installedVersion) > 0
  ) {
    return "update-available";
  }
  if (
    installedVersion &&
    latestVersion &&
    isComparableVersion(installedVersion) &&
    isComparableVersion(latestVersion)
  ) {
    return "up-to-date";
  }
  return "unknown";
}

/** Identity fields of a game the check needs (subset of `Game`). */
interface UpdateCheckTarget {
  id: string;
  name: string;
  steamAppId?: number;
  path?: string;
  detectedExe?: string;
}

/** Module-level in-flight dedupe: hero + Info card mount the hook for the
 *  same game on one page; share the running check so the source search
 *  doesn't fire once per consumer. */
const inflightChecks = new Map<string, Promise<UpdateCacheEntry>>();

/** Mounted hook instances, notified by `refresh()` so every consumer on the
 *  page (hero DownloadButton + Info card) re-checks together instead of the
 *  clicked instance updating while the others keep a stale label. */
type RefreshListener = () => void;
const refreshListeners = new Set<RefreshListener>();

async function runUpdateCheck(game: UpdateCheckTarget): Promise<UpdateCacheEntry> {
  const exePath = game.path || game.detectedExe;
  const [installedVersion, results] = await Promise.all([
    invoke<string | null>("get_exe_file_version", { path: exePath }),
    // The source search is best-effort — a failed fetch just means
    // no titles to compare against (treated as "unknown").
    searchDownloads(game.name, game.steamAppId).catch(() => []),
  ]);
  const latestVersion = findLatestVersion(results.map((r) => r.title));
  const entry: UpdateCacheEntry = {
    status: deriveUpdateStatus(installedVersion, latestVersion),
    installedVersion,
    latestVersion,
    checkedAt: Date.now(),
  };
  const next = loadCache();
  next[game.id] = entry;
  saveCache(next);
  return entry;
}

export function useGameUpdateCheck(game: Game | null | undefined): GameUpdateResult {
  const [result, setResult] = useState<Omit<GameUpdateResult, "refresh">>({
    status: "idle",
    installedVersion: null,
    latestVersion: null,
  });
  // Bumped by `refresh()` to force the effect to re-run despite the cache.
  const [refreshKey, setRefreshKey] = useState(0);

  // Register this instance so `refresh()` on any other instance re-runs
  // the check here too (the cache clear is global to the game).
  useEffect(() => {
    const listener: RefreshListener = () => setRefreshKey((k) => k + 1);
    refreshListeners.add(listener);
    return () => {
      refreshListeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (!game || !game.installed) {
      setResult({ status: "idle", installedVersion: null, latestVersion: null });
      return;
    }
    const exePath = game.path || game.detectedExe;
    if (!exePath) {
      setResult({ status: "unknown", installedVersion: null, latestVersion: null });
      return;
    }

    const gameId = game.id;
    let cancelled = false;

    // Serve a still-fresh cached result instead of re-running the search.
    const cached = loadCache()[gameId];
    if (cached && Date.now() - cached.checkedAt < UPDATE_CACHE_TTL_MS) {
      setResult(cached);
      return;
    }

    setResult({ status: "checking", installedVersion: null, latestVersion: null });

    let promise = inflightChecks.get(gameId);
    if (!promise) {
      promise = runUpdateCheck({
        id: gameId,
        name: game.name,
        steamAppId: game.steamAppId,
        path: game.path,
        detectedExe: game.detectedExe,
      });
      inflightChecks.set(gameId, promise);
    }
    promise.then(
      (entry) => {
        if (!cancelled) {
          setResult({
            status: entry.status,
            installedVersion: entry.installedVersion,
            latestVersion: entry.latestVersion,
          });
        }
      },
      () => {
        if (!cancelled) {
          setResult({ status: "unknown", installedVersion: null, latestVersion: null });
        }
      }
    ).finally(() => {
      inflightChecks.delete(gameId);
    });

    return () => {
      cancelled = true;
    };
    // Keyed by identity fields only — a re-render with the same game
    // must not re-run the check (and cache hits already short-circuit).
    // `refreshKey` re-runs the effect deliberately, after clearing the cache.
  }, [game?.id, game?.installed, game?.name, game?.steamAppId, game?.path, game?.detectedExe, refreshKey]);

  const refresh = useCallback(() => {
    if (!game?.id) return;
    const next = loadCache();
    delete next[game.id];
    saveCache(next);
    // Nudge every mounted instance for this game (the listener set includes
    // this one) so the hero DownloadButton and the Info card refresh together.
    refreshListeners.forEach((listener) => listener());
  }, [game?.id]);

  return { ...result, refresh };
}
