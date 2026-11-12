/**
 * Reusable game-detail popout window (`?window=detail&route=…`).
 *
 * Ported from `src-tauri/src/game_window.rs`: one window for the whole app
 * (`game-detail` label). Asking for another game focuses the existing window
 * and pushes `game-detail:navigate` instead of stacking a window per card —
 * `src/components/GameDetailWindow.tsx` listens for exactly that event.
 *
 * The window is frameless; the popout draws its own slim title bar and resize
 * handles (`GameDetailTitleBar` / `ResizeHandles`).
 */
import { BrowserWindow } from "electron";
import { emitTo, setWindowLabel } from "../ipc";
import { attachWindowEvents } from "./events";
import { loadRenderer, preloadPath } from "./renderer";

export const GAME_DETAIL_WINDOW_LABEL = "game-detail";
export const GAME_DETAIL_NAVIGATE_EVENT = "game-detail:navigate";

const DEFAULT_WINDOW_WIDTH = 1180;
const DEFAULT_WINDOW_HEIGHT = 820;
const MIN_WINDOW_WIDTH = 720;
const MIN_WINDOW_HEIGHT = 540;

let detailWindow: BrowserWindow | null = null;

function getDetailWindow(): BrowserWindow | null {
  return detailWindow && !detailWindow.isDestroyed() ? detailWindow : null;
}

/**
 * Accept only the two detail routes the popout renders. The value comes from
 * the renderer, so a malformed or unexpected route must never be able to steer
 * the window somewhere else in the app.
 */
export function normalizeDetailRoute(route: string): string {
  const trimmed = String(route ?? "").trim();
  const hasId = (prefix: string) => trimmed.startsWith(prefix) && trimmed.length > prefix.length;
  if (!hasId("/library/") && !hasId("/store/")) {
    throw new Error(`unsupported detail route: ${trimmed}`);
  }
  if (/[\s#\u0000-\u001f]/.test(trimmed)) {
    throw new Error("detail route contains unsupported characters");
  }
  return trimmed;
}

/** Open the detail window for `route`, or re-target the one already open. */
export function openDetailWindow(route: string, title?: string): void {
  const normalized = normalizeDetailRoute(route);
  const trimmedTitle = title?.trim();

  const existing = getDetailWindow();
  if (existing) {
    if (trimmedTitle) existing.setTitle(trimmedTitle);
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    emitTo(existing, GAME_DETAIL_NAVIGATE_EVENT, { route: normalized });
    return;
  }

  const win = new BrowserWindow({
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    show: true,
    frame: false,
    center: true,
    backgroundColor: "#0b0b0f",
    title: trimmedTitle || "GameIndex",
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  detailWindow = win;
  setWindowLabel(win, GAME_DETAIL_WINDOW_LABEL);
  attachWindowEvents(win);
  win.on("closed", () => {
    if (detailWindow === win) detailWindow = null;
  });
  void loadRenderer(win, { window: "detail", route: normalized });
  win.focus();
}

export function closeAllDetailWindows(): void {
  const win = getDetailWindow();
  if (win) win.close();
  detailWindow = null;
}
