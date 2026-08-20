import { useEffect, useState } from "react";
import { darken, harmonizeAccent, rgbToHex, type RgbColor } from "../utils/color";

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
  /** Harmonized gradient partner hue, hex — global `--color-accent-2`
   *  plus hero gradients/borders. */
  secondary: string;
  /** Deepened primary, hex — global `--color-accent-deep` plus hero
   *  washes and depth. */
  deep: string;
}

/**
 * useGameAccent
 *
 * Samples the dominant color from a game's cover/hero art using a
 * tiny off-DOM <canvas>, then derives a small palette from it for
 * tinting the hero (accent stripe, status dot, KPI tiles) with the
 * game's own colors. Falls back to `null` so callers can keep using
 * the global `--color-accent`.
 *
 * Design notes:
 *  - We draw the image scaled down to 16×16 (cheap) and read the
 *    center-weighted average — good enough for a pleasant tint and
 *    avoids the cost of a full dominant-color algorithm.
 *  - The secondary + deep members are derived in JS from the primary
 *    (hue-harmonized partner + darkened wash) rather than sampled
 *    independently: a real second-cluster sample would double the
 *    failure surface for marginal gain, while the harmonic partner is
 *    always coherent with the primary and never jars against it.
 *  - CORS: Tauri `asset://` / `http(s)://` images with
 *    crossOrigin="anonymous" decode fine locally; if sampling throws
 *    (tainted canvas / broken URL) we simply keep the fallback.
 *  - The effect is debounced off the main paint: it runs after the
 *    image loads, not on every render.
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

    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      if (cancelled) return;
      try {
        const size = 16;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);

        let r = 0;
        let g = 0;
        let b = 0;
        let count = 0;
        // Prioritize chromatic vibrancy and center bias so dominant artwork colors
        // shine while skipping noisy dark letterboxes and blown-out whites.
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const i = (y * size + x) * 4;
            const pr = data[i];
            const pg = data[i + 1];
            const pb = data[i + 2];
            const max = Math.max(pr, pg, pb);
            const min = Math.min(pr, pg, pb);
            const chroma = max - min;
            if (chroma < 14) continue; // skip dull grays and near-black
            if (max > 246 && min > 200) continue; // skip near-white

            // Center bias + chromatic weight (vibrant pixels count significantly more)
            const dx = x - size / 2;
            const dy = y - size / 2;
            const distWeight = 1 + (size - Math.hypot(dx, dy)) / size;
            const chromaWeight = 1 + (chroma / 255) * 2.5;
            const w = distWeight * chromaWeight;

            r += pr * w;
            g += pg * w;
            b += pb * w;
            count += w;
          }
        }
        if (count === 0) {
          // Fallback pass: sample average if artwork is predominantly dark/monochrome
          for (let i = 0; i < data.length; i += 4) {
            const pr = data[i];
            const pg = data[i + 1];
            const pb = data[i + 2];
            if (Math.max(pr, pg, pb) < 18 || Math.min(pr, pg, pb) > 240) continue;
            r += pr;
            g += pg;
            b += pb;
            count++;
          }
        }
        if (count === 0) return;
        r = Math.round(r / count);
        g = Math.round(g / count);
        b = Math.round(b / count);

        // Ensure healthy saturation and balanced luminance for UI usage
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const mid = (max + min) / 2;
        if (max - min < 45) {
          r = Math.min(255, Math.max(0, Math.round(mid + (r - mid) * 1.55)));
          g = Math.min(255, Math.max(0, Math.round(mid + (g - mid) * 1.55)));
          b = Math.min(255, Math.max(0, Math.round(mid + (b - mid) * 1.55)));
        }

        const rgb: RgbColor = { r, g, b };
        setPalette({
          primary: `rgb(${r}, ${g}, ${b})`,
          secondary: rgbToHex(harmonizeAccent(rgb)),
          deep: rgbToHex(darken(rgb, 0.4)),
        });
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
