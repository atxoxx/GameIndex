import { describe, it, expect } from "vitest";
import {
  filterMatches,
  mergeDuplicateResults,
  sortMatches,
} from "./helpers";
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

  it("sorts plugin results by the chosen key while keeping them grouped last", () => {
    const list = [
      match({ id: "s1", provider: "source", fileSize: "1 GB" }),
      match({ id: "p1", provider: "plugin", fileSize: "5 GB" }),
      match({ id: "p2", provider: "plugin", fileSize: "40 GB" }),
    ];
    const sorted = sortMatches(list, "size_desc", false);
    expect(sorted.map((m) => m.id)).toEqual(["s1", "p2", "p1"]);
  });
});


describe("mergeDuplicateResults", () => {
  it("merges rows with the same infohash and unions mirrors", () => {
    const merged = mergeDuplicateResults([
      match({ id: "a", infohash: "ABC", uris: ["magnet:a"], matchScore: 0.5 }),
      match({ id: "b", infohash: "abc ", uris: ["magnet:b"], matchScore: 0.7 }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].matchScore).toBe(0.7);
    expect(merged[0].uris).toEqual(["magnet:b", "magnet:a"]);
    expect(merged[0].mirrorCount).toBe(2);
  });

  it("merges same-title rows across provider without an infohash", () => {
    const merged = mergeDuplicateResults([
      match({ id: "a", title: "Elden Ring", matchScore: 0.8 }),
      match({ id: "b", title: "elden.ring", matchScore: 0.6, provider: "plugin" }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].matchScore).toBe(0.8);
    expect(merged[0].mirrorCount).toBe(2);
  });

  it("keeps different games apart", () => {
    const merged = mergeDuplicateResults([
      match({ id: "a", title: "Elden Ring" }),
      match({ id: "b", title: "Farming Simulator 22" }),
    ]);
    expect(merged).toHaveLength(2);
  });

  it("adopts swarm and verification data the winner lacks", () => {
    const merged = mergeDuplicateResults([
      match({ id: "a", title: "Elden Ring", matchScore: 0.9 }),
      match({
        id: "b", title: "Elden_RING", matchScore: 0.4,
        seeds: 42, peers: 5, verified: true,
      }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].seeds).toBe(42);
    expect(merged[0].peers).toBe(5);
    expect(merged[0].verified).toBe(true);
  });
});
