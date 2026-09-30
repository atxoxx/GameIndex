import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  addSessionTime,
  LS_UNTRACKED_GAMES,
  type Game,
} from "../../types/game";

interface GameExitEvent {
  gameId: string;
  elapsedSeconds: number;
  /** Unix-millisecond timestamp captured at session-end by the Rust
   *  `GameWatcher.finish_session` hook. Stamped onto the game as
   *  `lastPlayed` so the "Continue Playing" rail can surface recently-
   *  active titles. `0` is treated as "unknown" and skipped (an unset
   *  system clock shouldn't burn the field with a poisoned value). */
  finishedAt?: number;
}

/** Payload for the "game-started" event emitted by the watcher
 *  when a game process is passively detected. */
interface GameStartedEvent {
  gameId: string;
  gameName: string;
  detectedExe?: string;
}

/** Payload for the "game-session-lost" / "game-session-restored" events
 *  emitted by the watcher when a session enters / leaves its grace period. */
interface GameSessionLostEvent {
  gameId: string;
  gameName: string;
}

/** Payload for the periodic "game-progress" playtime heartbeat. */
interface GameProgressEvent {
  gameId: string;
  gameName: string;
  elapsedSeconds: number;
}

export function useSessions(options: {
  setGames: React.Dispatch<React.SetStateAction<Game[]>>;
  scheduleWatcherIndexRebuild: () => void;
  untrackedGameIdsRef: React.MutableRefObject<Set<string>>;
}) {
  const { setGames, scheduleWatcherIndexRebuild, untrackedGameIdsRef } = options;

  const [runningGameIds, setRunningGameIds] = useState<string[]>([]);
  const [closingGameIds, setClosingGameIds] = useState<string[]>([]);
  const [liveElapsed, setLiveElapsed] = useState<Record<string, number>>({});
  const [untrackedGameIds, setUntrackedGameIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(LS_UNTRACKED_GAMES);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return new Set(parsed);
      }
    } catch (e) {
      console.error("Failed to load untracked games from localStorage:", e);
    }
    return new Set();
  });

  // Keep external ref in sync on every render (mirrors original direct assignment)
  untrackedGameIdsRef.current = untrackedGameIds;

  const isGameUntracked = useCallback(
    (gameId: string) => untrackedGameIds.has(gameId),
    [untrackedGameIds]
  );

  const toggleGameTracking = useCallback(
    (gameId: string, forceUntracked?: boolean) => {
      setUntrackedGameIds((prev) => {
        const next = new Set(prev);
        const shouldUntrack =
          forceUntracked !== undefined ? forceUntracked : !next.has(gameId);
        if (shouldUntrack) {
          next.add(gameId);
        } else {
          next.delete(gameId);
        }
        try {
          localStorage.setItem(LS_UNTRACKED_GAMES, JSON.stringify([...next]));
        } catch (e) {
          console.error("Failed to save untracked games to localStorage:", e);
        }
        return next;
      });
      scheduleWatcherIndexRebuild();
    },
    [scheduleWatcherIndexRebuild]
  );

  // Listen for game-exited events from the Rust backend
  useEffect(() => {
    const unlisten = listen<GameExitEvent>("game-exited", (event) => {
      const { gameId, elapsedSeconds, finishedAt } = event.payload;

      // Remove from running games list
      setRunningGameIds((prev) => prev.filter((id) => id !== gameId));

      // Clear any grace-period "closing" state and the live timer for this
      // game — it has fully exited now.
      setClosingGameIds((prev) => prev.filter((id) => id !== gameId));
      setLiveElapsed((prev) => {
        if (!(gameId in prev)) return prev;
        const next = { ...prev };
        delete next[gameId];
        return next;
      });

      // If this game is marked as untracked, do not record playtime or update lastPlayed
      if (untrackedGameIdsRef.current.has(gameId)) {
        return;
      }

      // Update session playtime + lastPlayed (drives the "Continue
      // Playing" rail). Only stamp `lastPlayed` when the Rust payload
      // carries a real timestamp (`finishedAt > 0`) so an unset system
      // clock on the backend never poisons the field with the unix
      // epoch. Persistence is automatic — the `useEffect` watching
      // `games` will fire `save_games` with the new value.
      setGames((prev) =>
        prev.map((g) => {
          if (g.id !== gameId) return g;
          const updates: Partial<Game> = {
            playTime: addSessionTime(g.playTime, elapsedSeconds),
          };
          if (finishedAt && finishedAt > 0) {
            updates.lastPlayed = finishedAt;
          }
          return { ...g, ...updates };
        })
      );

      // Persist lastPlayed straight to the SQLite `games` row. The
      // debounced full-library `save_games` would eventually cover it,
      // but this targeted write is the documented hot path for the
      // session-end stamp.
      if (finishedAt && finishedAt > 0) {
        invoke("update_game_last_played", { gameId, lastPlayedMs: finishedAt }).catch(
          () => undefined
        );
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [setGames, untrackedGameIdsRef]);

  // Listen for game-started events (passive detection by the watcher)
  useEffect(() => {
    const unlisten = listen<GameStartedEvent>("game-started", (event) => {
      const { gameId, detectedExe } = event.payload;

      // Add to running games list so the UI shows "now playing"
      setRunningGameIds((prev) => {
        if (prev.includes(gameId)) return prev;
        return [...prev, gameId];
      });

      // Stamp lastPlayed when the watcher first detects a running game
      // so passively-launched titles show up in "Continue Playing".
      // Also persist the detected exe path if one was found.
      setGames((prev) =>
        prev.map((g) =>
          g.id === gameId
            ? { ...g, lastPlayed: Date.now(), ...(detectedExe ? { detectedExe } : {}) }
            : g
        )
      );
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [setGames]);

  // Listen for the watcher's grace-period transitions so the UI can show a
  // "closing" state during launcher hand-offs instead of flipping straight
  // from running to stopped.
  useEffect(() => {
    const unlistenLost = listen<GameSessionLostEvent>("game-session-lost", (event) => {
      const { gameId } = event.payload;
      setClosingGameIds((prev) => (prev.includes(gameId) ? prev : [...prev, gameId]));
    });
    const unlistenRestored = listen<GameSessionLostEvent>(
      "game-session-restored",
      (event) => {
        const { gameId } = event.payload;
        setClosingGameIds((prev) => prev.filter((id) => id !== gameId));
      }
    );
    return () => {
      unlistenLost.then((fn) => fn());
      unlistenRestored.then((fn) => fn());
    };
  }, []);

  // Listen for the watcher's periodic playtime heartbeat so the UI can show
  // a live session timer and Discord presence elapsed stays fresh.
  useEffect(() => {
    const unlisten = listen<GameProgressEvent>("game-progress", (event) => {
      const { gameId, elapsedSeconds } = event.payload;
      setLiveElapsed((prev) => ({ ...prev, [gameId]: elapsedSeconds }));
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return {
    runningGameIds,
    setRunningGameIds,
    closingGameIds,
    setClosingGameIds,
    liveElapsed,
    setLiveElapsed,
    untrackedGameIds,
    setUntrackedGameIds,
    isGameUntracked,
    toggleGameTracking,
  };
}
