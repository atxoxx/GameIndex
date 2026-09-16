import type { Game } from "../../types/game";

/** Above this many changed rows a targeted upsert stops being worth the
 *  round-trips and we fall back to a single full-library rewrite. */
export const MAX_TARGETED_ROWS = 5;

export type SavePlan =
  | { kind: "skip" }
  | { kind: "rows"; rows: Game[] }
  | { kind: "full" };

/**
 * Decide how to persist the next library snapshot given the array whose
 * contents are already on disk.
 *
 * Arrays are compared by element reference — every mutation path
 * (`updateGame`, add/remove) replaces the changed rows, so reference
 * identity is the signal that a row needs writing. Returning `rows`
 * therefore carries the exact changed `Game` objects for `save_game`; a
 * structural change (insert/remove/reorder, detectable as a length change
 * or an id shift) or a large-enough diff returns `full`.
 */
export function planGameSave(prev: Game[] | null, next: Game[]): SavePlan {
  if (prev === null) return { kind: "full" };
  if (prev === next) return { kind: "skip" };
  if (prev.length !== next.length) return { kind: "full" };

  const changed: Game[] = [];
  for (let i = 0; i < next.length; i++) {
    const before = prev[i];
    const after = next[i];
    if (before === after) continue;
    // References differ at this index; if the ids disagree the array was
    // reordered or shifted and positional upserts can't express it.
    if (before.id !== after.id) return { kind: "full" };
    changed.push(after);
  }

  if (changed.length === 0) return { kind: "skip" };
  if (changed.length > MAX_TARGETED_ROWS) return { kind: "full" };
  return { kind: "rows", rows: changed };
}
