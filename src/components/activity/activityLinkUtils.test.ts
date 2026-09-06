import { describe, it, expect } from "vitest";
import { calculateLinkedPlaytime, calculateNewGamePlaytime } from "./activityLinkUtils";
import type { GameSession } from "../../types/game";

describe("activityLinkUtils", () => {
  describe("calculateLinkedPlaytime", () => {
    it("updates 0h game to match unlinked sessions duration", () => {
      const targetGame = { playTime: "0h" };
      const unlinkedSessions: GameSession[] = [
        { id: "1", gameId: "unlinked-1", gameName: "Test", date: "2026-09-01T10:00:00Z", durationMin: 90 },
        { id: "2", gameId: "unlinked-1", gameName: "Test", date: "2026-09-02T10:00:00Z", durationMin: 60 },
      ];

      const result = calculateLinkedPlaytime(targetGame, unlinkedSessions);
      expect(result.playTime).toBe("2h 30m");
      expect(result.lastPlayed).toBe(new Date("2026-09-02T10:00:00Z").getTime());
    });

    it("adds unlinked sessions to existing target playtime", () => {
      const targetGame = { playTime: "10h", lastPlayed: new Date("2026-08-01T00:00:00Z").getTime() };
      const unlinkedSessions: GameSession[] = [
        { id: "1", gameId: "unlinked-1", gameName: "Test", date: "2026-09-05T12:00:00Z", durationMin: 45 },
      ];

      const result = calculateLinkedPlaytime(targetGame, unlinkedSessions);
      expect(result.playTime).toBe("10h 45m");
      expect(result.lastPlayed).toBe(new Date("2026-09-05T12:00:00Z").getTime());
    });

    it("ensures total playtime is at least the sum of all recorded activity sessions", () => {
      const targetGame = { playTime: "1h" }; // 60 min
      const unlinkedSessions: GameSession[] = [
        { id: "1", gameId: "unlinked-1", gameName: "Test", date: "2026-09-05T12:00:00Z", durationMin: 120 }, // 120 min
      ];
      const targetSessions: GameSession[] = [
        { id: "2", gameId: "target-1", gameName: "Target", date: "2026-09-04T12:00:00Z", durationMin: 60 }, // 60 min
      ];

      const result = calculateLinkedPlaytime(targetGame, unlinkedSessions, targetSessions);
      expect(result.playTime).toBe("3h"); // 180 min total
    });

    it("preserves more recent lastPlayed on target game", () => {
      const targetTime = new Date("2026-09-06T12:00:00Z").getTime();
      const targetGame = { playTime: "5h", lastPlayed: targetTime };
      const unlinkedSessions: GameSession[] = [
        { id: "1", gameId: "unlinked-1", gameName: "Test", date: "2026-09-01T10:00:00Z", durationMin: 30 },
      ];

      const result = calculateLinkedPlaytime(targetGame, unlinkedSessions);
      expect(result.playTime).toBe("5h 30m");
      // targetGame already has more recent lastPlayed
      expect(result.lastPlayed).toBeUndefined();
    });

    it("handles empty unlinked sessions gracefully", () => {
      const targetGame = { playTime: "3h 15m" };
      const result = calculateLinkedPlaytime(targetGame, []);
      expect(result.playTime).toBe("3h 15m");
      expect(result.lastPlayed).toBeUndefined();
    });
  });

  describe("calculateNewGamePlaytime", () => {
    it("computes total playtime and newest session timestamp", () => {
      const unlinkedSessions: GameSession[] = [
        { id: "1", gameId: "unlinked-1", gameName: "Test", date: "2026-09-01T10:00:00Z", durationMin: 45 },
        { id: "2", gameId: "unlinked-1", gameName: "Test", date: "2026-09-03T14:00:00Z", durationMin: 45 },
      ];

      const result = calculateNewGamePlaytime(unlinkedSessions);
      expect(result.playTime).toBe("1h 30m");
      expect(result.lastPlayed).toBe(new Date("2026-09-03T14:00:00Z").getTime());
    });

    it("handles empty sessions gracefully", () => {
      const result = calculateNewGamePlaytime([]);
      expect(result.playTime).toBe("0h");
      expect(result.lastPlayed).toBeUndefined();
    });
  });
});
