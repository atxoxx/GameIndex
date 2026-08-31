import { describe, it, expect, beforeEach } from "vitest";
import {
  evaluateExpression,
  getMatchRanges,
  parseQueryFilters,
  scoreMatch,
  getRecentItems,
  saveRecentItem,
  deleteRecentItem,
  clearRecentItems,
} from "./commandPaletteUtils";

describe("commandPaletteUtils", () => {
  describe("parseQueryFilters", () => {
    it("parses empty queries", () => {
      const parsed = parseQueryFilters("");
      expect(parsed.cleanQuery).toBe("");
    });

    it("parses power tokens for status", () => {
      const parsed = parseQueryFilters("is:installed is:cloud is:running is:wishlist cyberpunk");
      expect(parsed.isInstalled).toBe(true);
      expect(parsed.isCloud).toBe(true);
      expect(parsed.isRunning).toBe(true);
      expect(parsed.isWishlisted).toBe(true);
      expect(parsed.cleanQuery).toBe("cyberpunk");
    });

    it("parses source tokens", () => {
      const parsed = parseQueryFilters("source:steam witcher 3");
      expect(parsed.source).toBe("steam");
      expect(parsed.cleanQuery).toBe("witcher 3");
    });

    it("parses genre and tag tokens", () => {
      const parsed = parseQueryFilters("genre:rpg tag:cyberpunk elden ring");
      expect(parsed.genre).toBe("rpg");
      expect(parsed.tag).toBe("cyberpunk");
      expect(parsed.cleanQuery).toBe("elden ring");
    });

    it("parses year comparisons", () => {
      const p1 = parseQueryFilters("year:>2020 doom");
      expect(p1.year).toBe(2020);
      expect(p1.yearOp).toBe(">");
      expect(p1.cleanQuery).toBe("doom");

      const p2 = parseQueryFilters("year:<2015 skyrim");
      expect(p2.year).toBe(2015);
      expect(p2.yearOp).toBe("<");
      expect(p2.cleanQuery).toBe("skyrim");

      const p3 = parseQueryFilters("year:2023 baldur");
      expect(p3.year).toBe(2023);
      expect(p3.yearOp).toBe("=");
      expect(p3.cleanQuery).toBe("baldur");
    });
  });

  describe("scoreMatch & getMatchRanges", () => {
    it("returns high score for exact match", () => {
      const score = scoreMatch("witcher", "The Witcher 3: Wild Hunt");
      expect(score).toBeGreaterThan(50);
    });

    it("matches multi-tokens out of order", () => {
      const score = scoreMatch("hunt wild witcher", "The Witcher 3: Wild Hunt");
      expect(score).toBeGreaterThan(0);
    });

    it("calculates non-overlapping match ranges", () => {
      const ranges = getMatchRanges("Cyberpunk 2077", "cyber 2077");
      expect(ranges.length).toBeGreaterThanOrEqual(1);
      ranges.forEach((r) => {
        expect(r.start).toBeLessThan(r.end);
      });
    });
  });

  describe("evaluateExpression (Calculator & Unit Converter)", () => {
    it("evaluates arithmetic expressions", () => {
      const res1 = evaluateExpression("1440 * 2560");
      expect(res1).not.toBeNull();
      // Replace non-breaking spaces or commas
      expect(res1?.result.replace(/[\s\u202f,]/g, "")).toBe("3686400");

      expect(evaluateExpression("100 + 25 * 4")?.result).toBe("200");
      expect(evaluateExpression("2 ^ 10")?.result.replace(/[\s\u202f,]/g, "")).toBe("1024");
      expect(evaluateExpression("15% * 80")?.result).toBe("12");
    });

    it("converts data storage units", () => {
      const res = evaluateExpression("45 gb in mb");
      expect(res).not.toBeNull();
      expect(res?.result).toContain("45000 MB");

      const res2 = evaluateExpression("2048 mib to gib");
      expect(res2).not.toBeNull();
      expect(res2?.result).toContain("2 GIB");
    });

    it("converts frame rate and frame times", () => {
      const fpsRes = evaluateExpression("144 fps to ms");
      expect(fpsRes).not.toBeNull();
      expect(fpsRes?.result).toBe("6.94 ms");
      expect(fpsRes?.details).toContain("144 FPS");

      const msRes = evaluateExpression("16.6 ms to fps");
      expect(msRes).not.toBeNull();
      expect(msRes?.result).toBe("60.2 FPS");
    });

    it("ignores non-math input", () => {
      expect(evaluateExpression("cyberpunk 2077")).toBeNull();
      expect(evaluateExpression("open library")).toBeNull();
      expect(evaluateExpression("hello")).toBeNull();
    });
  });

  describe("frecency & history persistence", () => {
    beforeEach(() => {
      clearRecentItems();
    });

    it("saves and retrieves recent items", () => {
      saveRecentItem("game-1", "Hades II", "games");
      saveRecentItem("game-2", "Elden Ring", "games");

      const recents = getRecentItems();
      expect(recents.length).toBe(2);
      expect(recents[0].id).toBe("game-2");
      expect(recents[0].title).toBe("Elden Ring");
    });

    it("deletes recent items", () => {
      saveRecentItem("game-1", "Hades II", "games");
      saveRecentItem("game-2", "Elden Ring", "games");

      deleteRecentItem("game-1");
      const recents = getRecentItems();
      expect(recents.length).toBe(1);
      expect(recents[0].id).toBe("game-2");
    });

    it("clears all recent items", () => {
      saveRecentItem("game-1", "Hades II", "games");
      clearRecentItems();
      expect(getRecentItems().length).toBe(0);
    });
  });
});
