/**
 * Persisted in-game overlay configuration.
 *
 * The shape mirrors the Rust `OverlaySettings` serde contract exactly
 * (camelCase on the wire), because the React overlay (`OverlayContext`) treats
 * `overlay_get_settings` / `overlay_save_settings` payloads as that type. Every
 * field is optional at the wire level: unknown keys are ignored and missing
 * ones fall back to the defaults below, so older/partial payloads still load.
 *
 * Storage lives in `kv.db` (`documents` row `overlay`). The retired Tauri build
 * used two `kv_store` rows; this port keeps settings and the opaque history blob
 * in one SQLite document so they update atomically. A legacy `overlay.json` is
 * imported once on first read and then renamed to `*.migrated`.
 */
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { readDocumentJson } from "../state/db/documents";
import { createSqliteStore } from "../state/sqliteStore";

export type OverlayCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface OverlaySettings {
  enabled: boolean;
  hotkey: string;
  corner: OverlayCorner;
  opacity: number;
  tickerWidgets: string[];
  panelWidgets: string[];
  tickerLayout: string;
  panelDensity: string;
  lastPanelSection: string;
  backgroundStyle: string;
  backgroundBlur: number;
  backgroundOpacity: number;
  reduceEffects: boolean;
  highContrast: boolean;
  textScale: number;
  tickerClickThrough: boolean;
  tickerAutoDimSeconds: number;
  tickerAutoHideSeconds: number;
  pollIntervalMs: number;
  showTemps: boolean;
  detectCurrentGame: boolean;
  showGraphs: boolean;
  posX: number | null;
  posY: number | null;
  tickerWidth: number;
  tickerHeight: number;
  panelWidth: number;
  panelHeight: number;

  screenshotFormat: string;
  screenshotFolder: string | null;
  screenshotHotkey: string;
  screenshotSound: boolean;
  screenshotFlash: boolean;
  screenshotCopyToClipboard: boolean;
  screenshotIncludeOverlay: boolean;
  screenshotDelayMs: number;

  videoEnabled: boolean;
  videoHotkey: string;
  replayHotkey: string;
  videoFps: number;
  videoBitrateKbps: number;
  videoResolutionScale: number;
  videoFormat: string;
  videoFolder: string | null;
  videoGameAudio: boolean;
  videoMicrophone: boolean;
  videoAudioDevice: string | null;
  videoMicDevice: string | null;
  replayBufferSeconds: number;
  videoMaxClipSeconds: number;
  videoShowCursor: boolean;
  videoSound: boolean;
  videoCountdownMs: number;
  videoHideOverlay: boolean;
  videoRecording: boolean;
  replayBufferActive: boolean;

  nativeBlur: boolean;
  effectColor: number[] | null;

  [key: string]: unknown;
}

/** Default window footprints in DIP, matching the Rust constants. */
export const DEFAULT_TICKER_WIDTH = 480;
export const DEFAULT_TICKER_HEIGHT = 72;
export const DEFAULT_PANEL_WIDTH = 540;
export const DEFAULT_PANEL_HEIGHT = 620;
/** Clamps so a bad persisted size can't produce an unusable window. */
export const MIN_TICKER_WIDTH = 180;
export const MIN_TICKER_HEIGHT = 44;
export const MIN_PANEL_WIDTH = 460;
export const MIN_PANEL_HEIGHT = 400;
export const MAX_OVERLAY_DIM = 4000;
/** Gap between the overlay edge and the monitor work-area edge. */
export const OVERLAY_MARGIN = 16;

export const DEFAULT_OVERLAY_SETTINGS: OverlaySettings = {
  enabled: false,
  hotkey: "Shift+F1",
  corner: "bottom-right",
  opacity: 0.9,
  tickerWidgets: [
    "fps",
    "cpu",
    "gpu",
    "cpuTemp",
    "gpuTemp",
    "ram",
    "sparkline",
    "session",
    "mic",
    "record",
    "replay",
    "screenshot",
  ],
  panelWidgets: [
    "session",
    "performance",
    "captures",
    "recording",
    "notes",
    "timer",
    "achievements",
    "downloads",
    "notifications",
    "settings",
  ],
  tickerLayout: "strip",
  panelDensity: "comfortable",
  lastPanelSection: "session",
  backgroundStyle: "glass",
  backgroundBlur: 14,
  backgroundOpacity: 0.72,
  reduceEffects: false,
  highContrast: false,
  textScale: 1,
  tickerClickThrough: false,
  tickerAutoDimSeconds: 0,
  tickerAutoHideSeconds: 0,
  pollIntervalMs: 1000,
  showTemps: true,
  detectCurrentGame: true,
  showGraphs: true,
  posX: null,
  posY: null,
  tickerWidth: DEFAULT_TICKER_WIDTH,
  tickerHeight: DEFAULT_TICKER_HEIGHT,
  panelWidth: DEFAULT_PANEL_WIDTH,
  panelHeight: DEFAULT_PANEL_HEIGHT,

  screenshotFormat: "png",
  screenshotFolder: null,
  screenshotHotkey: "F12",
  screenshotSound: true,
  screenshotFlash: true,
  screenshotCopyToClipboard: true,
  screenshotIncludeOverlay: false,
  screenshotDelayMs: 60,

  videoEnabled: true,
  videoHotkey: "Shift+F2",
  replayHotkey: "Shift+F3",
  videoFps: 60,
  videoBitrateKbps: 12_000,
  videoResolutionScale: 1,
  videoFormat: "mp4",
  videoFolder: null,
  videoGameAudio: true,
  videoMicrophone: false,
  videoAudioDevice: null,
  videoMicDevice: null,
  replayBufferSeconds: 60,
  videoMaxClipSeconds: 0,
  videoShowCursor: false,
  videoSound: true,
  videoCountdownMs: 0,
  videoHideOverlay: true,
  videoRecording: false,
  replayBufferActive: false,

  nativeBlur: true,
  effectColor: null,
};

export interface OverlayStore {
  settings: OverlaySettings;
  /** Opaque frontend-owned telemetry history blob. */
  history: string | null;
}

const STORE_FILE = "overlay.json";

function legacyPath(): string {
  return path.join(app.getPath("userData"), STORE_FILE);
}

const store = createSqliteStore<OverlayStore>({
  domain: "kv",
  document: "overlay",
  fileName: STORE_FILE,
  createDefault: () => ({
    settings: { ...DEFAULT_OVERLAY_SETTINGS },
    history: null,
  }),
});

let migrationChecked = false;

/** Import the retired JSON document once, then park it. */
function ensureLegacyImported(): void {
  if (migrationChecked) return;
  migrationChecked = true;
  try {
    if (readDocumentJson("kv", "overlay") !== null) return;
    const legacy = legacyPath();
    if (!fs.existsSync(legacy)) return;
    const parsed = JSON.parse(fs.readFileSync(legacy, "utf8")) as Partial<OverlayStore>;
    store.write({
      settings: normalizeOverlaySettings(parsed.settings),
      history: typeof parsed.history === "string" ? parsed.history : null,
    });
    fs.renameSync(legacy, `${legacy}.migrated`);
  } catch (error) {
    console.error("[overlay] legacy settings import failed:", error);
  }
}

export function isOverlayCorner(value: unknown): value is OverlayCorner {
  return (
    value === "top-left" ||
    value === "top-right" ||
    value === "bottom-left" ||
    value === "bottom-right"
  );
}

/** Fill a partial payload with defaults and drop unknown/invalid scalars. */
export function normalizeOverlaySettings(
  value: Partial<OverlaySettings> | null | undefined,
): OverlaySettings {
  const merged = { ...DEFAULT_OVERLAY_SETTINGS, ...(value ?? {}) };
  if (!isOverlayCorner(merged.corner)) merged.corner = DEFAULT_OVERLAY_SETTINGS.corner;
  merged.posX = typeof merged.posX === "number" ? merged.posX : null;
  merged.posY = typeof merged.posY === "number" ? merged.posY : null;
  merged.tickerWidgets = Array.isArray(merged.tickerWidgets)
    ? merged.tickerWidgets.map(String)
    : [...DEFAULT_OVERLAY_SETTINGS.tickerWidgets];
  merged.panelWidgets = Array.isArray(merged.panelWidgets)
    ? merged.panelWidgets.map(String)
    : [...DEFAULT_OVERLAY_SETTINGS.panelWidgets];
  return merged;
}

/** Read the persisted store, falling back cleanly on absence/corruption. */
export function loadOverlayStore(): OverlayStore {
  ensureLegacyImported();
  try {
    const parsed = store.read();
    const settings = normalizeOverlaySettings(parsed.settings);
    // Session-scoped flags must never survive a restart: the recorder is not
    // running, so a persisted `true` would leave the settings mirror lying.
    settings.videoRecording = false;
    settings.replayBufferActive = false;
    return {
      settings,
      history: typeof parsed.history === "string" ? parsed.history : null,
    };
  } catch {
    return { settings: { ...DEFAULT_OVERLAY_SETTINGS }, history: null };
  }
}

/** Persist the store. SQLite writes are synchronous and durable. */
export function persistOverlayStore(next: OverlayStore): void {
  ensureLegacyImported();
  try {
    store.write(next);
  } catch (error) {
    console.error("[overlay] failed to persist settings:", error);
  }
}
