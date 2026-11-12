/**
 * `saves-progress` emission and cancellation for the backup engine.
 *
 * The renderer keeps one shared progress bar (`SavesContext`) and treats
 * `percent >= 100` as "finished, refresh the summary". Emitting per file would
 * flood the event bridge on a folder with tens of thousands of saves, so all
 * callers go through `SaveProgressReporter`, which throttles to ~10/s and
 * always flushes the final message.
 */
import { emit } from "../../ipc";
import type { SaveProgressPayload } from "./types";

const MIN_INTERVAL_MS = 100;

export class SaveProgressReporter {
  private lastAt = 0;

  constructor(
    private readonly phase: SaveProgressPayload["phase"],
    private readonly gameId = "",
    private readonly gameName = "",
  ) {}

  /** Emit at most once per 100 ms unless `force` (phase changes, completion). */
  emit(current: number, total: number, message: string, force = false): void {
    const now = Date.now();
    if (!force && now - this.lastAt < MIN_INTERVAL_MS) return;
    this.lastAt = now;
    const percent =
      total <= 0 ? 0 : Math.min(100, Math.max(0, Math.round((current / total) * 100)));
    const payload: SaveProgressPayload = {
      phase: this.phase,
      gameId: this.gameId,
      gameName: this.gameName,
      current,
      total,
      percent,
      message,
    };
    emit("saves-progress", payload);
  }

  /** Final 100% frame so the renderer clears its progress bar. */
  finish(message: string): void {
    this.emit(1, 1, message, true);
  }
}

/** One cancel token shared by the long-running save operations. */
let activeController: AbortController | null = null;

/** Start a new cancellable operation, superseding any previous one. */
export function beginOperation(): AbortController {
  if (activeController) activeController.abort();
  activeController = new AbortController();
  return activeController;
}

/** Mark the current operation cancelled. Returns false when idle. */
export function cancelActiveOperation(): boolean {
  if (!activeController || activeController.signal.aborted) return false;
  activeController.abort();
  return true;
}

/** Clear the token once the operation settles (only if still the active one). */
export function endOperation(controller: AbortController): void {
  if (activeController === controller) activeController = null;
}

/** Error thrown when the user cancels; callers surface it verbatim. */
export function cancelledError(): Error {
  return new Error("Operation cancelled");
}

export function isCancelled(controller: AbortController): boolean {
  return controller.signal.aborted;
}
