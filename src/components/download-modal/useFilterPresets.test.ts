import { describe, it, expect, beforeEach } from "vitest";
import {
  DEFAULT_FILTERS,
  loadLastFilters,
  saveLastFilters,
} from "./useFilterPresets";

describe("filter persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns defaults when nothing is stored", () => {
    expect(loadLastFilters()).toEqual(DEFAULT_FILTERS);
  });

  it("round-trips saved filters", () => {
    const filters = {
      ...DEFAULT_FILTERS,
      searchQuery: "elden",
      sortBy: "seeds" as const,
      updatesOnly: true,
    };
    saveLastFilters(filters);
    expect(loadLastFilters()).toEqual(filters);
  });

  it("merges partial stored state over defaults", () => {
    localStorage.setItem(
      "gamelib-download-last-filters",
      JSON.stringify({ searchQuery: "hades" }),
    );
    const loaded = loadLastFilters();
    expect(loaded.searchQuery).toBe("hades");
    expect(loaded.sortBy).toBe(DEFAULT_FILTERS.sortBy);
    expect(loaded.platformFilter).toBe(DEFAULT_FILTERS.platformFilter);
  });
});
