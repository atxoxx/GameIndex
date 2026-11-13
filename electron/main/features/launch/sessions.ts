/**
 * Active play-session registry and lifecycle.
 *
 * Ported from `src-tauri/src/game_watcher/watcher.rs` (`ActiveSession`,
 * `register_launched_session`, `start_passive_session`) and
 * `game_watcher/session.rs` (`finalize_session`).
 *
 * A session exists from the moment a launch is accepted until its process is
 * gone. Playtime is anchored at the *attach* instant — the moment a real
 * process was first observed — so a user-gated Steam dialog or a slow UAC
 * prompt is not counted as playtime, exactly like the Rust watcher.
 */
import { emit } from "../../ipc";
import { setLastPlayed } from "../../state/libraryStore";
import { appendSample, finishSession, startSession } from "../../state/sessionsStore";
import { shutdownTelemetry, startTelemetry } from "../telemetry";
import { createSessionMetrics, type SessionMetrics } from "./metrics";
import { getGameRootDir, baseNameLower } from "./paths";
import { resolveProcessDetails } from "./processes";
import { runScriptBlocking } from "./scripts";
import { requestImmediatePoll } from "./wake";
import type {
  GameExitPayload,
  GameFailurePayload,
  GameProgressPayload,
  GameSessionStatePayload,
  GameStartedPayload,
  PostExitScript,
  ProcessInfo,
} from "./types";

/** A session that ran shorter than this is treated as a doomed launch. */
export const HEAL_SHORT_RUN_SECS = 15;

/** Heartbeat cadence for `game-progress` (+ a crash-safe metric checkpoint). */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Telemetry sample cadence. Samples are persisted as they are taken (not only
 * on the 30 s heartbeat), so a crash loses at most one interval and the
 * Activity charts get a dense series instead of one point per half minute.
 * The watcher polls every 3 s while a session runs, so a 2.5 s threshold makes
 * almost every poll take a real sample.
 */
export const SAMPLE_INTERVAL_MS = 2_500;

export interface ActiveSession {
  gameId: string;
  gameName: string;
  platform: string;
  /** When the launch was accepted (Unix ms). */
  startedAtMs: number;
  /** When a real process was first observed; 0 while still pending. */
  attachedAtMs: number;
  lastPid: number;
  matchedExe: string;
  installDir: string | null;
  /** True for launches started from the app; false for passive detection. */
  launchedByApp: boolean;
  /** Set when the tracked process disappeared and the grace period started. */
  lostAt: number | null;
  postExitScript: PostExitScript | null;
  /** `sessions-db` row id, created on attach and closed on exit. */
  sessionRowId: number | null;
  metrics: SessionMetrics | null;
  lastSampleAt: number;
  lastHeartbeatAt: number;
  lastWorkingSetBytes: number;
}

/** Every live session, keyed by game id (one session per game). */
export const activeSessions = new Map<string, ActiveSession>();

export function elapsedSeconds(session: ActiveSession): number {
  if (session.attachedAtMs <= 0) return 0;
  return Math.max(0, Math.floor((Date.now() - session.attachedAtMs) / 1000));
}

export function hasActiveSessions(): boolean {
  return activeSessions.size > 0;
}

/** Names of every other active session (tray/overlay status line). */
export function remainingGameNameAfter(gameId: string): string | undefined {
  for (const [id, session] of activeSessions) {
    if (id !== gameId) return session.gameName;
  }
  return undefined;
}

export interface RegisterSessionInput {
  gameId: string;
  gameName: string;
  platform: string;
  exePath: string | null;
  installDir: string | null;
  pid: number;
  postExitScript: PostExitScript | null;
}

/**
 * Register a session launched from the app.
 *
 * A known PID attaches immediately (row created, `game-started` emitted); a
 * protocol launch registers a *pending* session whose row/event wait for the
 * real process to appear in the poll loop.
 */
export function registerLaunchedSession(input: RegisterSessionInput): ActiveSession {
  const existing = activeSessions.get(input.gameId);
  if (existing) {
    // Re-launch of a still-tracked session: drop the old one without
    // finalizing (its process is almost certainly the same one).
    activeSessions.delete(input.gameId);
  }

  const session: ActiveSession = {
    gameId: input.gameId,
    gameName: input.gameName,
    platform: input.platform,
    startedAtMs: Date.now(),
    attachedAtMs: 0,
    lastPid: 0,
    matchedExe: input.exePath ?? "",
    installDir: input.installDir,
    launchedByApp: true,
    lostAt: null,
    postExitScript: input.postExitScript,
    sessionRowId: null,
    metrics: null,
    lastSampleAt: 0,
    lastHeartbeatAt: 0,
    lastWorkingSetBytes: 0,
  };
  activeSessions.set(session.gameId, session);

  if (input.pid > 0) {
    const exePath = input.exePath ?? "";
    attachSession(session, {
      pid: input.pid,
      ppid: 0,
      name: exePath.split(/[\\/]/).pop() ?? "",
      exePath,
      workingSetBytes: 0,
    });
    // The library path can point at a stub/shim (a Store app alias, a
    // bootstrapper); the OS-reported path of the live PID is the authoritative
    // one for liveness checks and force-close verification.
    void refreshSessionProcessPath(session, input.pid);
  }

  requestImmediatePoll();
  return session;
}

/**
 * Replace the session's tracked exe with the path the OS reports for its PID.
 * Best effort: a process we cannot inspect keeps the launch path.
 */
async function refreshSessionProcessPath(
  session: ActiveSession,
  pid: number,
): Promise<void> {
  try {
    const details = await resolveProcessDetails([pid]);
    const resolved = details.get(pid)?.exePath ?? "";
    if (!resolved) return;
    // On Linux the PID of a Windows game resolves to the Wine loader, not the
    // game .exe; adopting that path would point the session (and its install
    // tree) at /usr/bin. Only take the OS path when it is the same binary.
    const tracked = baseNameLower(session.matchedExe ?? "");
    const found = baseNameLower(resolved);
    if (tracked && found && tracked !== found) return;
    if (activeSessions.get(session.gameId) !== session) return;
    session.matchedExe = resolved;
    const root = getGameRootDir(resolved);
    if (root) session.installDir = root;
  } catch {
    /* keep the launch path */
  }
}

/**
 * Anchor a session to a real process. Emits `game-started` and starts the
 * session row the first time (`wasPending`), and re-anchors the exe/install dir
 * on a launcher → game hand-off.
 */
export function attachSession(session: ActiveSession, process: ProcessInfo): void {
  const wasPending = session.attachedAtMs === 0 || session.lastPid === 0;

  if (wasPending) {
    session.attachedAtMs = Date.now();
    session.metrics = createSessionMetrics();
    session.lastSampleAt = Date.now();
    session.lastHeartbeatAt = Date.now();
    // Kick the long-lived telemetry sources (RTSS probe, GPU counter cache,
    // adapter list). GPU/LHM/SMART probes are throttled and non-blocking.
    startTelemetry();
    try {
      session.sessionRowId = startSession({
        gameId: session.gameId,
        gameName: session.gameName,
        startedAtMs: session.attachedAtMs,
      });
    } catch (error) {
      console.error(`[launch] could not start session row for ${session.gameId}:`, error);
      session.sessionRowId = null;
    }
  }

  session.lastPid = process.pid;
  if (process.exePath) {
    session.matchedExe = process.exePath;
    session.installDir = getGameRootDir(process.exePath) ?? session.installDir;
  }
  session.lastWorkingSetBytes = process.workingSetBytes;
  session.lostAt = null;

  if (wasPending) {
    const payload: GameStartedPayload = {
      gameId: session.gameId,
      gameName: session.gameName,
      detectedExe: process.exePath || session.matchedExe || undefined,
      pid: process.pid,
    };
    emit("game-started", payload);
  }
}

/** Emit `game-session-lost` once, when the grace period begins. */
export function markSessionLost(session: ActiveSession): void {
  session.lostAt = Date.now();
  const payload: GameSessionStatePayload = {
    gameId: session.gameId,
    gameName: session.gameName,
  };
  emit("game-session-lost", payload);
}

/** Emit `game-session-restored` when the session re-attached inside grace. */
export function markSessionRestored(session: ActiveSession): void {
  if (session.lostAt === null) return;
  session.lostAt = null;
  const payload: GameSessionStatePayload = {
    gameId: session.gameId,
    gameName: session.gameName,
  };
  emit("game-session-restored", payload);
}

export interface FinalizeResult {
  session: ActiveSession;
  remainingGameName?: string;
}

/**
 * End a session: run the post-exit script, close the session row, stamp
 * `lastPlayed`, then emit `game-exited` (+ `game-failed` for a doomed launch).
 * The row is committed before the event so a listener that reloads history
 * sees it, mirroring the Rust `finalize_session` ordering.
 */
export async function finalizeSession(
  gameId: string,
  options: { killedByUser?: boolean; runPostExit?: boolean } = {},
): Promise<FinalizeResult | null> {
  const session = activeSessions.get(gameId);
  if (!session) return null;
  activeSessions.delete(gameId);
  const remainingGameName = remainingGameNameAfter(gameId);

  if (options.runPostExit !== false && session.postExitScript) {
    try {
      await runScriptBlocking(session.postExitScript.script, session.postExitScript.admin);
    } catch (error) {
      console.error(`[launch] post-exit script for ${gameId} failed:`, error);
    }
  }

  const finishedAt = Date.now();
  const elapsed = elapsedSeconds(session);
  const snapshot = session.metrics?.snapshot();

  if (session.sessionRowId !== null) {
    try {
      finishSession(session.sessionRowId, {
        endedAtMs: finishedAt,
        elapsedSeconds: elapsed,
        avgFps: snapshot?.avgFps ?? null,
        avgCpu: snapshot?.avgCpuUsage ?? null,
        avgGpu: snapshot?.avgGpuUsage ?? null,
        avgRam: snapshot?.avgRamUsage ?? null,
        metricsJson: snapshot ? JSON.stringify(snapshot) : null,
      });
      setLastPlayed(gameId, finishedAt);
    } catch (error) {
      console.error(`[launch] could not record session for ${gameId}:`, error);
    }
  }

  const payload: GameExitPayload = {
    gameId,
    elapsedSeconds: elapsed,
    finishedAt,
  };
  if (snapshot && snapshot.samples.length > 0) {
    payload.metrics = {
      avgFps: snapshot.avgFps,
      minFps: snapshot.minFps,
      maxFps: snapshot.maxFps,
      avgCpuUsage: snapshot.avgCpuUsage,
      avgGpuUsage: snapshot.avgGpuUsage,
      avgRamUsage: snapshot.avgRamUsage,
      avgCpuTemp: snapshot.avgCpuTemp,
      avgGpuTemp: snapshot.avgGpuTemp,
      avgProcessRamMb: snapshot.avgProcessRamMb,
      sampleCount: snapshot.samples.length,
    };
  }
  if (remainingGameName) payload.remainingGameName = remainingGameName;
  emit("game-exited", payload);

  // The telemetry probes stay warm between games (only app quit kills them), so
  // the next launch shows FPS/temps immediately instead of recompiling the C#.
  void activeSessions.size;

  if (!options.killedByUser && elapsed < HEAL_SHORT_RUN_SECS) {
    const failure: GameFailurePayload = {
      gameId,
      gameName: session.gameName,
      elapsedSeconds: elapsed,
      attached: session.attachedAtMs > 0,
    };
    emit("game-failed", failure);
  }

  return { session, remainingGameName };
}

/**
 * Periodic work for each live session: sample telemetry (throttled), append
 * the fresh samples to the running row, and emit the `game-progress`
 * heartbeat. Streaming the samples (rather than only the newest on each 30 s
 * beat) keeps the on-disk series dense enough for the Activity charts and
 * survives an app crash mid-session. `workingSetFor` supplies the freshest
 * process memory reading, when known.
 */
export function runSessionPeriodic(
  workingSetFor: (session: ActiveSession) => number | null,
): void {
  const now = Date.now();
  for (const session of activeSessions.values()) {
    if (session.attachedAtMs <= 0) continue;
    if (!session.metrics) session.metrics = createSessionMetrics();

    if (now - session.lastSampleAt >= SAMPLE_INTERVAL_MS) {
      session.lastSampleAt = now;
      const workingSet = workingSetFor(session);
      if (workingSet && workingSet > 0) session.lastWorkingSetBytes = workingSet;
      session.metrics.sample(session.lastWorkingSetBytes || null, {
        exePath: session.matchedExe,
        pid: session.lastPid,
        gameId: session.gameId,
      });

      if (session.sessionRowId !== null) {
        const pending = session.metrics.drainPending();
        if (pending.length > 0) {
          try {
            for (const sample of pending) appendSample(session.sessionRowId, sample);
          } catch (error) {
            console.error(`[launch] could not persist samples for ${session.gameId}:`, error);
          }
        }
      }
    }

    if (now - session.lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
      session.lastHeartbeatAt = now;
      const elapsed = elapsedSeconds(session);
      const payload: GameProgressPayload = {
        gameId: session.gameId,
        gameName: session.gameName,
        elapsedSeconds: elapsed,
      };
      emit("game-progress", payload);
    }
  }
}

/**
 * Quit path: close every open session row synchronously so a game still running
 * when the app exits does not leave a row that never ends. Post-exit scripts
 * are skipped (there is no time to await them).
 */
export function finalizeSessionsOnQuit(): void {
  shutdownTelemetry();
  if (activeSessions.size === 0) return;
  const now = Date.now();
  for (const session of activeSessions.values()) {
    if (session.sessionRowId === null) continue;
    const elapsed = elapsedSeconds(session);
    const snapshot = session.metrics?.snapshot();
    try {
      finishSession(session.sessionRowId, {
        endedAtMs: now,
        elapsedSeconds: elapsed,
        avgFps: snapshot?.avgFps ?? null,
        avgCpu: snapshot?.avgCpuUsage ?? null,
        avgGpu: snapshot?.avgGpuUsage ?? null,
        avgRam: snapshot?.avgRamUsage ?? null,
        metricsJson: snapshot ? JSON.stringify(snapshot) : null,
      });
      setLastPlayed(session.gameId, now);
    } catch (error) {
      console.error(`[launch] could not finish session ${session.gameId} on quit:`, error);
    }
  }
  activeSessions.clear();
}
