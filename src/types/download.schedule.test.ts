import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCHEDULER_CONFIG,
  formatScheduleTimestamp,
  isScheduleHeld,
  isWithinScheduleWindow,
  parseHhMm,
  type ScheduleDays,
  type SchedulerConfig,
  type TorrentDownload,
} from "./download";

const ALL_DAYS: ScheduleDays = [true, true, true, true, true, true, true];

function config(partial: Partial<SchedulerConfig>): SchedulerConfig {
  return { ...DEFAULT_SCHEDULER_CONFIG, days: ALL_DAYS, ...partial };
}

function downloadAt(scheduledStartAt?: number): TorrentDownload {
  return { scheduledStartAt } as TorrentDownload;
}

describe("parseHhMm", () => {
  it("parses valid clock strings", () => {
    expect(parseHhMm("00:00")).toBe(0);
    expect(parseHhMm("02:30")).toBe(150);
    expect(parseHhMm("23:59")).toBe(1439);
  });

  it("rejects malformed values", () => {
    expect(parseHhMm("")).toBeNull();
    expect(parseHhMm("24:00")).toBeNull();
    expect(parseHhMm("12:60")).toBeNull();
    expect(parseHhMm("noon")).toBeNull();
  });
});

describe("isScheduleHeld", () => {
  it("is true only for a future start time", () => {
    expect(isScheduleHeld(downloadAt(2000), 1000)).toBe(true);
    expect(isScheduleHeld(downloadAt(500), 1000)).toBe(false);
    expect(isScheduleHeld(downloadAt(undefined), 1000)).toBe(false);
  });
});

describe("isWithinScheduleWindow", () => {
  it("allows everything when the scheduler or window is disabled", () => {
    expect(isWithinScheduleWindow(config({ enabled: false }), new Date(2026, 0, 1, 12, 0))).toBe(true);
    expect(
      isWithinScheduleWindow(
        config({ enabled: true, windowEnabled: false }),
        new Date(2026, 0, 1, 12, 0),
      ),
    ).toBe(true);
  });

  it("gates a normal daytime window", () => {
    const cfg = config({ enabled: true, windowEnabled: true, windowStart: "09:00", windowEnd: "17:00" });
    expect(isWithinScheduleWindow(cfg, new Date(2026, 0, 1, 8, 59))).toBe(false);
    expect(isWithinScheduleWindow(cfg, new Date(2026, 0, 1, 9, 0))).toBe(true);
    expect(isWithinScheduleWindow(cfg, new Date(2026, 0, 1, 16, 59))).toBe(true);
    expect(isWithinScheduleWindow(cfg, new Date(2026, 0, 1, 17, 0))).toBe(false);
  });

  it("handles a window that wraps past midnight", () => {
    const cfg = config({ enabled: true, windowEnabled: true, windowStart: "22:00", windowEnd: "06:00" });
    expect(isWithinScheduleWindow(cfg, new Date(2026, 0, 1, 23, 30))).toBe(true);
    expect(isWithinScheduleWindow(cfg, new Date(2026, 0, 1, 2, 0))).toBe(true);
    expect(isWithinScheduleWindow(cfg, new Date(2026, 0, 1, 12, 0))).toBe(false);
  });

  it("treats start === end as always open", () => {
    const cfg = config({ enabled: true, windowEnabled: true, windowStart: "06:00", windowEnd: "06:00" });
    expect(isWithinScheduleWindow(cfg, new Date(2026, 0, 1, 3, 0))).toBe(true);
  });

  it("honours the day flags", () => {
    const noon = new Date(2026, 0, 1, 12, 0);
    const weekday = (noon.getDay() + 6) % 7;
    const days = [...ALL_DAYS] as ScheduleDays;
    days[weekday] = false;
    const cfg = config({ enabled: true, windowEnabled: true, windowStart: "09:00", windowEnd: "17:00", days });
    expect(isWithinScheduleWindow(cfg, noon)).toBe(false);
  });
});

describe("formatScheduleTimestamp", () => {
  it("renders a local timestamp with zero padding", () => {
    const date = new Date(2026, 0, 5, 9, 7);
    expect(formatScheduleTimestamp(Math.floor(date.getTime() / 1000))).toBe("2026-01-05 09:07");
  });
});
