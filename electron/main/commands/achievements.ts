/**
 * Achievement providers (Steam/GOG/Epic/local/RetroAchievements/manual).
 *
 * Workstream: `achievements`. See `STUBS_BY_AREA.md` → "achievements".
 * Reference: `src-tauri/src/achievements.rs`, `local_achievements.rs`,
 * `retro.rs`, `manual_links.rs`, `db/achievements.rs`,
 * `db/achievement_links.rs`, `achievement_stats.rs`.
 *
 * Data lives under `app.getPath('userData')`:
 *   achievements.json          per-game `GameAchievementData` cache
 *   achievement-links.json     per-game source identities + manual unlocks
 *   achievement-settings.json  RA credentials/console map, local toggle, RA caches
 *
 * Credentials: Steam uses the connected session (or `STEAM_API_KEY`);
 * RetroAchievements needs a username + Web API key configured in Settings.
 * GOG/Epic achievements need an account sign-in this port does not perform, so
 * those two commands return cached rows or a clear "requires sign-in" note.
 */
import { emit, registerCommands, type CommandArgs, type CommandHandler } from "../ipc";
import { setAppSetting } from "../state/appSettings";
import { getGame } from "../state/libraryStore";
import type { Achievement, ManualUnlock } from "../../../src/types/game";
import { fetchEpicAchievements, fetchGogAchievements } from "../features/achievements/batch";
import { syncLocalAchievementsForGame } from "../features/achievements/local";
import {
  fetchManualSchema,
  removeManualLink,
  saveManualUnlocks,
  syncManual,
  upsertManualLink,
} from "../features/achievements/manual";
import { buildOverview } from "../features/achievements/overview";
import {
  getRetroConsoles,
  getRetroSettings,
  saveRetroSettings,
  searchRetroGames,
  setForcedRaGameId,
  setLocalAchievementsEnabled,
  syncRetroGame,
} from "../features/achievements/retro";
import {
  searchSteamStore,
  steamAchievementsOrCached,
} from "../features/achievements/steam";
import {
  cachePayload,
  clearCache,
  deleteCachedGame,
  findCachedBySteamAppId,
  getCachedGame,
  listAllLinks,
  listCachedGames,
  replaceCacheFromPayload,
  saveGamePayload,
} from "../features/achievements/store";

function stringArg(args: CommandArgs, key: string): string {
  const value = args[key];
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

function numberArg(args: CommandArgs, key: string, fallback = 0): number {
  const value = args[key];
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function requiredString(args: CommandArgs, key: string): string {
  const value = stringArg(args, key).trim();
  if (!value) throw new Error(`Missing "${key}" — the achievements request cannot run without it.`);
  return value;
}

function recordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is Record<string, unknown> =>
      Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
  );
}

function appIdForGame(gameId: string): number {
  let fromRow = 0;
  try {
    fromRow = Number(getGame(gameId)?.steamAppId ?? 0);
  } catch {
    fromRow = 0;
  }
  return Number.isFinite(fromRow) ? Math.trunc(fromRow) : 0;
}

function gameNameFor(gameId: string): string {
  try {
    return getGame(gameId)?.name ?? gameId;
  } catch {
    return gameId;
  }
}

function gameExeFor(gameId: string): string | null {
  try {
    const game = getGame(gameId);
    const candidate = game?.detectedExe || game?.path || "";
    return candidate.trim() ? candidate.trim() : null;
  } catch {
    return null;
  }
}

interface UnlockNotice {
  displayName: string;
  icon: string;
  isRare: boolean;
}

/** `achievement-unlocked` payload the renderer's toast listener reads. */
function emitUnlocked(gameId: string, gameName: string, achievements: Achievement[]): void {
  const notices: UnlockNotice[] = achievements.map((achievement) => ({
    displayName: achievement.displayName || achievement.apiName,
    icon: achievement.icon ?? "",
    isRare: achievement.percent > 0 && achievement.percent < 10,
  }));
  if (notices.length === 0) return;
  emit("achievement-unlocked", { gameId, gameName, achievements: notices });
}

function emitUpdated(gameId: string): void {
  emit("achievements-updated", { gameId });
}

/**
 * Compare a freshly fetched Steam payload with the cached one and emit unlock
 * notices for genuinely new rows. The first sync of a game (no cached row) is
 * silent: everything would look "new" and the user would get a wall of toasts.
 */
function notifySteamUnlocks(steamAppId: number, data: { achievements: Achievement[] }): void {
  const cached = findCachedBySteamAppId(steamAppId);
  if (!cached || cached.data.achievements.length === 0) return;
  const before = new Set(
    cached.data.achievements
      .filter((achievement) => achievement.achieved)
      .map((achievement) => achievement.apiName.trim().toUpperCase()),
  );
  const newly = data.achievements.filter(
    (achievement) =>
      achievement.achieved &&
      !before.has(achievement.apiName.trim().toUpperCase()),
  );
  if (newly.length === 0) return;
  emitUnlocked(cached.gameId, gameNameFor(cached.gameId), newly);
}

export const achievementCommands: Record<string, CommandHandler> = {
  // ── Cache ──────────────────────────────────────────────────────────
  load_achievements_cache: () => cachePayload(),

  save_achievements_cache: (args) => {
    replaceCacheFromPayload(stringArg(args, "data"));
    return null;
  },

  clear_achievements_cache: () => {
    clearCache();
    return null;
  },

  delete_achievement: (args) => {
    deleteCachedGame(requiredString(args, "gameId"));
    return null;
  },

  save_achievement: (args) => {
    const gameId = requiredString(args, "gameId");
    const data = stringArg(args, "data");
    if (!data.trim()) throw new Error(`Missing "data" for game "${gameId}".`);
    saveGamePayload(gameId, data);
    return null;
  },

  get_achievement_overview: () => buildOverview(listCachedGames()),

  get_achievements_for_game: (args) => getCachedGame(requiredString(args, "gameId")),

  // ── Steam ──────────────────────────────────────────────────────────
  fetch_achievements: async (args) => {
    const steamAppId = numberArg(args, "steamAppId");
    if (steamAppId <= 0) {
      throw new Error("A Steam AppID is required to fetch achievements.");
    }
    const data = await steamAchievementsOrCached(
      steamAppId,
      stringArg(args, "steamId"),
      stringArg(args, "apiToken"),
    );
    notifySteamUnlocks(steamAppId, data);
    return data;
  },

  // ── Local (crack / emulator) ───────────────────────────────────────
  sync_local_achievements: async (args) => {
    const gameId = requiredString(args, "gameId");
    const override = numberArg(args, "steamAppId");
    const steamAppId = override > 0 ? override : appIdForGame(gameId);
    if (steamAppId <= 0) {
      throw new Error("Game has no Steam AppID — cannot locate achievements.");
    }
    const result = await syncLocalAchievementsForGame(
      gameId,
      steamAppId,
      gameExeFor(gameId),
    );
    if (result.newCount > 0) {
      emitUnlocked(gameId, gameNameFor(gameId), result.newlyUnlocked);
    }
    emitUpdated(gameId);
    return result.data;
  },

  set_local_achievements_enabled: (args) => {
    const enabled = Boolean(args.enabled);
    setLocalAchievementsEnabled(enabled);
    // Keep the legacy app-settings flag in step with the new document.
    setAppSetting("local_achievements", enabled);
    return null;
  },

  // ── Achievement links ──────────────────────────────────────────────
  achievement_links_list: () => listAllLinks(),

  // ── RetroAchievements ──────────────────────────────────────────────
  retro_get_settings: () => getRetroSettings(),

  retro_save_settings: (args) => {
    const patch: {
      username?: string;
      apiKey?: string;
      consoleMap?: Array<{ platform: string; consoleId: number }>;
      enabled?: boolean;
    } = {};
    if (Object.prototype.hasOwnProperty.call(args, "username")) {
      patch.username = stringArg(args, "username");
    }
    if (Object.prototype.hasOwnProperty.call(args, "apiKey")) {
      patch.apiKey = stringArg(args, "apiKey");
    }
    if (Object.prototype.hasOwnProperty.call(args, "consoleMap")) {
      patch.consoleMap = recordArray(args.consoleMap).map((entry) => ({
        platform: String(entry.platform ?? ""),
        consoleId: Number(entry.consoleId ?? 0),
      }));
    }
    if (Object.prototype.hasOwnProperty.call(args, "enabled")) {
      patch.enabled = Boolean(args.enabled);
    }
    saveRetroSettings(patch);
    return null;
  },

  retro_get_consoles: () => getRetroConsoles(),

  retro_search_games: (args) =>
    searchRetroGames(numberArg(args, "consoleId"), stringArg(args, "query")),

  retro_set_forced_game_id: (args) => {
    const gameId = requiredString(args, "gameId");
    const raw = args.raGameId;
    const raGameId =
      raw === null || raw === undefined || raw === "" ? null : numberArg(args, "raGameId");
    return setForcedRaGameId(gameId, raGameId !== null && raGameId > 0 ? raGameId : null);
  },

  retro_sync_game: async (args) => {
    const gameId = requiredString(args, "gameId");
    const data = await syncRetroGame(gameId);
    emitUpdated(gameId);
    return data;
  },

  // ── Manual (Steam-schema-backed) ───────────────────────────────────
  manual_search_steam: (args) => searchSteamStore(stringArg(args, "query")),

  manual_fetch_schema: (args) => {
    const appid = numberArg(args, "appid");
    if (appid <= 0) throw new Error("A Steam AppID is required to fetch the schema.");
    return fetchManualSchema(appid);
  },

  manual_link_create: (args) => {
    const gameId = requiredString(args, "gameId");
    const appid = numberArg(args, "appid");
    const name = stringArg(args, "name");
    return upsertManualLink(gameId, appid, name ? name : null);
  },

  manual_link_remove: (args) => {
    removeManualLink(requiredString(args, "gameId"));
    return null;
  },

  manual_sync: async (args) => {
    const gameId = requiredString(args, "gameId");
    const data = await syncManual(gameId);
    emitUpdated(gameId);
    return data;
  },

  manual_save_unlocks: async (args) => {
    const gameId = requiredString(args, "gameId");
    const unlocks: ManualUnlock[] = recordArray(args.unlocks).map((entry) => ({
      apiName: String(entry.apiName ?? ""),
      unlockTime: Number(entry.unlockTime ?? 0),
    }));
    const data = await saveManualUnlocks(gameId, unlocks);
    emitUpdated(gameId);
    return data;
  },

  // ── GOG / Epic (cached only until interactive auth lands) ──────────
  gog_fetch_achievements: (args) =>
    fetchGogAchievements(
      recordArray(args.games).map((entry) => ({
        gameId: String(entry.gameId ?? ""),
        storeId: typeof entry.storeId === "string" ? entry.storeId : null,
        namespace: typeof entry.namespace === "string" ? entry.namespace : null,
      })),
    ),

  epic_fetch_achievements: (args) =>
    fetchEpicAchievements(
      recordArray(args.games).map((entry) => ({
        gameId: String(entry.gameId ?? ""),
        storeId: typeof entry.storeId === "string" ? entry.storeId : null,
        namespace: typeof entry.namespace === "string" ? entry.namespace : null,
      })),
    ),
};

/** Register the achievement surface before the generic stub layer runs. */
export function registerAchievementCommands(): void {
  registerCommands(achievementCommands, { override: true });
}
