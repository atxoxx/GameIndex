/**
 * Per-window events the renderer shim subscribes to (`onResized`, `onMoved`,
 * `onFocusChanged`). Names match Tauri's so the React code needed no changes.
 */
import { screen, type BrowserWindow } from "electron";
import { emitTo } from "../ipc";

const THROTTLE_MS = 50;

function throttled(fn: () => void): () => void {
  let timer: NodeJS.Timeout | null = null;
  return () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      fn();
    }, THROTTLE_MS);
  };
}

export function attachWindowEvents(win: BrowserWindow): void {
  const scale = (): number => {
    try {
      return screen.getDisplayMatching(win.getBounds()).scaleFactor || 1;
    } catch {
      return 1;
    }
  };

  const sendResize = throttled(() => {
    if (win.isDestroyed()) return;
    const [width, height] = win.getContentSize();
    const factor = scale();
    emitTo(win, "tauri://resize", {
      width: Math.round(width * factor),
      height: Math.round(height * factor),
    });
  });

  const sendMove = throttled(() => {
    if (win.isDestroyed()) return;
    const { x, y } = win.getBounds();
    const factor = scale();
    emitTo(win, "tauri://move", {
      x: Math.round(x * factor),
      y: Math.round(y * factor),
    });
  });

  win.on("resize", sendResize);
  win.on("maximize", sendResize);
  win.on("unmaximize", sendResize);
  win.on("move", sendMove);
  win.on("focus", () => emitTo(win, "tauri://focus-changed", true));
  win.on("blur", () => emitTo(win, "tauri://focus-changed", false));
}
