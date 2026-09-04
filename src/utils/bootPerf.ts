/**
 * Cold-boot timeline diagnostics (dev only).
 *
 * Marks are written with the Performance API at module load, first
 * render, and window reveal. `logBootReady` prints a single summary line
 * in dev builds; production builds strip the console call via the Vite
 * esbuild `drop` config, so the markers add no prod overhead.
 */
const BOOT_START_MARK = "gameindex-boot-start";
const BOOT_READY_MARK = "gameindex-boot-ready";
const BOOT_MEASURE = "gameindex-boot";

export function markBootStart(): void {
  if (typeof performance === "undefined") return;
  performance.mark(BOOT_START_MARK);
}

export function logBootReady(): void {
  if (!import.meta.env.DEV) return;
  performance.mark(BOOT_READY_MARK);
  performance.measure(BOOT_MEASURE, BOOT_START_MARK, BOOT_READY_MARK);
  const entry = performance.getEntriesByName(BOOT_MEASURE).pop();
  const duration = entry ? Math.round(entry.duration) : null;
  console.debug(`[boot] interactive in ${duration === null ? "?" : `${duration} ms`}`);
}
