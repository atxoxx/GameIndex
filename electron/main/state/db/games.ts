/**
 * `games` domain repository.
 *
 * Mirrors `src-tauri/src/db/games.rs` for the operations the Electron command
 * layer exposes:
 *  • `listGames` / `listGamesSummary` read every row in stored order (the JSON
 *    document was an ordered array, hence the `position` column);
 *  • `replaceLibrary` reconciles the table against a full payload in one
 *    transaction and deletes ids that disappeared;
 *  • `upsertGames` merges by id, leaving rows absent from the payload alone;
 *  • `patchGame` writes only the keys present in the patch;
 *  • `setLastPlayed` is the targeted single-column write the session hook uses.
 *
 * Bulk writes use one transaction and cached prepared statements: replacing
 * 5000 rows is a single commit, not 5000 autocommits.
 */
import type { Game } from "../../../../src/types/game";
import {
  GAME_COLUMN_NAMES,
  GAME_COLUMNS,
  GAME_SELECT_COLUMNS,
  GAME_SUMMARY_SELECT_COLUMNS,
  decodeGame,
  encodeGame,
  extraJsonOf,
  mergeGameRecords,
  toSummaryGame,
} from "./gameRows";
import { openDb, prepare, type SqlRow } from "./sqlite";

const WRITE_COLUMNS = ["position", ...GAME_COLUMN_NAMES, "extra_json"];
const WRITE_PLACEHOLDERS = WRITE_COLUMNS.map(() => "?").join(", ");
const WRITE_UPDATES = WRITE_COLUMNS.filter((column) => column !== "id")
  .map((column) => `${column} = excluded.${column}`)
  .join(", ");

const UPSERT_SQL = `INSERT INTO games (${WRITE_COLUMNS.join(", ")})
  VALUES (${WRITE_PLACEHOLDERS})
  ON CONFLICT(id) DO UPDATE SET ${WRITE_UPDATES}`;

const SELECT_ALL = `SELECT ${GAME_SELECT_COLUMNS}, extra_json, position FROM games`;
const SELECT_SUMMARY = `SELECT ${GAME_SUMMARY_SELECT_COLUMNS}, extra_json, position FROM games`;
const SELECT_ONE = `${SELECT_ALL} WHERE id = ?`;

function bindRow(game: Game, position: number): unknown[] {
  const encoded = encodeGame(game);
  const params: unknown[] = [position];
  for (const column of GAME_COLUMNS) {
    const value = encoded.values[column.column];
    params.push(value === undefined ? null : value);
  }
  params.push(extraJsonOf(encoded));
  return params;
}

function positionOf(row: SqlRow): number {
  const raw = row.position;
  return typeof raw === "number" ? raw : Number(raw ?? 0);
}

export function countGames(): number {
  const row = prepare("games", "SELECT COUNT(*) AS n FROM games").get() as
    | { n?: number | bigint }
    | undefined;
  return Number(row?.n ?? 0);
}

export function listGameRows(): Game[] {
  const rows = prepare("games", `${SELECT_ALL} ORDER BY position ASC, rowid ASC`).all() as SqlRow[];
  return rows.map((row) => decodeGame(row));
}

export function listGameSummaries(): Game[] {
  const rows = prepare(
    "games",
    `${SELECT_SUMMARY} ORDER BY position ASC, rowid ASC`,
  ).all() as SqlRow[];
  return rows.map((row) => toSummaryGame(decodeGame(row, true)));
}

export function getGameRow(id: string): Game | null {
  const row = prepare("games", SELECT_ONE).get(id) as SqlRow | undefined;
  return row ? decodeGame(row) : null;
}

/** Every stored id, for the replace/import reconciliation. */
export function listGameIds(): Set<string> {
  const rows = prepare("games", "SELECT id FROM games").all() as { id?: string }[];
  const ids = new Set<string>();
  for (const row of rows) if (typeof row.id === "string") ids.add(row.id);
  return ids;
}

function maxPosition(): number {
  const row = prepare(
    "games",
    "SELECT COALESCE(MAX(position), -1) AS p FROM games",
  ).get() as { p?: number | bigint } | undefined;
  return Number(row?.p ?? -1);
}

/** Replace the whole library (`save_games`). Returns `{ written, deleted }`. */
export function replaceLibraryRows(games: Game[]): { written: number; deleted: number } {
  const db = openDb("games");
  const incomingIds = new Set(games.map((game) => game.id));

  const run = db.transaction(() => {
    let deleted = 0;
    const deleteStmt = prepare("games", "DELETE FROM games WHERE id = ?");
    const existing = prepare("games", "SELECT id FROM games").all() as { id?: string }[];
    for (const row of existing) {
      const id = typeof row.id === "string" ? row.id : "";
      if (id && !incomingIds.has(id)) {
        deleteStmt.run(id);
        deleted += 1;
      }
    }

    const upsert = prepare("games", UPSERT_SQL);
    games.forEach((game, index) => {
      upsert.run(...bindRow(game, index));
    });
    return deleted;
  });

  const deleted = run();
  return { written: games.length, deleted };
}

/**
 * Merge-by-id write (`save_games_subset` / `save_game`). Provided rows are
 * shallow-merged over the stored record; absent rows are untouched. Returns the
 * number of payload rows written.
 */
export function upsertGameRows(games: Game[]): number {
  const db = openDb("games");
  const run = db.transaction(() => {
    const read = prepare("games", SELECT_ONE);
    const upsert = prepare("games", UPSERT_SQL);
    let next = maxPosition() + 1;

    for (const incoming of games) {
      const stored = read.get(incoming.id) as SqlRow | undefined;
      if (stored) {
        const merged = mergeGameRecords(decodeGame(stored), incoming);
        upsert.run(...bindRow(merged, positionOf(stored)));
      } else {
        upsert.run(...bindRow(incoming, next));
        next += 1;
      }
    }
    return games.length;
  });
  return run();
}

/**
 * Append rows whose id is not stored yet, preserving payload order. Used by the
 * one-time import so an existing (newer) row is never overwritten.
 */
export function insertMissingGames(games: Game[]): number {
  const db = openDb("games");
  const run = db.transaction(() => {
    const read = prepare("games", "SELECT id FROM games WHERE id = ?");
    const upsert = prepare("games", UPSERT_SQL);
    let next = maxPosition() + 1;
    let inserted = 0;

    for (const game of games) {
      if (read.get(game.id)) continue;
      upsert.run(...bindRow(game, next));
      next += 1;
      inserted += 1;
    }
    return inserted;
  });
  return run();
}

/** Sparse merge for one row. Absent keys keep their stored value. */
export function patchGameRow(id: string, patch: Record<string, unknown>): boolean {
  const db = openDb("games");
  const run = db.transaction(() => {
    const stored = prepare("games", SELECT_ONE).get(id) as SqlRow | undefined;
    if (!stored) return false;
    const next = { ...decodeGame(stored) } as Record<string, unknown>;
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      next[key] = value;
    }
    prepare("games", UPSERT_SQL).run(...bindRow(next as unknown as Game, positionOf(stored)));
    return true;
  });
  return run();
}

export function deleteGameRows(ids: string[]): number {
  if (ids.length === 0) return 0;
  const db = openDb("games");
  const run = db.transaction(() => {
    const remove = prepare("games", "DELETE FROM games WHERE id = ?");
    let removed = 0;
    for (const id of ids) removed += remove.run(id).changes;
    return removed;
  });
  return run();
}

/** Targeted `last_played` write (hot path, one column, no row rewrite). */
export function setGameLastPlayed(id: string, lastPlayedMs: number): boolean {
  const result = prepare("games", "UPDATE games SET last_played = ? WHERE id = ?").run(
    lastPlayedMs,
    id,
  );
  return result.changes > 0;
}
