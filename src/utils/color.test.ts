import { describe, it, expect } from "vitest";
import {
  hexToRgb,
  rgbToHex,
  lighten,
  darken,
  contrastRatio,
  textColorFor,
  luminance,
  parseCssColor,
  cssColorStringToHex,
  buildAccentFamily,
  rgbToHsl,
  hslToRgb,
} from "./color";

describe("hexToRgb / rgbToHex", () => {
  it("parses 6-char hex with hash", () => {
    expect(hexToRgb("#ff0000")).toEqual({ r: 255, g: 0, b: 0 });
  });
  it("parses 3-char hex", () => {
    expect(hexToRgb("#0f0")).toEqual({ r: 0, g: 255, b: 0 });
  });
  it("parses without hash", () => {
    expect(hexToRgb("0000ff")).toEqual({ r: 0, g: 0, b: 255 });
  });
  it("round-trips rgbToHex", () => {
    expect(rgbToHex({ r: 255, g: 128, b: 0 })).toBe("#ff8000");
    expect(rgbToHex(hexToRgb("#1a2b3c"))).toBe("#1a2b3c");
  });
  it("clamps rgbToHex", () => {
    expect(rgbToHex({ r: 300, g: -10, b: 128 })).toBe("#ff0080");
  });
});

describe("lighten / darken", () => {
  it("lighten blends towards white", () => {
    expect(lighten({ r: 0, g: 0, b: 0 }, 1)).toEqual({ r: 255, g: 255, b: 255 });
    expect(lighten({ r: 0, g: 0, b: 0 }, 0)).toEqual({ r: 0, g: 0, b: 0 });
    expect(lighten({ r: 100, g: 100, b: 100 }, 0.5)).toEqual({ r: 177.5, g: 177.5, b: 177.5 });
  });
  it("darken blends towards black", () => {
    expect(darken({ r: 255, g: 255, b: 255 }, 1)).toEqual({ r: 0, g: 0, b: 0 });
    expect(darken({ r: 255, g: 255, b: 255 }, 0)).toEqual({ r: 255, g: 255, b: 255 });
  });
  it("clamps factor to 0-1", () => {
    expect(lighten({ r: 100, g: 100, b: 100 }, 2)).toEqual(lighten({ r: 100, g: 100, b: 100 }, 1));
    expect(darken({ r: 100, g: 100, b: 100 }, -1)).toEqual(darken({ r: 100, g: 100, b: 100 }, 0));
  });
});

describe("luminance / contrastRatio / textColorFor", () => {
  it("luminance returns 0 for black and ~1 for white", () => {
    expect(luminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0);
    expect(luminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 1);
  });
  it("contrastRatio is 21 for black vs white", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
  });
  it("textColorFor picks white on dark and dark on light", () => {
    expect(textColorFor("#000000")).toBe("#ffffff");
    expect(textColorFor("#ffffff")).toBe("#050508");
  });
});

describe("parseCssColor / cssColorStringToHex", () => {
  it("parses hex", () => {
    expect(parseCssColor("#ff0000")).toEqual({ r: 255, g: 0, b: 0 });
  });
  it("parses rgb()", () => {
    expect(parseCssColor("rgb(10, 20, 30)")).toEqual({ r: 10, g: 20, b: 30 });
  });
  it("parses rgba()", () => {
    expect(parseCssColor("rgba(10, 20, 30, 0.5)")).toEqual({ r: 10, g: 20, b: 30 });
  });
  it("returns null for var()", () => {
    expect(parseCssColor("var(--color-accent)")).toBeNull();
  });
  it("cssColorStringToHex handles srgb color()", () => {
    const hex = cssColorStringToHex("color(srgb 1 0 0)");
    expect(hex).toBe("#ff0000");
  });
  it("returns null for empty", () => {
    expect(cssColorStringToHex("")).toBeNull();
  });
});

describe("rgbToHsl / hslToRgb", () => {
  it("round-trips red", () => {
    const hsl = rgbToHsl({ r: 255, g: 0, b: 0 });
    expect(hsl.h).toBeCloseTo(0);
    const rgb = hslToRgb(hsl.h, hsl.s, hsl.l);
    expect(Math.round(rgb.r)).toBe(255);
    expect(Math.round(rgb.g)).toBe(0);
    expect(Math.round(rgb.b)).toBe(0);
  });
  it("achromatic gray has s=0", () => {
    const hsl = rgbToHsl({ r: 128, g: 128, b: 128 });
    expect(hsl.s).toBe(0);
  });
});

describe("buildAccentFamily", () => {
  it("builds family from valid hex", () => {
    const family = buildAccentFamily("#7c66ff");
    expect(family).not.toBeNull();
    expect(family!["--color-accent"]).toBe("#7c66ff");
    expect(family!["--color-accent-contrast"]).toMatch(/^#(?:ffffff|050508)$/);
  });
  it("returns null for invalid color", () => {
    expect(buildAccentFamily("not-a-color")).toBeNull();
    expect(buildAccentFamily("var(--accent)")).toBeNull();
  });
  it("respects secondary override", () => {
    const family = buildAccentFamily("#ff0000", "#00ff00", null);
    expect(family!["--color-accent-2"]).toBe("#00ff00");
  });
});
