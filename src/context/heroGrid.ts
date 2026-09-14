// heroGrid — the shared model behind the Layout Studio's hero grid editor.
//
// The Interface settings tab can reorder the hero elements with CSS `order`
// (a content-driven flex layout). This module declares the optional *grid*
// layout model on top of the same element set: every hero element except the
// absolute `background` layer becomes a grid item that owns a rect (column /
// row / span) inside a fixed 12-column track.
//
// Nothing is persisted by default, so existing users keep the shipped flex
// layout exactly; a grid only exists once an authored layout is stored. All
// readers go through the normalizers below, which are append-only (unknown
// keys dropped, missing keys filled from the default) so an upgrade never
// leaves a freshly-added element unplaced.

import type { HeroElementKey, HeroScope } from "./interfaceLayout";

/** Grid items = every hero element except `background` (an absolute layer). */
export type HeroGridItemKey = Exclude<HeroElementKey, "background">;

export const HERO_GRID_ITEM_KEYS: HeroGridItemKey[] = [
  "poster",
  "title",
  "meta",
  "genres",
  "kpis",
  "actions",
];

export const HERO_GRID_COLUMNS = 12;
export const HERO_GRID_MAX_ROWS = 12;

/** 1-based col/row; colSpan/rowSpan >= 1. col+colSpan-1 <= 12. */
export interface HeroGridPlacement {
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
}

export type HeroGridLayout = Record<HeroGridItemKey, HeroGridPlacement>;
export type HeroGridLayoutMap = Partial<Record<HeroScope, HeroGridLayout>>;

export const HERO_GRID_MIN_SPAN: Record<
  HeroGridItemKey,
  { cols: number; rows: number }
> = {
  poster: { cols: 2, rows: 2 },
  title: { cols: 2, rows: 1 },
  meta: { cols: 2, rows: 1 },
  genres: { cols: 2, rows: 1 },
  kpis: { cols: 3, rows: 1 },
  actions: { cols: 3, rows: 1 },
};

/** Reproduces the shipped look: poster left full-height, content right. */
const GAME_HERO_GRID_LAYOUT: HeroGridLayout = {
  poster: { col: 1, row: 1, colSpan: 3, rowSpan: 4 },
  title: { col: 4, row: 1, colSpan: 9, rowSpan: 1 },
  meta: { col: 4, row: 2, colSpan: 9, rowSpan: 1 },
  genres: { col: 4, row: 3, colSpan: 9, rowSpan: 1 },
  kpis: { col: 4, row: 4, colSpan: 6, rowSpan: 1 },
  actions: { col: 10, row: 4, colSpan: 3, rowSpan: 1 },
};

function cloneHeroGridLayout(layout: HeroGridLayout): HeroGridLayout {
  const next = {} as HeroGridLayout;
  for (const key of HERO_GRID_ITEM_KEYS) {
    next[key] = { ...layout[key] };
  }
  return next;
}

export const DEFAULT_HERO_GRID_LAYOUT: Record<HeroScope, HeroGridLayout> = {
  game: cloneHeroGridLayout(GAME_HERO_GRID_LAYOUT),
  store: cloneHeroGridLayout(GAME_HERO_GRID_LAYOUT),
};

/** Whether an unknown value is one of the six grid item keys. */
export function isHeroGridItemKey(v: unknown): v is HeroGridItemKey {
  return (
    typeof v === "string" &&
    (HERO_GRID_ITEM_KEYS as readonly string[]).includes(v)
  );
}

/** Round + clamp a numeric field, falling back when it isn't a real number. */
function clampGridInt(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const numeric =
    typeof value === "number" && Number.isFinite(value)
      ? Math.round(value)
      : fallback;
  return Math.min(Math.max(numeric, min), max);
}

/**
 * Clamp a raw (possibly partial) placement for one element into valid bounds.
 * Missing fields fall back to the shipped default; spans are clamped to the
 * per-key minimum and to the track. When the column bound and the minimum span
 * cannot both hold, the track bound wins (the item stays on the grid even if
 * that means a span of one).
 */
export function clampHeroGridPlacement(
  key: HeroGridItemKey,
  raw: Partial<HeroGridPlacement>,
): HeroGridPlacement {
  const fallback = DEFAULT_HERO_GRID_LAYOUT.game[key];
  const min = HERO_GRID_MIN_SPAN[key];

  let colSpan = clampGridInt(
    raw.colSpan,
    min.cols,
    HERO_GRID_COLUMNS,
    fallback.colSpan,
  );
  let rowSpan = clampGridInt(
    raw.rowSpan,
    min.rows,
    HERO_GRID_MAX_ROWS,
    fallback.rowSpan,
  );
  const col = clampGridInt(raw.col, 1, HERO_GRID_COLUMNS, fallback.col);
  const row = clampGridInt(raw.row, 1, HERO_GRID_MAX_ROWS, fallback.row);

  // Keep the item inside the track: never let it bleed past the last column
  // or row.
  colSpan = Math.min(colSpan, HERO_GRID_COLUMNS - col + 1);
  rowSpan = Math.min(rowSpan, HERO_GRID_MAX_ROWS - row + 1);

  return { col, row, colSpan, rowSpan };
}

/**
 * Normalize a persisted single-scope grid layout. Starts from the shipped
 * default so every known key is present; only object-valued known keys are
 * read. Invalid input (null, a number, a string, …) returns the default.
 */
export function normalizeHeroGridLayout(
  scope: HeroScope,
  raw: unknown,
): HeroGridLayout {
  const defaults = DEFAULT_HERO_GRID_LAYOUT[scope];
  const source =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const next = {} as HeroGridLayout;
  for (const key of HERO_GRID_ITEM_KEYS) {
    const value = source[key];
    if (value && typeof value === "object") {
      next[key] = clampHeroGridPlacement(
        key,
        value as Partial<HeroGridPlacement>,
      );
    } else {
      next[key] = { ...defaults[key] };
    }
  }
  return next;
}

/** A scope object counts as an authored grid only when it carries at least
 *  one recognized placement (an object-valued grid-item key). An empty or
 *  stray `{ game: {} }` therefore stays absent => the hero keeps flex mode. */
function hasAuthoredHeroGridPlacement(value: Record<string, unknown>): boolean {
  return HERO_GRID_ITEM_KEYS.some((key) => {
    const placement = value[key];
    return !!placement && typeof placement === "object";
  });
}

/** Normalize the whole persisted map: keep only the two known scopes with
 *  object-valued layouts that name at least one recognized placement;
 *  anything else is dropped (=> flex mode). */
export function normalizeHeroGridLayoutMap(raw: unknown): HeroGridLayoutMap {
  if (!raw || typeof raw !== "object") return {};
  const source = raw as Record<string, unknown>;
  const next: HeroGridLayoutMap = {};
  for (const scope of ["game", "store"] as HeroScope[]) {
    const value = source[scope];
    if (
      value &&
      typeof value === "object" &&
      hasAuthoredHeroGridPlacement(value as Record<string, unknown>)
    ) {
      next[scope] = normalizeHeroGridLayout(scope, value);
    }
  }
  return next;
}

/** Resolve the effective grid for a scope. `null` means "no grid authored" —
 *  the hero must render its flex/`order` layout exactly as before. */
export function resolveHeroGridLayout(
  map: HeroGridLayoutMap,
  scope: HeroScope,
): HeroGridLayout | null {
  return map[scope] ?? null;
}

/**
 * Seed a grid layout from the current flex order (used the first time a user
 * switches a hero into grid mode). Items stack top-to-bottom in their existing
 * order, each starting in column 1 with its shipped width.
 */
export function buildHeroGridLayoutFromOrder(
  order: HeroElementKey[],
): HeroGridLayout {
  const seen = new Set<HeroGridItemKey>();
  const ordered: HeroGridItemKey[] = [];
  for (const key of order) {
    if (isHeroGridItemKey(key) && !seen.has(key)) {
      seen.add(key);
      ordered.push(key);
    }
  }
  for (const key of HERO_GRID_ITEM_KEYS) {
    if (!seen.has(key)) ordered.push(key);
  }

  const next = {} as HeroGridLayout;
  ordered.forEach((key, index) => {
    const fallback = DEFAULT_HERO_GRID_LAYOUT.game[key];
    next[key] = clampHeroGridPlacement(key, {
      col: 1,
      row: index + 1,
      colSpan: fallback.colSpan,
      rowSpan: 1,
    });
  });
  return next;
}

/** Row-major (row, then column) ordering of the requested items, so DOM order
 *  matches reading order regardless of the authored layout. */
export function sortHeroGridItems(
  layout: HeroGridLayout,
  keys: HeroGridItemKey[],
): HeroGridItemKey[] {
  return [...keys].sort((a, b) => {
    const pa = layout[a];
    const pb = layout[b];
    if (!pa || !pb) return 0;
    if (pa.row !== pb.row) return pa.row - pb.row;
    return pa.col - pb.col;
  });
}

function gridRectsOverlap(a: HeroGridPlacement, b: HeroGridPlacement): boolean {
  return (
    a.col < b.col + b.colSpan &&
    a.col + a.colSpan > b.col &&
    a.row < b.row + b.rowSpan &&
    a.row + a.rowSpan > b.row
  );
}

/** Every pair of grid items whose rects intersect. */
export function findHeroGridOverlaps(
  layout: HeroGridLayout,
): [HeroGridItemKey, HeroGridItemKey][] {
  const keys = HERO_GRID_ITEM_KEYS.filter((key) => !!layout[key]);
  const pairs: [HeroGridItemKey, HeroGridItemKey][] = [];
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      if (gridRectsOverlap(layout[keys[i]], layout[keys[j]])) {
        pairs.push([keys[i], keys[j]]);
      }
    }
  }
  return pairs;
}
