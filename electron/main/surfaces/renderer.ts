/**
 * Loading the React bundle into a window, in dev (Vite server) or production
 * (`out/renderer`). Query parameters drive the per-window entry point chosen in
 * `src/main.tsx` (`?window=overlay`, `?window=detail`, `?window=launch-splash`).
 */
import type { BrowserWindow } from "electron";
import path from "node:path";

/** electron-vite sets this in `dev`; undefined for packaged builds. */
const DEV_SERVER_URL = process.env.ELECTRON_RENDERER_URL;

export const isDev = Boolean(DEV_SERVER_URL);

export function preloadPath(): string {
  return path.join(__dirname, "../preload/index.cjs");
}

export function rendererIndexPath(): string {
  return path.join(__dirname, "../renderer/index.html");
}

export function loadRenderer(
  win: BrowserWindow,
  params: Record<string, string> = {},
): Promise<void> {
  if (DEV_SERVER_URL) {
    const query = new URLSearchParams(params).toString();
    return win.loadURL(query ? `${DEV_SERVER_URL}/?${query}` : `${DEV_SERVER_URL}/`);
  }
  return win.loadFile(rendererIndexPath(), { query: params });
}

/** The static boot-splash page (`public/splashscreen.html`). */
export function loadSplashPage(win: BrowserWindow): Promise<void> {
  if (DEV_SERVER_URL) {
    return win.loadURL(`${DEV_SERVER_URL}/splashscreen.html`);
  }
  return win.loadFile(path.join(__dirname, "../renderer/splashscreen.html"));
}
