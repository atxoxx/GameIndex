/**
 * Color utility — dynamic accent generation and hex/RGB helpers.
 *
 * Used by ThemeContext to auto-derive accent-adjacent colors
 * (hover, active, glow, soft) from a base accent hex so that
 * custom themes don't need to hand-tune every shade.
 */

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface AccentStates {
  base: string;
  hover: string;
  active: string;
  glow: string;
  soft: string;
}

/** Parse a 3- or 6-char hex string (with or without `#`) into RGB. */
export function hexToRgb(hex: string): RgbColor {
  let h = hex.replace("#", "");
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  const num = parseInt(h, 16);
  return {
    r: (num >> 16) & 0xff,
    g: (num >> 8) & 0xff,
    b: num & 0xff,
  };
}

/** Convert RGB object back to `#rrggbb` hex. */
export function rgbToHex({ r, g, b }: RgbColor): string {
  const clamp = (v: number) => Math.min(255, Math.max(0, Math.round(v)));
  return `#${[clamp(r), clamp(g), clamp(b)]
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * Lighten an RGB color by mixing it with white.
 * @param factor 0–1 where 0 = no change, 1 = full white.
 */
export function lighten(color: RgbColor, factor: number): RgbColor {
  const f = Math.min(1, Math.max(0, factor));
  return {
    r: color.r + (255 - color.r) * f,
    g: color.g + (255 - color.g) * f,
    b: color.b + (255 - color.b) * f,
  };
}

/**
 * Darken an RGB color by mixing it with black.
 * @param factor 0–1 where 0 = no change, 1 = full black.
 */
export function darken(color: RgbColor, factor: number): RgbColor {
  const f = Math.min(1, Math.max(0, factor));
  return {
    r: color.r * (1 - f),
    g: color.g * (1 - f),
    b: color.b * (1 - f),
  };
}

/**
 * Generate CSS-ready accent state tokens from a base hex color.
 *
 * Returns `color-mix()`-based strings for `hover`, `active`,
 * `glow`, and `soft`, which can be dropped directly into
 * CSS custom properties or inline styles.
 *
 * Also returns the base hex and an `rgb` object with
 * programmatically computed lighten/darken values for
 * canvas or dynamic style use.
 */
export function generateAccentStates(baseHex: string): {
  base: string;
  hover: string;
  active: string;
  glow: string;
  soft: string;
  /** JS-computed RGB equivalents (useful for canvas, inline style overrides). */
  js: { hover: string; active: string };
} {
  const rgb = hexToRgb(baseHex);

  return {
    base: baseHex,
    hover: `color-mix(in srgb, ${baseHex} 85%, white 15%)`,
    active: `color-mix(in srgb, ${baseHex} 70%, black 30%)`,
    glow: `color-mix(in srgb, ${baseHex} 25%, transparent)`,
    soft: `color-mix(in srgb, ${baseHex} 15%, var(--color-bg-secondary))`,
    js: {
      hover: rgbToHex(lighten(rgb, 0.15)),
      active: rgbToHex(darken(rgb, 0.3)),
    },
  };
}

/**
 * Compute relative luminance from RGB (sRGB, linearized).
 * Used for contrast-ratio calculations and determining whether
 * overlays should use light or dark text.
 */
export function luminance({ r, g, b }: RgbColor): number {
  const linearize = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)
  );
}

/** WCAG AA contrast ratio between two hex colors (1–21). */
export function contrastRatio(hex1: string, hex2: string): number {
  const l1 = luminance(hexToRgb(hex1));
  const l2 = luminance(hexToRgb(hex2));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Returns `#ffffff` or `#050508` depending on which has better
 * contrast against the given background hex.
 */
export function textColorFor(backgroundHex: string): "#ffffff" | "#050508" {
  return contrastRatio(backgroundHex, "#ffffff") >= 4.5
    ? "#ffffff"
    : "#050508";
}

/* ============================================================================
 * HSL helpers + harmonized palette derivation
 * ========================================================================== */

export interface HslColor {
  h: number;
  s: number;
  l: number;
}

/** RGB → HSL (h in degrees 0–360, s/l 0–1). */
export function rgbToHsl({ r, g, b }: RgbColor): HslColor {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      default:
        h = (rn - gn) / d + 4;
    }
    h *= 60;
  }
  return { h, s, l };
}

/** HSL → RGB (h in degrees, s/l 0–1). */
export function hslToRgb(h: number, s: number, l: number): RgbColor {
  const hh = (((h % 360) + 360) % 360) / 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hh * 6) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 1 / 6) {
    r = c;
    g = x;
  } else if (hh < 2 / 6) {
    r = x;
    g = c;
  } else if (hh < 3 / 6) {
    g = c;
    b = x;
  } else if (hh < 4 / 6) {
    g = x;
    b = c;
  } else if (hh < 5 / 6) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

/**
 * Derive a harmonizing companion shade for an accent color.
 *
 * Provides a clean monochromatic / elevated tone rather than a multi-hue
 * clash, lifting lightness and balancing saturation for sharp modern interfaces.
 */
export function harmonizeAccent(color: RgbColor): RgbColor {
  const { h, s, l } = rgbToHsl(color);
  const nextS = Math.min(1, Math.max(0.35, s * 0.95));
  const nextL = Math.min(0.88, Math.max(0.18, l + 0.12));
  return hslToRgb(h, nextS, nextL);
}

/* ============================================================================
 * Weighted median-cut quantization — real palette extraction from pixels
 * ========================================================================== */

/** A sampled pixel with a relative weight (alpha, center bias, vibrancy…). */
export interface WeightedPixel {
  r: number;
  g: number;
  b: number;
  w: number;
}

/** One quantized color: the averaged box + how strongly it was sampled. */
export interface ColorCluster {
  color: RgbColor;
  weight: number;
}

/** A rectangular region of the RGB cube being subdivided by median cut. */
interface QuantizeBox {
  /** Indices into the source pixel array. */
  indices: number[];
  totalWeight: number;
  /** Longest channel span — the split axis. */
  channel: "r" | "g" | "b";
  span: number;
  average: RgbColor;
}

function buildBox(pixels: WeightedPixel[], indices: number[]): QuantizeBox {
  let minR = 255, minG = 255, minB = 255;
  let maxR = 0, maxG = 0, maxB = 0;
  let sumR = 0, sumG = 0, sumB = 0, totalWeight = 0;
  for (const idx of indices) {
    const { r, g, b, w } = pixels[idx];
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
    if (g < minG) minG = g;
    if (g > maxG) maxG = g;
    if (b < minB) minB = b;
    if (b > maxB) maxB = b;
    sumR += r * w;
    sumG += g * w;
    sumB += b * w;
    totalWeight += w;
  }
  const spanR = maxR - minR;
  const spanG = maxG - minG;
  const spanB = maxB - minB;
  const channel =
    spanR >= spanG && spanR >= spanB ? "r" : spanG >= spanB ? "g" : "b";
  const span = Math.max(spanR, spanG, spanB);
  const count = indices.length;
  return {
    indices,
    totalWeight,
    channel,
    span,
    average:
      count === 0
        ? { r: 0, g: 0, b: 0 }
        : {
            r: Math.round(sumR / totalWeight),
            g: Math.round(sumG / totalWeight),
            b: Math.round(sumB / totalWeight),
          },
  };
}

/**
 * Split a box at the weighted median along its widest channel.
 * Returns `null` when a half would be empty (box can't split further).
 */
function splitBox(
  box: QuantizeBox,
  pixels: WeightedPixel[]
): { a: QuantizeBox; b: QuantizeBox } | null {
  const sorted = [...box.indices].sort(
    (i, j) => pixels[i][box.channel] - pixels[j][box.channel]
  );
  let acc = 0;
  const halfway = box.totalWeight / 2;
  let cut = 1;
  for (; cut < sorted.length; cut++) {
    acc += pixels[sorted[cut - 1]].w;
    if (acc >= halfway) break;
  }
  if (cut === 0 || cut >= sorted.length) return null;
  return {
    a: buildBox(pixels, sorted.slice(0, cut)),
    b: buildBox(pixels, sorted.slice(cut)),
  };
}

/**
 * Weighted median-cut quantization: repeatedly split the widest box of the
 * RGB cube until `maxColors` boxes remain (or nothing splits meaningfully),
 * returning each box's weighted average color ordered by sampled weight.
 *
 * Unlike a plain pixel average, the returned colors are actual artwork
 * colors — a red/white cover yields a distinct red and a distinct white,
 * not a washed-out pink. Cheap at the 48×48 sample sizes we feed it.
 */
export function medianCutQuantize(
  pixels: WeightedPixel[],
  maxColors = 6
): ColorCluster[] {
  if (pixels.length === 0) return [];
  const boxes: QuantizeBox[] = [buildBox(pixels, pixels.map((_, i) => i))];

  while (boxes.length < Math.max(1, maxColors)) {
    let widestIdx = 0;
    let widestSpan = -1;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].span > widestSpan) {
        widestSpan = boxes[i].span;
        widestIdx = i;
      }
    }
    // A nearly-uniform box (span ≤ 12) carries no new information — stop
    // rather than minting noise clusters from anti-aliased edge pixels.
    if (widestSpan <= 12) break;
    const split = splitBox(boxes[widestIdx], pixels);
    if (!split) break;
    boxes.splice(widestIdx, 1, split.a, split.b);
  }

  return boxes
    .map((b) => ({ color: b.average, weight: b.totalWeight }))
    .sort((a, b) => b.weight - a.weight);
}

/** Channel difference (chroma) of an RGB color. */
function chromaOf({ r, g, b }: RgbColor): number {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

/** Shortest angular hue distance (0–180°) between two HSL hues. */
function hueDistance(h1: number, h2: number): number {
  const d = Math.abs(h1 - h2);
  return Math.min(d, 360 - d);
}

/**
 * Lift a muted color just enough to read as a UI accent, preserving hue
 * and luminance balance. Matches the boost previously inlined into the
 * cover-art sampler so muted artwork still produces a usable accent.
 */
export function boostSaturation(color: RgbColor): RgbColor {
  const max = Math.max(color.r, color.g, color.b);
  const min = Math.min(color.r, color.g, color.b);
  if (max - min >= 45) return color;
  const mid = (max + min) / 2;
  return {
    r: Math.min(255, Math.max(0, Math.round(mid + (color.r - mid) * 1.55))),
    g: Math.min(255, Math.max(0, Math.round(mid + (color.g - mid) * 1.55))),
    b: Math.min(255, Math.max(0, Math.round(mid + (color.b - mid) * 1.55))),
  };
}

/** The three roles a game palette must fill for the accent family. */
export interface GamePaletteSelection {
  /** Dominant chromatic artwork color — drives the global accent. */
  primary: RgbColor;
  /** A second real artwork color for gradients/borders. */
  secondary: RgbColor;
  /** Darkest chromatic artwork color for deepened washes. */
  deep: RgbColor;
}

/**
 * Turn quantized clusters into the accent roles the UI consumes.
 *
 * The primary is the most prominent *and* vibrant cluster (prominence ×
 * chroma), not merely the biggest one — a giant near-gray background loses
 * to a smaller, punchier logo color the way it would lose a human glance.
 * The secondary is the next real color whose hue clearly differs from the
 * primary (falling back to a harmonized shade for monochrome art), and the
 * deep wash is the darkest chromatic cluster rather than a blind darkening
 * of the primary, so the full family reflects what the artwork actually
 * contains.
 */
export function selectGamePalette(
  clusters: ColorCluster[]
): GamePaletteSelection | null {
  // Keep clusters that could plausibly serve as UI colors: chromatic enough
  // to carry identity, not crushed to black, not blown out to white.
  const usable = clusters.filter(
    (c) =>
      c.weight > 0 &&
      chromaOf(c.color) >= 14 &&
      luminance(c.color) > 0.03 &&
      luminance(c.color) < 0.94
  );
  if (usable.length === 0) return null;

  let primary = usable[0];
  let bestScore = -Infinity;
  for (const c of usable) {
    const score = Math.pow(c.weight, 0.65) * (0.5 + chromaOf(c.color) / 255);
    if (score > bestScore) {
      bestScore = score;
      primary = c;
    }
  }

  const primaryHue = rgbToHsl(primary.color).h;
  const minSecondaryWeight = Math.max(2, usable[0].weight * 0.12);
  const secondary = usable.find(
    (c) =>
      c !== primary &&
      c.weight >= minSecondaryWeight &&
      hueDistance(rgbToHsl(c.color).h, primaryHue) >= 45 &&
      luminance(c.color) > 0.1
  );
  // A 45°+ partner adds real two-tone richness; when the art is mostly one
  // hue, take the best *different* cluster at all, else synthesize one.
  const secondary2 = usable.find(
    (c) =>
      c !== primary &&
      c.weight >= minSecondaryWeight &&
      hueDistance(rgbToHsl(c.color).h, primaryHue) >= 18
  );

  // The deep wash is meant to be dark, so it scans every cluster (chroma
  // filtering alone keeps crushed grays out) instead of the `usable` set,
  // which demands enough luminance to serve as accent text.
  let deep: ColorCluster | null = null;
  for (const c of clusters) {
    if (c === primary) continue;
    const l = luminance(c.color);
    if (l < 0.45 && chromaOf(c.color) >= 14) {
      if (!deep || l < luminance(deep.color)) deep = c;
    }
  }

  const partner = secondary ?? secondary2;
  return {
    primary: primary.color,
    secondary: partner ? partner.color : harmonizeAccent(primary.color),
    deep: deep ? deep.color : darken(primary.color, 0.45),
  };
}

/**
 * Parse a CSS color literal — `#hex` (3/6 digit) or `rgb()` / `rgba()` —
 * into an RGB object. Alpha is ignored. Returns `null` for anything
 * unrecognized (var() chains, keywords, color-mix, color(srgb …)).
 */
export function parseCssColor(value: string): RgbColor | null {
  const v = value.trim();
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) {
    return hexToRgb(v);
  }
  const m = v.match(
    /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)/i
  );
  if (m) {
    return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
  }
  return null;
}

/**
 * Normalize any CSS color string we can resolve — `#hex`, `rgb()`,
 * `rgba()`, or Chromium's computed `color(srgb r g b / a)` form — into
 * `#rrggbb` hex. Returns `null` for token streams (`var(--…)`,
 * `color-mix(…)`) or anything unparseable.
 */
export function cssColorStringToHex(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) {
    return rgbToHex(hexToRgb(v));
  }
  const rgb = parseCssColor(v);
  if (rgb) return rgbToHex(rgb);
  const srgb = v.match(
    /^color\(\s*srgb\s+([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+%?)/i
  );
  if (srgb) {
    const to255 = (s: string) =>
      s.endsWith("%") ? (parseFloat(s) / 100) * 255 : parseFloat(s) * 255;
    return rgbToHex({
      r: to255(srgb[1]),
      g: to255(srgb[2]),
      b: to255(srgb[3]),
    });
  }
  return null;
}

/* ============================================================================
 * Full accent family — injected on <html> when an accent override is active
 * ========================================================================== */

/**
 * Every CSS custom property the accent override manages on the root.
 * `applyAccentFamily` sets all of them (override active) or removes all
 * of them (cleared), so no stale member of the family survives a reset.
 */
export const ACCENT_FAMILY_KEYS: readonly string[] = [
  "--color-accent",
  "--color-accent-2",
  "--color-accent-deep",
  "--color-accent-contrast",
  "--color-accent-hover",
  "--color-accent-active",
  "--color-accent-glow",
  "--color-accent-soft",
  "--color-accent-border",
  "--color-accent-surface",
  "--color-accent-subtle",
  "--color-accent-badge",
  "--color-accent-laser",
  "--color-accent-gradient",
  "--color-accent-gradient-strong",
  "--brand-1",
  "--brand-2",
  "--brand-3",
  "--brand-4",
  "--brand-gradient",
  "--brand-gradient-strong",
  "--mesh-gradient",
  "--color-bg-gradient",
  "--color-border-glow",
  "--color-focus-ring",
];

/**
 * Build the complete accent token family from a base color.
 *
 * `secondary` (gradient partner → `--color-accent-2`) and `deep`
 * (deepened wash → `--color-accent-deep`) may be supplied when the
 * palette comes from a game's artwork; otherwise both are derived
 * from `baseColor`.
 *
 * Delivers a zero-gradient, ultra-modern precision styling system:
 *  - Solid accent base, hover, active, and contrast tokens.
 *  - High-precision translucent alpha surfaces (soft, badge, subtle, laser).
 *  - Eliminates all multi-hue gradients and noisy background radial blobs.
 */
export function buildAccentFamily(
  baseColor: string,
  secondary?: string | null,
  deep?: string | null
): Record<string, string> | null {
  const rgb = parseCssColor(baseColor);
  if (!rgb) return null;
  const base = rgbToHex(rgb);
  const partner = secondary ?? rgbToHex(harmonizeAccent(rgb));
  const deepened = deep ?? rgbToHex(darken(rgb, 0.4));
  const contrast = textColorFor(base);

  return {
    "--color-accent": base,
    "--color-accent-2": partner,
    "--color-accent-deep": deepened,
    "--color-accent-contrast": contrast,
    "--color-accent-hover":
      "color-mix(in srgb, var(--color-accent) 85%, var(--accent-hover-mix, white) 15%)",
    "--color-accent-active":
      "color-mix(in srgb, var(--color-accent) 70%, black 30%)",
    "--color-accent-glow":
      "color-mix(in srgb, var(--color-accent) var(--accent-glow-strength, 28%), transparent)",
    "--color-accent-soft":
      "color-mix(in srgb, var(--color-accent) var(--accent-soft-strength, 12%), var(--color-bg-secondary))",
    "--color-accent-border":
      "color-mix(in srgb, var(--color-accent) var(--accent-border-strength, 35%), transparent)",
    "--color-accent-surface":
      "color-mix(in srgb, var(--color-accent) 6%, var(--color-bg-secondary))",
    "--color-accent-subtle":
      "color-mix(in srgb, var(--color-accent) 4%, transparent)",
    "--color-accent-badge":
      "color-mix(in srgb, var(--color-accent) 14%, var(--color-bg-secondary))",
    "--color-accent-laser": "var(--color-accent)",
    "--color-accent-gradient": "var(--color-accent)",
    "--color-accent-gradient-strong": "var(--color-accent)",
    "--brand-1": "var(--color-accent)",
    "--brand-2": "var(--color-accent-hover)",
    "--brand-3": "var(--color-accent-hover)",
    "--brand-4": "var(--color-accent)",
    "--brand-gradient": "var(--color-accent)",
    "--brand-gradient-strong": "var(--color-accent)",
    "--mesh-gradient": "none",
    "--color-bg-gradient": "var(--color-bg-primary)",
    "--color-border-glow":
      "color-mix(in srgb, var(--color-accent) 38%, transparent)",
    "--color-focus-ring":
      "color-mix(in srgb, var(--color-accent) 55%, transparent)",
  };
}

/**
 * Apply (or clear) the full accent family on a root element.
 *
 * `baseColor === null` removes every managed property so the theme's
 * own defaults take over. Used by SettingsContext both on change and
 * on hydration, so the palette family is in place before first paint.
 */
export function applyAccentFamily(
  root: HTMLElement,
  baseColor: string | null
): void {
  if (!baseColor) {
    for (const key of ACCENT_FAMILY_KEYS) {
      root.style.removeProperty(key);
    }
    return;
  }
  const guarded = legibleAccentForLuminance(
    baseColor,
    resolveSurfaceLuminance(root)
  );
  const family = buildAccentFamily(guarded);
  if (!family) return;
  for (const [key, value] of Object.entries(family)) {
    root.style.setProperty(key, value);
  }
}

/**
 * Shift a raw accent color just enough to stay legible (default ≥ 4.5:1)
 * against a resting surface, preserving its hue and saturation.
 *
 * A saturated cool accent (blue/purple/teal) at dark artwork luminance has far
 * lower WCAG contrast on near-black cards than a warm accent at the same
 * lightness, so a raw game-cover or user-picked accent can be effectively
 * invisible as accent text/icons/badges. The accent is moved away from the
 * surface tone: brightened on dark surfaces, deepened on light ones.
 *
 * Binary-search lightness between the color's current lightness and the
 * bright/dark bound until it clears `targetRatio`, and back off slightly so
 * the midpoint lands just past the boundary. Returns the adjusted hex; an
 * accent that already clears the bar is untouched.
 */
export function legibleAccentForLuminance(
  accentHex: string,
  bgLum: number,
  targetRatio = 4.5,
  lightnessBound: number | null = null
): string {
  const base = parseCssColor(accentHex);
  if (!base) return accentHex;
  const { h, s, l } = rgbToHsl(base);

  const currently = contrastFromLuminance(luminance(base), bgLum);
  if (currently >= targetRatio) return accentHex;

  const meansDark = bgLum < 0.5;
  let lo = meansDark ? l : 0; // brighten: search upward from current lightness
  let hi = meansDark ? 1 : l; // deepen:  search downward from current lightness
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const lum = luminance(hslToRgb(h, s, mid));
    if (contrastFromLuminance(lum, bgLum) >= targetRatio) {
      if (meansDark) hi = mid;
      else lo = mid;
    } else {
      if (meansDark) lo = mid;
      else hi = mid;
    }
  }
  const bound = lightnessBound ?? (meansDark ? 0.85 : 0.08);
  const lightness = meansDark
    ? Math.min(bound, (lo + hi) / 2)
    : Math.max(bound, (lo + hi) / 2);
  return rgbToHex(hslToRgb(h, s, lightness));
}

/** WCAG contrast ratio between a foreground luminance value and a background
 *  luminance value (1–21). */
function contrastFromLuminance(foreLum: number, bgLum: number): number {
  const lighter = Math.max(foreLum, bgLum);
  const darker = Math.min(foreLum, bgLum);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Resolve the effective resting-surface luminance from a root element's
 * CSS custom properties, falling back to a mid-dark value when unresolved
 * (or when run outside a browser). Used by the accent appliers so a raw
 * accent is guarded against whatever theme is actually active.
 */
function resolveSurfaceLuminance(root: HTMLElement): number {
  try {
    const raw = getComputedStyle(root).getPropertyValue("--color-bg-tertiary");
    const hex = cssColorStringToHex(raw);
    if (hex) return luminance(hexToRgb(hex));
  } catch {
    /* ignore */
  }
  return luminance({ r: 19, g: 21, b: 34 });
}

/** A game-extracted accent palette (`useGameAccent`) forwarded to the
 *  global accent family so the full palette — not just the dominant
 *  color — follows the game. */
export interface AccentPalette {
  primary: string;
  secondary: string;
  deep: string;
}

/**
 * Apply a game-extracted palette as the global accent family.
 *
 * Unlike `applyAccentFamily`, this feeds `secondary` and `deep`
 * through verbatim (gradient partner → `--color-accent-2`, deepened
 * wash → `--color-accent-deep`) instead of re-deriving them from the
 * primary, so every surface that reads the accent family gets the
 * game's full palette. `null` is a no-op so a game with no extractable
 * art keeps whatever accent is currently applied.
 */
export function applyGameAccentFamily(
  root: HTMLElement,
  palette: AccentPalette | null
): void {
  if (!palette) return;
  const surfaceLum = resolveSurfaceLuminance(root);
  // Guard the primary against the active surface so accent *text* stays
  // legible — a raw cool or dark game accent would otherwise be effectively
  // invisible on near-black cards. The secondary partner is guarded the same
  // way (it lifts dark artwork partners without changing their hue); the deep
  // wash is deliberately dark and feeds through verbatim.
  const guardedPrimary = legibleAccentForLuminance(palette.primary, surfaceLum);
  if (!parseCssColor(guardedPrimary)) return;
  const guardedSecondary = palette.secondary
    ? legibleAccentForLuminance(palette.secondary, surfaceLum)
    : guardedPrimary;
  const deepHex =
    cssColorStringToHex(palette.deep) ??
    rgbToHex(darken(parseCssColor(guardedPrimary)!, 0.4));
  const family = buildAccentFamily(guardedPrimary, guardedSecondary, deepHex);
  if (!family) return;
  for (const [key, value] of Object.entries(family)) {
    root.style.setProperty(key, value);
  }
}

/* ============================================================================
 * html2canvas compat: color-mix() removal
 * ========================================================================== */

/**
 * Placeholder rgba() substituted for any `color-mix()` call that
 * could not be resolved. We prefer a half-transparent gray blob in
 * the captured image over aborting the screenshot — a screenshot
 * with one gray patch is more useful than no screenshot at all.
 */
const FALLBACK_PLACEHOLDER = "rgba(127,127,127,0.5)";

/**
 * html2canvas 1.4.1 doesn't understand the CSS Color Module L4
 * `color-mix(in srgb, A pct%, B)` function (it throws "Attempting to
 * parse an unsupported color function 'color'"). This project uses
 * `color-mix()` heavily throughout theme tokens, so we pre-process the
 * cloned document — every `color-mix()` call is resolved against the
 * *original* document's computed style and replaced with an `rgba(...)`
 * literal html2canvas can parse.
 *
 * Call from html2canvas's `onclone` hook, *before* html2canvas reads
 * computed styles:
 *
 *   html2canvas(el, { onclone: resolveHtml2CanvasColorMix });
 *
 * The function scrubs four surfaces:
 *   1. **Recursive CSSOM walk** — every CSSStyleDeclaration reachable
 *      from the cloned document's stylesheets. Recurses into
 *      `@media`, `@supports`, `@keyframes`, `@container`, `@layer`
 *      grouping rules so nested `color-mix()` declarations are caught.
 *   2. **Raw `<style>` textContent** — belt-and-suspenders in case
 *      html2canvas re-parses style-tag text directly.
 *   3. **Inline `style="…"` attributes** — including programmatically
 *      assigned color-mix literals.
 *   4. **Cascading CSS custom properties** on `:root` / `html` /
 *      `[data-theme]` selectors — declared vars are force-set on the
 *      cloned `<html>` element with the resolved rgba so any
 *      downstream `var(--…)` lookup bypasses the unresolved
 *      `color-mix()` definition.
 *
 * Cross-origin stylesheets throw `SecurityError` on `.cssRules`
 * access; those are skipped silently.
 *
 * @param clonedDoc the Document html2canvas just cloned
 * @param _element  passed by html2canvas's `onclone` signature; unused
 *                  (kept for callback-type compatibility)
 * @param sourceDoc the live Document whose computed styles we resolve
 *                  from (defaults to `window.document`)
 */
export function resolveHtml2CanvasColorMix(
  clonedDoc: Document,
  _element?: HTMLElement,
  sourceDoc: Document =
    typeof window !== "undefined" ? window.document : clonedDoc
): void {
  // 1) Recursive CSSOM walker — handles @media, @supports, @keyframes,
  //    @container, @layer, and keyframe blocks in one pass.
  for (let s = 0; s < clonedDoc.styleSheets.length; s++) {
    const sheet = clonedDoc.styleSheets[s] as CSSStyleSheet;
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      // Cross-origin sheet — can't read its rules, leave alone.
      continue;
    }
    walkClonedRules(rules, sourceDoc);
  }

  // 2) Scrub raw <style> element textContent. A successful Phase 1
  //    means this is a no-op; if some browser quirk left the original
  //    text in place (or html2canvas reads textContent directly), this
  //    catches it before html2canvas's parser sees it.
  clonedDoc.querySelectorAll("style").forEach((styleEl) => {
    const text = styleEl.textContent;
    if (!text || !hasCaptureColorFunction(text)) return;
    styleEl.textContent = rewriteCaptureColorValue(text, sourceDoc);
  });

  // 3) Inline [style] attributes on every element. html2canvas's
  //    DocumentCloner bakes the *original* document's computed styles
  //    onto cloned SVG / pseudo / custom elements (copyCSSStyles), and
  //    Chromium serializes computed color-mix() as `color(srgb …)` —
  //    so these attributes can carry a computed `color(` literal even
  //    though no stylesheet ever declared one.
  clonedDoc.querySelectorAll<HTMLElement>("[style]").forEach((el) => {
    const inline = el.getAttribute("style");
    if (!inline || !hasCaptureColorFunction(inline)) return;
    el.setAttribute("style", rewriteCaptureColorValue(inline, sourceDoc));
  });

  // 4) Force-overriding any `:root` / `html` / `[data-theme]`
  //    cascading CSS variable whose declared value is `color-mix(...)`.
  //    Note: because we read declarations from every theme selector in
  //    the live doc, the cloned `<html>` ends up with variables from
  //    every theme, but only the active theme's values affect
  //    `getComputedStyle()` so visual fidelity is preserved.
  overrideClonedCssVars(clonedDoc, sourceDoc);
}

/**
 * Recursive walker over a CSS rule list. Handles nested grouping
 * rules so a `color-mix()` declared inside a media-query body is
 * still rewritten. Caps recursion depth for safety on pathological
 * inputs.
 *
 * Rule type constants (MDN):
 *   - 1  = CSSStyleRule
 *   - 4  = CSSMediaRule
 *   - 7  = CSSKeyframesRule
 *   - 8  = CSSKeyframeRule (e.g. `0% { ... }`)
 *   - 12 = CSSSupportsRule
 *   - 13 = CSSLayerBlockRule
 *   - 14 = CSSContainerRule
 */
function walkClonedRules(
  rules: CSSRuleList,
  sourceDoc: Document,
  depth: number = 0
): void {
  if (depth > 32 || !rules) return;
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i] as CSSRule;
    let type: number;
    try {
      type = rule.type;
    } catch {
      continue;
    }
    // Style / Keyframe declaration blocks — both expose `.style`.
    if (type === 1 || type === 8) {
      const styleRule = rule as CSSStyleRule | CSSKeyframeRule;
      if (!styleRule.style) continue;
      rewriteDeclaration(styleRule.style, sourceDoc);
      continue;
    }
    // Grouping rules — recurse into their nested cssRules.
    if (
      type === 4 || // CSSMediaRule
      type === 7 || // CSSKeyframesRule
      type === 12 || // CSSSupportsRule
      type === 13 || // CSSLayerBlockRule
      type === 14 // CSSContainerRule
    ) {
      try {
        const nested = (rule as CSSGroupingRule | CSSKeyframesRule).cssRules;
        if (nested) walkClonedRules(nested, sourceDoc, depth + 1);
      } catch {
        /* nested access can throw on cross-origin rules */
      }
    }
  }
}

/**
 * Rewrite every property on `style` whose value contains `color-mix(`.
 *
 * Snapshots the property list first because `setProperty` may shift
 * property indices, and preserves the original priority — adding
 * `!important` to a declaration that didn't have one would change the
 * cascade and could flip what html2canvas renders vs. what the live
 * page showed.
 */
function rewriteDeclaration(
  style: CSSStyleDeclaration,
  sourceDoc: Document
): void {
  const props: string[] = [];
  for (let p = 0; p < style.length; p++) {
    props.push(style.item(p));
  }
  for (const prop of props) {
    const val = style.getPropertyValue(prop);
    if (typeof val !== "string" || !hasCaptureColorFunction(val)) continue;
    const next = rewriteCaptureColorValue(val, sourceDoc);
    if (!next || next === val) continue;
    const priority = style.getPropertyPriority(prop);
    try {
      // Empty-string priority means "no `!important`" — preserve
      // original semantics exactly.
      style.setProperty(prop, next, priority || "");
    } catch {
      /* property is invalid for this declaration; ignore */
    }
  }
}

/**
 * For every `color-mix()` declaration on `:root` / `html` /
 * `[data-theme]` in the source doc, force the resolved rgba onto the
 * cloned document's `<html>` element so the cascade no longer relies
 * on the unresolved `color-mix()` value (which html2canvas may walk).
 *
 * Restricts `[data-theme="…"]` selectors to the *active* theme on the
 * cloned doc — the previous revision wrote vars for every theme,
 * letting whichever theme's rule was processed last override the
 * active theme's vars and skew capture colour fidelity.
 */
function overrideClonedCssVars(
  clonedDoc: Document,
  sourceDoc: Document
): void {
  if (!sourceDoc || !sourceDoc.styleSheets) return;
  // Read the active theme *once* from the cloned doc's <html> and
  // pass it down so theme-specific rules are filtered correctly.
  const activeTheme = (
    clonedDoc.documentElement.getAttribute("data-theme") || ""
  ).toLowerCase();
  for (let s = 0; s < sourceDoc.styleSheets.length; s++) {
    let rules: CSSRuleList;
    try {
      rules = sourceDoc.styleSheets[s].cssRules;
    } catch {
      continue;
    }
    collectAndOverrideCssVars(rules, clonedDoc, sourceDoc, activeTheme);
  }
}

function collectAndOverrideCssVars(
  rules: CSSRuleList,
  clonedDoc: Document,
  sourceDoc: Document,
  activeTheme: string = "",
  depth: number = 0
): void {
  if (depth > 32 || !rules) return;
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i] as CSSRule;
    let type: number;
    try {
      type = rule.type;
    } catch {
      continue;
    }
    if (type === 1) {
      const styleRule = rule as CSSStyleRule;
      if (!styleRule.style) continue;
      const sel = (styleRule.selectorText || "").toLowerCase().trim();
      // Decide whether this rule's variables should override the
      // cloned root. `:root` and `html` apply unconditionally;
      // `[data-theme="X"]` only applies if `X` is the active theme;
      // `[data-theme]` (no value) applies when any theme is set.
      let shouldInclude = false;
      if (sel.includes(":root")) {
        shouldInclude = true;
      } else if (sel.split(",").some((part) => /^html\b/.test(part.trim()))) {
        // Compounds like `html.foo`, `html#id`, `html[lang]`, `html:hover`
        // all start with `html` as a complete identifier; comma-splitting
        // handles `html, body` style lists correctly.
        shouldInclude = true;
      } else if (sel.includes("[data-theme")) {
        const m = sel.match(/data-theme\s*=\s*"?([^"\]]+)/);
        if (m) {
          shouldInclude = m[1].trim().toLowerCase() === activeTheme;
        } else {
          shouldInclude = activeTheme.length > 0;
        }
      }
      if (!shouldInclude) continue;
      for (let p = 0; p < styleRule.style.length; p++) {
        const prop = styleRule.style.item(p);
        if (!prop.startsWith("--")) continue;
        const val = styleRule.style.getPropertyValue(prop);
        if (!val || !hasCaptureColorFunction(val)) continue;
        const next = rewriteCaptureColorValue(val, sourceDoc);
        if (!next || next === val) continue;
        try {
          clonedDoc.documentElement.style.setProperty(prop, next, "important");
        } catch {
          /* ignore */
        }
      }
    } else if (
      type === 4 || type === 7 || type === 12 || type === 13 || type === 14
    ) {
      try {
        const nested = (rule as CSSGroupingRule | CSSKeyframesRule).cssRules;
        if (nested) {
          // Carry `activeTheme` through recursion so nested theme-scoped
          // rules (e.g. `[data-theme="dark"]` inside an `@media` block)
          // still see the active theme and are included.
          collectAndOverrideCssVars(
            nested,
            clonedDoc,
            sourceDoc,
            activeTheme,
            depth + 1
          );
        }
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Replace every `color-mix(in srgb, A, B)` substring inside a CSS
 * declaration with a computed `rgba(...)` literal.
 *
 * This is a *linear left-to-right* scanner with balanced-paren call
 * detection — earlier revisions tried to fold nested calls in a
 * iterative loop and produced incorrect output for multi-call
 * declarations. We also append a final safety pass that substitutes
 * `rgba(127,127,127,0.5)` for any remaining `color-mix(...)` (e.g.
 * in a browser that doesn't support `in oklab`, etc.) so html2canvas
 * never sees an unrecognized color-function literal.
 */
function rewriteColorMixValue(value: string, sourceDoc: Document): string {
  if (!value.includes("color-mix")) return value;
  if (!sourceDoc || !sourceDoc.body) return value;

  const probe = sourceDoc.createElement("div");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.top = "-9999px";
  probe.style.left = "-9999px";
  sourceDoc.body.appendChild(probe);

  try {
    let out = "";
    let cursor = 0;
    let i = 0;
    while (i < value.length) {
      const idx = value.indexOf("color-mix(", i);
      if (idx === -1) break;
      // Emit the unchanged gap before this call.
      out += value.slice(cursor, idx);
      // Find the matching close paren of this color-mix(...) call.
      let d = 1;
      let j = idx + "color-mix(".length;
      while (j < value.length && d > 0) {
        const c = value[j];
        if (c === "(") d++;
        else if (c === ")") d--;
        j++;
      }
      if (d !== 0) {
        // Malformed — emit the rest verbatim and bail.
        out += value.slice(idx);
        cursor = value.length;
        break;
      }
      const raw = value.slice(idx, j);
      out += resolveColorMixCall(raw, sourceDoc, probe, 0);
      cursor = j;
      i = j;
    }
    out += value.slice(cursor);

    // Safety pass: any `color-mix(...)` that survives (unsupported
    // color space, malformed argument, etc.) is replaced with a
    // neutral placeholder. Without this we'd re-throw the same
    // html2canvas parse error on a single regression.
    return out.replace(/color-mix\s*\([^)]*\)/gi, FALLBACK_PLACEHOLDER);
  } finally {
    if (probe.parentNode) sourceDoc.body.removeChild(probe);
  }
}

/**
 * Rewrite computed `color(srgb r g b / a)` literals inside a CSS value
 * into `rgba(...)`.
 *
 * Chromium serializes the computed value of a `color-mix()` declaration
 * as CSS Color 4's `color(srgb …)` function — NOT as the literal
 * `color-mix(...)` text the stylesheet declares. html2canvas 1.4.1 reads
 * computed styles while cloning (e.g. `copyCSSStyles` bakes them onto
 * SVG and pseudo-element clones as inline styles), so a declaration the
 * `color-mix` scrub already fixed can still surface to html2canvas's
 * parser as an unresolved `color(` function.
 *
 * Runs after `rewriteColorMixValue` so the only remaining `color(`
 * occurrences are standalone computed literals.
 */
function rewriteComputedColorValue(value: string, sourceDoc: Document): string {
  if (!value.includes("color(")) return value;
  if (!sourceDoc || !sourceDoc.body) return value;

  const probe = sourceDoc.createElement("div");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.top = "-9999px";
  probe.style.left = "-9999px";
  sourceDoc.body.appendChild(probe);

  try {
    let out = "";
    let cursor = 0;
    let i = 0;
    while (i < value.length) {
      const idx = value.indexOf("color(", i);
      if (idx === -1) break;
      // Skip idents that merely end in "color(" (e.g. the tail of
      // "-webkit-color(...)") — the full function starts at `color(`.
      if (idx > 0 && /[-\w]/.test(value[idx - 1])) {
        i = idx + 1;
        continue;
      }
      out += value.slice(cursor, idx);
      let d = 1;
      let j = idx + "color(".length;
      while (j < value.length && d > 0) {
        const c = value[j];
        if (c === "(") d++;
        else if (c === ")") d--;
        j++;
      }
      if (d !== 0) {
        out += value.slice(idx);
        cursor = value.length;
        break;
      }
      const raw = value.slice(idx, j);
      probe.style.color = raw;
      const parsed = parseColorString(getComputedStyle(probe).color);
      out += parsed
        ? `rgba(${parsed[0]}, ${parsed[1]}, ${parsed[2]}, ${parsed[3]})`
        : FALLBACK_PLACEHOLDER;
      cursor = j;
      i = j;
    }
    out += value.slice(cursor);

    // Final safety: any `color(...)` that survived (unknown color
    // space, malformed literal) becomes the neutral placeholder so
    // html2canvas never parses an unsupported color function.
    return out.replace(/color\(\s*srgb[^)]*\)/gi, FALLBACK_PLACEHOLDER);
  } finally {
    if (probe.parentNode) sourceDoc.body.removeChild(probe);
  }
}

/**
 * Full capture-time rewrite for a single CSS value: first resolve every
 * declared `color-mix(...)` call, then every computed `color(srgb …)`
 * literal the browser may have serialized.
 */
function rewriteCaptureColorValue(value: string, sourceDoc: Document): string {
  if (!value) return value;
  let out = rewriteColorMixValue(value, sourceDoc);
  out = rewriteComputedColorValue(out, sourceDoc);
  return out;
}

/**
 * True when a CSS value contains anything html2canvas 1.4.1's color
 * parser can't handle: a declared `color-mix(...)` call or a computed
 * `color(srgb …)` literal. `rewriteDeclaration` / the inline-attribute
 * scrub use this to avoid probing values that don't need it.
 */
function hasCaptureColorFunction(value: string): boolean {
  return /color-mix\s*\(|color\(\s*srgb/i.test(value);
}

/**
 * Resolve a single `color-mix(...)` call (raw text including the
 * `color-mix(` prefix and the closing `)`) to a CSS `rgba(...)`
 * literal. Recursively handles nested `color-mix(...)` inside args.
 */
function resolveColorMixCall(
  raw: string,
  sourceDoc: Document,
  probe: HTMLElement,
  depth: number
): string {
  if (depth > 32) return FALLBACK_PLACEHOLDER;
  const inner = raw.slice("color-mix(".length, -1);
  const args = splitTopComma(inner);
  if (args.length < 3) {
    // ES legacy 2-arg form (no color space keyword) — unsupported.
    return FALLBACK_PLACEHOLDER;
  }
  if (!/^\s*in\s+srgb\s*$/i.test(args[0].trim())) {
    // Only `in srgb` is wired up. Don't silently swallow; warn so
    // the dev knows to extend the resolver.
    if (typeof console !== "undefined") {
      // eslint-disable-next-line no-console
      console.warn("[color-mix] Unsupported color space:", args[0]);
    }
    return FALLBACK_PLACEHOLDER;
  }

  let aTok = args[1].trim();
  let pct = 50;
  const aPct = aTok.match(/^(.+?)\s+([\d.]+)%\s*$/);
  if (aPct) {
    aTok = aPct[1].trim();
    pct = parseFloat(aPct[2]);
  }
  const bTok = args[2].trim();

  const a = resolveSingleColor(aTok, sourceDoc, probe, depth + 1);
  const b = resolveSingleColor(bTok, sourceDoc, probe, depth + 1);
  if (!a || !b) return FALLBACK_PLACEHOLDER;
  const w = Math.min(1, Math.max(0, pct / 100));
  const [r, g, bl, al] = mixLinearRgb(a, b, w);
  return `rgba(${r}, ${g}, ${bl}, ${al})`;
}

/**
 * Resolve a CSS color expression — hex, rgb()/rgba(), hsl()/hsla(),
 * a keyword (`white`, `black`, `transparent`), a `var(--…)` chain,
 * or a *nested* `color-mix(...)` call — to a `[r, g, b, a]` tuple.
 *
 * Defining a single helper lets us pre-fold nested color-mix
 * without depending on the runtime browser's color-mix support
 * (Tauri 2.x's WebView on older Windows builds may pre-date Chromium
 * 111 and choke on the function).
 */
function resolveSingleColor(
  token: string,
  sourceDoc: Document,
  probe: HTMLElement,
  depth: number
): [number, number, number, number] | null {
  const trimmed = token.trim();
  if (!trimmed) return null;

  // Nested color-mix(...) — recurse. Bump depth so the cap at 32
  // correctly truncates truly deep nesting rather than collapsing it.
  if (/^color-mix\s*\(/i.test(trimmed)) {
    let d = 1;
    let j = "color-mix(".length;
    while (j < trimmed.length && d > 0) {
      const c = trimmed[j];
      if (c === "(") d++;
      else if (c === ")") d--;
      j++;
    }
    if (d !== 0) return null;
    const raw = trimmed.slice(0, j);
    const rgba = resolveColorMixCall(raw, sourceDoc, probe, depth + 1);
    return parseColorString(rgba);
  }

  // Fold any var() chains so we end up with a single literal/varname
  // pointer that the browser can resolve through getComputedStyle.
  let cur = trimmed;
  let safety = 0;
  while (cur.includes("var(") && safety++ < 32) {
    const idx = cur.indexOf("var(");
    const close = findCloseParen(cur, idx + "var".length);
    if (close < 0) break;
    const varExpr = cur.slice(idx, close + 1);
    const m = varExpr.match(/^var\(\s*(--[\w-]+)/);
    if (!m) break;
    const name = m[1].trim();
    let fallback = "";
    const argContent = varExpr.slice(name.length + "var(".length, -1);
    const topComma = findTopComma(argContent);
    if (topComma >= 0) fallback = argContent.slice(topComma + 1).trim();

    probe.style.color = `var(${name}${fallback ? ", " + fallback : ""})`;
    let resolved = parseColorString(getComputedStyle(probe).color);
    if (!resolved && fallback) {
      probe.style.color = fallback;
      resolved = parseColorString(getComputedStyle(probe).color);
    }
    if (!resolved) return null;
    cur =
      `rgba(${resolved[0]}, ${resolved[1]}, ${resolved[2]}, ${resolved[3]})` +
      cur.slice(close + 1);
  }
  probe.style.color = cur;
  return parseColorString(getComputedStyle(probe).color);
}

/**
 * Split a string on commas that exist at parenthesis depth 0.
 * Useful for splitting `color-mix(...)` / `var(...)` arguments
 * without breaking on commas inside parentheses (e.g. inside the
 * fallback `var(--a, var(--b))`).
 */
function splitTopComma(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(buf);
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf.length) out.push(buf);
  return out;
}

function findCloseParen(s: string, openIdx: number): number {
  let depth = 1;
  for (let j = openIdx; j < s.length; j++) {
    if (s[j] === "(") depth++;
    else if (s[j] === ")") {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}

function findTopComma(s: string): number {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) return i;
  }
  return -1;
}

/**
 * Parse a `getComputedStyle().color`-style string back to `[r,g,b,a]`.
 * Handles `rgb()` / `rgba()` forms and the `transparent` keyword.
 * Returns `null` for unrecognised strings.
 */
function parseColorString(
  raw: string
): [number, number, number, number] | null {
  const v = raw.trim().toLowerCase();
  if (v === "transparent") return [0, 0, 0, 0];
  // Chromium serializes computed `color-mix()` values as CSS Color 4
  // `color(srgb r g b)` — html2canvas 1.4.1 can't parse that function,
  // so recognize it here and convert to the 0-255 channel scale.
  const srgb = v.match(
    /^color\(\s*srgb\s+([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+%?)\s*(?:\/\s*([\d.]+%?))?\s*\)$/i
  );
  if (srgb) {
    const to255 = (s: string) =>
      s.endsWith("%") ? (parseFloat(s) / 100) * 255 : parseFloat(s) * 255;
    const r = Math.max(0, Math.min(255, Math.round(to255(srgb[1]))));
    const g = Math.max(0, Math.min(255, Math.round(to255(srgb[2]))));
    const b = Math.max(0, Math.min(255, Math.round(to255(srgb[3]))));
    let a = 1;
    if (srgb[4] != null) {
      const av = srgb[4];
      a = av.endsWith("%") ? parseFloat(av) / 100 : parseFloat(av);
      a = Number.isFinite(a) ? Math.max(0, Math.min(1, a)) : 1;
    }
    return [r, g, b, a];
  }
  // Match `rgb(r, g, b)` and `rgba(r, g, b, a)`.
  const m = v.match(
    /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i
  );
  if (!m) return null;
  const r = Math.max(0, Math.min(255, Math.round(Number(m[1]))));
  const g = Math.max(0, Math.min(255, Math.round(Number(m[2]))));
  const b = Math.max(0, Math.min(255, Math.round(Number(m[3]))));
  let a = 1;
  if (m[4] != null) {
    const av = m[4];
    a = av.endsWith("%") ? Number(av.slice(0, -1)) / 100 : Number(av);
    a = Number.isFinite(a) ? Math.max(0, Math.min(1, a)) : 1;
  }
  return [r, g, b, a];
}

/** Linear interpolation between two RGBA colors, weight on `a`. */
function mixLinearRgb(
  a: [number, number, number, number],
  b: [number, number, number, number],
  weightA: number
): [number, number, number, number] {
  const w = Math.min(1, Math.max(0, weightA));
  const r = Math.round(a[0] * w + b[0] * (1 - w));
  const g = Math.round(a[1] * w + b[1] * (1 - w));
  const bl = Math.round(a[2] * w + b[2] * (1 - w));
  const al = +(a[3] * w + b[3] * (1 - w)).toFixed(3);
  return [r, g, bl, al];
}

/* ============================================================================
 * Capture-time SVG bridge
 * ========================================================================== */

/**
 * Walk every <svg> element in the cloned document and pin its
 * rendered size to the actual displayed pixel dimensions.
 *
 * html2canvas 1.4.1 has limited SVG support: when an SVG declares
 * its size via `width="100%"` (or any percentage) with a `viewBox`,
 * the rasterizer either draws content at the viewBox native
 * coordinate space or applies its own inconsistent scaling. The
 * result is that chart lines / bars / data-point circles escape
 * past the card that contains them — the line-chart "spillover"
 * visible on the Performance tab of the Activity page.
 *
 * This function replaces the percentage / viewBox-relative width &
 * height attributes with their actual `getBoundingClientRect()`
 * pixel values, and pins `preserveAspectRatio` to the SVG spec
 * default (`xMidYMid meet`). That guarantees html2canvas applies
 * the same viewBox scaling the live browser would, including
 * letterboxing if the rendered aspect ratio doesn't match the
 * viewBox aspect.
 *
 * Skips any SVG whose rect is zero — those are detached / not
 * rendered and forcing dimensions would break sibling layouts.
 */
export function bridgeSvgsForCanvasCapture(clonedDoc: Document): void {
  clonedDoc.querySelectorAll("svg").forEach((svg) => {
    let rect: { width: number; height: number };
    try {
      rect = svg.getBoundingClientRect();
    } catch {
      return;
    }
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    svg.setAttribute("width", String(Math.round(rect.width)));
    svg.setAttribute("height", String(Math.round(rect.height)));
    // Pin preserveAspectRatio so html2canvas's SVG rasterizer scales
    // the viewBox content uniformly with letterboxing, matching the
    // browser's default behavior. Don't override an explicit caller
    // choice — the original may have used `none` deliberately.
    if (!svg.getAttribute("preserveAspectRatio")) {
      svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    }
  });
}

/**
 * One-shot pre-processor for html2canvas capture: chains every
 * `clone-side` fix the Activity & Game pages need into a single
 * callback the user wires to html2canvas's `onclone` option.
 *
 * Currently delegates to:
 *   1. `resolveHtml2CanvasColorMix` — walks the cloned CSSOM to
 *      rewrite every CSS Color Module L4 `color-mix()` call into
 *      an rgba() literal (html2canvas 1.4.1's parser throws on
 *      `color-mix`).
 *   2. `bridgeSvgsForCanvasCapture` — sets explicit pixel
 *      width/height on every cloned <svg> so html2canvas's SVG
 *      rasterizer scales the viewBox content correctly (instead of
 *      letting chart geometry spill past the card).
 *
 * The signature matches html2canvas's `onclone(doc, element)`
 * shape, so it can be passed directly:
 *
 *   html2canvas(el, { onclone: prepareClonedDocumentForCanvasCapture });
 */
export function prepareClonedDocumentForCanvasCapture(
  clonedDoc: Document,
  _element?: HTMLElement,
  sourceDoc: Document =
    typeof window !== "undefined" ? window.document : clonedDoc
): void {
  resolveHtml2CanvasColorMix(clonedDoc, _element, sourceDoc);
  bridgeSvgsForCanvasCapture(clonedDoc);
}

/**
 * Resolve a CSS color expression to a literal `rgb(...)`/`rgba(...)`
 * string that html2canvas 1.4.1 can parse.
 *
 * html2canvas parses the `backgroundColor` *option* as raw CSS text
 * (`parseBackgroundColor` → `parseColor`, before the onclone hook ever
 * runs), so passing `var(--color-bg-secondary)` throws "Attempting to
 * parse an unsupported color function 'var'". Probing through a hidden
 * element lets the browser engine resolve var()/color-mix() chains; the
 * computed value is always a literal rgb()/rgba() the html2canvas
 * parser accepts.
 *
 * @param value    CSS color expression to resolve (var() / color-mix() /
 *                 literal) — pass exactly what the app CSS uses.
 * @param fallback literal color used when the value can't be resolved
 *                 (undefined variable, unsupported color space, or a
 *                 non-browser environment).
 */
export function resolveColorForCapture(
  value: string,
  fallback = "rgba(0, 0, 0, 0)",
): string {
  if (
    typeof window === "undefined" ||
    typeof document === "undefined" ||
    !document.body
  ) {
    return fallback;
  }
  const probe = document.createElement("div");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.top = "-9999px";
  probe.style.left = "-9999px";
  document.body.appendChild(probe);
  try {
    probe.style.backgroundColor = value;
    const resolved = getComputedStyle(probe).backgroundColor;
    // An unresolvable value (undefined var, unsupported color space)
    // collapses to transparent in computed style — fall back.
    if (
      !resolved ||
      resolved === "transparent" ||
      resolved === "rgba(0, 0, 0, 0)" ||
      /var\(/i.test(resolved)
    ) {
      return fallback;
    }
    // Chromium computes `color-mix(...)` to CSS Color 4's `color(srgb …)`
    // which html2canvas 1.4.1 can't parse. Convert it to a literal rgba.
    if (resolved.startsWith("color(")) {
      const parsed = parseColorString(resolved);
      return parsed
        ? `rgba(${parsed[0]}, ${parsed[1]}, ${parsed[2]}, ${parsed[3]})`
        : fallback;
    }
    return resolved;
  } finally {
    probe.remove();
  }
}
