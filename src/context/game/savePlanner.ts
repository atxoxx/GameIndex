import type { Game } from "../../types/game";

/**
 * A plan for persisting the next library snapshot.
 *
 * `rows` carries the games whose in-memory object changed (additions plus
 * edits); `removedIds` carries ids no longer present. Every write is now
 * targeted — the full-library `save_games` rewrite was removed so a
 * summary-only library can never overwrite heavy columns for untouched
 * rows. Deletions are expressed explicitly via `delete_games`.
 */
export type SavePlan =
  | { kind: "skip" }
  | { kind: "rows"; rows: Game[]; removedIds: string[] };

/**
 * Decide how to persist the next library snapshot given the array whose
 * contents are already on disk.
 *
 * Arrays are compared by element reference per id: every mutation path
 * (`updateGame`, add/remove) replaces the changed rows, so reference
 * identity is the signal that a row needs writing. Rows are matched by id
 * (not position) so a reorder is not mistaken for a rewrite.
 */
export function planGameSave(prev: Game[] | null, next: Game[]): SavePlan {
  if (prev === null) {
    return next.length > 0
      ? { kind: "rows", rows: next, removedIds: [] }
      : { kind: "skip" };
  }
  if (prev === next) return { kind: "skip" };

  const prevById = new Map<string, Game>(prev.map((game) => [game.id, game] as const));
  const nextIds = new Set(next.map((game) => game.id));

  const rows: Game[] = [];
  for (const game of next) {
    if (prevById.get(game.id) !== game) rows.push(game);
  }
  const removedIds = prev.filter((game) => !nextIds.has(game.id)).map((game) => game.id);

  if (rows.length === 0 && removedIds.length === 0) return { kind: "skip" };
  return { kind: "rows", rows, removedIds };
}
