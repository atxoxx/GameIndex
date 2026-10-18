import { useEffect, useRef } from "react";

/**
 * `setInterval` that is paused while the document is hidden and resumes with
 * an immediate tick when it becomes visible again. Tauri windows are never
 * unloaded, so a plain interval fires at full rate inside a minimized /
 * behind-the-game window — on WebKitGTK (Linux) a hidden-but-ticking webview
 * keeps rendering, garbage-collecting and burning CPU for nothing. The
 * latest `fn` is always used, so callers may pass an unstable callback.
 */
export function useVisibleInterval(fn: () => void, ms: number, enabled = true): void {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) return;
    let timer: number | undefined;

    const tick = () => fnRef.current();
    const start = () => {
      if (timer === undefined) {
        timer = window.setInterval(tick, ms);
        tick();
      }
    };
    const stop = () => {
      if (timer !== undefined) {
        window.clearInterval(timer);
        timer = undefined;
      }
    };

    if (!document.hidden) start();
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        start();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ms, enabled]);
}
