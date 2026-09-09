import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useGames } from "../context/GameContext";
import { logBootReady } from "../utils/bootPerf";

/**
 * Renderless gate that reveals the main window once the library has
 * hydrated, instead of after a fixed delay. A short minimum hold keeps
 * the swap from flashing, and a hard fallback timer reveals the window
 * even if hydration never settles (e.g. backend error on a fresh
 * profile) so the app can never strand the user behind the splash.
 */
const MIN_HOLD_MS = 250;
const FALLBACK_MS = 6000;

export default function WindowReveal() {
  const { gamesHydrated } = useGames();
  const revealedRef = useRef(false);

  const reveal = useCallback(() => {
    if (revealedRef.current) return;
    revealedRef.current = true;
    try {
      logBootReady();
    } catch {
      // Boot-timing marks are diagnostic-only; a missing mark (or an
      // exotic `performance` implementation) must never stall the reveal.
    }
    invoke("close_splashscreen").catch(() => {
      // No Tauri shell (plain `npm run dev`) — nothing to reveal.
    });
  }, []);

  // Reveal once the library data is ready, after a short hold so the
  // hydrated library paints before the swap. A plain timer (not
  // requestAnimationFrame) drives this: rAF is not guaranteed to fire
  // while the main window is hidden — on WebKitGTK with compositing
  // disabled an unmapped window never produces a frame — and the old
  // code set a `revealed` flag synchronously, which silenced the
  // fallback below even though the reveal itself never ran.
  useEffect(() => {
    if (!gamesHydrated) return;
    const timer = setTimeout(reveal, MIN_HOLD_MS);
    return () => clearTimeout(timer);
  }, [gamesHydrated, reveal]);

  // Safety net: never sit behind the splash forever. Stays armed until
  // the reveal above actually runs (revealedRef is only set inside
  // `reveal`), so a stalled hydration or suppressed rAF can never
  // strand the user behind the splash.
  useEffect(() => {
    const fallback = setTimeout(reveal, FALLBACK_MS);
    return () => clearTimeout(fallback);
  }, [reveal]);

  return null;
}
