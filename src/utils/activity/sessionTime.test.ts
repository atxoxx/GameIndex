import { describe, expect, it } from "vitest";
import {
  currentDayStreak,
  formatSessionClockRange,
  groupSessionsByDay,
  longestDayStreak,
  sessionEndDate,
  sessionStartDate,
} from "./sessionTime";
import type { GameSession } from "../../types/game";

function session(date: string, durationMin: number): GameSession {
  return { id: `${date}-${durationMin}`, gameId: "a", gameName: "A", date, durationMin };
}

describe("session time semantics", () => {
  it("treats the stored timestamp as the session end", () => {
    const entry = session("2026-08-30T23:10:00", 90);
    expect(sessionEndDate(entry).getHours()).toBe(23);
    expect(sessionEndDate(entry).getMinutes()).toBe(10);
    expect(sessionStartDate(entry).getHours()).toBe(21);
    expect(sessionStartDate(entry).getMinutes()).toBe(40);
    expect(formatSessionClockRange(entry, "en")).toContain("40");
  });

  it("groups a late-evening session on its local day", () => {
    const groups = groupSessionsByDay([
      session("2026-08-30T23:10:00", 90),
      session("2026-08-31T00:20:00", 15),
    ]);
    expect(groups.map((group) => group.day)).toEqual(["2026-08-30", "2026-08-31"]);
    expect(groups[0].minutes).toBe(90);
  });
});

describe("streaks", () => {
  it("counts the longest consecutive day run", () => {
    expect(longestDayStreak(["2026-08-01", "2026-08-02", "2026-08-04", "2026-08-05", "2026-08-06"])).toBe(3);
    expect(longestDayStreak([])).toBe(0);
  });

  it("counts a streak that ends today or yesterday", () => {
    const today = new Date(2026, 7, 30, 11, 0, 0);
    expect(currentDayStreak(["2026-08-28", "2026-08-29", "2026-08-30"], today)).toBe(3);
    expect(currentDayStreak(["2026-08-28", "2026-08-29"], today)).toBe(2);
    expect(currentDayStreak(["2026-08-27", "2026-08-28"], today)).toBe(0);
  });
});
