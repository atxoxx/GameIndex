import { describe, expect, it } from "vitest";
import type { StoreGameSummary } from "../types/game";
import { mergeStoreGamePages } from "./useStoreGames";

function game(id: number): StoreGameSummary {
  return {
    id,
    name: `Game ${id}`,
    slug: `game-${id}`,
    summary: null,
    rating: null,
    aggregatedRating: null,
    coverUrl: null,
    logoUrl: null,
    genres: [],
    platforms: [],
    firstReleaseDate: null,
    totalRatingCount: 0,
    hypes: 0,
  };
}

describe("mergeStoreGamePages", () => {
  it("appends a non-overlapping page in order", () => {
    const merged = mergeStoreGamePages([game(1), game(2)], [game(3), game(4)]);

    expect(merged.map((g) => g.id)).toEqual([1, 2, 3, 4]);
  });

  it("drops ids already on screen when a page overlaps", () => {
    // IGDB search offsets are not stable, so page 2 can repeat a row from
    // page 1 — the grid must never show the same card twice.
    const merged = mergeStoreGamePages(
      [game(1), game(2), game(3)],
      [game(3), game(4)]
    );

    expect(merged.map((g) => g.id)).toEqual([1, 2, 3, 4]);
  });

  it("keeps the first occurrence and drops duplicates inside one page", () => {
    const first = game(1);
    const merged = mergeStoreGamePages([first], [game(1), game(1), game(2)]);

    expect(merged.map((g) => g.id)).toEqual([1, 2]);
    expect(merged[0]).toBe(first);
  });

  it("returns the current array when the page adds nothing new", () => {
    const current = [game(1), game(2)];

    expect(mergeStoreGamePages(current, [game(2), game(1)])).toBe(current);
  });

  it("returns the current array when the page is empty", () => {
    const current = [game(1)];

    expect(mergeStoreGamePages(current, [])).toBe(current);
  });
});
