import { useCallback, useRef } from "react";
import { useFocusable } from "../../hooks/useFocusable";

/**
 * Focus registration for native controls inside the achievements modals
 * (checkbox, select). A replays the element's own behaviour — `.click()`
 * for checkboxes, `.focus()` for selects — so the mouse path is untouched.
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
