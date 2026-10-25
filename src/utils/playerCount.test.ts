import { describe, expect, it } from "vitest";
import {
  formatCompactPlayerCount,
  formatPlayerAxisLabel,
  formatPlayerSampleTime,
  nicePlayerCeil,
  playerCountChangePercent,
} from "./playerCount";

describe("formatCompactPlayerCount", () => {
  it("keeps sub-thousand counts exact", () => {
    expect(formatCompactPlayerCount(0)).toBe("0");
    expect(formatCompactPlayerCount(999)).toBe("999");
  });

  it("compacts thousands and millions without a trailing .0", () => {
    expect(formatCompactPlayerCount(1_500)).toBe("1.5K");
    expect(formatCompactPlayerCount(42_000)).toBe("42K");
    expect(formatCompactPlayerCount(1_350_000)).toBe("1.4M");
    expect(formatCompactPlayerCount(2_000_000)).toBe("2M");
  });
});

describe("playerCountChangePercent", () => {
  it("rounds the change against the previous window", () => {
    expect(playerCountChangePercent(112, 100)).toBe(12);
    expect(playerCountChangePercent(88, 100)).toBe(-12);
  });

  it("returns null when there is no usable baseline", () => {
    expect(playerCountChangePercent(112, null)).toBeNull();
    expect(playerCountChangePercent(112, undefined)).toBeNull();
    expect(playerCountChangePercent(112, 0)).toBeNull();
  });
});

describe("formatPlayerSampleTime", () => {
  const ts = new Date(2025, 0, 14, 21, 5).getTime();

  it("formats a peak timestamp with and without the year", () => {
    expect(formatPlayerSampleTime(ts, "en", { withYear: false })).toContain("Jan 14");
    expect(formatPlayerSampleTime(ts, "en", { withYear: true })).toContain("2025");
  });

  it("includes the time of day when asked", () => {
    expect(formatPlayerSampleTime(ts, "en", { withTime: true })).toMatch(/\d{1,2}:\d{2}/);
  });

  it("returns an empty string for missing or invalid timestamps", () => {
    expect(formatPlayerSampleTime(null, "en")).toBe("");
    expect(formatPlayerSampleTime(Number.NaN, "en")).toBe("");
  });
});

describe("formatPlayerAxisLabel", () => {
  const ts = new Date(2023, 9, 21).getTime();

  it("uses a month and day for recent ranges", () => {
    expect(formatPlayerAxisLabel(ts, "en", false)).toBe("Oct 21");
  });

  it("uses a short year for all-time ranges", () => {
    expect(formatPlayerAxisLabel(ts, "en", true)).toBe("Oct '23");
  });

  it("uses a weekday for a one-week view so days stay distinct", () => {
    expect(formatPlayerAxisLabel(ts, "en", false, true)).toBe("Sat");
  });
});

describe("nicePlayerCeil", () => {
  it("keeps a 68K peak on an 80K axis instead of jumping to 100K", () => {
    expect(nicePlayerCeil(68_412)).toBe(80_000);
    expect(nicePlayerCeil(37_806)).toBe(40_000);
  });

  it("falls back to 1 for missing or zero values", () => {
    expect(nicePlayerCeil(0)).toBe(1);
    expect(nicePlayerCeil(Number.NaN)).toBe(1);
  });
});
