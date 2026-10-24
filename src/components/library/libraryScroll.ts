/**
 * Module-level scroll tracker for the Library grid.
 *
 * Hovering a card swaps its poster for an animated WebP/APNG. During a wheel
 * scroll the rows slide under the pointer, so every new card fires
 * `mouseenter` — without a guard the grid starts decoding several animated
 * images per second while the compositor is already busy. Cards consult
 * `isLibraryScrolling()` before entering their hover state.
 */

const SCROLL_IDLE_MS = 140;

let lastScrollAt = 0;
let installed = false;

function onScroll(): void {
  lastScrollAt = Date.now();
}

function install(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  // Capture catches scroll events from the app's scroll container, which do
  // not bubble.
  window.addEventListener("scroll", onScroll, { capture: true, passive: true });
}

/** True while the page has scrolled within the last ~140 ms. */
export function isLibraryScrolling(idleMs = SCROLL_IDLE_MS): boolean {
  install();
  return Date.now() - lastScrollAt < idleMs;
}
