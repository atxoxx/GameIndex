/** Idle-state decision for the overlay ticker. */
export type IdleAction = "none" | "dim" | "hide";

/**
 * Decide what the idle timer should do after `elapsedSeconds` without
 * activity. Hide wins over dim once both thresholds have passed; either timer
 * stays off while its threshold is 0.
 *
 * `sessionActive` suspends the hide step: while a game runs the pointer and
 * keyboard belong to the game, so the HUD would otherwise vanish a few seconds
 * into every session and only come back on the toggle hotkey. Dimming is
 * cosmetic and keeps applying; once the session ends the hide threshold applies
 * again.
 */
export function idleAction(
  elapsedSeconds: number,
  dimSeconds?: number,
  hideSeconds?: number,
  sessionActive = false,
): IdleAction {
  const dim = Math.max(0, dimSeconds ?? 0);
  const hide = sessionActive ? 0 : Math.max(0, hideSeconds ?? 0);
  if (hide > 0 && elapsedSeconds >= hide) return "hide";
  if (dim > 0 && elapsedSeconds >= dim) return "dim";
  return "none";
}
