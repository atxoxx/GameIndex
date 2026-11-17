/**
 * Session telemetry aggregation point.
 *
 * Windows has three independent sources:
 *    • GPU %      — `GPU Engine` performance counters (`typeperf`).
 *    • Temps/clk  — LibreHardwareMonitor / Afterburner shared memory.
 *    • FPS        — RTSS shared memory.
 *
 * Linux uses `./linux`: CPU temperature from hwmon, AMD GPU from sysfs,
 * NVIDIA through the cross-platform `nvidia-smi` source, and FPS from the
 * MangoHud CSV log written by the compatibility launcher.
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
import { linuxDiagnostics, sampleLinux } from "./linux";
import { IS_WINDOWS } from "./proc";
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
  gpuSource: "typeperf" | "nvidia" | "mahm" | "linux" | "none";
  fpsSource: "mahm" | "rtss" | "mangohud" | "none";
  tempSource: "mahm" | "lhm" | "nvidia" | "linux" | "none";
  /** CPU temperatures come from MAHM (Afterburner), LHM or Linux hwmon. */
  cpuTempSource: "mahm" | "lhm" | "linux" | "none";
}

/** Last real FPS per game/process, used across short MangoHud gaps. */
const lastFpsByProcess = new Map<string, number>();

/**
 * The RTSS/MAHM probes are PowerShell processes (~40-120 MB each) that poll
 * shared memory forever. They used to start at boot and live until quit, which
 * is pure idle cost. Keep them warm only around real sampling: a session, the
 * visible HUD, or a diagnostics read. A few idle minutes later they are killed;
 * the next session pays their one-off PowerShell/C# start again (1-3 s), which
 * is the same latency a cold launch had before.
 */
const HELPER_IDLE_GRACE_MS = 5 * 60_000;
let idleShutdownTimer: ReturnType<typeof setTimeout> | null = null;
let lastDemandAt = 0;

/**
 * Record fresh sampling demand. A pending shutdown is not cancelled outright:
 * its callback re-checks this timestamp and re-arms for the remaining grace if
 * a HUD/diagnostics read arrived in the meantime. Cancelling without re-arming
 * used to leave the probes resident forever after a late read.
 */
function noteDemand(): void {
  lastDemandAt = Date.now();
}

/** Schedule the idle kill, accounting for demand seen during the grace period. */
function scheduleIdleShutdown(): void {
  if (!IS_WINDOWS) return;
  if (idleShutdownTimer) clearTimeout(idleShutdownTimer);
  const remaining = Math.max(0, HELPER_IDLE_GRACE_MS - (Date.now() - lastDemandAt));
  idleShutdownTimer = setTimeout(() => {
    idleShutdownTimer = null;
    if (Date.now() - lastDemandAt < HELPER_IDLE_GRACE_MS) {
      scheduleIdleShutdown();
      return;
    }
    stopRtssHelper();
    stopMahmHelper();
  }, remaining);
  idleShutdownTimer.unref?.();
}


function readLinuxTelemetry(
  gameId: string | undefined,
  exePath: string,
  pid: number,
): TelemetryReadout {
  // nvidia-smi is cross-platform and already handles a missing binary.
  pumpNvidia();
  const nvidia = peekNvidia();
  const linux = sampleLinux(gameId);
  const mangohud = linux.mangohud;

  // MangoHud can briefly stop writing (alt-tab, loading screen, a pause) or
  // rotate its CSV. Keep the last real reading for this game/process so the
  // overlay and session curve do not drop FPS while the game is still running.
  const fpsKey = `${gameId ?? ""}|${exePath}|${pid || 0}`;
  const rawFps = mangohud?.fps ?? null;
  if (rawFps !== null && pid > 0) lastFpsByProcess.set(fpsKey, rawFps);
  let fps = rawFps;
  if (fps === null && pid > 0) {
    fps = lastFpsByProcess.get(fpsKey) ?? null;
  }
  if (lastFpsByProcess.size > 32) {
    const oldest = lastFpsByProcess.keys().next().value;
    if (oldest) lastFpsByProcess.delete(oldest);
  }

  const nvidiaPercent = nvidia.utilPercent;
  const amdPercent = linux.gpuPercent;
  let gpuPercent: number | null;
  let gpuSource: TelemetryReadout["gpuSource"];
  if (mangohud?.gpuLoad !== null && mangohud?.gpuLoad !== undefined) {
    gpuPercent = mangohud.gpuLoad;
    gpuSource = "linux";
  } else if (nvidiaPercent !== null && (amdPercent === null || nvidiaPercent >= amdPercent)) {
    gpuPercent = nvidiaPercent;
    gpuSource = "nvidia";
  } else if (amdPercent !== null) {
    gpuPercent = amdPercent;
    gpuSource = "linux";
  } else {
    gpuPercent = null;
    gpuSource = "none";
  }

  const gpuTempC =
    mangohud?.gpuTempC ?? nvidia.gpuTempC ?? linux.gpuTempC ?? null;
  const gpuClockMhz =
    mangohud?.gpuClockMhz ?? nvidia.gpuClockMhz ?? linux.gpuClockMhz ?? null;
  const cpuTempC = linux.cpuTempC ?? null;

  return {
    gpuPercent,
    gpuTempC,
    gpuClockMhz,
    cpuTempC,
    fps,
    fpsMin: null,
    fpsMax: null,
    gpuAdapters: nvidia.adapters.length > 0 ? nvidia.adapters : linux.gpuAdapters,
    gpuSource,
    fpsSource: fps !== null ? "mangohud" : "none",
    tempSource:
      mangohud?.gpuTempC != null
        ? "linux"
        : nvidia.gpuTempC !== null
          ? "nvidia"
          : linux.gpuTempC !== null
            ? "linux"
            : "none",
    cpuTempSource: cpuTempC !== null ? "linux" : "none",
  };
}

/** Read the cached telemetry and nudge each source to refresh if stale. */
export function readTelemetry(
  exePath: string,
  pid: number,
  gameId?: string,
): TelemetryReadout {
  if (!IS_WINDOWS) return readLinuxTelemetry(gameId, exePath, pid);

  // An active sampler keeps the shared-memory probes warm.
  noteDemand();
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
  noteDemand();
  if (IS_WINDOWS) {
    pumpGpuCounters();
    pumpGpuAdapters();
    pumpLhm();
    startRtssHelper();
    startMahmHelper();
  }
  pumpNvidia();
}

/**
 * End a sampling window. The probes stay warm for a short grace period so
 * relaunching a game right after exiting one still shows FPS/CPU temp instantly;
 * after that they are killed and their memory returned.
 */
export function stopTelemetry(): void {
  scheduleIdleShutdown();
}

/** Kill every probe immediately (idle grace elapsed, or app quit). */
export function shutdownTelemetry(): void {
  if (idleShutdownTimer) {
    clearTimeout(idleShutdownTimer);
    idleShutdownTimer = null;
  }
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
  linux?: ReturnType<typeof linuxDiagnostics>;
} {
  const diagnostics = {
    gpu: gpuDiagnostics(),
    lhm: lhmDiagnostics(),
    rtss: rtssDiagnostics(),
    nvidia: nvidiaDiagnostics(),
    mahm: mahmDiagnostics(),
  };
  return IS_WINDOWS ? diagnostics : { ...diagnostics, linux: linuxDiagnostics() };
}
