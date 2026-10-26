import { describe, expect, it } from "vitest";
import {
  buildPlaytimeSeries,
  cumulativeHours,
  periodHours,
  recommendedAggregation,
} from "./chartSeries";
import type { GameSession } from "../../types/game";

function session(date: string, durationMin: number): GameSession {
  return { id: `${date}-${durationMin}`, gameId: "a", gameName: "A", date, durationMin };
}

const range = { key: "custom" as const, startDate: "2026-08-01", endDate: "2026-08-10" };

describe("buildPlaytimeSeries", () => {
  const sessions = [
    session("2026-08-01T12:00:00", 30),
    session("2026-08-01T22:00:00", 60),
    session("2026-08-03T23:30:00", 30),
    session("2026-08-11T01:00:00", 90), // outside the range
  ];

  it("produces one point per day, zeros included, using local days", () => {
    const points = buildPlaytimeSeries(sessions, range, "day", "en");
    expect(points).toHaveLength(10);
    expect(points[0]).toMatchObject({ key: "2026-08-01", minutes: 90 });
    expect(points[1].minutes).toBe(0);
    expect(points[2]).toMatchObject({ key: "2026-08-03", minutes: 30 });
    expect(points[9].minutes).toBe(0);
  });

  it("buckets weeks from Monday", () => {
    const points = buildPlaytimeSeries(sessions, range, "week", "en");
    // 2026-08-01 is a Saturday; its week starts Mon 27 Jul.
    expect(points[0].key).toBe("2026-07-27");
    expect(points[0].minutes).toBe(90);
    expect(points[1].key).toBe("2026-08-03");
    expect(points[1].minutes).toBe(30);
  });

  it("buckets months and sums hours", () => {
    const points = buildPlaytimeSeries(sessions, range, "month", "en");
    expect(points).toHaveLength(1);
    expect(points[0].key).toBe("2026-08");
    expect(periodHours(points)).toEqual([2]);
  });

  it("builds a running cumulative series", () => {
    const points = buildPlaytimeSeries(sessions, range, "day", "en");
    const totals = cumulativeHours(points);
    expect(totals[0]).toBe(1.5);
    expect(totals[2]).toBe(2);
    expect(totals[totals.length - 1]).toBe(2);
  });
});

describe("recommendedAggregation", () => {
  it("keeps short ranges daily and coarsens long ones", () => {
    expect(recommendedAggregation(range)).toBe("day");
    expect(
      recommendedAggregation({ key: "custom", startDate: "2026-01-01", endDate: "2026-06-30" }),
    ).toBe("month");
    expect(recommendedAggregation({ key: "all", startDate: "2024-01-01", endDate: "2026-08-30" })).toBe(
      "month",
    );
  });
});
