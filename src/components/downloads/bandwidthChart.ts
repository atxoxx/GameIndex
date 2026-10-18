import { formatBytesPerSecond } from "../../types/download";
import type { SpeedUnit } from "../../types/game";

export interface BandwidthSample {
  ts: number;
  time: string;
  down: number;
  up: number;
}

export interface BandwidthScale {
  max: number;
  ticks: number[];
}

/** 1 MiB/s keeps an idle or very slow graph from collapsing into a flat line. */
export const BANDWIDTH_SCALE_FLOOR = 1_048_576;

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(rank, sorted.length - 1))];
}

/** Round up to the next 1 / 2 / 2.5 / 5 × 10ⁿ step. */
export function niceCeil(value: number, floor = BANDWIDTH_SCALE_FLOOR): number {
  if (!Number.isFinite(value) || value <= 0) return floor;
  const exp = Math.floor(Math.log10(value));
  const base = 10 ** exp;
  const frac = value / base;
  const step = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 2.5 ? 2.5 : frac <= 5 ? 5 : 10;
  return Math.max(step * base, floor);
}

/**
 * Pick a Y scale that keeps the bulk of the traffic readable without hiding
 * spikes: typical (95th percentile) traffic drives the scale, but the true
 * peak is guaranteed a place in the upper third of the plot.
 */
export function computeBandwidthScale(
  samples: BandwidthSample[],
  currentDown: number,
  currentUp: number,
): BandwidthScale {
  const downs = samples.map((s) => s.down);
  const ups = samples.map((s) => s.up);
  const peak = Math.max(...downs, ...ups, currentDown, currentUp, 0);
  const typical = Math.max(
    percentile(downs, 0.95),
    percentile(ups, 0.95),
  );
  const max = niceCeil(Math.max(peak * 0.9, typical * 1.45));
  return {
    max,
    ticks: [0, max * 0.25, max * 0.5, max * 0.75, max],
  };
}

/** Axis labels stay short: "5 Mo/s" instead of "5.00 Mo/s". */
export function formatAxisSpeed(
  bytesPerSecond: number,
  unit: SpeedUnit,
  language?: string,
): string {
  const formatted = formatBytesPerSecond(bytesPerSecond, unit, language);
  const [amount, ...rest] = formatted.split(" ");
  const trimmed = amount.includes(".")
    ? amount.replace(/0+$/, "").replace(/\.$/, "")
    : amount;
  return [trimmed, ...rest].join(" ");
}

export function formatClock(ts: number): string {
  const date = new Date(ts);
  return `${date.getHours().toString().padStart(2, "0")}:${date
    .getMinutes()
    .toString()
    .padStart(2, "0")}:${date.getSeconds().toString().padStart(2, "0")}`;
}

export function sliceToWindow(
  samples: BandwidthSample[],
  now: number,
  windowMs: number,
): BandwidthSample[] {
  const cutoff = now - windowMs;
  return samples.filter((sample) => sample.ts >= cutoff);
}

export function timeAxisTicks(
  now: number,
  windowMs: number,
  count: number,
): { ts: number; label: string }[] {
  const safeCount = Math.max(2, count);
  const start = now - windowMs;
  const ticks: { ts: number; label: string }[] = [];
  for (let i = 0; i < safeCount; i++) {
    const ts = start + (windowMs * i) / (safeCount - 1);
    ticks.push({ ts, label: formatClock(ts) });
  }
  return ticks;
}
