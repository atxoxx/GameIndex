import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import {
  addSessionTime,
  LS_UNTRACKED_GAMES,
  type Game,
} from "../../types/game";
import {
  LS_DISCORD_SHOW_ART,
  LS_DISCORD_SHOW_PLAYTIME,
  LS_DISCORD_SHOW_STORE_BUTTON,
  LS_DISCORD_SHOW_WEBSITE_BUTTON,
  LS_DISCORD_STATUS_DISPLAY,
  type DiscordStatusDisplay,
} from "../SettingsContext";
import { buildPlayingPresence } from "./discordPlayingPresence";

interface GameExitEvent {
  gameId: string;
  elapsedSeconds: number;
  /** Unix-millisecond timestamp captured at session-end by the Rust
   *  `GameWatcher.finish_session` hook. Stamped onto the game as
   *  `lastPlayed` so the "Continue Playing" rail can surface recently-
   *  active titles. `0` is treated as "unknown" and skipped (an unset
   *  system clock shouldn't burn the field with a poisoned value). */
  finishedAt?: number;
  /** Name of the next game still running (if any) after this one exits,
   *  sent by the Rust watcher so Rich Presence can switch to it. */
  remainingGameName?: string;
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

/** Read a Discord presence visibility flag from localStorage at emit time.
 *  Defaults to ON so unset keys keep the classic behaviour; the Settings
 *  → Discord tab writes these keys synchronously, and this hook lives above
 *  the SettingsProvider so it reads storage directly instead of the hook. */
function lsFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) !== "false";
  } catch {
    return true;
  }
}

/** Read a string-valued presence setting, falling back when unset/invalid.
 *  Same rationale as `lsFlag` — the emitters live above SettingsProvider. */
function lsValue<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const raw = localStorage.getItem(key);
    return raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Shape of the per-option Discord flags read at emit time. */
function discordPresenceOptions() {
  return {
    showArt: lsFlag(LS_DISCORD_SHOW_ART),
    showPlaytime: lsFlag(LS_DISCORD_SHOW_PLAYTIME),
    showWebsiteButton: lsFlag(LS_DISCORD_SHOW_WEBSITE_BUTTON),
    showStoreButton: lsFlag(LS_DISCORD_SHOW_STORE_BUTTON),
    statusDisplay: lsValue<DiscordStatusDisplay>(
      LS_DISCORD_STATUS_DISPLAY,
      "details",
      ["name", "state", "details"],
    ),
  };
}

export function useSessions(options: {
  gamesRef: React.MutableRefObject<Game[]>;
  setGames: React.Dispatch<React.SetStateAction<Game[]>>;
  t: (key: string, params?: Record<string, unknown>) => string;
  scheduleWatcherIndexRebuild: () => void;
  untrackedGameIdsRef: React.MutableRefObject<Set<string>>;
}) {
  const { gamesRef, setGames, t, scheduleWatcherIndexRebuild, untrackedGameIdsRef } = options;

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

  // Tracks which games are currently running (name + start time) so the
  // game-exited handler can hand Rich Presence the next still-running game
  // when the watcher reports a `remainingGameName`.
  const runningSessionsRef = useRef<Map<string, { name: string; startedAt: number }>>(new Map());

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
        runningSessionsRef.current.delete(gameId);
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

      // ── Discord Rich Presence ──────────────────────────────────────
      // Drop the finished session, then either hand the presence thread
      // the next still-running game (watcher sends `remainingGameName`)
      // or tell it the session stopped entirely.
      runningSessionsRef.current.delete(gameId);
      const remainingName = event.payload.remainingGameName;
      if (remainingName) {
        const remaining = gamesRef.current.find((g) => g.name === remainingName);
        const cached = [...runningSessionsRef.current.values()].find((s) => s.name === remainingName);
        const startedAt = cached?.startedAt ?? Date.now();
        if (remaining) runningSessionsRef.current.set(remaining.id, { name: remainingName, startedAt });
        void emit(
          "discord-presence-update",
          buildPlayingPresence(
            remaining,
            remaining?.id ?? "",
            remainingName,
            {
              ...discordPresenceOptions(),
              startedAt,
            },
            t,
          ),
        );
      } else {
        // No game left running: the useDiscordPresence hook emits a
        // "browsing" presence (library/page) so the Discord activity stays
        // continuous instead of clearing.
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [t, gamesRef, setGames, untrackedGameIdsRef]);

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

      // ── Discord Rich Presence ──────────────────────────────────────
      // Record the session start and emit a rich payload (localized text
      // + public https assets + website/store buttons) for the presence
      // thread.
      const startedAt = Date.now();
      runningSessionsRef.current.set(event.payload.gameId, { name: event.payload.gameName, startedAt });
      const game = gamesRef.current.find((g) => g.id === event.payload.gameId);
      void emit(
        "discord-presence-update",
        buildPlayingPresence(
          game,
          event.payload.gameId,
          event.payload.gameName,
          {
            ...discordPresenceOptions(),
            startedAt,
          },
          t,
        ),
      );
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [t, gamesRef, setGames]);

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
    runningSessionsRef,
  };
}
