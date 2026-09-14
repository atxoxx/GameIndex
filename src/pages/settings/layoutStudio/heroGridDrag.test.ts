import { describe, expect, it } from "vitest";
import {
  HERO_GRID_DRAG_DEAD_ZONE,
  HERO_GRID_ROW_UNIT,
  moveGridPlacement,
  nudgeGridPlacement,
  pointerToGridCell,
  resizeGridPlacement,
} from "./useHeroGridDrag";
import {
  HERO_GRID_COLUMNS,
  HERO_GRID_MAX_ROWS,
  HERO_GRID_MIN_SPAN,
  type HeroGridPlacement,
} from "../../../context/heroGrid";

const RECT = { left: 100, top: 50, width: 1200 };
const GAP = 8;
// No column gap / padding here: track = 1200 / 12 = 100, pitch = 100,
// rowHeight = 40 + 8 = 48.

const placement = (
  col: number,
  row: number,
  colSpan: number,
  rowSpan: number,
): HeroGridPlacement => ({ col, row, colSpan, rowSpan });

describe("pointerToGridCell", () => {
  it("maps a viewport point onto the 1-based grid cell", () => {
    expect(pointerToGridCell(100, 50, RECT, 12, HERO_GRID_ROW_UNIT, GAP)).toEqual({
      col: 1,
      row: 1,
    });
    // x = 350 -> 250px into the track -> cell 3; y = 146 -> 96px -> row 3.
    expect(pointerToGridCell(350, 146, RECT, 12, HERO_GRID_ROW_UNIT, GAP)).toEqual({
      col: 3,
      row: 3,
    });
    // Right edge of column 6 sits at left + 6 * colWidth - 1.
    expect(pointerToGridCell(699, 50, RECT, 12, HERO_GRID_ROW_UNIT, GAP).col).toBe(6);
    expect(pointerToGridCell(700, 50, RECT, 12, HERO_GRID_ROW_UNIT, GAP).col).toBe(7);
  });

  it("clamps points outside the track into it", () => {
    expect(pointerToGridCell(-9999, -9999, RECT, 12, HERO_GRID_ROW_UNIT, GAP)).toEqual({
      col: 1,
      row: 1,
    });
    expect(
      pointerToGridCell(99999, 99999, RECT, 12, HERO_GRID_ROW_UNIT, GAP),
    ).toEqual({ col: HERO_GRID_COLUMNS, row: HERO_GRID_MAX_ROWS });
  });

  it("falls back to column 1 when the track has no measurable width", () => {
    expect(
      pointerToGridCell(400, 50, { left: 0, top: 0, width: 0 }, 12, 40, 0).col,
    ).toBe(1);
  });

  it("accounts for column gaps and horizontal padding when mapping x", () => {
    // 10 columns, 10px gaps, 20px padding each side, content box 1000 wide.
    // content = 1000 - 40 = 960; track = (960 - 9 * 10) / 10 = 87; pitch = 97.
    const rect = { left: 0, top: 0, width: 1000 };
    const map = (x: number) =>
      pointerToGridCell(x, 0, rect, 10, 40, 0, 10, 20, 20).col;

    // The flat `width / columns` formula would put this in column 3.
    expect(map(200)).toBe(2);
    // The first track starts after the left padding.
    expect(map(20)).toBe(1);
    // Each pitch is track + gap = 97.
    expect(map(116)).toBe(1);
    expect(map(117)).toBe(2);
    // The last track ends at the right padding edge (980).
    expect(map(978)).toBe(10);
    // Anything inside the padding still clamps into the track.
    expect(map(0)).toBe(1);
    expect(map(999)).toBe(10);
  });
});

describe("moveGridPlacement", () => {
  it("follows the grabbed cell, keeping the grab offset", () => {
    const origin = placement(3, 2, 2, 1);
    // Pointer started on the item's 3rd... no: grabbed 1 cell in from the left.
    expect(moveGridPlacement(origin, { col: 6, row: 2 }, 1, 0)).toEqual(
      placement(5, 2, 2, 1),
    );
    expect(moveGridPlacement(origin, { col: 3, row: 5 }, 0, 0)).toEqual(
      placement(3, 5, 2, 1),
    );
  });

  it("clamps so the item never bleeds past column 12 or the last row", () => {
    const wide = placement(1, 1, 3, 1);
    // maxCol = 12 - 3 + 1 = 10.
    expect(moveGridPlacement(wide, { col: 12, row: 1 }, 0, 0).col).toBe(10);
    expect(moveGridPlacement(wide, { col: 12, row: 1 }, 0, 0).colSpan).toBe(3);

    const tall = placement(1, 1, 1, 2);
    // maxRow = 12 - 2 + 1 = 11.
    expect(moveGridPlacement(tall, { col: 1, row: 12 }, 0, 0).row).toBe(11);
    expect(moveGridPlacement(tall, { col: 1, row: -5 }, 0, 0).row).toBe(1);
  });
});

describe("resizeGridPlacement", () => {
  it("grows columns from an east handle and rows from a south handle", () => {
    const origin = placement(4, 1, 2, 1);
    expect(resizeGridPlacement("title", origin, { col: 8, row: 1 }, "e")).toEqual(
      placement(4, 1, 5, 1),
    );
    expect(resizeGridPlacement("title", origin, { col: 4, row: 3 }, "s")).toEqual(
      placement(4, 1, 2, 3),
    );
    expect(resizeGridPlacement("title", origin, { col: 8, row: 3 }, "se")).toEqual(
      placement(4, 1, 5, 3),
    );
  });

  it("never shrinks a span below its per-key minimum", () => {
    // `title` needs at least 2 columns; dragging the handle left of the corner
    // must not collapse it.
    expect(resizeGridPlacement("title", placement(4, 1, 2, 1), { col: 2, row: 1 }, "e").colSpan).toBe(
      HERO_GRID_MIN_SPAN.title.cols,
    );
    expect(resizeGridPlacement("title", placement(4, 2, 2, 2), { col: 4, row: 1 }, "s").rowSpan).toBe(
      HERO_GRID_MIN_SPAN.title.rows,
    );
  });

  it("clamps a span to the track edge", () => {
    // From column 4 the widest reachable span is 12 - 4 + 1 = 9.
    expect(resizeGridPlacement("title", placement(4, 1, 2, 1), { col: 99, row: 1 }, "e").colSpan).toBe(9);
    expect(resizeGridPlacement("title", placement(1, 2, 2, 1), { col: 1, row: 99 }, "s").rowSpan).toBe(
      HERO_GRID_MAX_ROWS - 2 + 1,
    );
  });
});

describe("nudgeGridPlacement", () => {
  it("moves by a cell and clamps at the track edge", () => {
    expect(nudgeGridPlacement("title", placement(4, 1, 2, 1), 1, 0, false)).toEqual(
      placement(5, 1, 2, 1),
    );
    // A 9-wide span pinned at column 4 cannot move right.
    expect(nudgeGridPlacement("title", placement(4, 1, 9, 1), 1, 0, false).col).toBe(4);
    expect(nudgeGridPlacement("title", placement(1, 1, 2, 1), -1, 0, false).col).toBe(1);
  });

  it("grows and shrinks spans, respecting the per-key minimum", () => {
    const kpis = placement(1, 1, 3, 1); // kpis min = 3 cols, 1 row.
    expect(nudgeGridPlacement("kpis", kpis, 1, 0, true).colSpan).toBe(4);
    expect(nudgeGridPlacement("kpis", kpis, -1, 0, true).colSpan).toBe(3);
    expect(nudgeGridPlacement("kpis", kpis, 0, 1, true).rowSpan).toBe(2);
    expect(nudgeGridPlacement("kpis", kpis, 0, -1, true).rowSpan).toBe(1);
  });
});

describe("drag constants", () => {
  it("keep a small dead-zone so a click stays a click", () => {
    expect(HERO_GRID_DRAG_DEAD_ZONE).toBeGreaterThan(0);
    expect(HERO_GRID_DRAG_DEAD_ZONE).toBeLessThan(10);
  });
});
