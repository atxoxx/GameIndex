// layoutDiff — "how far is this layout from the shipped one?".
//
// The studio's header needs one honest number for that question, and the
// stored maps are sparse by design: `pageItemOrder` only carries pages the user
// rearranged, `detailTabOrder` only scopes they touched. A naive deep compare
// would report every untouched page as a change, so the two snapshots are
// expanded to their *effective* values first.

import {
  DETAIL_TABS,
  HERO_ELEMENTS,
  INTERFACE_PAGES,
  DETAIL_TOP_BAR,
  type DetailTabKey,
  type DetailTopBarKey,
  type HeroElementKey,
} from "../../../context/interfaceLayout";
import type { LayoutSnapshot } from "./types";

/** Fill the sparse order maps with the orders the app actually renders. */
export function effectiveLayoutSnapshot(snapshot: LayoutSnapshot): LayoutSnapshot {
  const pageItemOrder: LayoutSnapshot["pageItemOrder"] = {};
  for (const page of INTERFACE_PAGES) {
    if (page.key === "global") continue;
    pageItemOrder[page.key] = [...(snapshot.pageItemOrder[page.key] ?? page.items)];
  }

  const detailTabOrder: LayoutSnapshot["detailTabOrder"] = {};
  for (const scope of ["game", "store"] as const) {
    detailTabOrder[scope] = [
      ...(snapshot.detailTabOrder[scope] ?? DETAIL_TABS[scope]),
    ] as DetailTabKey[];
  }

  const heroElementOrder: LayoutSnapshot["heroElementOrder"] = {};
  for (const scope of ["game", "store"] as const) {
    heroElementOrder[scope] = [
      ...(snapshot.heroElementOrder[scope] ?? HERO_ELEMENTS),
    ] as HeroElementKey[];
  }

  const detailTopBarOrder: LayoutSnapshot["detailTopBarOrder"] = {};
  for (const scope of ["game", "store"] as const) {
    detailTopBarOrder[scope] = [
      ...(snapshot.detailTopBarOrder?.[scope] ?? DETAIL_TOP_BAR[scope]),
    ] as DetailTopBarKey[];
  }

  return {
    ...snapshot,
    pageItemOrder,
    detailTabOrder,
    heroElementOrder,
    detailTopBarOrder,
    heroGridLayout: snapshot.heroGridLayout ?? {},
    detailTopBarVisibility: snapshot.detailTopBarVisibility ?? {},
    heroElementVisibility: snapshot.heroElementVisibility ?? {},
  };
}

/** Difference count between two JSON-ish values, counting leaves, not groups. */
export function countValueChanges(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return 1;
    if (a.length !== b.length) return Math.max(1, Math.abs(a.length - b.length));
    return a.reduce((sum, item, index) => sum + countValueChanges(item, b[index]), 0);
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = new Set([
      ...Object.keys(a as Record<string, unknown>),
      ...Object.keys(b as Record<string, unknown>),
    ]);
    let total = 0;
    for (const key of keys) {
      total += countValueChanges(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
      );
    }
    return total;
  }
  return 1;
}

/**
 * How many individual settings differ from the shipped layout. Used for the
 * header's "N changes" pill; 0 means "default layout".
 */
export function countLayoutChanges(
  snapshot: LayoutSnapshot,
  defaults: LayoutSnapshot,
): number {
  const current = effectiveLayoutSnapshot(snapshot);
  const base = effectiveLayoutSnapshot(defaults);
  const keys = Object.keys(base) as (keyof LayoutSnapshot)[];
  return keys.reduce(
    (sum, key) => sum + countValueChanges(current[key], base[key]),
    0,
  );
}

/** True when nothing differs from the shipped layout. */
export function isDefaultLayout(
  snapshot: LayoutSnapshot,
  defaults: LayoutSnapshot,
): boolean {
  return countLayoutChanges(snapshot, defaults) === 0;
}
