/**
 * `shelves` domain repository (mirrors `src-tauri/src/db/shelves.rs`).
 *
 * Stores shelf definitions plus the per-game completion timestamps. Membership
 * is recomputed on the frontend from `rules`, so only the definition is here.
 */
import { openDb, prepare } from "./sqlite";

/** Upper bound on stored shelves (kept in step with the Rust constant). */
export const MAX_SHELVES = 30;

export interface Shelf {
  id: string;
  name: string;
  icon: string;
  color: string;
  rules: Record<string, unknown>;
  sort: string;
  pinned: boolean;
  position: number;
  createdAt: number;
  updatedAt: number;
}

const SELECT_ALL =
  "SELECT id, name, icon, color, rules_json, sort, pinned, position, created_at, updated_at FROM shelves";

interface ShelfRow {
  id?: string;
  name?: string;
  icon?: string;
  color?: string;
  rules_json?: string;
  sort?: string;
  pinned?: number;
  position?: number;
  created_at?: number;
  updated_at?: number;
}

function decodeShelf(row: ShelfRow): Shelf {
  let rules: Record<string, unknown> = {};
  if (typeof row.rules_json === "string") {
    try {
      const parsed = JSON.parse(row.rules_json) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        rules = parsed as Record<string, unknown>;
      }
    } catch {
      rules = {};
    }
  }
  return {
    id: row.id ?? "",
    name: row.name ?? "",
    icon: row.icon ?? "layers",
    color: row.color ?? "accent",
    rules,
    sort: row.sort ?? "alphabetical",
    pinned: (row.pinned ?? 0) !== 0,
    position: row.position ?? 0,
    createdAt: Math.max(0, row.created_at ?? 0),
    updatedAt: Math.max(0, row.updated_at ?? 0),
  };
}

/** Every shelf in the user's drag order, then age. */
export function listShelves(): Shelf[] {
  const rows = prepare(
    "shelves",
    `${SELECT_ALL} ORDER BY position ASC, created_at ASC, rowid ASC`,
  ).all() as ShelfRow[];
  return rows.map(decodeShelf);
}

export function countShelves(): number {
  const row = prepare("shelves", "SELECT COUNT(*) AS n FROM shelves").get() as
    | { n?: number | bigint }
    | undefined;
  return Number(row?.n ?? 0);
}

/** Append position for a new shelf (`COALESCE(MAX(position), -1) + 1`). */
export function nextShelfPosition(): number {
  const row = prepare(
    "shelves",
    "SELECT COALESCE(MAX(position), -1) AS p FROM shelves",
  ).get() as { p?: number | bigint } | undefined;
  return Number(row?.p ?? -1) + 1;
}

/**
 * Insert or update one shelf. `createdAt` is preserved on an edit and
 * `updatedAt` is always rewritten (the command layer normalizes the rest).
 */
export function upsertShelf(shelf: Shelf): Shelf {
  const stored = prepare(
    "shelves",
    "SELECT created_at FROM shelves WHERE id = ?",
  ).get(shelf.id) as { created_at?: number } | undefined;
  const createdAt = stored?.created_at ? Math.max(0, stored.created_at) : shelf.createdAt;

  // Same defaults the Rust DAO applies, so a caller that skips the command
  // layer's normalization still stores a usable shelf.
  const normalized: Shelf = {
    ...shelf,
    icon: shelf.icon.trim() || "layers",
    color: shelf.color.trim() || "accent",
    sort: shelf.sort.trim() || "alphabetical",
    createdAt,
  };

  prepare(
    "shelves",
    `INSERT INTO shelves(id, name, icon, color, rules_json, sort, pinned, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
         name       = excluded.name,
         icon       = excluded.icon,
         color      = excluded.color,
         rules_json = excluded.rules_json,
         sort       = excluded.sort,
         pinned     = excluded.pinned,
         position   = excluded.position,
         updated_at = excluded.updated_at`,
  ).run(
    normalized.id,
    normalized.name,
    normalized.icon,
    normalized.color,
    JSON.stringify(normalized.rules),
    normalized.sort,
    normalized.pinned ? 1 : 0,
    normalized.position,
    normalized.createdAt,
    normalized.updatedAt,
  );

  return normalized;
}

export function deleteShelfRow(id: string): number {
  return prepare("shelves", "DELETE FROM shelves WHERE id = ?").run(id).changes;
}

/** Persist a new drag order: each id's position becomes its index. */
export function reorderShelves(ids: string[]): void {
  if (ids.length === 0) return;
  const db = openDb("shelves");
  const run = db.transaction(() => {
    const update = prepare("shelves", "UPDATE shelves SET position = ? WHERE id = ?");
    ids.forEach((id, index) => {
      update.run(index, id);
    });
  });
  run();
}

/** Every game id → completion timestamp (unix ms), as `[id, ts]` tuples. */
export function listCompletions(): [string, number][] {
  const rows = prepare(
    "shelves",
    "SELECT game_id, completed_at FROM game_completions ORDER BY rowid ASC",
  ).all() as { game_id?: string; completed_at?: number }[];
  return rows.map((row) => [
    typeof row.game_id === "string" ? row.game_id : "",
    Math.max(0, row.completed_at ?? 0),
  ]);
}

export function setCompletion(gameId: string, completedAt: number): void {
  prepare(
    "shelves",
    `INSERT INTO game_completions(game_id, completed_at) VALUES (?, ?)
     ON CONFLICT(game_id) DO UPDATE SET completed_at = excluded.completed_at`,
  ).run(gameId, completedAt);
}

export function clearCompletion(gameId: string): void {
  prepare("shelves", "DELETE FROM game_completions WHERE game_id = ?").run(gameId);
}

/** Import helper: keep an already-stored shelf/completion untouched. */
export function insertMissingShelves(shelves: Shelf[]): number {
  const insert = prepare(
    "shelves",
    `INSERT OR IGNORE INTO shelves(id, name, icon, color, rules_json, sort, pinned, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  let written = 0;
  for (const shelf of shelves) {
    written += insert.run(
      shelf.id,
      shelf.name,
      shelf.icon,
      shelf.color,
      JSON.stringify(shelf.rules),
      shelf.sort,
      shelf.pinned ? 1 : 0,
      shelf.position,
      shelf.createdAt,
      shelf.updatedAt,
    ).changes;
  }
  return written;
}

export function insertMissingCompletions(entries: [string, number][]): number {
  const insert = prepare(
    "shelves",
    "INSERT OR IGNORE INTO game_completions(game_id, completed_at) VALUES (?, ?)",
  );
  let written = 0;
  for (const [gameId, completedAt] of entries) {
    written += insert.run(gameId, completedAt).changes;
  }
  return written;
}
