/**
 * Live telemetry for the in-game overlay.
 *
 * Sampling is delegated to `features/telemetry` (the same source the session
 * recorder uses): whole-machine CPU/RAM here, plus GPU load from Windows GPU
 * Engine counters, FPS from RTSS shared memory and temperatures/clocks from
 * LibreHardwareMonitor when those tools are running.
 *
 * Missing sources are omitted from the payload rather than sent as zeros: the
 * overlay widgets render every missing metric as "—" (see `PerformanceWidget`),
 * so a fabricated 0 % would read as real telemetry.
 */
import os from "node:os";
import {
  readTelemetry,
  startTelemetry,
  stopTelemetry,
} from "../features/telemetry";

export interface OverlayMetricsSample {
  cpu: number;
  ram: number;
  [key: string]: number | undefined;
}

export interface OverlaySampleTarget {
  /** Executable of the running game, used to look up its RTSS FPS entry. */
  exePath?: string | null;
  pid?: number | null;
  /** Scopes Linux MangoHud CSV lookup to the running game. */
  gameId?: string | null;
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
export function readSample(target?: OverlaySampleTarget): OverlayMetricsSample {
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

  const sample: OverlayMetricsSample = {
    cpu: clampPercent(cpu),
    ram: clampPercent(ram),
  };

  try {
    const telemetry = readTelemetry(
      target?.exePath ?? "",
      target?.pid ?? 0,
      target?.gameId ?? undefined,
    );
    if (telemetry.gpuPercent !== null) sample.gpu = telemetry.gpuPercent;
    if (telemetry.fps !== null) sample.fps = telemetry.fps;
    if (telemetry.cpuTempC !== null && telemetry.cpuTempC > 0) {
      sample.cpuTemp = telemetry.cpuTempC;
    }
    if (telemetry.gpuTempC !== null && telemetry.gpuTempC > 0) {
      sample.gpuTemp = telemetry.gpuTempC;
    }
    if (telemetry.gpuClockMhz !== null && telemetry.gpuClockMhz > 0) {
      sample.gpuClock = telemetry.gpuClockMhz;
    }
  } catch (error) {
    // A failing auxiliary source must never stop CPU/RAM sampling.
    console.error("[overlay] telemetry read failed:", error);
  }

  return sample;
}

/** Start (or restart) the sampler. Callbacks fire on the Node event loop. */
export function startLiveMetrics(
  intervalMs: number,
  onSample: (sample: OverlayMetricsSample) => void,
  target?: OverlaySampleTarget,
): void {
  stopLiveMetrics();
  // Seed the baseline so the first emitted sample covers one real interval.
  lastCpu = readCpuTimes();
  startTelemetry();
  const interval = Math.max(100, Math.round(intervalMs) || 1000);
  timer = setInterval(() => {
    try {
      onSample(readSample(target));
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
  stopTelemetry();
}

export function isLiveMetricsRunning(): boolean {
  return timer !== null;
}
