// VirtualCursor — portal-based overlay that renders the on-screen
// virtual mouse pointer driven by the right stick. Renders only when
// the cursor is visible (auto-shown by stick motion, toggled by Y,
// hidden by L3 or gamepad disconnect).
//
// Design choices for ergonomics:
//   • 24×24 px pointer SVG with a 4 px hot-spot ring so users know
//     where the "click" lands even at a glance.
//   • Gentle breathing pulse when idle (opacity 0.7 → 0.85 → 0.7)
//     so the cursor is locatable without being noisy.
//   • Idle fade: opacity drops to 0.45 after 2.5 s of inactiv ity so
//     the cursor doesn't visually compete with on-screen content
//     while the user is reading.
//   • Drag indicator: an outer ring fills to 60 % opacity while RT/LT
//     is held, providing tactile feedback that a click-and-drag is
//     in flight.
//   • `pointer-events: none` so the cursor never swallows real mouse
//     events; clicks are dispatched programmatically from the
//     polling loop.
//
// Reduced motion: the breathing pulse is suppressed when the user
// has prefers-reduced-motion enabled.

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { GamepadState } from "../../hooks/useGamepad";

interface VirtualCursorProps {
  gamepad: GamepadState;
}

const IDLE_FADE_MS = 2500;
const MIN_OPACITY = 0.45;
const IDLE_BREATH_OPACITY = 0.85;
const ACTIVE_OPACITY = 1.0;
const DRAG_OPACITY = 0.7;
const PRESS_FLASH_MS = 160;

/** Anything a click could usefully land on — drives the `--target` glow. */
const CLICKABLE_SELECTOR =
  "button, a, input, select, textarea, [role='button'], [role='link'], [tabindex], [data-focus-key]";

/**
 * Smooth cursor motion via rAF. The state value comes from the
 * polling loop at 60 Hz (or whatever the display refresh is), so
 * interpolation isn't strictly needed — but we rAF-update anyway so
 * the position can track sub-frame changes (window resize, etc.)
 * without forcing a VirtualCursor re-render at every poll tick.
 *
 * The visual transform is `translate3d(x, y, 0)` centred on the polled
 * point — the ring's middle, not its corner, is where a press lands.
 * Coupled with the smooth CSS transition on the `<div
 * class="virtual-cursor">` element, the motion feels continuous even
 * though the poll only updates state.
 */
export default function VirtualCursor({ gamepad }: VirtualCursorProps) {
  const cursorRef = useRef<HTMLDivElement | null>(null);
  const virtualMouseRef = useRef(gamepad.virtualMouse);
  virtualMouseRef.current = gamepad.virtualMouse;
  const lastRenderRef = useRef<{ x: number; y: number; ts: number }>({
    x: -1,
    y: -1,
    ts: 0,
  });
  // Half the rendered box, measured once so the pointer is centred on the
  // click point. Cached to avoid a layout read on every frame.
  const halfRef = useRef(13);

  // Idle fade tracking — separate from x/y because we want the
  // breathing idle pulse to keep ticking on the render thread even
  // when the cursor hasn't moved.
  const fadeRef = useRef<number>(0); // 1.0 = full opacity, 0 = min

  useEffect(() => {
    // Park the element and stop the frame loop while the cursor is hidden.
    // An idle Big Screen session should not run an rAF loop just to keep an
    // invisible pointer in sync; `virtualMouse.visible` flips back on and
    // re-runs this effect the moment the pad shows the cursor.
    if (!gamepad.virtualMouse.visible) {
      const el = cursorRef.current;
      if (el) {
        el.style.display = "none";
        el.style.opacity = "0";
      }
      return;
    }

    let rafId: number;
    // Track visibility so we can fully hide the element (display:none)
    // whenever the cursor is toggled off — an opacity-only fade left
    // the pointer visible at its last opacity after an L3 hide.
    let lastVisible: boolean | null = null;

    function tick() {
      const cur = virtualMouseRef.current;
      if (typeof document === "undefined") {
        rafId = requestAnimationFrame(tick);
        return;
      }

      const el = cursorRef.current;

      // ── Hide the cursor when not visible ───────────────────
      if (!cur.visible) {
        if (el && lastVisible !== false) {
          el.style.display = "none";
          el.style.opacity = "0";
          lastVisible = false;
        }
        rafId = requestAnimationFrame(tick);
        return;
      }

      if (!el) {
        rafId = requestAnimationFrame(tick);
        return;
      }

      if (lastVisible !== true) {
        el.style.display = "block";
        // Reveal instantly so removing the L3 hide doesn't animate
        // from a stale opacity.
        el.style.opacity = String(ACTIVE_OPACITY);
        fadeRef.current = ACTIVE_OPACITY;
        lastVisible = true;
        halfRef.current = (el.offsetWidth || 26) / 2;
      }

      // ── Cursor position update via transform ────────────────
      const moved =
        cur.x !== lastRenderRef.current.x || cur.y !== lastRenderRef.current.y;
      if (moved) {
        const half = halfRef.current;
        el.style.transform = `translate3d(${cur.x - half}px, ${cur.y - half}px, 0)`;
        lastRenderRef.current = { x: cur.x, y: cur.y, ts: performance.now() };
      }
      // ── Opacity (idle fade + drag indicator) ─────────────
      const now = performance.now();
      const idleMs = now - cur.lastInputMs;
      const isDragging = cur.leftDown || cur.rightDown;

      let target: number;
      if (isDragging || cur.moving) {
        target = ACTIVE_OPACITY;
      } else if (idleMs < IDLE_FADE_MS) {
        // Gentle breathing pulse when recently active but not moving.
        target = IDLE_BREATH_OPACITY;
      } else {
        target = MIN_OPACITY;
      }

      // Smooth the opacity change over ~120 ms for a soft transition.
      const prev = fadeRef.current;
      const next = prev + (target - prev) * 0.18;
      fadeRef.current = next;
      el.style.opacity = String(next);

      // Drag ring pulse — toggles a secondary class for the
      // outer ring's animated glow during click-and-drag.
      el.classList.toggle("virtual-cursor--dragging", isDragging);
      if (isDragging) el.style.setProperty("--drag-opacity", String(DRAG_OPACITY));

      // Any press (A click, or a held trigger) flashes the squash state so
      // every click has visible feedback, even on a plain div target.
      const pressed =
        isDragging || now - cur.lastClickMs < PRESS_FLASH_MS;
      el.classList.toggle("virtual-cursor--pressed", pressed);

      // Target affordance: only re-probe when the pointer actually moved
      // (elementFromPoint forces a hit test), so an idle cursor costs
      // nothing.
      if (moved && typeof document !== "undefined") {
        const hit = document.elementFromPoint(cur.x, cur.y);
        el.classList.toggle(
          "virtual-cursor--target",
          !!hit && hit.closest(CLICKABLE_SELECTOR) !== null,
        );
      }

      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [gamepad.virtualMouse.visible]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={cursorRef}
      className="virtual-cursor"
      style={{ opacity: 0, display: "none" }}
      aria-hidden="true"
    >
      <div className="virtual-cursor-body" />
      <div className="virtual-cursor-hot" />
      <div className="virtual-cursor-ring virtual-cursor-ring--drag" />
    </div>,
    document.body,
  );
}
