import { describe, it, expect } from "vitest";
import {
  parseQuery,
  matchesQuery,
  foldSearchText,
  highlightRanges,
  highlightSegments,
} from "./searchQuery";

describe("parseQuery", () => {
  it("splits words and keeps quoted phrases", () => {
    const parsed = parseQuery('elden ring "shadow of the" fitgirl');
    expect(parsed.words.map((w) => w.text)).toEqual(["elden", "ring", "fitgirl"]);
    expect(parsed.phrases.map((p) => p.text)).toEqual(["shadow of the"]);
    expect(parsed.isEmpty).toBe(false);
  });

  it("treats blank input as empty", () => {
    expect(parseQuery("   ").isEmpty).toBe(true);
    expect(parseQuery(null).isEmpty).toBe(true);
  });
});

describe("foldSearchText", () => {
  it("lowercases, strips diacritics, and collapses punctuation", () => {
    expect(foldSearchText("Pokémon: Arceus-Legends")).toBe("pokemon arceus legends");
  });
});

describe("matchesQuery", () => {
  it("requires every token, in any order, across fields", () => {
    const parsed = parseQuery("fitgirl ring elden");
    expect(matchesQuery(parsed, ["Elden Ring [FitGirl Repack]"])).toBe(true);
    expect(matchesQuery(parsed, ["Elden Ring"])).toBe(false);
  });

  it("matches tokens spread across separate fields", () => {
    const parsed = parseQuery("elden fitgirl");
    expect(matchesQuery(parsed, ["Elden Ring", "FitGirl"])).toBe(true);
  });

  it("does not let a token span a field boundary", () => {
    const parsed = parseQuery("ringfitgirl");
    expect(matchesQuery(parsed, ["Elden Rin", "gfitgirl"])).toBe(false);
  });

  it("honours quoted phrases", () => {
    const parsed = parseQuery('"shadow of the erdtree"');
    expect(matchesQuery(parsed, ["Elden Ring: Shadow of the Erdtree"])).toBe(true);
    expect(matchesQuery(parsed, ["Elden Ring Shadow Erdtree"])).toBe(false);
  });

  it("is empty-query neutral", () => {
    expect(matchesQuery(parseQuery(""), ["anything"])).toBe(true);
  });
});

describe("highlightRanges / highlightSegments", () => {
  it("returns merged ranges mapped to the original string", () => {
    const parsed = parseQuery("elden ring");
    const ranges = highlightRanges("Elden Ring Deluxe", parsed);
    expect(ranges).toEqual([
      { start: 0, end: 5 },
      { start: 6, end: 10 },
    ]);
  });

  it("aligns ranges across diacritics and punctuation", () => {
    const parsed = parseQuery("pokemon");
    const segments = highlightSegments("Pokémon Deluxe", parsed);
    expect(segments).toEqual([
      { text: "Pokémon", highlight: true },
      { text: " Deluxe", highlight: false },
    ]);
  });

  it("returns a single plain segment when nothing matches", () => {
    const segments = highlightSegments("Hello", parseQuery("zzz"));
    expect(segments).toEqual([{ text: "Hello", highlight: false }]);
  });
});
