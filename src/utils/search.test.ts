import { describe, it, expect } from "vitest";
import {
  foldSearchText,
  parseSearchQuery,
  tokenizeSearchQuery,
  searchTokensEqual,
  searchTokenMatches,
  searchTextMatches,
  scoreSearchMatch,
  getSearchMatchRanges,
  getSearchHighlightSegments,
  levenshteinDistance,
  levenshteinWithin,
  numberToRoman,
  romanToNumber,
} from "./search";

describe("foldSearchText", () => {
  it("lowercases, strips diacritics and collapses punctuation", () => {
    expect(foldSearchText("Pokémon: Arceus-Legends")).toBe("pokemon arceus legends");
  });

  it("drops apostrophes so they don't split words", () => {
    expect(foldSearchText("Assassin's Creed")).toBe("assassins creed");
    expect(foldSearchText("Tom's")).toBe("toms");
    expect(foldSearchText("Rock ’n’ Roll")).toBe("rock n roll");
  });

  it("expands ligatures and sharps", () => {
    expect(foldSearchText("Straße")).toBe("strasse");
    expect(foldSearchText("Æon Flux")).toBe("aeon flux");
    expect(foldSearchText("Œuvre")).toBe("oeuvre");
  });

  it("maps ampersand and plus to words", () => {
    expect(foldSearchText("Rock & Roll")).toBe("rock and roll");
    expect(foldSearchText("R&B")).toBe("r and b");
    expect(foldSearchText("C++")).toBe("c plus plus");
  });

  it("keeps digits and normalizes fullwidth characters", () => {
    expect(foldSearchText("ＦＩＮＡＬ 7")).toBe("final 7");
  });

  it("is idempotent", () => {
    const once = foldSearchText("Pokémon & Co.");
    expect(foldSearchText(once)).toBe(once);
  });

  it("handles empty input", () => {
    expect(foldSearchText("")).toBe("");
    expect(foldSearchText(null)).toBe("");
  });
});

describe("parseSearchQuery / tokenizeSearchQuery", () => {
  it("splits words and keeps quoted phrases", () => {
    const parsed = parseSearchQuery('elden ring "shadow of the" fitgirl');
    expect(parsed.words.map((w) => w.text)).toEqual(["elden", "ring", "fitgirl"]);
    expect(parsed.phrases.map((p) => p.text)).toEqual(["shadow of the"]);
    expect(parsed.isEmpty).toBe(false);
  });

  it("treats blank input as empty", () => {
    expect(parseSearchQuery("   ").isEmpty).toBe(true);
    expect(parseSearchQuery(null).isEmpty).toBe(true);
  });

  it("tokenizes a folded query", () => {
    expect(tokenizeSearchQuery("Pokémon & Co")).toEqual(["pokemon", "and", "co"]);
    expect(tokenizeSearchQuery("   ")).toEqual([]);
  });
});

describe("roman numerals", () => {
  it("round-trips roman ↔ number", () => {
    expect(numberToRoman(5)).toBe("v");
    expect(numberToRoman(4)).toBe("iv");
    expect(numberToRoman(2077)).toBe("mmlxxvii");
    expect(romanToNumber("v")).toBe(5);
    expect(romanToNumber("VII")).toBe(7);
    expect(romanToNumber("iii")).toBe(3);
  });

  it("rejects non-canonical roman tokens", () => {
    expect(romanToNumber("iiii")).toBeNull();
    expect(romanToNumber("hello")).toBeNull();
    expect(romanToNumber("0")).toBeNull();
    expect(romanToNumber("")).toBeNull();
  });

  it("treats roman and arabic tokens as equivalent", () => {
    expect(searchTokensEqual("v", "5")).toBe(true);
    expect(searchTokensEqual("5", "v")).toBe(true);
    expect(searchTokensEqual("iii", "3")).toBe(true);
    expect(searchTokensEqual("vii", "8")).toBe(false);
  });
});

describe("searchTokenMatches", () => {
  it("matches exact and prefix tokens", () => {
    expect(searchTokenMatches("elden", "elden")).toBe(true);
    expect(searchTokenMatches("eld", "elden")).toBe(true);
  });

  it("tolerates small typos only for longer tokens", () => {
    expect(searchTokenMatches("witcher", "wtcher")).toBe(true);
    expect(searchTokenMatches("ed", "ex")).toBe(false);
  });

  it("respects roman/arabic equivalence", () => {
    expect(searchTokenMatches("5", "v")).toBe(true);
    expect(searchTokenMatches("iii", "3")).toBe(true);
  });
});

describe("searchTextMatches", () => {
  it("requires every token in any order across fields", () => {
    expect(searchTextMatches("fitgirl ring elden", ["Elden Ring [FitGirl Repack]"])).toBe(true);
    expect(searchTextMatches("fitgirl ring elden", ["Elden Ring"])).toBe(false);
  });

  it("matches tokens spread across separate fields", () => {
    expect(searchTextMatches("elden fitgirl", ["Elden Ring", "FitGirl"])).toBe(true);
  });

  it("does not let a token span a field boundary", () => {
    expect(searchTextMatches("ringfitgirl", ["Elden Rin", "gfitgirl"])).toBe(false);
  });

  it("honours quoted phrases", () => {
    expect(searchTextMatches('"shadow of the erdtree"', ["Elden Ring: Shadow of the Erdtree"])).toBe(true);
    expect(searchTextMatches('"shadow of the erdtree"', ["Elden Ring Shadow Erdtree"])).toBe(false);
  });

  it("matches across character variations", () => {
    expect(searchTextMatches("pokemon", ["Pokémon Violet"])).toBe(true);
    expect(searchTextMatches("assassins creed", ["Assassin's Creed Shadows"])).toBe(true);
    expect(searchTextMatches("gta 5", ["GTA V"])).toBe(true);
    expect(searchTextMatches("mafia 3", ["Mafia III"])).toBe(true);
    expect(searchTextMatches("final fantasy 7", ["Final Fantasy VII"])).toBe(true);
    expect(searchTextMatches("rock and roll", ["Rock & Roll Racing"])).toBe(true);
  });

  it("is empty-query neutral", () => {
    expect(searchTextMatches("", ["anything"])).toBe(true);
    expect(searchTextMatches("", [null, undefined])).toBe(true);
  });
});

describe("scoreSearchMatch", () => {
  it("ranks exact above prefix above substring", () => {
    const exact = scoreSearchMatch("hades", "Hades");
    const prefix = scoreSearchMatch("had", "Hades");
    const substring = scoreSearchMatch("ades", "Hades");
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(0);
  });

  it("scores word-boundary hits highly", () => {
    expect(scoreSearchMatch("witcher", "The Witcher 3: Wild Hunt")).toBeGreaterThan(900);
  });

  it("matches roman and arabic numerals", () => {
    expect(scoreSearchMatch("gta 5", "GTA V")).toBeGreaterThan(0);
    expect(scoreSearchMatch("5", "V Rising")).toBeGreaterThan(0);
  });

  it("returns -1 for no match and 0 for empty query", () => {
    expect(scoreSearchMatch("zzzz", "Hades")).toBe(-1);
    expect(scoreSearchMatch("", "Hades")).toBe(0);
  });

  it("considers extra terms", () => {
    expect(scoreSearchMatch("fromsoftware", "Elden Ring", ["FromSoftware"])).toBeGreaterThan(0);
  });
});

describe("getSearchMatchRanges / getSearchHighlightSegments", () => {
  it("returns merged ranges mapped to the original string", () => {
    const ranges = getSearchMatchRanges("Elden Ring Deluxe", "elden ring");
    expect(ranges).toEqual([
      { start: 0, end: 5 },
      { start: 6, end: 10 },
    ]);
  });

  it("aligns ranges across diacritics and punctuation", () => {
    const segments = getSearchHighlightSegments("Pokémon Deluxe", "pokemon");
    expect(segments).toEqual([
      { text: "Pokémon", highlight: true },
      { text: " Deluxe", highlight: false },
    ]);
  });

  it("aligns ranges across apostrophes", () => {
    const segments = getSearchHighlightSegments("Assassin's Creed", "assassins");
    expect(segments[0]).toEqual({ text: "Assassin's", highlight: true });
  });

  it("returns a single plain segment when nothing matches", () => {
    expect(getSearchHighlightSegments("Hello", "zzz")).toEqual([{ text: "Hello", highlight: false }]);
  });
});

describe("levenshtein", () => {
  it("computes distances", () => {
    expect(levenshteinDistance("witcher", "witcher")).toBe(0);
    expect(levenshteinDistance("witcher", "wtcher")).toBe(1);
    expect(levenshteinDistance("witcher", "wither")).toBe(1);
  });

  it("bounds distances", () => {
    expect(levenshteinWithin("elden", "eldrn", 1)).toBe(true);
    expect(levenshteinWithin("elden", "xxxxx", 1)).toBe(false);
  });
});
