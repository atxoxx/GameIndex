/**
 * Module-level bandwidth history shared by the whole app.
 *
 * The telemetry chart is a page-local component, but its samples must not
 * vanish when the user navigates away or reloads. Owning the rolling window
 * (and a throttled localStorage copy) here keeps one continuous time series
 * for the app's lifetime instead of restarting on every mount.
 */

export interface BandwidthPoint {
  /** Epoch milliseconds - lets the chart honor the real time window. */
  ts: number;
  time: string;
  down: number;
  up: number;
}

const MAX_SAMPLES = 300;
const STORAGE_KEY = "gamelib.bandwidth.history.v1";
const MAX_SAMPLE_AGE_MS = MAX_SAMPLES * 1000;
const SAVE_EVERY_TICKS = 5;

let samples: BandwidthPoint[] = [];
let speeds = { down: 0, up: 0 };
let intervalId: ReturnType<typeof setInterval> | null = null;
let ticksSinceSave = 0;
let hydrated = false;
const listeners = new Set<() => void>();

function clockTime(ts: number): string {
  const date = new Date(ts);
  return `${date.getHours().toString().padStart(2, "0")}:${date
    .getMinutes()
    .toString()
    .padStart(2, "0")}:${date.getSeconds().toString().padStart(2, "0")}`;
}

function isBandwidthPoint(value: unknown): value is BandwidthPoint {
  if (typeof value !== "object" || value === null) return false;
  const point = value as Record<string, unknown>;
  return (
    typeof point.ts === "number" &&
    Number.isFinite(point.ts) &&
    typeof point.time === "string" &&
    typeof point.down === "number" &&
    typeof point.up === "number"
  );
}

export function parseStoredBandwidthSamples(raw: string | null): BandwidthPoint[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isBandwidthPoint);
  } catch {
    return [];
  }
}

/**
 * Append a sample, trimming to the rolling cap. A run of identical idle
 * samples carries no visual information, so it is skipped instead of
 * growing the window with copies.
 */
export function appendBandwidthSample(
  previous: BandwidthPoint[],
  point: BandwidthPoint,
  maxSamples = MAX_SAMPLES,
): BandwidthPoint[] {
  if (point.down === 0 && point.up === 0) {
    const last = previous[previous.length - 1];
    if (last && last.down === 0 && last.up === 0) return previous;
  }
  const next = [...previous, point];
  return next.length > maxSamples ? next.slice(next.length - maxSamples) : next;
}

function hydrate() {
  if (hydrated) return;
  hydrated = true;
  if (typeof localStorage === "undefined") return;
  try {
    const cutoff = Date.now() - MAX_SAMPLE_AGE_MS;
    samples = parseStoredBandwidthSamples(localStorage.getItem(STORAGE_KEY)).filter(
      (sample) => sample.ts >= cutoff,
    );
  } catch {
    samples = [];
  }
}

function persist() {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(samples));
  } catch {
    /* quota or private mode - history is best-effort */
  }
}

function emit() {
  for (const listener of listeners) listener();
}

function tick() {
  if (typeof document !== "undefined" && document.hidden) return;
  const now = Date.now();
  const next = appendBandwidthSample(samples, {
    ts: now,
    time: clockTime(now),
    down: speeds.down,
    up: speeds.up,
  });
  if (next === samples) return;
  samples = next;
  emit();
  ticksSinceSave += 1;
  if (ticksSinceSave >= SAVE_EVERY_TICKS) {
    ticksSinceSave = 0;
    persist();
  }
}

export function setBandwidthSpeeds(down: number, up: number) {
  speeds = { down, up };
}

export function startBandwidthSampling() {
  hydrate();
  if (intervalId !== null) return;
  intervalId = setInterval(tick, 1000);
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", persist);
    window.addEventListener("beforeunload", persist);
    document.addEventListener("visibilitychange", persist);
  }
}

export function getBandwidthSamples(): BandwidthPoint[] {
  hydrate();
  return samples;
}

export function subscribeBandwidthSamples(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
