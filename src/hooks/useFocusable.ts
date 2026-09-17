// useFocusable — register an element with the Big Screen focus
// registry so spatial navigation (D-pad / left stick) can land on
// it and the A button activates `onActivate`.
//
// Replaces the old `useBigScreenHook().focusableProps(...)` factory.
// As a hook (not a factory), each focusable element gets its own
// ref + cleanup pair, which means:
//
//   • Refs are STABLE across renders — React doesn't re-run
//     cleanup+register every parent render (the old factory
//     recreated the callback every render and thrashed the
//     focus registry).
//   • `onActivate` is read through a ref, so callers can pass a
//     fresh closure each render (typical for inline handlers) and
//     the focus registry still points at the latest version.
//
// Usage:
//
//   const playProps = useFocusable(handlePlay);
//   <button {...playProps}>Play</button>
//
// Or, for elements with their own ref (rare — most callers should
// just spread `useFocusable`'s return value), `useFocusableRef` is
// the lower-level primitive that exposes the callback directly.

import { useCallback, useRef, type AriaRole, type KeyboardEvent } from "react";
import { useGamepad } from "./GamepadProvider";

export interface FocusableProps {
  /** Callback ref. Spreads onto the focusable element. */
  ref: (el: HTMLElement | null) => void;
  /** Always `0` so the element joins the natural tab order. */
  tabIndex: number;
  /**
   * Optional WAI-ARIA role hint, deliberately never set by the hook.
   * Historically every focusable was forced to `role="option"`, which
   * clobbered the native role of buttons, links and inputs (breaking
   * assistive tech and `getByRole` semantics) and left plain `<div>`
   * containers announced as list options. The hook now leaves the role
   * alone, so a caller that focuses a non-native container must state
   * what that container is: `role="button"` for something that performs
   * an action, `role="link"` for something that navigates. The typing is
   * wide enough for any ARIA role because the honest answer differs per
   * call site.
   */
  role?: AriaRole;
  /** Mouse / keyboard fallback (the virtual cursor also uses it). */
  onClick: () => void;
  /**
   * Enter / Space activation for non-native focusables (game-card
   * `<div>`s). Native buttons and links already fire `onClick` on
   * Enter, so this handler stands down for them to avoid double
   * activation.
   */
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

const NATIVE_ACTIVATION_TAGS = new Set(["BUTTON", "A", "INPUT", "SUMMARY"]);

/**
 * Register a focusable element with the Big Screen spatial-nav
 * focus registry.
 *
 * The returned object is stable across renders as long as the
 * `registerAction` reference is stable (it is — it's a `useCallback`
 * with `[]` deps in `useGamepad`). This is the key fix over the
 * old `focusableProps` factory, which returned a fresh object every
 * call and forced a register/unregister cycle every render.
 */
export function useFocusable(onActivate: () => void): FocusableProps {
  const { registerAction } = useGamepad();

  // Keep `onActivate` fresh without making it a hook dep — the
  // closure always reads the latest value via this ref.
  const onActivateRef = useRef(onActivate);
  onActivateRef.current = onActivate;

  // Hold the unregister fn from `registerAction` so the ref
  // callback can clean up on unmount or element swap.
  const cleanupRef = useRef<(() => void) | null>(null);

  const refCallback = useCallback(
    (el: HTMLElement | null) => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
      if (el) {
        cleanupRef.current = registerAction(
          el,
          () => onActivateRef.current(),
        );
      }
    },
    [registerAction],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const tag = event.currentTarget.tagName;
      if (NATIVE_ACTIVATION_TAGS.has(tag)) return;
      event.preventDefault();
      onActivateRef.current();
    },
    [],
  );

  return {
    ref: refCallback,
    tabIndex: 0,
    onClick: () => onActivateRef.current(),
    onKeyDown,
  };
}
