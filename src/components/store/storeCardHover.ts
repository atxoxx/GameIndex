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
