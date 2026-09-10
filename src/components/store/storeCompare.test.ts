import { beforeEach, describe, expect, it } from "vitest";
import type { StoreGameSummary } from "../../types/game";
import {
  COMPARE_MAX,
  addToCompareList,
  bestIndexes,
  loadCompareGames,
  removeFromCompareList,
  saveCompareGames,
  sharedValues,
  toggleInCompareList,
  type CompareRow,
} from "./storeCompare";

function game(slug: string, extra: Partial<StoreGameSummary> = {}): StoreGameSummary {
  return {
    id: 0,
    name: slug,
    slug,
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
    ...extra,
  };
}

describe("compare set mutations", () => {
  it("adds new games and reports duplicates", () => {
    const a = game("a");
    const first = addToCompareList([], a);
    expect(first.rejected).toBeNull();
    expect(first.list).toEqual([a]);

    const duplicate = addToCompareList(first.list, a);
    expect(duplicate.rejected).toBe("duplicate");
    expect(duplicate.list).toBe(first.list);
  });

  it("rejects additions past the cap", () => {
    const list = [game("a"), game("b"), game("c"), game("d")];
    const overflow = addToCompareList(list, game("e"));
    expect(overflow.rejected).toBe("limit");
    expect(overflow.list).toBe(list);
    expect(list.length).toBe(COMPARE_MAX);
  });

  it("toggles a game on and back off", () => {
    const a = game("a");
    const added = toggleInCompareList([], a);
    expect(added.list.map((g) => g.slug)).toEqual(["a"]);

    const removed = toggleInCompareList(added.list, a);
    expect(removed.rejected).toBeNull();
    expect(removed.list).toEqual([]);
  });

  it("drops games by slug", () => {
    const list = [game("a"), game("b"), game("c")];
    expect(removeFromCompareList(list, "b").map((g) => g.slug)).toEqual(["a", "c"]);
    expect(removeFromCompareList(list, "missing")).toEqual(list);
  });
});

describe("compare set persistence", () => {
  const backing = new Map<string, string>();

  beforeEach(() => {
    backing.clear();
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => backing.get(key) ?? null,
        setItem: (key: string, value: string) => backing.set(key, String(value)),
        removeItem: (key: string) => backing.delete(key),
        clear: () => backing.clear(),
        key: () => null,
        length: 0,
      },
    });
  });

  it("round-trips the pinned set", () => {
    const list = [game("a", { rating: 90 }), game("b")];
    saveCompareGames(list);
    expect(loadCompareGames().map((g) => g.slug)).toEqual(["a", "b"]);
  });

  it("normalizes garbage and oversized payloads", () => {
    sessionStorage.setItem("gamelib_store_compare_v1", "not json");
    expect(loadCompareGames()).toEqual([]);

    sessionStorage.setItem(
      "gamelib_store_compare_v1",
      JSON.stringify([
        { slug: "a", name: "A" },
        game("b"),
        game("b"),
        { slug: "", name: "" },
        null,
      ])
    );
    expect(loadCompareGames().map((g) => g.slug)).toEqual(["a", "b"]);
  });
});

describe("compare row scoring", () => {
  const ratingRow: CompareRow = {
    key: "rating",
    label: "Rating",
    better: "high",
    value: (g) => g.rating,
  };

  it("flags every highest value and ignores ties for all-equal rows", () => {
    const games = [
      game("a", { rating: 92 }),
      game("b", { rating: 95 }),
      game("c", { rating: 95 }),
    ];
    expect([...bestIndexes(games, ratingRow)]).toEqual([1, 2]);

    const tied = [game("a", { rating: 80 }), game("b", { rating: 80 })];
    expect(bestIndexes(tied, ratingRow).size).toBe(0);
  });

  it("does not rank text rows and needs two values", () => {
    const textRow: CompareRow = { key: "summary", label: "Summary", value: (g) => g.summary };
    expect(bestIndexes([game("a", { rating: 90 })], textRow).size).toBe(0);
    expect(bestIndexes([game("a", { rating: 90 })], ratingRow).size).toBe(0);
  });
});

describe("shared list values", () => {
  it("keeps only values present in every game", () => {
    const games = [
      game("a", { genres: ["Action", "RPG"] }),
      game("b", { genres: ["RPG", "Adventure"] }),
      game("c", { genres: ["RPG"] }),
    ];
    expect([...sharedValues(games, (g) => g.genres)]).toEqual(["RPG"]);
  });

  it("returns nothing for fewer than two games or an empty list", () => {
    const games = [game("a", { genres: ["Action"] }), game("b", { genres: [] })];
    expect(sharedValues([games[0]], (g) => g.genres).size).toBe(0);
    expect(sharedValues(games, (g) => g.genres).size).toBe(0);
  });
});
