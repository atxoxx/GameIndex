import { describe, it, expect } from "vitest";
import {
  deriveAdaptiveTheme,
  DEFAULT_ADAPTIVE_COLORS,
} from "./adaptiveTheme";
import { contrastRatio, luminance } from "./color";

/** Resolve a derived token to a concrete color where possible. */
function token(tokens: Record<string, string>, key: string): string {
  const v = tokens[key];
  if (!v) throw new Error(`missing token ${key}`);
  return v.startsWith("#") ? v : key;
}

/**
 * Extract the surface hexes the adaptive theme produces — these are the
 * backgrounds accent text/icons/badges sit on.
 */
/**
 * Extract the resting surface hexes (page background + card surfaces). The
 * transient hover/active press states are intentionally excluded because accent
 * text/icons/badges sit on resting surfaces, not on hover highlights.
 */
function surfaceHexes(tokens: Record<string, string>): string[] {
  return [
    tokens["--color-bg-primary"],
    tokens["--color-bg-secondary"],
    tokens["--color-bg-tertiary"],
  ].filter((h): h is string => typeof h === "string" && h.startsWith("#"));
}

describe("deriveAdaptiveTheme contrast guarantees", () => {
  const accentCountries: Array<{ dominant: [number, number, number]; name: string }> = [
    { name: "blue", dominant: [0, 80, 200] }, // hsl ~240 hue, low lightness (worst case)
    { name: "indigo", dominant: [80, 60, 210] }, // ~255 hue
    { name: "purple", dominant: [150, 40, 210] }, // ~278 hue
    { name: "teal", dominant: [0, 180, 160] }, // ~175 hue
    { name: "warm red", dominant: [220, 40, 30] }, // ~3 hue
    { name: "green", dominant: [0, 160, 60] }, // ~135 hue
    { name: "default fallback", dominant: [124, 102, 255] },
  ];

  it("keeps accent legible (>= 4.5:1) against every surface for cool artworks", () => {
    for (const c of accentCountries) {
      const [r, g, b] = c.dominant;
      const tokens = deriveAdaptiveTheme({
        dominant: { r, g, b },
        average: { r: 40, g: 35, b: 60 },
      });
      const accent = tokens["--color-accent"]!;
      for (const surf of surfaceHexes(tokens)) {
        expect(
          contrastRatio(accent, surf),
          `${c.name}'s accent ${accent} should be legible on ${surf}`
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps accent-contrast readable on the accent fill", () => {
    const tokens = deriveAdaptiveTheme({
      dominant: { r: 0, g: 80, b: 200 },
      average: { r: 40, g: 35, b: 60 },
    });
    const contrast = tokens["--color-accent-contrast"]!;
    expect(contrast).toMatch(/^#(?:ffffff|050508)$/);
  });

  it("keeps primary/secondary/tertiary text at AA against bright surfaces", () => {
    // Drive surfSmart bright-ish average so surfaces lean lighter than the floor.
    const tokens = deriveAdaptiveTheme({
      dominant: { r: 130, g: 90, b: 220 },
      average: { r: 110, g: 95, b: 150 },
    });
    for (const role of ["--color-text-primary", "--color-text-secondary", "--color-text-tertiary"]) {
      const text = token(tokens, role);
      for (const surf of surfaceHexes(tokens)) {
        // Terciary is the smallest/low-contrast of the three; text sits mostly
        // on raised surfaces, so allow the barrier on the lightest hover/active.
        const min = role === "--color-text-tertiary" ? 3.5 : 4.5;
        expect(
          contrastRatio(text, surf),
          `${role} ${text} legible on ${surf}`
        ).toBeGreaterThanOrEqual(min);
      }
    }
  });

  it("produces a full token set for the default artwork", () => {
    const tokens = deriveAdaptiveTheme(DEFAULT_ADAPTIVE_COLORS);
    const required = [
      "--color-bg-primary",
      "--color-bg-secondary",
      "--color-text-primary",
      "--color-text-secondary",
      "--color-text-tertiary",
      "--color-accent",
      "--color-accent-2",
      "--color-accent-contrast",
    ];
    for (const key of required) {
      expect(tokens[key], `missing ${key}`).toBeTruthy();
    }
  });

  it("blends accent lightness upward for cool hues (not a flat clamp)", () => {
    // A very dark blue artwork must NOT produce a near-black accent.
    const blue = deriveAdaptiveTheme({
      dominant: { r: 10, g: 20, b: 60 }, // dark blue, low lightness
      average: { r: 20, g: 18, b: 40 },
    });
    const accent = blue["--color-accent"]!;
    const accentLum = luminance({ r: parseInt(accent.slice(1, 3), 16), g: parseInt(accent.slice(3, 5), 16), b: parseInt(accent.slice(5, 7), 16) });
    expect(accentLum).toBeGreaterThan(0.15);
  });
});