import { useEffect, useRef, useState } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";

interface UseOsFileDropOptions {
  /**
   * Set to false to leave the window alone (e.g. while an import modal is
   * already open and must not be clobbered by a second drop).
   */
  enabled?: boolean;
}

/**
 * useOsFileDrop
 *
 * Reports the absolute paths of files dropped on the app window from the OS
 * file explorer, and whether a drop is currently hovering the window.
 *
 * The DOM never sees these drops: Tauri keeps native drag-drop handling on
 * (`dragDropEnabled` defaults to true, and wry installs its own handler on
 * Windows and Linux), so `dragover`/`drop` do not fire for explorer drags and
 * `dataTransfer.files` carries no path in Tauri v2. The webview `drag-*`
 * events are the one cross-platform source of real paths, so both platforms
 * go through the same listener.
 *
 * Outside the Tauri shell (plain `npm run dev`) the hook is inert.
 */
export function useOsFileDrop(
  onDrop: (paths: string[]) => void,
  { enabled = true }: UseOsFileDropOptions = {}
): boolean {
  const [isDragging, setIsDragging] = useState(false);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined" || !("__TAURI__" in window)) return;

    let disposed = false;
    let unlisten: UnlistenFn | null = null;

    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "leave") {
          setIsDragging(false);
        } else if (event.payload.type === "drop") {
          setIsDragging(false);
          if (event.payload.paths.length > 0) {
            onDropRef.current(event.payload.paths);
          }
        } else {
          setIsDragging(true);
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch((err) => {
        console.error("[useOsFileDrop] failed to listen for file drops:", err);
      });

    return () => {
      disposed = true;
      unlisten?.();
      setIsDragging(false);
    };
  }, [enabled]);

  return isDragging;
}
