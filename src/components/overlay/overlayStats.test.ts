import { describe, it, expect } from "vitest";
import {
  computeFpsStats,
  formatVram,
  metricSeries,
  peakOf,
} from "./overlayStats";
import type { OverlayMetrics } from "../../context/OverlayContext";

const sample = (partial: Partial<OverlayMetrics>): OverlayMetrics => ({
  cpu: 0,
  gpu: 0,
  ram: 0,
  cpuTemp: 0,
  gpuTemp: 0,
  ...partial,
});

describe("computeFpsStats", () => {
  it("returns null when there is no finite data", () => {
    expect(computeFpsStats([])).toBeNull();
    expect(computeFpsStats([0, Number.NaN, -5])).toBeNull();
  });

  it("summarises avg/min/max over the retained samples", () => {
    const stats = computeFpsStats([60, 120, 30]);
    expect(stats).not.toBeNull();
    expect(stats!.avg).toBeCloseTo(70);
    expect(stats!.min).toBe(30);
    expect(stats!.max).toBe(120);
    expect(stats!.count).toBe(3);
  });

  it("takes the mean of the worst 1% of frames for the 1% low", () => {
    // 100 samples: 99 at 100 FPS, one at 20 FPS → the worst 1% is just the 20.
    const values = [
      ...Array.from({ length: 99 }, () => 100),
      20,
    ];
    const stats = computeFpsStats(values)!;
    expect(stats.low1).toBeCloseTo(20);
    // 0.1% low also collapses to a single worst sample here.
    expect(stats.low01).toBeCloseTo(20);
  });

  it("averages the worst bucket when the window is large", () => {
    // 200 samples: worst 1% = 2 samples (10 and 20) → mean 15.
    const values = [
      ...Array.from({ length: 198 }, () => 60),
      10,
      20,
    ];
    const stats = computeFpsStats(values)!;
    expect(stats.low1).toBeCloseTo(15);
  });
});

describe("metricSeries", () => {
  it("collects only finite values for the requested key", () => {
    const history = [
      sample({ fps: 60 }),
      sample({ fps: undefined }),
      sample({ fps: 90 }),
      sample({ fps: Number.NaN }),
    ];
    expect(metricSeries(history, "fps")).toEqual([60, 90]);
    expect(metricSeries(history, "cpu")).toEqual([0, 0, 0, 0]);
  });
});

describe("peakOf", () => {
  it("returns the largest finite value, or null when empty", () => {
    expect(peakOf([])).toBeNull();
    expect(peakOf([3, 9, 4])).toBe(9);
    expect(peakOf([Number.NaN, 5])).toBe(5);
  });
});

describe("formatVram", () => {
  it("formats used/total in GB when a total is known", () => {
    expect(formatVram(6144, 8192)).toBe("6.0 / 8 GB");
  });

  it("falls back to a single used figure", () => {
    expect(formatVram(512)).toBe("512 MB");
    expect(formatVram(2048)).toBe("2.0 GB");
  });

  it("returns null without a usable used value", () => {
    expect(formatVram(undefined, 8192)).toBeNull();
    expect(formatVram(Number.NaN)).toBeNull();
  });
});
