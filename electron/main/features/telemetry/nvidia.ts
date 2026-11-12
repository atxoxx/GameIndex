/**
 * NVIDIA GPU sensors via `nvidia-smi`.
 *
 * Every NVIDIA driver installs `nvidia-smi`, so GPU temperature, core clock and
 * utilisation are available without LibreHardwareMonitor. It is used as a
 * fallback: LHM wins for temperatures when it runs (it also covers AMD/Intel and
 * CPU temps), and the Windows GPU Engine counters win for utilisation.
 *
 * One short-lived query every couple of seconds, cached synchronously so the
 * sampler never waits. Any failure (no driver, timeout, laptop dGPU asleep)
 * leaves the values `null` rather than guessing.
 */
import { spawn } from "node:child_process";

const REFRESH_MS = 2_000;
const STALE_MS = 15_000;
const TIMEOUT_MS = 1_500;

export interface NvidiaSensors {
  gpuTempC: number | null;
  gpuClockMhz: number | null;
  utilPercent: number | null;
  memoryUsedMb: number | null;
  memoryTotalMb: number | null;
  adapters: string[];
  at: number;
}

interface CachedNvidia extends NvidiaSensors {
  pending: boolean;
  unavailableUntil: number;
}

const EMPTY: CachedNvidia = {
  gpuTempC: null,
  gpuClockMhz: null,
  utilPercent: null,
  memoryUsedMb: null,
  memoryTotalMb: null,
  adapters: [],
  at: 0,
  pending: false,
  unavailableUntil: 0,
};

let cache: CachedNvidia = { ...EMPTY };

function number(value: string): number | null {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Parse `index, name, temp, clock, util, usedMb, totalMb` lines. Exported for
 * tests; names may contain commas in theory, so everything after the first
 * field is joined back and the numeric tail is split from the right.
 */
export function parseNvidiaSmi(output: string): {
  rows: {
    name: string;
    gpuTempC: number | null;
    gpuClockMhz: number | null;
    utilPercent: number | null;
    memoryUsedMb: number | null;
    memoryTotalMb: number | null;
  }[];
} {
  const rows = [];
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(",").map((part) => part.trim());
    if (parts.length < 7) continue;
    // index, name (may contain commas), then five numeric values.
    const index = parts[0];
    const tail = parts.slice(-5);
    const name = parts.slice(1, parts.length - 5).join(", ") || `GPU ${index}`;
    const util = number(tail[2]);
    rows.push({
      name,
      gpuTempC: number(tail[0]),
      gpuClockMhz: number(tail[1]),
      utilPercent: util === null ? null : Math.max(0, Math.min(100, util)),
      memoryUsedMb: number(tail[3]),
      memoryTotalMb: number(tail[4]),
    });
  }
  return { rows };
}

function pump(): void {
  const now = Date.now();
  if (cache.pending) return;
  if (cache.unavailableUntil > now) return;
  if (cache.at > 0 && now - cache.at < REFRESH_MS) return;

  cache.pending = true;
  let settled = false;
  const finish = (next: Partial<CachedNvidia>, unavailable = false): void => {
    if (settled) return;
    settled = true;
    cache = {
      ...cache,
      ...next,
      at: unavailable ? cache.at : Date.now(),
      pending: false,
      unavailableUntil: unavailable ? Date.now() + 60_000 : 0,
    };
  };

  const child = spawn(
    "nvidia-smi",
    [
      "--query-gpu=index,name,temperature.gpu,clocks.gr,utilization.gpu,memory.used,memory.total",
      "--format=csv,noheader,nounits",
    ],
    { windowsHide: true, shell: false },
  );
  let stdout = "";
  const timer = setTimeout(() => {
    child.kill();
    finish({}, true);
  }, TIMEOUT_MS);

  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
    if (stdout.length > 16_384) stdout = stdout.slice(0, 16_384);
  });
  child.on("error", () => {
    clearTimeout(timer);
    finish({}, true);
  });
  child.on("close", (code) => {
    clearTimeout(timer);
    if (code !== 0) {
      finish({}, true);
      return;
    }
    const { rows } = parseNvidiaSmi(stdout);
    if (rows.length === 0) {
      finish({}, true);
      return;
    }
    // The busiest adapter is the one rendering the game; temperature is the
    // hottest reading across adapters (an idle second GPU reads lower).
    const busiest = rows.reduce((best, row) =>
      (row.utilPercent ?? 0) > (best.utilPercent ?? 0) ? row : best,
    );
    const temps = rows
      .map((row) => row.gpuTempC)
      .filter((value): value is number => value !== null && value > 0);
    const clocks = rows
      .map((row) => row.gpuClockMhz)
      .filter((value): value is number => value !== null && value > 0);
    const memory = rows
      .map((row) => ({ used: row.memoryUsedMb, total: row.memoryTotalMb }))
      .filter((row) => row.total !== null)
      .sort((a, b) => (b.total ?? 0) - (a.total ?? 0))[0];

    finish({
      gpuTempC: temps.length > 0 ? Math.max(...temps) : null,
      gpuClockMhz: clocks.length > 0 ? Math.max(...clocks) : null,
      utilPercent: busiest.utilPercent,
      memoryUsedMb: memory?.used ?? null,
      memoryTotalMb: memory?.total ?? null,
      adapters: rows.map((row) => row.name),
    });
  });
  child.unref();
}

/** Cached reading; safe to call synchronously on the sampler cadence. */
export function peekNvidia(): NvidiaSensors {
  const now = Date.now();
  if (cache.at > 0 && now - cache.at > STALE_MS) {
    return { ...EMPTY, adapters: cache.adapters, at: cache.at };
  }
  return {
    gpuTempC: cache.gpuTempC,
    gpuClockMhz: cache.gpuClockMhz,
    utilPercent: cache.utilPercent,
    memoryUsedMb: cache.memoryUsedMb,
    memoryTotalMb: cache.memoryTotalMb,
    adapters: cache.adapters,
    at: cache.at,
  };
}

export function pumpNvidia(): void {
  pump();
}

export function nvidiaDiagnostics(): { available: boolean; at: number; adapters: string[] } {
  return { available: cache.at > 0, at: cache.at, adapters: cache.adapters };
}
