import { describe, it, expect } from "vitest";
import {
  wrappedYears,
  mergedYears,
  buildWrappedYear,
  yearHeatmapCells,
} from "./wrapped";
import type { GameSession } from "../../types/game";

function session(gameId: string, date: string, durationMin: number, avgFps?: number): GameSession {
  return {
    id: `${gameId}-${date}-${durationMin}`,
    gameId,
    gameName: `Game ${gameId}`,
    date,
    durationMin,
    metrics: avgFps ? { avgFps } : undefined,
  } as GameSession;
}

describe("wrappedYears", () => {
  it("returns distinct years newest-first", () => {
    expect(
      wrappedYears([
        session("a", "2024-05-02T10:00:00", 60),
        session("a", "2025-01-01T10:00:00", 30),
        session("b", "2024-12-31T23:00", 90),
      ])
    ).toEqual([2025, 2024]);
  });

  it("ignores garbage dates", () => {
    expect(wrappedYears([session("a", "", 30)])).toEqual([]);
  });
});

describe("mergedYears", () => {
  it("unions session years with achievement years", () => {
    expect(mergedYears([session("a", "2025-02-02", 10)], [2019, 2025])).toEqual([2025, 2019]);
  });
});

describe("buildWrappedYear", () => {
  const sessions = [
    session("mario", "2025-03-01T19:00:00", 60, 60),
    session("mario", "2025-03-01T21:00:00", 120, 61),
    session("zelda", "2025-03-02T09:00:00", 45),
    // dates only used for bucketing — cross-year data must be skipped below
  ];

  it("sums totals and distinct games for the year only", () => {
    const y = buildWrappedYear(2025, [...sessions, session("doom", "2024-06-01T00:00:00", 999)], []);
    expect(y.totalMinutes).toBe(225);
    expect(y.sessionsCount).toBe(3);
    expect(y.distinctGames).toBe(2);
  });

  it("ranks top games and counts sessions per game", () => {
    const y = buildWrappedYear(2025, sessions, []);
    expect(y.topGames[0].gameName).toContain("mario");
    expect(y.topGames[0].sessions).toBe(2);
    expect(y.topGames[0].minutes).toBe(180);
    expect(y.topGames[1].minutes).toBe(45);
  });

  it("picks the biggest day as the marathon", () => {
    const y = buildWrappedYear(2025, sessions, []);
    expect(y.topDay).toEqual({ date: "2025-03-01", minutes: 180 });
    expect(y.monthMinutes[2]).toBe(225);
  });

  it("tracks consecutive-day streaks", () => {
    const y = buildWrappedYear(2025, sessions, []);
    expect(y.activeDays).toBe(2);
    expect(y.longestStreakDays).toBe(2);
  });

  it("averages FPS across sessions that measured it", () => {
    const y = buildWrappedYear(2025, sessions, []);
    expect(y.fpsSessions).toBe(2);
    expect(y.avgFps).toBeCloseTo(60.5);
  });

  it("returns a zeroed year with no crash on empty data", () => {
    const y = buildWrappedYear(1990, [], []);
    expect(y.totalMinutes).toBe(0);
    expect(y.topDay).toBeNull();
    expect(y.avgFps).toBeNull();
    expect(y.longestStreakDays).toBe(0);
  });
});

describe("yearHeatmapCells", () => {
  it("covers exactly Jan 1 to Dec 31 of the year", () => {
    const cells = yearHeatmapCells(2025, []);
    expect(cells).toHaveLength(365);
    expect(cells[0].date).toBe("2025-01-01");
    expect(cells[364].date).toBe("2025-12-31");
  });

  it("counts leap-length 366 days", () => {
    expect(yearHeatmapCells(2024, [])).toHaveLength(366);
  });

  it("accumulates session minutes onto their day", () => {
    const cells = yearHeatmapCells(2025, [
      session("a", "2025-03-01T19:00:00", 60),
      session("a", "2025-03-01T21:00:00", 30),
      session("b", "2024-12-31T23:00", 999), // other year — ignored
    ]);
    const mar1 = cells.find((c) => c.date === "2025-03-01");
    expect(mar1?.minutes).toBe(90);
    expect(cells.find((c) => c.date === "2025-03-02")?.minutes).toBe(0);
  });
});
