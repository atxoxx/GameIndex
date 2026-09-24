import { useCallback, type KeyboardEvent } from "react";

type RovingTabHandler<T extends HTMLElement> = (event: KeyboardEvent<T>) => void;

/**
 * Arrow-key navigation for a `role="tablist"` container that uses roving
 * tabindex (the selected tab has `tabIndex={0}`, the rest `-1`).
 */
export function useRovingTabFocus<T extends HTMLElement = HTMLDivElement>(): RovingTabHandler<T> {
  return useCallback((event: KeyboardEvent<T>) => {
    const tabs = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    );
    if (tabs.length === 0) return;

    const current = tabs.findIndex((tab) => tab.tabIndex === 0);
    let next = current;

    if (event.key === "ArrowRight") next = (current + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (current - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;

    event.preventDefault();
    const target = tabs[next];
    if (!target || target.disabled) return;
    target.click();
    target.focus();
  }, []);
}
