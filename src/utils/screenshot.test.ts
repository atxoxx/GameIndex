import { describe, expect, it } from "vitest";
import {
  MAX_CANVAS_DIMENSION,
  MIN_SCREENSHOT_SCALE,
  clampScreenshotScale,
  sanitizeFileName,
  sanitizeGradientStopOffset,
} from "./screenshot";

describe("sanitizeFileName", () => {
  it("lowercases and joins words with a single dash", () => {
    expect(sanitizeFileName("Hollow Knight")).toBe("hollow-knight");
    expect(sanitizeFileName("Game_Name   With   Spaces")).toBe(
      "game-name-with-spaces"
    );
  });

  it("strips characters that are illegal in filenames", () => {
    expect(sanitizeFileName('Tom Clancy\u2019s: "Rainbow" <Six>')).toBe(
      "tom-clancys-rainbow-six"
    );
    expect(sanitizeFileName("A/B\\C:D*E?F")).toBe("abcdef");
  });

  it("falls back to a stable name when nothing survives", () => {
    expect(sanitizeFileName("***")).toBe("screenshot");
    expect(sanitizeFileName("   ")).toBe("screenshot");
    expect(sanitizeFileName("")).toBe("screenshot");
  });
});

describe("clampScreenshotScale", () => {
  it("keeps the requested scale when the canvas fits", () => {
    expect(clampScreenshotScale(1200, 800, 2)).toBe(2);
  });

  it("lowers the scale for tall captures instead of overflowing the canvas", () => {
    const scale = clampScreenshotScale(1200, MAX_CANVAS_DIMENSION, 2);
    expect(scale).toBeLessThan(2);
    expect(1200 * scale).toBeLessThanOrEqual(MAX_CANVAS_DIMENSION);
  });

  it("never drops below the minimum scale", () => {
    expect(clampScreenshotScale(2000, 100_000, 2)).toBe(MIN_SCREENSHOT_SCALE);
  });

  it("handles a zero-sized element without dividing by zero", () => {
    expect(clampScreenshotScale(0, 0, 2)).toBe(2);
  });
});

describe("sanitizeGradientStopOffset", () => {
  it("passes through offsets already within range", () => {
    expect(sanitizeGradientStopOffset(0)).toBe(0);
    expect(sanitizeGradientStopOffset(0.42)).toBe(0.42);
    expect(sanitizeGradientStopOffset(1)).toBe(1);
  });

  it("clamps offsets outside the 0..1 range", () => {
    expect(sanitizeGradientStopOffset(-2)).toBe(0);
    expect(sanitizeGradientStopOffset(3)).toBe(1);
  });

  it("signals non-finite offsets (degenerate gradients) to be skipped", () => {
    expect(sanitizeGradientStopOffset(NaN)).toBeNull();
    expect(sanitizeGradientStopOffset(Infinity)).toBeNull();
    expect(sanitizeGradientStopOffset(-Infinity)).toBeNull();
  });
});
