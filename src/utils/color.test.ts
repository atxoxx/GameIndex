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
  legibleAccentForLuminance,
  medianCutQuantize,
  selectGamePalette,
  boostSaturation,
  type WeightedPixel,
} from "./color";

function pixelSet(
  color: [number, number, number],
  count: number,
  w = 1
): WeightedPixel[] {
  return Array.from({ length: count }, () => ({
    r: color[0],
    g: color[1],
    b: color[2],
    w,
  }));
}

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

describe("medianCutQuantize", () => {
  it("separates well-distinct colors into real clusters instead of an average", () => {
    const pixels = [
      ...pixelSet([255, 0, 0], 350),
      ...pixelSet([0, 0, 255], 200),
      ...pixelSet([255, 255, 255], 50, 0.5),
    ];
    const clusters = medianCutQuantize(pixels, 6);
    expect(clusters.length).toBeGreaterThanOrEqual(2);
    // Heaviest cluster is the red field, next the blue field — and neither
    // is a washed-out mix of both.
    const red = clusters[0].color;
    const blue = clusters[1].color;
    expect(red.r).toBeGreaterThan(200);
    expect(red.b).toBeLessThan(60);
    expect(blue.b).toBeGreaterThan(200);
    expect(blue.r).toBeLessThan(60);
    expect(clusters[0].weight).toBeGreaterThan(clusters[1].weight);
  });

  it("returns an empty array for no pixels", () => {
    expect(medianCutQuantize([])).toEqual([]);
  });

  it("returns a single cluster for a uniform image", () => {
    const clusters = medianCutQuantize(pixelSet([30, 144, 255], 100), 6);
    expect(clusters.length).toBe(1);
    expect(clusters[0].color).toEqual({ r: 30, g: 144, b: 255 });
    expect(clusters[0].weight).toBe(100);
  });
});

describe("selectGamePalette", () => {
  it("picks a vibrant primary, a distinct-hue secondary and the darkest wash", () => {
    const clusters = [
      { color: { r: 220, g: 30, b: 30 }, weight: 400 }, // vivid red
      { color: { r: 30, g: 40, b: 220 }, weight: 250 }, // vivid blue
      { color: { r: 10, g: 12, b: 40 }, weight: 180 },  // dark navy wash
      { color: { r: 250, g: 250, b: 250 }, weight: 120 }, // blown-out white
    ];
    const palette = selectGamePalette(clusters);
    expect(palette).not.toBeNull();
    // primary = most prominent × vibrant (red beats the equally-bright blue)
    expect(palette!.primary.r).toBeGreaterThan(150);
    expect(palette!.primary.g).toBeLessThan(80);
    // secondary = clearly different hue (blue), not the white or the navy
    expect(palette!.secondary.b).toBeGreaterThan(150);
    // deep = darkest chromatic cluster (navy), not a blind darkening
    expect(palette!.deep).toEqual({ r: 10, g: 12, b: 40 });
  });

  it("synthesizes a harmonized secondary for monochrome art", () => {
    const clusters = [
      { color: { r: 40, g: 48, b: 92 }, weight: 500 }, // slate blue
      { color: { r: 96, g: 104, b: 160 }, weight: 300 }, // lighter slate blue
    ];
    const palette = selectGamePalette(clusters);
    expect(palette).not.toBeNull();
    const primaryHue = rgbToHsl(palette!.primary).h;
    const secondaryHue = rgbToHsl(palette!.secondary).h;
    // Same hue family, lifted lightness (the harmonize fallback contract)
    const d = Math.abs(primaryHue - secondaryHue);
    expect(Math.min(d, 360 - d)).toBeLessThan(12);
    expect(rgbToHsl(palette!.secondary).l).toBeGreaterThan(
      rgbToHsl(palette!.primary).l
    );
  });

  it("returns null when no usable chromatic cluster exists", () => {
    const clusters = [
      { color: { r: 5, g: 6, b: 8 }, weight: 900 }, // crushed black
      { color: { r: 240, g: 242, b: 245 }, weight: 100 }, // blown white
    ];
    expect(selectGamePalette(clusters)).toBeNull();
  });
});

describe("boostSaturation", () => {
  it("leaves already-vibrant colors untouched", () => {
    expect(boostSaturation({ r: 255, g: 0, b: 0 })).toEqual({
      r: 255,
      g: 0,
      b: 0,
    });
  });

  it("spreads muted colors away from gray while preserving hue direction", () => {
    const boosted = boostSaturation({ r: 70, g: 80, b: 110 });
    expect(boosted.r).toBeLessThan(70);
    expect(boosted.b).toBeGreaterThan(110);
    const before = 110 - 70;
    const after = boosted.b - boosted.r;
    expect(after).toBeGreaterThan(before);
  });
});

describe("legibleAccentForLuminance", () => {
  const darkLum = luminance({ r: 13, g: 14, b: 23 }); // ~ adaptive bg-tertiary
  const lightLum = luminance({ r: 237, g: 241, b: 247 }); // ~ light theme bg-secondary

  it("leaves an already-legible accent untouched", () => {
    expect(legibleAccentForLuminance("#fafafa", darkLum)).toBe("#fafafa");
  });

  it("brightens a dark cool accent on a dark surface to pass 4.5:1", () => {
    const guarded = legibleAccentForLuminance("#0f3c8c", darkLum);
    expect(contrastRatio(guarded, "#0d0e17")).toBeGreaterThanOrEqual(4.5);
    // hue/saturation preserved enough to read as the same blue
    const h = rgbToHsl(hexToRgb(guarded));
    expect(h.h).toBeGreaterThan(200);
    expect(h.h).toBeLessThan(260);
  });

  it("deepens a light accent on a light surface to pass 4.5:1", () => {
    const guarded = legibleAccentForLuminance("#bfe3ff", lightLum);
    const cr = contrastRatio(guarded, "#ffffff");
    expect(cr).toBeGreaterThanOrEqual(4.5);
  });
});
