import type { OverlayMetrics } from "../../context/OverlayContext";

/**
 * Pure helpers for the overlay's rolling telemetry window.
 *
 * Kept off the React tree so the FPS statistics shown in the panel's
 * performance deep-dive can be unit-tested without rendering anything.
 */

/** A summarised FPS distribution over the retained samples. */
export interface FpsStats {
  /** Mean of the samples. */
  avg: number;
  /** Lowest sample. */
  min: number;
  /** Highest sample. */
  max: number;
  /** "1% low": mean of the worst 1% of frames (always ≥ 1 sample). */
  low1: number;
  /** "0.1% low": mean of the worst 0.1% of frames (always ≥ 1 sample). */
  low01: number;
  /** Number of samples that fed the statistics. */
  count: number;
}

/** Collect the finite values of one metric out of the rolling window. */
export function metricSeries(
  history: OverlayMetrics[],
  key: keyof OverlayMetrics,
): number[] {
  const out: number[] = [];
  for (const sample of history) {
    const value = sample[key];
    if (typeof value === "number" && Number.isFinite(value)) out.push(value);
  }
  return out;
}

/** Mean of the `fraction` worst samples (at least one). */
function worstAverage(sortedAsc: number[], fraction: number): number {
  const take = Math.max(1, Math.ceil(sortedAsc.length * fraction));
  const slice = sortedAsc.slice(0, take);
  return slice.reduce((sum, value) => sum + value, 0) / slice.length;
}

/**
 * Summarise a series of FPS values. Returns `null` when there is nothing
 * finite to report, so callers render a dash instead of a fabricated number.
 */
export function computeFpsStats(values: number[]): FpsStats | null {
  const clean = values.filter((v) => Number.isFinite(v) && v > 0);
  if (clean.length === 0) return null;

  const sorted = [...clean].sort((a, b) => a - b);
  const sum = clean.reduce((acc, v) => acc + v, 0);
  return {
    avg: sum / clean.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    low1: worstAverage(sorted, 0.01),
    low01: worstAverage(sorted, 0.001),
    count: clean.length,
  };
}

/** Largest finite value in the series, or `null` when empty. */
export function peakOf(values: number[]): number | null {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length === 0) return null;
  return clean.reduce((max, v) => (v > max ? v : max), clean[0]);
}

/** Format a megabyte count as "x.x / y.y GB" (or "x MB" without a total). */
export function formatVram(usedMb?: number, totalMb?: number): string | null {
  if (typeof usedMb !== "number" || !Number.isFinite(usedMb)) return null;
  const usedGb = usedMb / 1024;
  if (typeof totalMb === "number" && Number.isFinite(totalMb) && totalMb > 0) {
    return `${usedGb.toFixed(1)} / ${(totalMb / 1024).toFixed(0)} GB`;
  }
  return usedMb >= 1024 ? `${usedGb.toFixed(1)} GB` : `${Math.round(usedMb)} MB`;
}
