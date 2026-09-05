// Defer non-critical work until the main thread is idle so boot-time
// hydration (session history, hardware detection, …) never competes with
// the first paint / splash-reveal path. Falls back to a plain timer where
// `requestIdleCallback` is unavailable, and the idle timeout keeps the
// task running even under continuous load.
export function deferToIdle(task: () => void, timeoutMs = 2000): void {
  if (typeof window === "undefined") {
    task();
    return;
  }
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(() => task(), { timeout: timeoutMs });
  } else {
    window.setTimeout(task, Math.min(timeoutMs, 1000));
  }
}
