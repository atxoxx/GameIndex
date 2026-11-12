/**
 * Main application window.
 *
 * Frameless (the UI draws its own title bar via `data-tauri-drag-region` and
 * relies on the native resize border of a `frame: false` window), hidden until
 * the renderer has hydrated, and close-to-tray aware.
 *
 * "Minimize on launch" is honoured where it actually applies: when a game
 * starts, not at boot (see `installMainWindowLifecycle`). `restore_on_exit`
 * brings the window back when the last tracked session ends.
 */
import { BrowserWindow } from "electron";
import { onEvent, setWindowLabel } from "../ipc";
import { isQuitting } from "../quitState";
import { getAppSetting } from "../state/appSettings";
import { attachWindowEvents } from "./events";
import { isTrayAvailable } from "./tray";
import { loadRenderer, preloadPath } from "./renderer";

/** Matches the `main` window in the retired `tauri.conf.json`. */
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 800;
const MIN_WIDTH = 900;
const MIN_HEIGHT = 600;

let mainWindow: BrowserWindow | null = null;
/** Set when the app is genuinely closing (tray "Quit", update relaunch). */
let forceClose = false;
/** The launcher hid the window for a game launch; restore-on-exit may undo it. */
let hiddenForLaunch = false;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

export function allowMainWindowClose(): void {
  forceClose = true;
}

export function createMainWindow(): BrowserWindow {
  const existing = getMainWindow();
  if (existing) return existing;

  const win = new BrowserWindow({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    frame: false,
    backgroundColor: "#0b0b0f",
    title: "GameIndex",
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      webviewTag: false,
      // Hydration and the boot-progress UI must keep ticking while the window
      // is still hidden behind the splash.
      backgroundThrottling: false,
    },
  });

  mainWindow = win;
  setWindowLabel(win, "main");
  attachWindowEvents(win);

  win.on("close", (event) => {
    if (forceClose || isQuitting()) return;
    if (getAppSetting("close_to_tray") && isTrayAvailable()) {
      event.preventDefault();
      win.hide();
    }
  });

  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  void loadRenderer(win);
  return win;
}

/** Show, restore and focus the main window (tray click, second instance, …). */
export function revealMainWindow(): void {
  const win = createMainWindow();
  hiddenForLaunch = false;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** Hide the window because a game is launching (minimize-on-launch). */
export function hideMainWindowForLaunch(): void {
  const win = getMainWindow();
  if (!win || !win.isVisible()) return;
  win.hide();
  hiddenForLaunch = true;
}

/** Restore the window after the last session, when `restore_on_exit` allows. */
export function restoreMainWindowAfterLaunch(): void {
  if (!hiddenForLaunch) return;
  hiddenForLaunch = false;
  if (!getAppSetting("restore_on_exit")) return;
  revealMainWindow();
}

/**
 * Game lifecycle wiring for the window: hide on launch, restore on exit.
 * Subscribed once from `createSurfaces()`.
 */
export function installMainWindowLifecycle(): void {
  onEvent("game-started", () => {
    if (!getAppSetting("minimize_on_launch")) return;
    hideMainWindowForLaunch();
  });
  onEvent("game-exited", (payload) => {
    const value =
      payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    // Another session is still running: leave the window as the user left it.
    const remaining = typeof value.remainingGameName === "string" ? value.remainingGameName : "";
    if (remaining) return;
    restoreMainWindowAfterLaunch();
  });
}
