import { describe, expect, it } from "vitest";
import {
  addLocalDays,
  formatRangeLabel,
  localDayKey,
  parseLocalDayKey,
  previousActivityWindow,
  rangeDayCount,
  resolveActivityRange,
} from "./range";
import type { GameSession } from "../../types/game";

function session(date: string, durationMin = 30): GameSession {
  return { id: date, gameId: "a", gameName: "A", date, durationMin };
}

const TODAY = new Date(2026, 7, 30, 15, 0, 0); // 30 Aug 2026, local afternoon

describe("resolveActivityRange", () => {
  it("anchors presets to today inclusively", () => {
    expect(resolveActivityRange({ key: "7d", today: TODAY })).toEqual({
      key: "7d",
      startDate: "2026-08-24",
      endDate: "2026-08-30",
    });
    expect(resolveActivityRange({ key: "30d", today: TODAY }).startDate).toBe("2026-08-01");
    expect(resolveActivityRange({ key: "90d", today: TODAY }).startDate).toBe("2026-06-02");
  });

  it("uses the earliest session for all-time and never looks into the future", () => {
    const range = resolveActivityRange({
      key: "all",
      today: TODAY,
      sessions: [session("2024-03-02T22:00:00"), session("2026-08-30T09:00:00")],
    });
    expect(range).toEqual({ key: "all", startDate: "2024-03-02", endDate: "2026-08-30" });
  });

  it("falls back to a 30-day window for an empty library", () => {
    expect(resolveActivityRange({ key: "all", today: TODAY }).startDate).toBe("2025-08-31");
  });

  it("clamps custom ranges to today and orders reversed endpoints", () => {
    expect(
      resolveActivityRange({ key: "custom", from: "2026-09-10", to: "2026-08-01", today: TODAY }),
    ).toEqual({ key: "custom", startDate: "2026-08-01", endDate: "2026-08-30" });
  });

  it("repairs malformed custom dates instead of throwing", () => {
    const range = resolveActivityRange({ key: "custom", from: "nope", to: "2026-02-31", today: TODAY });
    expect(range.startDate).toBe("2026-08-01");
    expect(range.endDate).toBe("2026-08-30");
  });
});

describe("range math", () => {
  it("counts inclusive days", () => {
    expect(
      rangeDayCount({ key: "custom", startDate: "2026-08-01", endDate: "2026-08-30" }),
    ).toBe(30);
    expect(
      rangeDayCount({ key: "custom", startDate: "2026-08-30", endDate: "2026-08-30" }),
    ).toBe(1);
  });

  it("builds the immediately preceding equal window", () => {
    expect(
      previousActivityWindow({ key: "30d", startDate: "2026-08-01", endDate: "2026-08-30" }),
    ).toEqual({ startDate: "2026-07-02", endDate: "2026-07-31" });
    expect(previousActivityWindow({ key: "all", startDate: "2024-01-01", endDate: "2026-08-30" })).toBeNull();
  });

  it("round-trips day keys and rejects impossible dates", () => {
    const key = localDayKey(addLocalDays(new Date(2026, 1, 28), 1));
    expect(key).toBe("2026-03-01");
    expect(parseLocalDayKey("2026-02-31")).toBeNull();
    expect(parseLocalDayKey("30-08-2026")).toBeNull();
  });

  it("labels a range in the active locale", () => {
    const label = formatRangeLabel(
      { key: "custom", startDate: "2026-08-01", endDate: "2026-08-30" },
      "en",
    );
    expect(label).toContain("Aug");
    expect(label).toContain("2026");
  });
});
