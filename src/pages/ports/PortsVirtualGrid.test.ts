import { describe, expect, it } from "vitest";

import type { PortGameGroup } from "./portGroups";
import {
  buildRows,
  cardHeightForContainer,
  cardWidthForContainer,
  columnsForWidth,
  HEADER_HEIGHT,
  OVERSCAN_ROWS,
  SECTION_GAP,
  shouldVirtualize,
  visibleRows,
  VIRTUALIZE_THRESHOLD,
  type PortsVirtualSection,
  type VirtualRow,
} from "./PortsVirtualGrid";

/** Groups are opaque to the layout helpers, so the key is all they need. */
function group(key: string): PortGameGroup {
  return { key } as PortGameGroup;
}

function section(
  key: string,
  label: string,
  count: number,
  accent?: string
): PortsVirtualSection {
  return {
    key,
    label,
    accent,
    groups: Array.from({ length: count }, (_, index) => group(`${key}-${index}`)),
  };
}

function tops(rows: VirtualRow[]): number[] {
  return rows.map((row) => row.top);
}

const CARD_H = 400;

describe("buildRows", () => {
  it("emits a 44px header, card rows and section gaps", () => {
    const rows = buildRows(
      [section("n64", "Nintendo 64", 3, "#ff0000"), section("psx", "PlayStation", 1)],
      2,
      CARD_H,
      HEADER_HEIGHT,
      SECTION_GAP
    );

    expect(rows.map((row) => row.kind)).toEqual(["header", "cards", "cards", "header", "cards"]);
    // header 44, gap 18, two card rows of 400, section gap 32.
    expect(tops(rows)).toEqual([0, 62, 480, 912, 974]);
    expect(rows.map((row) => row.height)).toEqual([44, CARD_H, CARD_H, 44, CARD_H]);

    // Column slicing preserves order and fills each row.
    expect(rows[1].groups?.map((entry) => entry.key)).toEqual(["n64-0", "n64-1"]);
    expect(rows[2].groups?.map((entry) => entry.key)).toEqual(["n64-2"]);
    expect(rows[4].groups?.map((entry) => entry.key)).toEqual(["psx-0"]);

    // Header metadata feeds the shared `.ports-section__head` markup.
    expect(rows[0]).toMatchObject({
      sectionKey: "n64",
      label: "Nintendo 64",
      accent: "#ff0000",
      count: 3,
    });

    // Total spacer height.
    expect(rows[rows.length - 1].top + rows[rows.length - 1].height).toBe(1374);
  });

  it("starts the first card row at the top when a section has no label", () => {
    const rows = buildRows([section("all", "", 2)], 2, CARD_H, HEADER_HEIGHT, SECTION_GAP);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "cards", top: 0, height: CARD_H, sectionKey: "all" });
    expect(rows[0].label).toBeUndefined();
    expect(rows[0].groups).toHaveLength(2);
  });

  it("does not leave a gap for empty sections", () => {
    const rows = buildRows(
      [section("a", "A", 1), section("empty", "Empty", 0), section("b", "B", 1)],
      2,
      CARD_H,
      HEADER_HEIGHT,
      SECTION_GAP
    );

    expect(rows.map((row) => row.sectionKey)).toEqual(["a", "a", "b", "b"]);
    // a header 0, a cards 62, then +400 +32 -> b header 494.
    expect(tops(rows)).toEqual([0, 62, 494, 556]);
  });

  it("returns no rows when every section is empty", () => {
    expect(
      buildRows(
        [section("a", "A", 0), section("b", "B", 0)],
        3,
        CARD_H,
        HEADER_HEIGHT,
        SECTION_GAP
      )
    ).toEqual([]);
  });

  it("clamps a nonsensical column count to at least one", () => {
    const rows = buildRows([section("a", "A", 2)], 0, CARD_H, HEADER_HEIGHT, SECTION_GAP);
    const cardRows = rows.filter((row) => row.kind === "cards");

    expect(cardRows).toHaveLength(2);
    expect(cardRows[0].groups).toHaveLength(1);
  });

  it("honours the column count when it exceeds the group count", () => {
    const rows = buildRows([section("a", "A", 2)], 6, CARD_H, HEADER_HEIGHT, SECTION_GAP);
    expect(rows.filter((row) => row.kind === "cards")).toHaveLength(1);
    expect(rows[1].groups).toHaveLength(2);
  });
});

describe("visibleRows", () => {
  const rows = buildRows(
    [section("a", "A", 60), section("b", "B", 20)],
    4,
    CARD_H,
    HEADER_HEIGHT,
    SECTION_GAP
  );

  it("returns only rows intersecting the viewport plus overscan", () => {
    const viewport = 800;
    const visible = visibleRows(rows, 1000, viewport, OVERSCAN_ROWS);
    const firstVisibleBottom = rows.findIndex((row) => row.top + row.height >= 1000);
    let lastVisible = -1;
    rows.forEach((row, index) => {
      if (row.top <= 1000 + viewport) lastVisible = index;
    });

    expect(visible[0]).toBe(rows[firstVisibleBottom - OVERSCAN_ROWS]);
    expect(visible[visible.length - 1]).toBe(rows[lastVisible + OVERSCAN_ROWS]);
    // Includes both header rows? Only if they fall into the window; assert the
    // window is a contiguous slice instead.
    expect(visible).toEqual(
      rows.slice(firstVisibleBottom - OVERSCAN_ROWS, lastVisible + OVERSCAN_ROWS + 1)
    );
  });

  it("returns only the intersecting row when overscan is zero", () => {
    const visible = visibleRows(rows, 100, 300, 0);
    expect(visible).toEqual([rows[1]]);
  });

  it("returns rows bracketing a point that falls inside a row gap", () => {
    // Header ends at 44, the first card row starts at 62: 50 sits in the gap.
    const visible = visibleRows(rows, 50, 0, 0);
    expect(visible).toEqual([rows[0], rows[1]]);
  });

  it("returns nothing for an empty timeline", () => {
    expect(visibleRows([], 0, 1000, OVERSCAN_ROWS)).toEqual([]);
  });

  it("keeps the last rows reachable at the bottom of the timeline", () => {
    const totalHeight = rows[rows.length - 1].top + rows[rows.length - 1].height;
    const visible = visibleRows(rows, totalHeight - 400, 400, OVERSCAN_ROWS);

    expect(visible[visible.length - 1]).toBe(rows[rows.length - 1]);
    expect(visible.length).toBeLessThanOrEqual(OVERSCAN_ROWS * 2 + 2);
  });
});

describe("column and card geometry", () => {
  it("fits as many 178px cards as the width allows with 16px gaps", () => {
    // (1000 + 16) / (178 + 16) = 5.23 -> 5 columns.
    expect(columnsForWidth(1000)).toBe(5);
    expect(columnsForWidth(0)).toBe(1);
    expect(columnsForWidth(150)).toBe(1);
    expect(cardWidthForContainer(1000, 5)).toBeCloseTo(187.2, 5);
  });

  it("derives a deterministic height from the resolved card width", () => {
    // Card 238 wide -> 238 * 1.5 + 106 = 463.
    expect(cardWidthForContainer(1000, 4)).toBe(238);
    expect(cardHeightForContainer(1000, 4)).toBe(463);
  });
});

describe("shouldVirtualize", () => {
  it("keeps small or unmeasured result sets fully mounted", () => {
    expect(shouldVirtualize(VIRTUALIZE_THRESHOLD - 1, 1400)).toBe(false);
    expect(shouldVirtualize(VIRTUALIZE_THRESHOLD, 0)).toBe(false);
    expect(shouldVirtualize(500, 0)).toBe(false);
  });

  it("windows large measured result sets", () => {
    expect(shouldVirtualize(VIRTUALIZE_THRESHOLD, 1400)).toBe(true);
    expect(shouldVirtualize(5000, 1400)).toBe(true);
  });
});
