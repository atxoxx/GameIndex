import { describe, it, expect } from "vitest";
import {
  STEP_INDEX,
  STEP_PCT,
  LAUNCH_STEP_KEYS,
  TIPS,
  extractVibrantFromPixels,
} from "./Splashscreen";

describe("Splashscreen Launch Configuration", () => {
  it("maps known backend launch progress step names to step indices (happy path)", () => {
    expect(STEP_INDEX["resolvingPaths"]).toBe(0);
    expect(STEP_INDEX["preLaunchScript"]).toBe(1);
    expect(STEP_INDEX["elevating"]).toBe(2);
    expect(STEP_INDEX["startingGame"]).toBe(3);
    expect(STEP_INDEX["loadingAssets"]).toBe(4);
    expect(STEP_INDEX["companionApps"]).toBe(5);
    expect(STEP_INDEX["launching"]).toBe(6);
  });

  it("handles unknown or invalid step names safely (error path)", () => {
    expect(STEP_INDEX["nonExistentStep"]).toBeUndefined();
    expect(STEP_INDEX[""]).toBeUndefined();
  });

  it("ensures step progress percentages strictly increase monotonically", () => {
    let prevPct = 0;
    for (let step = 0; step <= 6; step++) {
      const pct = STEP_PCT[step as keyof typeof STEP_PCT];
      expect(pct).toBeGreaterThan(prevPct);
      expect(pct).toBeLessThan(100);
      prevPct = pct;
    }
  });

  it("contains all expected i18n keys for each launch step", () => {
    for (let step = 0; step <= 6; step++) {
      const key = LAUNCH_STEP_KEYS[step as keyof typeof LAUNCH_STEP_KEYS];
      expect(key).toMatch(/^splash\./);
    }
  });

  it("defines non-empty rotating loading tips", () => {
    expect(TIPS.length).toBeGreaterThanOrEqual(3);
    TIPS.forEach((tip) => {
      expect(tip).toMatch(/^splash\.tip\d+$/);
    });
  });

  it("extracts vibrant palette from colorful pixel data (happy path)", () => {
    // 16x16 grid with vivid cyan/blue pixels: rgba(0, 180, 240, 255)
    const pixels = new Uint8ClampedArray(16 * 16 * 4);
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = 0;
      pixels[i + 1] = 180;
      pixels[i + 2] = 240;
      pixels[i + 3] = 255;
    }
    const palette = extractVibrantFromPixels(pixels);
    expect(palette).not.toBeNull();
    expect(palette?.accent).toContain("rgb(");
    expect(palette?.accent2).toContain("rgb(");
    expect(palette?.glow).toContain("rgba(");
  });

  it("returns null safely for grayscale, pure dark, or transparent pixels (error path)", () => {
    // 16x16 grid with pure black/gray: rgba(30, 30, 30, 255)
    const grayPixels = new Uint8ClampedArray(16 * 16 * 4);
    for (let i = 0; i < grayPixels.length; i += 4) {
      grayPixels[i] = 30;
      grayPixels[i + 1] = 30;
      grayPixels[i + 2] = 30;
      grayPixels[i + 3] = 255;
    }
    expect(extractVibrantFromPixels(grayPixels)).toBeNull();

    // Pure transparent pixels
    const transparentPixels = new Uint8ClampedArray(16 * 16 * 4);
    expect(extractVibrantFromPixels(transparentPixels)).toBeNull();
  });
});
