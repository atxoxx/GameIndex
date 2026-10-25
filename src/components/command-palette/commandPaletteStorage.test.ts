import { beforeEach, describe, expect, it } from "vitest";
import {
  clearPinnedItems,
  clearRecentQueries,
  deleteRecentQuery,
  getPinnedItems,
  getRecentQueries,
  isPinnedItem,
  itemHasDrawerActions,
  saveRecentQuery,
  togglePinnedItem,
} from "./commandPaletteUtils";
import type { PaletteItem } from "./commandPaletteTypes";

describe("command palette pins", () => {
  beforeEach(() => {
    localStorage.clear();
    clearPinnedItems();
  });

  it("pins an item and reports its state", () => {
    expect(isPinnedItem("game-1")).toBe(false);

    const nowPinned = togglePinnedItem({
      id: "game-1",
      category: "games",
      title: "Elden Ring",
    });

    expect(nowPinned).toBe(true);
    expect(isPinnedItem("game-1")).toBe(true);
    expect(getPinnedItems()).toHaveLength(1);
    expect(getPinnedItems()[0]).toMatchObject({
      id: "game-1",
      category: "games",
      title: "Elden Ring",
    });
  });

  it("unpins an already pinned item", () => {
    togglePinnedItem({ id: "nav-/library", category: "navigation", title: "Library" });

    const nowPinned = togglePinnedItem({
      id: "nav-/library",
      category: "navigation",
      title: "Library",
    });

    expect(nowPinned).toBe(false);
    expect(getPinnedItems()).toHaveLength(0);
  });

  it("keeps the newest pin first and ignores corrupt storage", () => {
    togglePinnedItem({ id: "a", category: "actions", title: "A" });
    togglePinnedItem({ id: "b", category: "actions", title: "B" });
    expect(getPinnedItems().map((pin) => pin.id)).toEqual(["b", "a"]);

    localStorage.setItem("gamelib.command_palette_pins:v1", "{not json");
    expect(getPinnedItems()).toEqual([]);
  });
});

describe("recent command palette queries", () => {  beforeEach(() => {
    localStorage.clear();
    clearRecentQueries();
  });

  it("deduplicates and moves the newest query to the front", () => {
    saveRecentQuery("elden");
    saveRecentQuery("witcher");
    saveRecentQuery("elden");

    expect(getRecentQueries()).toEqual(["elden", "witcher"]);
  });

  it("ignores queries shorter than two characters", () => {
    saveRecentQuery("a");
    saveRecentQuery("   ");
    expect(getRecentQueries()).toEqual([]);
  });

  it("removes one query without touching the rest", () => {
    saveRecentQuery("elden");
    saveRecentQuery("witcher");
    deleteRecentQuery("elden");

    expect(getRecentQueries()).toEqual(["witcher"]);
  });
});

describe("drawer availability", () => {
  const base = { id: "x", category: "actions", title: "X", onSelect: () => {} } as PaletteItem;

  it("opens for games, store entries and calculator results", () => {
    expect(itemHasDrawerActions({ ...base, gameData: {} as never })).toBe(true);
    expect(itemHasDrawerActions({ ...base, storeData: {} as never })).toBe(true);
    expect(
      itemHasDrawerActions({
        ...base,
        calcData: { expression: "1+1", result: "2" },
      })
    ).toBe(true);
  });

  it("stays closed for pages, settings and empty selections", () => {
    expect(itemHasDrawerActions(base)).toBe(false);
    expect(itemHasDrawerActions(null)).toBe(false);
  });
});
