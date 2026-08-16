import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import {
  addSessionTime,
  gameNameFromPath,
  extractSteamAppId,
  extractSteamAppIdFromWebsites,
  LS_UNTRACKED_GAMES,
  type Game,
  type GameMetadataResult,
  type IgdbReview,
  sanitizeSessionMetrics,
  type SessionMetrics,
} from "../types/game";
import { useToast } from "./ToastContext";
import { useLanguage } from "./LanguageContext";
import {
  isSplashEnabled,
  useSplash,
  type SplashPayload,
} from "./SplashContext";
import type { GameSession } from "../types/game";

/**
 * Shape of a `sessions` table row as returned by the Rust backend.
 * Mirrors the serde mapping on `db::sessions::SessionRecord`.
 */
interface DbSessionRecord {
  id: number;
  gameId: string;
  gameName?: string | null;
  startedAt: number;
  endedAt?: number | null;
  elapsedSeconds?: number | null;
  avgFps?: number | null;
  avgCpu?: number | null;
  avgGpu?: number | null;
  avgRam?: number | null;
  metricsJson?: string | null;
}

/** Map a SQLite session row to the frontend GameSession shape. */
function mapDbSession(r: DbSessionRecord): GameSession | null {
  const elapsed = r.elapsedSeconds ?? 0;
  if (elapsed < 60) return null;
  const date = r.endedAt
    ? new Date(r.endedAt).toISOString()
    : new Date(r.startedAt).toISOString();
  const durationMin = Math.round(elapsed / 60);
  let metrics: SessionMetrics | undefined;
  if (r.metricsJson) {
    try {
      metrics = sanitizeSessionMetrics(JSON.parse(r.metricsJson) as SessionMetrics);
    } catch {
      // Fall through to reconstructing from the average columns.
    }
  }
  if (!metrics && r.avgFps != null) {
    metrics = {
      avgFps: r.avgFps,
      avgCpuUsage: r.avgCpu ?? 0,
      avgGpuUsage: r.avgGpu ?? 0,
      avgRamUsage: r.avgRam ?? 0,
      avgCpuTemp: 0,
      avgGpuTemp: 0,
      minFps: 0,
      maxFps: 0,
      resolution: "",
      samples: [],
    };
  }
  return {
    id: String(r.id),
    gameId: r.gameId,
    gameName: r.gameName ?? "",
    date,
    durationMin,
    metrics,
  };
}

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

interface GameContextType {
  games: Game[];
  selectedGameId: string | null;
  setSelectedGameId: (id: string | null) => void;
  addGame: (game: Game) => void;
  addGames: (games: Game[]) => void;
  removeGame: (id: string) => void;
  /** Bulk-remove every game matching `predicate` (e.g. all games from a
   *  given integration). Used by the Settings integrations panel to wipe
   *  an integration's imported library in one action. */
  removeGames: (predicate: (game: Game) => boolean) => void;
  updateGame: (id: string, updates: Partial<Game>) => void;
  getGame: (id: string) => Game | undefined;
  runningGameIds: string[];
  /** Game ids whose tracked process just went missing and are in the
   *  watcher's grace period (e.g. a launcher handing off to the real game).
   *  The UI shows these as "closing" instead of flipping straight to stopped. */
  closingGameIds: string[];
  /** Live elapsed-seconds heartbeat per running game, fed by the watcher's
   *  periodic `game-progress` events. Keyed by game id. */
  liveElapsed: Record<string, number>;
  launchGame: (game: Game) => void;
  /**
   * Force-terminate the running game process and record the session.
   * Visible from the Game page "Force Close" button — pairs with the
   * `force_close_game` Tauri command. Reuses the same `game-exited`
   * event path as a natural exit, so activity / playtime / lastPlayed
   * all flow through to the existing listeners without bespoke
   * bookkeeping.
   */
  forceCloseGame: (game: Game) => Promise<void>;
  addStoreGame: (metadata: GameMetadataResult) => Promise<string>;
  importLocalGames: (items: { path: string; metadata: GameMetadataResult | null }[]) => Promise<void>;
  fetchGameReviews: (gameId: string, gameName: string, steamAppId?: number) => Promise<void>;
  /**
   * On-demand IGDB metadata enrichment. Called by GamePage on mount when
   * a game lacks a description (e.g. freshly Steam-synced, or imported
   * without metadata). Single IGDB call per invocation — well under the
   * 4 req/s cap. Safe to call multiple times; the function silently skips
   * games IGDB doesn't recognise.
   */
  enrichGameMetadata: (gameId: string, gameName: string, steamAppId?: number) => Promise<void>;
  /** Check whether a game is excluded from playtime/session tracking. */
  isGameUntracked: (gameId: string) => boolean;
  /** Toggle or set tracking exclusion for a game. */
  toggleGameTracking: (gameId: string, forceUntracked?: boolean) => void;
}

const GameContext = createContext<GameContextType | null>(null);

export const NO_IGDB_MATCH_SOURCE = "Steam (no IGDB match)";

let nextId = 1;
function generateId(): string {
  return `game-${Date.now()}-${nextId++}`;
}

// Session-scoped attempt counter `Map` for `enrichGameMetadata`. Multiple
// entry points (LibraryPage IntersectionObserver, GamePage on-mount, batch
// imports, etc.) all converge on this single function.
//
// A counter (not just a Set) does two jobs at once:
//
//  1. **Dedupe**: prevents the same gameId being enriched repeatedly by
//     multiple observers in the same window — the first attempt goes
//     through, subsequent ones see the count > 0 and the top-of-function
//     guard short-circuits them.
//
//  2. **Retry cap**: if Rust persistently fails to download the cover
//     AND the URL it falls back to also 404s in the browser, the
//     library card's `onError` chain clears `coverArtUrl`, the
//     IntersectionObserver re-arms on the next render, and we would
//     otherwise loop indefinitely between Rust call → onError →
//     re-arm → Rust call. Capping at MAX_ENRICH_ATTEMPTS prevents
//     that: after the cap, observer-fired calls bail at the guard,
//     but they are cheap (no Rust round-trip) so the UI stays
//     responsive.
//
// Persisted fields on the Game record are written on the first
// successful attempt; a no-op on subsequent calls is correct, not
// lossy. Module scope keeps the counter alive across library ↔
// detail-page navigation rather than resetting on every GameProvider
// remount.
const MAX_ENRICH_ATTEMPTS = 2;
const enrichAttemptsThisSession = new Map<string, number>();

/**
 * True iff `u` is a base64 data URL — i.e. an image we successfully
 * downloaded to disk. Used by the unpoison block in `enrichGameMetadata`
 * to decide whether a retry is necessary when cover art eventually
 * fails to load.
 *
 * Hoisted to module scope so the helper isn't reallocated on every
 * enrichment call (it's a pure predicate with no closure deps).
 */
const isFrontendUsableImage = (u: string | undefined): boolean =>
  !!u && u.startsWith("data:");

/**
 * Build the entries for the Rust GameWatcher's passive-detection index
 * from a set of games. Shared by the mount-time rebuild, the
 * steam-install-changed refresh, and the debounced post-mutation
 * rebuild in `scheduleWatcherIndexRebuild`.
 */
function toWatcherRefs(games: Game[], untrackedIds?: Set<string>) {
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

/** Discord's large/small image must be a public https URL; data: URIs are skipped. */
function discordAsset(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  const normalized = url.startsWith("//") ? `https:${url}` : url;
  return /^https:\/\//i.test(normalized) ? normalized : undefined;
}

/** First https website URL for the presence button. */
function discordButtonUrl(game: Game | undefined): string | undefined {
  if (!game) return undefined;
  const candidates = [...(game.websites ?? []), game.metadataUrl].filter(
    (u): u is string => typeof u === "string" && u.length > 0,
  );
  return candidates.find((u) => /^https:\/\//i.test(u));
}

/** How long the launch splash waits for the watcher's `game-started` event
 *  before closing anyway. Covers protocol launches (Steam/Uplay/UAC) that
 *  resolve the launch command before the real process appears — or never
 *  appear at all (e.g. the user cancelled a launcher dialog). */
const SPLASH_STARTED_FALLBACK_MS = 20000;

export function GameProvider({ children }: { children: ReactNode }) {
  const { showToast } = useToast();
  const { t } = useLanguage();
  // SplashProvider wraps GameProvider in App.tsx, so we can read the
  // splash dispatcher straight from context. No cross-window IPC,
  // no async round-trip — the splash is an in-process React overlay.
  const splash = useSplash();
  // Latest splash state for the fallback timer, so the delayed "started"
  // flip always reads the current record instead of a stale closure.
  const splashRef = useRef(splash);
  splashRef.current = splash;
  const splashFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Stable self-reference so the splash's Retry action can re-invoke the
  // latest `launchGame` (defined below) for the same game after a failure.
  const launchGameRef = useRef<(game: Game) => void>(() => {});

  /** Flip a still-"launching" splash to "started" once the watcher confirms
   *  the game process is up. Ignored for passively-detected games whose
   *  splash isn't showing. */
  const markSplashStarted = useCallback((gameId: string) => {
    const rec = splashRef.current.record;
    if (!rec || rec.game.id !== gameId || rec.status !== "launching") return;
    if (splashFallbackTimerRef.current) {
      clearTimeout(splashFallbackTimerRef.current);
      splashFallbackTimerRef.current = null;
    }
    splashRef.current.updateStatus("started");
  }, []);

  /** Safety net: if the watcher never fires game-started (e.g. a Steam
   *  protocol launch the user cancelled), close the splash after a beat
   *  instead of leaving it stuck on "launching". */
  const armSplashFallback = useCallback((gameId: string) => {
    if (splashFallbackTimerRef.current) clearTimeout(splashFallbackTimerRef.current);
    splashFallbackTimerRef.current = setTimeout(() => {
      splashFallbackTimerRef.current = null;
      const rec = splashRef.current.record;
      if (rec && rec.game.id === gameId && rec.status === "launching") {
        splashRef.current.updateStatus("started");
      }
    }, SPLASH_STARTED_FALLBACK_MS);
  }, []);
  const [games, setGames] = useState<Game[]>([]);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
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
  const untrackedGameIdsRef = useRef(untrackedGameIds);
  untrackedGameIdsRef.current = untrackedGameIds;
  const loadedRef = useRef(false);

  // Load persisted games on mount
  useEffect(() => {
    invoke<Game[]>("load_games")
      .then((data) => {
        if (data.length > 0) {
          setGames(data);
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
      });
  }, []);

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

  // Keep a ref to the latest games array so the enrichGameMetadata callback
  // identity stays stable across any game mutation. Otherwise the dep on
  // `games` would re-create this callback on every keystroke or insert,
  // forcing the GamePage effect to re-run (subsequent guard still prevents
  // redundant IGDB calls, but the closure churn was wasted CPU).
  const gamesRef = useRef(games);
  gamesRef.current = games;

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
  }, []);

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
        const platform = remaining?.platform?.trim();
        const stateLine = platform
          ? t("discordPresence.playingVia", { platform })
          : t("discordPresence.playingState");
        const rawPlayTime = remaining?.playTime;
        const timeTotal = rawPlayTime && rawPlayTime.trim()
          ? t("discordPresence.playtimeTotal", { time: rawPlayTime.trim() })
          : "";
        void emit("discord-presence-update", {
          state: "playing",
          gameId: remaining?.id ?? "",
          gameName: remainingName,
          startedAt,
          details: remainingName,
          stateText: [stateLine, timeTotal].filter(Boolean).join(" • "),
          largeImage: discordAsset(remaining?.coverSourceUrl ?? remaining?.coverArtUrl),
          largeText: remainingName,
          smallImage: discordAsset(remaining?.iconUrl),
          smallText: t("discordPresence.smallText"),
          buttonLabel: t("discordPresence.viewWebsite"),
          buttonUrl: discordButtonUrl(remaining),
        });
      } else {
        // No game left running: the useDiscordPresence hook emits a
        // "browsing" presence (library/page) so the Discord activity stays
        // continuous instead of clearing.
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [t]);

  // Listen for game-started events (passive detection by the watcher)
  useEffect(() => {
    const unlisten = listen<GameStartedEvent>("game-started", (event) => {
      const { gameId, detectedExe } = event.payload;

      // Splash lifecycle: the process is confirmed up, so flip a matching
      // "launching" splash to "started" (clearing its fallback timer).
      markSplashStarted(gameId);

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
      // + public https assets + website button) for the presence thread.
      const startedAt = Date.now();
      runningSessionsRef.current.set(event.payload.gameId, { name: event.payload.gameName, startedAt });
      const game = gamesRef.current.find((g) => g.id === event.payload.gameId);
      const platform = game?.platform?.trim();
      const stateLine = platform
        ? t("discordPresence.playingVia", { platform })
        : t("discordPresence.playingState");
      const rawPlayTime = game?.playTime;
      const timeTotal = rawPlayTime && rawPlayTime.trim()
        ? t("discordPresence.playtimeTotal", { time: rawPlayTime.trim() })
        : "";
      void emit("discord-presence-update", {
        state: "playing",
        gameId: event.payload.gameId,
        gameName: event.payload.gameName,
        startedAt,
        details: event.payload.gameName,
        stateText: [stateLine, timeTotal].filter(Boolean).join(" • "),
        largeImage: discordAsset(game?.coverSourceUrl ?? game?.coverArtUrl),
        largeText: event.payload.gameName,
        smallImage: discordAsset(game?.iconUrl),
        smallText: t("discordPresence.smallText"),
        buttonLabel: t("discordPresence.viewWebsite"),
        buttonUrl: discordButtonUrl(game),
      });
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [t, markSplashStarted]);

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

  interface SteamInstallChangedEvent {
    appId: number;
    installed: boolean;
    exePath?: string;
  }

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
  }, [showToast, t]);

  const updateGame = useCallback((id: string, updates: Partial<Game>) => {
    setGames((prev) =>
      prev.map((g) => (g.id === id ? { ...g, ...updates } : g))
    );
    // Path / Steam-app-id edits can change what the watcher matches, so
    // refresh the process index.
    scheduleWatcherIndexRebuild();
  }, [scheduleWatcherIndexRebuild]);

  /** Download a single image to base64, falling back to the remote URL. */
  async function downloadImageSafe(url: string | undefined | null): Promise<string | undefined> {
    if (!url) return undefined;
    try {
      const dataUrl: string | null = await invoke("download_image", { url });
      return dataUrl ?? url;
    } catch {
      return url;
    }
  }

  /** Batch-download images from a metadata result: cover, hero, banner, logo. */
  async function fetchAllImages(images: { icon?: string | null; cover?: string | null; hero?: string | null; banner?: string | null; logo?: string | null }) {
    const [coverUrl, heroUrl, bannerUrl, logoUrl] = await Promise.all([
      downloadImageSafe(images.cover),
      downloadImageSafe(images.hero),
      downloadImageSafe(images.banner),
      downloadImageSafe(images.logo),
    ]);
    return {
      coverArtUrl: coverUrl ?? undefined,
      coverSourceUrl: discordAsset(images.cover),
      bannerUrl: heroUrl ?? bannerUrl ?? undefined,
      logoUrl: logoUrl ?? undefined,
    };
  }

  /** On-demand IGDB metadata enrichment. Called by GamePage on mount when
   *  the game lacks a description (or when the user clicks Fetch Metadata
   *  in the edit panel). Replaces the old `addGame`/`addGames` auto-fetch
   *  fan-out which was wasteful for 500+ game libraries.
   *
   *  SUCCESS/FAILURE SEMANTICS:
   *  * Single IGDB `game` call + (when matches found) one `game_time_to_beats`
   *    call. Rust `igdb_acquire()` enforces 250 ms spacing between IGDB calls.
   *  * Never throws — silently skips games IGDB doesn't recognise.
   *  * Never overwrites a non-empty Game field with an empty IGDB result.
   */
  const enrichGameMetadata = useCallback(async (gameId: string, gameName: string, steamAppId?: number) => {
    // Dedupe + retry cap (see MAX_ENRICH_ATTEMPTS comment above). Both
    // the LibraryPage observer and the GamePage on-mount effect settle
    // on this single counter, so multiple fires for the same gameId in
    // a single session collapse into one round-trip (when Rust
    // succeeds) or at most `MAX_ENRICH_ATTEMPTS` round-trips (when
    // Rust keeps failing — the cap protects against an infinite
    // Rust-call loop on permanently broken upstream URLs).
    const previousAttempts = enrichAttemptsThisSession.get(gameId) ?? 0;
    if (previousAttempts >= MAX_ENRICH_ATTEMPTS) return;
    enrichAttemptsThisSession.set(gameId, previousAttempts + 1);

    try {
      // Find the current game record to merge intelligently (don't
      // overwrite non-empty existing fields with empty IGDB results).
      const current = gamesRef.current.find((g) => g.id === gameId);
      if (!current) return;

      // PRECISE BY-ID REFETCH: a game that carries a persisted IGDB id
      // (from a previous enrichment, or a sentinel game whose id later
      // became known) can be fetched exactly by id — this beats a fuzzy
      // name search and also un-gates games permanently marked
      // NO_IGDB_MATCH_SOURCE by a failed NAME lookup. Falls back to the
      // legacy name-based search when the id fetch returns null / errors.
      const results: GameMetadataResult[] = [];
      if (current.igdbId != null) {
        try {
          const byId = await invoke<GameMetadataResult | null>("get_igdb_game_by_id", {
            id: current.igdbId,
          });
          if (byId) results.push({ ...byId, sourceName: "IGDB" });
        } catch (e) {
          console.warn(`IGDB by-id fetch failed for ${gameName}:`, e);
        }
      }
      if (results.length === 0) {
        const searched = await invoke<GameMetadataResult[]>("search_game_metadata", {
          gameName,
          skipLaunchbox: !!steamAppId,
          steamAppId,
        });
        results.push(...searched);
      }
      if (results.length === 0) {
        // No IGDB match. Mark the game as a Steam-sourced record so a
        // subsequent visit doesn't try to enrich it again — the GamePage
        // effect uses this sentinel via metadataSource.
        const noMatchPatch = {
          metadataSource: current.metadataSource ?? NO_IGDB_MATCH_SOURCE,
        };
        updateGame(gameId, noMatchPatch);
        // Persist the sentinel immediately so a reboot doesn't re-run the
        // (failed) enrichment for this game on every scroll.
        invoke("save_game", { game: { ...current, ...noMatchPatch } }).catch((err) =>
          console.warn(`Immediate persist (no-match) failed for ${gameName}:`, err)
        );
        // DEFINITIVE FAILURE: the search returned nothing rather than
        // timing out or 404-ing. Drop the attempt counter so a future
        // MANUAL user-initiated retry (e.g. clearing the coverArtUrl in
        // the GamePage edit modal) gets a fresh budget instead of
        // inheriting a burned slot. Future AUTO-fetches are gated by
        // the metadataSource sentinel above, so they won't fire
        // regardless of the counter.
        enrichAttemptsThisSession.delete(gameId);
        return;
      }
      // Prefer IGDB for its richer metadata (timeToBeat, criticRating, themes,
      // screenshots, videos, etc.) — Steam and LaunchBox only provide basics.
      const meta = results.find((r) => r.sourceName === "IGDB") ?? results[0];

      // IMAGE-LEVEL FALLBACK across sources: many older / modded /
      // niche titles (e.g. ARMA 2 Private Military Company, Arma Gold,
      // mods without IGDB entries) have NO IGDB cover — but a perfectly
      // valid Steam library_600x900.jpg or LaunchBox box front. Without
      // this cross-source image fallback those games would render as the
      // placeholder text card forever, since the IGDB-only `meta`
      // selection above drops the Steam/LaunchBox image URLs on the floor.
      // Textual metadata still prizes IGDB above other sources.
      // For Steam-identified games the Steam CDN hero/banner is preferred
      // over IGDB artwork.
      const pickImage = (key: "cover" | "hero" | "banner" | "logo"): string | null => {
        // Steam-identified games get the Steam CDN hero/banner by default;
        // IGDB artwork remains the default for everything else.
        if (steamAppId && (key === "hero" || key === "banner")) {
          const steam = results.find((r) => r.sourceName === "Steam");
          if (steam?.images[key]) return steam.images[key];
        }
        if (meta.images[key]) return meta.images[key];
        for (const r of results) {
          if (r.images[key]) return r.images[key];
        }
        return null;
      };
      const images = await fetchAllImages({
        cover: pickImage("cover"),
        hero: pickImage("hero"),
        banner: pickImage("banner"),
        logo: pickImage("logo"),
      });
      // Merge with sentinel "only set if currently empty" for textual fields
      // so a user-edited description isn't clobbered by an IGDB re-fetch.
      const setIfEmpty = <K extends keyof Game>(key: K, value: Game[K] | undefined): Game[K] | undefined => {
        // Treat only null/undefined as "unset". An empty string (e.g. user
        // explicitly clearing the description) is preserved and not overwritten
        // by an IGDB value on subsequent visits.
        if (current[key] === undefined || current[key] === null) return value;
        return current[key];
      };
      // Steam identity for manually added games (local exe / batch):
      // IGDB's `websites` list usually contains the Steam store URL.
      // Extract the appid and PERSIST it on the game row so reviews,
      // ProtonDB, achievements and deep links all
      // work without a name-based Steam search. Scan every source's
      // websites (not just the preferred `meta`) — LaunchBox results
      // carry no websites but a sibling IGDB result might.
      const websitesForSteamId =
        current.websites ??
        meta.websites ??
        results.find((r) => r.websites && r.websites.length > 0)?.websites;
      const resolvedSteamAppId =
        current.steamAppId ??
        extractSteamAppIdFromWebsites(websitesForSteamId) ??
        undefined;
      const enrichPatch: Partial<Game> = {
        steamAppId: resolvedSteamAppId,
        description: setIfEmpty("description", meta.description ?? undefined),
        developer: setIfEmpty("developer", meta.developer ?? undefined),
        publisher: setIfEmpty("publisher", meta.publisher ?? undefined),
        releaseDate: setIfEmpty("releaseDate", meta.releaseDate ?? undefined),
        genres: current.genres && current.genres.length > 0 ? current.genres : (meta.genres.length > 0 ? meta.genres : undefined),
        // For images, prefer the IGDB cover/hero over orphaned Steam CDN URLs
        // when IGDB returned one — otherwise keep whatever's already there.
        coverArtUrl: images.coverArtUrl ?? current.coverArtUrl,
        coverSourceUrl: images.coverSourceUrl ?? current.coverSourceUrl,
        bannerUrl: images.bannerUrl ?? current.bannerUrl,
        logoUrl: images.logoUrl ?? current.logoUrl,
        igdbRating: current.igdbRating ?? meta.igdbRating ?? undefined,
        criticRating: current.criticRating ?? meta.criticRating ?? undefined,
        themes: current.themes ?? meta.themes ?? undefined,
        gameModes: current.gameModes ?? meta.gameModes ?? undefined,
        playerPerspectives: current.playerPerspectives ?? meta.playerPerspectives ?? undefined,
        screenshots: current.screenshots ?? meta.screenshots ?? undefined,
        videos: current.videos ?? meta.videos ?? undefined,
        websites: current.websites ?? meta.websites ?? undefined,
        timeToBeat: current.timeToBeat ?? meta.timeToBeat ?? undefined,
        similarGames: current.similarGames ?? meta.similarGames ?? undefined,
        releases: current.releases ?? meta.releases ?? undefined,
        igdbReviews: current.igdbReviews ?? meta.igdbReviews ?? undefined,
        collectionId: setIfEmpty("collectionId", meta.collectionId ?? undefined),
        igdbId: setIfEmpty("igdbId", meta.igdbId ?? undefined),
        metadataSource: meta.sourceName,
        metadataUrl: meta.sourceUrl,
      };
      updateGame(gameId, enrichPatch);
      // Persist THIS game immediately (single-row upsert). The lazy
      // library-scroll enrichment can fetch dozens of covers in a burst;
      // relying only on the debounced full-library `save_games` meant a
      // cover fetched moments before the app closed never hit disk — hence
      // the "goes back to placeholder until re-enrich" on next boot. A
      // targeted write here guarantees durability without a whole-library
      // rewrite per card.
      invoke("save_game", { game: { ...current, ...enrichPatch } }).catch((err) =>
        console.warn(`Immediate persist failed for ${gameName}:`, err)
      );
      // Defensive REWARD: when an attempt produced a usable image OR
      // the game already had a working cover from a previous fetch,
      // reset the attempt counter so a future user-initiated clear +
      // re-fire (via the LibraryPage observer being re-armed by an
      // onError-clear, or the user manually editing coverArtUrl to
      // undefined) gets a FRESH attempt budget. Otherwise leave the
      // count alone — the counter we incremented at the top of this
      // function records the attempt just made, and the top-of-function
      // guard will start rejecting after MAX_ENRICH_ATTEMPTS is reached.
      //
      // A frontend-usable cover is a base64 data URL downloaded via
      // Rust. `downloadImageSafe()` falls back to returning the original
      // REMOTE URL on Rust failure, which is technically a truthy string
      // but not a working image — when the browser then 404s on it and
      // the Steam-CDN onError chain on the library card exhausts every
      // fallback and clears `coverArtUrl`, the LibraryPage observer
      // re-arms but our cap protects against an infinite Rust-call loop.
      if (
        isFrontendUsableImage(images.coverArtUrl) ||
        isFrontendUsableImage(images.bannerUrl) ||
        isFrontendUsableImage(images.logoUrl) ||
        !!current.coverArtUrl
      ) {
        enrichAttemptsThisSession.delete(gameId);
      }
      console.log(`Enriched ${gameName} via ${meta.sourceName}`);

      // Background review load happens lazily via ReviewsTab on first open,
      // so we don't need to seed it here. This also avoids TDZ ordering
      // issues with fetchGameReviews's useCallback declaration below.
    } catch (err) {
      console.error("enrichGameMetadata failed:", err);
      // Same rationale as the no-results branch — the Rust / IGDB /
      // LaunchBox call didn't even resolve. Reset the attempt counter
      // so a transient network blip or IPC failure doesn't burn one of
      // the user's two retries.
      enrichAttemptsThisSession.delete(gameId);
    }
  }, [updateGame]);

  /** Fetch reviews for a game from the best available source (Steam first,
   *  IGDB fallback) and persist them on the game record. Safe to call any
   *  time — does not block the UI and never wipes existing reviews on empty
   *  results. */
  const fetchGameReviews = useCallback(
    async (gameId: string, gameName: string, steamAppId?: number) => {
      try {
        const result = await invoke<{ reviews: IgdbReview[]; source: string; error?: string }>(
          "fetch_game_reviews",
          { gameName, steamAppId }
        );
        if (result.reviews.length > 0) {
          updateGame(gameId, { igdbReviews: result.reviews });
        }
      } catch (err) {
        console.error(`Fetch reviews failed for ${gameName}:`, err);
      }
    },
    [updateGame]
  );

  const addGame = useCallback((game: Game) => {
    const id = game.id || generateId();
    setGames((prev) => [...prev, { ...game, id }]);
    // Refresh the watcher index so the new game is passively detectable.
    scheduleWatcherIndexRebuild();
    // IGDB metadata is now lazy: GamePage calls enrichGameMetadata on mount
    // for any game that lacks a description. This avoids the wasteful fan-out
    // that used to trigger hundreds of IGDB calls during Steam sync.
  }, [scheduleWatcherIndexRebuild]);

  const addGames = useCallback((newGames: Game[]) => {
    const withIds = newGames.map((g) => ({ ...g, id: g.id || generateId() }));
    setGames((prev) => [...prev, ...withIds]);
    // Refresh the watcher index so the imported games are passively
    // detectable without a restart.
    scheduleWatcherIndexRebuild();
    // IGDB metadata is now lazy: GamePage calls enrichGameMetadata on mount
    // for any game that lacks a description. This avoids the wasteful fan-out
    // that triggered hundreds of IGDB calls during Steam sync even in
    // sequential mode. For a 500-game Steam library, this saves ~4 minutes
    // of background fetching; users only see IGDB work for games they
    // actually open.
  }, [scheduleWatcherIndexRebuild]);

  const removeGame = useCallback(
    (id: string) => {
      setGames((prev) => prev.filter((g) => g.id !== id));
      setSelectedGameId((current) => (current === id ? null : current));
      setUntrackedGameIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        try {
          localStorage.setItem(LS_UNTRACKED_GAMES, JSON.stringify([...next]));
        } catch (e) {
          console.error("Failed to save untracked games to localStorage:", e);
        }
        return next;
      });
      // Drop the exe from the watcher index so a stale process match can't
      // resurrect the deleted game as a phantom running entry.
      scheduleWatcherIndexRebuild();
    },
    [scheduleWatcherIndexRebuild]
  );

  const removeGames = useCallback(
    (predicate: (game: Game) => boolean) => {
      setGames((prev) => {
        if (!prev.some(predicate)) return prev;
        const removed = prev.filter(predicate);
        if (removed.length > 0) {
          setUntrackedGameIds((oldUntracked) => {
            const next = new Set(oldUntracked);
            for (const g of removed) {
              next.delete(g.id);
            }
            try {
              localStorage.setItem(LS_UNTRACKED_GAMES, JSON.stringify([...next]));
            } catch (e) {}
            return next;
          });
        }
        return prev.filter((g) => !predicate(g));
      });
      // Refresh the index so removed exes stop matching (a harmless no-op
      // rebuild when the predicate matched nothing).
      scheduleWatcherIndexRebuild();
    },
    [scheduleWatcherIndexRebuild]
  );

  const gamesWithTracking = useMemo(
    () => games.map((g) => ({ ...g, untracked: untrackedGameIds.has(g.id) })),
    [games, untrackedGameIds]
  );

  const getGame = useCallback(
    (id: string) => gamesWithTracking.find((g) => g.id === id),
    [gamesWithTracking]
  );

  const forceCloseGame = useCallback(async (game: Game) => {
    try {
      const result = await invoke<{ pid: number; killed: boolean }>(
        "force_close_game",
        { gameId: game.id }
      );
      // Three distinct outcomes per the backend contract:
      //   - killed=true: process was actually terminated. Success toast.
      //   - killed=false with pid > 0: session cleared but the
      //     terminate call was refused (PID recycled, access denied).
      //     The session is no longer tracked so the running
      //     indicator WILL still clear via `game-exited`, but we
      //     surface the partial success so the user knows the game
      //     itself may still be running on disk.
      //   - pid == 0 (always killed=false): pending session (Steam
      //     protocol / UAC) — nothing to terminate. Treat as success.
      if (result.killed) {
        showToast(t("gameContext.forceClosed", { name: game.name }), "success");
      } else if (result.pid > 0) {
        showToast(
          t("gameContext.endedSession", { name: game.name }),
          "warning"
        );
      } else {
        showToast(t("gameContext.forceClosed", { name: game.name }), "success");
      }
    } catch (err) {
      showToast(t("gameContext.forceCloseFailed", { name: game.name, error: String(err) }), "error");
    }
  }, [showToast, t]);

  const launchGame = useCallback(async (game: Game) => {
    if (runningGameIds.includes(game.id)) {
      showToast(t("gameContext.alreadyRunning", { name: game.name }), "info");
      return;
    }

    // Resolve the selected GPU from localStorage
    let gpuId: string | null = null;
    let gpuName: string | null = null;
    const savedGpu = localStorage.getItem("gamelib-gpus");
    const savedGpuId = localStorage.getItem("gamelib-selected-gpu");
    if (savedGpu && savedGpuId) {
      try {
        const gpus = JSON.parse(savedGpu);
        const selected = gpus.find((g: any) => g.id === savedGpuId);
        if (selected) {
          gpuId = selected.id;
          gpuName = selected.name;
        }
      } catch (e) {
        console.error("Failed to parse selected GPU from storage", e);
      }
    }

    // Show the launch splash if the user has it enabled
    const splashOn = isSplashEnabled();
    if (splashOn) {
      let lastSession: GameSession | null = null;
      try {
        const records: DbSessionRecord[] = await invoke("get_last_session_for_game", {
          gameId: game.id,
        });
        if (records.length > 0) {
          const mapped = mapDbSession(records[0]);
          if (mapped) lastSession = mapped;
        }
      } catch {
        // Backend unavailable or DB empty — splash falls back to
        // "First time playing".
      }
      const payload: SplashPayload = { game, lastSession };
      splash.open(payload, { retry: () => launchGameRef.current(game) });
    }

    setRunningGameIds((prev) => [...prev, game.id]);

    // Stamp lastPlayed immediately so the game surfaces in the
    // "Continue Playing" rail even before the session ends. If the
    // backend later emits a game-exited event, the timestamp will be
    // refined to the actual finish time.
    setGames((prev) =>
      prev.map((g) =>
        g.id === game.id ? { ...g, lastPlayed: Date.now() } : g
      )
    );

    try {
      // ── Rockstar: launch through the Rockstar Games Launcher ──
      // Playnite routes play via `Launcher.exe -launchTitleInFolder
      // "<installDir>"` so Rockstar's DRM / Social Club bootstrap
      // runs. We do the same when the game carries a `rockstarTitleId`.
      if (game.rockstarTitleId) {
        await invoke<string>("rockstar_launch_game", {
          gameId: game.id,
          gameName: game.name,
          gamePath: game.path || null,
          titleId: game.rockstarTitleId,
        });
        if (splashOn) armSplashFallback(game.id);
        showToast(t("gameContext.launched", { name: game.name }), "success");
        return;
      }

      // ── Ubisoft Connect: launch through the Ubisoft client ──
      // Playnite routes play via the `uplay://launch/<id>` protocol so
      // Ubisoft's DRM bootstrap runs. We do the same when the game
      // carries a `uplayGameId`.
      if (game.uplayGameId) {
        await invoke<string>("uplay_launch_game", {
          gameId: game.id,
          gameName: game.name,
          gamePath: game.path || null,
          uplayId: game.uplayGameId,
        });
        if (splashOn) armSplashFallback(game.id);
        showToast(t("gameContext.launched", { name: game.name }), "success");
        return;
      }

      // ── Unified launch: single Tauri command for all game types ─────
      // The Rust backend handles:
      //   * Direct exe spawn (Local games, Steam with known path)
      //   * steam:// protocol (Steam without local exe)
      //   * Process lifecycle tracking via GameWatcher background poll
      //   * Metrics collection (starts automatically when PID is known)
      await invoke<string>("launch_game", {
        gameId: game.id,
        gameName: game.name,
        gamePath: game.path || "",
        platform: game.platform,
        steamAppId: game.steamAppId ?? null,
        gpuId,
        gpuName,
        launchArguments: game.launchArguments || null,
        runAsAdmin: game.runAsAdmin || null,
        showSteamLaunchSelection: game.showSteamLaunchSelection || null,
        preLaunchScript: game.preLaunchScript || null,
        preLaunchAdmin: game.preLaunchAdmin || null,
        postExitScript: game.postExitScript || null,
        postExitAdmin: game.postExitAdmin || null,
        companionApps: game.companionApps || null,
      });

      if (splashOn) armSplashFallback(game.id);
      showToast(t("gameContext.launched", { name: game.name }), "success");
    } catch (err: any) {
      setRunningGameIds((prev) => prev.filter((id) => id !== game.id));
      if (splashOn) splash.updateStatus("error", String(err));
      showToast(t("gameContext.launchFailed", { error: String(err) }), "error");
    }
  }, [runningGameIds, showToast, splash, t]);
  launchGameRef.current = launchGame;

  const addStoreGame = useCallback(async (metadata: GameMetadataResult): Promise<string> => {
    // Duplicate check — normalized name comparison
    const normName = metadata.title.toLowerCase().trim();
    const existing = games.find(
      (g) => g.name.toLowerCase().trim() === normName
    );
    if (existing) {
      showToast(t("gameContext.alreadyInLibrary", { name: metadata.title }), "info");
      return existing.id;
    }

    // Download all images to base64 for offline use
    const imageData = await fetchAllImages(metadata.images);

    const newGame: Game = {
      id: generateId(),
      name: metadata.title,
      path: "",
      platform: "Store",
      installed: false,
      playTime: "0h",
      addedAt: Date.now(),
      coverArtUrl: imageData.coverArtUrl,
      coverSourceUrl: imageData.coverSourceUrl,
      iconUrl: undefined,
      bannerUrl: imageData.bannerUrl,
      logoUrl: imageData.logoUrl,
      description: metadata.description ?? undefined,
      developer: metadata.developer ?? undefined,
      publisher: metadata.publisher ?? undefined,
      releaseDate: metadata.releaseDate ?? undefined,
      genres: metadata.genres.length > 0 ? metadata.genres : undefined,
      storyline: metadata.storyline,
      igdbRating: metadata.igdbRating ?? undefined,
      criticRating: metadata.criticRating ?? undefined,
      themes: metadata.themes ?? undefined,
      gameModes: metadata.gameModes ?? undefined,
      playerPerspectives: metadata.playerPerspectives ?? undefined,
      screenshots: metadata.screenshots ?? undefined,
      videos: metadata.videos ?? undefined,
      websites: metadata.websites ?? undefined,
      timeToBeat: metadata.timeToBeat ?? undefined,
      similarGames: metadata.similarGames ?? undefined,
      releases: metadata.releases ?? undefined,
      igdbReviews: metadata.igdbReviews ?? undefined,
      alternativeNames: metadata.alternativeNames ?? undefined,
      collection: metadata.collection ?? undefined,
      collectionId: metadata.collectionId,
      igdbId: metadata.igdbId,
      franchise: metadata.franchise ?? undefined,
      gameCategory: metadata.gameCategory ?? undefined,
      releaseStatus: metadata.releaseStatus ?? undefined,
      languageSupports: metadata.languageSupports ?? undefined,
      metadataSource: metadata.sourceName,
      metadataUrl: metadata.sourceUrl,
    };

    setGames((prev) => [...prev, newGame]);
    // Refresh the watcher index so the new store game is passively
    // detectable once it has a path.
    scheduleWatcherIndexRebuild();
    showToast(t("gameContext.addedToLibrary", { name: metadata.title }), "success");

    // Kick off a background review fetch so reviews are ready when the user
    // opens the Reviews tab. The store metadata doesn't carry a Steam app id,
    // so the backend will look one up by name.
    fetchGameReviews(newGame.id, newGame.name).catch((err) =>
      console.error("Background review fetch on add failed:", err)
    );

    return newGame.id;
  }, [games, showToast, fetchGameReviews, scheduleWatcherIndexRebuild, t]);

  const importLocalGames = useCallback(async (
    items: { path: string; metadata: GameMetadataResult | null }[]
  ) => {
    const imported: Game[] = [];
    for (const item of items) {
      const pathNorm = item.path.toLowerCase().trim();
      const duplicate = games.find((g) => g.path.toLowerCase().trim() === pathNorm);
      if (duplicate) {
        continue;
      }

      let newGame: Game;
      if (item.metadata) {
        const imageData = await fetchAllImages(item.metadata.images);
        newGame = {
          id: generateId(),
          name: item.metadata.title,
          path: item.path,
          platform: "Local",
          installed: true,
          playTime: "0h",
          addedAt: Date.now(),
          coverArtUrl: imageData.coverArtUrl,
          coverSourceUrl: imageData.coverSourceUrl,
          bannerUrl: imageData.bannerUrl,
          logoUrl: imageData.logoUrl,
          description: item.metadata.description ?? undefined,
          developer: item.metadata.developer ?? undefined,
          publisher: item.metadata.publisher ?? undefined,
          releaseDate: item.metadata.releaseDate ?? undefined,
          genres: item.metadata.genres.length > 0 ? item.metadata.genres : undefined,
          storyline: item.metadata.storyline,
          igdbRating: item.metadata.igdbRating ?? undefined,
          criticRating: item.metadata.criticRating ?? undefined,
          themes: item.metadata.themes ?? undefined,
          gameModes: item.metadata.gameModes ?? undefined,
          playerPerspectives: item.metadata.playerPerspectives ?? undefined,
          screenshots: item.metadata.screenshots ?? undefined,
          videos: item.metadata.videos ?? undefined,
          websites: item.metadata.websites ?? undefined,
          timeToBeat: item.metadata.timeToBeat ?? undefined,
          similarGames: item.metadata.similarGames ?? undefined,
          releases: item.metadata.releases ?? undefined,
          igdbReviews: item.metadata.igdbReviews ?? undefined,
          alternativeNames: item.metadata.alternativeNames ?? undefined,
          collection: item.metadata.collection ?? undefined,
          collectionId: item.metadata.collectionId,
          franchise: item.metadata.franchise ?? undefined,
          gameCategory: item.metadata.gameCategory ?? undefined,
          releaseStatus: item.metadata.releaseStatus ?? undefined,
          languageSupports: item.metadata.languageSupports ?? undefined,
          metadataSource: item.metadata.sourceName,
          metadataUrl: item.metadata.sourceUrl,
        };
      } else {
        newGame = {
          id: generateId(),
          name: gameNameFromPath(item.path),
          path: item.path,
          platform: "Local",
          installed: true,
          playTime: "0h",
          addedAt: Date.now(),
        };
      }
      imported.push(newGame);
    }

    if (imported.length > 0) {
      setGames((prev) => [...prev, ...imported]);
      // Refresh the watcher index so the imported exes are passively
      // detectable immediately.
      scheduleWatcherIndexRebuild();
      showToast(t("gameContext.imported", { count: imported.length }), "success");

      // Kick off background review fetches so the Reviews tab is populated
      // when the user opens it. Each import is a potential "game added"
      // event per the spec.
      for (const game of imported) {
        const steamAppId = extractSteamAppId(game.path) ?? undefined;
        fetchGameReviews(game.id, game.name, steamAppId).catch((err: unknown) =>
          console.error(`Background review fetch on import failed for ${game.name}:`, err)
        );
      }

      // Auto-size every locally-imported game in the background. We
      // delegate to the Rust `detect_game_size` Tauri command (same
      // path the Storage tab's Auto-detect button uses); on success
      // we patch the Game record in-place via `updateGame` so the
      // Storage tab picks up the new size the next time it mounts.
      //
      // Failures are silent (per-game) so a single bad path can't
      // poison the batch — the user can always click "Set size" /
      // "Auto-detect" on the Storage row to retry manually.
      for (const game of imported) {
        if (!game.path) continue;
        invoke<{ sizeBytes: number; rootPath: string }>("detect_game_size", {
          exePath: game.path,
          gameName: game.name,
          rootOverride: null,
        })
          .then((result) => {
            if (result && result.sizeBytes > 0) {
              updateGame(game.id, {
                sizeBytes: result.sizeBytes,
                sizeRootPath: result.rootPath,
                sizeDetectedAt: new Date().toISOString(),
              });
            }
          })
          .catch((err: unknown) => {
            // Per-game failure is non-fatal — just log so the user
            // can debug if the Storage tab shows "Not set" later.
            console.warn(`Auto-size on import failed for ${game.name}:`, err);
          });
      }
    } else {
      showToast(t("gameContext.noNewImports"), "info");
    }
  }, [games, showToast, fetchGameReviews, updateGame, scheduleWatcherIndexRebuild, t]);

  return (
    <GameContext.Provider
      value={{
        games: gamesWithTracking,
        selectedGameId,
        setSelectedGameId,
        addGame,
        addGames,
        removeGame,
        removeGames,
        updateGame,
        getGame,
        runningGameIds,
        closingGameIds,
        liveElapsed,
        launchGame,
        forceCloseGame,
        addStoreGame,
        importLocalGames,
        fetchGameReviews,
        enrichGameMetadata,
        isGameUntracked,
        toggleGameTracking,
      }}
    >
      {children}
    </GameContext.Provider>
  );
}

export function useGames(): GameContextType {
  const ctx = useContext(GameContext);
  if (!ctx) {
    throw new Error("useGames must be used within a GameProvider");
  }
  return ctx;
}
