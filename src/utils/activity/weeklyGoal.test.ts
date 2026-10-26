import { describe, expect, it } from "vitest";
import {
  MAX_WEEKLY_GOAL_MIN,
  minutesThisWeek,
  sanitizeWeeklyGoal,
  startOfWeek,
  weekWindow,
  weeklyGoalProgress,
} from "./weeklyGoal";
import type { GameSession } from "../../types/game";

function session(date: string, durationMin: number): GameSession {
  return { id: `${date}-${durationMin}`, gameId: "a", gameName: "A", date, durationMin };
}

// Wednesday 26 Aug 2026 — the week starts Monday 24 Aug.
const WEDNESDAY = new Date(2026, 7, 26, 20, 0, 0);

describe("week window", () => {
  it("starts on Monday", () => {
    expect(startOfWeek(WEDNESDAY).getDay()).toBe(1);
    expect(weekWindow(WEDNESDAY)).toEqual({
      startDate: "2026-08-24",
      endDate: "2026-08-30",
    });
  });

  it("handles Sunday as the last day of the previous Monday week", () => {
    expect(weekWindow(new Date(2026, 7, 30, 12, 0, 0))).toEqual({
      startDate: "2026-08-24",
      endDate: "2026-08-30",
    });
  });
});

describe("minutesThisWeek", () => {
  it("sums only the current Monday–Sunday window", () => {
    const minutes = minutesThisWeek(
      [
        session("2026-08-23T23:00:00", 999), // previous week
        session("2026-08-24T08:00:00", 30),
        session("2026-08-26T21:00:00", 60),
        session("2026-08-31T00:30:00", 999), // next week
      ],
      WEDNESDAY,
    );
    expect(minutes).toBe(90);
  });
});

describe("weeklyGoalProgress", () => {
  it("reports remaining time and a clamped ring percentage", () => {
    expect(weeklyGoalProgress(120, 300)).toEqual({
      targetMin: 300,
      minutes: 120,
      remainingMin: 180,
      percent: 40,
      reached: false,
    });
    expect(weeklyGoalProgress(400, 300)).toMatchObject({ percent: 100, reached: true, remainingMin: 0 });
  });

  it("treats a zero target as off", () => {
    expect(weeklyGoalProgress(120, 0)).toMatchObject({ targetMin: 0, percent: 0, reached: false });
  });
});

describe("sanitizeWeeklyGoal", () => {
  it("accepts a positive number, caps it and ignores garbage", () => {
    expect(sanitizeWeeklyGoal("600")).toBe(600);
    expect(sanitizeWeeklyGoal(String(MAX_WEEKLY_GOAL_MIN + 5000))).toBe(MAX_WEEKLY_GOAL_MIN);
    expect(sanitizeWeeklyGoal("-5")).toBe(0);
    expect(sanitizeWeeklyGoal("nope")).toBe(0);
    expect(sanitizeWeeklyGoal(null)).toBe(0);
  });
});
