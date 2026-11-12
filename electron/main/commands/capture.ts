/**
 * Clip capture, replay buffer and reels.
 *
 * Workstream: `capture`. Reference: `git show 1b4a698b:src-tauri/src/capture/`,
 * `reels.rs`, `db/clips.rs`, `db/schema_clips.sql`.
 *
 * Split:
 *   • `features/capture/library.ts`   — clips.json registry, reels, folder
 *   • `features/capture/ffmpeg.ts`    — capability probe + ffmpeg processes
 *   • `features/capture/controller.ts`— one-session state machine + events
 *
 * `capture_is_supported` returns a boolean because the overlay HUD binds it
 * directly (`setCaptureSupported(Boolean(value))`); the actionable reason is
 * exposed through `capture_get_state().error` and `__capture_capabilities`.
 */
import { registerCommands, type CommandHandler } from "../ipc";
import {
  captureCapabilities,
  captureIsSupported,
  getCaptureState,
  saveReplay,
  startRecording,
  startReplay,
  stopRecording,
  stopReplay,
  toggleRecording,
} from "../features/capture/controller";
import { listAudioDevices } from "../features/capture/ffmpeg";
import {
  addClipToReel,
  createReel,
  deleteClipById,
  deleteClipFile,
  deleteReel,
  listClipFiles,
  openClipLocation,
  registerClip,
  reelsSnapshot,
  removeClipFromReel,
  renameReel,
  reorderReel,
  updateClip,
} from "../features/capture/library";
import type { RegisterClipPayload, UpdateClipPayload } from "../features/capture/types";

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/** `null`/absent stays `null` (create) or "leave untouched" (rename). */
function asOptionalDescription(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : String(value);
}

/** The UI nests the payload (Tauri arg shape); flat args are tolerated too. */
function registerPayload(args: Record<string, unknown>): RegisterClipPayload {
  const nested = args.clip;
  if (nested && typeof nested === "object") return nested as RegisterClipPayload;
  return args as RegisterClipPayload;
}

function updatePayload(args: Record<string, unknown>): UpdateClipPayload {
  const nested = args.update;
  if (nested && typeof nested === "object") return nested as UpdateClipPayload;
  return args as UpdateClipPayload;
}

export const captureCommands: Record<string, CommandHandler> = {
  // ── Recorder state ────────────────────────────────────────────────
  capture_get_state: () => getCaptureState(),

  capture_is_supported: () => captureIsSupported(),

  capture_list_audio_devices: () => listAudioDevices(),

  capture_start_recording: () => startRecording(),

  capture_stop_recording: () => stopRecording(),

  capture_toggle_recording: () => toggleRecording(),

  capture_start_replay: () => startReplay(),

  capture_stop_replay: () => stopReplay(),

  capture_save_replay: () => saveReplay(),

  // ── Clip folder ───────────────────────────────────────────────────
  capture_get_recent_clips: () => listClipFiles(),

  capture_open_clip_folder: async (args) => {
    const target = args.path;
    await openClipLocation(typeof target === "string" ? target : null);
    return null;
  },

  capture_delete_clip: (args) => {
    deleteClipFile(asString(args.path));
    return null;
  },

  // ── Reels registry ────────────────────────────────────────────────
  reels_get_snapshot: () => reelsSnapshot(),

  register_clip: (args) => registerClip(registerPayload(args)),

  update_clip: (args) => {
    updateClip(updatePayload(args));
    return null;
  },

  delete_clip: (args) => {
    deleteClipById(asString(args.id));
    return null;
  },

  create_reel: (args) => {
    createReel(asString(args.id), asString(args.name), asOptionalDescription(args.description));
    return null;
  },

  rename_reel: (args) => {
    renameReel(asString(args.id), asString(args.name), asOptionalDescription(args.description));
    return null;
  },

  delete_reel: (args) => {
    deleteReel(asString(args.id));
    return null;
  },

  add_clip_to_reel: (args) => addClipToReel(asString(args.reelId), asString(args.clipId)),

  remove_clip_from_reel: (args) => {
    removeClipFromReel(asString(args.reelId), asString(args.clipId));
    return null;
  },

  reorder_reel: (args) => {
    const ids = Array.isArray(args.clipIds) ? args.clipIds.map((value) => String(value)) : [];
    reorderReel(asString(args.reelId), ids);
    return null;
  },

  /**
   * Diagnostics only (same family as `__app_paths`): the recorder's backend and
   * the real reason when it is unavailable. Not used by the UI.
   */
  __capture_capabilities: () => captureCapabilities(),
};

export function registerCaptureCommands(): void {
  registerCommands(captureCommands, { override: true });
}
