import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";

/**
 * Routes the desktop shell on behalf of a backend request. The HUD's
 * "Open full settings" button hides the overlay, focuses the main window and
 * emits `app:navigate`; the shell owns the actual route change so the overlay
 * never has to know the router layout.
 */
export default function AppNavigationBridge() {
  const navigate = useNavigate();

  useEffect(() => {
    let disposed = false;
    const subscription = listen<string>("app:navigate", (event) => {
      if (!disposed && event.payload) navigate(event.payload);
    }).catch(() => null);

    return () => {
      disposed = true;
      void subscription.then((unlisten) => unlisten?.());
    };
  }, [navigate]);

  return null;
}
