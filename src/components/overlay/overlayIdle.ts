/** Idle-state decision for the overlay ticker. */
export type IdleAction = "none" | "dim" | "hide";

/**
 * Decide what the idle timer should do after `elapsedSeconds` without
 * activity. Hide wins over dim once both thresholds have passed; either timer
 * stays off while its threshold is 0.
 */
export function idleAction(
  elapsedSeconds: number,
  dimSeconds?: number,
  hideSeconds?: number,
): IdleAction {
  const dim = Math.max(0, dimSeconds ?? 0);
  const hide = Math.max(0, hideSeconds ?? 0);
  if (hide > 0 && elapsedSeconds >= hide) return "hide";
  if (dim > 0 && elapsedSeconds >= dim) return "dim";
  return "none";
}
