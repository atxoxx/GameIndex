// useGamepad — pure-TypeScript hook that polls the Gamepad API via
// requestAnimationFrame. Handles:
//
//   • Spatial navigation (D-pad / left stick → registered focusables
//     selected by center+angular proximity with ±45° tolerance).
//   • Face buttons (A/B/X/Y) for activate / back / Escape / virtual-
//     mouse toggle.
//   • Bumpers (LB/RB) → cycle BigScreenNav tabs.
//   • Triggers (LT/RT) → press-and-hold left/right mouse for click-
//     and-drag interactions.
//   • Stick clicks (L3/R3, W3C indices 10/11) → hide cursor /
//     recenter cursor.
//   • Start (W3C index 9) → edge-triggered `bigscreen:start`
//     CustomEvent (the shell listens for it to open the System hub).
//   • Virtual mouse pointer (right stick → on-screen cursor with
//     non-linear acceleration + deadzone), used alongside spatial
//     navigation so non-focusable surfaces (sliders, drag handles,
//     custom controls) remain reachable from the couch.
//
// This file is deliberately `.ts` (no JSX). The React context
// provider that wraps this hook lives in `./GamepadProvider.tsx`.
//
// Consumers:
//   • `useGamepad()` from `./GamepadProvider` returns the shared
//     singleton state: `{ connected, focusedElement, registerAction,
//     virtualMouse, toggleVirtualMouse, recenterVirtualMouse,
//     registerTabCycler, registerBackHandler }`.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  nearestInDirection,
  scrollElementIntoViewControlled,
  dispatchMouse,
  dispatchKey,
  virtualMouseSpeed,
  RIGHT_STICK_DEADZONE,
  STICK_DEADZONE,
  TRIGGER_THRESHOLD,
  MAX_FRAME_DT_SEC,
  FIRST_FRAME_DT_MS,
  REPEAT_DELAY_MS,
  REPEAT_INTERVAL_MS,
  CYCLER_PRIORITY_PAGE,
  isNavigable,
} from "./gamepad/gamepadUtils";
import { isBigScreenOverlayOpen } from "../context/BigScreenContext";

// ── Types ───────────────────────────────────────────────────────

export interface FocusableEntry {
  element: HTMLElement;
  onActivate: () => void;
}

export interface VirtualMouseState {
  /** User has the cursor visible (stick motion or Y-toggle). */
  visible: boolean;
  /** Viewport X position of the cursor (px). */
  x: number;
  /** Viewport Y position of the cursor (px). */
  y: number;
  /** RT analog trigger is past the click threshold. */
  leftDown: boolean;
  /** LT analog trigger is past the click threshold. */
  rightDown: boolean;
  /** Right stick reported motion in the last frame (drives fade). */
  moving: boolean;
  /** performance.now() of last stick motion. Drives idle fade. */
  lastInputMs: number;
}

export interface GamepadState {
  /** Whether at least one gamepad is connected. */
  connected: boolean;
  /** The currently focused element, or null if nothing is focused. */
  focusedElement: HTMLElement | null;
  /**
   * Register a focusable element. Returns an unregister function.
   */
  registerAction: (element: HTMLElement, onActivate: () => void) => () => void;
  /** Virtual mouse pointer state (driven by right stick + triggers). */
  virtualMouse: VirtualMouseState;
  /** Toggle the virtual mouse cursor (Y button or programmatic). */
  toggleVirtualMouse: () => void;
  /** Recenter the virtual cursor to viewport center (R3 / programmatic). */
  recenterVirtualMouse: () => void;
  /**
   * Register a BigScreenNav tab cycler (LB/RB). The handler is
   * invoked with 'forward' on RB press and 'back' on LB press.
   * Returns an unregister function. Only one cycler is active at a
   * time — among equal priorities the last-registered wins.
   */
  registerTabCycler: (
    fn: (direction: "forward" | "back") => void,
    priority?: number,
  ) => () => void;
  /**
   * Register a back handler (B button). The top-priority handler is
   * invoked on B press. Returns an unregister function. Only one
   * handler is active at a time — among equal priorities the
   * last-registered wins. If no handler is registered, or a Big
   * Screen overlay is open, B falls through to keyboard Escape.
   */
  registerBackHandler: (fn: () => void, priority?: number) => () => void;
}

// ── Constants ───────────────────────────────────────────────────
// Loop-level constants stay here (per-frame, not math-tuning):

// ── Hook ────────────────────────────────────────────────────────

/**
 * Internal hook used by GamepadProvider. Exported so GamepadProvider
 * can consume it, but external consumers should use `useGamepad()`
 * from `./GamepadProvider` to get the shared singleton state.
 */
export function useGamepadInternal(enabled: boolean): GamepadState {
  const entriesRef = useRef<FocusableEntry[]>([]);
  const focusedRef = useRef<HTMLElement | null>(null);
  const [connected, setConnected] = useState(false);
  const connectedRef = useRef(false);
  const [focusedElement, setFocusedElement] = useState<HTMLElement | null>(
    null,
  );

  // ── Virtual mouse references ─────────────────────────────────
  const virtualMouseRef = useRef<VirtualMouseState>({
    visible: false,
    x: typeof window !== "undefined" ? window.innerWidth / 2 : 0,
    y: typeof window !== "undefined" ? window.innerHeight / 2 : 0,
    leftDown: false,
    rightDown: false,
    moving: false,
    lastInputMs: 0,
  });
  const lastPublishedVMRef = useRef<VirtualMouseState>({ ...virtualMouseRef.current });
  const [virtualMouse, setVirtualMouse] = useState<VirtualMouseState>(
    () => ({ ...virtualMouseRef.current }),
  );
  const gamepadStateRef = useRef<GamepadState | null>(null);

  // Tab cycler subscription (BigScreenNav uses this for LB/RB).
  // Each entry carries a monotonic `seq` so that among equal
  // priorities the MOST RECENTLY registered cycler wins — this is
  // what lets a page-level cycler (e.g. a game page mounted later)
  // reliably take over from a persistent shell cycler without
  // relying on registration order.
  const tabCyclersRef = useRef<
    {
      fn: (direction: "forward" | "back") => void;
      priority: number;
      seq: number;
    }[]
  >([]);
  const tabCyclerSeqRef = useRef(0);

  // ── Polling-loop state refs ────────────────────────────────
  const holdDirectionRef = useRef<{ h: number; v: number } | null>(null);
  const holdStartRef = useRef<number>(0);
  const lastRepeatRef = useRef<number>(0);
  const prevRightAxesRef = useRef<{ h: number; v: number }>({ h: 0, v: 0 });
  const prevButtonsRef = useRef<{
    a: boolean;
    b: boolean;
    x: boolean;
    y: boolean;
    lb: boolean;
    rb: boolean;
    rt: boolean;
    lt: boolean;
    r3: boolean;
    l3: boolean;
    start: boolean;
  }>({
    a: false,
    b: false,
    x: false,
    y: false,
    lb: false,
    rb: false,
    rt: false,
    lt: false,
    r3: false,
    l3: false,
    start: false,
  });
  const lastFrameTimeRef = useRef(0);

  // ── Register / unregister focusables ───────────────────────
  const registerAction = useCallback(
    (element: HTMLElement, onActivate: () => void): (() => void) => {
      const entry: FocusableEntry = { element, onActivate };
      entriesRef.current.push(entry);

      const setFocusedInRegistry = () => {
        if (!isNavigable(element)) return;
        if (focusedRef.current === element) return;
        if (focusedRef.current) {
          focusedRef.current.removeAttribute("data-focused");
        }
        focusedRef.current = element;
        element.setAttribute("data-focused", "true");
        setFocusedElement(element);
      };

      // Add listeners to sync focus state when focused or hovered
      element.addEventListener("focus", setFocusedInRegistry);
      element.addEventListener("mousedown", setFocusedInRegistry);
      element.addEventListener("mouseenter", setFocusedInRegistry);

      if (!focusedRef.current && isNavigable(element)) {
        focusedRef.current = element;
        element.setAttribute("data-focused", "true");
        setFocusedElement(element);
      }

      return () => {
        element.removeEventListener("focus", setFocusedInRegistry);
        element.removeEventListener("mousedown", setFocusedInRegistry);
        element.removeEventListener("mouseenter", setFocusedInRegistry);

        entriesRef.current = entriesRef.current.filter(
          (e) => e.element !== element,
        );
        element.removeAttribute("data-focused");
        if (focusedRef.current === element) {
          const next = entriesRef.current.find((candidate) =>
            isNavigable(candidate.element),
          );
          focusedRef.current = next?.element ?? null;
          if (focusedRef.current) focusedRef.current.setAttribute("data-focused", "true");
          setFocusedElement(focusedRef.current);
        }
      };
    },
    [],
  );

  // ── Toggle virtual cursor visibility (Y button or programmatic) ─
  const toggleVirtualMouse = useCallback(() => {
    const next = {
      ...virtualMouseRef.current,
      visible: !virtualMouseRef.current.visible,
      lastInputMs: performance.now(),
    };
    virtualMouseRef.current = next;
    lastPublishedVMRef.current = next;
    setVirtualMouse(next);
  }, []);

  // ── Recenter virtual cursor (R3 button or programmatic) ─────
  const recenterVirtualMouse = useCallback(() => {
    const next = {
      ...virtualMouseRef.current,
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
      visible: true,
      lastInputMs: performance.now(),
    };
    virtualMouseRef.current = next;
    lastPublishedVMRef.current = next;
    setVirtualMouse(next);
  }, []);

  // ── Register tab cycler for BigScreenNav LB/RB ─────────────
  const registerTabCycler = useCallback(
    (
      fn: (direction: "forward" | "back") => void,
      priority = CYCLER_PRIORITY_PAGE,
    ): (() => void) => {
      const entry = {
        fn,
        priority,
        seq: ++tabCyclerSeqRef.current,
      };
      tabCyclersRef.current.push(entry);
      // Sort descending by priority so the highest priority is first;
      // ties are broken by registration recency (newest wins). The
      // active cycler is always tabCyclersRef.current[0].
      tabCyclersRef.current.sort(
        (a, b) => b.priority - a.priority || b.seq - a.seq,
      );
      return () => {
        tabCyclersRef.current = tabCyclersRef.current.filter((x) => x !== entry);
      };
    },
    [],
  );

  // ── Back-handler subscription (B button) ────────────────────
  // Same sorted-registry mechanics as the tab cycler: descending
  // priority, then registration recency (newest wins). The active
  // back handler is always backHandlersRef.current[0].
  const backHandlersRef = useRef<
    {
      fn: () => void;
      priority: number;
      seq: number;
    }[]
  >([]);
  const backHandlerSeqRef = useRef(0);

  const registerBackHandler = useCallback(
    (fn: () => void, priority = CYCLER_PRIORITY_PAGE): (() => void) => {
      const entry = {
        fn,
        priority,
        seq: ++backHandlerSeqRef.current,
      };
      backHandlersRef.current.push(entry);
      backHandlersRef.current.sort(
        (a, b) => b.priority - a.priority || b.seq - a.seq,
      );
      return () => {
        backHandlersRef.current = backHandlersRef.current.filter(
          (x) => x !== entry,
        );
      };
    },
    [],
  );

  // ── Polling loop ────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) {
      connectedRef.current = false;
      setConnected(false);
      return;
    }

    // Reset the per-frame timestamp so the FIRST rAF tick after a
    // reconnect (or initial mount) computes a sensible Δt. Without
    // this, `lastFrameTimeRef.current` retains a stale timestamp
    // and `dtMs` becomes a large value that a single frame would
    // then cap at MAX_FRAME_DT_SEC — teleporting the cursor ~180px
    // on the first frame after reconnect.
    lastFrameTimeRef.current = 0;

    // When the window enters/exits fullscreen (or is otherwise
    // resized) the viewport dimensions change, so the saved cursor
    // position may land outside the new viewport (e.g. below the
    // Windows taskbar area that fullscreen now covers). Re-clamp it
    // on every resize so the pointer snaps back on-screen.
    function onResize() {
      const vm = virtualMouseRef.current;
      const maxX = typeof window !== "undefined" ? window.innerWidth : vm.x;
      const maxY = typeof window !== "undefined" ? window.innerHeight : vm.y;
      const nx = Math.max(0, Math.min(maxX, vm.x));
      const ny = Math.max(0, Math.min(maxY, vm.y));
      if (nx !== vm.x || ny !== vm.y) {
        vm.x = nx;
        vm.y = ny;
        publishVirtualMouse();
      }
    }
    window.addEventListener("resize", onResize);

    let rafId: number;

    function publishVirtualMouse(force = false): void {
      const cur = virtualMouseRef.current;
      const prev = lastPublishedVMRef.current;
      if (
        force ||
        prev.visible !== cur.visible ||
        prev.x !== cur.x ||
        prev.y !== cur.y ||
        prev.leftDown !== cur.leftDown ||
        prev.rightDown !== cur.rightDown ||
        prev.moving !== cur.moving
      ) {
        lastPublishedVMRef.current = { ...cur };
        setVirtualMouse({ ...cur });
      }
    }

    function poll(timestamp: number) {
      const gamepads = navigator.getGamepads?.() ?? [];
      const gp = gamepads[0];

      // ── Disconnect cleanup ─────────────────────────────────
      if (!gp || !gp.connected) {
        if (connectedRef.current) {
          connectedRef.current = false;
          setConnected(false);
          const cur = virtualMouseRef.current;
          if (cur.leftDown) {
            dispatchMouse("mouseup", cur.x, cur.y, 0, false, cur.rightDown);
          }
          if (cur.rightDown) {
            dispatchMouse("mouseup", cur.x, cur.y, 2, cur.leftDown, false);
          }
          cur.visible = false;
          cur.leftDown = false;
          cur.rightDown = false;
          cur.moving = false;
          publishVirtualMouse();
        }
        lastFrameTimeRef.current = timestamp;
        rafId = requestAnimationFrame(poll);
        return;
      }

      if (!connectedRef.current) {
        connectedRef.current = true;
        setConnected(true);
      }

      // Δt for frame-rate-independent stick motion. Capped so a
      // stall (debugger / tab switch) doesn't fly the cursor
      // across the screen.
      const dtMs = lastFrameTimeRef.current
        ? timestamp - lastFrameTimeRef.current
        : FIRST_FRAME_DT_MS;
      lastFrameTimeRef.current = timestamp;
      const dtSec = Math.min(dtMs / 1000, MAX_FRAME_DT_SEC);
      const now = performance.now();

      // ── LEFT STICK / D-PAD → spatial navigation ────────────
      let leftH = 0;
      let leftV = 0;
      if (gp.buttons[12]?.pressed) leftV = -1;
      if (gp.buttons[13]?.pressed) leftV = 1;
      if (gp.buttons[14]?.pressed) leftH = -1;
      if (gp.buttons[15]?.pressed) leftH = 1;
      if (Math.abs(gp.axes[0]) > STICK_DEADZONE) leftH = gp.axes[0];
      if (Math.abs(gp.axes[1]) > STICK_DEADZONE) leftV = gp.axes[1];

      // Discrete direction based on thresholds
      let dirH = 0;
      let dirV = 0;
      if (gp.buttons[14]?.pressed || leftH < -STICK_DEADZONE) dirH = -1;
      else if (gp.buttons[15]?.pressed || leftH > STICK_DEADZONE) dirH = 1;

      if (gp.buttons[12]?.pressed || leftV < -STICK_DEADZONE) dirV = -1;
      else if (gp.buttons[13]?.pressed || leftV > STICK_DEADZONE) dirV = 1;

      const hasInput = dirH !== 0 || dirV !== 0;
      let shouldNavigate = false;

      if (!hasInput) {
        // Neutral state: reset hold tracking
        holdDirectionRef.current = null;
        holdStartRef.current = 0;
        lastRepeatRef.current = 0;
      } else {
        const prevHold = holdDirectionRef.current;
        const isNewDirection = !prevHold || prevHold.h !== dirH || prevHold.v !== dirV;

        if (isNewDirection) {
          shouldNavigate = true;
          holdDirectionRef.current = { h: dirH, v: dirV };
          holdStartRef.current = now;
          lastRepeatRef.current = now;
        } else {
          // Keyboard-like repeat: REPEAT_DELAY_MS delay, then repeat
          // every REPEAT_INTERVAL_MS (see gamepadUtils).
          const holdTime = now - holdStartRef.current;
          if (holdTime >= REPEAT_DELAY_MS) {
            const timeSinceLastRepeat = now - lastRepeatRef.current;
            if (timeSinceLastRepeat >= REPEAT_INTERVAL_MS) {
              shouldNavigate = true;
              lastRepeatRef.current = now;
            }
          }
        }
      }

      // Any spatial-navigation press (D-pad / left stick, including
      // hold-to-repeat) hides the virtual cursor — Steam behavior:
      // starting to navigate with the stick makes the pointer
      // disappear; Y re-enables it. The cursor is never revealed by
      // spatial input, only by R3 / Y / programmatic calls.
      if (shouldNavigate) {
        const curVm = virtualMouseRef.current;
        if (curVm.visible) {
          curVm.visible = false;
          curVm.moving = false;
        }
      }

      if (shouldNavigate && focusedRef.current) {
        const entries = entriesRef.current;
        if (entries.length > 1) {
          const dirAngle = Math.atan2(dirV, dirH);
          const next = nearestInDirection(
            focusedRef.current,
            entries,
            dirAngle,
          );
          if (next && next !== focusedRef.current) {
            focusedRef.current.removeAttribute("data-focused");
            focusedRef.current = next;
            next.setAttribute("data-focused", "true");
            scrollElementIntoViewControlled(next);
            setFocusedElement(next);
            next.focus({ preventScroll: true });
          }
        }
      }

      const vm = virtualMouseRef.current;

      // ── RIGHT STICK → virtual cursor movement ───────────────
      // Non-linear acceleration combines both axes for a single
      // magnitude so a diagonal push doesn't compound into faster
      // movement than a straight push.
      const rightH = gp.axes[2] ?? 0;
      const rightV = gp.axes[3] ?? 0;
      const len = Math.sqrt(rightH * rightH + rightV * rightV);
      let vx = 0;
      let vy = 0;

      if (len > RIGHT_STICK_DEADZONE) {
        const m = Math.min(1, (len - RIGHT_STICK_DEADZONE) / (1 - RIGHT_STICK_DEADZONE));
        const speed = virtualMouseSpeed(m);
        vx = (rightH / len) * speed;
        vy = (rightV / len) * speed;
      }

      // The right stick is deliberately a separate pointer mode. It
      // never steals focus navigation by revealing the cursor on its
      // own; press Y (or use the shell's pointer toggle) first.
      if (vm.visible && (vx !== 0 || vy !== 0)) {
        vm.moving = true;
        vm.lastInputMs = now;
        vm.x = Math.max(0, Math.min(window.innerWidth, vm.x + vx * dtSec));
        vm.y = Math.max(
          0,
          Math.min(window.innerHeight, vm.y + vy * dtSec),
        );
        dispatchMouse("mousemove", vm.x, vm.y, 0, vm.leftDown, vm.rightDown);
      } else {
        vm.moving = false;
      }
      prevRightAxesRef.current = { h: rightH, v: rightV };

      // ── A button (index 0) → click at cursor (if visible) or ──
      //    activate focused element (legacy mode).
      const aPressed = gp.buttons[0]?.pressed ?? false;
      if (aPressed && !prevButtonsRef.current.a) {
        if (vm.visible) {
          const target = document.elementFromPoint(vm.x, vm.y);
          if (target) {
            dispatchMouse("mousedown", vm.x, vm.y, 0, true, vm.rightDown);
            dispatchMouse("mouseup", vm.x, vm.y, 0, false, vm.rightDown);
            dispatchMouse("click", vm.x, vm.y, 0, false, vm.rightDown);

            // Sync gamepad focus state to the clicked element if it is registered
            const registeredEntry = entriesRef.current.find(
              (entry) => entry.element === target || entry.element.contains(target)
            );
            if (registeredEntry) {
              if (focusedRef.current && focusedRef.current !== registeredEntry.element) {
                focusedRef.current.removeAttribute("data-focused");
              }
              focusedRef.current = registeredEntry.element;
              registeredEntry.element.setAttribute("data-focused", "true");
              setFocusedElement(registeredEntry.element);
              registeredEntry.element.focus({ preventScroll: true });
            }
          }
          vm.lastInputMs = now;
        } else if (focusedRef.current) {
          const entry = entriesRef.current.find(
            (e) => e.element === focusedRef.current,
          );
          if (entry && isNavigable(entry.element)) entry.onActivate();
        }
      }
      prevButtonsRef.current.a = aPressed;

      // ── B button (index 1) → back --------------------------
      // If a Big Screen overlay (role=dialog / data-bigscreen-overlay)
      // is open, it owns Back and closes itself via Escape. Otherwise
      // the top-priority registered back handler (if any) takes
      // precedence — page components register one to go back one
      // level. If nothing claimed it, dispatch Escape so the shell's
      // global handler can exit Big Screen.
      const bPressed = gp.buttons[1]?.pressed ?? false;
      if (bPressed && !prevButtonsRef.current.b) {
        if (isBigScreenOverlayOpen()) {
          dispatchKey("Escape");
        } else {
          const activeBack = backHandlersRef.current[0];
          if (activeBack) {
            activeBack.fn();
          } else {
            dispatchKey("Escape");
          }
        }
      }
      prevButtonsRef.current.b = bPressed;

      // ── X button (index 2) → keyboard Escape (overlays only) ──
      // Closes dialogs/popovers/modals that listen for Escape, even
      // when the cursor can't easily reach their corner X button.
      // Gated exactly like B: X only dispatches Escape while an
      // overlay (role=dialog / data-bigscreen-overlay) owns Back. On
      // regular pages, going back is owned by the registered back
      // handler (game page, store detail, mods, emulators, docs) or
      // the shell exit — dispatching Escape there would exit the
      // entire Big Screen instead of going back one level.
      const xPressed = gp.buttons[2]?.pressed ?? false;
      if (xPressed && !prevButtonsRef.current.x) {
        if (isBigScreenOverlayOpen()) {
          dispatchKey("Escape");
        }
      }
      prevButtonsRef.current.x = xPressed;

      // ── Y button (index 3) → toggle virtual cursor visibility
      const yPressed = gp.buttons[3]?.pressed ?? false;
      if (yPressed && !prevButtonsRef.current.y) {
        vm.visible = !vm.visible;
        vm.lastInputMs = now;
      }
      prevButtonsRef.current.y = yPressed;

      // ── LB (button 4) → BigScreenNav cycle back ────────────
      // Gated: while an overlay (dialog / search surface) is open,
      // bumpers must not cycle the tab sections behind it.
      const lbPressed = gp.buttons[4]?.pressed ?? false;
      if (lbPressed && !prevButtonsRef.current.lb) {
        if (!isBigScreenOverlayOpen()) {
          const activeCycler = tabCyclersRef.current[0];
          if (activeCycler) activeCycler.fn("back");
        }
      }
      prevButtonsRef.current.lb = lbPressed;

      // ── RB (button 5) → BigScreenNav cycle forward ─────────
      const rbPressed = gp.buttons[5]?.pressed ?? false;
      if (rbPressed && !prevButtonsRef.current.rb) {
        if (!isBigScreenOverlayOpen()) {
          const activeCycler = tabCyclersRef.current[0];
          if (activeCycler) activeCycler.fn("forward");
        }
      }
      prevButtonsRef.current.rb = rbPressed;

      // ── LT (button 6) → hold right mouse button ────────────
      // Triggers are analog: value 0..1. Use the value field when
      // present so analog-actuated clicks (light tap → right click)
      // also fire. Falls back to `pressed` boolean for digital-only
      // controllers (e.g. 8BitDo SN30).
      const ltRaw = gp.buttons[6]?.value ?? (gp.buttons[6]?.pressed ? 1 : 0);
      const ltPressed = ltRaw > TRIGGER_THRESHOLD;
      if (ltPressed && !prevButtonsRef.current.lt) {
        if (vm.visible) {
          dispatchMouse("mousedown", vm.x, vm.y, 2, vm.leftDown, true);
          dispatchMouse("contextmenu", vm.x, vm.y, 2, vm.leftDown, true);
          vm.rightDown = true;
          vm.lastInputMs = now;
        }
      } else if (!ltPressed && prevButtonsRef.current.lt) {
        if (vm.visible && vm.rightDown) {
          dispatchMouse("mouseup", vm.x, vm.y, 2, vm.leftDown, false);
          vm.rightDown = false;
        }
      }
      prevButtonsRef.current.lt = ltPressed;

      // ── RT (button 7) → hold left mouse button ─────────────
      const rtRaw = gp.buttons[7]?.value ?? (gp.buttons[7]?.pressed ? 1 : 0);
      const rtPressed = rtRaw > TRIGGER_THRESHOLD;
      if (rtPressed && !prevButtonsRef.current.rt) {
        if (vm.visible) {
          dispatchMouse("mousedown", vm.x, vm.y, 0, true, vm.rightDown);
          vm.leftDown = true;
          vm.lastInputMs = now;
        }
      } else if (!rtPressed && prevButtonsRef.current.rt) {
        if (vm.visible && vm.leftDown) {
          dispatchMouse("mouseup", vm.x, vm.y, 0, false, vm.rightDown);
          vm.leftDown = false;
        }
      }
      prevButtonsRef.current.rt = rtPressed;

      // ── L3 (left-stick click, W3C index 10) → hide cursor ──
      // Releases any held mouse buttons so drag operations don't
      // get stuck if the user hides the cursor mid-drag.
      const l3Pressed = gp.buttons[10]?.pressed ?? false;
      if (l3Pressed && !prevButtonsRef.current.l3) {
        if (vm.leftDown) dispatchMouse("mouseup", vm.x, vm.y, 0, false, vm.rightDown);
        if (vm.rightDown) dispatchMouse("mouseup", vm.x, vm.y, 2, vm.leftDown, false);
        vm.leftDown = false;
        vm.rightDown = false;
        vm.visible = false;
      }
      prevButtonsRef.current.l3 = l3Pressed;

      // ── R3 (right-stick click, W3C index 11) → recenter ─────
      const r3Pressed = gp.buttons[11]?.pressed ?? false;
      if (r3Pressed && !prevButtonsRef.current.r3) {
        vm.x = window.innerWidth / 2;
        vm.y = window.innerHeight / 2;
        vm.lastInputMs = now;
        if (!vm.visible) vm.visible = true;
      }
      prevButtonsRef.current.r3 = r3Pressed;

      // ── Start (W3C index 9) → open System hub ──────────────
      // Edge-triggered once per press (no repeat). The shell
      // listens for the `bigscreen:start` CustomEvent to open the
      // System hub.
      const startPressed = gp.buttons[9]?.pressed ?? false;
      if (startPressed && !prevButtonsRef.current.start) {
        window.dispatchEvent(new CustomEvent("bigscreen:start"));
      }
      prevButtonsRef.current.start = startPressed;

      publishVirtualMouse();
      rafId = requestAnimationFrame(poll);
    }

    rafId = requestAnimationFrame(poll);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
    };
  }, [enabled]);

  // ── Cleanup ────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      for (const entry of entriesRef.current) {
        entry.element.removeAttribute("data-focused");
      }
    };
  }, []);

  const nextState: GamepadState = {
    connected,
    focusedElement,
    registerAction,
    virtualMouse,
    toggleVirtualMouse,
    recenterVirtualMouse,
    registerTabCycler,
    registerBackHandler,
  };
  const previousState = gamepadStateRef.current;
  if (
    previousState &&
    previousState.connected === nextState.connected &&
    previousState.focusedElement === nextState.focusedElement &&
    previousState.virtualMouse === nextState.virtualMouse
  ) {
    return previousState;
  }
  gamepadStateRef.current = nextState;
  return nextState;
}

// Tuning constants and types live in `./gamepad/gamepadUtils` and
// are imported by name from there when a consumer needs them — no
// re-exports here to avoid a second import surface.
