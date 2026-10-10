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
  useState,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useOverlayBounds } from "../hooks/useOverlayBounds";

export type OverlayCorner =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

/** Mirrors the backend `OverlaySettings` serde shape (camelCase). */
export interface OverlaySettings {
  enabled: boolean;
  hotkey: string;
  corner: OverlayCorner;
  opacity: number;
  tickerWidgets: string[];
  panelWidgets: string[];
  pollIntervalMs: number;
  /** Render CPU/GPU temperature tiles in the performance widget. */
  showTemps: boolean;
  /** Render sparkline graphs for FPS/CPU/GPU in the performance widget. */
  showGraphs: boolean;
  /** Saved window X, or null while the overlay stays corner-anchored. */
  posX?: number | null;
  /** Saved window Y, or null while the overlay stays corner-anchored. */
  posY?: number | null;
  tickerWidth: number;
  tickerHeight: number;
  panelWidth: number;
  panelHeight: number;
}

/** One live telemetry sample emitted on `overlay:metrics`. */
export interface OverlayMetrics {
  cpu: number;
  gpu: number;
  ram: number;
  cpuTemp: number;
  gpuTemp: number;
  fps?: number;
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

/** Ticker widget keys, in fixed display order. */
export const TICKER_WIDGETS = ["fps", "cpu", "gpu", "session"] as const;

/** Panel widget keys, in fixed display order. */
export const PANEL_WIDGETS = [
  "session",
  "performance",
  "notes",
  "captures",
  "timer",
  "achievements",
  "downloads",
  "notifications",
  "settings",
] as const;

/** How many live telemetry samples the sparklines retain. */
export const OVERLAY_HISTORY_LIMIT = 60;

export const DEFAULT_OVERLAY_SETTINGS: OverlaySettings = {
  enabled: true,
  hotkey: "Shift+F1",
  corner: "bottom-right",
  opacity: 0.9,
  tickerWidgets: ["fps", "cpu", "gpu", "session"],
  panelWidgets: [
    "session",
    "performance",
    "notes",
    "captures",
    "timer",
    "achievements",
    "downloads",
    "notifications",
    "settings",
  ],
  pollIntervalMs: 1000,
  showTemps: true,
  showGraphs: true,
  posX: null,
  posY: null,
  tickerWidth: 360,
  tickerHeight: 56,
  panelWidth: 500,
  panelHeight: 560,
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
  /** Take a game screenshot via native capture into Windows Captures folder */
  captureScreenshot: (gameTitle?: string) => Promise<ScreenshotCaptureInfo | null>;
  /** Recent screenshot filepaths for this game */
  recentScreenshots: string[];
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
  const [providerReady, setProviderReady] = useState(false);
  const [recentScreenshots, setRecentScreenshots] = useState<string[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [lastCapturedScreenshot, setLastCapturedScreenshot] =
    useState<ScreenshotCaptureInfo | null>(null);
  const [flashScreen, setFlashScreen] = useState(false);

  // Persist the window position/size after the user drags or resizes it.
  useOverlayBounds();

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
        setRecentScreenshots(list);
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
          playShutterSound();
          setFlashScreen(true);
          setTimeout(() => setFlashScreen(false), 260);
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
    [isCapturing],
  );

  // The backend emits `overlay:session` once, when the game launches — but the
  // overlay webview usually mounts after that, so the event is already gone.
  // Fetch the live session directly on mount so the panel isn't stuck empty.
  useEffect(() => {
    let disposed = false;
    invoke<OverlaySession | null>("overlay_get_session")
      .then((value) => {
        if (!disposed) setSession(value ?? null);
      })
      .catch(() => {
        /* no Tauri runtime */
      });
    return () => {
      disposed = true;
    };
  }, []);

  // Refresh recent screenshots on session change
  useEffect(() => {
    void refreshScreenshots();
  }, [session, refreshScreenshots]);

  // Global F12 capture handler inside overlay
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "F12") {
        e.preventDefault();
        void captureScreenshot();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [captureScreenshot]);

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
      },
    );
    const sessionUnlisten = listen<OverlaySession | null>(
      "overlay:session",
      (event) => {
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
    const screenshotUnlisten = listen<ScreenshotCaptureInfo>(
      "overlay:screenshot-captured",
      (event) => {
        if (event.payload) {
          setLastCapturedScreenshot(event.payload);
          setRecentScreenshots((prev) => [
            event.payload.filePath,
            ...prev.filter((p) => p !== event.payload.filePath),
          ]);
        }
      },
    );
    return () => {
      void toggleUnlisten.then((unlisten) => unlisten());
      void sessionUnlisten.then((unlisten) => unlisten());
      void metricsUnlisten.then((unlisten) => unlisten());
      void screenshotUnlisten.then((unlisten) => unlisten());
    };
  }, []);

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
      session,
      providerReady,
      captureScreenshot,
      recentScreenshots,
      isCapturing,
      lastCapturedScreenshot,
      openScreenshotsFolder,
      refreshScreenshots,
      flashScreen,
      updateSettings,
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
      session,
      providerReady,
      captureScreenshot,
      recentScreenshots,
      isCapturing,
      lastCapturedScreenshot,
      openScreenshotsFolder,
      refreshScreenshots,
      flashScreen,
      updateSettings,
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
