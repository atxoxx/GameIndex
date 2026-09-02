import { useEffect, useState } from "react";
import {
  boostSaturation,
  medianCutQuantize,
  rgbToHex,
  selectGamePalette,
  type WeightedPixel,
} from "../utils/color";

/**
 * A small coherent palette extracted from a game's cover/hero art.
 *
 * `primary` drives the global accent, `secondary` the global gradient
 * partner (`--color-accent-2`), and `deep` the global deepened wash
 * (`--color-accent-deep`) — all applied together via
 * `applyGameAccentFamily`. The same values also tint the hero locally
 * through the `--game-accent` scope.
 */
export interface GameAccentPalette {
  /** Dominant art color, `rgb(r, g, b)` — drives the global accent. */
  primary: string;
  /** A second real artwork color, hex — global `--color-accent-2`
   *  plus hero gradients/borders. Falls back to a harmonized shade
   *  for monochrome art. */
  secondary: string;
  /** Darkest chromatic artwork color, hex — global `--color-accent-deep`
   *  plus hero washes and depth. */
  deep: string;
}

/** Cap the in-memory URL cache so a long browsing session stays bounded. */
const MAX_CACHE_SIZE = 100;
const PALETTE_CACHE = new Map<string, GameAccentPalette>();

/** Sample size for the off-DOM canvas — 48×48 keeps the per-pixel pass
 *  (~2 300 weighted pixels) negligible while preserving color identity. */
const SAMPLE_SIZE = 48;

/**
 * useGameAccent
 *
 * Samples a game's cover/hero art with a tiny off-DOM <canvas>, quantizes
 * the pixels with weighted median-cut, and derives a small palette whose
 * members are *actual artwork colors*: the dominant vibrant cluster drives
 * the accent, a second clearly-different cluster becomes the gradient
 * partner, and the darkest chromatic cluster becomes the deep wash. Falls
 * back to `null` so callers can keep using the global `--color-accent`.
 *
 * Design notes:
 *  - Median-cut replaces the old center-weighted *average*, which mixed
 *    distinct colors together (a red/white cover read as pink). Quantized
 *    clusters preserve the real hues, and center-bias + vibrancy weights
 *    nudge the split toward the subject instead of letterbox bars.
 *  - A URL cache avoids re-decoding the same cover on repeat visits; the
 *    per-game result is deterministic for a given image.
 *  - CORS: Tauri `asset://` / `http(s)://` images with
 *    crossOrigin="anonymous" decode fine locally; if sampling throws
 *    (tainted canvas / broken URL) we simply keep the fallback.
 *  - The effect runs after the image loads, not on every render.
 */
export function useGameAccent(
  imageUrl: string | null | undefined
): GameAccentPalette | null {
  const [palette, setPalette] = useState<GameAccentPalette | null>(null);

  useEffect(() => {
    if (!imageUrl) {
      setPalette(null);
      return;
    }

    const cached = PALETTE_CACHE.get(imageUrl);
    if (cached) {
      setPalette(cached);
      return;
    }

    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      if (cancelled) return;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = SAMPLE_SIZE;
        canvas.height = SAMPLE_SIZE;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
        const { data } = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);

        // Weighted pixel list: skip transparency, then weight by center
        // bias (cover subjects sit mid-frame) and vibrancy so letterbox
        // bars and dull fills lose out to the actual artwork.
        const pixels: WeightedPixel[] = [];
        for (let y = 0; y < SAMPLE_SIZE; y++) {
          for (let x = 0; x < SAMPLE_SIZE; x++) {
            const i = (y * SAMPLE_SIZE + x) * 4;
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            if (data[i + 3] < 128) continue;
            const chroma = Math.max(r, g, b) - Math.min(r, g, b);
            const dx = x - SAMPLE_SIZE / 2;
            const dy = y - SAMPLE_SIZE / 2;
            const distWeight = 1 + (SAMPLE_SIZE - Math.hypot(dx, dy)) / SAMPLE_SIZE;
            const w = distWeight * (1 + (chroma / 255) * 1.5);
            pixels.push({ r, g, b, w });
          }
        }
        if (pixels.length === 0) return;

        const clusters = medianCutQuantize(pixels, 6);
        const chosen = selectGamePalette(clusters);
        if (!chosen) return;

        const primary = boostSaturation(chosen.primary);
        const result: GameAccentPalette = {
          primary: `rgb(${primary.r}, ${primary.g}, ${primary.b})`,
          secondary: rgbToHex(chosen.secondary),
          deep: rgbToHex(chosen.deep),
        };

        if (PALETTE_CACHE.size >= MAX_CACHE_SIZE) {
          const firstKey = PALETTE_CACHE.keys().next().value;
          if (firstKey) PALETTE_CACHE.delete(firstKey);
        }
        PALETTE_CACHE.set(imageUrl, result);

        setPalette(result);
      } catch {
        // tainted canvas / decode failure → keep fallback
      }
    };

    img.onerror = () => {
      if (!cancelled) setPalette(null);
    };

    img.src = imageUrl;

    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  return palette;
}
