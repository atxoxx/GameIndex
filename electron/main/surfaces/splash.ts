/**
 * Boot splash window — the small frameless page from `public/splashscreen.html`.
 *
 * The page paints its own background and asks the backend for the theme /
 * accent / language (`get_theme`, `get_accent_color`, `get_adaptive_palette`,
 * `get_language`), so it must stay opaque — a transparent window would show the
 * desktop through the card.
 *
 * The renderer closes it through the `close_splashscreen` command, which
 * `WindowReveal` calls once the library has hydrated; `closeSplashscreen()` in
 * `surfaces/index.ts` then reveals the main window.
 */
import { BrowserWindow } from "electron";
import { setWindowLabel } from "../ipc";
import { attachWindowEvents } from "./events";
import { loadSplashPage, preloadPath } from "./renderer";

/** Matches the `splashscreen` window in the retired `tauri.conf.json`. */
const WIDTH = 520;
const HEIGHT = 360;

let splashWindow: BrowserWindow | null = null;

export function getSplashWindow(): BrowserWindow | null {
  return splashWindow && !splashWindow.isDestroyed() ? splashWindow : null;
}

export function createBootSplash(): BrowserWindow {
  const existing = getSplashWindow();
  if (existing) return existing;

  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    center: true,
    resizable: false,
    movable: true,
    frame: false,
    show: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    // The page's own --bg; set here too so there is no white flash before the
    // first paint.
    backgroundColor: "#08090c",
    title: "GameIndex",
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  splashWindow = win;
  setWindowLabel(win, "splashscreen");
  attachWindowEvents(win);
  win.on("closed", () => {
    if (splashWindow === win) splashWindow = null;
  });
  void loadSplashPage(win);
  return win;
}

export function closeBootSplash(): void {
  const win = getSplashWindow();
  if (win) win.close();
}
