import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Game } from "../../types/game";
import { normalizeGameArtworkUrls } from "../../utils/artworkUrl";
import { toWatcherRefs } from "./useWatcherIndex";

export function usePersistence(options: {
  games: Game[];
  setGames: React.Dispatch<React.SetStateAction<Game[]>>;
  gamesRef: React.MutableRefObject<Game[]>;
  untrackedGameIdsRef: React.MutableRefObject<Set<string>>;
  /** Called once the initial `load_games` read has settled (success or
   *  failure) so the provider can flip its hydration flag. Page shells use
   *  it to avoid flashing an "empty library" while the async load runs. */
  onLoaded?: () => void;
}) {
  const { games, setGames, untrackedGameIdsRef, onLoaded } = options;

  const loadedRef = useRef(false);

  // Load persisted games on mount
  useEffect(() => {
    invoke<Game[]>("load_games")
      .then((data) => {
        if (data.length > 0) {
          // Legacy rows may carry `file://` artwork URLs (written before
          // the asset protocol was enabled); the webview refuses to load
          // those, so convert them back to asset-protocol URLs on load.
          setGames(data.map(normalizeGameArtworkUrls));
          // Populate the watcher's process index for passive detection.
          // Pass game refs so the background poll loop can match
          // running processes to known games (excluding untracked ones).
          invoke("rebuild_watcher_index", {
            games: toWatcherRefs(data, untrackedGameIdsRef.current),
          }).catch((err) => console.error("Failed to rebuild watcher index:", err));
        }
      })
      .catch((err) => console.error("Failed to load games:", err))
      .finally(() => {
        loadedRef.current = true;
        onLoaded?.();
      });
  }, [setGames, untrackedGameIdsRef]);

  // Persist whenever games change (skip initial empty state before load).
  //
  // `save_games` is a full-library rewrite (DELETE + re-insert every row).
  // The library-card IntersectionObserver enriches covers lazily during a
  // scroll, so a fast scroll fires many `updateGame`s in quick succession.
  // Two problems this block guards against:
  //
  //  1. RACE: firing an un-serialized `save_games` per change let older
  //     (smaller) snapshots complete AFTER newer ones — Tauri runs commands
  //     concurrently — so a stale write could clobber the just-fetched
  //     cover/banner/logo URLs. That's why scrolled-in images looked fine
  //     in-session but vanished on next boot. We serialize saves through an
  //     in-flight guard + dirty flag so only one write runs at a time and
  //     the trailing (latest, complete) snapshot is always the last to disk.
  //
  //  2. STARVATION: a naive reset-on-every-change debounce never fires while
  //     a scroll keeps mutating `games` faster than the delay, so a burst
  //     that ends with an app close never persists. We use a LEADING-window
  //     timer that is *not* reset by later changes, so it always fires
  //     within `SAVE_DEBOUNCE_MS` of the first change in a burst; the chain
  //     then re-saves the final state once the burst settles.
  const SAVE_DEBOUNCE_MS = 300;
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveInFlightRef = useRef(false);
  const saveDirtyRef = useRef(false);
  const pendingGamesRef = useRef<Game[]>(games);

  const flushSaveRef = useRef<() => void>(() => {});
  flushSaveRef.current = () => {
    if (saveInFlightRef.current) {
      // A save is already running with an earlier snapshot; mark dirty so
      // it re-runs with the latest state when it settles.
      saveDirtyRef.current = true;
      return;
    }
    saveInFlightRef.current = true;
    saveDirtyRef.current = false;
    invoke("save_games", { games: pendingGamesRef.current })
      .catch((err) => console.error("Failed to save games:", err))
      .finally(() => {
        saveInFlightRef.current = false;
        if (saveDirtyRef.current) flushSaveRef.current();
      });
  };

  useEffect(() => {
    if (!loadedRef.current) return;
    pendingGamesRef.current = games;
    // Leading-window debounce: schedule once and let it fire; do NOT reset an
    // already-pending timer, otherwise a continuous scroll starves the save.
    if (saveTimerRef.current) return;
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      flushSaveRef.current();
    }, SAVE_DEBOUNCE_MS);
  }, [games]);

  // Flush any pending/coalesced save synchronously-ish when the window is
  // about to close, so a cover fetched moments before quit still persists.
  useEffect(() => {
    const flushNow = () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      if (loadedRef.current) flushSaveRef.current();
    };
    window.addEventListener("beforeunload", flushNow);
    return () => window.removeEventListener("beforeunload", flushNow);
  }, []);
}
