import { describe, expect, it } from "vitest";
import {
  applyReleaseYearAdjustment,
  bestTitleSimilarity,
  cleanSearchQuery,
  normalizeTitle,
  titleSimilarity,
} from "./scoring";

describe("normalizeTitle", () => {
  it("folds accents, punctuation, trademarks and edition noise", () => {
    expect(normalizeTitle("Pokémon™ — Definitive Edition")).toBe("pokemon");
    expect(normalizeTitle("Assassin's Creed: Brotherhood")).toBe(
      "assassins creed brotherhood",
    );
  });

  it("keeps subtitles but drops release-container tags", () => {
    expect(normalizeTitle("Call of Duty: Modern Warfare")).toBe(
      "call duty modern warfare",
    );
    expect(normalizeTitle("Doom (2016) FitGirl Repack x265 1080p")).toBe("doom");
  });

  it("keeps a bare year that belongs to the title", () => {
    expect(normalizeTitle("Battlefield 2042")).toBe("battlefield 2042");
    expect(normalizeTitle("Football Manager 2024")).toBe("football manager 2024");
  });
});

describe("titleSimilarity", () => {
  it("scores an exact title higher than a subtitle-only sibling", () => {
    const exact = titleSimilarity("Call of Duty", "Call of Duty");
    const sibling = titleSimilarity(
      "Call of Duty",
      "Call of Duty: Modern Warfare",
    );
    expect(exact).toBe(1);
    expect(sibling).toBeGreaterThan(0.8);
    expect(sibling).toBeLessThan(exact);
  });

  it("treats roman and arabic numerals as the same value", () => {
    expect(titleSimilarity("GTA V", "GTA 5")).toBeGreaterThan(0.9);
    expect(titleSimilarity("Mafia III", "Mafia 3")).toBeGreaterThan(0.9);
  });

  it("expands common acronyms", () => {
    expect(titleSimilarity("GTA", "Grand Theft Auto V")).toBeGreaterThan(0.85);
    expect(titleSimilarity("COD", "Call of Duty: Modern Warfare")).toBeGreaterThan(
      0.85,
    );
    expect(titleSimilarity("GTA V", "Grand Theft Auto V")).toBeGreaterThan(0.85);
  });

  it("rejects the wrong sequel number instead of ranking it above the right one", () => {
    const right = titleSimilarity("Doom 2", "Doom 2");
    const wrong = titleSimilarity("Doom 2", "Doom 3");
    expect(right).toBe(1);
    expect(wrong).toBeLessThan(0.2);
  });

  it("treats a bracketed year as a release hint, not a required word", () => {
    expect(titleSimilarity("Stellar Odyssey (2020)", "Stellar Odyssey")).toBe(1);
  });

  it("down-ranks a title whose year conflicts with the requested one", () => {
    const same = titleSimilarity("Football Manager 2024", "Football Manager 2024");
    const different = titleSimilarity(
      "Football Manager 2024",
      "Football Manager 2023",
    );
    expect(same).toBe(1);
    expect(different).toBeLessThan(0.35);
  });

  it("keeps a localized alias competitive through bestTitleSimilarity", () => {
    const score = bestTitleSimilarity(
      "The Witcher 3",
      ["Wiedźmin 3: Dziki Gon"],
      "Wiedźmin 3: Dziki Gon",
    );
    expect(score).toBe(1);
  });

  it("does not let a one-word title collide through fuzzy matching", () => {
    expect(titleSimilarity("Portal", "Postal")).toBeLessThan(0.7);
  });
});

describe("applyReleaseYearAdjustment", () => {
  it("rewards a matching release year and penalises a conflict", () => {
    expect(applyReleaseYearAdjustment(0.6, "Doom (2016)", 2016)).toBeCloseTo(
      0.68,
    );
    expect(applyReleaseYearAdjustment(0.6, "Doom (2016)", 1993)).toBeCloseTo(
      0.48,
    );
  });

  it("leaves a title without a year untouched", () => {
    expect(applyReleaseYearAdjustment(0.6, "Doom", 2016)).toBe(0.6);
  });
});

describe("cleanSearchQuery", () => {
  it("builds the short upstream fallback for verbose release names", () => {
    expect(cleanSearchQuery("ELDEN RING™ (2022) Deluxe v3")).toBe("ELDEN RING");
    expect(cleanSearchQuery("Hollow Knight")).toBeNull();
  });
});
