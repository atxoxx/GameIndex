import type { Game, PlayStatus } from "../../types/game";
import { PLAY_STATUS_DETAILS, parsePlayTime } from "../../types/game";
import type {
  SidebarGroup,
  SidebarGroupBy,
  SidebarSortDirection,
  SidebarStats,
  SidebarViewOptions,
} from "./types";

/**
 * How many of the most-recently-played games the sidebar's
 * "Recently Played" section shows at the top of the scroll list.
 */
export const RECENTLY_PLAYED_COUNT = 5;

const PINNED_IDS_STORAGE_KEY = "gamelib.sidebar.pinned_ids:v1";
const COLLAPSED_SECTIONS_STORAGE_KEY = "gamelib.sidebar.collapsed_sections:v1";
const SIDEBAR_VIEW_OPTIONS_STORAGE_KEY = "gamelib.sidebar.view_options:v1";
const SIDEBAR_GROUP_BY_STORAGE_KEY = "gamelib.sidebar.group_by:v1";
const SIDEBAR_SORT_DIRECTION_STORAGE_KEY = "gamelib.sidebar.sort_direction:v1";

export const DEFAULT_VIEW_OPTIONS: SidebarViewOptions = {
  groupBy: "none",
  density: "standard",
  showPlaytime: true,
  showPlatformBadge: true,
  showAchievements: true,
  showRatings: true,
};

/**
 * Read the persisted pinned-id set from localStorage.
 */
export function loadPinnedIds(): Set<string> {
  try {
    if (typeof localStorage === "undefined") return new Set();
    const raw = localStorage.getItem(PINNED_IDS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    return new Set();
  }
}

/**
 * Persist pinned game IDs to localStorage safely.
 */
export function savePinnedIds(pinnedIds: Set<string>): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(
      PINNED_IDS_STORAGE_KEY,
      JSON.stringify(Array.from(pinnedIds))
    );
  } catch {
    /* ignore storage errors */
  }
}

/**
 * Read the persisted collapsed sections map from localStorage.
 */
export function loadCollapsedSections(): Record<string, boolean> {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(COLLAPSED_SECTIONS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, boolean>;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Persist collapsed sections map to localStorage safely.
 */
export function saveCollapsedSections(collapsed: Record<string, boolean>): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(
      COLLAPSED_SECTIONS_STORAGE_KEY,
      JSON.stringify(collapsed)
    );
  } catch {
    /* ignore storage errors */
  }
}

/**
 * Load persisted sidebar view options.
 */
export function loadSidebarViewOptions(): SidebarViewOptions {
  try {
    if (typeof localStorage === "undefined") return DEFAULT_VIEW_OPTIONS;
    const raw = localStorage.getItem(SIDEBAR_VIEW_OPTIONS_STORAGE_KEY);
    if (!raw) return DEFAULT_VIEW_OPTIONS;
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      return {
        ...DEFAULT_VIEW_OPTIONS,
        ...parsed,
      };
    }
    return DEFAULT_VIEW_OPTIONS;
  } catch {
    return DEFAULT_VIEW_OPTIONS;
  }
}

/**
 * Persist sidebar view options.
 */
export function saveSidebarViewOptions(opts: SidebarViewOptions): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(SIDEBAR_VIEW_OPTIONS_STORAGE_KEY, JSON.stringify(opts));
  } catch {
    /* ignore storage errors */
  }
}

/**
 * Load persisted sidebar Group By choice.
 */
export function loadSidebarGroupBy(): SidebarGroupBy {
  try {
    if (typeof localStorage === "undefined") return "none";
    const raw = localStorage.getItem(SIDEBAR_GROUP_BY_STORAGE_KEY);
    if (
      raw === "none" ||
      raw === "platform" ||
      raw === "play_status" ||
      raw === "genre" ||
      raw === "letter" ||
      raw === "installed" ||
      raw === "decade"
    ) {
      return raw;
    }
    return "none";
  } catch {
    return "none";
  }
}

/**
 * Save sidebar Group By choice.
 */
export function saveSidebarGroupBy(groupBy: SidebarGroupBy): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(SIDEBAR_GROUP_BY_STORAGE_KEY, groupBy);
  } catch {
    /* ignore storage errors */
  }
}

/**
 * Load persisted sort direction.
 */
export function loadSidebarSortDirection(): SidebarSortDirection {
  try {
    if (typeof localStorage === "undefined") return "asc";
    const raw = localStorage.getItem(SIDEBAR_SORT_DIRECTION_STORAGE_KEY);
    if (raw === "asc" || raw === "desc") return raw;
    return "asc";
  } catch {
    return "asc";
  }
}

/**
 * Save sidebar sort direction.
 */
export function saveSidebarSortDirection(dir: SidebarSortDirection): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(SIDEBAR_SORT_DIRECTION_STORAGE_KEY, dir);
  } catch {
    /* ignore storage errors */
  }
}

/**
 * Builds a CSS selector safe for querying the sidebar game row element.
 */
export function buildSidebarAnchorSelector(gameId: string | null): string {
  if (!gameId) return "";
  try {
    return `[data-sidebar-game-id="${CSS.escape(gameId)}"]`;
  } catch {
    return `[data-sidebar-game-id="${gameId.replace(/["\\]/g, "\\$&")}"]`;
  }
}

/**
 * Computes overall statistics for the sidebar footer.
 */
export function computeSidebarStats(games: Game[], pinnedIds: Set<string>): SidebarStats {
  let installed = 0;
  let playing = 0;
  let totalPlaytimeMinutes = 0;

  for (const game of games) {
    if (game.installed) installed++;
    if (game.playStatus === "playing") playing++;
    if (game.playTime) {
      const mins = parsePlayTime(game.playTime);
      if (mins > 0) totalPlaytimeMinutes += mins;
    } else if (typeof game.steamPlaytime === "number" && game.steamPlaytime > 0) {
      totalPlaytimeMinutes += game.steamPlaytime;
    } else if (typeof game.gogPlaytime === "number" && game.gogPlaytime > 0) {
      totalPlaytimeMinutes += game.gogPlaytime;
    }
  }

  return {
    total: games.length,
    installed,
    playing,
    totalPlaytimeMinutes,
    favoriteCount: pinnedIds.size,
  };
}

/**
 * Formats minutes into human-readable hours string (e.g. "142h" or "45m").
 */
export function formatMinutesTotal(minutes: number): string {
  if (minutes <= 0) return "0h";
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

/**
 * Resolves decade label from releaseDate (e.g. "1998-03-24" -> "1990s").
 */
export function getDecadeFromReleaseDate(releaseDate?: string): string {
  if (!releaseDate) return "Unknown";
  const year = parseInt(releaseDate.substring(0, 4), 10);
  if (!Number.isFinite(year) || year < 1970 || year > 2100) return "Unknown";
  if (year >= 2020) return "2020s";
  if (year >= 2010) return "2010s";
  if (year >= 2000) return "2000s";
  if (year >= 1990) return "1990s";
  if (year >= 1980) return "1980s";
  return "Classic";
}

/**
 * Resolves clean platform name for grouping.
 */
export function resolvePlatformGroup(gameOrPlatform: Game | string | undefined): string {
  if (!gameOrPlatform) return "Local / Direct";
  if (typeof gameOrPlatform === "string") {
    const p = gameOrPlatform.toLowerCase();
    if (p.includes("steam")) return "Steam";
    if (p.includes("gog")) return "GOG";
    if (p.includes("epic")) return "Epic Games";
    if (p.includes("rockstar")) return "Rockstar";
    if (p.includes("ubisoft") || p.includes("uplay")) return "Ubisoft";
    if (p.includes("humble")) return "Humble";
    if (p.includes("emulator")) return "Emulators";
    return gameOrPlatform;
  }
  const game = gameOrPlatform;
  if (game.emulatorId) return "Emulators";
  if (game.steamAppId) return "Steam";
  if (game.gogGameId) return "GOG";
  if (game.epicCatalogItemId || game.epicNamespace) return "Epic Games";
  if (game.rockstarTitleId) return "Rockstar";
  if (game.uplayGameId || game.uplayIsConnect) return "Ubisoft";
  if (game.humbleGameId || game.humbleIsTrove) return "Humble";
  if (game.platform && game.platform !== "Local" && game.platform !== "PC") {
    return game.platform;
  }
  return "Local / Direct";
}

/**
 * Group games according to selected SidebarGroupBy mode.
 */
export function groupGames(
  games: Game[],
  groupBy: SidebarGroupBy,
  t: (key: string, values?: Record<string, string | number>) => string
): SidebarGroup[] {
  if (groupBy === "none" || games.length === 0) {
    return [];
  }

  const map = new Map<string, { title: string; badgeColor?: string; games: Game[] }>();

  if (groupBy === "platform") {
    for (const game of games) {
      const platformKey = resolvePlatformGroup(game);
      const existing = map.get(platformKey);
      if (existing) {
        existing.games.push(game);
      } else {
        map.set(platformKey, {
          title: platformKey,
          games: [game],
        });
      }
    }
  } else if (groupBy === "play_status") {
    const statuses: PlayStatus[] = ["playing", "backlog", "completed", "on_hold", "abandoned"];
    // Pre-seed in deliberate order
    for (const s of statuses) {
      const meta = PLAY_STATUS_DETAILS[s];
      map.set(s, {
        title: meta ? t(meta.labelKey) : s,
        badgeColor: meta ? meta.color : undefined,
        games: [],
      });
    }
    for (const game of games) {
      const s = game.playStatus || "backlog";
      const bucket = map.get(s);
      if (bucket) {
        bucket.games.push(game);
      } else {
        map.set(s, { title: s, games: [game] });
      }
    }
  } else if (groupBy === "installed") {
    map.set("installed", {
      title: t("filter.installed"),
      badgeColor: "var(--color-success)",
      games: [],
    });
    map.set("not_installed", {
      title: t("filter.uninstalled"),
      badgeColor: "var(--color-text-muted)",
      games: [],
    });
    for (const game of games) {
      if (game.installed) {
        map.get("installed")!.games.push(game);
      } else {
        map.get("not_installed")!.games.push(game);
      }
    }
  } else if (groupBy === "genre") {
    for (const game of games) {
      const genreList = game.genres && game.genres.length > 0 ? game.genres : ["Other"];
      for (const g of genreList) {
        const key = g.trim();
        const existing = map.get(key);
        if (existing) {
          // Avoid duplicate game in the same genre bucket
          if (!existing.games.some((x) => x.id === game.id)) {
            existing.games.push(game);
          }
        } else {
          map.set(key, { title: key, games: [game] });
        }
      }
    }
  } else if (groupBy === "letter") {
    for (const game of games) {
      const first = (game.name || "").trim().charAt(0).toUpperCase();
      const letter = /^[A-Z]$/.test(first) ? first : "#";
      const existing = map.get(letter);
      if (existing) {
        existing.games.push(game);
      } else {
        map.set(letter, { title: letter, games: [game] });
      }
    }
  } else if (groupBy === "decade") {
    for (const game of games) {
      const decade = getDecadeFromReleaseDate(game.releaseDate);
      const existing = map.get(decade);
      if (existing) {
        existing.games.push(game);
      } else {
        map.set(decade, { title: decade, games: [game] });
      }
    }
  }

  // Convert to array and filter out empty buckets
  const result: SidebarGroup[] = [];
  for (const [key, val] of map.entries()) {
    if (val.games.length > 0) {
      result.push({
        key,
        title: val.title,
        count: val.games.length,
        badgeColor: val.badgeColor,
        games: val.games,
      });
    }
  }

  // Order buckets logically
  if (groupBy === "letter") {
    result.sort((a, b) => {
      if (a.key === "#") return 1;
      if (b.key === "#") return -1;
      return a.key.localeCompare(b.key);
    });
  } else if (groupBy === "platform" || groupBy === "genre") {
    result.sort((a, b) => a.title.localeCompare(b.title));
  } else if (groupBy === "decade") {
    const decadeOrder: Record<string, number> = {
      "2020s": 1,
      "2010s": 2,
      "2000s": 3,
      "1990s": 4,
      "1980s": 5,
      "Classic": 6,
      "Unknown": 7,
    };
    result.sort((a, b) => (decadeOrder[a.key] ?? 99) - (decadeOrder[b.key] ?? 99));
  }

  return result;
}
