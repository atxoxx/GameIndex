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
  AchievementLink,
  Achievement,
  RetroSettings,
  RetroSettingsUpdate,
  RaConsole,
  RaSearchResult,
  SteamSearchResult,
  ManualUnlock,
  BatchSyncResult,
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
  /** Per-game source identities (`achievement_links` table), keyed by game ID. */
  links: Record<string, AchievementLink[]>;
  /** Re-fetch the achievement-links map after any link-mutating call. */
  refreshLinks: () => Promise<void>;
  /** Sync a game's achievements from RetroAchievements and update the cache. */
  syncRetroAchievements: (gameId: string) => Promise<GameAchievementData>;
  /** Sync a game's manually-tracked achievements (Steam schema + local unlocks). */
  syncManualAchievements: (gameId: string) => Promise<GameAchievementData>;
  /** Batch-sync achievements from GOG; applies each success and returns per-game results. */
  syncGogAchievements: (gameIds: string[]) => Promise<BatchSyncResult[]>;
  /** Batch-sync achievements from Epic; applies each success and returns per-game results. */
  syncEpicAchievements: (gameIds: string[]) => Promise<BatchSyncResult[]>;
  /** Persist manual unlock state for a game and refresh its cached payload. */
  saveManualUnlocks: (
    gameId: string,
    unlocks: ManualUnlock[]
  ) => Promise<GameAchievementData>;
  /** Set (or clear) the forced RetroAchievements game id for a game. */
  setForcedRaGameId: (
    gameId: string,
    raGameId: number | null
  ) => Promise<AchievementLink>;
  /** Create or update the manual Steam link for a game. */
  createManualLink: (
    gameId: string,
    appid: number,
    name?: string
  ) => Promise<AchievementLink>;
  /** Remove the manual Steam link for a game. */
  removeManualLink: (gameId: string) => Promise<void>;
  /** Search the Steam Store for manual-link candidates. */
  searchManualSteam: (query: string) => Promise<SteamSearchResult[]>;
  /** Fetch the public Steam achievement schema for an appid (no unlock state). */
  fetchManualSchema: (appid: number) => Promise<Achievement[]>;
  /** Read RetroAchievements settings (credentials masked). */
  getRetroSettings: () => Promise<RetroSettings>;
  /** Persist RetroAchievements settings (only provided fields are touched). */
  saveRetroSettings: (partial: RetroSettingsUpdate) => Promise<void>;
  /** List RetroAchievements consoles for the settings picker. */
  getRetroConsoles: () => Promise<RaConsole[]>;
  /** Search a console's RA game list. */
  searchRetroGames: (
    consoleId: number,
    query: string
  ) => Promise<RaSearchResult[]>;
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
  // Per-game source identities (`achievement_links` table). The backend
  // is the source of truth; the frontend only reads the map back and
  // refreshes it after link-mutating calls.
  const [links, setLinks] = useState<Record<string, AchievementLink[]>>({});

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

  // ── Multi-source sync helper ──────────────────────────────────────────

  // Generic "apply a freshly synced payload" step shared by every
  // non-Steam source (retro / manual / gog / epic). Mirrors the Steam
  // path exactly: stamp the sync time, merge into the latest in-memory
  // cache via a functional update (so a concurrent sync is never
  // clobbered by a stale snapshot), update the ref mirror, then kick the
  // same immediate, serialized persist chain.
  const applySynced = useCallback(
    (gameId: string, data: GameAchievementData) => {
      data.lastSynced = Date.now();
      setCache((prev) => ({
        ...prev,
        games: { ...prev.games, [gameId]: data },
      }));
      cacheRef.current = {
        ...cacheRef.current,
        games: { ...cacheRef.current.games, [gameId]: data },
      };
      return persistCache();
    },
    [persistCache]
  );

  // ── Achievement links ─────────────────────────────────────────────────

  const loadLinks = useCallback(async () => {
    try {
      const data: Record<string, AchievementLink[]> = await invoke(
        "achievement_links_list"
      );
      setLinks(data ?? {});
    } catch (err) {
      console.warn(
        "[AchievementContext] Failed to load achievement links:",
        err
      );
    }
  }, []);

  // Re-fetch the link map after any link-mutating call (create / remove
  // / force) so consumers always see fresh source identities.
  const refreshLinks = useCallback(async () => {
    await loadLinks();
  }, [loadLinks]);

  // Load the achievement-links map from disk on mount, alongside the
  // cache, so consumers (e.g. per-game source pickers) can read links
  // immediately without waiting for the first mutation.
  useEffect(() => {
    loadLinks();
  }, [loadLinks]);

  // ── RetroAchievements ─────────────────────────────────────────────────

  const syncRetroAchievements = useCallback(
    async (gameId: string): Promise<GameAchievementData> => {
      const data: GameAchievementData = await invoke("retro_sync_game", {
        gameId,
      });
      await applySynced(gameId, data);
      return data;
    },
    [applySynced]
  );

  const setForcedRaGameId = useCallback(
    async (
      gameId: string,
      raGameId: number | null
    ): Promise<AchievementLink> => {
      const link: AchievementLink = await invoke("retro_set_forced_game_id", {
        gameId,
        raGameId,
      });
      await refreshLinks();
      return link;
    },
    [refreshLinks]
  );

  const getRetroSettings = useCallback(async (): Promise<RetroSettings> => {
    return invoke("retro_get_settings");
  }, []);

  const saveRetroSettings = useCallback(
    async (partial: RetroSettingsUpdate) => {
      // Send only the fields the caller provided (undefined keys would
      // otherwise be ambiguous on the wire); each maps 1:1 to a Rust arg.
      const args: Record<string, unknown> = {};
      if (partial.username !== undefined) args.username = partial.username;
      if (partial.apiKey !== undefined) args.apiKey = partial.apiKey;
      if (partial.consoleMap !== undefined) args.consoleMap = partial.consoleMap;
      if (partial.enabled !== undefined) args.enabled = partial.enabled;
      await invoke("retro_save_settings", args);
    },
    []
  );

  const getRetroConsoles = useCallback(async (): Promise<RaConsole[]> => {
    return invoke("retro_get_consoles");
  }, []);

  const searchRetroGames = useCallback(
    async (consoleId: number, query: string): Promise<RaSearchResult[]> => {
      return invoke("retro_search_games", { consoleId, query });
    },
    []
  );

  // ── Manual (Steam-schema-backed) ──────────────────────────────────────

  const syncManualAchievements = useCallback(
    async (gameId: string): Promise<GameAchievementData> => {
      const data: GameAchievementData = await invoke("manual_sync", {
        gameId,
      });
      await applySynced(gameId, data);
      return data;
    },
    [applySynced]
  );

  const saveManualUnlocks = useCallback(
    async (
      gameId: string,
      unlocks: ManualUnlock[]
    ): Promise<GameAchievementData> => {
      const data: GameAchievementData = await invoke("manual_save_unlocks", {
        gameId,
        unlocks,
      });
      await applySynced(gameId, data);
      return data;
    },
    [applySynced]
  );

  const createManualLink = useCallback(
    async (
      gameId: string,
      appid: number,
      name?: string
    ): Promise<AchievementLink> => {
      const link: AchievementLink = await invoke("manual_link_create", {
        gameId,
        appid,
        name: name ?? null,
      });
      await refreshLinks();
      return link;
    },
    [refreshLinks]
  );

  const removeManualLink = useCallback(async (gameId: string) => {
    await invoke("manual_link_remove", { gameId });
    await refreshLinks();
  }, [refreshLinks]);

  const searchManualSteam = useCallback(
    async (query: string): Promise<SteamSearchResult[]> => {
      return invoke("manual_search_steam", { query });
    },
    []
  );

  const fetchManualSchema = useCallback(
    async (appid: number): Promise<Achievement[]> => {
      return invoke("manual_fetch_schema", { appid });
    },
    []
  );

  // ── GOG / Epic batch sync ─────────────────────────────────────────────

  const syncGogAchievements = useCallback(
    async (gameIds: string[]): Promise<BatchSyncResult[]> => {
      const results: BatchSyncResult[] = await invoke("gog_fetch_achievements", {
        gameIds,
      });
      for (const result of results) {
        // A success row carries data; a soft note or hard error doesn't.
        if (result.data) {
          await applySynced(result.gameId, result.data);
        }
      }
      return results;
    },
    [applySynced]
  );

  const syncEpicAchievements = useCallback(
    async (gameIds: string[]): Promise<BatchSyncResult[]> => {
      const results: BatchSyncResult[] = await invoke(
        "epic_fetch_achievements",
        { gameIds }
      );
      for (const result of results) {
        if (result.data) {
          await applySynced(result.gameId, result.data);
        }
      }
      return results;
    },
    [applySynced]
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

      // Owned Steam games → authoritative Steam Web API sync. Gated by
      // the auto-sync setting: users who disabled it skip the Steam Web
      // API call entirely (avoids wasted requests / 429s on short
      // sessions).
      if (
        game.steamAppId &&
        game.platform === "Steam" &&
        settingsRef.current.autoSyncOnSteamSync
      ) {
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
        links,
        refreshLinks,
        syncRetroAchievements,
        syncManualAchievements,
        syncGogAchievements,
        syncEpicAchievements,
        saveManualUnlocks,
        setForcedRaGameId,
        createManualLink,
        removeManualLink,
        searchManualSteam,
        fetchManualSchema,
        getRetroSettings,
        saveRetroSettings,
        getRetroConsoles,
        searchRetroGames,
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
