import { describe, it, expect } from "vitest";
import {
  computeSidebarStats,
  formatMinutesTotal,
  groupGames,
  resolvePlatformGroup,
} from "../utils";
import type { Game } from "../../../types/game";

function mockGame(overrides: Partial<Game> = {}): Game {
  return {
    id: "g1",
    name: "Cyberpunk 2077",
    path: "C:\\Games\\Cyberpunk2077\\bin\\x64\\Cyberpunk2077.exe",
    addedAt: 1600000000,
    installed: true,
    platform: "steam",
    playTime: "2h",
    playStatus: "playing",
    ...overrides,
  };
}

const mockTranslate = (key: string) => key;

describe("sidebar utils", () => {
  describe("formatMinutesTotal", () => {
    it("formats 0 minutes as 0h", () => {
      expect(formatMinutesTotal(0)).toBe("0h");
    });

    it("formats minutes under 1 hour", () => {
      expect(formatMinutesTotal(45)).toBe("45m");
    });

    it("formats minutes over 1 hour as integer hours", () => {
      expect(formatMinutesTotal(90)).toBe("1h");
      expect(formatMinutesTotal(120)).toBe("2h");
    });

    it("formats large playtimes as integer hours", () => {
      expect(formatMinutesTotal(6000)).toBe("100h");
    });
  });

  describe("computeSidebarStats", () => {
    it("computes stats correctly for mixed game collection", () => {
      const games: Game[] = [
        mockGame({ id: "1", installed: true, playTime: "1h" }),
        mockGame({ id: "2", installed: false, playTime: "3h" }),
        mockGame({ id: "3", installed: true, playTime: "0h" }),
      ];
      const pinned = new Set(["1"]);

      const stats = computeSidebarStats(games, pinned);
      expect(stats.total).toBe(3);
      expect(stats.installed).toBe(2);
      expect(stats.favoriteCount).toBe(1);
      expect(stats.totalPlaytimeMinutes).toBe(240);
    });
  });

  describe("resolvePlatformGroup", () => {
    it("identifies known platforms", () => {
      expect(resolvePlatformGroup("steam")).toBe("Steam");
      expect(resolvePlatformGroup("gog")).toBe("GOG");
      expect(resolvePlatformGroup("epic")).toBe("Epic Games");
      expect(resolvePlatformGroup("ubisoft")).toBe("Ubisoft");
      expect(resolvePlatformGroup(undefined)).toBe("Local / Direct");
    });
  });

  describe("groupGames", () => {
    it("returns empty array for groupBy = none", () => {
      const games = [mockGame()];
      expect(groupGames(games, "none", mockTranslate)).toEqual([]);
    });

    it("groups by platform correctly", () => {
      const games = [
        mockGame({ id: "1", steamAppId: 1091500 }),
        mockGame({ id: "2", gogGameId: "12345" }),
        mockGame({ id: "3", steamAppId: 570 }),
      ];

      const groups = groupGames(games, "platform", mockTranslate);
      expect(groups).toHaveLength(2);
      const steamGroup = groups.find((g) => g.key === "Steam");
      expect(steamGroup).toBeDefined();
      expect(steamGroup?.count).toBe(2);
    });

    it("groups by play status correctly", () => {
      const games = [
        mockGame({ id: "1", playStatus: "playing" }),
        mockGame({ id: "2", playStatus: "completed" }),
        mockGame({ id: "3", playStatus: "backlog" }),
      ];

      const groups = groupGames(games, "play_status", mockTranslate);
      expect(groups.length).toBeGreaterThanOrEqual(3);
      expect(groups[0].key).toBe("playing");
    });

    it("groups by installed status correctly", () => {
      const games = [
        mockGame({ id: "1", installed: true }),
        mockGame({ id: "2", installed: false }),
      ];

      const groups = groupGames(games, "installed", mockTranslate);
      expect(groups).toHaveLength(2);
      expect(groups.find((g) => g.key === "installed")?.count).toBe(1);
      expect(groups.find((g) => g.key === "not_installed")?.count).toBe(1);
    });

    it("groups by letter correctly", () => {
      const games = [
        mockGame({ id: "1", name: "Apex Legends" }),
        mockGame({ id: "2", name: "Baldur's Gate 3" }),
        mockGame({ id: "3", name: "99 Vidas" }),
      ];

      const groups = groupGames(games, "letter", mockTranslate);
      expect(groups.map((g) => g.key)).toEqual(["A", "B", "#"]);
    });

    it("groups by decade correctly", () => {
      const games = [
        mockGame({ id: "1", releaseDate: "2023-05-12" }),
        mockGame({ id: "2", releaseDate: "2015-11-10" }),
        mockGame({ id: "3", releaseDate: "1998-03-24" }),
        mockGame({ id: "4", releaseDate: undefined }),
      ];

      const groups = groupGames(games, "decade", mockTranslate);
      expect(groups.map((g) => g.key)).toEqual(["2020s", "2010s", "1990s", "Unknown"]);
    });
  });
});
