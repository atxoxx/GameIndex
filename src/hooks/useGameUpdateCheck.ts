// Per-game update check for installed games.
//
// Runs once per game page visit: reads the file version from the
// installed executable, searches the download sources for the same
// title, and compares the newest version found in the result titles
// against the installed one. The outcome feeds the "Update available"
// label on the DownloadButton.
//
// The result is cached per game in localStorage with a 6h TTL (same
// convention as the store cache) so page revisits don't re-hit the
// sources. The exe read + source search are both best-effort: any
// failure degrades to "unknown", which simply keeps the default
// Download label.

import { useEffect, useState } from "react";
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

export function useGameUpdateCheck(game: Game | null | undefined): GameUpdateResult {
  const [result, setResult] = useState<GameUpdateResult>({
    status: "idle",
    installedVersion: null,
    latestVersion: null,
  });

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
    const gameName = game.name;
    const steamAppId = game.steamAppId;
    let cancelled = false;

    // Serve a still-fresh cached result instead of re-running the search.
    const cached = loadCache()[gameId];
    if (cached && Date.now() - cached.checkedAt < UPDATE_CACHE_TTL_MS) {
      setResult({
        status: cached.status,
        installedVersion: cached.installedVersion,
        latestVersion: cached.latestVersion,
      });
      return;
    }

    setResult({ status: "checking", installedVersion: null, latestVersion: null });

    void (async () => {
      try {
        const [installedVersion, results] = await Promise.all([
          invoke<string | null>("get_exe_file_version", { path: exePath }),
          // The source search is best-effort — a failed fetch just means
          // no titles to compare against (treated as "unknown").
          searchDownloads(gameName, steamAppId).catch(() => []),
        ]);
        const latestVersion = findLatestVersion(results.map((r) => r.title));
        const status: GameUpdateStatus =
          installedVersion && latestVersion && compareVersions(latestVersion, installedVersion) > 0
            ? "update-available"
            : installedVersion && latestVersion
              ? "up-to-date"
              : "unknown";

        if (!cancelled) {
          setResult({ status, installedVersion, latestVersion });
          const next = loadCache();
          next[gameId] = { status, installedVersion, latestVersion, checkedAt: Date.now() };
          saveCache(next);
        }
      } catch {
        if (!cancelled) {
          setResult({ status: "unknown", installedVersion: null, latestVersion: null });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // Keyed by identity fields only — a re-render with the same game
    // must not re-run the check (and cache hits already short-circuit).
  }, [game?.id, game?.installed, game?.name, game?.steamAppId, game?.path, game?.detectedExe]);

  return result;
}