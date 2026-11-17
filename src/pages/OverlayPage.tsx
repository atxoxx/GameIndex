import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useOverlay } from "../context/OverlayContext";
import OverlayTicker from "../components/overlay/OverlayTicker";
import OverlayPanel from "../components/overlay/OverlayPanel";
import { idleAction, type IdleAction } from "../components/overlay/overlayIdle";
import { useVisibleInterval } from "../hooks/useVisibleInterval";

/** The dim step multiplies the configured ticker opacity by this much. */
const DIM_FACTOR = 0.45;

/** How often the idle clock is checked (ms). */
const IDLE_TICK_MS = 500;

/**
 * OverlayPage — the overlay's ticker ↔ panel switcher.
 *
 * Collapsed shows the compact ticker (click to expand); expanded shows the
 * interactive panel. Esc collapses while the panel is open.
 *
 * While collapsed, the ticker can dim — and eventually hide — itself after
 * idle seconds away from interaction (`tickerAutoDimSeconds` /
 * `tickerAutoHideSeconds`): passive telemetry should not sit at full opacity
 * or on screen forever once nobody is looking. The hide step is suspended while
 * a game session runs — the game owns the pointer and keyboard, so the HUD
 * would otherwise disappear seconds into every session. The global toggle
 * hotkey is the "peek": showing the window resets the idle timers.
 */
export default function OverlayPage() {
  const { collapsed, collapse, settings, session } = useOverlay();

  useEffect(() => {
    if (collapsed) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        collapse();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [collapsed, collapse]);

  const dimSeconds = Math.max(0, Math.floor(settings.tickerAutoDimSeconds ?? 0));
  const hideSeconds = Math.max(0, Math.floor(settings.tickerAutoHideSeconds ?? 0));
  const sessionActive = Boolean(session?.gameId);
  const idleEnabled = collapsed && (dimSeconds > 0 || hideSeconds > 0);
  const { opacity } = settings;
  const idleStateRef = useRef<IdleAction>("none");
  const lastActivityRef = useRef(0);

  const applyOpacity = useCallback(
    (factor: number) => {
      document.documentElement.style.setProperty(
        "--overlay-opacity",
        (opacity * factor).toFixed(3),
      );
    },
    [opacity],
  );

  const bump = useCallback(() => {
    lastActivityRef.current = performance.now();
    if (idleStateRef.current !== "none") {
      idleStateRef.current = "none";
      applyOpacity(1);
    }
  }, [applyOpacity]);

  useEffect(() => {
    idleStateRef.current = "none";

    // Leaving the idle mode (toggle off, expand, timers cleared) must clear
    // the dimming this effect applied last time.
    if (!idleEnabled) {
      applyOpacity(1);
      return;
    }

    lastActivityRef.current = performance.now();

    const EVENTS = ["pointermove", "pointerdown", "keydown"] as const;
    for (const name of EVENTS) window.addEventListener(name, bump);
    // The global toggle hotkey is the peek; re-showing the window resets the
    // timers, otherwise a huge elapsed time would instantly re-hide it.
    const onVisibility = () => {
      if (document.visibilityState === "visible") bump();
    };
    document.addEventListener("visibilitychange", onVisibility);

    applyOpacity(1);

    return () => {
      for (const name of EVENTS) window.removeEventListener(name, bump);
      document.removeEventListener("visibilitychange", onVisibility);
      // Always restore full opacity for whatever runs next.
      applyOpacity(1);
    };
  }, [idleEnabled, bump, applyOpacity]);

  // The idle clock stops entirely while the HUD window is hidden instead of
  // waking twice a second just to read document.hidden.
  useVisibleInterval(
    () => {
      const elapsed = (performance.now() - lastActivityRef.current) / 1000;
      const next = idleAction(elapsed, dimSeconds, hideSeconds, sessionActive);
      if (next === idleStateRef.current) return;
      idleStateRef.current = next;
      if (next === "dim") {
        applyOpacity(DIM_FACTOR);
      } else if (next === "hide") {
        void invoke("overlay_hide").catch(() => {
          /* no Tauri runtime */
        });
      } else {
        applyOpacity(1);
      }
    },
    IDLE_TICK_MS,
    idleEnabled,
  );

  return collapsed ? <OverlayTicker /> : <OverlayPanel />;
}
