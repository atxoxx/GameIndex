/** Global "the app is really exiting" flag (close-to-tray must not block it). */
let quitting = false;

export function markQuitting(): void {
  quitting = true;
}

export function isQuitting(): boolean {
  return quitting;
}
