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
import {
  ensureMahmHelper,
  mahmDiagnostics,
  peekMahm,
  startMahmHelper,
  stopMahmHelper,
} from "./mahm";

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
  gpuSource: "typeperf" | "nvidia" | "mahm" | "none";
  fpsSource: "mahm" | "rtss" | "none";
  tempSource: "mahm" | "lhm" | "nvidia" | "none";
  /** CPU temperatures come from MAHM (Afterburner) or LHM. */
  cpuTempSource: "mahm" | "lhm" | "none";
}

/** Read the cached telemetry and nudge each source to refresh if stale. */
export function readTelemetry(exePath: string, pid: number): TelemetryReadout {
  pumpGpuCounters();
  pumpGpuAdapters();
  pumpLhm();
  pumpNvidia();
  ensureRtssHelper();
  ensureMahmHelper();

  const gpu = getCachedGpu();
  const hardware = peekLhm();
  const nvidia = peekNvidia();
  const mahm = peekMahm();
  const rtss = lookupRtssFps(exePath, pid);
  const adapters = getGpuAdapterNames();

  const gpuPercent = gpu.percent ?? mahm.gpuUsage ?? nvidia.utilPercent;
  const gpuTempC = mahm.gpuTempC ?? hardware?.gpuTempC ?? nvidia.gpuTempC;
  const gpuClockMhz = mahm.gpuClockMhz ?? hardware?.gpuClockMhz ?? nvidia.gpuClockMhz;
  const cpuTempC = mahm.cpuTempC ?? hardware?.cpuTempC ?? null;
  const fps = mahm.fps ?? rtss?.fps ?? null;

  return {
    gpuPercent,
    gpuTempC,
    gpuClockMhz,
    cpuTempC,
    fps,
    fpsMin: rtss?.min ?? null,
    fpsMax: rtss?.max ?? null,
    gpuAdapters: adapters.length > 0 ? adapters : nvidia.adapters,
    gpuSource:
      gpu.percent !== null
        ? "typeperf"
        : mahm.gpuUsage !== null
          ? "mahm"
          : gpuPercent !== null
            ? "nvidia"
            : "none",
    fpsSource: mahm.fps !== null ? "mahm" : rtss ? "rtss" : "none",
    tempSource:
      mahm.gpuTempC !== null
        ? "mahm"
        : hardware
          ? "lhm"
          : gpuTempC !== null || gpuClockMhz !== null
            ? "nvidia"
            : "none",
    cpuTempSource: mahm.cpuTempC !== null ? "mahm" : cpuTempC !== null ? "lhm" : "none",
  };
}

/** Start the long-lived sources for a new session (idempotent). */
export function startTelemetry(): void {
  pumpGpuCounters();
  pumpGpuAdapters();
  pumpLhm();
  pumpNvidia();
  startRtssHelper();
  startMahmHelper();
}

/**
 * End a sampling window. The long-lived probes stay warm on purpose: killing
 * them between games made every launch pay the PowerShell start + C# compile
 * (1–3 s), which is exactly the delay users saw before FPS/CPU temp appeared.
 */
export function stopTelemetry(): void {
  // Intentionally empty; use `shutdownTelemetry()` on quit.
}

/** Kill every probe. Only for app quit. */
export function shutdownTelemetry(): void {
  stopRtssHelper();
  stopMahmHelper();
}

/** Diagnostics for harnesses and the smoke report (no side effects beyond pumps). */
export function telemetryDiagnostics(): {
  gpu: ReturnType<typeof gpuDiagnostics>;
  lhm: ReturnType<typeof lhmDiagnostics>;
  rtss: ReturnType<typeof rtssDiagnostics>;
  nvidia: ReturnType<typeof nvidiaDiagnostics>;
  mahm: ReturnType<typeof mahmDiagnostics>;
} {
  return {
    gpu: gpuDiagnostics(),
    lhm: lhmDiagnostics(),
    rtss: rtssDiagnostics(),
    nvidia: nvidiaDiagnostics(),
    mahm: mahmDiagnostics(),
  };
}
