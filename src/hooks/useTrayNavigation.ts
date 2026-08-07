import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";

// Routes the backend system tray menu can ask the frontend to navigate to.
// Anything else arriving on the "navigate" event is ignored silently.
const TRAY_NAVIGATION_ROUTES = new Set([
  "/library",
  "/store",
  "/activity",
  "/friends",
  "/mods",
  "/settings",
  "/downloads",
]);

/**
 * Listens for the backend's `navigate` event (payload `{ path: string }`)
 * emitted when the user clicks a system tray menu item, and routes to the
 * matching app page. Unknown paths are ignored.
 */
export function useTrayNavigation() {
  const navigate = useNavigate();

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        unlisten = await listen<{ path: string }>("navigate", (e) => {
          if (disposed) return;
          const { path } = e.payload;
          if (TRAY_NAVIGATION_ROUTES.has(path)) {
            navigate(path);
          }
        });
      } catch (err) {
        console.warn("[useTrayNavigation] navigate listen failed:", err);
      }
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [navigate]);
}