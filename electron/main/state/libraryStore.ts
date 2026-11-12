/**
 * Game library store — SQLite backed.
 *
 * The Rust build kept the library in SQLite (`src-tauri/src/db/games.rs`); this
 * pass restores that and drops the intermediate `library.json` document. The
 * exported API is unchanged so every caller (other workstreams included) keeps
 * working:
 *
 *  • `load_games_summary` returns every presentational/launch field but omits
 *    the heavy IGDB/media arrays (see `HEAVY_GAME_FIELDS`), exactly like the
 *    Rust `load_games_summary` projection.
 *  • `load_games` / `get_game_detail` return the full record.
 *  • `save_games` replaces the library, `save_games_subset`/`save_game` merge
 *    by id and leave every other row alone, and `patch_game` only touches the
 *    keys present in the patch.
 *
 * Storage: `<userData>/db/games.db` (`electron/main/state/db/games.ts`), one row
 * per game, with the Rust column set plus an `extra_json` passthrough so every
 * field of `src/types/game.ts` still round-trips verbatim.
 *
 * Writes are immediate and durable (WAL, `synchronous = NORMAL`); there is no
 * debounce any more, so `flushLibrarySync` only has to checkpoint and close the
 * connections on quit. That is still registered on `before-quit` (and the
 * SQLite layer registers its own hook as a backstop).
 */
import { app } from "electron";
import path from "node:path";
import type { Game } from "../../../src/types/game";
import {
  closeAllDatabases,
  deleteGameRows,
  ensureStorage,
  getGameRow,
  listGameRows,
  listGameSummaries,
  patchGameRow,
  replaceLibraryRows,
  setGameLastPlayed,
  toSummaryGame,
  upsertGameRows,
} from "./db";
import { HEAVY_GAME_FIELDS } from "./db/gameRows";
import { DB_FILES } from "./db/schema";

export const LIBRARY_VERSION = 1;

/** Large arrays fetched on demand by `get_game_detail` (mirrors Rust). */
export { HEAVY_GAME_FIELDS };

/** Fields a `patch_game` payload must never write (mirrors Rust). */
const PATCH_PROTECTED_FIELDS = new Set<string>([
  ...HEAVY_GAME_FIELDS,
  "compatibility",
  "id",
]);

/**
 * Kept for API compatibility: the shape the JSON document had. Nothing writes
 * it any more, but other workstreams still import the type.
 */
export interface LibraryDocument {
  version: number;
  games: Game[];
  updatedAt: string;
}

export interface SaveStats {
  written: number;
  deleted: number;
}

function libraryFile(): string {
  return path.join(app.getPath("userData"), "db", DB_FILES.games);
}

/** Absolute path of the backing database (was the JSON document path). */
export function getLibraryPath(): string {
  return libraryFile();
}

/**
 * Write everything out and close the database connections. Called from
 * `before-quit` so the WAL is checkpointed before the process exits.
 */
export function flushLibrarySync(): void {
  closeAllDatabases();
}

/** Ensure the database exists and the one-time import has run. */
export function ensureLibrary(): void {
  ensureStorage("games");
}

export function listGames(): Game[] {
  ensureStorage("games");
  return listGameRows();
}

/** Shallow copy of a game with the heavy detail arrays removed. */
export function toSummary(game: Game): Game {
  return toSummaryGame(game);
}

export function listGamesSummary(): Game[] {
  ensureStorage("games");
  return listGameSummaries();
}

export function getGame(id: string): Game | null {
  ensureStorage("games");
  return getGameRow(id);
}

function assertGames(rows: unknown): Game[] {
  if (!Array.isArray(rows)) {
    throw new Error("expected a `games` array");
  }
  for (const row of rows) {
    if (!row || typeof row !== "object") {
      throw new Error("every game row must be an object");
    }
    const id = (row as Game).id;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("every game row needs a non-empty `id`");
    }
  }
  return rows as Game[];
}

/** Resolve duplicate ids the way the SQLite `ON CONFLICT` upsert did: last
 *  payload wins, first position is kept. */
function dedupeById(games: Game[]): Game[] {
  const byId = new Map<string, Game>();
  for (const game of games) byId.set(game.id, game);
  return [...byId.values()];
}

/** Replace the whole library (`save_games`). */
export function replaceLibrary(rows: unknown): SaveStats {
  const incoming = dedupeById(assertGames(rows));
  ensureStorage("games");
  return replaceLibraryRows(incoming);
}

/**
 * Merge by id (`save_games_subset` / `save_game`).
 *
 * Provided rows are shallow-merged over their stored record so a summary row
 * that happens to travel through this path cannot erase heavy detail columns
 * stored earlier. Rows absent from the payload are untouched.
 */
export function upsertGames(rows: unknown): SaveStats {
  const incoming = assertGames(rows);
  ensureStorage("games");
  return { written: upsertGameRows(incoming), deleted: 0 };
}

/** Apply a sparse patch to one row; absent keys keep their stored value. */
export function patchGameRecord(id: string, patch: unknown): void {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return;
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (PATCH_PROTECTED_FIELDS.has(key) || value === undefined) continue;
    filtered[key] = value;
  }
  if (Object.keys(filtered).length === 0) return;
  ensureStorage("games");
  patchGameRow(id, filtered);
}

export function deleteGames(ids: string[]): number {
  if (!Array.isArray(ids) || ids.length === 0) return 0;
  ensureStorage("games");
  return deleteGameRows(ids.map(String));
}

/** Targeted `lastPlayed` stamp used at session end. */
export function setLastPlayed(id: string, lastPlayedMs: number): boolean {
  ensureStorage("games");
  return setGameLastPlayed(id, lastPlayedMs);
}
