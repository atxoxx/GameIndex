import { describe, expect, it } from "vitest";
import { getDefaultLayoutSnapshot } from "./layoutPresets";
import { countLayoutChanges, countValueChanges, isDefaultLayout } from "./layoutDiff";
import type { LayoutSnapshot } from "./types";

function snapshot(): LayoutSnapshot {
  return getDefaultLayoutSnapshot();
}

describe("countValueChanges", () => {
  it("counts leaves, not containers", () => {
    expect(countValueChanges({ a: 1, b: false }, { a: 1, b: true })).toBe(1);
    expect(countValueChanges([1, 2, 3], [1, 9, 3])).toBe(1);
  });

  it("treats a type mismatch or a missing value as a change", () => {
    expect(countValueChanges("left", ["left"])).toBe(1);
    expect(countValueChanges(undefined, {})).toBe(1);
    expect(countValueChanges(null, false)).toBe(1);
  });
});

describe("countLayoutChanges", () => {
  it("reports zero for the shipped layout", () => {
    expect(countLayoutChanges(snapshot(), snapshot())).toBe(0);
    expect(isDefaultLayout(snapshot(), snapshot())).toBe(true);
  });

  it("counts each hidden element once", () => {
    const current = snapshot();
    current.interfaceVisibility = {
      ...current.interfaceVisibility,
      navWishlist: false,
      navDeals: false,
    };
    expect(countLayoutChanges(current, snapshot())).toBe(2);
  });

  it("counts a changed scalar", () => {
    const current = snapshot();
    current.uiScale = "125";
    expect(countLayoutChanges(current, snapshot())).toBe(1);
  });

  it("ignores a sparse order map that equals the shipped order", () => {
    const current = snapshot();
    current.pageItemOrder = { home: snapshot().pageItemOrder.home };
    current.detailTabOrder = { game: snapshot().detailTabOrder.game ?? [] };
    expect(countLayoutChanges(current, snapshot())).toBe(0);
  });

  it("counts a reordered block", () => {
    const current = snapshot();
    const library = current.pageItemOrder.library ?? [];
    current.pageItemOrder = {
      ...current.pageItemOrder,
      library: [...library].reverse(),
    };
    expect(countLayoutChanges(current, snapshot())).toBeGreaterThan(0);
    expect(isDefaultLayout(current, snapshot())).toBe(false);
  });
});
