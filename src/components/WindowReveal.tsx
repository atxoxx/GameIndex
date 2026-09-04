import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useGames } from "../context/GameContext";
import { logBootReady } from "../utils/bootPerf";

/**
 * Renderless gate that reveals the main window once the library has
 * hydrated AND the first frame has painted, instead of after a fixed
 * delay. A short minimum hold keeps the swap from flashing, and a hard
 * fallback timer reveals the window even if hydration never settles
 * (e.g. backend error on a fresh profile) so the app can never strand
 * the user behind the splash.
 */
const MIN_HOLD_MS = 250;
const FALLBACK_MS = 6000;

export default function WindowReveal() {
  const { gamesHydrated } = useGames();
  const revealedRef = useRef(false);

  // Reveal once the library data is ready (plus one paint + min hold).
  useEffect(() => {
    if (revealedRef.current || !gamesHydrated) return;
    revealedRef.current = true;

    const reveal = () => {
      logBootReady();
      invoke("close_splashscreen").catch(() => {
        // No Tauri shell (plain `npm run dev`) — nothing to reveal.
      });
    };

    let frame: ReturnType<typeof requestAnimationFrame> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Wait one frame so the hydrated library actually paints, then a
    // short extra hold so the swap doesn't flash.
    frame = requestAnimationFrame(() => {
      timer = setTimeout(reveal, MIN_HOLD_MS);
    });
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      if (timer) clearTimeout(timer);
    };
  }, [gamesHydrated]);

  // Safety net: never sit behind the splash forever.
  useEffect(() => {
    const fallback = setTimeout(() => {
      if (revealedRef.current) return;
      revealedRef.current = true;
      invoke("close_splashscreen").catch(() => {});
    }, FALLBACK_MS);
    return () => clearTimeout(fallback);
  }, []);

  return null;
}
