import { describe, expect, it } from "vitest";
import {
  EMPTY_HISTORY,
  libraryTrend,
  monthlyReclaim,
  needsSnapshot,
  reclaimedThisMonth,
  startOfMonth,
  totalReclaimed,
  type StorageHistory,
} from "./reclaim";

const DAY = 86_400_000;

function history(overrides: Partial<StorageHistory> = {}): StorageHistory {
  return { ...EMPTY_HISTORY, ...overrides };
}

describe("totalReclaimed", () => {
  it("is zero for an empty history", () => {
    expect(totalReclaimed(EMPTY_HISTORY)).toBe(0);
  });

  it("sums bytes and ignores invalid timestamps", () => {
    const value = history({
      events: [
        { id: "1", at: "2026-01-01T00:00:00.000Z", kind: "uninstall", bytes: 100, count: 1 },
        { id: "2", at: "not-a-date", kind: "uninstall", bytes: 500, count: 1 },
        { id: "3", at: "2026-02-01T00:00:00.000Z", kind: "delete", bytes: 50, count: 2 },
      ],
    });
    expect(totalReclaimed(value)).toBe(150);
    expect(totalReclaimed(value, Date.parse("2026-02-01T00:00:00.000Z"))).toBe(50);
  });
});

describe("reclaimedThisMonth", () => {
  it("counts only events from the current calendar month", () => {
    const now = Date.UTC(2026, 9, 24);
    const monthStart = startOfMonth(now);
    const value = history({
      events: [
        {
          id: "old",
          at: new Date(monthStart - 2 * DAY).toISOString(),
          kind: "uninstall",
          bytes: 900,
          count: 1,
        },
        {
          id: "new",
          at: new Date(monthStart + DAY).toISOString(),
          kind: "uninstall",
          bytes: 100,
          count: 1,
        },
      ],
    });
    expect(reclaimedThisMonth(value, now)).toBe(100);
  });
});

describe("monthlyReclaim", () => {
  it("always returns the requested window, oldest first, with gaps at zero", () => {
    const now = Date.UTC(2026, 9, 24);
    const buckets = monthlyReclaim(history(), 6, now);
    expect(buckets).toHaveLength(6);
    expect(buckets.every((bucket) => bucket.bytes === 0)).toBe(true);
    expect(buckets[5].key).toBe("2026-10");
    expect(buckets[0].key).toBe("2026-05");
  });

  it("buckets events into their month", () => {
    const now = Date.UTC(2026, 9, 24);
    const buckets = monthlyReclaim(
      history({
        events: [
          { id: "a", at: "2026-10-02T10:00:00.000Z", kind: "uninstall", bytes: 40, count: 1 },
          { id: "b", at: "2026-08-15T10:00:00.000Z", kind: "uninstall", bytes: 10, count: 1 },
          { id: "c", at: "2026-01-15T10:00:00.000Z", kind: "uninstall", bytes: 99, count: 1 },
        ],
      }),
      6,
      now,
    );
    expect(buckets.find((bucket) => bucket.key === "2026-10")?.bytes).toBe(40);
    expect(buckets.find((bucket) => bucket.key === "2026-08")?.bytes).toBe(10);
    expect(buckets.reduce((sum, bucket) => sum + bucket.bytes, 0)).toBe(50);
  });
});

describe("libraryTrend", () => {
  it("needs two samples before reporting a direction", () => {
    const trend = libraryTrend(history());
    expect(trend.delta).toBe(0);
    expect(trend.first).toBeNull();
  });

  it("reports growth as a positive delta", () => {
    const trend = libraryTrend(
      history({
        snapshots: [
          { at: "2026-01-01T00:00:00.000Z", bytes: 1000, games: 10 },
          { at: "2026-06-01T00:00:00.000Z", bytes: 1500, games: 14 },
        ],
      }),
    );
    expect(trend.delta).toBe(500);
    expect(trend.deltaPct).toBeCloseTo(50);
  });

  it("survives unsorted input and zero-byte baselines", () => {
    const trend = libraryTrend(
      history({
        snapshots: [
          { at: "2026-06-01T00:00:00.000Z", bytes: 0, games: 0 },
          { at: "2026-01-01T00:00:00.000Z", bytes: 0, games: 0 },
        ],
      }),
    );
    expect(trend.delta).toBe(0);
    expect(trend.deltaPct).toBe(0);
  });
});

describe("needsSnapshot", () => {
  it("is true with no history", () => {
    expect(needsSnapshot(history())).toBe(true);
  });

  it("is false inside the weekly window and true outside it", () => {
    const now = Date.UTC(2026, 9, 24);
    const recent = history({
      snapshots: [{ at: new Date(now - 2 * DAY).toISOString(), bytes: 10, games: 1 }],
    });
    const old = history({
      snapshots: [{ at: new Date(now - 9 * DAY).toISOString(), bytes: 10, games: 1 }],
    });
    expect(needsSnapshot(recent, now)).toBe(false);
    expect(needsSnapshot(old, now)).toBe(true);
  });
});
