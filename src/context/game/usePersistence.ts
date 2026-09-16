import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { dedupeGamesById, type Game } from "../../types/game";
import { normalizeGameArtworkUrls } from "../../utils/artworkUrl";
import { planGameSave } from "./savePlanner";
import { syncWatcherIndex } from "./watcherIndexSync";

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
  // Arrays `load_games` handed to state. The first `[games]` effect run
  // after one of them renders is not a user change, so it must not
  // trigger a full-library `save_games` rewrite (which sent ~80 MB back
  // to Rust on every boot, right as the window was being revealed). A
  // WeakSet (not a single ref) because React StrictMode can run the load
  // effect twice, producing two distinct arrays before the first paint.
  const hydratedGamesRef = useRef<WeakSet<Game[]>>(new WeakSet());

  // The array whose contents are known to be on disk. `planGameSave` diffs
  // against it to choose between a targeted `save_game` upsert and a full
  // `save_games` rewrite.
  const lastSavedGamesRef = useRef<Game[] | null>(null);

  // Load persisted games on mount
  useEffect(() => {
    invoke<Game[]>("load_games")
      .then((data) => {
        if (data.length > 0) {
          // Legacy rows may carry `file://` artwork URLs (written before
          // the asset protocol was enabled); the webview refuses to load
          // those, so convert them back to asset-protocol URLs on load.
          const normalized = dedupeGamesById(data.map(normalizeGameArtworkUrls));
          hydratedGamesRef.current.add(normalized);
          lastSavedGamesRef.current = normalized;
          setGames(normalized);
          // Populate the watcher's process index for passive detection.
          // Pass game refs so the background poll loop can match
          // running processes to known games (excluding untracked ones).
          syncWatcherIndex(normalized, untrackedGameIdsRef.current);
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
  // Writes are normally targeted. `planGameSave` diffs the pending array
  // against the last array known to be on disk and upserts only the
  // changed rows in one `save_games_subset` transaction (async, off the
  // GTK main thread); a full-library `save_games` rewrite
  // (DELETE + re-insert every row) is reserved for structural changes
  // (add/remove/reorder) or a diff bigger than `MAX_TARGETED_ROWS`.
  // Metadata enrichment patches one game at a time, so this keeps a
  // scrolled cover fetch from rewriting the whole table.
  //
  // The serialization and scheduling below are load-bearing:
  //
  //  1. RACE: firing an un-serialized write per change let older (smaller)
  //     snapshots complete AFTER newer ones — Tauri runs commands
  //     concurrently — so a stale write could clobber the just-fetched
  //     cover/banner/logo URLs. That's why scrolled-in images looked fine
  //     in-session but vanished on next boot. We serialize writes through an
  //     in-flight guard + dirty flag so only one runs at a time and the
  //     trailing (latest, complete) snapshot is always the last to disk.
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

    const snapshot = pendingGamesRef.current;
    const plan = planGameSave(lastSavedGamesRef.current, snapshot);
    if (plan.kind === "skip") {
      saveInFlightRef.current = false;
      return;
    }

    const write =
      plan.kind === "rows"
        ? invoke("save_games_subset", { games: plan.rows })
        : invoke("save_games", { games: snapshot });

    write
      .then(() => {
        // On failure this stays put, so the next flush re-diffs and retries
        // the same rows instead of treating them as already persisted.
        lastSavedGamesRef.current = snapshot;
      })
      .catch((err) => console.error("Failed to save games:", err))
      .finally(() => {
        saveInFlightRef.current = false;
        if (saveDirtyRef.current) flushSaveRef.current();
      });
  };

  useEffect(() => {
    if (!loadedRef.current) return;
    // The array handed over by `load_games` is the persisted state — only
    // an actual mutation (enrichment, edit, session end) should schedule
    // a write.
    if (hydratedGamesRef.current.has(games)) {
      hydratedGamesRef.current.delete(games);
      return;
    }
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
