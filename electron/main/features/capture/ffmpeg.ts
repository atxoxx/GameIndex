/**
 * ffmpeg-backed video capture for Windows.
 *
 * The Tauri build drove Windows Graphics Capture + Media Foundation in Rust.
 * Electron has no encoder, so this port shells out to an ffmpeg that is already
 * installed (`gdigrab` for the desktop, `dshow` for audio). Everything is
 * spawned with an argv array and `shell: false`, so a game title or device name
 * can never be interpreted by a command shell.
 *
 * Honest degradation (see the port report):
 *   • no ffmpeg → `detectCapabilities()` reports unsupported with a reason and
 *     every start/save command throws instead of writing an empty clip.
 *   • Windows has no SIGINT for a child process: `child.kill()` terminates
 *     ffmpeg immediately. Manual recordings are therefore written to an MPEG-TS
 *     transport stream (which stays readable when truncated) and remuxed to MP4
 *     with `-c copy` after the process exits. The replay buffer writes
 *     independent `.ts` segments (one file per roll, never overwritten) that are
 *     concatenated on demand, so saving a replay never touches the live buffer.
 *   • audio is limited to what `dshow` exposes. Game audio needs a loopback
 *     endpoint (Stereo Mix / virtual-audio-capturer); without one it is simply
 *     not recorded — no silent fake track.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  type AudioDeviceInfo,
  type AudioDeviceList,
  type CaptureCapabilities,
  type CaptureConfig,
  type CaptureContainer,
} from "./types";

/** Wall-clock format used by the Rust recorder: `YYYYMMDD_HHMMSS`. */
function stamp(date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

export function clipFileName(kind: "record" | "replay", container: CaptureContainer): string {
  const prefix = kind === "record" ? "Record" : "Replay";
  return `${prefix}_${stamp()}.${container}`;
}

export function uniqueOutputPath(
  folder: string,
  fileName: string,
): string {
  const ext = path.extname(fileName);
  const base = fileName.slice(0, fileName.length - ext.length);
  let candidate = path.join(folder, fileName);
  let suffix = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(folder, `${base}_${suffix}${ext}`);
    suffix += 1;
  }
  return candidate;
}

function even(value: number): number {
  const rounded = Math.round(value);
  return Math.max(2, rounded - (rounded % 2));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Process helpers ─────────────────────────────────────────────────
interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  error: string | null;
}

const MAX_CAPTURED = 64 * 1024;

/** Run a short-lived helper command (`-version`, `-list_devices`, remux…). */
async function run(command: string, args: string[], timeoutMs = 15_000): Promise<RunResult> {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let timer: NodeJS.Timeout | null = null;

    const finish = (result: RunResult): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    let child: ChildProcess;
    try {
      child = spawn(command, args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({ code: null, stdout: "", stderr: "", error: messageOf(error) });
      return;
    }

    timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
      finish({ code: null, stdout, stderr, error: `timed out after ${timeoutMs} ms` });
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_CAPTURED) stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_CAPTURED) stderr += chunk.toString();
    });
    child.on("error", (error) => {
      finish({ code: null, stdout, stderr, error: messageOf(error) });
    });
    child.on("close", (code) => {
      finish({ code, stdout, stderr, error: null });
    });
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function lastLines(text: string, count: number): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-count)
    .join(" ");
}

/** Turn ffmpeg's stderr into something the renderer can show. */
function formatFfmpegError(stderr: string, code: number | null): string {
  const detail = lastLines(stderr, 2);
  const lower = stderr.toLowerCase();
  let hint: string | null = null;
  if (lower.includes("cannot open video device") || lower.includes("gdigrab")) {
    hint = "the desktop capture device could not be opened";
  } else if (lower.includes("could not find audio") || lower.includes("audio device")) {
    hint = "the configured audio device could not be opened — pick another one in Settings → Overlay → Video";
  } else if (lower.includes("no such file or directory") && lower.includes("ffmpeg")) {
    hint = "ffmpeg could not be found on PATH";
  }
  const base = detail || `ffmpeg exited with code ${code ?? "unknown"}`;
  return hint ? `${hint} (${base})` : base;
}

// ── Capability detection (once, cached) ─────────────────────────────
let capabilities: CaptureCapabilities | null = null;
let detection: Promise<CaptureCapabilities> | null = null;

async function versionOf(command: string): Promise<string | null> {
  const result = await run(command, ["-version"], 8_000);
  if (result.code !== 0 || result.error) return null;
  const first = result.stdout.split(/\r?\n/)[0]?.trim();
  return first && first.length > 0 ? first : "unknown";
}

async function detect(): Promise<CaptureCapabilities> {
  const version = await versionOf("ffmpeg");
  if (!version) {
    return {
      supported: false,
      backend: null,
      ffmpeg: null,
      ffprobe: null,
      version: null,
      reason:
        "ffmpeg not found — install ffmpeg and add it to PATH, then restart GameIndex",
    };
  }
  const ffprobeVersion = await versionOf("ffprobe");
  const windows = process.platform === "win32";
  return {
    supported: windows,
    backend: "ffmpeg",
    ffmpeg: "ffmpeg",
    ffprobe: ffprobeVersion ? "ffprobe" : null,
    version,
    reason: windows
      ? null
      : "video capture is implemented for Windows (gdigrab/dshow) only",
  };
}

/** Detect ffmpeg/ffprobe once and cache the answer for the session. */
export async function detectCapabilities(): Promise<CaptureCapabilities> {
  if (capabilities) return capabilities;
  if (!detection) {
    detection = detect()
      .then((result) => {
        capabilities = result;
        return result;
      })
      .catch((error: unknown) => {
        capabilities = {
          supported: false,
          backend: null,
          ffmpeg: null,
          ffprobe: null,
          version: null,
          reason: `could not probe ffmpeg — ${messageOf(error)}`,
        };
        return capabilities;
      })
      .finally(() => {
        detection = null;
      });
  }
  return detection;
}

export function cachedCapabilities(): CaptureCapabilities | null {
  return capabilities;
}

// ── Audio endpoints ─────────────────────────────────────────────────
/** Names that look like a playback loopback endpoint rather than a mic. */
const LOOPBACK_HINTS = /stereo mix|loopback|virtual-audio|virtual audio|what u hear|wave out|sound mapper/i;

function parseDshowAudioDevices(stderr: string): string[] {
  const names: string[] = [];
  for (const line of stderr.split(/\r?\n/)) {
    const match = /\][ \t]*"([^"]+)"[ \t]*\(audio\)/i.exec(line);
    if (!match) continue;
    const name = match[1].trim();
    if (!name || name.toLowerCase() === "alternative name") continue;
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * Enumerate dshow audio endpoints. ffmpeg does not say which are playback and
 * which are capture, so the split is a documented name heuristic; ids are the
 * device names ffmpeg itself accepts for `-i audio="<name>"`.
 */
export async function listAudioDevices(): Promise<AudioDeviceList> {
  const caps = await detectCapabilities();
  if (!caps.supported || !caps.ffmpeg) return { output: [], input: [] };
  const result = await run(
    caps.ffmpeg,
    ["-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"],
    12_000,
  );
  const names = parseDshowAudioDevices(result.stderr);
  if (names.length === 0) return { output: [], input: [] };
  const output: AudioDeviceInfo[] = [];
  const input: AudioDeviceInfo[] = [];
  for (const name of names) {
    if (LOOPBACK_HINTS.test(name)) {
      output.push({ id: name, name, isDefault: output.length === 0 });
    } else {
      input.push({ id: name, name, isDefault: input.length === 0 });
    }
  }
  return { output, input };
}

// ── Capture processes ───────────────────────────────────────────────
export interface CaptureHandle {
  kind: "record" | "replay";
  child: ChildProcess;
  startedAt: number;
  /**
   * `record`: the transport-stream file ffmpeg writes (promoted on stop).
   * `replay`: the directory holding the rolling `.ts` segments.
   */
  tempPath: string;
  /** Final clip path for manual recordings (`""` for replay). */
  outputPath: string;
  container: CaptureContainer;
  /** Length of one replay segment, in seconds. */
  segmentSeconds: number;
  /** Last stderr bytes; surfaced in actionable errors. */
  stderrTail: string;
  exited: Promise<number | null>;
  pruneTimer: NodeJS.Timeout | null;
}

/** Unique dshow endpoints in input order: microphone first, then game audio. */
function audioDevices(config: CaptureConfig): string[] {
  const devices: string[] = [];
  for (const device of [config.micDevice, config.gameAudioDevice]) {
    if (device && !devices.includes(device)) devices.push(device);
  }
  return devices.slice(0, 2);
}

function buildInputArgs(config: CaptureConfig): string[] {
  const args = [
    "-thread_queue_size",
    "1024",
    "-f",
    "gdigrab",
    "-framerate",
    String(config.fps),
    "-draw_mouse",
    config.showCursor ? "1" : "0",
    "-video_size",
    `${even(config.captureWidth)}x${even(config.captureHeight)}`,
    "-offset_x",
    "0",
    "-offset_y",
    "0",
    "-i",
    "desktop",
  ];
  // Input #1 (and #2) are the dshow audio endpoints; `audioCountFor` counts
  // them in this exact order.
  for (const device of audioDevices(config)) {
    args.push("-thread_queue_size", "512", "-f", "dshow", "-i", `audio=${device}`);
  }
  return args;
}

function videoCodecArgs(config: CaptureConfig): string[] {
  const bitrate = `${clamp(Math.round(config.bitrateKbps), 1_000, 100_000)}k`;
  const gop = String(Math.max(2, config.fps * 2));
  if (config.container === "webm") {
    return [
      "-c:v",
      "libvpx-vp9",
      "-deadline",
      "realtime",
      "-cpu-used",
      "8",
      "-row-mt",
      "1",
      "-b:v",
      bitrate,
      "-g",
      gop,
      "-pix_fmt",
      "yuv420p",
    ];
  }
  return [
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    "-b:v",
    bitrate,
    "-g",
    gop,
  ];
}

function audioCodecArgs(config: CaptureConfig): string[] {
  return config.container === "webm"
    ? ["-c:a", "libopus", "-b:a", "160k"]
    : ["-c:a", "aac", "-b:a", "160k"];
}

function scaleFilter(config: CaptureConfig): string | null {
  if (config.resolutionScale >= 0.999) return null;
  const scale = config.resolutionScale.toFixed(3);
  return `scale=trunc(iw*${scale}/2)*2:trunc(ih*${scale}/2)*2,setsar=1`;
}

/** Video/audio filter graph plus the stream maps for the chosen inputs. */
function streamArgs(config: CaptureConfig, audioCount: number): string[] {
  const filter = scaleFilter(config);
  const args: string[] = [];
  if (audioCount === 2) {
    const graph: string[] = [];
    if (filter) graph.push(`[0:v]${filter}[vout]`);
    graph.push("[1:a][2:a]amix=inputs=2:duration=longest[aout]");
    args.push("-filter_complex", graph.join(";"));
    args.push("-map", filter ? "[vout]" : "0:v:0", "-map", "[aout]");
  } else {
    if (filter) args.push("-vf", filter);
    args.push("-map", "0:v:0");
    if (audioCount === 1) args.push("-map", "1:a:0");
  }
  return args;
}

function audioCountFor(config: CaptureConfig): number {
  return audioDevices(config).length;
}

/**
 * The exact argv a manual recording spawns. Exported as a test seam (the
 * harness checks the argv without a real encoder); not part of the command API.
 */
export function buildRecordingArgs(config: CaptureConfig, tempPath: string): string[] {
  const audioCount = audioCountFor(config);
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostats",
    "-y",
    ...buildInputArgs(config),
    ...streamArgs(config, audioCount),
    ...videoCodecArgs(config),
  ];
  if (audioCount > 0) args.push(...audioCodecArgs(config));
  if (config.maxClipSeconds > 0) args.push("-t", String(Math.round(config.maxClipSeconds)));
  if (config.container === "mp4") {
    // Transport stream: still readable if ffmpeg is terminated mid-write.
    args.push("-f", "mpegts", tempPath);
  } else {
    args.push("-f", config.container === "webm" ? "webm" : "matroska", tempPath);
  }
  return args;
}

function replaySegmentDirectory(bufferRoot: string): string {
  return path.join(bufferRoot, `buffer-${stamp()}-${process.pid}`);
}

/** The exact argv the rolling replay buffer spawns (test seam, see above). */
export function buildReplayArgs(config: CaptureConfig, directory: string): string[] {
  const audioCount = audioCountFor(config);
  const segmentSeconds = clamp(Math.ceil(config.replaySeconds / 6), 2, 10);
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostats",
    "-y",
    ...buildInputArgs(config),
    ...streamArgs(config, audioCount),
    // The replay buffer is always H.264/MPEG-TS so the segments concatenate
    // without re-encoding (mp4/`-c copy` is the only reliable Windows path).
    ...videoCodecArgs({ ...config, container: "mp4" }),
  ];
  if (audioCount > 0) args.push(...audioCodecArgs({ ...config, container: "mp4" }));
  args.push(
    "-f",
    "segment",
    "-segment_time",
    String(segmentSeconds),
    "-segment_format",
    "mpegts",
    "-reset_timestamps",
    "1",
    "-strftime",
    "1",
    path.join(directory, "buf_%Y%m%d_%H%M%S.ts"),
  );
  return args;
}

export function replaySegmentSeconds(replaySeconds: number): number {
  return clamp(Math.ceil(replaySeconds / 6), 2, 10);
}

function listSegments(directory: string): string[] {
  try {
    return fs
      .readdirSync(directory)
      .filter((name) => name.startsWith("buf_") && name.endsWith(".ts"))
      .map((name) => path.join(directory, name))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Delete old replay segments. Segments are uniquely named and never
 * overwritten, so pruning is a plain mtime sweep that keeps a small tail.
 */
function pruneSegments(directory: string, keepMs: number): void {
  const files = listSegments(directory);
  if (files.length <= 2) return;
  const cutoff = Date.now() - keepMs;
  for (const file of files.slice(0, -2)) {
    try {
      if (fs.statSync(file).mtimeMs < cutoff) fs.rmSync(file, { force: true });
    } catch {
      /* a segment may roll while we sweep */
    }
  }
}

function spawnCapture(
  params: {
    kind: "record" | "replay";
    args: string[];
    tempPath: string;
    outputPath: string;
    container: CaptureContainer;
    segmentSeconds: number;
    /** How long segments are retained, for replay pruning. */
    keepMs: number;
  },
  command: string,
): Promise<CaptureHandle> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(command, params.args, {
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"],
      });
    } catch (error) {
      reject(new Error(`ffmpeg could not start — ${messageOf(error)}`));
      return;
    }

    let resolveExit: (code: number | null) => void = () => {};
    const exited = new Promise<number | null>((resolvePromise) => {
      resolveExit = resolvePromise;
    });

    const handle: CaptureHandle = {
      kind: params.kind,
      child,
      startedAt: Date.now(),
      tempPath: params.tempPath,
      outputPath: params.outputPath,
      container: params.container,
      segmentSeconds: params.segmentSeconds,
      stderrTail: "",
      exited,
      pruneTimer: null,
    };

    child.stderr?.on("data", (chunk: Buffer) => {
      handle.stderrTail = (handle.stderrTail + chunk.toString()).slice(-8_000);
    });
    child.on("close", (code) => resolveExit(code));
    child.on("error", (error) => {
      handle.stderrTail += `\n${messageOf(error)}`;
    });

    let settled = false;
    const fail = (message: string): void => {
      if (settled) return;
      settled = true;
      if (handle.pruneTimer) clearInterval(handle.pruneTimer);
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
      reject(new Error(message));
    };

    child.once("error", (error) => {
      fail(`ffmpeg could not start — ${messageOf(error)}`);
    });

    child.once("spawn", () => {
      // gdigrab/dshow failures are usually reported within the first frames.
      setTimeout(() => {
        if (settled) return;
        if (child.exitCode !== null) {
          fail(formatFfmpegError(handle.stderrTail, child.exitCode));
          return;
        }
        if (params.kind === "replay") {
          pruneSegments(params.tempPath, params.keepMs);
          const timer = setInterval(() => pruneSegments(params.tempPath, params.keepMs), 5_000);
          timer.unref?.();
          handle.pruneTimer = timer;
        }
        settled = true;
        resolve(handle);
      }, 700);
    });
  });
}

/** Start a manual recording. The temp stream is promoted by `finalizeRecording`. */
export async function startRecordingProcess(
  config: CaptureConfig,
  caps: CaptureCapabilities,
  outputPath: string,
): Promise<CaptureHandle> {
  if (!caps.ffmpeg) throw new Error(caps.reason ?? "ffmpeg not found");
  const tempPath =
    config.container === "mp4"
      ? path.join(path.dirname(outputPath), `.recording-${stamp()}-${process.pid}.ts`)
      : outputPath;
  const args = buildRecordingArgs(config, tempPath);
  return spawnCapture(
    {
      kind: "record",
      args,
      tempPath,
      outputPath,
      container: config.container,
      segmentSeconds: 0,
      keepMs: 0,
    },
    caps.ffmpeg,
  );
}

/** Arm the rolling replay buffer. */
export async function startReplayProcess(
  config: CaptureConfig,
  caps: CaptureCapabilities,
  bufferRoot: string,
): Promise<CaptureHandle> {
  if (!caps.ffmpeg) throw new Error(caps.reason ?? "ffmpeg not found");
  const directory = replaySegmentDirectory(bufferRoot);
  fs.mkdirSync(directory, { recursive: true });
  const segmentSeconds = replaySegmentSeconds(config.replaySeconds);
  const args = buildReplayArgs(config, directory);
  const keepMs = (config.replaySeconds + segmentSeconds * 2 + 15) * 1_000;
  return spawnCapture(
    {
      kind: "replay",
      args,
      tempPath: directory,
      outputPath: "",
      container: "mp4",
      segmentSeconds,
      keepMs,
    },
    caps.ffmpeg,
  );
}

/** Terminate a capture process and wait for it to release the output file. */
export async function stopProcess(handle: CaptureHandle): Promise<void> {
  if (handle.pruneTimer) {
    clearInterval(handle.pruneTimer);
    handle.pruneTimer = null;
  }
  if (handle.child.exitCode !== null) return;
  try {
    // Windows maps this to TerminateProcess; the transport-stream output keeps
    // the file readable, which is why recordings are staged in MPEG-TS.
    handle.child.kill();
  } catch {
    /* already gone */
  }
  const exited = await Promise.race([
    handle.exited.then(() => true),
    delay(5_000).then(() => false),
  ]);
  if (!exited) {
    try {
      handle.child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
    await Promise.race([handle.exited, delay(3_000)]);
  }
}

/** Throw away a replay buffer's segment directory. */
export function clearReplayBuffer(handle: CaptureHandle): void {
  try {
    fs.rmSync(handle.tempPath, { recursive: true, force: true });
  } catch (error) {
    console.warn("[capture] could not remove replay buffer:", error);
  }
}

function fileSizeOf(filePath: string): number | null {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() ? stat.size : null;
  } catch {
    return null;
  }
}

/** Promote a finished `.ts` staging file into the final clip. */
export async function finalizeRecording(
  handle: CaptureHandle,
  caps: CaptureCapabilities,
): Promise<{ filePath: string; sizeBytes: number }> {
  const tempPath = handle.tempPath;
  const size = fileSizeOf(tempPath);
  if (size === null || size < 1_024) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      /* best effort */
    }
    const detail = lastLines(handle.stderrTail, 2);
    throw new Error(
      `the recorder produced no video data${
        detail ? ` — ${detail}` : " — ffmpeg exited before writing any frames"
      }`,
    );
  }

  if (handle.container !== "mp4") {
    // Matroska/WebM are written straight to the final path; no remux needed.
    const finalSize = fileSizeOf(handle.outputPath);
    if (finalSize === null) throw new Error("the recording file disappeared before it was finalized");
    return { filePath: handle.outputPath, sizeBytes: finalSize };
  }

  const remux = await run(
    caps.ffmpeg ?? "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      tempPath,
      "-map",
      "0",
      "-c",
      "copy",
      "-bsf:a",
      "aac_adtstoasc",
      "-movflags",
      "+faststart",
      handle.outputPath,
    ],
    120_000,
  );
  const remuxed = fileSizeOf(handle.outputPath);
  if (remux.code === 0 && remuxed !== null && remuxed > 0) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      /* best effort */
    }
    return { filePath: handle.outputPath, sizeBytes: remuxed };
  }

  // Remux failed: keep the (playable) transport stream rather than losing the
  // take. The UI plays it through the OS player and lists `.ts` clips.
  const fallback = handle.outputPath.replace(/\.[^.]+$/, ".ts");
  try {
    fs.rmSync(fallback, { force: true });
  } catch {
    /* best effort */
  }
  try {
    fs.renameSync(tempPath, fallback);
  } catch {
    fs.copyFileSync(tempPath, fallback);
    fs.rmSync(tempPath, { force: true });
  }
  const fallbackSize = fileSizeOf(fallback);
  if (fallbackSize === null) throw new Error("the recording could not be finalized");
  return { filePath: fallback, sizeBytes: fallbackSize };
}

/** Blocking variant used only while the app is quitting. */
export function finalizeRecordingSync(
  handle: CaptureHandle,
  caps: CaptureCapabilities | null,
): string | null {
  const tempPath = handle.tempPath;
  if (fileSizeOf(tempPath) === null) return null;
  if (handle.container !== "mp4") return handle.outputPath;

  // If the remux cannot run during shutdown, keep the (playable) transport
  // stream under a visible name instead of leaving a hidden staging file.
  const fallback = handle.outputPath.replace(/\.[^.]+$/, ".ts");
  const keepTransportStream = (): string | null => {
    try {
      fs.rmSync(fallback, { force: true });
    } catch {
      /* best effort */
    }
    try {
      fs.renameSync(tempPath, fallback);
      return fallback;
    } catch {
      return null;
    }
  };

  if (!caps?.ffmpeg) return keepTransportStream();
  const result = spawnSync(
    caps.ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      tempPath,
      "-map",
      "0",
      "-c",
      "copy",
      "-bsf:a",
      "aac_adtstoasc",
      "-movflags",
      "+faststart",
      handle.outputPath,
    ],
    { windowsHide: true, timeout: 20_000, encoding: "utf8" },
  );
  if (result.status !== 0) return keepTransportStream();
  try {
    fs.rmSync(tempPath, { force: true });
  } catch {
    /* best effort */
  }
  return handle.outputPath;
}

/** Exact duration in ms when ffprobe exists, else `null`. */
export async function probeDurationMs(
  filePath: string,
  caps: CaptureCapabilities,
): Promise<number | null> {
  if (!caps.ffprobe) return null;
  const result = await run(
    caps.ffprobe,
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=nw=1:nk=1",
      filePath,
    ],
    30_000,
  );
  if (result.code !== 0) return null;
  const seconds = Number.parseFloat(result.stdout.trim());
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1_000) : null;
}

/**
 * Promote the newest segment window into a permanent clip. The live buffer is
 * untouched, so the user can keep saving clips while it stays armed.
 */
export async function saveReplayBuffer(
  handle: CaptureHandle,
  caps: CaptureCapabilities,
  outputPath: string,
  wantedSeconds: number,
): Promise<{ filePath: string; sizeBytes: number; estimatedSeconds: number }> {
  const all = listSegments(handle.tempPath);
  if (all.length === 0) {
    throw new Error(
      "the replay buffer has no finished segments yet — wait a few seconds and try again",
    );
  }
  const wanted = Math.max(1, Math.ceil(wantedSeconds / Math.max(1, handle.segmentSeconds)) + 1);
  let count = Math.min(all.length, wanted);
  const listPath = path.join(handle.tempPath, "concat.txt");
  let lastError = "";

  try {
    while (count >= 1) {
      const files = all.slice(all.length - count);
      fs.writeFileSync(
        listPath,
        `${files.map((file) => `file '${file.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n")}\n`,
        "utf8",
      );
      const result = await run(
        caps.ffmpeg ?? "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          listPath,
          "-map",
          "0",
          "-c",
          "copy",
          "-bsf:a",
          "aac_adtstoasc",
          "-movflags",
          "+faststart",
          outputPath,
        ],
        120_000,
      );
      const size = fileSizeOf(outputPath);
      if (result.code === 0 && size !== null && size > 0) {
        return {
          filePath: outputPath,
          sizeBytes: size,
          estimatedSeconds: count * handle.segmentSeconds,
        };
      }
      lastError = formatFfmpegError(result.stderr, result.code);
      // The newest segment may still be open; retry without it.
      try {
        fs.rmSync(outputPath, { force: true });
      } catch {
        /* best effort */
      }
      count -= 1;
    }
  } finally {
    try {
      fs.rmSync(listPath, { force: true });
    } catch {
      /* best effort */
    }
  }

  throw new Error(`the replay clip could not be written — ${lastError || "ffmpeg failed"}`);
}
