import { useCallback, useRef } from "react";
import { useFocusable } from "../../hooks/useFocusable";

/**
 * `useFocusable` without the ARIA role hint, so native buttons and links
 * keep their own role. Spread the returned props onto the control.
 */
export function useFocusProps(onActivate: () => void) {
  const { ref, tabIndex, onClick } = useFocusable(onActivate);
  return { ref, tabIndex, onClick };
}

/**
 * Focus registration for native controls (checkbox, select, anchor). A
 * press forwards to the element itself — `.click()` for toggles and
 * links so their native behaviour runs unchanged, `.focus()` for selects
 * where a synthetic click would not open the dropdown.
 */
export function useFocusableNative<T extends HTMLElement>() {
  const elRef = useRef<T | null>(null);
  const { ref, tabIndex } = useFocusable(() => {
    const el = elRef.current;
    if (!el) return;
    if (el.tagName === "SELECT") el.focus();
    else el.click();
  });
  const setRef = useCallback(
    (el: T | null) => {
      elRef.current = el;
      ref(el);
    },
    [ref],
  );
  return { setRef, tabIndex };
}
