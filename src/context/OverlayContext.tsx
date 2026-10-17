// OverlayContext — owns the in-game overlay's local UI state.
//
// The overlay is a dedicated transparent webview (loaded at
// `index.html?window=overlay`). This provider is the single place that
// talks to the backend overlay commands/events, so every overlay widget
// stays a pure view of context data.
//
// When the Tauri bridge is unavailable (plain `npm run dev`) the invokes
// and listeners simply reject; those failures are swallowed so the entry
// still renders against the defaults.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useOverlayBounds } from "../hooks/useOverlayBounds";
import { useOverlayWindowControls } from "../hooks/useOverlayWindowControls";

export type OverlayCorner =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

/** Presentation presets for the reduced (collapsed) ticker HUD. */
export type OverlayTickerLayout =
  | "strip"
  | "single"
  | "gauges"
  | "minimal";

/** Background treatment shared by the ticker and the expanded panel. */
export type OverlayBackground = "glass" | "solid" | "dim";

/** Mirrors the backend `OverlaySettings` serde shape (camelCase). */
export interface OverlaySettings {
  enabled: boolean;
  hotkey: string;
  corner: OverlayCorner;
  opacity: number;
  tickerWidgets: string[];
  panelWidgets: string[];
  /** Reduced-HUD presentation preset (see `OverlayTickerLayout`). */
  tickerLayout?: OverlayTickerLayout;
  /** Background treatment: blurry glass, opaque solid, or dim translucent. */
  backgroundStyle?: OverlayBackground;
  /** Backdrop blur radius in px (glass only, CSS fallback). */
  backgroundBlur?: number;
  /** Background tint opacity (0.2–1). */
  backgroundOpacity?: number;
  /** Use the native OS backdrop (real behind-the-game blur) when glass. */
  nativeBlur?: boolean;
  /** Drop the costly backdrop-filter and animated glows for performance. */
  reduceEffects?: boolean;
  /** Collapsed ticker ignores the mouse so clicks reach the game. */
  tickerClickThrough?: boolean;
  /** Force opaque surfaces and stronger borders for readability. */
  highContrast?: boolean;
  /** Overlay text/control scale (0.9–1.4). */
  textScale?: number;
  pollIntervalMs: number;
  /** Render CPU/GPU temperature tiles in the performance widget. */
  showTemps: boolean;
  /** Render sparkline graphs for FPS/CPU/GPU in the performance widget. */
  showGraphs: boolean;
  /** Adopt a library game running outside GameIndex as the HUD's session. */
  detectCurrentGame?: boolean;
  /** Saved window X, or null while the overlay stays corner-anchored. */
  posX?: number | null;
  /** Saved window Y, or null while the overlay stays corner-anchored. */
  posY?: number | null;
  tickerWidth: number;
  tickerHeight: number;
  panelWidth: number;
  panelHeight: number;

  // ── Screenshot capture ─────────────────────────────────────────
  /** `png` (lossless) or `jpg` (smaller). */
  screenshotFormat: string;
  /** Custom output folder, or null for `Videos\Captures\<Game>`. */
  screenshotFolder?: string | null;
  screenshotHotkey: string;
  screenshotSound: boolean;
  screenshotFlash: boolean;
  screenshotCopyToClipboard: boolean;
  /** Keep the HUD in the frame instead of hiding it first. */
  screenshotIncludeOverlay: boolean;
  screenshotDelayMs: number;

  // ── Video capture ──────────────────────────────────────────────
  videoEnabled: boolean;
  videoHotkey: string;
  replayHotkey: string;
  videoFps: number;
  videoBitrateKbps: number;
  videoResolutionScale: number;
  videoFormat: string;
  /** Custom output folder, or null for `Videos\Captures\<Game>`. */
  videoFolder?: string | null;
  videoGameAudio: boolean;
  videoMicrophone: boolean;
  /** Output (render) device id for game-audio loopback; null = system default. */
  videoAudioDevice?: string | null;
  videoMicDevice?: string | null;
  replayBufferSeconds: number;
  /** Hard stop for a recording in seconds; 0 = unlimited. */
  videoMaxClipSeconds: number;
  videoShowCursor: boolean;
  videoSound: boolean;
  videoCountdownMs: number;
  videoHideOverlay: boolean;
  /** Session-scoped mirror of the backend flags. */
  videoRecording?: boolean;
  replayBufferActive?: boolean;
}

/** One live telemetry sample emitted on `overlay:metrics`. */
export interface OverlayMetrics {
  cpu: number;
  gpu: number;
  ram: number;
  cpuTemp: number;
  gpuTemp: number;
  fps?: number;
  /** Instantaneous frame time in milliseconds (ms). Derived from FPS when absent. */
  frametime?: number;
  /** GPU dedicated memory in use / total, in megabytes. */
  vramUsedMb?: number;
  vramTotalMb?: number;
  /** Power draw in watts. */
  gpuPower?: number;
  cpuPower?: number;
  /** GPU clocks in MHz. */
  gpuCoreClock?: number;
  gpuMemClock?: number;
}

/** Current running session, mirrored from `overlay:session`. */
export interface OverlaySession {
  gameId: string;
  startedAt: number;
  /** Game process id, or 0 while the launch is still pending. */
  pid?: number;
}

export interface ScreenshotCaptureInfo {
  filePath: string;
  fileName: string;
  gameTitle: string;
  timestamp: number;
  width: number;
  height: number;
}

/** A finished video clip written by the native recorder. */
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

/** Mirrors the backend `RecordingState` (camelCase). */
export interface RecordingState {
  recording: boolean;
  replayBuffering: boolean;
  startedAt?: number | null;
  durationMs: number;
  error?: string | null;
}

export const EMPTY_RECORDING_STATE: RecordingState = {
  recording: false,
  replayBuffering: false,
  startedAt: null,
  durationMs: 0,
  error: null,
};

/** One WASAPI endpoint for the recorder's device dropdowns. */
export interface AudioDeviceInfo {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface AudioDeviceList {
  output: AudioDeviceInfo[];
  input: AudioDeviceInfo[];
}

export const EMPTY_AUDIO_DEVICES: AudioDeviceList = { output: [], input: [] };

/** Ticker widget keys, in fixed display order. */
export const TICKER_WIDGETS = [
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
] as const;

/** Ticker elements enabled out of the box. */
export const DEFAULT_TICKER_WIDGETS: string[] = [...TICKER_WIDGETS];

/** Panel widget keys, in fixed display order. */
export const PANEL_WIDGETS = [
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
] as const;

/** How many live telemetry samples the sparklines retain. */
export const OVERLAY_HISTORY_LIMIT = 60;

/** How many recent screenshot / clip paths the HUD keeps in memory. */
export const RECENT_CAPTURE_LIMIT = 60;

/** Prepend `value` to `list` (moving it to the front when already present),
 *  capped at `limit` so a long play session can't grow the array forever. */
function prependCapped(list: string[], value: string, limit: number): string[] {
  const next = [value, ...list.filter((p) => p !== value)];
  return next.length > limit ? next.slice(0, limit) : next;
}

/**
 * The GPU selected in Settings → Hardware, read from the shared localStorage.
 * The overlay is a separate webview on the same origin, so it sees the main
 * window's selection. Passed to the live sampler so a detected game samples
 * the same adapter as an app-launched session (the backend falls back to the
 * watcher's launch GPU when this is null).
 */
function readSelectedGpu(): { id: string; name: string } | null {
  try {
    const raw = localStorage.getItem("gamelib-gpus");
    const id = localStorage.getItem("gamelib-selected-gpu");
    if (!raw || !id) return null;
    const gpus = JSON.parse(raw) as Array<{ id?: string; name?: string }>;
    const gpu = gpus.find((g) => g.id === id);
    if (!gpu?.id || !gpu.name) return null;
    return { id: gpu.id, name: gpu.name };
  } catch {
    return null;
  }
}

export const DEFAULT_OVERLAY_SETTINGS: OverlaySettings = {
  enabled: false,
  hotkey: "Shift+F1",
  corner: "bottom-right",
  opacity: 0.9,
  tickerWidgets: DEFAULT_TICKER_WIDGETS,
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
  backgroundStyle: "glass",
  backgroundBlur: 14,
  backgroundOpacity: 0.72,
  nativeBlur: true,
  reduceEffects: false,
  tickerClickThrough: false,
  highContrast: false,
  textScale: 1,
  pollIntervalMs: 1000,
  showTemps: true,
  showGraphs: true,
  detectCurrentGame: true,
  posX: null,
  posY: null,
  tickerWidth: 480,
  tickerHeight: 72,
  panelWidth: 540,
  panelHeight: 620,
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
  videoBitrateKbps: 12000,
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
};

export function normalizeOverlaySettings(
  value: Partial<OverlaySettings> | null | undefined,
): OverlaySettings {
  return { ...DEFAULT_OVERLAY_SETTINGS, ...(value ?? {}) };
}

export interface OverlayContextValue {
  /** True while the compact ticker is showing; false for the full panel. */
  collapsed: boolean;
  toggle: () => void;
  expand: () => void;
  collapse: () => void;
  corner: OverlayCorner;
  settings: OverlaySettings;
  /** Latest telemetry sample, or null before the first tick. */
  metrics: OverlayMetrics | null;
  /** Rolling window of recent telemetry samples (oldest first, capped). */
  history: OverlayMetrics[];
  /** Current session, or null when no game is running. */
  session: OverlaySession | null;
  /** True once the initial settings load has settled. */
  providerReady: boolean;
  /** True when the platform supports a native window backdrop (real blur). */
  nativeBlurSupported: boolean;
  /** Take a game screenshot via native capture into Windows Captures folder */
  captureScreenshot: (gameTitle?: string) => Promise<ScreenshotCaptureInfo | null>;
  /** Recent screenshot filepaths for this game */
  recentScreenshots: string[];
  /** Delete a captured screenshot */
  deleteScreenshot: (path: string) => Promise<boolean>;
  /** Whether a capture is currently in flight */
  isCapturing: boolean;
  /** Last successfully captured screenshot info */
  lastCapturedScreenshot: ScreenshotCaptureInfo | null;
  /** Open folder or reveal file in File Explorer */
  openScreenshotsFolder: (path?: string) => Promise<void>;
  /** Refresh recent screenshots list */
  refreshScreenshots: (gameTitle?: string) => Promise<void>;
  /** Flash effect trigger for camera snaps */
  flashScreen: boolean;
  /** Discrete update of overlay settings persisted directly to backend */
  updateSettings: (patch: Partial<OverlaySettings>) => Promise<void>;

  // ── Video capture ──────────────────────────────────────────────
  /** False on non-Windows platforms (or unsupported hardware). */
  captureSupported: boolean;
  /** Live recorder state (recording + replay buffer). */
  recordingState: RecordingState;
  isRecording: boolean;
  isReplayBuffering: boolean;
  /** Recent clips for the active game. */
  recentClips: string[];
  /** The most recently finalized clip. */
  lastClip: ClipInfo | null;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<ClipInfo | null>;
  toggleRecording: () => Promise<void>;
  startReplay: () => Promise<void>;
  stopReplay: () => Promise<void>;
  /** Promote the buffered replay window to a clip. */
  saveReplay: () => Promise<ClipInfo | null>;
  refreshClips: (gameTitle?: string) => Promise<void>;
  deleteClip: (path: string) => Promise<boolean>;
  openClipsFolder: (path?: string) => Promise<void>;
  /** Available audio endpoints for the capture device dropdowns. */
  audioDevices: AudioDeviceList;
  refreshAudioDevices: () => Promise<void>;
}

// Persist the React context instance across Vite HMR module re-evaluations so
// lazy-loaded chunks never lose their Provider instance.
const globalOverlayObj = globalThis as unknown as {
  __gamelib_overlay_context__?: React.Context<OverlayContextValue | null>;
};
const OverlayContext =
  globalOverlayObj.__gamelib_overlay_context__ ??
  (globalOverlayObj.__gamelib_overlay_context__ =
    createContext<OverlayContextValue | null>(null));

function playShutterSound() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(800, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(150, ctx.currentTime + 0.09);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.09);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.09);
  } catch {
    // Audio unsupported or not permitted
  }
}

/** Resolve the current theme surface colour to an RGB triple for the native
 * window backdrop tint. Reads the computed value so it follows every theme. */
function resolveSurfaceRgb(): [number, number, number] {
  if (typeof document === "undefined") return [14, 16, 23];
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;opacity:0;pointer-events:none;background:var(--color-surface)";
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).backgroundColor;
  probe.remove();
  const match = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(computed);
  return match
    ? [Number(match[1]), Number(match[2]), Number(match[3])]
    : [14, 16, 23];
}

/** Short rising (start) or falling (stop) tone for the recorder. */
function playRecordTone(start: boolean) {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    const from = start ? 520 : 780;
    const to = start ? 780 : 520;
    osc.frequency.setValueAtTime(from, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(to, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
  } catch {
    // Audio unsupported or not permitted
  }
}

export function OverlayProvider({ children }: { children: ReactNode }) {
  // The ticker is the always-on minimal readout, so the overlay boots
  // collapsed and the global hotkey expands it.
  const [collapsed, setCollapsed] = useState(true);
  const [settings, setSettings] = useState<OverlaySettings>(
    DEFAULT_OVERLAY_SETTINGS,
  );
  const [metrics, setMetrics] = useState<OverlayMetrics | null>(null);
  const [history, setHistory] = useState<OverlayMetrics[]>([]);
  const [session, setSession] = useState<OverlaySession | null>(null);
  // A library game detected as running outside GameIndex (see
  // `overlay_detect_game`). Used only when the watcher has no tracked
  // session, so a game started from Steam/a desktop shortcut still lights up
  // the HUD. Never records playtime — it is a view-only session.
  const [detectedSession, setDetectedSession] = useState<OverlaySession | null>(null);
  const [providerReady, setProviderReady] = useState(false);
  const [recentScreenshots, setRecentScreenshots] = useState<string[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [lastCapturedScreenshot, setLastCapturedScreenshot] =
    useState<ScreenshotCaptureInfo | null>(null);
  const [flashScreen, setFlashScreen] = useState(false);
  const [captureSupported, setCaptureSupported] = useState(false);
  const [nativeBlurSupported, setNativeBlurSupported] = useState(false);
  const [recordingState, setRecordingState] =
    useState<RecordingState>(EMPTY_RECORDING_STATE);
  const [recentClips, setRecentClips] = useState<string[]>([]);
  const [lastClip, setLastClip] = useState<ClipInfo | null>(null);
  const [audioDevices, setAudioDevices] =
    useState<AudioDeviceList>(EMPTY_AUDIO_DEVICES);
  const prevRecordingRef = useRef(false);
  // Throttle clock for the persisted telemetry window (I6).
  const historySaveRef = useRef(0);

  // Merged session the widgets read: a watcher-tracked session always wins;
  // otherwise a detected (untracked) game stands in.
  const effectiveSession = session ?? detectedSession;

  // Live mirror of the watcher-tracked session, so the detection callback can
  // bail without capturing a stale closure.
  const sessionRef = useRef<OverlaySession | null>(null);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // Best-effort: ask the backend whether a library game is running outside
  // GameIndex, and adopt it as the view-only session. Event-driven — runs on
  // mount and on every HUD show (`overlay:toggle`), so a hidden overlay never
  // keeps sampling.
  const runDetection = useCallback(async () => {
    if (!settings.detectCurrentGame) {
      setDetectedSession(null);
      return;
    }
    if (sessionRef.current) return; // the watcher already owns a session
    try {
      const found = await invoke<OverlaySession | null>("overlay_detect_game");
      if (found && found.gameId) {
        setDetectedSession((prev) =>
          prev && prev.gameId === found.gameId && prev.pid === found.pid
            ? prev
            : { gameId: found.gameId, startedAt: Date.now(), pid: found.pid },
        );
        if (found.pid) {
          const gpu = readSelectedGpu();
          void invoke("overlay_start_live_metrics", {
            pid: found.pid,
            gpuId: gpu?.id ?? null,
            gpuName: gpu?.name ?? null,
          }).catch(() => {
            /* no Tauri runtime */
          });
        }
      } else {
        setDetectedSession(null);
      }
    } catch {
      /* no Tauri runtime or unsupported platform */
    }
  }, [settings.detectCurrentGame]);
  const runDetectionRef = useRef(runDetection);
  runDetectionRef.current = runDetection;

  // Persist the window position/size after the user drags or resizes it.
  useOverlayBounds();
  // Wayland: drive drag/resize through the backend (native move/resize is a
  // no-op on a layer-shell surface).
  useOverlayWindowControls();

  const toggle = useCallback(() => setCollapsed((c) => !c), []);
  const expand = useCallback(() => setCollapsed(false), []);
  const collapse = useCallback(() => setCollapsed(true), []);

  // Sync opacity directly into CSS variable for immediate feedback
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.style.setProperty(
        "--overlay-opacity",
        String(settings.opacity),
      );
    }
  }, [settings.opacity]);

  // Background treatment is driven by two CSS variables plus mode attributes
  // on the root, so toggling glass/blur/solid never rewrites the stylesheets.
  // On Windows the "glass" mode additionally asks DWM for a native acrylic
  // backdrop — CSS backdrop-filter can't sample the desktop behind a
  // transparent webview, so that is the only way to get a real behind-the-game
  // blur. The tint colour is read from the live theme.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const style = settings.backgroundStyle ?? "glass";
    const glass = style === "glass";
    const opacity = Math.min(1, Math.max(0, settings.backgroundOpacity ?? 0.72));
    const native =
      glass &&
      !settings.reduceEffects &&
      !settings.highContrast &&
      (settings.nativeBlur ?? true) &&
      nativeBlurSupported;

    root.dataset.overlayBg = style;
    root.dataset.overlayEffects = settings.reduceEffects ? "reduced" : "full";
    root.dataset.overlayNative = native ? "true" : "false";
    root.style.setProperty(
      "--overlay-bg-blur",
      `${Math.max(0, settings.backgroundBlur ?? 14)}px`,
    );
    root.style.setProperty("--overlay-bg-opacity", String(opacity));

    if (native) {
      const [r, g, b] = resolveSurfaceRgb();
      void invoke("overlay_set_window_effect", {
        enabled: true,
        color: [r, g, b, Math.round(opacity * 255)],
      }).catch(() => {
        /* no Tauri runtime */
      });
    } else {
      void invoke("overlay_set_window_effect", {
        enabled: false,
        color: [],
      }).catch(() => {
        /* no Tauri runtime */
      });
    }
  }, [
    settings.backgroundStyle,
    settings.backgroundBlur,
    settings.backgroundOpacity,
    settings.nativeBlur,
    settings.reduceEffects,
    settings.highContrast,
    nativeBlurSupported,
  ]);

  // Accessibility: high contrast forces opaque surfaces (a root data attribute
  // consumed by overlay.css) and text scale drives the root font size, which
  // every rem-based dimension in the HUD follows.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.dataset.overlayContrast = settings.highContrast ? "high" : "normal";
    const scale = Math.min(1.4, Math.max(0.9, settings.textScale ?? 1));
    root.style.fontSize = `${Math.round(scale * 100)}%`;
  }, [settings.highContrast, settings.textScale]);

  // Probe whether the platform offers a native window backdrop.
  useEffect(() => {
    let disposed = false;
    invoke<boolean>("overlay_native_blur_supported")
      .then((value) => {
        if (!disposed) setNativeBlurSupported(Boolean(value));
      })
      .catch(() => {
        /* no Tauri runtime */
      });
    return () => {
      disposed = true;
    };
  }, []);

  // Load persisted settings once; fall back to defaults when the backend is
  // unreachable (frontend-only dev, or a transient first-boot race).
  useEffect(() => {
    let disposed = false;
    invoke<OverlaySettings>("overlay_get_settings")
      .then((value) => {
        if (!disposed && value) setSettings(normalizeOverlaySettings(value));
      })
      .catch(() => {
        /* keep defaults */
      })
      .finally(() => {
        if (!disposed) setProviderReady(true);
      });
    return () => {
      disposed = true;
    };
  }, []);

  // Update settings in memory and persist
  const updateSettings = useCallback(
    async (patch: Partial<OverlaySettings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...patch };
        void invoke("overlay_save_settings", { settings: next }).catch(() => {
          /* no-op */
        });
        return next;
      });
    },
    [],
  );

  const refreshScreenshots = useCallback(async (gameTitle?: string) => {
    try {
      const list = await invoke<string[]>("overlay_get_recent_screenshots", {
        gameTitle,
      });
      if (Array.isArray(list)) {
        setRecentScreenshots(list.slice(0, RECENT_CAPTURE_LIMIT));
      }
    } catch {
      /* no-op */
    }
  }, []);

  const openScreenshotsFolder = useCallback(async (path?: string) => {
    try {
      await invoke("overlay_open_screenshot_folder", {
        fileOrDirPath: path ?? null,
      });
    } catch {
      /* no-op */
    }
  }, []);

  const deleteScreenshot = useCallback(
    async (path: string): Promise<boolean> => {
      try {
        await invoke("overlay_delete_screenshot", { path });
        setRecentScreenshots((prev) => prev.filter((p) => p !== path));
        return true;
      } catch (err) {
        console.error("Failed to delete screenshot:", err);
        return false;
      }
    },
    [],
  );

  const captureScreenshot = useCallback(
    async (gameTitle?: string): Promise<ScreenshotCaptureInfo | null> => {
      if (isCapturing) return null;
      setIsCapturing(true);
      try {
        const result = await invoke<ScreenshotCaptureInfo>(
          "overlay_capture_screenshot",
          { gameTitle: gameTitle ?? null },
        );
        if (result) {
          if (settings.screenshotSound) playShutterSound();
          if (settings.screenshotFlash) {
            setFlashScreen(true);
            setTimeout(() => setFlashScreen(false), 260);
          }
          if (settings.screenshotCopyToClipboard) {
            navigator.clipboard?.writeText(result.filePath).catch(() => {});
          }
          setLastCapturedScreenshot(result);
          setRecentScreenshots((prev) => [
            result.filePath,
            ...prev.filter((p) => p !== result.filePath),
          ]);
          return result;
        }
        return null;
      } catch (err) {
        console.error("Screenshot capture failed:", err);
        return null;
      } finally {
        setIsCapturing(false);
      }
    },
    [
      isCapturing,
      settings.screenshotSound,
      settings.screenshotFlash,
      settings.screenshotCopyToClipboard,
    ],
  );

  const refreshClips = useCallback(async (gameTitle?: string) => {
    try {
      const list = await invoke<string[]>("capture_get_recent_clips", {
        gameTitle: gameTitle ?? null,
      });
      if (Array.isArray(list)) setRecentClips(list);
    } catch {
      /* no-op */
    }
  }, []);

  const openClipsFolder = useCallback(async (path?: string) => {
    try {
      await invoke("capture_open_clip_folder", { path: path ?? null });
    } catch {
      /* no-op */
    }
  }, []);

  const refreshAudioDevices = useCallback(async () => {
    try {
      const list = await invoke<AudioDeviceList>("capture_list_audio_devices");
      if (list) {
        setAudioDevices({
          output: list.output ?? [],
          input: list.input ?? [],
        });
      }
    } catch {
      /* no-op */
    }
  }, []);

  const deleteClip = useCallback(async (path: string): Promise<boolean> => {
    try {
      await invoke("capture_delete_clip", { path });
      setRecentClips((prev) => prev.filter((p) => p !== path));
      return true;
    } catch (err) {
      console.error("Failed to delete clip:", err);
      return false;
    }
  }, []);

  const applyRecordingState = useCallback((next: RecordingState | null) => {
    if (next) setRecordingState(next);
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const next = await invoke<RecordingState>("capture_start_recording");
      applyRecordingState(next);
    } catch (err) {
      console.error("Failed to start recording:", err);
    }
  }, [applyRecordingState]);

  const stopRecording = useCallback(async (): Promise<ClipInfo | null> => {
    try {
      const clip = await invoke<ClipInfo | null>("capture_stop_recording");
      if (clip) {
        setLastClip(clip);
        void refreshClips();
      }
      applyRecordingState(EMPTY_RECORDING_STATE);
      return clip ?? null;
    } catch (err) {
      console.error("Failed to stop recording:", err);
      return null;
    }
  }, [applyRecordingState, refreshClips]);

  const toggleRecording = useCallback(async () => {
    try {
      const next = await invoke<RecordingState>("capture_toggle_recording");
      applyRecordingState(next);
    } catch (err) {
      console.error("Failed to toggle recording:", err);
    }
  }, [applyRecordingState]);

  const startReplay = useCallback(async () => {
    try {
      const next = await invoke<RecordingState>("capture_start_replay");
      applyRecordingState(next);
    } catch (err) {
      console.error("Failed to start replay buffer:", err);
    }
  }, [applyRecordingState]);

  const stopReplay = useCallback(async () => {
    try {
      const next = await invoke<RecordingState>("capture_stop_replay");
      applyRecordingState(next);
    } catch (err) {
      console.error("Failed to stop replay buffer:", err);
    }
  }, [applyRecordingState]);

  const saveReplay = useCallback(async (): Promise<ClipInfo | null> => {
    try {
      const clip = await invoke<ClipInfo | null>("capture_save_replay");
      if (clip) {
        setLastClip(clip);
        void refreshClips();
      }
      return clip ?? null;
    } catch (err) {
      console.error("Failed to save replay:", err);
      return null;
    }
  }, [refreshClips]);

  // The backend emits `overlay:session` once, when the game launches — but the
  // overlay webview usually mounts after that, so the event is already gone.
  // Fetch the live session directly on mount so the panel isn't stuck empty.
  useEffect(() => {
    let disposed = false;
    invoke<OverlaySession | null>("overlay_get_session")
      .then((value) => {
        if (disposed) return;
        if (value) setDetectedSession(null);
        setSession(value ?? null);
      })
      .catch(() => {
        /* no Tauri runtime */
      });
    return () => {
      disposed = true;
    };
  }, []);

  // Once settings have loaded, adopt an already-running library game (the
  // cold-start case: game launched, then GameIndex/overlay opened).
  useEffect(() => {
    if (!providerReady) return;
    void runDetectionRef.current();
  }, [providerReady]);

  // Turning the feature off drops any detected session immediately.
  useEffect(() => {
    if (!settings.detectCurrentGame) setDetectedSession(null);
  }, [settings.detectCurrentGame]);

  // Refresh recent screenshots on session change
  useEffect(() => {
    void refreshScreenshots();
  }, [effectiveSession, refreshScreenshots]);

  // Probe capture support and seed the recorder state once.
  useEffect(() => {
    invoke<boolean>("capture_is_supported")
      .then((value) => setCaptureSupported(Boolean(value)))
      .catch(() => {
        /* no Tauri runtime */
      });
    invoke<RecordingState>("capture_get_state")
      .then((value) => {
        if (value) setRecordingState(value);
      })
      .catch(() => {
        /* no Tauri runtime */
      });
    void refreshAudioDevices();
  }, [refreshAudioDevices]);

  // Refresh the clip list whenever the active game changes.
  useEffect(() => {
    void refreshClips();
  }, [effectiveSession, refreshClips]);

  // Optional start/stop chime when a manual recording toggles.
  useEffect(() => {
    const now = recordingState.recording;
    if (now !== prevRecordingRef.current) {
      prevRecordingRef.current = now;
      if (settings.videoSound) playRecordTone(now);
    }
  }, [recordingState.recording, settings.videoSound]);

  // Screenshots are captured by the global screenshot hotkey (registered in the
  // Rust backend, so it also fires while the game is focused). The overlay must
  // not add its own hardcoded key handler: it would fire even when the user
  // rebound or disabled the shortcut, and double up with the global binding.

  // Resize the HUD window to match the presentation: the compact ticker vs the
  // expanded panel. The backend re-anchors it to the configured corner so the
  // interactive area always matches the visible content.
  useEffect(() => {
    void invoke("overlay_set_collapsed", { collapsed }).catch(() => {
      /* no Tauri runtime */
    });
  }, [collapsed]);

  // Backend events: hotkey show/hide, session lifecycle, live metrics, screenshots.
  useEffect(() => {
    const toggleUnlisten = listen<{ collapsed?: boolean }>(
      "overlay:toggle",
      (event) => {
        // The backend tells us which presentation the HUD was shown in.
        const next = event.payload?.collapsed;
        setCollapsed((c) => (typeof next === "boolean" ? next : !c));
        // Every show is a chance the running game wasn't tracked by the
        // watcher; re-check for one outside GameIndex.
        void runDetectionRef.current();
      },
    );
    const sessionUnlisten = listen<OverlaySession | null>(
      "overlay:session",
      (event) => {
        // A tracked session supersedes any detected one; a null (game ended)
        // drops both — detection re-adopts it if it is somehow still running.
        setDetectedSession(null);
        setSession(event.payload ?? null);
      },
    );
    const metricsUnlisten = listen<OverlayMetrics>("overlay:metrics", (event) => {
      setMetrics(event.payload);
      setHistory((prev) => {
        const next = [...prev, event.payload];
        return next.length > OVERLAY_HISTORY_LIMIT
          ? next.slice(next.length - OVERLAY_HISTORY_LIMIT)
          : next;
      });
    });
    // The main window (or the in-overlay controls) persist settings through
    // the backend, which broadcasts them here so an open HUD updates live.
    // Skip the echo when nothing actually changed, so a burst of edits (e.g.
    // dragging a slider) doesn't re-render on every round-trip.
    const settingsUnlisten = listen<OverlaySettings>(
      "overlay:settings",
      (event) => {
        if (!event.payload) return;
        setSettings((prev) => {
          const next = normalizeOverlaySettings(event.payload);
          return JSON.stringify(next) === JSON.stringify(prev) ? prev : next;
        });
      },
    );
    const screenshotUnlisten = listen<ScreenshotCaptureInfo>(
      "overlay:screenshot-captured",
      (event) => {
        if (event.payload) {
          setLastCapturedScreenshot(event.payload);
          setRecentScreenshots((prev) =>
            prependCapped(prev, event.payload.filePath, RECENT_CAPTURE_LIMIT)
          );
        }
      },
    );
    const captureStateUnlisten = listen<RecordingState>(
      "capture:state",
      (event) => {
        if (event.payload) setRecordingState(event.payload);
      },
    );
    const clipUnlisten = listen<ClipInfo>("capture:clip-saved", (event) => {
      if (event.payload?.filePath) {
        setLastClip(event.payload);
        setRecentClips((prev) =>
          prependCapped(prev, event.payload.filePath, RECENT_CAPTURE_LIMIT)
        );
      }
    });
    return () => {
      void toggleUnlisten.then((unlisten) => unlisten());
      void sessionUnlisten.then((unlisten) => unlisten());
      void metricsUnlisten.then((unlisten) => unlisten());
      void settingsUnlisten.then((unlisten) => unlisten());
      void screenshotUnlisten.then((unlisten) => unlisten());
      void captureStateUnlisten.then((unlisten) => unlisten());
      void clipUnlisten.then((unlisten) => unlisten());
    };
  }, []);

  // Persist the rolling telemetry window so the performance deep-dive survives
  // an overlay reopen for the same game. On a game change the window starts
  // empty and is seeded from the stored snapshot when it matches.
  useEffect(() => {
    const gameId = effectiveSession?.gameId ?? null;
    setHistory([]);
    historySaveRef.current = 0;
    let disposed = false;
    invoke<string | null>("overlay_load_history")
      .then((raw) => {
        if (disposed || !raw) return;
        try {
          const parsed = JSON.parse(raw) as {
            gameId?: string | null;
            samples?: OverlayMetrics[];
          };
          if ((parsed.gameId ?? null) !== gameId) return;
          if (Array.isArray(parsed.samples)) {
            setHistory(parsed.samples.slice(-OVERLAY_HISTORY_LIMIT));
          }
        } catch {
          /* ignore malformed snapshots */
        }
      })
      .catch(() => {
        /* no Tauri runtime / command unavailable */
      });
    return () => {
      disposed = true;
    };
  }, [effectiveSession?.gameId]);

  useEffect(() => {
    // Throttle to ~8 s so a 1 Hz telemetry feed does not hammer the database.
    const now = Date.now();
    if (now - historySaveRef.current < 8000) return;
    historySaveRef.current = now;
    const payload = JSON.stringify({
      gameId: effectiveSession?.gameId ?? null,
      samples: history,
    });
    void invoke("overlay_save_history", { json: payload }).catch(() => {
      /* no Tauri runtime / command unavailable */
    });
  }, [history, effectiveSession?.gameId]);

  const corner = settings.corner;

  const value = useMemo<OverlayContextValue>(
    () => ({
      collapsed,
      toggle,
      expand,
      collapse,
      corner,
      settings,
      metrics,
      history,
      session: effectiveSession,
      providerReady,
      nativeBlurSupported,
      captureScreenshot,
      recentScreenshots,
      deleteScreenshot,
      isCapturing,
      lastCapturedScreenshot,
      openScreenshotsFolder,
      refreshScreenshots,
      flashScreen,
      updateSettings,
      captureSupported,
      recordingState,
      isRecording: recordingState.recording,
      isReplayBuffering: recordingState.replayBuffering,
      recentClips,
      lastClip,
      startRecording,
      stopRecording,
      toggleRecording,
      startReplay,
      stopReplay,
      saveReplay,
      refreshClips,
      deleteClip,
      openClipsFolder,
      audioDevices,
      refreshAudioDevices,
    }),
    [
      collapsed,
      toggle,
      expand,
      collapse,
      corner,
      settings,
      metrics,
      history,
      effectiveSession,
      providerReady,
      nativeBlurSupported,
      captureScreenshot,
      recentScreenshots,
      deleteScreenshot,
      isCapturing,
      lastCapturedScreenshot,
      openScreenshotsFolder,
      refreshScreenshots,
      flashScreen,
      updateSettings,
      captureSupported,
      recordingState,
      recentClips,
      lastClip,
      startRecording,
      stopRecording,
      toggleRecording,
      startReplay,
      stopReplay,
      saveReplay,
      refreshClips,
      deleteClip,
      openClipsFolder,
      audioDevices,
      refreshAudioDevices,
    ],
  );

  return (
    <OverlayContext.Provider value={value}>{children}</OverlayContext.Provider>
  );
}

export function useOverlay(): OverlayContextValue {
  const ctx = useContext(OverlayContext);
  if (!ctx) {
    throw new Error("useOverlay must be used within an OverlayProvider");
  }
  return ctx;
}
