import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** How long to wait after the last move/resize before persisting bounds. */
const DEBOUNCE_MS = 400;

/**
 * useOverlayBounds — persists the overlay window's position and size.
 *
 * The backend reads the live window geometry (`overlay_save_bounds`) and
 * stores it for whichever presentation is active (ticker vs panel), so a
 * drag or resize survives restarts. Moves and resizes are debounced so a
 * drag emits a single write. Failures are swallowed: the overlay also runs
 * in browser-only dev, where there is no Tauri window to read.
 */
export function useOverlayBounds(): void {
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unlisteners: Array<() => void> = [];

    const schedule = () => {
      if (disposed) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void invoke("overlay_save_bounds").catch(() => {
          /* no Tauri runtime */
        });
      }, DEBOUNCE_MS);
    };

    void (async () => {
      try {
        const win = getCurrentWindow();
        const [unMoved, unResized] = await Promise.all([
          win.onMoved(schedule),
          win.onResized(schedule),
        ]);
        if (disposed) {
          unMoved();
          unResized();
          return;
        }
        unlisteners.push(unMoved, unResized);
      } catch {
        /* browser-mode: no Tauri window */
      }
    })();

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      for (const unlisten of unlisteners) {
        try {
          unlisten();
        } catch {
          /* ignore */
        }
      }
    };
  }, []);
}
