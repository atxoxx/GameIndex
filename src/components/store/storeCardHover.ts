import { useSyncExternalStore } from "react";

/**
 * Store-wide "a catalogue poster is hovered" signal.
 *
 * The spotlight hero needs to freeze its trailer and animated backdrop while
 * the pointer is over a poster, but routing that through `StorePage` state
 * re-rendered the header, filter sidebar, toolbar and the entire
 * (unvirtualised) grid on every enter/leave. A module-level external store
 * lets only the hero subscribe, and the debounced release keeps a sweep
 * across grid gutters from resuming the spotlight between two cards.
 */

/** Delay before the signal clears, bridging grid gaps between two cards. */
const HOVER_RELEASE_DELAY_MS = 150;

let hovered = false;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function publish(next: boolean): void {
  if (hovered === next) return;
  hovered = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): boolean {
  return hovered;
}

/** Report pointer enter/leave on a store poster. Enter applies immediately;
 *  leave is debounced so gutter traversal between cards stays a single
 *  continuous "hovering" state. */
export function setStoreCardHover(next: boolean): void {
  if (releaseTimer !== null) {
    clearTimeout(releaseTimer);
    releaseTimer = null;
  }
  if (next) {
    publish(true);
    return;
  }
  releaseTimer = setTimeout(() => {
    releaseTimer = null;
    publish(false);
  }, HOVER_RELEASE_DELAY_MS);
}

/** Subscribe to the poster hover signal (used to pause ambient media). */
export function useStoreCardHover(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ── Scroll activity probe ──────────────────────────────────────────────
// Hovering a card while the wheel is still moving must not kick off an
// animated-WebP decode; that is a full multi-frame image on the critical
// path. A single passive capture listener records the last scroll time so
// cards can skip the preview while the page is in motion.
let lastScrollAt = 0;
let hasScrolled = false;
let scrollProbeAttached = false;

function ensureScrollProbe(): void {
  if (scrollProbeAttached || typeof document === "undefined") return;
  scrollProbeAttached = true;
  document.addEventListener(
    "scroll",
    () => {
      lastScrollAt = performance.now();
      hasScrolled = true;
    },
    { capture: true, passive: true }
  );
}

/** True while the page has scrolled within the last `windowMs` milliseconds. */
export function isStoreScrolling(windowMs = 180): boolean {
  ensureScrollProbe();
  return hasScrolled && performance.now() - lastScrollAt < windowMs;
}
