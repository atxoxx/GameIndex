import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Game } from "../../types/game";
import type { ToastType } from "../ToastContext";

/**
 * Build the entries for the Rust GameWatcher's passive-detection index
 * from a set of games. Shared by the mount-time rebuild, the
 * steam-install-changed refresh, and the debounced post-mutation
 * rebuild in `scheduleWatcherIndexRebuild`.
 */
export function toWatcherRefs(games: Game[], untrackedIds?: Set<string>) {
  return games
    .filter((g) => !untrackedIds?.has(g.id))
    .map((g) => ({
      gameId: g.id,
      gameName: g.name,
      platform: g.platform,
      exePath: g.path || "",
      steamAppId: g.steamAppId ?? null,
      // Emulator ROMs share the emulator exe as their path; the
      // backend excludes them from the passive-detection index so
      // one running emulator process can't record a phantom session
      // for every imported ROM. App-launched sessions still track
      // the exact game_id via the launch path.
      emulatorId: g.emulatorId ?? null,
    }));
}

interface SteamInstallChangedEvent {
  appId: number;
  installed: boolean;
  exePath?: string;
}

export function useWatcherIndex(options: {
  gamesRef: React.MutableRefObject<Game[]>;
  untrackedGameIdsRef: React.MutableRefObject<Set<string>>;
  setGames: React.Dispatch<React.SetStateAction<Game[]>>;
  showToast: (message: string, type: ToastType) => void;
  t: (key: string, params?: Record<string, unknown>) => string;
}) {
  const { gamesRef, untrackedGameIdsRef, setGames, showToast, t } = options;

  // ── Watcher process index ──────────────────────────────────────
  // The Rust GameWatcher passively detects running games by matching
  // process exe paths against an index we push via
  // `rebuild_watcher_index` (see `toWatcherRefs`). Mount builds it
  // once; every library mutation must refresh it too — otherwise a
  // game added via Store/import/edit stays invisible to passive
  // detection until restart, and a removed game's exe keeps matching,
  // so running it emits `game-started` for a deleted gameId (a phantom
  // running entry that only clears when the process exits). A short
  // trailing debounce coalesces burst mutations (Steam sync imports,
  // batch removals) into a single rebuild; the refs are snapshotted
  // from `gamesRef` at fire time so they always reflect the
  // post-mutation library.
  const watcherRebuildTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleWatcherIndexRebuild = useCallback(() => {
    if (watcherRebuildTimerRef.current) return;
    watcherRebuildTimerRef.current = setTimeout(() => {
      watcherRebuildTimerRef.current = null;
      invoke("rebuild_watcher_index", {
        games: toWatcherRefs(gamesRef.current, untrackedGameIdsRef.current),
      }).catch((err) => console.error("Failed to rebuild watcher index:", err));
    }, 500);
  }, [gamesRef, untrackedGameIdsRef]);

  // Listen for Steam installation state changes (game downloaded / installed / uninstalled)
  useEffect(() => {
    const unlisten = listen<SteamInstallChangedEvent>("steam-install-changed", (event) => {
      const { appId, installed, exePath } = event.payload;

      setGames((prev) => {
        let updated = false;
        let updatedGameName = "";

        const next = prev.map((g) => {
          if (g.steamAppId !== appId) return g;
          if (g.installed === installed && (!exePath || g.path === exePath)) return g;
          updated = true;
          updatedGameName = g.name;
          return {
            ...g,
            installed,
            ...(exePath ? { path: exePath } : {}),
          };
        });

        if (updated) {
          if (installed && updatedGameName) {
            showToast(t("game.installedToast", { name: updatedGameName }), "success");
          }
          // Refresh watcher process index so process detection works immediately
          invoke("rebuild_watcher_index", { games: toWatcherRefs(next) }).catch(() => undefined);
        }
        return next;
      });
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [setGames, showToast, t]);

  return { scheduleWatcherIndexRebuild };
}
