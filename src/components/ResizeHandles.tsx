import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

type ResizeDirection = Parameters<ReturnType<typeof getCurrentWindow>["startResizeDragging"]>[0];

interface HandleDef {
  direction: ResizeDirection;
  className: string;
}

const HANDLES: HandleDef[] = [
  { direction: "North", className: "resize-handle-n" },
  { direction: "South", className: "resize-handle-s" },
  { direction: "East", className: "resize-handle-e" },
  { direction: "West", className: "resize-handle-w" },
  { direction: "NorthWest", className: "resize-handle-nw" },
  { direction: "NorthEast", className: "resize-handle-ne" },
  { direction: "SouthWest", className: "resize-handle-sw" },
  { direction: "SouthEast", className: "resize-handle-se" },
];

/**
 * ResizeHandles provides invisible drag-resize hit areas around the window
 * borders. Required on Linux (WebKitGTK) where frameless windows
 * (`decorations: false`) do not get system-provided resize borders.
 *
 * Calls Tauri's `startResizeDragging` on mouse down, delegating window
 * resizing to the native window manager.
 */
export default function ResizeHandles() {
  const [isResizable, setIsResizable] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;

    (async () => {
      try {
        const win = getCurrentWindow();
        const checkState = async () => {
          if (cancelled) return;
          try {
            const [maximized, fullscreen] = await Promise.all([
              win.isMaximized(),
              win.isFullscreen(),
            ]);
            setIsResizable(!maximized && !fullscreen);
          } catch {
            /* browser-mode or unsupported */
          }
        };

        await checkState();

        unlisten = await win.onResized(() => {
          if (cancelled) return;
          if (resizeTimer) clearTimeout(resizeTimer);
          resizeTimer = setTimeout(checkState, 150);
        });

        if (cancelled && unlisten) {
          unlisten();
          unlisten = undefined;
        }
      } catch {
        /* browser-mode: noop */
      }
    })();

    return () => {
      cancelled = true;
      if (resizeTimer) clearTimeout(resizeTimer);
      if (unlisten) {
        try {
          unlisten();
        } catch {
          /* ignore */
        }
      }
    };
  }, []);

  if (!isResizable) return null;

  const handleMouseDown = (direction: ResizeDirection) => (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Left mouse button only
    e.preventDefault();
    try {
      getCurrentWindow().startResizeDragging(direction);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="window-resize-container" aria-hidden="true">
      {HANDLES.map(({ direction, className }) => (
        <div
          key={direction}
          className={`window-resize-handle ${className}`}
          onMouseDown={handleMouseDown(direction)}
        />
      ))}
    </div>
  );
}
