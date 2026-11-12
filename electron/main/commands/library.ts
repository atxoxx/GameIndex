/**
 * Game library persistence — the highest-priority part of the Electron port.
 *
 * The renderer hydrates through `load_games_summary`, mutates through the
 * targeted `save_games_subset` / `patch_game` / `delete_games` path, and opens
 * detail surfaces through `get_game_detail`. All of it is backed by
 * `state/libraryStore.ts`, which reads and writes `<userData>/db/games.db`
 * through `state/db/games.ts` — the same per-game rows, column layout and
 * summary/full split as the retired Rust SQLite DAO.
 */
import fs from "node:fs";
import type { CommandHandler } from "../ipc";
import {
  deleteGames,
  getGame,
  listGames,
  listGamesSummary,
  patchGameRecord,
  replaceLibrary,
  setLastPlayed,
  upsertGames,
} from "../state/libraryStore";

function firstString(args: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "";
}

function numeric(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export const libraryCommands: Record<string, CommandHandler> = {
  // ── Reads ─────────────────────────────────────────────────────────
  load_games_summary: () => listGamesSummary(),
  load_games: () => listGames(),
  get_game_detail: (args) => {
    const id = firstString(args, "id", "gameId");
    return id ? getGame(id) : null;
  },

  // ── Writes ────────────────────────────────────────────────────────
  /** Full-library replacement. The current renderer only uses the targeted
   *  subset path below, but the command stays drop-in for imports/tools. */
  save_games: (args) => replaceLibrary(args.games),

  /** Merge-by-id write used for detail-loaded rows. Rows absent from the
   *  payload stay untouched. */
  save_games_subset: (args) => upsertGames(args.games),

  /** Single-row upsert from the enrichment pipeline. */
  save_game: (args) => {
    const game = args.game;
    if (!game || typeof game !== "object") {
      throw new Error("save_game expects a `game` object");
    }
    return upsertGames([game]);
  },

  /** Sparse merge for summary-only rows (playtime, lastPlayed, favorite,
   *  installed, size, launch flags). Heavy media keys are ignored, matching
   *  the Rust `patch_game` guard. */
  patch_game: (args) => {
    const id = firstString(args, "id", "gameId");
    if (!id) throw new Error("patch_game expects an `id`");
    patchGameRecord(id, args.patch);
    return null;
  },

  delete_games: (args) => {
    const ids = Array.isArray(args.ids) ? args.ids.map(String) : [];
    deleteGames(ids);
    return null;
  },

  update_game_last_played: (args) => {
    const id = firstString(args, "gameId", "id");
    const ms = numeric(args.lastPlayedMs ?? args.lastPlayed ?? args.last_played_ms, 0);
    if (id && ms > 0) setLastPlayed(id, ms);
    return null;
  },

  // ── ROM cleanup (emulation surfaces) ──────────────────────────────
  /** Delete a ROM file from disk and drop its library row. Mirrors
   *  `src-tauri/src/emulation.rs::delete_rom_file`; a missing file still
   *  removes the row so a stale entry can be cleaned up. */
  delete_rom_file: (args) => {
    const id = firstString(args, "gameId", "id");
    const game = id ? getGame(id) : null;
    if (!game) throw new Error(`ROM not found: ${id}`);

    let freed = 0;
    const romPath = typeof game.romPath === "string" ? game.romPath : "";
    if (romPath) {
      try {
        freed = fs.statSync(romPath).size;
      } catch {
        freed = 0;
      }
      try {
        fs.rmSync(romPath, { force: true });
      } catch (error) {
        console.warn(`[library] could not delete ROM ${romPath}:`, error);
      }
    }
    deleteGames([id]);
    return freed;
  },

  /** Remove a ROM row without touching its file. */
  unlink_rom_file: (args) => {
    const id = firstString(args, "gameId", "id");
    if (id) deleteGames([id]);
    return null;
  },
};
