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
  calculateLibraryStats,
  levenshteinDistance,
  formatDurationSeconds,
  formatRelativeTime,
  formatSummaryParagraphs,
} from "./commandPaletteUtils";
import type { Game } from "../../types/game";

describe("commandPaletteUtils", () => {
  describe("parseQueryFilters", () => {
    it("parses empty queries", () => {
      const parsed = parseQueryFilters("");
      expect(parsed.cleanQuery).toBe("");
    });

    it("parses power tokens for status", () => {
      const parsed = parseQueryFilters(
        "is:installed is:cloud is:running is:wishlist is:fav is:unplayed is:untracked cyberpunk"
      );
      expect(parsed.isInstalled).toBe(true);
      expect(parsed.isCloud).toBe(true);
      expect(parsed.isRunning).toBe(true);
      expect(parsed.isWishlisted).toBe(true);
      expect(parsed.isFavorite).toBe(true);
      expect(parsed.isUnplayed).toBe(true);
      expect(parsed.isUntracked).toBe(true);
      expect(parsed.cleanQuery).toBe("cyberpunk");
    });

    it("parses leading scope prefixes", () => {
      expect(parseQueryFilters("@cyberpunk").cleanQuery).toBe("cyberpunk");
      expect(parseQueryFilters(">settings").cleanQuery).toBe("settings");
      expect(parseQueryFilters("!hades").cleanQuery).toBe("hades");
      expect(parseQueryFilters("~1440 * 2560").cleanQuery).toBe("1440 * 2560");
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

    it("parses rating, playtime, and size comparisons", () => {
      const parsed = parseQueryFilters("rating:>80 playtime:>10h size:>50gb sort:playtime doom");
      expect(parsed.rating).toBe(80);
      expect(parsed.ratingOp).toBe(">");
      expect(parsed.playtimeHours).toBe(10);
      expect(parsed.playtimeOp).toBe(">");
      expect(parsed.sizeBytes).toBe(50 * 1000 * 1000 * 1000);
      expect(parsed.sizeOp).toBe(">");
      expect(parsed.sort).toBe("playtime");
      expect(parsed.cleanQuery).toBe("doom");
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

    it("matches common game acronyms", () => {
      expect(scoreMatch("gow", "God of War Ragnarok")).toBeGreaterThan(500);
      expect(scoreMatch("rdr2", "Red Dead Redemption 2")).toBeGreaterThan(500);
      expect(scoreMatch("cp2077", "Cyberpunk 2077: Phantom Liberty")).toBeGreaterThan(500);
      expect(scoreMatch("bg3", "Baldur's Gate 3")).toBeGreaterThan(500);
    });

    it("tolerates minor typos in words", () => {
      expect(scoreMatch("cybrpnk", "Cyberpunk 2077")).toBeGreaterThan(0);
      expect(scoreMatch("witchr", "The Witcher 3: Wild Hunt")).toBeGreaterThan(0);
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
      expect(res1?.result.replace(/[\s\u202f,]/g, "")).toBe("3686400");

      expect(evaluateExpression("100 + 25 * 4")?.result).toBe("200");
      expect(evaluateExpression("2 ^ 10")?.result.replace(/[\s\u202f,]/g, "")).toBe("1024");
      expect(evaluateExpression("20% of 150")?.result).toBe("30");
    });

    it("estimates download times", () => {
      const res = evaluateExpression("80 gb at 100 mbps");
      expect(res).not.toBeNull();
      expect(res?.result).toContain("1 hr 46 min");
      expect(res?.calcType).toBe("download");

      const res2 = evaluateExpression("50 gb @ 20 mb/s");
      expect(res2).not.toBeNull();
      expect(res2?.result).toContain("41 min 40s");
    });

    it("calculates display resolution aspect ratio", () => {
      const res = evaluateExpression("2560x1440 ratio");
      expect(res).not.toBeNull();
      expect(res?.result).toContain("16:9");
      expect(res?.details).toContain("QHD");
      expect(res?.calcType).toBe("resolution");

      const res2 = evaluateExpression("3840x2160 ratio");
      expect(res2).not.toBeNull();
      expect(res2?.result).toContain("16:9");
      expect(res2?.details).toContain("4K");
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

  describe("calculateLibraryStats", () => {
    it("aggregates library data accurately", () => {
      const sampleGames: Game[] = [
        {
          id: "1",
          name: "Cyberpunk 2077",
          path: "C:\\Games\\Cyberpunk2077.exe",
          platform: "PC",
          addedAt: 1600000000,
          installed: true,
          favorite: true,
          sizeBytes: 70 * 1000 * 1000 * 1000,
          playTime: "120h",
        },
        {
          id: "2",
          name: "Elden Ring",
          path: "C:\\Games\\eldenring.exe",
          platform: "PC",
          addedAt: 1600000000,
          installed: true,
          favorite: false,
          sizeBytes: 50 * 1000 * 1000 * 1000,
          playTime: "85h",
        },
        {
          id: "3",
          name: "Hades",
          path: "C:\\Games\\Hades.exe",
          platform: "PC",
          addedAt: 1600000000,
          installed: false,
          favorite: false,
          sizeBytes: 15 * 1000 * 1000 * 1000,
          playTime: "0h",
        },
      ];

      const stats = calculateLibraryStats(sampleGames);
      expect(stats.totalGames).toBe(3);
      expect(stats.installedGames).toBe(2);
      expect(stats.favoriteCount).toBe(1);
      expect(stats.totalSizeBytes).toBe(135 * 1000 * 1000 * 1000);
      expect(stats.totalPlaytimeHours).toBe(205);
      expect(stats.topPlayedGame?.name).toBe("Cyberpunk 2077");
    });
  });

  describe("helper utilities", () => {
    it("calculates levenshtein distance", () => {
      expect(levenshteinDistance("witcher", "witcher")).toBe(0);
      expect(levenshteinDistance("witcher", "wtcher")).toBe(1);
      expect(levenshteinDistance("witcher", "wither")).toBe(1);
      expect(levenshteinDistance("elden", "eldrn")).toBe(1);
    });

    it("formats duration seconds nicely", () => {
      expect(formatDurationSeconds(45)).toBe("45 sec");
      expect(formatDurationSeconds(125)).toBe("2 min 5s");
      expect(formatDurationSeconds(3665)).toBe("1 hr 1 min");
    });
  });

  describe("Recent Items Storage", () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it("saves and retrieves recent items", () => {
      saveRecentItem("game-1", "Cyberpunk 2077", "games");
      saveRecentItem("act-home", "Go to Dashboard", "navigation");
      const recents = getRecentItems();
      const ids = recents.map((r) => r.id);
      expect(ids).toContain("act-home");
      expect(ids).toContain("game-1");
    });

    it("deletes individual and all recent items", () => {
      saveRecentItem("game-1", "Cyberpunk 2077", "games");
      saveRecentItem("game-2", "Elden Ring", "games");
      deleteRecentItem("game-1");
      const ids = getRecentItems().map((r) => r.id);
      expect(ids).not.toContain("game-1");
      expect(ids).toContain("game-2");

      clearRecentItems();
      expect(getRecentItems()).toHaveLength(0);
    });
  });

  describe("Expanded features & localization", () => {
    it("matches new popular gaming acronyms", () => {
      expect(scoreMatch("wukong", "Black Myth: Wukong")).toBeGreaterThan(500);
      expect(scoreMatch("hd2", "Helldivers 2")).toBeGreaterThan(500);
      expect(scoreMatch("sf6", "Street Fighter 6")).toBeGreaterThan(500);
      expect(scoreMatch("p3r", "Persona 3 Reload")).toBeGreaterThan(500);
      expect(scoreMatch("kcd", "Kingdom Come: Deliverance")).toBeGreaterThan(500);
    });

    it("parses negation filters and backlog token", () => {
      const p1 = parseQueryFilters("!installed cyberpunk");
      expect(p1.isCloud).toBe(true);
      expect(p1.cleanQuery).toBe("cyberpunk");

      const p2 = parseQueryFilters("-installed witcher");
      expect(p2.isCloud).toBe(true);

      const p3 = parseQueryFilters("is:backlog");
      expect(p3.isUnplayed).toBe(true);
    });

    it("formats relative time with localization support", () => {
      const now = Date.now();
      const oneDayAgo = now - 24 * 3600 * 1000;
      const formattedFr = formatRelativeTime(oneDayAgo, "fr");
      const formattedEn = formatRelativeTime(oneDayAgo, "en");

      expect(formattedFr).toBeDefined();
      expect(formattedEn).toBeDefined();
      expect(typeof formattedFr).toBe("string");
      expect(typeof formattedEn).toBe("string");
    });
  });

  describe("formatSummaryParagraphs", () => {
    it("returns empty array for empty or null inputs", () => {
      expect(formatSummaryParagraphs(null)).toEqual([]);
      expect(formatSummaryParagraphs(undefined)).toEqual([]);
      expect(formatSummaryParagraphs("")).toEqual([]);
    });

    it("unescapes HTML entities and normalizes spaces", () => {
      const input = "An &quot;epic&quot; story &amp; battle with aliens&#39; weapons &ndash; year 2026.";
      const result = formatSummaryParagraphs(input);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe('An "epic" story & battle with aliens\' weapons – year 2026.');
    });

    it("fixes missing space after ellipses before next words", () => {
      const input = "ancient evil bent on vengeance and annihilation...the universe will never be the same.";
      const result = formatSummaryParagraphs(input);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(
        "ancient evil bent on vengeance and annihilation... the universe will never be the same."
      );
    });

    it("splits multi-paragraph synopses cleanly", () => {
      const input = "Paragraph one starts here.\n\nParagraph two continues the epic tale.";
      const result = formatSummaryParagraphs(input);
      expect(result).toHaveLength(2);
      expect(result[0]).toBe("Paragraph one starts here.");
      expect(result[1]).toBe("Paragraph two continues the epic tale.");
    });
  });
});
