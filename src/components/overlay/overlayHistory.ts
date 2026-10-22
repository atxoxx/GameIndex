/**
 * Telemetry-history ownership rules, kept pure so the save/flush races
 * between the rolling sample window and the HUD's session changes are
 * testable without a Tauri runtime.
 *
 * The samples in `history` always belong to exactly one game (`owner`). When
 * the HUD's session switches games, the pending samples must be flushed under
 * the OLD game id before the window resets — writing them under the new id
 * would relabel game A's telemetry as game B's.
 */

/** How many live telemetry samples the sparklines retain. The cap is part of
 *  the save contract, so it lives with the ownership rules; the context
 *  re-exports it. */
export const OVERLAY_HISTORY_LIMIT = 60;

/** A persisted snapshot: which game the samples belong to. */
export interface HistorySnapshot {
  gameId: string | null;
  samples: OverlaySample[];
}

/** Deliberately loose: sample shape is owned by `OverlayContext`. */
export type OverlaySample = unknown;

/**
 * The flush to run when the HUD's session changed: the in-memory samples are
 * stale (they belong to the previous game) and must be written under their
 * own id. `null` when there is nothing out of place to flush.
 */
export function pendingFlush(
  owner: string | null,
  nextGameId: string | null,
  samples: OverlaySample[],
): HistorySnapshot | null {
  if (owner === null || owner === nextGameId) return null;
  if (samples.length === 0) return null;
  return { gameId: owner, samples };
}

/**
 * The throttled save, gated on ownership: only persist a window that belongs
 * to the session currently active, so a burst of samples that outlived its
 * game is never relabeled. `null` when the window is not the active game's.
 */
export function saveableSnapshot(
  owner: string | null,
  nextGameId: string | null,
  samples: OverlaySample[],
): HistorySnapshot | null {
  if (owner !== nextGameId) return null;
  if (owner === null) return null;
  if (samples.length === 0) return null;
  return { gameId: owner, samples };
}

/** A samples array capped to the rolling window the sparklines read. */
export function capHistory(
  samples: OverlaySample[],
  limit: number = OVERLAY_HISTORY_LIMIT,
): OverlaySample[] {
  return samples.length > limit ? samples.slice(samples.length - limit) : samples;
}
