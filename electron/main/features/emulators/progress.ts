/**
 * Throttled progress emission for the emulation commands.
 *
 * The renderer only listens to a couple of event names (`rom-enrich-progress`,
 * `rom-folder-changed`), so this module exists to keep those payloads at the
 * documented ≤ 10/s cadence rather than one frame per file.
 */
import { emit } from "../../ipc";

export interface ThrottledEmitter {
  /** Send a payload now unless the throttle window has not elapsed. */
  send(payload: unknown, force?: boolean): void;
  /** Forget the last send (call when a new run starts). */
  reset(): void;
}

export function createThrottledEmitter(event: string, intervalMs = 100): ThrottledEmitter {
  let lastSentAt = 0;
  return {
    send(payload: unknown, force = false): void {
      const now = Date.now();
      if (!force && now - lastSentAt < intervalMs) return;
      lastSentAt = now;
      emit(event, payload);
    },
    reset(): void {
      lastSentAt = 0;
    },
  };
}
