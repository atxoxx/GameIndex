/**
 * Capture state machine: one manual recording **or** one replay buffer at a
 * time, with the `capture:state` / `capture:clip-saved` events the overlay HUD
 * listens for.
 *
 * Ported from `src-tauri/src/capture/mod.rs`. The controller owns everything
 * the Rust `CaptureController` owned (mutual exclusion, countdown, HUD hiding,
 * clip emission, shutdown cleanup); the encoder lives in `./ffmpeg`.
 *
 * Deviations from the Rust controller, all deliberate:
 *   • recording and the replay buffer stay mutually exclusive: arming the
 *     buffer stops a running take, and starting a take stops the buffer.
 *     A completed take is always emitted as `capture:clip-saved` instead of
 *     being dropped silently (the Rust `start_replay_impl` discarded it).
 *   • the rolling buffer lives under `userData/capture/replay`, not next to the
 *     clips, so a crash cannot leave fake-looking clip files behind.
 *   • if ffmpeg exits on its own (max-clip reached, encoder error) the take is
 *     finalized and reported instead of being leaked as a temp file.
 */
import { app, screen } from "electron";
import fs from "node:fs";
import path from "node:path";
import { emit } from "../../ipc";
import {
  getOverlaySession,
  getOverlaySettings,
  getOverlayWindow,
} from "../../surfaces/overlay";
import {
  cachedCapabilities,
  clearReplayBuffer,
  clipFileName,
  detectCapabilities,
  finalizeRecording,
  finalizeRecordingSync,
  probeDurationMs,
  saveReplayBuffer,
  startRecordingProcess,
  startReplayProcess,
  stopProcess,
  uniqueOutputPath,
  type CaptureHandle,
} from "./ffmpeg";
import { clipFolder, ensureClipFolder } from "./library";
import {
  EVENT_CAPTURE_STATE,
  EVENT_CLIP_SAVED,
  type CaptureCapabilities,
  type CaptureConfig,
  type ClipInfo,
  type RecordingState,
} from "./types";

type ActiveRecording = {
  kind: "record";
  handle: CaptureHandle;
  startedAt: number;
  outputWidth: number;
  outputHeight: number;
  title: string;
  hidOverlay: boolean;
  stopping: boolean;
};

type ActiveReplay = {
  kind: "replay";
  handle: CaptureHandle;
  startedAt: number;
  outputWidth: number;
  outputHeight: number;
  title: string;
  replaySeconds: number;
  stopping: boolean;
};

type ActiveCapture = ActiveRecording | ActiveReplay;

let active: ActiveCapture | null = null;
let lastError: string | null = null;
let starting = false;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function evenSize(value: number): number {
  const rounded = Math.max(2, Math.round(value));
  return rounded - (rounded % 2);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function broadcast(state: RecordingState): void {
  emit(EVENT_CAPTURE_STATE, state);
}

function emptyState(): RecordingState {
  return { recording: false, replayBuffering: false, startedAt: null, durationMs: 0 };
}

function stateSnapshot(): RecordingState {
  if (!active) {
    const state = emptyState();
    if (lastError) state.error = lastError;
    return state;
  }
  const state: RecordingState = {
    recording: active.kind === "record",
    replayBuffering: active.kind === "replay",
    startedAt: active.startedAt,
    durationMs: Math.max(0, Date.now() - active.startedAt),
  };
  if (lastError) state.error = lastError;
  return state;
}

async function ensureSupported(): Promise<CaptureCapabilities> {
  const caps = await detectCapabilities();
  if (!caps.supported) {
    throw new Error(caps.reason ?? "video capture is not supported on this platform");
  }
  return caps;
}

function replayBufferRoot(): string {
  const root = path.join(app.getPath("userData"), "capture", "replay");
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function buildConfig(): CaptureConfig {
  const settings = getOverlaySettings();
  const display = screen.getPrimaryDisplay();
  const scale = display.scaleFactor || 1;
  const captureWidth = evenSize(display.size.width * scale);
  const captureHeight = evenSize(display.size.height * scale);
  const resolutionScale = clamp(Number(settings.videoResolutionScale) || 1, 0.25, 1);
  const format = String(settings.videoFormat ?? "mp4").toLowerCase();
  const container = format === "webm" ? "webm" : format === "mkv" ? "mkv" : "mp4";
  const micEnabled = Boolean(settings.videoMicrophone);
  const gameAudioEnabled = Boolean(settings.videoGameAudio);

  return {
    fps: clamp(Math.round(Number(settings.videoFps) || 60), 15, 240),
    bitrateKbps: clamp(Math.round(Number(settings.videoBitrateKbps) || 12_000), 1_000, 100_000),
    resolutionScale,
    captureWidth,
    captureHeight,
    outputWidth: evenSize(captureWidth * resolutionScale),
    outputHeight: evenSize(captureHeight * resolutionScale),
    showCursor: Boolean(settings.videoShowCursor),
    maxClipSeconds: clamp(Math.round(Number(settings.videoMaxClipSeconds) || 0), 0, 86_400),
    replaySeconds: clamp(Math.round(Number(settings.replayBufferSeconds) || 60), 5, 600),
    micDevice: micEnabled ? settings.videoMicDevice?.trim() || null : null,
    gameAudioDevice: gameAudioEnabled ? settings.videoAudioDevice?.trim() || null : null,
    container,
    folder: ensureClipFolder(),
    gameTitle: getOverlaySession()?.name?.trim() || "GameIndex",
  };
}

function hideOverlayForRecording(): boolean {
  const win = getOverlayWindow();
  if (!win || win.isDestroyed() || !win.isVisible()) return false;
  win.hide();
  return true;
}

function restoreOverlay(capture: ActiveCapture): void {
  const hid = capture.kind === "record" && capture.hidOverlay;
  if (!hid) return;
  const win = getOverlayWindow();
  if (!win || win.isDestroyed()) return;
  win.show();
}

function errorState(message: string): RecordingState {
  const state = emptyState();
  state.error = message;
  return state;
}

async function finishRecording(
  recording: ActiveRecording,
  caps: CaptureCapabilities,
): Promise<ClipInfo | null> {
  await stopProcess(recording.handle);
  const result = await finalizeRecording(recording.handle, caps);
  const probed = await probeDurationMs(result.filePath, caps);
  return {
    filePath: result.filePath,
    fileName: path.basename(result.filePath),
    gameTitle: recording.title,
    timestamp: Date.now(),
    durationMs: probed ?? Math.max(0, Date.now() - recording.startedAt),
    width: recording.outputWidth,
    height: recording.outputHeight,
    kind: "record",
  };
}

/** ffmpeg exited on its own: finalize the take rather than leaking the temp. */
async function recoverRecording(recording: ActiveRecording): Promise<void> {
  const caps = await detectCapabilities();
  try {
    const clip = await finishRecording(recording, caps);
    lastError = null;
    broadcast(stateSnapshot());
    if (clip) emit(EVENT_CLIP_SAVED, clip);
  } catch (error) {
    lastError = messageOf(error);
    broadcast(stateSnapshot());
  } finally {
    restoreOverlay(recording);
  }
}

// ── Manual recording ────────────────────────────────────────────────
export async function startRecording(): Promise<RecordingState> {
  // Starting while a recording runs is a no-op that reports the live state.
  if (active?.kind === "record") return stateSnapshot();
  if (starting) return stateSnapshot();

  const caps = await ensureSupported();
  const settings = getOverlaySettings();
  if (settings.videoEnabled === false) {
    throw new Error(
      "video capture is disabled — enable it in Settings → Overlay → Video",
    );
  }

  starting = true;
  try {
    // Mutually exclusive with the replay buffer.
    if (active?.kind === "replay") await stopReplay();

    const config = buildConfig();
    const countdown = clamp(Math.round(Number(settings.videoCountdownMs) || 0), 0, 10_000);
    if (countdown > 0) {
      lastError = null;
      emit(EVENT_CAPTURE_STATE, { ...emptyState(), countdownMs: countdown });
      await delay(countdown);
    }

    const outputPath = uniqueOutputPath(config.folder, clipFileName("record", config.container));
    let handle: CaptureHandle;
    try {
      handle = await startRecordingProcess(config, caps, outputPath);
    } catch (error) {
      lastError = messageOf(error);
      broadcast(stateSnapshot());
      throw new Error(`could not start recording — ${lastError}`);
    }

    const recording: ActiveRecording = {
      kind: "record",
      handle,
      startedAt: Date.now(),
      outputWidth: config.outputWidth,
      outputHeight: config.outputHeight,
      title: config.gameTitle,
      hidOverlay: false,
      stopping: false,
    };
    active = recording;
    lastError = null;
    if (settings.videoHideOverlay) recording.hidOverlay = hideOverlayForRecording();

    void handle.exited.then((code) => {
      if (recording.stopping || active !== recording) return;
      active = null;
      if (code !== 0) {
        const tail = handle.stderrTail.trim().split(/\r?\n/).filter(Boolean).slice(-2).join(" ");
        if (tail) lastError = tail;
      }
      void recoverRecording(recording);
    });

    const state = stateSnapshot();
    broadcast(state);
    return state;
  } finally {
    starting = false;
  }
}

export async function stopRecording(): Promise<ClipInfo | null> {
  const caps = await ensureSupported();
  const recording = active?.kind === "record" ? active : null;
  if (!recording) return null;

  recording.stopping = true;
  active = null;
  try {
    const clip = await finishRecording(recording, caps);
    lastError = null;
    broadcast(stateSnapshot());
    if (clip) emit(EVENT_CLIP_SAVED, clip);
    return clip;
  } catch (error) {
    lastError = messageOf(error);
    broadcast(stateSnapshot());
    throw new Error(`could not finalize the recording — ${lastError}`);
  } finally {
    restoreOverlay(recording);
  }
}

export async function toggleRecording(): Promise<RecordingState> {
  if (active?.kind === "record") {
    await stopRecording();
    return stateSnapshot();
  }
  return startRecording();
}

// ── Replay buffer ───────────────────────────────────────────────────
export async function startReplay(): Promise<RecordingState> {
  if (active?.kind === "replay") return stateSnapshot();
  if (starting) return stateSnapshot();

  const caps = await ensureSupported();
  const settings = getOverlaySettings();
  if (settings.videoEnabled === false) {
    throw new Error(
      "video capture is disabled — enable it in Settings → Overlay → Video",
    );
  }

  starting = true;
  try {
    if (active?.kind === "record") await stopRecording();

    const config: CaptureConfig = { ...buildConfig(), container: "mp4" };
    let handle: CaptureHandle;
    try {
      handle = await startReplayProcess(config, caps, replayBufferRoot());
    } catch (error) {
      lastError = messageOf(error);
      broadcast(errorState(lastError));
      throw new Error(`could not start the replay buffer — ${lastError}`);
    }

    const replay: ActiveReplay = {
      kind: "replay",
      handle,
      startedAt: Date.now(),
      outputWidth: config.outputWidth,
      outputHeight: config.outputHeight,
      title: config.gameTitle,
      replaySeconds: config.replaySeconds,
      stopping: false,
    };
    active = replay;
    lastError = null;

    void handle.exited.then(() => {
      if (replay.stopping || active !== replay) return;
      active = null;
      clearReplayBuffer(replay.handle);
      const detail = replay.handle.stderrTail.trim().split(/\r?\n/).filter(Boolean).slice(-2).join(" ");
      lastError = detail || "the replay buffer stopped unexpectedly";
      broadcast(stateSnapshot());
    });

    const state = stateSnapshot();
    broadcast(state);
    return state;
  } finally {
    starting = false;
  }
}

export async function stopReplay(): Promise<RecordingState> {
  await ensureSupported();
  const replay = active?.kind === "replay" ? active : null;
  if (!replay) {
    broadcast(stateSnapshot());
    return stateSnapshot();
  }

  replay.stopping = true;
  active = null;
  await stopProcess(replay.handle);
  clearReplayBuffer(replay.handle);
  lastError = null;
  broadcast(stateSnapshot());
  return stateSnapshot();
}

export async function saveReplay(): Promise<ClipInfo | null> {
  const caps = await ensureSupported();
  const replay = active?.kind === "replay" ? active : null;
  if (!replay) return null;

  const folder = ensureClipFolder();
  const outputPath = uniqueOutputPath(folder, clipFileName("replay", "mp4"));
  let result: { filePath: string; sizeBytes: number; estimatedSeconds: number };
  try {
    result = await saveReplayBuffer(replay.handle, caps, outputPath, replay.replaySeconds);
  } catch (error) {
    lastError = messageOf(error);
    broadcast(stateSnapshot());
    throw error;
  }

  const probed = await probeDurationMs(result.filePath, caps);
  const clip: ClipInfo = {
    filePath: result.filePath,
    fileName: path.basename(result.filePath),
    gameTitle: replay.title,
    timestamp: Date.now(),
    durationMs:
      probed ?? Math.min(replay.replaySeconds, result.estimatedSeconds) * 1_000,
    width: replay.outputWidth,
    height: replay.outputHeight,
    kind: "replay",
  };
  lastError = null;
  broadcast(stateSnapshot());
  emit(EVENT_CLIP_SAVED, clip);
  return clip;
}

// ── Queries ─────────────────────────────────────────────────────────
/** Current state; a missing encoder is reported through `error`. */
export async function getCaptureState(): Promise<RecordingState> {
  const caps = await detectCapabilities();
  if (!caps.supported) return errorState(caps.reason ?? "video capture is not supported");
  return stateSnapshot();
}

export async function captureIsSupported(): Promise<boolean> {
  const caps = await detectCapabilities();
  return caps.supported;
}

export async function captureCapabilities(): Promise<CaptureCapabilities> {
  return detectCapabilities();
}

// ── Shutdown ────────────────────────────────────────────────────────
/**
 * Remove staging files and replay buffers left behind by a crashed session.
 * Windows refuses to delete files an orphaned encoder still holds open, so a
 * live process is never disturbed — only abandoned files are reclaimed.
 */
function cleanAbandonedWork(now: number): void {
  try {
    const folder = clipFolder();
    if (fs.existsSync(folder)) {
      const cutoff = now - 6 * 60 * 60 * 1_000;
      for (const name of fs.readdirSync(folder)) {
        if (!name.startsWith(".recording-")) continue;
        const file = path.join(folder, name);
        try {
          if (fs.statSync(file).mtimeMs < cutoff) fs.rmSync(file, { force: true });
        } catch {
          /* still open, or vanished */
        }
      }
    }
  } catch (error) {
    console.warn("[capture] could not clean stale staging files:", error);
  }

  try {
    const root = path.join(app.getPath("userData"), "capture", "replay");
    if (!fs.existsSync(root)) return;
    const cutoff = now - 24 * 60 * 60 * 1_000;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith("buffer-")) continue;
      const dir = path.join(root, entry.name);
      try {
        if (fs.statSync(dir).mtimeMs < cutoff) fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* a live buffer holds its segments open */
      }
    }
  } catch (error) {
    console.warn("[capture] could not clean stale replay buffers:", error);
  }
}

void app.whenReady().then(() => cleanAbandonedWork(Date.now()));

/**
 * Kill the encoder and finalize the file before the process table is torn
 * down. Called from `before-quit`; the remux runs synchronously because the
 * event loop will not survive another tick of async work.
 */
export function stopAllOnQuit(): void {
  const capture = active;
  active = null;
  if (!capture) return;
  capture.stopping = true;
  try {
    capture.handle.child.kill();
  } catch {
    /* already gone */
  }
  if (capture.handle.pruneTimer) {
    clearInterval(capture.handle.pruneTimer);
    capture.handle.pruneTimer = null;
  }
  if (capture.kind === "record") {
    try {
      finalizeRecordingSync(capture.handle, cachedCapabilities());
    } catch (error) {
      console.error("[capture] could not finalize the recording on quit:", error);
    }
  } else {
    clearReplayBuffer(capture.handle);
  }
  restoreOverlay(capture);
}

app.on("before-quit", stopAllOnQuit);
