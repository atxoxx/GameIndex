import { describe, it, expect } from "vitest";
import {
  buildTimeOfDayDistribution,
  buildSessionLengthDistribution,
  buildCumulativeSeries,
  buildGamerPersona,
  buildGameCompletionProgress,
  calculateFpsStability,
} from "./insights";
import type { Game, GameSession } from "../../types/game";

describe("activity insights", () => {
  const dummyGames: Game[] = [
    {
      id: "game-1",
      name: "Cyberpunk 2077",
      platform: "Steam",
      path: "",
      installed: true,
      playTime: "5h",
      addedAt: Date.now() - 86400000 * 10,
      steamAppId: 1091500,
      genres: ["RPG", "Action"],
      lastPlayed: Date.now() - 3600000 * 2,
      timeToBeat: { hastily: 24, normally: 60, completely: 105 },
    },
    {
      id: "game-2",
      name: "Elden Ring",
      platform: "Steam",
      path: "",
      installed: true,
      playTime: "3h",
      addedAt: Date.now() - 86400000 * 15,
      steamAppId: 1245620,
      genres: ["RPG", "Souls-like"],
      lastPlayed: Date.now() - 3600000 * 24,
      timeToBeat: { hastily: 30, normally: 58, completely: 133 },
    },
  ];

  const dummySessions: GameSession[] = [
    {
      id: "sess-1",
      gameId: "game-1",
      gameName: "Cyberpunk 2077",
      date: "2026-08-30T23:30:00.000Z", // Night / Sunday
      durationMin: 90,
      metrics: {
        avgFps: 95,
        minFps: 82,
        maxFps: 110,
        avgCpuUsage: 45,
        avgGpuUsage: 88,
        avgRamUsage: 55,
        avgCpuTemp: 64,
        avgGpuTemp: 68,
        resolution: "2560x1440",
      },
    },
    {
      id: "sess-2",
      gameId: "game-2",
      gameName: "Elden Ring",
      date: "2026-08-31T14:30:00.000Z", // Afternoon / Monday
      durationMin: 45,
      metrics: {
        avgFps: 60,
        minFps: 58,
        maxFps: 60,
        avgCpuUsage: 35,
        avgGpuUsage: 70,
        avgRamUsage: 45,
        avgCpuTemp: 58,
        avgGpuTemp: 62,
        resolution: "2560x1440",
      },
    },
    {
      id: "sess-3",
      gameId: "game-1",
      gameName: "Cyberpunk 2077",
      date: "2026-09-01T01:00:00.000Z", // Night / Tuesday
      durationMin: 150,
      metrics: {
        avgFps: 90,
        minFps: 70,
        maxFps: 105,
        avgCpuUsage: 50,
        avgGpuUsage: 92,
        avgRamUsage: 60,
        avgCpuTemp: 67,
        avgGpuTemp: 72,
        resolution: "2560x1440",
      },
    },
  ];

  describe("buildTimeOfDayDistribution", () => {
    it("should classify sessions into morning, afternoon, evening, and night", () => {
      const dist = buildTimeOfDayDistribution(dummySessions);
      expect(dist.totalMinutes).toBe(285);
      expect(dist.slots.length).toBe(4);

      const nightSlot = dist.slots.find((s) => s.key === "night");
      expect(nightSlot).toBeDefined();
      expect(nightSlot?.minutes).toBeGreaterThan(0);
      expect(dist.peakSlot).toBeDefined();
    });

    it("should calculate weekday and weekend distribution", () => {
      const dist = buildTimeOfDayDistribution(dummySessions);
      expect(dist.weekdayMinutes + dist.weekendMinutes).toBe(dist.totalMinutes);
      expect(dist.weekendRatioPct).toBeGreaterThanOrEqual(0);
      expect(dist.weekendRatioPct).toBeLessThanOrEqual(100);
    });
  });

  describe("buildSessionLengthDistribution", () => {
    it("should properly bucket session durations", () => {
      const result = buildSessionLengthDistribution(dummySessions);
      expect(result.totalSessions).toBe(3);
      expect(result.averageMinutes).toBe(95);
      expect(result.longestMinutes).toBe(150);
      expect(result.buckets.length).toBe(5);

      const shortBucket = result.buckets.find((b) => b.key === "short");
      expect(shortBucket?.count).toBe(1); // sess-2 (45 min)

      const mediumBucket = result.buckets.find((b) => b.key === "medium");
      expect(mediumBucket?.count).toBe(1); // sess-1 (90 min)

      const longBucket = result.buckets.find((b) => b.key === "long");
      expect(longBucket?.count).toBe(1); // sess-3 (150 min)
    });
  });

  describe("buildCumulativeSeries", () => {
    it("should build monotonically increasing playtime series", () => {
      const series = buildCumulativeSeries(
        dummySessions,
        "2026-08-25",
        "2026-09-02",
        "day",
        "en",
      );
      expect(series.length).toBeGreaterThan(0);

      // Check cumulative progression
      for (let i = 1; i < series.length; i++) {
        expect(series[i].cumulativeHours).toBeGreaterThanOrEqual(series[i - 1].cumulativeHours);
      }

      const lastPoint = series[series.length - 1];
      expect(lastPoint.cumulativeHours).toBe(Math.round((285 / 60) * 10) / 10);
    });
  });

  describe("buildGamerPersona", () => {
    it("should determine an archetype for the gamer", () => {
      const persona = buildGamerPersona(dummySessions, dummyGames);
      expect(persona).toBeDefined();
      expect(persona.titleKey).toContain("activityInsights.persona.");
      expect(persona.archetype).toBeDefined();
    });
  });

  describe("buildGameCompletionProgress", () => {
    it("should correctly evaluate HowLongToBeat / IGDB completion milestones", () => {
      const ttb = { hastily: 20, normally: 50, completely: 100 };
      const progress = buildGameCompletionProgress(1500, ttb); // 25 hours

      expect(progress.hasTimeToBeat).toBe(true);
      expect(progress.playedHours).toBe(25);
      expect(progress.mainStoryHours).toBe(50);
      expect(progress.mainStoryPct).toBe(50);
      expect(progress.completionistPct).toBe(25);
      expect(progress.status).toBe("inProgress");
    });

    it("should handle games with missing time-to-beat gracefully", () => {
      const progress = buildGameCompletionProgress(0, undefined);
      expect(progress.hasTimeToBeat).toBe(false);
      expect(progress.status).toBe("notStarted");
    });
  });

  describe("calculateFpsStability", () => {
    it("should compute consistency ratio and ratings", () => {
      const exceptional = calculateFpsStability(100, 92);
      expect(exceptional.ratio).toBe(92);
      expect(exceptional.rating).toBe("exceptional");

      const smooth = calculateFpsStability(60, 42);
      expect(smooth.ratio).toBe(70);
      expect(smooth.rating).toBe("smooth");

      const unstable = calculateFpsStability(80, 40);
      expect(unstable.ratio).toBe(50);
      expect(unstable.rating).toBe("unstable");
    });
  });
});
