/**
 * Store integrations: local install detection, owned-game sync, sources.
 *
 * Workstream: `stores`. See `STUBS_BY_AREA.md` → "stores" (plus
 * `search_store_games`) and `ARCHITECTURE.md`.
 *
 * Reference ports (Rust deleted from the tree, available via `git show HEAD:`):
 *   • `steam_game_watcher.rs`, `steam/sync.rs`, `steam/dlc.rs`   → features/stores/steam*
 *   • `store_installs/*`, `game_watcher/steam_install.rs`      → features/stores/watcher.ts
 *   • `gog/installed.rs`, `uplay/{mod,cache}.rs`,
 *     `rockstar/{mod,sync}.rs`, `beta_stores/*`, `humble/installed.rs`,
 *     `store_installs/epic.rs`                                 → features/stores/{gog,uplay,rockstar,misc,epic}.ts
 *   • `store_checker.rs`                                       → features/stores/ownership.ts
 *   • `source_manager.rs`, `db/sources.rs`                     → features/stores/sources.ts
 *   • `store.rs`, `db/store_cache.rs`                          → features/stores/storeCache.ts
 */
import { shell } from "electron";
import { registerCommands, type CommandHandler } from "../ipc";
import { argNumber, argString, argStringArray, argNumberArray } from "../features/stores/types";
import {
  checkOwnership,
  checkOwnershipForIds,
  setEpicOwned,
  setSteamOwned,
} from "../features/stores/ownership";
import {
  addSource,
  addSourcesBulk,
  listSources,
  loadSourceCacheRaw,
  refreshAllSources,
  refreshSource,
  removeSource,
  saveSourceCacheRaw,
  searchSources,
  toggleSource,
} from "../features/stores/sources";
import {
  fetchStoreGames,
  getRandomStoreGames,
  getStoreGameDetail,
  loadStoreCacheRaw,
  saveStoreCacheRaw,
  searchStoreGames,
  storeCacheStats,
} from "../features/stores/storeCache";
import { importDetectedInstalls } from "../features/stores/libraryImport";
import { scanLocalInstalls } from "../features/stores/scan";
import {
  nudgeStoreInstalls,
  startStoreWatchers,
  storeInstallsSnapshot,
} from "../features/stores/watcher";
import {
  clearSteamSession,
  connectSteam,
  loadSteamSession,
  syncSteamGames,
  type SteamSession,
} from "../features/stores/steamSession";
import { lookupSteamAppId } from "../features/stores/steamApi";
import {
  familyShareInfo,
  getGameDlcs,
  markDlcsOwned,
  setDlcWatch,
  toggleDlcOwned,
} from "../features/stores/dlc";
import { storeArtworkFile } from "../features/stores/artwork";
import { launchRockstarTitle } from "../features/stores/rockstar";
import { detectRockstarClient } from "../features/stores/rockstar";
import { detectUplayClient } from "../features/stores/uplay";
import {
  getHumbleSettings,
  getUplaySettings,
  saveHumbleSettings,
  saveUplaySettings,
  syncEpicLibrary,
  syncGogLibrary,
  syncHumbleLibrary,
  syncRockstarLibrary,
  syncUplayLibrary,
} from "../features/stores/otherSync";
import {
  epicFinishLogin,
  epicIsAuthenticated,
  epicLogout,
  epicLoginWithRefreshToken,
  epicStartLogin,
} from "../features/integrations/epicAuth";
import {
  gogIsAuthenticated,
  gogLogout,
  gogStartLogin,
} from "../features/integrations/gogAuth";
import {
  humbleIsAuthenticated,
  humbleLogout,
  humbleStartLogin,
} from "../features/integrations/humbleAuth";

/** Read a Tauri-style camelCase arg that the renderer also spells snake_case. */
function sessionArg(args: Record<string, unknown>): SteamSession | null {
  const raw = args.session;
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const steamId = argString(value, "steamId", "steam_id");
  const apiKey = argString(value, "apiKey", "api_key");
  if (!steamId || !apiKey) return null;
  return { steamId, apiKey, displayName: argString(value, "displayName") || undefined };
}

function positiveInt(value: number | null, fallback: number): number {
  if (value === null || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.trunc(value));
}

const commands: Record<string, CommandHandler> = {
  // ── Cross-store ownership ──────────────────────────────────────────
  check_ownership: (args) =>
    checkOwnership(
      argString(args, "gameName", "game_name"),
      argStringArray(args.localLibraryNames ?? args.local_library_names),
    ),

  check_ownership_for_ids: (args) =>
    checkOwnershipForIds(
      argString(args, "gameName", "game_name"),
      argStringArray(args.localLibraryNames ?? args.local_library_names),
      argNumber(args, "steamAppId", "steamAppid", "steam_appid"),
      argString(args, "epicOwnedId", "epic_owned_id") || null,
    ),

  set_steam_owned: (args) => {
    setSteamOwned(argNumberArray(args.appids ?? args.appIds));
    return null;
  },

  set_epic_owned: (args) => {
    setEpicOwned(argStringArray(args.ids));
    return null;
  },

  lookup_steam_app_id_for_game: async (args) =>
    lookupSteamAppId(argString(args, "gameName", "game_name")),

  // ── Steam account ──────────────────────────────────────────────────
  steam_connect: async (args) =>
    connectSteam(
      argString(args, "apiKey", "api_key"),
      argString(args, "steamId", "steam_id"),
    ),

  steam_get_session: () => loadSteamSession(),

  steam_logout: () => {
    clearSteamSession();
    return null;
  },

  steam_sync_games: async (args) =>
    syncSteamGames({
      session: sessionArg(args),
      includePlaytime: args.includePlaytime !== false,
      includeAchievements: args.includeAchievements === true,
      includeFamilySharing: args.includeFamilySharing !== false,
    }),

  // ── Steam DLC ──────────────────────────────────────────────────────
  steam_get_game_dlcs: async (args) => {
    const appId = argNumber(args, "appId", "app_id");
    if (appId === null) throw new Error("steam_get_game_dlcs needs the base game's appId.");
    return getGameDlcs(
      Math.trunc(appId),
      argString(args, "lang") || "en",
      args.forceRefresh === true,
    );
  },

  steam_toggle_dlc_owned: (args) => {
    const dlcAppId = argNumber(args, "dlcAppId", "dlc_app_id");
    if (dlcAppId === null) throw new Error("steam_toggle_dlc_owned needs `dlcAppId`.");
    toggleDlcOwned(Math.trunc(dlcAppId), args.owned === true);
    return null;
  },

  steam_set_dlc_watch: (args) => {
    const dlcAppId = argNumber(args, "dlcAppId", "dlc_app_id");
    if (dlcAppId === null) throw new Error("steam_set_dlc_watch needs `dlcAppId`.");
    setDlcWatch(Math.trunc(dlcAppId), args.watch === true);
    return null;
  },

  steam_mark_dlcs_owned: (args) => {
    const ids = argNumberArray(args.dlcAppIds ?? args.dlc_app_ids);
    markDlcsOwned(ids, args.owned !== false);
    return null;
  },

  steam_get_family_share_info: async (args) => {
    const appId = argNumber(args, "appId", "app_id");
    if (appId === null) return { isShared: false };
    return familyShareInfo(Math.trunc(appId));
  },

  // Family Group / launch options read `localconfig.vdf` (family roster) and
  // Steam's per-app launch config. Neither is ported yet; both degrade to the
  // "nothing configured" shapes the UI already renders.
  steam_get_family_group: () => null,
  steam_launch_options: () => [],

  // ── GOG ────────────────────────────────────────────────────────────
  gog_is_authenticated: () => gogIsAuthenticated(),
  gog_logout: () => gogLogout(),
  gog_start_login: () => gogStartLogin(),
  gog_sync_library: async () => syncGogLibrary(),
  gog_fetch_achievements: (args) => {
    const games = Array.isArray(args.games) ? args.games : [];
    return games.map((game) => ({
      gameId: String((game as { gameId?: unknown }).gameId ?? ""),
      data: null,
      error: "GOG is not authenticated — connect GOG Galaxy to fetch achievements.",
    }));
  },

  // ── Epic ───────────────────────────────────────────────────────────
  epic_is_authenticated: () => epicIsAuthenticated(),
  epic_logout: () => epicLogout(),
  epic_start_login: () => epicStartLogin(),
  epic_finish_login: (args) => {
    const code = argString(args, "authCode", "auth_code");
    if (!code) throw new Error("An Epic authorization code is required");
    return epicFinishLogin(code);
  },
  epic_login_with_refresh_token: (args) => {
    const refreshToken = argString(args, "refreshToken", "refresh_token");
    if (!refreshToken) throw new Error("An Epic refresh token is required");
    return epicLoginWithRefreshToken(
      refreshToken,
      argString(args, "accountId", "account_id"),
      argString(args, "displayName", "display_name") || undefined,
    );
  },
  epic_sync_library: async () => syncEpicLibrary(),
  epic_fetch_achievements: (args) => {
    const games = Array.isArray(args.games) ? args.games : [];
    return games.map((game) => ({
      gameId: String((game as { gameId?: unknown }).gameId ?? ""),
      data: null,
      error: "Epic is not authenticated — connect Epic to fetch achievements.",
    }));
  },

  // ── Humble ─────────────────────────────────────────────────────────
  humble_get_settings: () => getHumbleSettings(),
  humble_save_settings: (args) => {
    const settings = (args.settings ?? args) as Parameters<typeof saveHumbleSettings>[0];
    return saveHumbleSettings(settings);
  },
  humble_is_authenticated: () => humbleIsAuthenticated(),
  humble_logout: () => humbleLogout(),
  humble_start_login: () => humbleStartLogin(),
  humble_sync_library: async () => syncHumbleLibrary(),

  // ── Rockstar ───────────────────────────────────────────────────────
  rockstar_detect_client: async () => detectRockstarClient(),
  rockstar_sync_library: async () => syncRockstarLibrary(),
  rockstar_launch_game: async (args) => {
    const titleId = argString(args, "titleId", "title_id");
    if (!titleId) {
      throw new Error("rockstar_launch_game needs the game's `titleId`.");
    }
    const pid = await launchRockstarTitle(titleId);
    return String(pid);
  },

  // ── Ubisoft Connect ────────────────────────────────────────────────
  uplay_detect_client: async () => detectUplayClient(),
  uplay_get_settings: () => getUplaySettings(),
  uplay_save_settings: (args) => {
    const settings = (args.settings ?? args) as Parameters<typeof saveUplaySettings>[0];
    return saveUplaySettings(settings);
  },
  uplay_sync_library: async () => syncUplayLibrary(),
  uplay_launch_game: async (args) => {
    const uplayId = argString(args, "uplayId", "uplay_id");
    if (!uplayId) throw new Error("uplay_launch_game needs the game's `uplayId`.");
    // The protocol handler performs Ubisoft's DRM bootstrap, which spawning
    // UbisoftConnect.exe directly would skip.
    await shell.openExternal(`uplay://launch/${encodeURIComponent(uplayId)}/0`);
    return "0";
  },

  // ── Store transfer / install watching ──────────────────────────────
  store_installs_list: () => storeInstallsSnapshot(),

  store_installs_scan_now: async () => {
    // Ask the transfer watcher for a pass now, then reconcile the library
    // against what is actually installed. Importing here (and only here) is
    // deliberate: it is the user-triggered post-install path, so a backend
    // row can never race the renderer's own owned-library import.
    nudgeStoreInstalls();
    const report = await scanLocalInstalls();
    const imported = importDetectedInstalls(report.installs);
    return {
      startedAt: report.startedAt,
      finishedAt: report.finishedAt,
      stores: report.stores.map((store) => ({
        store: store.store,
        available: store.available,
        installs: store.installs.length,
        errors: store.errors,
      })),
      imported,
    };
  },

  // ── Sources ────────────────────────────────────────────────────────
  sources_list: () => listSources(),
  sources_add: async (args) =>
    addSource(argString(args, "url"), argString(args, "name")),
  sources_add_bulk: async (args) =>
    addSourcesBulk(argStringArray(args.urls), argStringArray(args.names)),
  sources_remove: (args) => {
    removeSource(argString(args, "id"));
    return null;
  },
  sources_toggle: (args) => {
    toggleSource(argString(args, "id"));
    return null;
  },
  sources_refresh: async (args) => {
    await refreshSource(argString(args, "id"));
    return null;
  },
  sources_refresh_all: async () => {
    await refreshAllSources();
    return null;
  },
  sources_search_game: (args) =>
    // `steamAppId` is accepted for signature compatibility; the local index is
    // the single source of truth for matching (Rust behaviour).
    searchSources(argString(args, "query")),
  load_source_cache: () => loadSourceCacheRaw(),
  save_source_cache: (args) => {
    saveSourceCacheRaw(argString(args, "data"));
    return null;
  },

  // ── Store catalogue cache ──────────────────────────────────────────
  load_store_cache: () => loadStoreCacheRaw(),
  save_store_cache: (args) => {
    saveStoreCacheRaw(argString(args, "data"));
    return null;
  },
  fetch_store_games: (args) => {
    if (process.env.GI_IGDB_DEBUG === "1") {
      console.log("[store] fetch_store_games args:", JSON.stringify(args));
    }
    return fetchStoreGames(args);
  },
  search_store_games: (args) => {
    if (process.env.GI_IGDB_DEBUG === "1") {
      console.log("[store] search_store_games args:", JSON.stringify(args));
    }
    return searchStoreGames(args);
  },
  get_store_game_detail: (args) => getStoreGameDetail(argString(args, "slug")),
  get_random_store_games: (args) =>
    getRandomStoreGames(positiveInt(argNumber(args, "limit"), 10)),

  // ── Artwork ────────────────────────────────────────────────────────
  store_artwork_file: (args) =>
    storeArtworkFile(
      argString(args, "gameId", "game_id"),
      argString(args, "slot"),
      argString(args, "filePath", "file_path"),
    ),

  /** Diagnostics only — not part of the Tauri catalog. */
  __store_scan_report: async () => {
    const report = await scanLocalInstalls();
    return {
      stores: report.stores.map((store) => ({
        store: store.store,
        available: store.available,
        installs: store.installs.map((install) => ({
          storeId: install.storeId,
          name: install.name,
          installDir: install.installDir,
          exePath: install.exePath,
        })),
        probed: store.probed,
        errors: store.errors,
      })),
      cache: storeCacheStats(),
      sources: listSources().length,
    };
  },
};

export const storeCommands: Record<string, CommandHandler> = commands;

export function registerStoreCommands(): void {
  registerCommands(storeCommands, { override: true });
  // The transfer watcher is a background poller, not a command. Starting it at
  // registration mirrors `StoreInstallManager::start` in the Rust boot path.
  startStoreWatchers();
}
