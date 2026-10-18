import { describe, expect, it } from "vitest";
import {
  BANDWIDTH_SCALE_FLOOR,
  computeBandwidthScale,
  formatAxisSpeed,
  niceCeil,
  percentile,
  sliceToWindow,
  timeAxisTicks,
} from "./bandwidthChart";

function sample(ts: number, down: number, up = 0) {
  return { ts, time: "12:00:00", down, up };
}

describe("percentile", () => {
  it("returns the requested rank and handles an empty list", () => {
    expect(percentile([], 0.95)).toBe(0);
    expect(percentile([1, 2, 3, 4, 100], 0.5)).toBe(3);
    expect(percentile([1, 2, 3, 4, 100], 0.95)).toBe(100);
  });
});

describe("niceCeil", () => {
  it("snaps to 1 / 2 / 2.5 / 5 steps and never drops below the floor", () => {
    expect(niceCeil(1_500_000)).toBe(2_000_000);
    expect(niceCeil(2_300_000)).toBe(2_500_000);
    expect(niceCeil(4_100_000)).toBe(5_000_000);
    expect(niceCeil(0)).toBe(BANDWIDTH_SCALE_FLOOR);
  });
});

describe("computeBandwidthScale", () => {
  it("keeps the peak inside the plot and returns five tidy ticks", () => {
    const samples = [
      sample(1, 2_700_000),
      sample(2, 2_800_000),
      sample(3, 4_510_000),
      sample(4, 2_500_000),
    ];
    const scale = computeBandwidthScale(samples, 2_720_000, 0);
    expect(scale.max).toBeGreaterThanOrEqual(4_510_000);
    expect(scale.ticks).toHaveLength(5);
    expect(scale.ticks[0]).toBe(0);
    expect(scale.ticks[4]).toBe(scale.max);
  });

  it("falls back to the floor while idle", () => {
    const scale = computeBandwidthScale([], 0, 0);
    expect(scale.max).toBe(BANDWIDTH_SCALE_FLOOR);
  });
});

describe("formatAxisSpeed", () => {
  it("drops trailing zeros but keeps meaningful decimals", () => {
    expect(formatAxisSpeed(5_000_000, "bytes", "en")).toBe("5 MB/s");
    expect(formatAxisSpeed(2_500_000, "bytes", "en")).toBe("2.5 MB/s");
    expect(formatAxisSpeed(1_250_000, "bytes", "fr")).toBe("1.25 Mo/s");
    expect(formatAxisSpeed(0, "bytes", "en")).toBe("0 B/s");
  });
});

describe("sliceToWindow", () => {
  it("keeps only samples inside the requested window", () => {
    const now = 100_000;
    const samples = [sample(0, 1), sample(60_000, 2), sample(95_000, 3)];
    expect(sliceToWindow(samples, now, 60_000).map((s) => s.down)).toEqual([2, 3]);
  });
});

describe("timeAxisTicks", () => {
  it("spans the whole window with evenly spaced labels", () => {
    const ticks = timeAxisTicks(100_000, 60_000, 5);
    expect(ticks).toHaveLength(5);
    expect(ticks[0].ts).toBe(40_000);
    expect(ticks[4].ts).toBe(100_000);
    expect(ticks[0].label).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});
