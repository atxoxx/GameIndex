/**
 * Per-game notes / guides.
 *
 * Mirrors `src-tauri/src/db/game_notes.rs`: one row per note, Markdown content,
 * tags as a string array, pinned first then newest-updated. The frontend owns
 * the Markdown renderer; this layer only persists and searches.
 *
 * Storage: `<userData>/db/game_notes.db` (`state/db/notes.ts`). The one-time
 * import reads the previous `userData/game-notes.json` and any legacy Tauri
 * `game_notes.db` before the first call.
 */
import type { CommandHandler } from "../ipc";
import {
  deleteNoteRow,
  deleteNoteRowsForGame,
  ensureStorage,
  listNotesForGame,
  searchNotes,
  upsertNote,
  type GameNote,
} from "../state/db";

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : fallback;
}

function asTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((tag): tag is string => typeof tag === "string" && tag.trim() !== "");
}

function normalizeNote(raw: unknown): GameNote {
  if (!raw || typeof raw !== "object") throw new Error("save_game_note expects a `note` object");
  const input = raw as Partial<GameNote>;
  const now = Date.now();
  const id =
    typeof input.id === "string" && input.id.trim() !== ""
      ? input.id
      : `note-${now}-${Math.random().toString(36).slice(2, 10)}`;
  const createdAt = asNumber(input.createdAt, 0) || now;

  return {
    id,
    gameId: asString(input.gameId),
    title: asString(input.title),
    content: asString(input.content),
    tags: asTags(input.tags),
    pinned: Boolean(input.pinned),
    createdAt,
    updatedAt: now,
  };
}

export const noteCommands: Record<string, CommandHandler> = {
  load_game_notes: (args) => {
    const gameId = asString(args.gameId ?? args.game_id);
    if (!gameId) return [];
    ensureStorage("game_notes");
    return listNotesForGame(gameId);
  },

  search_game_notes: (args) => {
    const query = asString(args.query);
    const limit = Math.min(200, Math.max(1, asNumber(args.limit, 80)));
    ensureStorage("game_notes");
    return searchNotes(query, limit);
  },

  save_game_note: (args) => {
    const note = normalizeNote(args.note);
    if (!note.gameId) throw new Error("save_game_note expects `note.gameId`");
    ensureStorage("game_notes");
    // `createdAt` is preserved on update; `updatedAt` was just stamped.
    return upsertNote(note);
  },

  delete_game_note: (args) => {
    const id = asString(args.id);
    if (!id) return 0;
    ensureStorage("game_notes");
    return deleteNoteRow(id);
  },

  delete_game_notes_for_game: (args) => {
    const gameId = asString(args.gameId ?? args.game_id);
    if (!gameId) return 0;
    ensureStorage("game_notes");
    return deleteNoteRowsForGame(gameId);
  },
};
