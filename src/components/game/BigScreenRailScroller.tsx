// BigScreenRailScroller — turns any horizontal strip into a proper
// controller rail.
//
// The engine's rail contract lives on `[data-rail-id]`: Left/Right prefers
// candidates inside the same rail and wraps at the ends. What the wrapper
// does NOT do is reveal a focused card that sits past the strip's visible
// edge — the engine scrolls the element returned by
// `closest(HORIZONTAL_TRACK_SELECTOR)`, and the strips we wrap here
// (ScreenshotsSection / VideosSection) own their own overflow container
// deeper in the tree.
//
// So the wrapper takes the rail semantics from the attribute and handles
// the reveal itself: when the focused element lands inside, scroll its
// real horizontal scroller so the card sits about a quarter in from the
// left. Same math the library rail uses, made generic.

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { useGamepad } from "../../hooks/GamepadProvider";

export interface BigScreenRailScrollerProps {
  /** Stable rail id — matches the engine's `[data-rail-id]` contract. */
  railId: string;
  /** Optional accessible name for the rail region. */
  label?: string;
  className?: string;
  children: ReactNode;
}

/** Nearest horizontally scrollable ancestor of `el`, stopping at `boundary`. */
function findHorizontalScroller(
  el: HTMLElement,
  boundary: HTMLElement,
): HTMLElement | null {
  let parent = el.parentElement;
  while (parent && parent !== boundary) {
    const style = window.getComputedStyle(parent);
    const overflowX = style.overflowX;
    if (
      (overflowX === "auto" || overflowX === "scroll") &&
      parent.scrollWidth > parent.clientWidth + 4
    ) {
      return parent;
    }
    parent = parent.parentElement;
  }
  return null;
}

export default function BigScreenRailScroller({
  railId,
  label,
  className,
  children,
}: BigScreenRailScrollerProps) {
  const gamepad = useGamepad();
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const focused = gamepad.focusedElement;
    const root = rootRef.current;
    if (!focused || !root || !root.contains(focused)) return;

    const scroller = findHorizontalScroller(focused, root);
    if (!scroller) return;

    const cardRect = focused.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    const offsetWithinScroller =
      cardRect.left - scrollerRect.left + scroller.scrollLeft;
    const delta = offsetWithinScroller - scrollerRect.width * 0.25;
    if (Math.abs(delta) > 8) {
      scroller.scrollTo({
        left: Math.max(0, scroller.scrollLeft + delta),
        behavior: "smooth",
      });
    }
  }, [gamepad.focusedElement]);

  return (
    <div
      ref={rootRef}
      className={["bigscreen-rail-scroller", className ?? ""]
        .filter(Boolean)
        .join(" ")}
      data-rail-id={railId}
      role="group"
      aria-label={label}
    >
      {children}
    </div>
  );
}
