/**
 * Smart Shelves.
 *
 * The frontend evaluates the rule vocabulary (`src/hooks/shelfRules.ts`), so
 * this layer persists only definitions plus the per-game completion map.
 *
 * Mirrors `src-tauri/src/db/shelves.rs` normalization: generated ids, default
 * icon/color/sort, appended position for new rows, 30-shelf cap, and
 * `updatedAt` refreshed on every save.
 *
 * Storage: `<userData>/db/shelves.db` (`state/db/shelves.ts`).
 */
import type { CommandHandler } from "../ipc";
import {
  clearCompletion,
  countShelves,
  deleteShelfRow,
  ensureStorage,
  listCompletions,
  listShelves,
  MAX_SHELVES,
  nextShelfPosition,
  reorderShelves,
  setCompletion,
  upsertShelf,
  type Shelf,
} from "../state/db";

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : fallback;
}

function normalizeShelf(raw: unknown): { shelf: Shelf; isNew: boolean } {
  if (!raw || typeof raw !== "object") throw new Error("shelves_save expects a `shelf` object");
  const input = raw as Partial<Shelf>;
  const now = Date.now();
  const isNew = typeof input.id !== "string" || input.id.trim() === "";
  const icon = asString(input.icon).trim() || "layers";
  const color = asString(input.color).trim() || "accent";
  const sort = asString(input.sort).trim() || "alphabetical";

  return {
    isNew,
    shelf: {
      id: isNew ? `shelf-${now}-${Math.random().toString(36).slice(2, 10)}` : (input.id as string),
      name: asString(input.name),
      icon,
      color,
      rules:
        input.rules && typeof input.rules === "object" && !Array.isArray(input.rules)
          ? input.rules
          : {},
      sort,
      pinned: Boolean(input.pinned),
      position: asNumber(input.position, 0),
      createdAt: asNumber(input.createdAt, 0) || now,
      updatedAt: now,
    },
  };
}

export const shelfCommands: Record<string, CommandHandler> = {
  shelves_list: () => {
    ensureStorage("shelves");
    return listShelves();
  },

  shelves_save: (args) => {
    const { shelf, isNew } = normalizeShelf(args.shelf);
    ensureStorage("shelves");

    if (isNew && countShelves() >= MAX_SHELVES) {
      throw new Error(`shelf limit reached (${MAX_SHELVES})`);
    }
    if (isNew) {
      // Appended after the current maximum position (Rust upsert semantics).
      shelf.position = nextShelfPosition();
    }

    // `createdAt` is kept on an edit and `updatedAt` is fresh.
    return upsertShelf(shelf);
  },

  shelves_delete: (args) => {
    const id = asString(args.id);
    if (!id) return 0;
    ensureStorage("shelves");
    return deleteShelfRow(id);
  },

  shelves_reorder: (args) => {
    const ids = Array.isArray(args.ids) ? args.ids.map(String) : [];
    if (ids.length === 0) return null;
    ensureStorage("shelves");
    reorderShelves(ids);
    return null;
  },

  /** Every game id → completion timestamp (unix ms), as `[id, ts]` tuples. */
  shelves_completions: () => {
    ensureStorage("shelves");
    return listCompletions();
  },

  shelves_set_completion: (args) => {
    const gameId = asString(args.gameId ?? args.game_id);
    const completedAt = asNumber(args.completedAt ?? args.completed_at, 0);
    if (gameId) {
      ensureStorage("shelves");
      if (completedAt === 0) clearCompletion(gameId);
      else setCompletion(gameId, completedAt);
    }
    return null;
  },
};
