import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

/** How long to wait after the last move/resize before persisting bounds. */
const SAVE_DEBOUNCE_MS = 400;

/** Extract the "seat" (n/s/e/w combination) from a resize handle's classes. */
function resizeDirection(element: Element): string | null {
  const cls = element.className
    .split(/\s+/)
    .find((name) => name.startsWith("resize-handle-"));
  return cls ? cls.slice("resize-handle-".length) : null;
}

/**
 * useOverlayWindowControls — window drag and resize for the in-game overlay.
 *
 * On Wayland the overlay is a wlr-layer-shell surface, which has no native
 * move/resize request: Tauri's `startDragging` / `startResizeDragging` are
 * silent no-ops, and `data-tauri-drag-region` therefore does nothing. The
 * surface is instead repositioned by re-anchoring its layer-shell margins and
 * resized through the backend, so this drives those from pointer input.
 *
 * Only mounted by the overlay webview (see `OverlayWindow`), so the main app
 * window keeps its native app-region drag. A no-op on X11/Windows, where the
 * native path works.
 */
export function useOverlayWindowControls(): void {
  useEffect(() => {
    let disposed = false;
    let saveTimer: ReturnType<typeof setTimeout> | undefined;

    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let pendingDx = 0;
    let pendingDy = 0;
    let frame = 0;

    let resizing: string | null = null;
    let startX = 0;
    let startY = 0;
    let startW = 0;
    let startH = 0;

    const scale = () => window.devicePixelRatio || 1;

    const scheduleSave = () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        void invoke("overlay_save_bounds").catch(() => {
          /* no Tauri runtime */
        });
      }, SAVE_DEBOUNCE_MS);
    };

    const flushDrag = () => {
      frame = 0;
      if (pendingDx === 0 && pendingDy === 0) return;
      const dx = pendingDx * scale();
      const dy = pendingDy * scale();
      pendingDx = 0;
      pendingDy = 0;
      void invoke("overlay_move_by", { dx, dy }).catch(() => {
        /* no Tauri runtime */
      });
    };

    const onPointerMove = (event: PointerEvent) => {
      if (dragging) {
        pendingDx += event.screenX - lastX;
        pendingDy += event.screenY - lastY;
        lastX = event.screenX;
        lastY = event.screenY;
        if (!frame) frame = requestAnimationFrame(flushDrag);
        return;
      }
      if (resizing) {
        const dx = event.screenX - startX;
        const dy = event.screenY - startY;
        let width = startW;
        let height = startH;
        if (resizing.includes("e")) width = startW + dx;
        if (resizing.includes("w")) width = startW - dx;
        if (resizing.includes("s")) height = startH + dy;
        if (resizing.includes("n")) height = startH - dy;
        void invoke("overlay_resize_to", { width, height }).catch(() => {
          /* no Tauri runtime */
        });
      }
    };

    const endGesture = () => {
      if (!dragging && !resizing) return;
      dragging = false;
      resizing = null;
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      flushDrag();
      scheduleSave();
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !event.isPrimary) return;
      const target = event.target as HTMLElement | null;
      if (!target) return;

      const handle = target.closest(".window-resize-handle");
      if (handle) {
        resizing = resizeDirection(handle);
        if (!resizing) return;
        startX = event.screenX;
        startY = event.screenY;
        startW = window.innerWidth;
        startH = window.innerHeight;
        capturePointer(event);
        return;
      }

      const region = target.closest("[data-tauri-drag-region]");
      if (region && region.getAttribute("data-tauri-drag-region") !== "false") {
        dragging = true;
        lastX = event.screenX;
        lastY = event.screenY;
        capturePointer(event);
      }
    };

    const capturePointer = (event: PointerEvent) => {
      try {
        (event.target as Element).setPointerCapture(event.pointerId);
      } catch {
        /* pointer capture unsupported */
      }
    };

    void invoke<string>("overlay_desktop_server")
      .then((server) => {
        if (disposed || server !== "wayland") return;
        document.addEventListener("pointerdown", onPointerDown, true);
        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", endGesture);
        window.addEventListener("pointercancel", endGesture);
      })
      .catch(() => {
        /* no Tauri runtime */
      });

    return () => {
      disposed = true;
      if (saveTimer) clearTimeout(saveTimer);
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", endGesture);
      window.removeEventListener("pointercancel", endGesture);
    };
  }, []);
}
