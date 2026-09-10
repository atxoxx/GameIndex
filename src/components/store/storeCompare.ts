import type { StoreGameSummary } from "../../types/game";

/**
 * Shared compare-set model for the Store page. Kept framework-free so the
 * maximum, dedupe/limit semantics, session persistence and the "which game
 * wins a row" logic can be unit-tested without mounting React.
 */

/** Hard cap on side-by-side columns. Beyond four the modal gets unusable. */
export const COMPARE_MAX = 4;

/** sessionStorage key for the pinned compare set (survives route changes). */
export const COMPARE_STORAGE_KEY = "gamelib_store_compare_v1";

export type CompareRejectReason = "duplicate" | "limit";

export interface CompareMutation {
  list: StoreGameSummary[];
  rejected: CompareRejectReason | null;
}

/** Append `game` unless it is already pinned or the cap is reached. */
export function addToCompareList(
  list: StoreGameSummary[],
  game: StoreGameSummary,
  max: number = COMPARE_MAX
): CompareMutation {
  if (list.some((g) => g.slug === game.slug)) {
    return { list, rejected: "duplicate" };
  }
  if (list.length >= max) {
    return { list, rejected: "limit" };
  }
  return { list: [...list, game], rejected: null };
}

/** Add when absent, remove when present. */
export function toggleInCompareList(
  list: StoreGameSummary[],
  game: StoreGameSummary,
  max: number = COMPARE_MAX
): CompareMutation {
  if (list.some((g) => g.slug === game.slug)) {
    return { list: list.filter((g) => g.slug !== game.slug), rejected: null };
  }
  return addToCompareList(list, game, max);
}

/** Drop a game from the pinned set by slug. */
export function removeFromCompareList(
  list: StoreGameSummary[],
  slug: string
): StoreGameSummary[] {
  return list.filter((g) => g.slug !== slug);
}

function isStoreGameSummary(value: unknown): value is StoreGameSummary {
  if (typeof value !== "object" || value === null) return false;
  const g = value as Record<string, unknown>;
  return typeof g.slug === "string" && g.slug.length > 0 && typeof g.name === "string";
}

/**
 * Restore the pinned compare set from sessionStorage. Garbage, legacy
 * payloads and oversized lists are normalized instead of trusted so a bad
 * write can never crash the Store page on boot.
 */
export function loadCompareGames(): StoreGameSummary[] {
  if (typeof sessionStorage === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(COMPARE_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const list: StoreGameSummary[] = [];
    for (const entry of parsed) {
      if (!isStoreGameSummary(entry) || seen.has(entry.slug)) continue;
      seen.add(entry.slug);
      list.push(entry);
      if (list.length >= COMPARE_MAX) break;
    }
    return list;
  } catch {
    return [];
  }
}

/** Persist the pinned compare set (best-effort; storage can be unavailable). */
export function saveCompareGames(games: StoreGameSummary[]): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(COMPARE_STORAGE_KEY, JSON.stringify(games));
  } catch {
    /* ignore quota / privacy-mode failures */
  }
}

export type CompareValue = string | number | null;

export interface CompareRow {
  key: string;
  label: string;
  /** "high" marks the numerically best value (ties all win). */
  better?: "high";
  value: (game: StoreGameSummary) => CompareValue;
}

/**
 * Indexes of the numerically best cells for a row. Returns an empty set when
 * the row has no `better` direction, fewer than two real values, or every
 * value is identical — a tie for "all equal" is not worth highlighting.
 */
export function bestIndexes(
  games: StoreGameSummary[],
  row: CompareRow
): Set<number> {
  const empty = new Set<number>();
  if (row.better !== "high") return empty;
  const values = games.map((g) => {
    const v = row.value(g);
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  });
  const present = values.filter((v): v is number => v !== null);
  if (present.length < 2) return empty;
  const best = Math.max(...present);
  if (present.every((v) => v === best)) return empty;
  const winners = new Set<number>();
  values.forEach((v, i) => {
    if (v === best) winners.add(i);
  });
  return winners;
}

/**
 * Values present in every game's list for a given selector (genres,
 * platforms, themes, modes). Highlighting the overlap is the whole point of
 * a side-by-side comparison, so the modal renders these as "shared" chips.
 */
export function sharedValues(
  games: StoreGameSummary[],
  selector: (game: StoreGameSummary) => string[] | undefined
): Set<string> {
  const shared = new Set<string>();
  if (games.length < 2) return shared;
  const lists = games.map((g) => selector(g) ?? []);
  if (lists.some((l) => l.length === 0)) return shared;
  for (const value of lists[0]) {
    if (lists.every((l) => l.includes(value))) shared.add(value);
  }
  return shared;
}
