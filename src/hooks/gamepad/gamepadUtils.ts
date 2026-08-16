// gamepadUtils — pure helpers used by useGamepad's polling loop.
// ─────────────────────────────────────────────────────────────
//
// Lifted out of `useGamepad.ts` so the spatial-navigation geometry,
// virtual-mouse physics, and synthetic-event dispatchers can be
// unit-tested in isolation without React. The rAF loop itself
// stays in `useGamepad.ts` because its per-frame button-delta
// detection (`prevButtonsRef`) and ref-mutation patterns are
// tightly coupled and don't survive being split across hooks.
//
// Adding new constants? Add them next to the related function so
// the relationship between math and tuning lives in one place.

// ── Spatial-navigation geometry ─────────────────────────────────

export interface Point {
  x: number;
  y: number;
}

/** Center of an element's bounding rect in viewport coords. */
export function center(el: HTMLElement): Point {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Treat zero-area elements as not navigable. */
export function isVisible(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/**
 * Whether an element can take spatial-navigation focus. Superset of
 * `isVisible`: also rejects hidden/disconnected elements and disabled
 * or aria-disabled controls, so the focus ring never rests on a
 * non-actionable target and the A button can't activate a disabled
 * one. Shared by the spatial-nav picker and the focus registry.
 */
export function isNavigable(el: HTMLElement): boolean {
  if (!isVisible(el)) return false;
  if (el.hidden || !el.isConnected) return false;
  if (el.hasAttribute("disabled")) return false;
  if (el.getAttribute("aria-disabled") === "true") return false;
  return !(el as HTMLButtonElement).disabled;
}

// ── Directional-repeat timing ────────────────────────────────────
// Keyboard-style hold-to-repeat used by spatial navigation: after a
// new direction is engaged it fires once immediately, then waits
// `REPEAT_DELAY_MS` before the first repeat and repeats every
// `REPEAT_INTERVAL_MS` thereafter.

/** Initial delay before a held direction starts repeating (ms). */
export const REPEAT_DELAY_MS = 450;
/** Interval between repeats while a direction is held (ms). */
export const REPEAT_INTERVAL_MS = 110;

// ── Cycler / back-handler priorities ─────────────────────────────
// Higher priority wins; ties break by registration recency (newest
// wins). The shell-level (header / bottom-bar) tab cycler is
// deliberately the LOWEST so any page-level cycler mounted later can
// take over LB/RB. `CYCLER_PRIORITY_PAGE` is the default for
// `registerTabCycler` and `registerBackHandler`.

/** Priority for the persistent shell-level tab cycler (header). */
export const CYCLER_PRIORITY_SHELL = -100;
/** Default priority for page-level cyclers and back handlers. */
export const CYCLER_PRIORITY_PAGE = 0;

// ── Scroll margins ───────────────────────────────────────────────
// Used by `scrollElementIntoViewControlled` for the main vertical
// scroll parent. Top margin clears the 92px Big Screen header plus
// buffer; bottom margin clears the bottom bar plus buffer. These are
// exported so the layout lanes can reason about the same values.

/** Vertical scroll-parent inset above the focused element (px). */
export const SCROLL_MARGIN_TOP = 120;
/** Vertical scroll-parent inset below the focused element (px). */
export const SCROLL_MARGIN_BOTTOM = 48;

// ── Spatial-index tuning ────────────────────────────────────────
// The picker reads each candidate's rect exactly once per
// `nearestInDirection` call, then buckets centers into a coarse grid
// and scans only the sectors ahead of the press. `GRID_INDEX_THRESHOLD`
// is the candidate count above which the grid fast path engages (dense
// library/store grids); below it, a linear scan is cheaper than
// building the index.

/** Number of columns/rows in the coarse spatial grid. */
export const SPATIAL_GRID_SIZE = 10;
/** Candidate count above which the grid fast path engages. */
export const GRID_INDEX_THRESHOLD = 200;
/** Culling buffer as a multiple of viewport width/height. */
export const VIEWPORT_CULL_BUFFER = 1.25;

export interface FocusableCandidate {
  element: HTMLElement;
  onActivate: () => void;
}

/** Viewport rectangle helper (used to deprioritize off-screen items). */
function viewportRect(): { top: number; bottom: number; left: number; right: number } {
  return {
    top: 0,
    left: 0,
    bottom: typeof window !== "undefined" ? window.innerHeight : Infinity,
    right: typeof window !== "undefined" ? window.innerWidth : Infinity,
  };
}

/**
 * Internal candidate form used by the spatial-nav picker. Each entry
 * carries a single `getBoundingClientRect()` snapshot taken once per
 * `nearestInDirection` call — this is the perf-critical change: the old
 * code called `isNavigable()` + `center()` + a third bare rect read
 * (three forced synchronous layouts per candidate per input), which made
 * dense grids drop frames. One snapshot now feeds visibility, center,
 * and off-screen tests.
 */
interface IndexedCandidate {
  element: HTMLElement;
  onActivate: () => void;
  rect: { left: number; right: number; top: number; bottom: number };
  cx: number;
  cy: number;
}

/**
 * Spatial pre-pass: read every registered focusable's rect exactly once,
 * drop non-navigable / zero-area entries, and partition the survivors
 * into `near` (inside the viewport plus a generous buffer) and `far`
 * (beyond it). `near` is what the picker scans in the common case; `far`
 * is kept only as a last resort so focus can never get permanently stuck
 * on an empty screen. The buffer is wide enough that scroll-to-reveal
 * still works — the next screen of a grid is always within it.
 */
function indexCandidates(
  candidates: FocusableCandidate[],
  current: HTMLElement,
  viewport: { top: number; bottom: number; left: number; right: number },
): { near: IndexedCandidate[]; far: IndexedCandidate[] } {
  const bufX = (viewport.right - viewport.left) * VIEWPORT_CULL_BUFFER;
  const bufY = (viewport.bottom - viewport.top) * VIEWPORT_CULL_BUFFER;
  const top = viewport.top - bufY;
  const bottom = viewport.bottom + bufY;
  const left = viewport.left - bufX;
  const right = viewport.right + bufX;

  const near: IndexedCandidate[] = [];
  const far: IndexedCandidate[] = [];

  for (const entry of candidates) {
    const el = entry.element;
    if (el === current) continue;
    // Inlined `isNavigable` so the single rect read below also covers it.
    if (el.hidden || !el.isConnected) continue;
    if (el.hasAttribute("disabled")) continue;
    if (el.getAttribute("aria-disabled") === "true") continue;
    if ((el as HTMLButtonElement).disabled) continue;

    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;

    const indexed: IndexedCandidate = {
      element: el,
      onActivate: entry.onActivate,
      rect: { left: r.left, right: r.right, top: r.top, bottom: r.bottom },
      cx: r.left + r.width / 2,
      cy: r.top + r.height / 2,
    };

    const withinBuffer =
      r.bottom >= top && r.top <= bottom && r.right >= left && r.left <= right;
    (withinBuffer ? near : far).push(indexed);
  }

  return { near, far };
}

/**
 * Nearest-in-direction picker over already-indexed candidates.
 *
 *   • Skips the current element (already excluded by the index).
 *   • Picks the one whose center-to-center angle from `current`
 *     falls within `toleranceRad` of `dirAngle`.
 *   • Among the in-cone candidates, picks the nearest by a weighted
 *     distance that penalizes angular deviation AND cross-axis
 *     offset, so an element that is mostly "above" is clearly
 *     preferred over one that is mostly "up-and-way-to-the-right"
 *     when pressing UP — this is what keeps navigation from
 *     drifting sideways in dense grids.
 *   • Off-screen candidates are scored with a large penalty but
 *     still reachable as a last resort.
 *
 * Returned element is the closest "in the direction the user
 * pressed" — same heuristic the Xbox system UI uses for spatial
 * navigation.
 */
function findCandidate(
  cur: Point,
  current: HTMLElement,
  candidates: IndexedCandidate[],
  dirAngle: number,
  toleranceRad: number,
  viewport: { top: number; bottom: number; left: number; right: number },
): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestDist = Infinity;

  // Unit vector for the pressed direction — used to compute how far
  // the candidate lies *along* the press axis vs. how far it strays
  // *across* it (cross-axis error).
  const dirX = Math.cos(dirAngle);
  const dirY = Math.sin(dirAngle);

  for (const entry of candidates) {
    if (entry.element === current) continue;

    // Vector from current center to candidate center.
    const dx = entry.cx - cur.x;
    const dy = entry.cy - cur.y;

    // Skip candidates that are actually *behind* the press direction
    // (dot product <= 0 means no forward progress). This prevents
    // wrapping back to the element you just came from.
    const forward = dx * dirX + dy * dirY;
    if (forward <= 0) continue;

    const a = Math.atan2(dy, dx);

    // Normalize to (-π, π] for the shortest signed delta.
    let delta = a - dirAngle;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;

    if (Math.abs(delta) > toleranceRad) continue;

    // Cross-axis (perpendicular) offset — strongly penalized so a
    // press of UP lands on the nearest card *above*, not a far
    // diagonal one.
    const cross = Math.abs(dx * -dirY + dy * dirX);
    const sinDelta = Math.sin(delta);

    // Base distance along the forward axis.
    const dForward = Math.max(1, forward);

    // Weighted cost: prefer short forward distance + tight angle +
    // small cross-axis error. The cross-axis term is the key fix
    // for sideways drift in rails/grids.
    let cost = dForward * (1.0 + 2.0 * sinDelta * sinDelta) + cross * 1.5;

    // Large penalty for candidates fully outside the viewport so
    // on-screen items win, but off-screen targets remain reachable.
    const r = entry.rect;
    const offscreen =
      r.bottom < viewport.top ||
      r.top > viewport.bottom ||
      r.right < viewport.left ||
      r.left > viewport.right;
    if (offscreen) cost += 1_000_000;

    if (cost < bestDist) {
      bestDist = cost;
      best = entry.element;
    }
  }

  return best;
}

/**
 * Coarse spatial index used as a fast path for dense screens. When the
 * candidate set is large, bucketing centers into a fixed grid and only
 * scanning the sectors ahead of the current element skips the float math
 * for candidates that are clearly behind or far off-axis. Returns `null`
 * when the reduction is empty, so `nearestInDirection` falls back to the
 * exact full scan — this is an optimization, never a behavior change.
 */
function reduceByGrid(
  cur: Point,
  near: IndexedCandidate[],
  dirAngle: number,
  viewport: { top: number; bottom: number; left: number; right: number },
): IndexedCandidate[] | null {
  const width = viewport.right - viewport.left;
  const height = viewport.bottom - viewport.top;
  if (width <= 0 || height <= 0) return null;

  const cols = SPATIAL_GRID_SIZE;
  const rows = SPATIAL_GRID_SIZE;
  const cellW = width / cols;
  const cellH = height / rows;

  const grid = new Map<number, IndexedCandidate[]>();
  for (const c of near) {
    const col = Math.min(cols - 1, Math.max(0, Math.floor((c.cx - viewport.left) / cellW)));
    const row = Math.min(rows - 1, Math.max(0, Math.floor((c.cy - viewport.top) / cellH)));
    const key = row * cols + col;
    const bucket = grid.get(key);
    if (bucket) bucket.push(c);
    else grid.set(key, [c]);
  }

  const dirX = Math.cos(dirAngle);
  const dirY = Math.sin(dirAngle);
  // One full cell of backward margin, so a candidate whose center is
  // technically forward but whose *cell* center sits just behind the
  // half-plane is never dropped (cell granularity safety).
  const margin = Math.hypot(cellW, cellH);

  const reduced: IndexedCandidate[] = [];
  for (const [key, bucket] of grid) {
    const col = key % cols;
    const row = Math.floor(key / cols);
    const cellCx = viewport.left + (col + 0.5) * cellW;
    const cellCy = viewport.top + (row + 0.5) * cellH;
    const forward = (cellCx - cur.x) * dirX + (cellCy - cur.y) * dirY;
    if (forward > -margin) {
      for (const c of bucket) reduced.push(c);
    }
  }

  return reduced.length > 0 ? reduced : null;
}

export interface ScrollIntoViewOptions {
  /**
   * Use instant (`auto`) scrolling — passed during hold-to-repeat so
   * smooth scrolls don't queue up and lag behind rapid focus moves.
   */
  immediate?: boolean;
}

export function scrollElementIntoViewControlled(
  el: HTMLElement,
  opts: ScrollIntoViewOptions = {},
) {
  const behavior: ScrollBehavior = opts.immediate ? "auto" : "smooth";

  // 1. Find if `el` is inside a horizontal rail container
  const track = el.closest(".bigscreen-rail-track, .bigscreen-cards, .bigscreen-header-tabs, [data-rail-id]") as HTMLElement | null;
  if (track) {
    const cardRect = el.getBoundingClientRect();
    const trackRect = track.getBoundingClientRect();
    const offsetWithinContainer = cardRect.left - trackRect.left + track.scrollLeft;
    const desiredLeft = trackRect.width * 0.25;
    const delta = offsetWithinContainer - desiredLeft;
    if (Math.abs(delta) > 8) {
      track.scrollTo({
        left: Math.max(0, track.scrollLeft + delta),
        behavior,
      });
    }
  }

  // 2. Find the main vertical scroll container
  const scrollParent = getVerticalScrollParent(el);
  if (scrollParent) {
    const elRect = el.getBoundingClientRect();
    const parentRect = scrollParent.getBoundingClientRect();
    const topMargin = SCROLL_MARGIN_TOP; // Account for 92px header + buffer
    const bottomMargin = SCROLL_MARGIN_BOTTOM;

    if (elRect.top < parentRect.top + topMargin) {
      const diff = parentRect.top + topMargin - elRect.top;
      scrollParent.scrollTo({
        top: Math.max(0, scrollParent.scrollTop - diff),
        behavior,
      });
    } else if (elRect.bottom > parentRect.bottom - bottomMargin) {
      const diff = elRect.bottom - (parentRect.bottom - bottomMargin);
      scrollParent.scrollTo({
        top: scrollParent.scrollTop + diff,
        behavior,
      });
    }
  }
}

function getVerticalScrollParent(el: HTMLElement): HTMLElement | null {
  let parent = el.parentElement;
  while (parent && parent !== document.body && parent !== document.documentElement) {
    const style = window.getComputedStyle(parent);
    const overflowY = style.overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && parent.scrollHeight > parent.clientHeight) {
      return parent;
    }
    parent = parent.parentElement;
  }
  return document.documentElement;
}

/**
 * Nearest-in-direction picker.
 *
 *   • Reads every registered focusable's rect once and discards
 *     non-navigable / zero-area entries (collapsed menus, hidden
 *     modals) up front.
 *   • Prioritizes same-rail candidates during horizontal navigation so
 *     left/right stays within the active rail.
 *   • Performs a two-pass scan (first tight ±45° tolerance, then falling
 *     back to a wider ±85° tolerance if no candidates match) to avoid
 *     navigation getting stuck in complex grids.
 *   • Engages a coarse grid index for dense candidate sets so the scan
 *     skips sectors behind the press; the result is identical to the
 *     linear scan, which remains the fallback.
 *   • Keeps far-off-screen candidates as a final fallback so focus never
 *     gets permanently stuck.
 *
 * Returned element is the closest "in the direction the user
 * pressed".
 */
export function nearestInDirection(
  current: HTMLElement,
  candidates: FocusableCandidate[],
  dirAngle: number,
): HTMLElement | null {
  const cur = center(current);
  const viewport = viewportRect();

  const { near, far } = indexCandidates(candidates, current, viewport);

  // If current element is inside a horizontal rail, and user is pressing left/right,
  // prioritize candidates that are inside the same rail container.
  const currentTrack = current.closest(".bigscreen-rail-track, .bigscreen-cards, .bigscreen-header-tabs, [data-rail-id]");
  const isHorizontalMove = Math.abs(Math.cos(dirAngle)) > Math.abs(Math.sin(dirAngle));

  if (currentTrack && isHorizontalMove) {
    const sameTrackCandidates = near.filter((c) => currentTrack.contains(c.element));
    if (sameTrackCandidates.length > 0) {
      const sameTrackMatch = findCandidate(
        cur,
        current,
        sameTrackCandidates,
        dirAngle,
        (Math.PI / 180) * 45,
        viewport,
      );
      if (sameTrackMatch) return sameTrackMatch;
    }
  }

  // Fast path for dense screens: reduce to the forward sectors via the
  // grid index, then run the exact heuristic over the reduced set.
  const scanSet =
    near.length >= GRID_INDEX_THRESHOLD
      ? (reduceByGrid(cur, near, dirAngle, viewport) ?? near)
      : near;

  // First pass: tight tolerance, on-screen + off-screen allowed.
  const tightMatch = findCandidate(
    cur,
    current,
    scanSet,
    dirAngle,
    (Math.PI / 180) * 45,
    viewport,
  );
  if (tightMatch) return tightMatch;

  // Second pass fallback: wide tolerance (helps in sparse layouts
  // where nothing lands in the tight cone).
  const wideMatch = findCandidate(
    cur,
    current,
    scanSet,
    dirAngle,
    (Math.PI / 180) * 85,
    viewport,
  );
  if (wideMatch) return wideMatch;

  // Final fallback: candidates beyond the culling buffer (previously the
  // off-screen-with-penalty branch). Reachable only when nothing nearer
  // matches, so focus can never get stuck.
  if (far.length > 0) {
    return findCandidate(
      cur,
      current,
      far,
      dirAngle,
      (Math.PI / 180) * 85,
      viewport,
    );
  }

  return null;
}

// ── Virtual-mouse physics ───────────────────────────────────────

/** Past this fraction of stick deflection, the cursor starts moving. */
export const RIGHT_STICK_DEADZONE = 0.18;
/** Stick deflection below this is treated as zero for left stick too. */
export const STICK_DEADZONE = 0.2;

/** Fractional cursor-speed multiplier while the pointer is over a
 *  focusable element (magnetic "aim-assist" — see `isPointOverFocusable`). */
export const MAGNETIC_SLOWDOWN = 0.5;

// ── Deadzone auto-calibration ──────────────────────────────────
// On connect the engine samples the sticks' resting deflection for
// `DEADZONE_CALIBRATION_MS` and locks the deadzone just above the
// measured drift, so worn controllers don't phantom-navigate. A user
// override (Settings slider) takes precedence over the calibration.

/** How long to sample stick rest before locking the deadzone (ms). */
export const DEADZONE_CALIBRATION_MS = 500;
/** Floor for a calibrated/override deadzone — never below this. */
export const DEADZONE_MIN = 0.1;
/** Ceiling for a calibrated/override deadzone — never above this. */
export const DEADZONE_MAX = 0.5;
/** Extra headroom added above measured drift so noise never crosses. */
export const DEADZONE_DRIFT_MARGIN = 0.04;

export function clampDeadzone(value: number): number {
  if (!Number.isFinite(value)) return DEADZONE_MIN;
  return Math.min(DEADZONE_MAX, Math.max(DEADZONE_MIN, value));
}

/** Resolve the effective deadzone: a user override wins, otherwise the
 *  observed resting drift (plus margin) is calibrated and clamped. */
export function calibrateDeadzone(
  observedMaxAbs: number,
  userOverride: number | null,
): number {
  if (userOverride !== null) return clampDeadzone(userOverride);
  return clampDeadzone(observedMaxAbs * 1.3 + DEADZONE_DRIFT_MARGIN);
}

/** Cursor speed at the deadzone threshold (px/s). Slow & precise. */
export const VIRTUAL_MOUSE_MIN_SPEED = 250;
/** Cursor speed at full stick tilt (px/s). Fast cross-screen traverse. */
export const VIRTUAL_MOUSE_MAX_SPEED = 1800;

/**
 * Non-linear acceleration: speed = min + (max - min) * m^1.4.
 *
 * The 1.4 exponent gives a comfortable ramp so small stick deflection
 * is slow and precise (~250 px/s) and full tilt is fast
 * (~1800 px/s) without feeling twitchy in either regime.
 *
 * `m` is the magnitude in [0, 1] past the deadzone.
 */
export function virtualMouseSpeed(m: number): number {
  return (
    VIRTUAL_MOUSE_MIN_SPEED +
    (VIRTUAL_MOUSE_MAX_SPEED - VIRTUAL_MOUSE_MIN_SPEED) *
      Math.pow(Math.max(0, Math.min(1, m)), 1.4)
  );
}

/**
 * Magnetic "aim-assist" test: true when the cursor position lands inside
 * the bounding box of any registered focusable. The polling loop halves
 * the cursor speed while this is true, giving small targets a sticky,
 * console-like feel. Single rect read per candidate, early-out on hit.
 */
export function isPointOverFocusable(
  x: number,
  y: number,
  candidates: FocusableCandidate[],
): boolean {
  for (const { element } of candidates) {
    if (element.hidden || !element.isConnected) continue;
    if (element.hasAttribute("disabled")) continue;
    if (element.getAttribute("aria-disabled") === "true") continue;
    if ((element as HTMLButtonElement).disabled) continue;
    const r = element.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
  }
  return false;
}

/** Cap delta-time at 100 ms so a debugger pause can't teleport the cursor. */
export const MAX_FRAME_DT_SEC = 0.1;
/** First-frame Δt guess before the second poll tick has real timing. */
export const FIRST_FRAME_DT_MS = 16;

/** Trigger pulls past this fraction count as a press. */
export const TRIGGER_THRESHOLD = 0.4;

// ── Synthetic event dispatch ────────────────────────────────────

/**
 * Dispatch a synthetic MouseEvent on the topmost element at (x, y).
 * Used by the polling loop to translate gamepad inputs into click
 * events that the React tree already handles natively.
 */
export function dispatchMouse(
  type: "mousedown" | "mouseup" | "click" | "contextmenu" | "mousemove",
  x: number,
  y: number,
  button: number,
  leftDown = false,
  rightDown = false,
): void {
  if (typeof document === "undefined") return;
  const target = document.elementFromPoint(x, y);
  if (!target) return;

  let buttons = 0;
  if (leftDown) buttons |= 1;
  if (rightDown) buttons |= 2;

  if (type === "mousedown") {
    buttons |= (button === 0 ? 1 : button === 2 ? 2 : 0);
  } else if (type === "mouseup") {
    buttons &= ~(button === 0 ? 1 : button === 2 ? 2 : 0);
  }

  const init: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    view: window,
    button,
    buttons,
    clientX: x,
    clientY: y,
    screenX: x,
    screenY: y,
  };
  target.dispatchEvent(new MouseEvent(type, init));
}

/**
 * Dispatch a synthetic keyboard event to BOTH window and document.
 *
 * react-hotkeys, react-modal, dialog primitives, and Tauri-injected
 * keymaps split their listeners between window and document, so
 * firing on both is the only way to reliably reach every Escape
 * handler from a gamepad X button.
 */
export function dispatchKey(key: string): void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }
  const init: KeyboardEventInit = {
    key,
    bubbles: true,
    cancelable: true,
  };
  // Dispatch once on document. The event bubbles to window, reaching
  // listeners registered at either level without firing the same
  // Escape handler twice.
  document.dispatchEvent(new KeyboardEvent("keydown", init));
  document.dispatchEvent(new KeyboardEvent("keyup", init));
}