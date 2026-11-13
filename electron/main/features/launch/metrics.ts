/**
 * Per-session telemetry.
 *
 * Ported from `src-tauri/src/metrics_collector.rs` (aggregate + per-sample
 * persistence). A sample carries exactly the frontend `PerfSample` contract
 * (`src/types/game.ts`) plus the extras the session row stores:
 *
 *  • CPU %  — whole-machine, from `os.cpus()` time deltas.
 *  • RAM %  — whole-machine pressure, from `os.freemem()`.
 *  • memMb  — the game process's working set (from the watcher snapshot).
 *  • GPU %  — aggregate of the Windows GPU Engine counters (`../telemetry`).
 *  • temps  — LibreHardwareMonitor sensors when it runs, else `null`.
 *  • FPS    — RTSS shared memory when the game is hooked, else `null`.
 *
 * Unknown temperatures are stored as `0` in the sample (the persisted
 * contract's "no sensor" sentinel, same as Rust) and averaged only over real
 * readings; FPS is `null` per sample so "no source" can never read as 0 FPS.
 */
import os from "node:os";
import { readTelemetry, type TelemetryReadout } from "../telemetry";

export interface MetricSample {
  /** Elapsed seconds since this sampler was created (frontend `PerfSample.t`). */
  t: number;
  cpu: number;
  ram: number;
  gpu: number;
  cpuTemp: number;
  gpuTemp: number;
  /** Instantaneous FPS, `null` when no real source reported this tick. */
  fps: number | null;
  /** Game process working set in MB, omitted when unknown. */
  memMb?: number;
  /** GPU core clock in MHz, omitted when no sensor reported it. */
  gpuClockMhz?: number;
}

/**
 * Final per-session payload. Field names match `SessionMetrics` in
 * `src/types/game.ts` (plus the process-RAM/clock extras the Activity UI
 * already tolerates) so the renderer can consume it unchanged.
 */
export interface SessionMetricsSnapshot {
  avgFps: number;
  minFps: number;
  maxFps: number;
  avgCpuUsage: number;
  avgGpuUsage: number;
  avgRamUsage: number;
  avgCpuTemp: number;
  avgGpuTemp: number;
  resolution: string;
  avgProcessRamMb?: number;
  avgGpuClockMhz?: number;
  gpuAdapters?: string[];
  samples: MetricSample[];
}

export interface SampleTarget {
  exePath?: string;
  pid?: number;
  /** Scopes Linux MangoHud CSV lookup to this game. */
  gameId?: string;
}

/** Samples kept in memory per session (≈3.4 h at one sample / 3 s). */
const MAX_SAMPLES = 4096;
/** Points written to `metrics_json` (bucket-averaged above this). */
export const MAX_PERSISTED_SAMPLES = 1200;
/** Raw samples appended to the running row before switching to a stride. */
const DB_SAMPLE_CAP = 900;
/** Once the cap is reached, only every Nth live sample is appended. */
const AFTER_CAP_STRIDE = 10;

interface CpuTimes {
  idle: number;
  total: number;
}

function readCpuTimes(): CpuTimes {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    const times = cpu.times;
    idle += times.idle;
    total += times.user + times.nice + times.sys + times.idle + times.irq;
  }
  return { idle, total };
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.min(100, Math.max(0, value)) * 10) / 10;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function mean(sum: number, count: number): number {
  return count > 0 ? round1(sum / count) : 0;
}

/** Bucket-average a long series so the row stays compact but keeps its shape. */
function downsample(samples: MetricSample[], limit: number): MetricSample[] {
  if (samples.length <= limit) return samples.map((sample) => ({ ...sample }));
  const out: MetricSample[] = [];
  for (let i = 0; i < limit; i += 1) {
    const start = Math.floor((i * samples.length) / limit);
    const end = Math.floor(((i + 1) * samples.length) / limit);
    const bucket = samples.slice(start, Math.max(end, start + 1));
    if (bucket.length === 0) continue;
    let cpu = 0;
    let ram = 0;
    let gpu = 0;
    let gpuCount = 0;
    let cpuTemp = 0;
    let cpuTempCount = 0;
    let gpuTemp = 0;
    let gpuTempCount = 0;
    let mem = 0;
    let memCount = 0;
    let clock = 0;
    let clockCount = 0;
    let fps = 0;
    let fpsCount = 0;
    for (const sample of bucket) {
      cpu += sample.cpu;
      ram += sample.ram;
      gpu += sample.gpu;
      gpuCount += 1;
      if (sample.cpuTemp > 0) {
        cpuTemp += sample.cpuTemp;
        cpuTempCount += 1;
      }
      if (sample.gpuTemp > 0) {
        gpuTemp += sample.gpuTemp;
        gpuTempCount += 1;
      }
      if (typeof sample.memMb === "number" && sample.memMb > 0) {
        mem += sample.memMb;
        memCount += 1;
      }
      if (typeof sample.gpuClockMhz === "number" && sample.gpuClockMhz > 0) {
        clock += sample.gpuClockMhz;
        clockCount += 1;
      }
      if (typeof sample.fps === "number" && sample.fps > 0) {
        fps += sample.fps;
        fpsCount += 1;
      }
    }
    const entry: MetricSample = {
      t: bucket[0].t,
      cpu: round1(cpu / bucket.length),
      ram: round1(ram / bucket.length),
      gpu: round1(gpu / gpuCount),
      cpuTemp: cpuTempCount > 0 ? round1(cpuTemp / cpuTempCount) : 0,
      gpuTemp: gpuTempCount > 0 ? round1(gpuTemp / gpuTempCount) : 0,
      fps: fpsCount > 0 ? round1(fps / fpsCount) : null,
    };
    if (memCount > 0) entry.memMb = Math.round(mem / memCount);
    if (clockCount > 0) entry.gpuClockMhz = Math.round(clock / clockCount);
    out.push(entry);
  }
  return out;
}

export interface SessionMetrics {
  /** Take one sample (the caller throttles the cadence). */
  sample: (workingSetBytes: number | null, target?: SampleTarget) => MetricSample;
  /** Aggregates + every sample buffered so far (downsampled for persistence). */
  snapshot: () => SessionMetricsSnapshot;
  /** Samples to append to the running row (capped; may be empty). */
  drainPending: () => MetricSample[];
  sampleCount: () => number;
}

/** Create a sampler for one session. `source` is injectable for harnesses. */
export function createSessionMetrics(
  source: (exePath: string, pid: number, gameId?: string) => TelemetryReadout | null = readTelemetry,
): SessionMetrics {
  const startedAt = Date.now();
  let lastCpu = readCpuTimes();
  const samples: MetricSample[] = [];
  const pending: { sample: MetricSample; index: number }[] = [];

  let cpuTotal = 0;
  let ramTotal = 0;
  let gpuTotal = 0;
  let gpuCount = 0;
  let cpuTempTotal = 0;
  let cpuTempCount = 0;
  let gpuTempTotal = 0;
  let gpuTempCount = 0;
  let memTotal = 0;
  let memCount = 0;
  let clockTotal = 0;
  let clockCount = 0;
  let fpsTotal = 0;
  let fpsCount = 0;
  let minFps = Number.POSITIVE_INFINITY;
  let maxFps = 0;
  let gpuAdapters: string[] = [];
  let taken = 0;
  let persisted = 0;

  const sample = (workingSetBytes: number | null, target?: SampleTarget): MetricSample => {
    taken += 1;
    const current = readCpuTimes();
    let cpu = 0;
    const totalDelta = current.total - lastCpu.total;
    const idleDelta = current.idle - lastCpu.idle;
    if (totalDelta > 0) cpu = (1 - idleDelta / totalDelta) * 100;
    lastCpu = current;

    const totalMem = os.totalmem();
    const ram = totalMem > 0 ? (1 - os.freemem() / totalMem) * 100 : 0;

    const telemetry = target
      ? source(target.exePath ?? "", target.pid ?? 0, target.gameId)
      : null;
    if (telemetry && telemetry.gpuAdapters.length > 0) gpuAdapters = telemetry.gpuAdapters;

    const entry: MetricSample = {
      t: Math.round(((Date.now() - startedAt) / 1000) * 10) / 10,
      cpu: clampPercent(cpu),
      ram: clampPercent(ram),
      gpu: telemetry?.gpuPercent !== null && telemetry?.gpuPercent !== undefined
        ? clampPercent(telemetry.gpuPercent)
        : 0,
      cpuTemp: telemetry?.cpuTempC !== null && telemetry?.cpuTempC !== undefined
        ? round1(telemetry.cpuTempC)
        : 0,
      gpuTemp: telemetry?.gpuTempC !== null && telemetry?.gpuTempC !== undefined
        ? round1(telemetry.gpuTempC)
        : 0,
      fps: telemetry?.fps !== null && telemetry?.fps !== undefined
        ? round1(telemetry.fps)
        : null,
    };
    if (typeof telemetry?.gpuClockMhz === "number") {
      entry.gpuClockMhz = Math.round(telemetry.gpuClockMhz);
    }
    if (workingSetBytes && workingSetBytes > 0) {
      entry.memMb = Math.round(workingSetBytes / (1024 * 1024));
      memTotal += entry.memMb;
      memCount += 1;
    }

    cpuTotal += entry.cpu;
    ramTotal += entry.ram;
    if (telemetry?.gpuPercent !== null && telemetry?.gpuPercent !== undefined) {
      gpuTotal += entry.gpu;
      gpuCount += 1;
    }
    if (entry.cpuTemp > 0) {
      cpuTempTotal += entry.cpuTemp;
      cpuTempCount += 1;
    }
    if (entry.gpuTemp > 0) {
      gpuTempTotal += entry.gpuTemp;
      gpuTempCount += 1;
    }
    if (typeof entry.gpuClockMhz === "number") {
      clockTotal += entry.gpuClockMhz;
      clockCount += 1;
    }
    if (typeof entry.fps === "number" && entry.fps > 0) {
      fpsTotal += entry.fps;
      fpsCount += 1;
      minFps = Math.min(minFps, entry.fps);
      maxFps = Math.max(maxFps, entry.fps);
    }

    samples.push(entry);
    if (samples.length > MAX_SAMPLES) samples.shift();
    pending.push({ sample: entry, index: taken });
    return entry;
  };

  const snapshot = (): SessionMetricsSnapshot => {
    const count = samples.length;
    const snapshot: SessionMetricsSnapshot = {
      avgFps: fpsCount > 0 ? Math.round(fpsTotal / fpsCount) : 0,
      minFps: fpsCount > 0 ? Math.round(minFps) : 0,
      maxFps: fpsCount > 0 ? Math.round(maxFps) : 0,
      avgCpuUsage: mean(cpuTotal, count),
      avgGpuUsage: mean(gpuTotal, gpuCount),
      avgRamUsage: mean(ramTotal, count),
      avgCpuTemp: mean(cpuTempTotal, cpuTempCount),
      avgGpuTemp: mean(gpuTempTotal, gpuTempCount),
      resolution: "unknown",
      samples: downsample(samples, MAX_PERSISTED_SAMPLES),
    };
    if (memCount > 0) snapshot.avgProcessRamMb = mean(memTotal, memCount);
    if (clockCount > 0) snapshot.avgGpuClockMhz = Math.round(clockTotal / clockCount);
    if (gpuAdapters.length > 0) snapshot.gpuAdapters = [...gpuAdapters];
    return snapshot;
  };

  return {
    sample,
    snapshot,
    drainPending: () => {
      const ready = pending.splice(0, pending.length);
      const out: MetricSample[] = [];
      for (const { sample: entry, index } of ready) {
        if (persisted < DB_SAMPLE_CAP) {
          out.push(entry);
          persisted += 1;
        } else if (index % AFTER_CAP_STRIDE === 0) {
          out.push(entry);
          persisted += 1;
        }
      }
      return out;
    },
    sampleCount: () => samples.length,
  };
}
