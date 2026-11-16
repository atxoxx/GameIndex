/**
 * Chromium process-level memory configuration.
 *
 * These switches are only honoured before `app.ready`, so this runs at the very
 * top of the boot sequence. On Windows, Task Manager shows the *sum* of every
 * Chromium helper process, so the goal is both fewer processes and a bounded
 * heap/cache footprint in each of them:
 *
 *   • `process-per-site` — every app window (main, detail popout, overlay HUD,
 *     boot splash, launch splash) loads the same `file://` bundle, so they can
 *     share one renderer process instead of one per window (each parked
 *     renderer costs 60–120 MB). Embedded store/news previews are remote sites
 *     and keep their own per-site processes, so untrusted pages stay isolated
 *     from the app.
 *   • `js-flags` — cap each renderer's V8 old space (the default on 64-bit
 *     builds scales with system RAM and can reach several GB, which is how a
 *     busy day can end with a ~2 GB renderer) and expose `gc()` in the main
 *     world so `memoryPurge.ts` can force a collection when the window hides.
 *   • `disk-cache-size` / `media-cache-size` — the HTTP and media caches keep
 *     indexes and write buffers in RAM; 64 MB / 32 MB bounds them without
 *     hurting artwork loads.
 *   • `SpareRendererForSitePerProcess` off — Chromium normally pre-warms a
 *     spare renderer process that sits idle "just in case". This app creates
 *     windows rarely (boot, popout, HUD), so a parked process is pure waste.
 *
 * Deliberately NOT enabled:
 *   • `--in-process-gpu` — saves one more process, but moves GPU driver crashes
 *     into the browser process. The HUD records and composites while games run;
 *     the worst possible moment to lose the whole app.
 *   • `--renderer-process-limit` — once the limit is hit Chromium *reuses* a
 *     live renderer, so one crashed page can take unrelated windows with it.
 *     `process-per-site` already merges the windows that share content.
 */
import { app } from "electron";

export function installMemoryFlags(): void {
  app.commandLine.appendSwitch("process-per-site");
  app.commandLine.appendSwitch("js-flags", "--max-old-space-size=1024 --expose-gc");
  app.commandLine.appendSwitch("disk-cache-size", String(64 * 1024 * 1024));
  app.commandLine.appendSwitch("media-cache-size", String(32 * 1024 * 1024));
  app.commandLine.appendSwitch("disable-features", "SpareRendererForSitePerProcess");
}
