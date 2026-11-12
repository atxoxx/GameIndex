/**
 * Decoupling point between the launch path and the poll loop.
 *
 * `sessions.ts` (lifecycle) and `launchGame.ts` must be able to ask the watcher
 * to poll right now without importing `watcher.ts` (which imports them). The
 * watcher installs the handler when it starts.
 */
type WakeHandler = () => void;

let wakeHandler: WakeHandler | null = null;

export function setPollWakeHandler(handler: WakeHandler | null): void {
  wakeHandler = handler;
}

/** Request an immediate poll instead of waiting out the current sleep. */
export function requestImmediatePoll(): void {
  try {
    wakeHandler?.();
  } catch (error) {
    console.error("[launch] immediate poll request failed:", error);
  }
}
