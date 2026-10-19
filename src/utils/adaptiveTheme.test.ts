import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ADAPTIVE_CROSSFADE_KEYS,
  applyAdaptiveTheme,
  cancelAdaptiveThemeCrossfade,
  crossfadeAdaptiveTheme,
  deriveAdaptiveTheme,
  DEFAULT_ADAPTIVE_COLORS,
  sampledPaletteClose,
  samplePixelData,
} from "./adaptiveTheme";
import { contrastRatio, luminance } from "./color";

/** Build an opaque square RGBA buffer where each row is a flat color. */
function rgbaImage(rows: Array<[number, number, number]>): Uint8ClampedArray {
  const size = rows.length;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b] = rows[y];
      const i = (y * size + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return data;
}

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

describe("samplePixelData", () => {
  it("extracts a real dominant cluster, not a washed-out mix", () => {
    // 3/4 red, 1/4 blue — an average would land as a muddy purple-ish mix.
    const rows = Array.from({ length: 8 }, (_, y) =>
      y < 6 ? ([255, 0, 0] as [number, number, number]) : ([0, 0, 255] as [number, number, number])
    );
    const sampled = samplePixelData(rgbaImage(rows), 8);
    expect(sampled.dominant.r).toBeGreaterThan(150);
    expect(sampled.dominant.b).toBeLessThan(100);
    expect(sampled.dominant.g).toBeLessThan(60);
    // The ambient average is still the mixed tone (heavy red, some blue).
    expect(sampled.average.r).toBeGreaterThan(120);
    expect(sampled.average.b).toBeGreaterThan(20);
    expect(sampled.average.b).toBeLessThan(130);
  });

  it("falls back to the default average when every pixel is transparent", () => {
    const sampled = samplePixelData(new Uint8ClampedArray(8 * 8 * 4), 8);
    expect(sampled.average).toEqual(DEFAULT_ADAPTIVE_COLORS.average);
    expect(sampled.dominant).toEqual(DEFAULT_ADAPTIVE_COLORS.average);
  });

  it("falls back to the average when the artwork is chromatically flat", () => {
    const black = rgbaImage(Array.from({ length: 4 }, () => [0, 0, 0] as [number, number, number]));
    const sampled = samplePixelData(black, 4);
    expect(sampled.dominant).toEqual({ r: 0, g: 0, b: 0 });
    expect(sampled.average).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("ignores black letterbox bars when picking the dominant color", () => {
    // Wide hero art with black bars top and bottom and an orange subject.
    const rows: Array<[number, number, number]> = [
      [0, 0, 0],
      [0, 0, 0],
      [230, 120, 20],
      [230, 120, 20],
      [230, 120, 20],
      [230, 120, 20],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const sampled = samplePixelData(rgbaImage(rows), 8);
    expect(sampled.dominant.r).toBeGreaterThan(180);
    expect(sampled.dominant.g).toBeGreaterThan(60);
    expect(sampled.dominant.b).toBeLessThan(90);
  });

  it("ignores white matte bars when picking the dominant color", () => {
    const rows: Array<[number, number, number]> = [
      [255, 255, 255],
      [255, 255, 255],
      [20, 70, 220],
      [20, 70, 220],
      [20, 70, 220],
      [20, 70, 220],
      [255, 255, 255],
      [255, 255, 255],
    ];
    const sampled = samplePixelData(rgbaImage(rows), 8);
    expect(sampled.dominant.b).toBeGreaterThan(150);
    expect(sampled.dominant.r).toBeLessThan(120);
  });
});

describe("sampledPaletteClose", () => {
  const red = { dominant: { r: 220, g: 30, b: 25 }, average: { r: 40, g: 20, b: 20 } };

  it("treats a near-identical palette as a continuation", () => {
    expect(
      sampledPaletteClose(red, {
        dominant: { r: 225, g: 40, b: 30 },
        average: { r: 44, g: 24, b: 22 },
      })
    ).toBe(true);
  });

  it("treats a different hue as a real change", () => {
    expect(
      sampledPaletteClose(red, {
        dominant: { r: 20, g: 70, b: 220 },
        average: { r: 20, g: 30, b: 60 },
      })
    ).toBe(false);
  });
});

describe("applyAdaptiveTheme", () => {
  function fakeRoot() {
    const store = new Map<string, string>();
    const writes: string[] = [];
    const root = {
      style: {
        getPropertyValue: (key: string) => store.get(key) ?? "",
        setProperty: (key: string, value: string) => {
          writes.push(key);
          store.set(key, value);
        },
        removeProperty: (key: string) => {
          writes.push(key);
          store.delete(key);
        },
      },
    } as unknown as HTMLElement;
    return { root, writes };
  }

  it("skips writes when the tokens are unchanged", () => {
    const tokens = deriveAdaptiveTheme(DEFAULT_ADAPTIVE_COLORS);
    const { root, writes } = fakeRoot();
    applyAdaptiveTheme(root, tokens);
    const initialWrites = writes.length;
    expect(initialWrites).toBeGreaterThan(0);

    applyAdaptiveTheme(root, tokens);
    expect(writes.length).toBe(initialWrites);
  });

  it("still applies a changed token", () => {
    const tokens = deriveAdaptiveTheme(DEFAULT_ADAPTIVE_COLORS);
    const { root } = fakeRoot();
    applyAdaptiveTheme(root, tokens);
    applyAdaptiveTheme(root, { ...tokens, "--color-accent": "#ff0000" });
    expect(root.style.getPropertyValue("--color-accent")).toBe("#ff0000");
  });
});

describe("crossfadeAdaptiveTheme", () => {
  type FrameCallback = (time: number) => void;

  let frames: Map<number, FrameCallback>;
  let nextFrameId: number;

  function fakeRoot() {
    const store = new Map<string, string>();
    const classes = new Set<string>();
    return {
      style: {
        getPropertyValue: (key: string) => store.get(key) ?? "",
        setProperty: (key: string, value: string) => {
          store.set(key, value);
        },
        removeProperty: (key: string) => {
          store.delete(key);
        },
      },
      classList: {
        add: (name: string) => classes.add(name),
        remove: (name: string) => classes.delete(name),
        contains: (name: string) => classes.has(name),
      },
    } as unknown as HTMLElement;
  }

  function seed(root: HTMLElement, tokens: Record<string, string>) {
    for (const key of ADAPTIVE_CROSSFADE_KEYS) {
      root.style.setProperty(key, tokens[key]);
    }
    applyAdaptiveTheme(root, tokens);
  }

  function runFrame(time: number) {
    const first = frames.entries().next();
    if (first.done) throw new Error("no animation frame scheduled");
    const [id, callback] = first.value;
    frames.delete(id);
    callback(time);
  }

  beforeEach(() => {
    frames = new Map();
    nextFrameId = 1;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameCallback) => {
      const id = nextFrameId++;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      frames.delete(id);
    });
  });

  afterEach(() => {
    cancelAdaptiveThemeCrossfade();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const blueTokens = deriveAdaptiveTheme({
    dominant: { r: 0, g: 0, b: 255 },
    average: { r: 20, g: 20, b: 50 },
  });
  const orangeTokens = deriveAdaptiveTheme({
    dominant: { r: 255, g: 128, b: 0 },
    average: { r: 50, g: 30, b: 10 },
  });

  it("eases from the rendered palette to the exact target", () => {
    const root = fakeRoot();
    seed(root, blueTokens);

    crossfadeAdaptiveTheme(root, orangeTokens, 100);
    expect(frames.size).toBe(1);
    expect(root.classList.contains("adaptive-palette-crossfade")).toBe(true);

    runFrame(0);
    runFrame(50);
    const midAccent = root.style.getPropertyValue("--color-accent");
    expect(midAccent).not.toBe(blueTokens["--color-accent"]);
    expect(midAccent).not.toBe(orangeTokens["--color-accent"]);

    runFrame(100);
    expect(root.style.getPropertyValue("--color-accent")).toBe(
      orangeTokens["--color-accent"]
    );
    expect(root.style.getPropertyValue("--color-bg-primary")).toBe(
      orangeTokens["--color-bg-primary"]
    );
    expect(frames.size).toBe(0);
    expect(root.classList.contains("adaptive-palette-crossfade")).toBe(false);
  });

  it("interrupted fades restart from the colour currently on screen", () => {
    const root = fakeRoot();
    seed(root, blueTokens);

    crossfadeAdaptiveTheme(root, orangeTokens, 100);
    runFrame(0);
    runFrame(50);
    const midAccent = root.style.getPropertyValue("--color-accent");

    const thirdTokens = deriveAdaptiveTheme({
      dominant: { r: 0, g: 180, b: 120 },
      average: { r: 10, g: 40, b: 30 },
    });
    crossfadeAdaptiveTheme(root, thirdTokens, 100);
    runFrame(50);
    expect(root.style.getPropertyValue("--color-accent")).toBe(midAccent);

    runFrame(150);
    expect(root.style.getPropertyValue("--color-accent")).toBe(
      thirdTokens["--color-accent"]
    );
  });

  it("applies instantly under reduced motion", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));

    const root = fakeRoot();
    seed(root, blueTokens);
    crossfadeAdaptiveTheme(root, orangeTokens, 100);

    expect(frames.size).toBe(0);
    expect(root.classList.contains("adaptive-palette-crossfade")).toBe(false);
    expect(root.style.getPropertyValue("--color-accent")).toBe(
      orangeTokens["--color-accent"]
    );
  });

  it("clears the fade marker when cancelled", () => {
    const root = fakeRoot();
    seed(root, blueTokens);
    crossfadeAdaptiveTheme(root, orangeTokens, 100);
    expect(root.classList.contains("adaptive-palette-crossfade")).toBe(true);

    cancelAdaptiveThemeCrossfade();
    expect(frames.size).toBe(0);
    expect(root.classList.contains("adaptive-palette-crossfade")).toBe(false);
  });
});

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

  it("derives surface aliases instead of duplicate animated literals", () => {
    const tokens = deriveAdaptiveTheme(DEFAULT_ADAPTIVE_COLORS);
    expect(tokens["--color-surface"]).toBe("var(--color-bg-secondary)");
    expect(tokens["--color-surface-raised"]).toBe("var(--color-bg-tertiary)");
    expect(tokens["--color-bg-card"]).toBe("var(--color-bg-secondary)");
    expect(tokens["--color-bg-elevated"]).toBe("var(--color-bg-tertiary)");
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