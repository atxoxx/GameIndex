/**
 * Live telemetry for the in-game overlay.
 *
 * NOTE(electron-port): this is a deliberately small stand-in for the Rust
 * `metrics_collector`. It samples what Node can read without native code —
 * whole-machine CPU utilisation and RAM pressure — and emits them as
 * `overlay:metrics` samples at the configured interval.
 *
 * GPU load, VRAM, temperatures, power, clocks and FPS are NOT sampled: they
 * need vendor SDKs / shared-memory readers (NVML, D3DKMT, RTSS) that the
 * Electron build does not ship. Their keys are omitted from the payload rather
 * than sent as zeros, because the overlay widgets render every missing metric
 * as "—" (see `PerformanceWidget`) and a fabricated 0% would read as real
 * telemetry.
 */
import os from "node:os";

export interface OverlayMetricsSample {
  cpu: number;
  ram: number;
  [key: string]: number | undefined;
}

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
  return Math.min(100, Math.max(0, Math.round(value * 10) / 10));
}

let timer: NodeJS.Timeout | null = null;
let lastCpu: CpuTimes | null = null;

/** One sample, measured against the previous one for CPU utilisation. */
export function readSample(): OverlayMetricsSample {
  const current = readCpuTimes();
  let cpu = 0;
  if (lastCpu) {
    const totalDelta = current.total - lastCpu.total;
    const idleDelta = current.idle - lastCpu.idle;
    if (totalDelta > 0) cpu = (1 - idleDelta / totalDelta) * 100;
  }
  lastCpu = current;

  const totalMem = os.totalmem();
  const ram = totalMem > 0 ? (1 - os.freemem() / totalMem) * 100 : 0;

  return { cpu: clampPercent(cpu), ram: clampPercent(ram) };
}

/** Start (or restart) the sampler. Callbacks fire on the Node event loop. */
export function startLiveMetrics(
  intervalMs: number,
  onSample: (sample: OverlayMetricsSample) => void,
): void {
  stopLiveMetrics();
  // Seed the baseline so the first emitted sample covers one real interval.
  lastCpu = readCpuTimes();
  const interval = Math.max(100, Math.round(intervalMs) || 1000);
  timer = setInterval(() => {
    try {
      onSample(readSample());
    } catch (error) {
      console.error("[overlay] metrics sample failed:", error);
    }
  }, interval);
  // The sampler must never keep the app alive on its own.
  timer.unref?.();
}

export function stopLiveMetrics(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  lastCpu = null;
}

export function isLiveMetricsRunning(): boolean {
  return timer !== null;
}
