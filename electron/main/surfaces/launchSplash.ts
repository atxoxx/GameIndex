/**
 * Standalone launch splash window — the "starting <game>" card shown while a
 * game boots.
 *
 * Ported from `src-tauri/src/launch_splash.rs`. The main window's
 * `SplashContext` stays the source of truth: it calls `open_launch_splash`,
 * mirrors every status flip through `update_launch_splash_status` and closes
 * the window. The standalone entry (`?window=launch-splash`) hydrates from
 * `get_launch_splash_state` and re-renders on each `launch-splash-state` event.
 *
 * Ordering rules that matter for the renderer (`LaunchSplashWindow.tsx`):
 *   • the snapshot is stored *before* the window is built, so the entry's first
 *     `get_launch_splash_state` always finds it;
 *   • a freshly built window stays hidden until the entry has state to render
 *     and calls `show_launch_splash_window`;
 *   • a status update with no snapshot is dropped (it must not resurrect a
 *     closed splash);
 *   • `errorMessage` is kept only for the `error` status.
 */
import { BrowserWindow } from "electron";
import { emitTo, registerCommand, setWindowLabel } from "../ipc";
import { getMainWindow } from "./mainWindow";
import { attachWindowEvents } from "./events";
import { loadRenderer, preloadPath } from "./renderer";

const WINDOW_WIDTH = 760;
const WINDOW_HEIGHT = 700;

export const STATUS_LAUNCHING = "launching";
export const STATUS_ERROR = "error";

/** Snapshot mirrored from the main window's splash state machine. */
export interface LaunchSplashSnapshot {
  gameId: string;
  status: string;
  errorMessage: string | null;
  startedAt: number;
  /** Serialized `Game` the splash renders (artwork, title, play time). */
  payload: unknown;
}

export interface LaunchSplashArgs {
  payload?: unknown;
  gameId?: string;
  startedAt?: number;
  [key: string]: unknown;
}

let launchSplashWindow: BrowserWindow | null = null;
let snapshot: LaunchSplashSnapshot | null = null;

export function getLaunchSplashWindow(): BrowserWindow | null {
  return launchSplashWindow && !launchSplashWindow.isDestroyed()
    ? launchSplashWindow
    : null;
}

export function getLaunchSplashState(): LaunchSplashSnapshot | null {
  return snapshot;
}

function emitState(state: LaunchSplashSnapshot | null): void {
  const win = getLaunchSplashWindow();
  if (win) emitTo(win, "launch-splash-state", state);
}

function notifyClosed(): void {
  emitTo(getMainWindow(), "launch-splash-closed", null);
}

function createLaunchSplashWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    center: true,
    resizable: false,
    frame: false,
    // Transparent so the card's CSS shadow is the only edge: a native shadow
    // would outline the whole rectangle.
    transparent: true,
    hasShadow: false,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: "#00000000",
    title: "GameIndex",
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  launchSplashWindow = win;
  setWindowLabel(win, "launch-splash");
  attachWindowEvents(win);
  win.on("closed", () => {
    if (launchSplashWindow === win) launchSplashWindow = null;
    snapshot = null;
    notifyClosed();
  });
  void loadRenderer(win, { window: "launch-splash" });
  return win;
}

/** Open (or refresh) the splash window for a new launch. */
export function openLaunchSplash(args: LaunchSplashArgs): void {
  snapshot = {
    gameId: String(args.gameId ?? ""),
    status: STATUS_LAUNCHING,
    errorMessage: null,
    startedAt:
      typeof args.startedAt === "number" && Number.isFinite(args.startedAt)
        ? args.startedAt
        : Date.now(),
    payload: args.payload ?? null,
  };

  // Reuse a live window (relaunch/retry) by refreshing and refocusing it; a
  // freshly built window stays hidden until the entry asks to be shown.
  const existing = getLaunchSplashWindow();
  if (existing) {
    existing.show();
    existing.focus();
  } else {
    createLaunchSplashWindow();
  }
  emitState(snapshot);
}

/** Mirror a status flip (started / error) onto the splash window. */
export function updateLaunchSplashStatus(
  status: string,
  errorMessage?: string | null,
): void {
  if (!snapshot) return;
  snapshot = {
    ...snapshot,
    status: String(status),
    errorMessage: status === STATUS_ERROR ? (errorMessage ?? null) : null,
  };
  emitState(snapshot);
}

/**
 * Back-compat shim for the earlier scaffold: merge a status patch.
 *
 * Prefer `updateLaunchSplashStatus(status, errorMessage)`; this exists so a
 * caller written against the scaffold's `{ status, errorMessage }` patch shape
 * keeps working (extra keys are ignored).
 */
export function updateLaunchSplashState(patch: Record<string, unknown>): void {
  if (!patch || typeof patch !== "object") return;
  if (typeof patch.status !== "string") return;
  updateLaunchSplashStatus(
    patch.status,
    patch.errorMessage == null ? null : String(patch.errorMessage),
  );
}

/** Reveal the splash after its entry has rendered. */
export function showLaunchSplashWindow(): void {  const win = getLaunchSplashWindow();
  if (!win) return;
  win.show();
  win.focus();
}

/**
 * Ask the main window to re-run the launch. Only honoured while the splash
 * shows a failure, so a stray event can never relaunch a game that is already
 * starting.
 */
export function retryLaunchSplash(): void {
  if (!snapshot || snapshot.status !== STATUS_ERROR) return;
  emitTo(getMainWindow(), "launch-splash-retry", { gameId: snapshot.gameId });
}

/**
 * Close the splash. The window's `closed` handler clears the snapshot and
 * notifies the main window, so this stays a one-liner when a window exists.
 */
export function closeLaunchSplash(): void {
  const win = getLaunchSplashWindow();
  if (win) {
    win.close();
    return;
  }
  // No window (inline fallback or already closed): clear and notify so the
  // main window's splash state always resolves.
  snapshot = null;
  notifyClosed();
}

/**
 * Register the launch-splash command that only this module can serve. Called
 * from `createSurfaces()`; the catalog entry would otherwise be stubbed.
 */
export function registerLaunchSplashCommands(): void {
  registerCommand(
    "update_launch_splash_status",
    (args) => {
      updateLaunchSplashStatus(
        String(args.status ?? ""),
        args.errorMessage == null ? null : String(args.errorMessage),
      );
      return null;
    },
    { override: true },
  );
}
