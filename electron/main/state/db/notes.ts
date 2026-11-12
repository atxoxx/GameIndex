/**
 * `game_notes` domain repository (mirrors `src-tauri/src/db/game_notes.rs`).
 *
 * Markdown content + a compact JSON tag array + a pin flag. Ordering is
 * pinned-first, then most-recently-updated, which is the order the Notes tab
 * renders its sidebar in.
 */
import { prepare } from "./sqlite";

export interface GameNote {
  id: string;
  gameId: string;
  title: string;
  content: string;
  tags: string[];
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

const SELECT_ALL =
  "SELECT id, game_id, title, content, tags_json, pinned, created_at, updated_at FROM game_notes";

interface NoteRow {
  id?: string;
  game_id?: string;
  title?: string;
  content?: string;
  tags_json?: string;
  pinned?: number;
  created_at?: number;
  updated_at?: number;
}

function decodeNote(row: NoteRow): GameNote {
  let tags: string[] = [];
  if (typeof row.tags_json === "string") {
    try {
      const parsed = JSON.parse(row.tags_json) as unknown;
      if (Array.isArray(parsed)) tags = parsed.filter((tag): tag is string => typeof tag === "string");
    } catch {
      tags = [];
    }
  }
  return {
    id: row.id ?? "",
    gameId: row.game_id ?? "",
    title: row.title ?? "",
    content: row.content ?? "",
    tags,
    pinned: (row.pinned ?? 0) !== 0,
    createdAt: Math.max(0, row.created_at ?? 0),
    updatedAt: Math.max(0, row.updated_at ?? 0),
  };
}

export function listNotesForGame(gameId: string): GameNote[] {
  const rows = prepare(
    "game_notes",
    `${SELECT_ALL} WHERE game_id = ? ORDER BY pinned DESC, updated_at DESC, rowid DESC`,
  ).all(gameId) as NoteRow[];
  return rows.map(decodeNote);
}

/** Case-insensitive ASCII search over title, body and tags (Rust `search`). */
export function searchNotes(query: string, limit: number): GameNote[] {
  const trimmed = query.trim();
  const numeric = Math.trunc(limit);
  const capped = Math.min(200, Math.max(1, Number.isFinite(numeric) ? numeric : 80));
  const pattern = `%${trimmed.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
  const rows = prepare(
    "game_notes",
    `${SELECT_ALL}
     WHERE ? = ''
        OR title LIKE ? ESCAPE '\\'
        OR content LIKE ? ESCAPE '\\'
        OR tags_json LIKE ? ESCAPE '\\'
     ORDER BY pinned DESC, updated_at DESC, rowid DESC
     LIMIT ?`,
  ).all(trimmed, pattern, pattern, pattern, capped) as NoteRow[];
  return rows.map(decodeNote);
}

/**
 * Insert or update one note. `createdAt` is preserved on an edit (the stored
 * value wins over the payload), `updatedAt` is always rewritten.
 */
export function upsertNote(note: GameNote): GameNote {
  const stored = prepare(
    "game_notes",
    "SELECT created_at FROM game_notes WHERE id = ?",
  ).get(note.id) as { created_at?: number } | undefined;

  const createdAt = stored?.created_at
    ? Math.max(0, stored.created_at)
    : note.createdAt;

  prepare(
    "game_notes",
    `INSERT INTO game_notes(id, game_id, title, content, tags_json, pinned, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
         game_id    = excluded.game_id,
         title      = excluded.title,
         content    = excluded.content,
         tags_json  = excluded.tags_json,
         pinned     = excluded.pinned,
         updated_at = excluded.updated_at`,
  ).run(
    note.id,
    note.gameId,
    note.title,
    note.content,
    JSON.stringify(note.tags),
    note.pinned ? 1 : 0,
    createdAt,
    note.updatedAt,
  );

  return { ...note, createdAt };
}

export function deleteNoteRow(id: string): number {
  return prepare("game_notes", "DELETE FROM game_notes WHERE id = ?").run(id).changes;
}

export function deleteNoteRowsForGame(gameId: string): number {
  if (!gameId) return 0;
  return prepare("game_notes", "DELETE FROM game_notes WHERE game_id = ?").run(gameId).changes;
}

/** Import helper: keep an already-stored note untouched. */
export function insertMissingNotes(notes: GameNote[]): number {
  const insert = prepare(
    "game_notes",
    `INSERT OR IGNORE INTO game_notes(id, game_id, title, content, tags_json, pinned, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  let written = 0;
  for (const note of notes) {
    written += insert.run(
      note.id,
      note.gameId,
      note.title,
      note.content,
      JSON.stringify(note.tags),
      note.pinned ? 1 : 0,
      note.createdAt,
      note.updatedAt,
    ).changes;
  }
  return written;
}
