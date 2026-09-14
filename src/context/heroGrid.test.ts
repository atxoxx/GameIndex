import { describe, it, expect } from "vitest";
import {
  DEFAULT_HERO_GRID_LAYOUT,
  HERO_GRID_COLUMNS,
  HERO_GRID_ITEM_KEYS,
  HERO_GRID_MAX_ROWS,
  buildHeroGridLayoutFromOrder,
  clampHeroGridPlacement,
  findHeroGridOverlaps,
  isHeroGridItemKey,
  normalizeHeroGridLayout,
  normalizeHeroGridLayoutMap,
  resolveHeroGridLayout,
  sortHeroGridItems,
} from "./heroGrid";

describe("isHeroGridItemKey", () => {
  it("accepts every grid item and rejects the background layer", () => {
    for (const key of HERO_GRID_ITEM_KEYS) {
      expect(isHeroGridItemKey(key)).toBe(true);
    }
    expect(isHeroGridItemKey("background")).toBe(false);
    expect(isHeroGridItemKey(7)).toBe(false);
  });
});

describe("clampHeroGridPlacement", () => {
  it("raises spans to the per-key minimum", () => {
    expect(
      clampHeroGridPlacement("kpis", { col: 1, row: 1, colSpan: 1, rowSpan: 0 }),
    ).toEqual({ col: 1, row: 1, colSpan: 3, rowSpan: 1 });
  });

  it("clamps columns and rows to the track bounds", () => {
    const placement = clampHeroGridPlacement("title", {
      col: 99,
      row: 99,
      colSpan: 99,
      rowSpan: 99,
    });
    expect(placement.col).toBe(HERO_GRID_COLUMNS);
    expect(placement.row).toBe(HERO_GRID_MAX_ROWS);
    expect(placement.colSpan).toBeGreaterThanOrEqual(1);
    expect(placement.rowSpan).toBeGreaterThanOrEqual(1);
    expect(placement.col + placement.colSpan - 1).toBeLessThanOrEqual(
      HERO_GRID_COLUMNS,
    );
  });

  it("falls back to the shipped placement for missing fields", () => {
    expect(clampHeroGridPlacement("poster", {})).toEqual(
      DEFAULT_HERO_GRID_LAYOUT.game.poster,
    );
  });
});

describe("normalizeHeroGridLayout", () => {
  it("keeps known keys and appends every missing key from the default", () => {
    const result = normalizeHeroGridLayout("game", {
      title: { col: 5, row: 2, colSpan: 4, rowSpan: 1 },
    });
    expect(result.title).toEqual({ col: 5, row: 2, colSpan: 4, rowSpan: 1 });
    expect(result.poster).toEqual(DEFAULT_HERO_GRID_LAYOUT.game.poster);
    expect(Object.keys(result).sort()).toEqual([...HERO_GRID_ITEM_KEYS].sort());
  });

  it("clamps an oversized span into the track", () => {
    const result = normalizeHeroGridLayout("game", {
      title: { col: 1, row: 1, colSpan: 99, rowSpan: 1 },
    });
    expect(result.title.colSpan).toBe(HERO_GRID_COLUMNS);
  });
});

describe("normalizeHeroGridLayoutMap", () => {
  it("normalizes each known scope", () => {
    const result = normalizeHeroGridLayoutMap({
      game: { title: { col: 5 } },
      store: { poster: { row: 2 } },
    });
    expect(result.game?.title.col).toBe(5);
    expect(result.store?.poster.row).toBe(2);
  });

  it("drops unknown scopes", () => {
    expect(normalizeHeroGridLayoutMap({ bogus: { title: { col: 2 } } })).toEqual(
      {},
    );
  });

  it("drops an empty scope object instead of enabling a default grid", () => {
    expect(normalizeHeroGridLayoutMap({ game: {} })).toEqual({});
    expect(normalizeHeroGridLayoutMap({ game: {}, store: {} })).toEqual({});
  });

  it("keeps a partial scope that names a recognized placement", () => {
    const result = normalizeHeroGridLayoutMap({ game: { title: { col: 99 } } });
    expect(result.game?.title.col).toBe(HERO_GRID_COLUMNS);
    expect(result.game?.poster).toEqual(DEFAULT_HERO_GRID_LAYOUT.game.poster);
    expect(Object.keys(result.game ?? {}).sort()).toEqual(
      [...HERO_GRID_ITEM_KEYS].sort(),
    );
  });

  it("clamps a valid scope with an out-of-range column", () => {
    const result = normalizeHeroGridLayoutMap({ game: { title: { col: 99 } } });
    expect(result.game?.title.col).toBe(HERO_GRID_COLUMNS);
  });

  it("returns an empty map for malformed input", () => {
    expect(normalizeHeroGridLayoutMap(null)).toEqual({});
    expect(normalizeHeroGridLayoutMap(42)).toEqual({});
    expect(normalizeHeroGridLayoutMap("game")).toEqual({});
  });
});

describe("resolveHeroGridLayout", () => {
  it("returns null when no grid has been authored (flex mode)", () => {
    expect(resolveHeroGridLayout({}, "game")).toBeNull();
  });

  it("returns the stored layout when present", () => {
    const map = normalizeHeroGridLayoutMap({ game: { title: { col: 5 } } });
    expect(resolveHeroGridLayout(map, "game")?.title.col).toBe(5);
  });
});

describe("buildHeroGridLayoutFromOrder", () => {
  it("seeds a full layout from the flex order, dropping background", () => {
    const result = buildHeroGridLayoutFromOrder([
      "background",
      "actions",
      "poster",
    ]);
    expect(Object.keys(result).sort()).toEqual([...HERO_GRID_ITEM_KEYS].sort());
    expect(result.actions.row).toBe(1);
    expect(result.poster.row).toBe(2);
    expect("background" in result).toBe(false);
  });
});

describe("sortHeroGridItems", () => {
  it("returns row-major order", () => {
    expect(
      sortHeroGridItems(DEFAULT_HERO_GRID_LAYOUT.game, [
        "actions",
        "meta",
        "poster",
      ]),
    ).toEqual(["poster", "meta", "actions"]);
  });
});

describe("findHeroGridOverlaps", () => {
  it("finds a pair of intersecting items", () => {
    const layout = normalizeHeroGridLayout("game", null);
    const overlapping = {
      ...layout,
      title: { col: 1, row: 1, colSpan: 3, rowSpan: 1 },
    };
    expect(findHeroGridOverlaps(overlapping)).toContainEqual([
      "poster",
      "title",
    ]);
  });

  it("returns no pairs for the shipped layout", () => {
    expect(
      findHeroGridOverlaps(DEFAULT_HERO_GRID_LAYOUT.game),
    ).toEqual([]);
  });
});

describe("normalizeHeroGridLayout error path", () => {
  it("returns the shipped default for non-object input", () => {
    expect(normalizeHeroGridLayout("game", null)).toEqual(
      DEFAULT_HERO_GRID_LAYOUT.game,
    );
    expect(normalizeHeroGridLayout("game", 42)).toEqual(
      DEFAULT_HERO_GRID_LAYOUT.game,
    );
    expect(normalizeHeroGridLayout("game", "x")).toEqual(
      DEFAULT_HERO_GRID_LAYOUT.game,
    );
  });
});
