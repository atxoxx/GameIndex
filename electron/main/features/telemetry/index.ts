/**
 * Session telemetry aggregation point.
 *
 * Three independent Windows sources feed one synchronous readout:
 *
 *  • GPU %      — Windows `GPU Engine` performance counters (`typeperf`),
 *                 cached and refreshed in the background (`./gpu`).
 *  • Temps/clk  — LibreHardwareMonitor's localhost JSON, when it runs (`./lhm`).
 *  • FPS        — RTSS shared memory through a persistent PowerShell probe
 *                 (`./rtss`).
 *
 * Every getter is synchronous: the sampler must never await a child process
 * or an HTTP request while the watcher poll loop is running. Missing sources
 * return `null` so callers can persist "no reading" instead of a fake zero.
 */
import {
  getCachedGpu,
  getGpuAdapterNames,
  gpuDiagnostics,
  pumpGpuAdapters,
  pumpGpuCounters,
} from "./gpu";
import { lhmDiagnostics, peekLhm, pumpLhm } from "./lhm";
import {
  ensureRtssHelper,
  lookupRtssFps,
  rtssDiagnostics,
  startRtssHelper,
  stopRtssHelper,
} from "./rtss";
import { nvidiaDiagnostics, peekNvidia, pumpNvidia } from "./nvidia";

export interface TelemetryReadout {
  /** 0–100, or null when no GPU counter reading has landed yet. */
  gpuPercent: number | null;
  gpuTempC: number | null;
  gpuClockMhz: number | null;
  cpuTempC: number | null;
  /** Instantaneous FPS from RTSS, or null when no real source reported it. */
  fps: number | null;
  fpsMin: number | null;
  fpsMax: number | null;
  gpuAdapters: string[];
  gpuSource: "typeperf" | "nvidia" | "none";
  fpsSource: "rtss" | "none";
  tempSource: "lhm" | "nvidia" | "none";
  /** CPU temperatures have a single source (LHM); surfaced for UI hints. */
  cpuTempSource: "lhm" | "none";
}

/** Read the cached telemetry and nudge each source to refresh if stale. */
export function readTelemetry(exePath: string, pid: number): TelemetryReadout {
  pumpGpuCounters();
  pumpGpuAdapters();
  pumpLhm();
  pumpNvidia();
  ensureRtssHelper();

  const gpu = getCachedGpu();
  const hardware = peekLhm();
  const nvidia = peekNvidia();
  const fps = lookupRtssFps(exePath, pid);
  const adapters = getGpuAdapterNames();

  const gpuPercent = gpu.percent ?? nvidia.utilPercent;
  const gpuTempC = hardware?.gpuTempC ?? nvidia.gpuTempC;
  const gpuClockMhz = hardware?.gpuClockMhz ?? nvidia.gpuClockMhz;
  const cpuTempC = hardware?.cpuTempC ?? null;

  return {
    gpuPercent,
    gpuTempC,
    gpuClockMhz,
    cpuTempC,
    fps: fps ? fps.fps : null,
    fpsMin: fps?.min ?? null,
    fpsMax: fps?.max ?? null,
    gpuAdapters: adapters.length > 0 ? adapters : nvidia.adapters,
    gpuSource: gpu.percent !== null ? "typeperf" : gpuPercent !== null ? "nvidia" : "none",
    fpsSource: fps ? "rtss" : "none",
    tempSource: hardware
      ? "lhm"
      : gpuTempC !== null || gpuClockMhz !== null
        ? "nvidia"
        : "none",
    cpuTempSource: cpuTempC !== null ? "lhm" : "none",
  };
}

/** Start the long-lived sources for a new session (idempotent). */
export function startTelemetry(): void {
  pumpGpuCounters();
  pumpGpuAdapters();
  pumpLhm();
  pumpNvidia();
  startRtssHelper();
}

/** Stop every long-lived source (app quit). The FPS helper is killed. */
export function stopTelemetry(): void {
  stopRtssHelper();
}

/** Diagnostics for harnesses and the smoke report (no side effects beyond pumps). */
export function telemetryDiagnostics(): {
  gpu: ReturnType<typeof gpuDiagnostics>;
  lhm: ReturnType<typeof lhmDiagnostics>;
  rtss: ReturnType<typeof rtssDiagnostics>;
  nvidia: ReturnType<typeof nvidiaDiagnostics>;
} {
  return {
    gpu: gpuDiagnostics(),
    lhm: lhmDiagnostics(),
    rtss: rtssDiagnostics(),
    nvidia: nvidiaDiagnostics(),
  };
}
