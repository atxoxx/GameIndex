/**
 * Adaptive Theme Engine
 *
 * Dynamically samples average and dominant colors from game artwork (covers, banners,
 * posters) and synthesizes a full, cohesive dark-ambient design system:
 *  - Tinted surface elevations (Canvas, Surface 1, Surface 2, Hover, Active, Glass Overlay)
 *  - WCAG AAA / AA compliant text hierarchy adapted to the background luminance & hue
 *  - Tactile border hierarchy
 *  - Dynamic vibrant accent family with harmonized gradient partner
 *  - Atmospheric ambient lighting & mesh gradients
 */

import {
  darken,
  harmonizeAccent,
  hslToRgb,
  luminance,
  medianCutQuantize,
  rgbToHex,
  rgbToHsl,
  selectGamePalette,
  textColorFor,
  type RgbColor,
  type WeightedPixel,
} from "./color";

/**
 * Return the smallest HSL lightness (0–1) such that a color of the given hue
 * and saturation reaches `targetRatio` WCAG contrast against a background of
 * the given luminance. Cool hues (blue/purple/teal) carry far less luminance
 * than warm hues at the same HSL lightness, so they need a noticeably lighter
 * accent to stay legible on dark surfaces. Binary-search lightness for speed
 * and determinism (~26 iterations is far more precision than needed).
 */
function minContrastLightness(
  hue: number,
  sat: number,
  bgLum: number,
  targetRatio: number
): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 26; i++) {
    const mid = (lo + hi) / 2;
    const lum = luminance(hslToRgb(hue, sat, mid));
    const lighter = Math.max(lum, bgLum);
    const darker = Math.min(lum, bgLum);
    const ratio = (lighter + 0.05) / (darker + 0.05);
    if (ratio >= targetRatio) {
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return (lo + hi) / 2;
}

export interface SampledColors {
  /** Dominant vibrant/chromatic artwork color — a real quantized cluster,
   *  never a washed-out pixel average. */
  dominant: RgbColor;
  /** Center-weighted average color of the artwork — the ambient tone that
   *  tints the background, where a mix is the point. */
  average: RgbColor;
}

/** In-memory cache for extracted artwork palettes to avoid repeated canvas decoding. */
const COLOR_CACHE = new Map<string, SampledColors>();
const MAX_CACHE_SIZE = 150;

/** Default fallback sampled colors when no artwork is available (sleek dark violet/indigo). */
export const DEFAULT_ADAPTIVE_COLORS: SampledColors = {
  dominant: { r: 124, g: 102, b: 255 },
  average: { r: 35, g: 30, b: 65 },
};

/**
 * All CSS custom properties managed on documentElement by the Adaptive Theme.
 * Used by `applyAdaptiveTheme` to cleanly remove every property when switching
 * away from the adaptive theme.
 */
export const ADAPTIVE_THEME_KEYS: readonly string[] = [
  "--color-bg-primary",
  "--color-bg-secondary",
  "--color-bg-tertiary",
  "--color-bg-hover",
  "--color-bg-active",
  "--color-surface",
  "--color-surface-raised",
  "--color-surface-overlay",
  "--color-surface-glass",
  "--color-bg-card",
  "--color-bg-elevated",
  "--color-border",
  "--color-border-light",
  "--color-border-highlight",
  "--color-border-faint",
  "--color-border-glow",
  "--color-text-primary",
  "--color-text-secondary",
  "--color-text-tertiary",
  "--color-text-muted",
  "--color-text-inverse",
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
  "--color-focus-ring",
  "--shadow-glow",
];

/** Sample size for the off-DOM canvas — 48×48 keeps the per-pixel pass
 *  (~2 300 weighted pixels) negligible while preserving color identity. */
const SAMPLE_SIZE = 48;

/**
 * Turn raw RGBA pixel data into the sampled colors the adaptive theme
 * consumes. Pure and synchronous so the canvas plumbing in
 * `sampleArtworkColors` stays thin and this can be unit-tested.
 *
 * The dominant color is the primary cluster from weighted median-cut — an
 * actual artwork color — while the average stays a plain center-weighted
 * mean, since it only feeds the ambient background tint where a mix is
 * the point.
 */
export function samplePixelData(
  data: Uint8ClampedArray,
  size: number
): SampledColors {
  const pixels: WeightedPixel[] = [];
  let avgR = 0;
  let avgG = 0;
  let avgB = 0;
  let avgCount = 0;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (data[i + 3] < 128) continue; // skip transparent pixels

      const dx = x - size / 2;
      const dy = y - size / 2;
      const distWeight = 1 + (size - Math.hypot(dx, dy)) / size;
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      // Center bias + vibrancy weight so letterbox bars and dull fills lose
      // out to the actual subject; the average is chroma-free (center bias
      // only) because it is the ambient tone.
      const w = distWeight * (1 + (chroma / 255) * 1.5);
      pixels.push({ r, g, b, w });

      avgR += r * distWeight;
      avgG += g * distWeight;
      avgB += b * distWeight;
      avgCount += distWeight;
    }
  }

  const average: RgbColor =
    avgCount > 0
      ? {
          r: Math.round(avgR / avgCount),
          g: Math.round(avgG / avgCount),
          b: Math.round(avgB / avgCount),
        }
      : DEFAULT_ADAPTIVE_COLORS.average;

  const chosen = selectGamePalette(medianCutQuantize(pixels, 8));
  return {
    dominant: chosen ? chosen.primary : average,
    average,
  };
}

/**
 * Sample the ambient average and the dominant *actual artwork color* from
 * an image URL using a tiny 48×48 offscreen canvas + weighted median-cut.
 *
 * Resolves `null` when no usable sample can be extracted (missing URL,
 * load timeout, network error, or a canvas that is tainted/CORS-blocked)
 * so callers can keep their current palette instead of snapping to the
 * default fallback colors.
 */
export function sampleArtworkColors(imageUrl: string): Promise<SampledColors | null> {
  if (!imageUrl) {
    return Promise.resolve(null);
  }

  const cached = COLOR_CACHE.get(imageUrl);
  if (cached) {
    return Promise.resolve(cached);
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    const timeout = setTimeout(() => {
      img.src = "";
      resolve(null);
    }, 4000);

    img.onload = () => {
      clearTimeout(timeout);
      try {
        const canvas = document.createElement("canvas");
        canvas.width = SAMPLE_SIZE;
        canvas.height = SAMPLE_SIZE;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          resolve(null);
          return;
        }

        ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
        const result = samplePixelData(
          ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data,
          SAMPLE_SIZE
        );

        if (COLOR_CACHE.size >= MAX_CACHE_SIZE) {
          const firstKey = COLOR_CACHE.keys().next().value;
          if (firstKey) COLOR_CACHE.delete(firstKey);
        }
        COLOR_CACHE.set(imageUrl, result);

        resolve(result);
      } catch {
        resolve(null);
      }
    };

    img.onerror = () => {
      clearTimeout(timeout);
      resolve(null);
    };

    img.src = imageUrl;
  });
}

/**
 * Derive the full set of Adaptive theme CSS custom properties from sampled artwork colors.
 */
export function deriveAdaptiveTheme(sampled: SampledColors): Record<string, string> {
  const domHsl = rgbToHsl(sampled.dominant);
  const avgHsl = rgbToHsl(sampled.average);

  // Hue from vibrant dominant art color; saturation blended with average
  const hue = domHsl.h;
  const baseSat = Math.max(0.15, Math.min(0.95, (domHsl.s * 0.7 + avgHsl.s * 0.3)));

  // ── Background & Surface Elevation Ladder ─────────────────────────
  // Deep, rich, subtly-tinted obsidian surfaces with calibrated lightness & saturation
  const bgSat1 = Math.min(0.24, baseSat * 0.38);
  const bgSat2 = Math.min(0.22, baseSat * 0.34);
  const bgSat3 = Math.min(0.20, baseSat * 0.30);
  const bgSat4 = Math.min(0.18, baseSat * 0.26);
  const bgSat5 = Math.min(0.16, baseSat * 0.22);

  const bgPrimaryRgb = hslToRgb(hue, bgSat1, 0.038);
  const bgSecondaryRgb = hslToRgb(hue, bgSat2, 0.068);
  const bgTertiaryRgb = hslToRgb(hue, bgSat3, 0.105);
  const bgHoverRgb = hslToRgb(hue, bgSat4, 0.145);
  const bgActiveRgb = hslToRgb(hue, bgSat5, 0.195);

  const bgPrimaryHex = rgbToHex(bgPrimaryRgb);
  const bgSecondaryHex = rgbToHex(bgSecondaryRgb);
  const bgTertiaryHex = rgbToHex(bgTertiaryRgb);
  const bgHoverHex = rgbToHex(bgHoverRgb);
  const bgActiveHex = rgbToHex(bgActiveRgb);

  // ── Text Hierarchy with Guaranteed Contrast ────────────────────────
  // Text is tinted slightly towards the warm/cool tone of the game for cohesion,
  // while ensuring WCAG AAA (> 12:1) for primary and AA (> 7:1 / > 4.5:1) for secondary/tertiary.
  const textPrimaryRgb = hslToRgb(hue, 0.14, 0.965);
  const textSecondaryRgb = hslToRgb(hue, 0.18, 0.76);
  const textTertiaryRgb = hslToRgb(hue, 0.22, 0.625);
  const textMutedRgb = hslToRgb(hue, 0.16, 0.56);

  const textPrimaryHex = rgbToHex(textPrimaryRgb);
  const textSecondaryHex = rgbToHex(textSecondaryRgb);
  const textTertiaryHex = rgbToHex(textTertiaryRgb);
  const textMutedHex = rgbToHex(textMutedRgb);
  const textInverseHex = "#050508";

  // ── Accent Family ──────────────────────────────────────────────────
  // Vibrant, punchy accent tailored for high legibility and button contrast.
  // HSL lightness is not a good proxy for perceived contrast across hues:
  // a saturated blue/purple accent at the same lightness as a red/orange one
  // has far lower WCAG contrast against a dark surface. So instead of a fixed
  // lightweight clamp we blend the artwork-derived lightness upwards — per hue —
  // until the accent clears 4.5:1 against the resting card surfaces. This keeps
  // cool-toned artwork (blues, purples, teals) from producing accents that
  // vanish as accent text/icons/badges on near-black cards.
  const accentSat = Math.max(0.72, domHsl.s);
  const preferredLightness = Math.min(0.62, Math.max(0.48, domHsl.l));
  // Accent text/icons/badges sit on the page background and on cards
  // (primary/secondary/tertiary), not on the transient hover/active states,
  // so guarantee 4.5:1 against the lightest of those three surfaces.
  const targetBgLum = Math.max(
    luminance(bgPrimaryRgb),
    luminance(bgSecondaryRgb),
    luminance(bgTertiaryRgb)
  );
  // Target slightly above 4.5 so the binary-search midpoint approaches the
  // boundary from the safe side, keeping the final accent above 4.5:1.
  const requiredLightness = minContrastLightness(hue, accentSat, targetBgLum, 4.6);
  const accentLightness = Math.min(0.72, Math.max(preferredLightness, requiredLightness));
  const accentRgb = hslToRgb(hue, accentSat, accentLightness);
  const accentHex = rgbToHex(accentRgb);

  const partnerRgb = harmonizeAccent(accentRgb);
  const partnerHex = rgbToHex(partnerRgb);
  const deepenedHex = rgbToHex(darken(accentRgb, 0.4));
  const accentContrast = textColorFor(accentHex);

  const secR = Math.round(bgSecondaryRgb.r);
  const secG = Math.round(bgSecondaryRgb.g);
  const secB = Math.round(bgSecondaryRgb.b);

  return {
    "--color-bg-primary": bgPrimaryHex,
    "--color-bg-secondary": bgSecondaryHex,
    "--color-bg-tertiary": bgTertiaryHex,
    "--color-bg-hover": bgHoverHex,
    "--color-bg-active": bgActiveHex,

    "--color-surface": bgSecondaryHex,
    "--color-surface-raised": bgTertiaryHex,
    "--color-surface-overlay": `rgba(${Math.round(bgPrimaryRgb.r)}, ${Math.round(bgPrimaryRgb.g)}, ${Math.round(bgPrimaryRgb.b)}, 0.92)`,
    "--color-surface-glass": `rgba(${secR}, ${secG}, ${secB}, 0.74)`,

    "--color-bg-card": bgSecondaryHex,
    "--color-bg-elevated": bgTertiaryHex,

    "--color-border": "color-mix(in srgb, var(--color-text-primary) 10%, transparent)",
    "--color-border-light": "color-mix(in srgb, var(--color-text-primary) 14%, transparent)",
    "--color-border-highlight": "color-mix(in srgb, var(--color-accent) 35%, transparent)",
    "--color-border-faint": "color-mix(in srgb, var(--color-text-primary) 5.5%, transparent)",
    "--color-border-glow": "color-mix(in srgb, var(--color-accent) 40%, transparent)",

    "--color-text-primary": textPrimaryHex,
    "--color-text-secondary": textSecondaryHex,
    "--color-text-tertiary": textTertiaryHex,
    "--color-text-muted": textMutedHex,
    "--color-text-inverse": textInverseHex,

    "--color-accent": accentHex,
    "--color-accent-2": partnerHex,
    "--color-accent-deep": deepenedHex,
    "--color-accent-contrast": accentContrast,
    "--color-accent-hover": "color-mix(in srgb, var(--color-accent) 85%, white 15%)",
    "--color-accent-active": "color-mix(in srgb, var(--color-accent) 70%, black 30%)",
    "--color-accent-glow": "color-mix(in srgb, var(--color-accent) 30%, transparent)",
    "--color-accent-soft": `color-mix(in srgb, var(--color-accent) 13%, var(--color-bg-secondary))`,
    "--color-accent-border": "color-mix(in srgb, var(--color-accent) 35%, transparent)",
    "--color-accent-surface": `color-mix(in srgb, var(--color-accent) 6%, var(--color-bg-secondary))`,
    "--color-accent-subtle": "color-mix(in srgb, var(--color-accent) 4%, transparent)",
    "--color-accent-badge": `color-mix(in srgb, var(--color-accent) 15%, var(--color-bg-secondary))`,
    "--color-accent-laser": "var(--color-accent)",
    "--color-accent-gradient": "linear-gradient(135deg, var(--color-accent) 0%, var(--color-accent-2) 100%)",
    "--color-accent-gradient-strong": "linear-gradient(135deg, var(--color-accent) 0%, var(--color-accent-2) 58%, var(--color-accent-active) 100%)",

    "--brand-1": "var(--color-accent)",
    "--brand-2": "var(--color-accent-2)",
    "--brand-3": "var(--color-accent-hover)",
    "--brand-4": "var(--color-accent)",
    "--brand-gradient": "linear-gradient(135deg, var(--color-accent) 0%, var(--color-accent-2) 100%)",
    "--brand-gradient-strong": "linear-gradient(135deg, var(--color-accent) 0%, var(--color-accent-2) 58%, var(--color-accent-active) 100%)",

    "--mesh-gradient": `radial-gradient(ellipse 75% 55% at 20% -8%, color-mix(in srgb, var(--color-accent) 9%, transparent) 0%, transparent 62%), radial-gradient(ellipse 60% 45% at 85% 2%, color-mix(in srgb, var(--color-accent-2) 7%, transparent) 0%, transparent 58%), radial-gradient(ellipse 90% 35% at 50% 102%, color-mix(in srgb, var(--color-accent) 4%, transparent) 0%, transparent 70%)`,
    "--color-bg-gradient": `radial-gradient(ellipse 86% 70% at 50% -12%, color-mix(in srgb, var(--color-accent) 14%, var(--color-bg-primary)) 0%, var(--color-bg-secondary) 48%, var(--color-bg-primary) 100%)`,
    "--color-focus-ring": "color-mix(in srgb, var(--color-accent) 55%, transparent)",
    "--shadow-glow": "0 0 20px var(--color-accent-glow)",
  };
}

/**
 * Apply or remove adaptive theme tokens on an element (typically documentElement).
 */
export function applyAdaptiveTheme(
  root: HTMLElement,
  tokens: Record<string, string> | null
): void {
  if (!root) return;

  if (!tokens) {
    for (const key of ADAPTIVE_THEME_KEYS) {
      root.style.removeProperty(key);
    }
    return;
  }

  for (const [key, value] of Object.entries(tokens)) {
    root.style.setProperty(key, value);
  }
}
