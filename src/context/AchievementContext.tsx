import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useGames } from "./GameContext";
import { useToast } from "./ToastContext";
import { useLanguage } from "./LanguageContext";
import type {
  Game,
  GameAchievementData,
  AchievementsCache,
} from "../types/game";
import type { SteamSession } from "../types/steam";

// ── Settings persistence ────────────────────────────────────────────────

export interface AchievementSettings {
  /** Auto-sync achievements when Steam library syncs. */
  autoSyncOnSteamSync: boolean;
  /** Show descriptions for locked achievements (vs "Hidden achievement"). */
  showLockedDescriptions: boolean;
  /** Show toast when a newly unlocked achievement is detected. */
  notifyOnUnlock: boolean;
  /**
   * Track achievements for cracked / downloaded (non-Steam) games by
   * watching local crack/emulator achievement files. Mirrored to the
   * Rust background watcher.
   */
  localAchievementsEnabled: boolean;
}

const DEFAULT_SETTINGS: AchievementSettings = {
  autoSyncOnSteamSync: true,
  showLockedDescriptions: true,
  notifyOnUnlock: true,
  localAchievementsEnabled: true,
};

const SETTINGS_KEY = "gamelib-achievement-settings";

function loadSettings(): AchievementSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(s: AchievementSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

// ── Context type ────────────────────────────────────────────────────────

interface AchievementContextType {
  /** Full achievements cache (all games). */
  cache: AchievementsCache;
  /** Get achievements for a specific game. */
  getGameAchievements: (gameId: string) => GameAchievementData | null;
  /** Fetch achievements for a single game from Steam and update cache. */
  syncGameAchievements: (gameId: string, steamAppId: number) => Promise<void>;
  /**
   * Sync achievements for a single game from local crack/emulator files
   * (schema from the Hydra API). Works for non-Steam / cracked games.
   * An optional `steamAppId` override is used when the game row doesn't
   * yet have one persisted.
   */
  syncLocalAchievements: (gameId: string, steamAppId?: number) => Promise<void>;
  /** Bulk-sync achievements for all Steam games in the library. */
  syncAllAchievements: (games: Game[]) => Promise<void>;
  /** Whether a sync operation is in progress. */
  isSyncing: boolean;
  /** Progress of a bulk sync operation. */
  syncProgress: { current: number; total: number } | null;
  /** Achievement settings. */
  settings: AchievementSettings;
  /** Update achievement settings. */
  updateSettings: (updates: Partial<AchievementSettings>) => void;
  /** Clear the entire achievements cache. */
  clearCache: () => Promise<void>;
  /** Reload the achievements cache from disk. */
  reloadCache: () => Promise<void>;
}

const AchievementContext = createContext<AchievementContextType | null>(null);

// ── Provider ────────────────────────────────────────────────────────────

export function AchievementProvider({ children }: { children: ReactNode }) {
  const [cache, setCache] = useState<AchievementsCache>({ games: {} });
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [settings, setSettings] = useState<AchievementSettings>(loadSettings);

  // Mirrors the latest cache so persistence can always save a full,
  // current snapshot from outside React state — writing inside a
  // `setCache` updater would be unsafe under StrictMode (updaters run
  // twice in dev). Every mutation site in this provider updates it
  // synchronously, so it never lags the source of truth.
  const cacheRef = useRef(cache);

  // Serialize DB writes. `save_achievements_cache` rewrites the whole
  // table inside one transaction; two overlapping snapshots (e.g. a
  // bulk-loop flush racing a game-exit per-game sync) could otherwise
  // interleave and the older snapshot wins. Chaining the invokes keeps
  // last-writer-wins == newest-wins. Each call stringifies at call time
  // so the chained snapshots are the freshest available then.
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());

  // Whether a bulk sync owns the in-memory cache. reloadCache defers
  // while true so the disk snapshot can't clobber games synced since
  // the last flush.
  const isSyncingRef = useRef(false);
  const reloadQueuedRef = useRef(false);

  // Persist the current cache snapshot to disk. Immediate — no debounce:
  // the old 1s debounce silently dropped a just-synced game when the app
  // reloaded before the timer fired, which is exactly the "synced data
  // resets on reload" bug. Per-game syncs are user-initiated and
  // infrequent; the bulk sync calls this on a batch cadence instead.
  const persistCache = useCallback(() => {
    const snapshot = JSON.stringify(cacheRef.current);
    saveChainRef.current = saveChainRef.current.then(async () => {
      try {
        await invoke("save_achievements_cache", { data: snapshot });
      } catch (err) {
        console.warn("[AchievementContext] Failed to save cache:", err);
      }
    });
    return saveChainRef.current;
  }, []);

  // Load cache from disk on mount. Guarded: if a sync already wrote
  // entries before the (async) load resolved, keep the fresher data.
  useEffect(() => {
    (async () => {
      try {
        const raw: string = await invoke("load_achievements_cache");
        if (raw) {
          const parsed = JSON.parse(raw) as AchievementsCache;
          if (parsed && parsed.games) {
            if (Object.keys(cacheRef.current.games).length > 0) return;
            cacheRef.current = parsed;
            setCache(parsed);
          }
        }
      } catch (err) {
        console.warn("[AchievementContext] Failed to load cache:", err);
      }
    })();
  }, []);

  const clearCache = useCallback(async () => {
    cacheRef.current = { games: {} };
    setCache({ games: {} });
    // The backend turns an empty payload into a table wipe (see
    // upsert_many_from_payload), so a clear followed by a reload really
    // is cleared — it must not resurrect the old rows.
    await persistCache();
  }, [persistCache]);

  const reloadCache = useCallback(async () => {
    // A bulk sync owns the in-memory cache: loading the disk snapshot
    // now would clobber games synced since the last flush. Defer the
    // reload instead — syncAllAchievements runs it once the loop ends.
    if (isSyncingRef.current) {
      reloadQueuedRef.current = true;
      return;
    }
    try {
      const raw: string = await invoke("load_achievements_cache");
      if (raw) {
        const parsed = JSON.parse(raw) as AchievementsCache;
        if (parsed && parsed.games) {
          cacheRef.current = parsed;
          setCache(parsed);
        }
      }
    } catch (err) {
      console.warn("[AchievementContext] Failed to reload cache:", err);
    }
  }, []);

  const getGameAchievements = useCallback(
    (gameId: string): GameAchievementData | null => {
      return cache.games[gameId] ?? null;
    },
    [cache]
  );

  const getSteamSession = useCallback(async () => {
    // Probe the OS keychain first — it owns the verified session blob.
    try {
      const session = await invoke<SteamSession | null>("steam_get_session");
      if (session) return session;
    } catch {
      // fall through to the recovery path below
    }

    // The OS keychain occasionally loses entries across reboots (Windows
    // Credential Manager after OS upgrades, Secret Service daemon
    // hiccups on Linux). SettingsPage auto-reconnects from the
    // localStorage-persisted inputs when it mounts; mirror that recovery
    // here so achievement syncs heal themselves too instead of failing
    // with "Not connected to Steam" while the user is actually connected.
    // `steam_connect` re-validates the pair and rewrites the keychain
    // entry, so subsequent calls hit the fast path again.
    const apiKey = localStorage.getItem("gamelib-steam-apikey")?.trim();
    const steamId = localStorage.getItem("gamelib-steam-steamid")?.trim();
    if (!apiKey || !steamId) return null;
    try {
      return await invoke<SteamSession>("steam_connect", { apiKey, steamId });
    } catch {
      return null;
    }
  }, []);

  const syncGameAchievements = useCallback(
    async (gameId: string, steamAppId: number) => {
      const session = await getSteamSession();
      if (!session) {
        throw new Error("Not connected to Steam. Please log in via Settings.");
      }

      const data: GameAchievementData = await invoke("fetch_achievements", {
        steamAppId,
        steamId: session.steamId,
        apiToken: session.apiKey,
      });

      // Stamp sync time
      data.lastSynced = Date.now();

      setCache((prev) => ({
        ...prev,
        games: { ...prev.games, [gameId]: data },
      }));
      // Persist right away so a reload (even seconds later) keeps the
      // sync — the old debounced save could lose it.
      cacheRef.current = {
        ...cacheRef.current,
        games: { ...cacheRef.current.games, [gameId]: data },
      };
      await persistCache();
    },
    [getSteamSession, persistCache]
  );

  // How often the bulk loop flushes a snapshot to disk. Saving after
  // every game would hammer the DB with full-cache transactions; once
  // per batch keeps a mid-sync app reload from losing everything.
  const SAVE_EVERY_N_GAMES = 10;

  const syncAllAchievements = useCallback(
    async (games: Game[]) => {
      const steamGames = games.filter((g) => g.steamAppId && g.platform === "Steam");
      if (steamGames.length === 0) return;

      const session = await getSteamSession();
      if (!session) {
        throw new Error("Not connected to Steam. Please log in via Settings.");
      }

      setIsSyncing(true);
      isSyncingRef.current = true;
      setSyncProgress({ current: 0, total: steamGames.length });

      try {
        let current = 0;

        for (const game of steamGames) {
          try {
            const data: GameAchievementData = await invoke("fetch_achievements", {
              steamAppId: game.steamAppId!,
              steamId: session.steamId,
              apiToken: session.apiKey,
            });
            data.lastSynced = Date.now();
            // Functional update — merging into the latest state so any
            // per-game sync that lands mid-run (game-exit auto-sync,
            // tab syncs) is never clobbered by a stale snapshot.
            setCache((prev) => ({
              ...prev,
              games: { ...prev.games, [game.id]: data },
            }));
            cacheRef.current = {
              ...cacheRef.current,
              games: { ...cacheRef.current.games, [game.id]: data },
            };
          } catch (err) {
            console.warn(
              `[AchievementContext] Failed to sync ${game.name}:`,
              err
            );
          }
          current++;
          setSyncProgress({ current, total: steamGames.length });

          // Incremental save: an app reload mid-sync keeps every game
          // synced so far instead of losing the whole run.
          if (current % SAVE_EVERY_N_GAMES === 0) {
            await persistCache();
          }

          // Rate limit: Steam API allows ~100k/day but can 429 on bursts.
          // 300ms between requests ≈ 3.3 req/s — well within limits.
          if (current < steamGames.length) {
            await new Promise((r) => setTimeout(r, 300));
          }
        }

        // Final flush — always persists the tail of the loop.
        await persistCache();
      } finally {
        setIsSyncing(false);
        isSyncingRef.current = false;
        setSyncProgress(null);
        // reloadCache calls that arrived mid-run (e.g. an
        // `achievements-updated` event) were deferred because the bulk
        // loop owns the in-memory cache; run them now that it's
        // quiescent so their fresher disk state lands.
        if (reloadQueuedRef.current) {
          reloadQueuedRef.current = false;
          await reloadCache();
        }
      }
    },
    [getSteamSession, persistCache, reloadCache]
  );

  const { showToast } = useToast();
  const { t } = useLanguage();

  const syncLocalAchievements = useCallback(
    async (gameId: string, steamAppId?: number) => {
      const data: GameAchievementData = await invoke("sync_local_achievements", {
        gameId,
        steamAppId: steamAppId ?? null,
      });
      data.lastSynced = Date.now();
      setCache((prev) => ({
        ...prev,
        games: { ...prev.games, [gameId]: data },
      }));
      cacheRef.current = {
        ...cacheRef.current,
        games: { ...cacheRef.current.games, [gameId]: data },
      };
      await persistCache();
    },
    [persistCache]
  );

  const updateSettings = useCallback(
    (updates: Partial<AchievementSettings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...updates };
        saveSettings(next);
        // Mirror the local-achievement toggle to the Rust watcher.
        if (
          updates.localAchievementsEnabled !== undefined &&
          updates.localAchievementsEnabled !== prev.localAchievementsEnabled
        ) {
          invoke("set_local_achievements_enabled", {
            enabled: updates.localAchievementsEnabled,
          }).catch((err) =>
            console.warn(
              "[AchievementContext] Failed to set local achievements flag:",
              err
            )
          );
        }
        return next;
      });
    },
    []
  );

  // Listen for game-exited events to automatically sync achievements for that game
  const { games } = useGames();
  const gamesRef = useRef(games);
  useEffect(() => {
    gamesRef.current = games;
  }, [games]);

  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    const unlisten = listen<{ gameId: string }>("game-exited", async (event) => {
      const { gameId } = event.payload;
      const game = gamesRef.current.find((g) => g.id === gameId);
      if (!game) return;

      // Owned Steam games → authoritative Steam Web API sync.
      if (game.steamAppId && game.platform === "Steam") {
        try {
          await syncGameAchievements(game.id, game.steamAppId);
          console.log(`[AchievementContext] Auto-synced Steam achievements for ${game.name} on exit`);
        } catch (err) {
          console.warn(`[AchievementContext] Failed to auto-sync Steam achievements on exit for ${game.name}:`, err);
        }
      }

      // Non-Steam games with a Steam AppID (cracked / downloaded) → scan
      // local crack/emulator achievement files. Owned Steam games are
      // covered by the authoritative Steam sync above.
      if (
        game.steamAppId &&
        game.platform !== "Steam" &&
        settingsRef.current.localAchievementsEnabled
      ) {
        try {
          await syncLocalAchievements(game.id);
          console.log(`[AchievementContext] Synced local achievements for ${game.name} on exit`);
        } catch (err) {
          console.warn(`[AchievementContext] Failed to sync local achievements on exit for ${game.name}:`, err);
        }
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [syncGameAchievements, syncLocalAchievements]);

  // Backend watcher events: reload the affected game's cache, and toast
  // on newly-unlocked achievements.
  useEffect(() => {
    const unlistenUpdated = listen<{ gameId: string }>(
      "achievements-updated",
      () => {
        reloadCache();
      }
    );
    const unlistenUnlocked = listen<{
      gameId: string;
      gameName: string;
      achievements: { displayName: string; icon: string; isRare: boolean }[];
    }>("achievement-unlocked", (event) => {
      if (!settingsRef.current.notifyOnUnlock) return;
      const { gameName, achievements } = event.payload;
      if (!achievements?.length) return;
      const label =
        achievements.length === 1
          ? t("achievementsTab.unlockedSingular", { name: achievements[0].displayName, game: gameName })
          : t("achievementsTab.unlockedPlural", { count: achievements.length, game: gameName });
      showToast(label, "success");
    });

    return () => {
      unlistenUpdated.then((fn) => fn());
      unlistenUnlocked.then((fn) => fn());
    };
  }, [reloadCache, showToast, t]);

  // Push the persisted local-achievement toggle to the Rust watcher on
  // startup so the two stay in sync across restarts.
  useEffect(() => {
    invoke("set_local_achievements_enabled", {
      enabled: settingsRef.current.localAchievementsEnabled,
    }).catch(() => {});
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AchievementContext.Provider
      value={{
        cache,
        getGameAchievements,
        syncGameAchievements,
        syncLocalAchievements,
        syncAllAchievements,
        isSyncing,
        syncProgress,
        settings,
        updateSettings,
        clearCache,
        reloadCache,
      }}
    >
      {children}
    </AchievementContext.Provider>
  );
}

/** Hook to access the achievements context. */
export function useAchievements() {
  const ctx = useContext(AchievementContext);
  if (!ctx) {
    throw new Error("useAchievements must be used within AchievementProvider");
  }
  return ctx;
}
