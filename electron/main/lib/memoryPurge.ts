/**
 * Free renderer memory when nobody is looking.
 *
 * Hidden Electron windows throttle their timers but keep every decoded image,
 * compiled script and committed V8 heap page resident. A tray-resident launcher
 * spends most of its day hidden (or minimized behind a game), which is exactly
 * when that resident cache is pure waste — and when RAM matters most.
 *
 * `purgeWindow()` asks a renderer to drop what it can rebuild later:
 *   • `webFrame.clearCache()` — Blink's decoded image / script / CSS caches.
 *     `webFrame` only exists in the preload, so this rides the existing
 *     `gi:event` channel ("gi:purge-memory") where the preload listens.
 *   • `gc()` in the main world — forces V8 to actually release the heap pages
 *     the purge freed instead of waiting for the next allocation pressure
 *     (`--expose-gc` is appended in `memoryFlags.ts`).
 *   • embedded previews (WebContentsView children) get the gc nudge too.
 *   • after a *long* hide the HTTP cache and keep-alive sockets are dropped as
 *     well (`clearCache` / `closeAllConnections`). Library artwork is served
 *     locally via `giasset://`, so the cost is a disk re-read, not a re-download.
 *
 * Wiring:
 *   • `installWindowMemoryPurge(win)` — full purge once the main window has
 *     been hidden for `HIDE_PURGE_DELAY_MS` (tray, minimize-on-launch). A short
 *     alt-tab cancels the timer, so day-to-day switching never pays a re-decode.
 *   • `installSystemMemoryHooks()` — soft purge (no cache drop) when Windows
 *     suspends or locks; decoded images help nobody across a sleep.
 */
import { BrowserWindow, powerMonitor, WebContentsView } from "electron";
import { emitTo } from "../ipc";

/** How long the main window stays hidden before its caches are dropped. */
const HIDE_PURGE_DELAY_MS = 60_000;

/** Nudge V8 in a main world; `--expose-gc` makes `gc` available there. */
function runGc(contents: Electron.WebContents): void {
  if (contents.isDestroyed()) return;
  contents.executeJavaScript("typeof gc === 'function' ? gc() : undefined", true).catch(() => {
    /* page navigated away mid-purge */
  });
}

export interface PurgeOptions {
  /** Also drop the HTTP cache and close keep-alive sockets (long hides). */
  dropHttpCache?: boolean;
}

/** Drop rebuildable caches in `win` and everything embedded inside it. */
export async function purgeWindow(win: BrowserWindow | null, options: PurgeOptions = {}): Promise<void> {
  if (!win || win.isDestroyed()) return;

  // Blink caches, via the preload (the main world has no `webFrame`).
  emitTo(win, "gi:purge-memory");
  runGc(win.webContents);

  // Embedded WebContentsViews (store previews, news readers) ride the window
  // but are not windows themselves, so they need the explicit nudge. Their
  // content is untrusted: a gc nudge only, no executeJavaScript beyond it.
  for (const child of win.contentView.children) {
    if (child instanceof WebContentsView) {
      try {
        if (!child.webContents.isDestroyed()) runGc(child.webContents);
      } catch {
        /* view already detached */
      }
    }
  }

  if (!options.dropHttpCache) return;
  try {
    const session = win.webContents.session;
    await Promise.allSettled([session.clearCache(), session.closeAllConnections()]);
  } catch {
    /* session may already be gone with the window */
  }
}

/** Full purge when the main window has been hidden for a while (tray / gaming). */
export function installWindowMemoryPurge(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null;
  const cancel = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  };
  win.on("hide", () => {
    cancel();
    timer = setTimeout(() => {
      timer = null;
      if (!win.isDestroyed() && !win.isVisible()) void purgeWindow(win, { dropHttpCache: true });
    }, HIDE_PURGE_DELAY_MS);
    timer.unref?.();
  });
  win.on("show", cancel);
  win.once("closed", cancel);
}

/** Soft purge (keep the HTTP cache) when the machine sleeps or locks. */
export function installSystemMemoryHooks(): void {
  const softPurge = () => {
    for (const win of BrowserWindow.getAllWindows()) {
      void purgeWindow(win, { dropHttpCache: false });
    }
  };
  powerMonitor.on("suspend", softPurge);
  powerMonitor.on("lock-screen", softPurge);
}
