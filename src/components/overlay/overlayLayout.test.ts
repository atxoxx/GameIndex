import { describe, it, expect } from "vitest";
import {
  normalizeDensity,
  normalizeTickerLayout,
  TICKER_LAYOUTS,
  DENSITY_OPTIONS,
} from "./overlayLayout";

describe("overlay layout presets", () => {
  it("keeps the two current ticker presets", () => {
    expect(TICKER_LAYOUTS.map((option) => option.id)).toEqual([
      "strip",
      "gauges",
    ]);
  });

  it("maps retired presets to the condensed strip", () => {
    expect(normalizeTickerLayout("single")).toBe("strip");
    expect(normalizeTickerLayout("minimal")).toBe("strip");
    expect(normalizeTickerLayout("nonsense")).toBe("strip");
    expect(normalizeTickerLayout(undefined)).toBe("strip");
  });

  it("keeps gauges as an explicit choice", () => {
    expect(normalizeTickerLayout("gauges")).toBe("gauges");
  });

  it("defaults density to comfortable and accepts compact", () => {
    expect(DENSITY_OPTIONS.map((option) => option.id)).toEqual([
      "comfortable",
      "compact",
    ]);
    expect(normalizeDensity("compact")).toBe("compact");
    expect(normalizeDensity("nonsense")).toBe("comfortable");
    expect(normalizeDensity(null)).toBe("comfortable");
  });
});
