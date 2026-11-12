/**
 * Per-session telemetry (CPU / RAM).
 *
 * Stand-in for `src-tauri/src/metrics_collector.rs` that samples exactly what
 * Node can read without native code:
 *
 *  • `cpu` — whole-machine utilisation, from `os.cpus()` time deltas.
 *  • `ram` — whole-machine memory pressure, from `os.freemem()`.
 *  • `memMb` — the game process's working set, taken from the process
 *    snapshot the watcher already has.
 *
 * FPS, GPU load, VRAM and temperatures are NOT sampled (they need vendor SDKs /
 * RTSS shared memory). Their keys are omitted rather than reported as zeros, so
 * the Activity charts show "—" instead of fake telemetry.
 */
import os from "node:os";

export interface MetricSample {
  /** Unix ms when the sample was taken. */
  t: number;
  cpu: number;
  ram: number;
  /** Game process working set in MB, omitted when unknown. */
  memMb?: number;
}

export interface SessionMetricsSnapshot {
  avgCpuUsage: number;
  avgRamUsage: number;
  avgProcessRamMb?: number;
  samples: MetricSample[];
}

/** Samples kept in memory per session (≈2.8 h at one sample / 5 s). */
const MAX_SAMPLES = 2000;

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

export interface SessionMetrics {
  /** Take one sample (caller throttles the cadence). */
  sample: (workingSetBytes: number | null) => MetricSample;
  /** Aggregates + every sample buffered so far. */
  snapshot: () => SessionMetricsSnapshot;
  /** Samples collected since the last flush (for crash-safe persistence). */
  drainPending: () => MetricSample[];
  sampleCount: () => number;
}

/** Create a sampler for one session. */
export function createSessionMetrics(): SessionMetrics {
  let lastCpu = readCpuTimes();
  const samples: MetricSample[] = [];
  const pending: MetricSample[] = [];
  let cpuTotal = 0;
  let ramTotal = 0;
  let memTotal = 0;
  let memCount = 0;

  const sample = (workingSetBytes: number | null): MetricSample => {
    const current = readCpuTimes();
    let cpu = 0;
    const totalDelta = current.total - lastCpu.total;
    const idleDelta = current.idle - lastCpu.idle;
    if (totalDelta > 0) cpu = (1 - idleDelta / totalDelta) * 100;
    lastCpu = current;

    const totalMem = os.totalmem();
    const ram = totalMem > 0 ? (1 - os.freemem() / totalMem) * 100 : 0;

    const entry: MetricSample = {
      t: Date.now(),
      cpu: clampPercent(cpu),
      ram: clampPercent(ram),
    };
    if (workingSetBytes && workingSetBytes > 0) {
      entry.memMb = Math.round(workingSetBytes / (1024 * 1024));
      memTotal += entry.memMb;
      memCount += 1;
    }

    cpuTotal += entry.cpu;
    ramTotal += entry.ram;
    samples.push(entry);
    if (samples.length > MAX_SAMPLES) samples.shift();
    pending.push(entry);
    return entry;
  };

  return {
    sample,
    snapshot: () => {
      const count = samples.length;
      const snapshot: SessionMetricsSnapshot = {
        avgCpuUsage: count > 0 ? Math.round((cpuTotal / count) * 10) / 10 : 0,
        avgRamUsage: count > 0 ? Math.round((ramTotal / count) * 10) / 10 : 0,
        samples: [...samples],
      };
      if (memCount > 0) {
        snapshot.avgProcessRamMb = Math.round((memTotal / memCount) * 10) / 10;
      }
      return snapshot;
    },
    drainPending: () => pending.splice(0, pending.length),
    sampleCount: () => samples.length,
  };
}
