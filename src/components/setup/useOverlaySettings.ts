import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  DEFAULT_OVERLAY_SETTINGS,
  type OverlaySettings,
} from "../../context/OverlayContext";

/**
 * Standalone overlay-settings accessor for the setup wizard. The main
 * window doesn't mount `OverlayProvider` (the overlay is its own window),
 * so the wizard talks to the same `overlay_get_settings` /
 * `overlay_save_settings` commands directly instead of borrowing the
 * overlay context.
 */
export function useOverlaySettings() {
  const [settings, setSettings] = useState<OverlaySettings>(DEFAULT_OVERLAY_SETTINGS);
  const ref = useRef<OverlaySettings>(DEFAULT_OVERLAY_SETTINGS);

  useEffect(() => {
    let cancelled = false;
    invoke<OverlaySettings | null>("overlay_get_settings")
      .then((value) => {
        if (cancelled) return;
        const next = { ...DEFAULT_OVERLAY_SETTINGS, ...(value ?? {}) };
        ref.current = next;
        setSettings(next);
      })
      .catch(() => {
        // No backend (plain `npm run dev`): keep the defaults so the
        // toggles still render.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = useCallback((patch: Partial<OverlaySettings>) => {
    const next = { ...ref.current, ...patch };
    ref.current = next;
    setSettings(next);
    void invoke("overlay_save_settings", { settings: next }).catch(() => {
      // No backend: keep the change in memory for this session.
    });
  }, []);

  return { settings, update };
}
