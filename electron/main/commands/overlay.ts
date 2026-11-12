/**
 * Overlay-specific commands (`overlay_*`).
 *
 * Every handler is a thin adapter over `surfaces/overlay.ts`, which owns the
 * window, its persisted settings, the global hotkeys and the live telemetry.
 * Argument names follow the renderer call sites exactly (see
 * `src/hooks/useOverlay*.ts`, `src/context/OverlayContext.tsx`,
 * `src/pages/settings/OverlayTab.tsx`).
 *
 * Deliberately absent (the generic stub rejects them with a clear message):
 *   • `overlay_detect_game` — needs the library store + process enumeration,
 *     neither of which the Electron build has yet.
 */
import type { CommandHandler } from "../ipc";
import type { OverlaySettings } from "../surfaces/overlaySettings";
import {
  captureScreenshot,
  fitOverlayTicker,
  getOverlaySession,
  getOverlaySettings,
  hideOverlay,
  loadOverlayHistory,
  moveOverlayBy,
  nativeBlurSupported,
  openOverlaySettings,
  openScreenshotFolder,
  overlayDesktopServer,
  presentOverlay,
  recentScreenshots,
  resizeOverlayTo,
  saveOverlayBounds,
  saveOverlayHistory,
  saveOverlaySettings,
  setOverlayCollapsed,
  setOverlayCorner,
  setOverlayHotkey,
  setOverlayInteractive,
  setOverlayWindowEffect,
  startOverlayLiveMetrics,
  stopOverlayLiveMetrics,
  deleteScreenshot,
} from "../surfaces/overlay";

function asNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asString(value: unknown): string {
  return value == null ? "" : String(value);
}

export const overlayCommands: Record<string, CommandHandler> = {
  // ── Window lifecycle ────────────────────────────────────────────
  overlay_show: (args) => {
    // The renderer always passes `collapsed`; a missing flag keeps the ticker.
    const collapsed = args.collapsed === undefined ? true : Boolean(args.collapsed);
    presentOverlay(collapsed);
    return null;
  },
  overlay_hide: () => {
    hideOverlay();
    return null;
  },
  overlay_open_settings: () => {
    openOverlaySettings();
    return null;
  },
  overlay_set_interactive: (args) => {
    setOverlayInteractive(Boolean(args.interactive));
    return null;
  },

  // ── Presentation / geometry ─────────────────────────────────────
  overlay_set_collapsed: (args) => {
    setOverlayCollapsed(Boolean(args.collapsed));
    return null;
  },
  overlay_set_corner: (args) => setOverlayCorner(asString(args.corner)),
  overlay_save_bounds: () => {
    saveOverlayBounds();
    return null;
  },
  overlay_fit_ticker: (args) => {
    fitOverlayTicker(asNumber(args.width), asNumber(args.height));
    return null;
  },
  overlay_move_by: (args) => {
    moveOverlayBy(asNumber(args.dx), asNumber(args.dy));
    return null;
  },
  overlay_resize_to: (args) => {
    resizeOverlayTo(asNumber(args.width), asNumber(args.height));
    return null;
  },
  overlay_desktop_server: () => overlayDesktopServer(),

  // ── Settings / hotkeys ──────────────────────────────────────────
  overlay_get_settings: () => getOverlaySettings(),
  overlay_save_settings: (args) => {
    const settings = args.settings;
    if (!settings || typeof settings !== "object") {
      throw new Error("overlay_save_settings requires a settings payload");
    }
    saveOverlaySettings(settings as Partial<OverlaySettings>);
    return null;
  },
  overlay_set_hotkey: (args) => setOverlayHotkey(asString(args.accelerator)),
  overlay_native_blur_supported: () => nativeBlurSupported(),
  overlay_set_window_effect: (args) => {
    setOverlayWindowEffect(Boolean(args.enabled), args.color);
    return null;
  },

  // ── Session / telemetry ─────────────────────────────────────────
  overlay_get_session: () => getOverlaySession(),
  overlay_start_live_metrics: (args) => {
    // `pid` / `gpuId` / `gpuName` are part of the renderer contract but the
    // Electron sampler reads whole-machine CPU/RAM (see overlayMetrics.ts).
    startOverlayLiveMetrics({ intervalMs: args.intervalMs as number | null | undefined });
    return null;
  },
  overlay_stop_live_metrics: () => {
    stopOverlayLiveMetrics();
    return null;
  },
  overlay_save_history: (args) => {
    saveOverlayHistory(asString(args.json));
    return null;
  },
  overlay_load_history: () => loadOverlayHistory(),

  // ── Captures ────────────────────────────────────────────────────
  overlay_capture_screenshot: (args) =>
    captureScreenshot(args.gameTitle == null ? null : asString(args.gameTitle)),
  overlay_get_recent_screenshots: (args) =>
    recentScreenshots(args.gameTitle == null ? null : asString(args.gameTitle)),
  overlay_delete_screenshot: (args) => {
    deleteScreenshot(asString(args.path));
    return null;
  },
  overlay_open_screenshot_folder: (args) =>
    openScreenshotFolder(args.fileOrDirPath == null ? null : asString(args.fileOrDirPath)),
};
