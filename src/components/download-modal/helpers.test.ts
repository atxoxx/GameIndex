import { describe, it, expect } from "vitest";
import { filterMatches, sortMatches } from "./helpers";
import type { DisplayMatch } from "./types";

function match(overrides: Partial<DisplayMatch>): DisplayMatch {
  return {
    sourceName: "Source",
    sourceId: "s",
    title: "Game",
    fileSize: "1 GB",
    uris: [],
    magnet: null,
    uploadDate: null,
    matchScore: 0.8,
    isNew: false,
    provider: "source",
    id: "id",
    ...overrides,
  };
}

describe("filterMatches token search", () => {
  const list = [
    match({ id: "a", title: "Elden Ring [FitGirl Repack]" }),
    match({ id: "b", title: "Dark Souls III" }),
  ];

  it("requires every token, in any order", () => {
    expect(filterMatches(list, "all", "ring elden").map((m) => m.id)).toEqual(["a"]);
    expect(filterMatches(list, "all", "elden souls").length).toBe(0);
  });

  it("matches across diacritics and punctuation", () => {
    const pk = [match({ id: "p", title: "Pokémon: Legends" })];
    expect(filterMatches(pk, "all", "pokemon").map((m) => m.id)).toEqual(["p"]);
    expect(filterMatches(pk, "all", "legends pokemon").map((m) => m.id)).toEqual(["p"]);
  });

  it("is neutral for a blank query", () => {
    expect(filterMatches(list, "all", "   ").length).toBe(2);
  });
});

describe("sortMatches recommended", () => {
  it("orders by the injected recommendation score", () => {
    const list = [
      match({ id: "x", matchScore: 0.9 }),
      match({ id: "y", matchScore: 0.5 }),
    ];
    const scores: Record<string, number> = { x: 0.1, y: 0.9 };
    const sorted = sortMatches(list, "recommended", false, (m) => scores[m.id] ?? 0);
    expect(sorted.map((m) => m.id)).toEqual(["y", "x"]);
  });
});
