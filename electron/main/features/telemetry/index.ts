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
  gpuSource: "typeperf" | "none";
  fpsSource: "rtss" | "none";
  tempSource: "lhm" | "none";
}

/** Read the cached telemetry and nudge each source to refresh if stale. */
export function readTelemetry(exePath: string, pid: number): TelemetryReadout {
  pumpGpuCounters();
  pumpGpuAdapters();
  pumpLhm();
  ensureRtssHelper();

  const gpu = getCachedGpu();
  const hardware = peekLhm();
  const fps = lookupRtssFps(exePath, pid);
  const adapters = getGpuAdapterNames();

  return {
    gpuPercent: gpu.percent,
    gpuTempC: hardware?.gpuTempC ?? null,
    gpuClockMhz: hardware?.gpuClockMhz ?? null,
    cpuTempC: hardware?.cpuTempC ?? null,
    fps: fps ? fps.fps : null,
    fpsMin: fps?.min ?? null,
    fpsMax: fps?.max ?? null,
    gpuAdapters: adapters,
    gpuSource: gpu.percent !== null ? "typeperf" : "none",
    fpsSource: fps ? "rtss" : "none",
    tempSource: hardware ? "lhm" : "none",
  };
}

/** Start the long-lived sources for a new session (idempotent). */
export function startTelemetry(): void {
  pumpGpuCounters();
  pumpGpuAdapters();
  pumpLhm();
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
} {
  return {
    gpu: gpuDiagnostics(),
    lhm: lhmDiagnostics(),
    rtss: rtssDiagnostics(),
  };
}
