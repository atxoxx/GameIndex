/**
 * Pure `Game` ↔ SQLite row mapping.
 *
 * Kept free of `electron` / `better-sqlite3` imports so the matrix can be
 * unit-tested directly (it is the one place where a mis-ordered column would
 * silently corrupt the library).
 *
 * Every field of `src/types/game.ts` round-trips:
 *  • fields the Rust schema has a column for use that column;
 *  • fields it does not know (`humbleGameId`, `uplayGameId`, `untracked`, …)
 *    are kept verbatim in `extra_json`;
 *  • a value whose type does not match its column (including an explicit
 *    `null`) also goes to `extra_json`, so `null` and "absent" stay distinct
 *    exactly like the JSON document did.
 */
import type { Game } from "../../../../src/types/game";

export type ColumnKind = "text" | "int" | "real" | "bool" | "json";

export interface GameColumn {
  /** `Game` property name (the camelCase JSON key). */
  field: string;
  /** SQLite column name. */
  column: string;
  kind: ColumnKind;
  /** Value written when the field is absent (only for NOT NULL columns). */
  fallback?: string | number;
}

/**
 * Large arrays fetched on demand by `get_game_detail`. Must stay in sync with
 * the Rust `GAMES_HEAVY_JSON_COLUMNS` and with `toSummary`.
 */
export const HEAVY_GAME_FIELDS = [
  "screenshots",
  "videos",
  "similarGames",
  "releases",
  "igdbReviews",
  "languageSupports",
  "steamAchievements",
] as const;

export const HEAVY_GAME_FIELD_SET: ReadonlySet<string> = new Set(HEAVY_GAME_FIELDS);

/** Every column, in Rust `GAMES_SELECT_SQL` order. `id` first. */
export const GAME_COLUMNS: readonly GameColumn[] = [
  { field: "id", column: "id", kind: "text", fallback: "" },
  { field: "name", column: "name", kind: "text", fallback: "" },
  { field: "path", column: "path", kind: "text", fallback: "" },
  { field: "platform", column: "platform", kind: "text", fallback: "" },
  { field: "installed", column: "installed", kind: "bool", fallback: 0 },
  { field: "playTime", column: "play_time", kind: "text", fallback: "0h" },
  { field: "addedAt", column: "added_at", kind: "int", fallback: 0 },
  { field: "coverArtUrl", column: "cover_art_url", kind: "text" },
  { field: "notes", column: "notes", kind: "text" },
  { field: "sizeBytes", column: "size_bytes", kind: "int" },
  { field: "sizeDetectedAt", column: "size_detected_at", kind: "text" },
  { field: "sizeRootPath", column: "size_root_path", kind: "text" },
  { field: "iconUrl", column: "icon_url", kind: "text" },
  { field: "bannerUrl", column: "banner_url", kind: "text" },
  { field: "logoUrl", column: "logo_url", kind: "text" },
  { field: "description", column: "description", kind: "text" },
  { field: "developer", column: "developer", kind: "text" },
  { field: "publisher", column: "publisher", kind: "text" },
  { field: "releaseDate", column: "release_date", kind: "text" },
  { field: "metadataSource", column: "metadata_source", kind: "text" },
  { field: "metadataUrl", column: "metadata_url", kind: "text" },
  { field: "storyline", column: "storyline", kind: "text" },
  { field: "igdbRating", column: "igdb_rating", kind: "real" },
  { field: "criticRating", column: "critic_rating", kind: "real" },
  { field: "steamAppId", column: "steam_app_id", kind: "int" },
  { field: "steamPlaytime", column: "steam_playtime", kind: "int" },
  { field: "storeSource", column: "store_source", kind: "text" },
  { field: "epicNamespace", column: "epic_namespace", kind: "text" },
  { field: "epicCatalogItemId", column: "epic_catalog_item_id", kind: "text" },
  { field: "launchArguments", column: "launch_arguments", kind: "text" },
  { field: "runAsAdmin", column: "run_as_admin", kind: "bool" },
  { field: "lastPlayed", column: "last_played", kind: "int" },
  { field: "playStatus", column: "play_status", kind: "text" },
  { field: "genres", column: "genres_json", kind: "json" },
  { field: "themes", column: "themes_json", kind: "json" },
  { field: "gameModes", column: "game_modes_json", kind: "json" },
  { field: "playerPerspectives", column: "player_perspectives_json", kind: "json" },
  { field: "screenshots", column: "screenshots_json", kind: "json" },
  { field: "videos", column: "videos_json", kind: "json" },
  { field: "websites", column: "websites_json", kind: "json" },
  { field: "timeToBeat", column: "time_to_beat_json", kind: "json" },
  { field: "similarGames", column: "similar_games_json", kind: "json" },
  { field: "releases", column: "releases_json", kind: "json" },
  { field: "igdbReviews", column: "igdb_reviews_json", kind: "json" },
  { field: "alternativeNames", column: "alternative_names_json", kind: "json" },
  { field: "steamAchievements", column: "steam_achievements_json", kind: "json" },
  { field: "languageSupports", column: "language_supports_json", kind: "json" },
  { field: "collection", column: "collection", kind: "text" },
  { field: "franchise", column: "franchise", kind: "text" },
  { field: "gameCategory", column: "game_category", kind: "text" },
  { field: "releaseStatus", column: "release_status", kind: "text" },
  { field: "gogGameId", column: "gog_game_id", kind: "text" },
  { field: "gogPlaytime", column: "gog_playtime", kind: "int" },
  { field: "preLaunchScript", column: "pre_launch_script", kind: "text" },
  { field: "preLaunchAdmin", column: "pre_launch_admin", kind: "bool" },
  { field: "postExitScript", column: "post_exit_script", kind: "text" },
  { field: "postExitAdmin", column: "post_exit_admin", kind: "bool" },
  { field: "companionApps", column: "companion_apps_json", kind: "json" },
  { field: "emulatorId", column: "emulator_id", kind: "text" },
  { field: "romPath", column: "rom_path", kind: "text" },
  { field: "modsFolder", column: "mods_folder", kind: "text" },
  { field: "modsSizeBytes", column: "mods_size_bytes", kind: "int" },
  { field: "modsDetectedAt", column: "mods_detected_at", kind: "text" },
  { field: "coverSourceUrl", column: "cover_source_url", kind: "text" },
  {
    field: "showSteamLaunchSelection",
    column: "show_steam_launch_selection",
    kind: "bool",
  },
  { field: "igdbId", column: "igdb_id", kind: "int" },
  { field: "romHash", column: "rom_hash", kind: "text" },
  { field: "romRegion", column: "rom_region", kind: "text" },
  { field: "romLanguage", column: "rom_language", kind: "text" },
  { field: "romGroup", column: "rom_group", kind: "text" },
  { field: "romDisc", column: "rom_disc", kind: "int" },
  { field: "romArchived", column: "rom_archived", kind: "bool" },
  { field: "favorite", column: "favorite", kind: "bool" },
  { field: "compatNotes", column: "compat_notes", kind: "text" },
  { field: "romProfile", column: "rom_profile", kind: "json" },
  { field: "version", column: "version", kind: "text" },
  { field: "collectionId", column: "collection_id", kind: "int" },
  { field: "displayName", column: "display_name", kind: "text" },
  { field: "logoSourceUrl", column: "logo_source_url", kind: "text" },
  { field: "isVr", column: "is_vr", kind: "bool" },
  { field: "extraExecutables", column: "extra_executables_json", kind: "json" },
  { field: "purchaseCost", column: "purchase_cost", kind: "real" },
  { field: "purchaseCurrency", column: "purchase_currency", kind: "text" },
  { field: "mo2LaunchEnabled", column: "mo2_launch_enabled", kind: "bool" },
  { field: "mo2Profile", column: "mo2_profile", kind: "text" },
  { field: "mo2Executable", column: "mo2_executable", kind: "text" },
  { field: "mo2InstancePath", column: "mo2_instance_path", kind: "text" },
  // Electron-only column: the Rust build isolated this into compatibility.db.
  { field: "compatibility", column: "compatibility_json", kind: "json" },
];

/** Column names used for `Game` values (excludes the internal `position`). */
export const GAME_COLUMN_NAMES: readonly string[] = GAME_COLUMNS.map(
  (column) => column.column,
);

const COLUMN_BY_FIELD = new Map(GAME_COLUMNS.map((column) => [column.field, column]));

const HEAVY_COLUMN_NAMES: ReadonlySet<string> = new Set(
  GAME_COLUMNS.filter((column) => HEAVY_GAME_FIELD_SET.has(column.field)).map(
    (column) => column.column,
  ),
);

/** `SELECT` list for a full row. */
export const GAME_SELECT_COLUMNS = GAME_COLUMN_NAMES.join(", ");

/**
 * `SELECT` list for the summary projection: heavy blobs are selected as NULL so
 * SQLite never copies them out of the row pages (mirrors
 * `games_summary_select_sql` in the Rust DAO).
 */
export const GAME_SUMMARY_SELECT_COLUMNS = GAME_COLUMNS.map((column) =>
  HEAVY_COLUMN_NAMES.has(column.column) ? `NULL AS ${column.column}` : column.column,
).join(", ");

const SKIP = Symbol("skip");

function encodeValue(kind: ColumnKind, value: unknown): unknown | typeof SKIP {
  if (value === null || value === undefined) return SKIP;
  switch (kind) {
    case "text":
      return typeof value === "string" ? value : SKIP;
    case "int":
      return typeof value === "number" && Number.isInteger(value) && Number.isFinite(value)
        ? value
        : SKIP;
    case "real":
      return typeof value === "number" && Number.isFinite(value) ? value : SKIP;
    case "bool":
      return typeof value === "boolean" ? (value ? 1 : 0) : SKIP;
    case "json":
      try {
        return JSON.stringify(value);
      } catch {
        return SKIP;
      }
  }
}

function decodeValue(kind: ColumnKind, raw: unknown): unknown | typeof SKIP {
  switch (kind) {
    case "text":
      return typeof raw === "string" ? raw : String(raw);
    case "int":
    case "real":
      return typeof raw === "number" ? raw : Number(raw);
    case "bool":
      return raw === 1 || raw === 1n || raw === true || raw === "1";
    case "json": {
      if (typeof raw !== "string") return raw;
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        // A corrupt blob must not take the whole library down; the Rust DAO
        // treats it as `None`, so the field is simply absent.
        return SKIP;
      }
    }
  }
}

export interface EncodedGameRow {
  /** Column name → bound value (`null` for absent). */
  values: Record<string, unknown>;
  /** Fields the column set cannot represent; serialized to `extra_json`. */
  extra: Record<string, unknown>;
}

/**
 * Split one `Game` into column values plus the `extra_json` passthrough.
 * `undefined` fields become NULL and read back absent; `null` fields become
 * NULL in the column *and* are recorded in `extra` so they read back as `null`.
 */
export function encodeGame(game: Game): EncodedGameRow {
  const values: Record<string, unknown> = {};
  const extra: Record<string, unknown> = {};
  const source = game as unknown as Record<string, unknown>;

  for (const key of Object.keys(source)) {
    if (!COLUMN_BY_FIELD.has(key)) extra[key] = source[key];
  }

  for (const column of GAME_COLUMNS) {
    const raw = source[column.field];
    if (raw === undefined) {
      values[column.column] = column.fallback ?? null;
      continue;
    }
    const encoded = encodeValue(column.kind, raw);
    if (encoded === SKIP) {
      values[column.column] = column.fallback ?? null;
      if (column.fallback === undefined) extra[column.field] = raw;
      continue;
    }
    values[column.column] = encoded;
  }

  return { values, extra };
}

/** `extra_json` body for an encoded row (`null` when nothing is left over). */
export function extraJsonOf(encoded: EncodedGameRow): string | null {
  return Object.keys(encoded.extra).length > 0 ? JSON.stringify(encoded.extra) : null;
}

function parseExtra(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* corrupt passthrough: drop it rather than break the read */
  }
  return null;
}

/**
 * Build a `Game` from a row keyed by column name. Missing columns (older /
 * legacy tables) are simply absent, which is exactly what the importer relies
 * on when it maps a partial Rust row.
 */
export function decodeGame(row: Record<string, unknown>, summary = false): Game {
  const game: Record<string, unknown> = {};

  for (const column of GAME_COLUMNS) {
    if (summary && HEAVY_GAME_FIELD_SET.has(column.field)) continue;
    const raw = row[column.column];
    if (raw === null || raw === undefined) continue;
    const decoded = decodeValue(column.kind, raw);
    if (decoded === SKIP) continue;
    game[column.field] = decoded;
  }

  const extra = parseExtra(row.extra_json);
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (summary && HEAVY_GAME_FIELD_SET.has(key)) continue;
      game[key] = value;
    }
  }

  return game as unknown as Game;
}

/** Shallow copy of a game with the heavy detail arrays removed. */
export function toSummaryGame(game: Game): Game {
  const copy: Record<string, unknown> = { ...game };
  for (const key of HEAVY_GAME_FIELDS) delete copy[key];
  return copy as unknown as Game;
}

/**
 * Merge a payload row over its stored record. Keys explicitly set to
 * `undefined` are treated as absent: the renderer's `stripHeavyGameFields`
 * writes `screenshots: undefined`, and Tauri's JSON IPC dropped those keys
 * before Rust saw them. Skipping them keeps the stored heavy arrays instead of
 * erasing them.
 */
export function mergeGameRecords(stored: Game, incoming: Game): Game {
  const merged: Record<string, unknown> = { ...stored };
  for (const [key, value] of Object.entries(incoming as unknown as Record<string, unknown>)) {
    if (value !== undefined) merged[key] = value;
  }
  return merged as unknown as Game;
}
