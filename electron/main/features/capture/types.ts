/**
 * Wire + storage shapes for the capture / clips / reels workstream.
 *
 * Everything here mirrors the retired Rust serde contracts so the renderer
 * (`src/types/reels.ts`, `src/context/OverlayContext.tsx`) keeps working
 * unchanged:
 *   • `Clip` / `ClipRow`      ← `src-tauri/src/db/clips.rs`
 *   • `Reel` / `ReelRow`      ← `src-tauri/src/db/clips.rs`
 *   • `RecordingState`        ← `src-tauri/src/capture/mod.rs`
 *   • `ClipInfo`              ← `ClipResult` in `capture/mod.rs`
 *   • `AudioDeviceList`       ← `capture/audio.rs`
 */

/** Event emitted whenever the recorder/replay state changes. */
export const EVENT_CAPTURE_STATE = "capture:state";
/** Event emitted once a clip has been finalized on disk. */
export const EVENT_CLIP_SAVED = "capture:clip-saved";

/** One registered clip (a recording, replay dump or imported file). */
export interface ClipRow {
  id: string;
  /** Absolute file path on disk (the upsert key). */
  path: string;
  gameId?: string;
  gameName?: string;
  title: string;
  /** `record` | `replay` | `import` */
  kind?: string;
  durationMs?: number;
  sizeBytes?: number;
  favorite: boolean;
  /** When the footage was recorded (Unix ms). */
  createdAt: number;
  /** When it entered the registry (Unix ms). */
  addedAt: number;
}

/** A reel (playlist) plus its clip ids in playback order. */
export interface ReelRow {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  clipIds: string[];
}

export interface ReelsSnapshot {
  clips: ClipRow[];
  reels: ReelRow[];
}

/** What `register_clip` receives (the frontend generates the id). */
export interface RegisterClipPayload {
  id?: string;
  path?: string;
  title?: string;
  gameId?: string | null;
  gameName?: string | null;
  kind?: string | null;
  durationMs?: number | null;
  sizeBytes?: number | null;
  createdAt?: number | null;
}

/** What `update_clip` receives; `null` unlinks, absent leaves untouched. */
export interface UpdateClipPayload {
  id?: string;
  title?: string;
  favorite?: boolean;
  gameId?: string | null;
  gameName?: string | null;
}

/** Mirrors the backend `RecordingState` (camelCase on the wire). */
export interface RecordingState {
  recording: boolean;
  replayBuffering: boolean;
  startedAt?: number | null;
  durationMs: number;
  /** Non-zero only while a pre-roll countdown is running. */
  countdownMs?: number;
  error?: string | null;
}

/** A finished video clip written by the recorder. */
export interface ClipInfo {
  filePath: string;
  fileName: string;
  gameTitle: string;
  timestamp: number;
  durationMs: number;
  width: number;
  height: number;
  /** `record` for a manual take, `replay` for a buffered dump. */
  kind: string;
}

/** One audio endpoint for the recorder's device dropdowns. */
export interface AudioDeviceInfo {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface AudioDeviceList {
  output: AudioDeviceInfo[];
  input: AudioDeviceInfo[];
}

export type CaptureContainer = "mp4" | "mkv" | "webm";

/** Result of the one-time ffmpeg probe. */
export interface CaptureCapabilities {
  supported: boolean;
  backend: "ffmpeg" | null;
  /** Command name used to spawn the binary (`null` when absent). */
  ffmpeg: string | null;
  ffprobe: string | null;
  version: string | null;
  /** Actionable explanation when `supported` is false. */
  reason: string | null;
}

/** Everything the ffmpeg recorder needs, already resolved from the settings. */
export interface CaptureConfig {
  fps: number;
  bitrateKbps: number;
  resolutionScale: number;
  /** Physical pixels of the captured desktop region (even numbers). */
  captureWidth: number;
  captureHeight: number;
  /** Encoded frame size after `resolutionScale` (even numbers). */
  outputWidth: number;
  outputHeight: number;
  showCursor: boolean;
  /** `0` disables the `-t` cap. */
  maxClipSeconds: number;
  replaySeconds: number;
  /** dshow playback/loopback device name, when game audio was selected. */
  gameAudioDevice: string | null;
  /** dshow microphone device name, when the mic was enabled. */
  micDevice: string | null;
  container: CaptureContainer;
  folder: string;
  gameTitle: string;
}
