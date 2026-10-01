import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useOrderDrag — pointer-driven reordering for one list.
 *
 * HTML5 drag-and-drop is unreliable inside the Tauri webviews (the native drop
 * handler intercepts it, and WebKit needs a dataTransfer payload to even start
 * a drag), so the drag handle tracks the pointer directly: whichever row sits
 * under the cursor becomes the drop target, and releasing commits the move.
 *
 * Each row owns `data-order-index` and the list container is registered in
 * `containerRef`, so several lists can be mounted at once (Layout Studio shows
 * the header tabs, header buttons and page items together) without stealing
 * each other's targets.
 *
 * Dragging towards the edge of a scrollable ancestor scrolls it, so a row can
 * be dropped beyond the visible window without releasing first — the reason a
 * long navbar is awkward to reorder otherwise.
 */

/** Pointer travel (px) before a press counts as a drag instead of a click. */
const DRAG_THRESHOLD = 5;
/** Distance (px) from a container edge at which auto-scroll starts. */
const AUTOSCROLL_EDGE = 48;
/** Fastest auto-scroll speed, in px per animation frame. */
const AUTOSCROLL_MAX_SPEED = 14;

/**
 * The nearest ancestor that can actually scroll on either axis, starting at
 * `node` itself. Returns null when nothing above the list scrolls.
 */
function findScrollParent(node: HTMLElement | null): HTMLElement | null {
  let el = node;
  while (el) {
    const style = getComputedStyle(el);
    const scrollableX =
      /(auto|scroll|overlay)/.test(style.overflowX) && el.scrollWidth > el.clientWidth;
    const scrollableY =
      /(auto|scroll|overlay)/.test(style.overflowY) && el.scrollHeight > el.clientHeight;
    if (scrollableX || scrollableY) return el;
    el = el.parentElement;
  }
  return null;
}

interface DragPoint {
  x: number;
  y: number;
}

export function useOrderDrag(onReorder: (from: number, to: number) => void) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  // Mirror of `overIndex` for the window-level listeners, which are subscribed
  // once per drag instead of once per hovered row.
  const overRef = useRef<number | null>(null);
  // True once the pointer reached a different row (or travelled far enough to
  // be a drag). Rows that also toggle on click (the Layout Studio preview)
  // read this to swallow the click that ends a drag.
  const movedRef = useRef(false);
  // Where the press began and where the pointer currently is, both for the
  // move threshold and for edge auto-scroll.
  const startPointRef = useRef<DragPoint | null>(null);
  const pointerRef = useRef<DragPoint | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (dragIndex === null) return;

    const resolveOver = (x: number, y: number) => {
      const row = document
        .elementFromPoint(x, y)
        ?.closest<HTMLElement>("[data-order-index]");
      if (!row || !containerRef.current?.contains(row)) return;
      const index = Number(row.dataset.orderIndex);
      if (Number.isFinite(index) && index !== overRef.current) {
        if (index !== dragIndex) movedRef.current = true;
        overRef.current = index;
        setOverIndex(index);
      }
    };

    const trackPointer = (e: PointerEvent) => {
      pointerRef.current = { x: e.clientX, y: e.clientY };
      const start = startPointRef.current;
      if (!movedRef.current && start) {
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (dx * dx + dy * dy >= DRAG_THRESHOLD * DRAG_THRESHOLD) {
          movedRef.current = true;
        }
      }
      resolveOver(e.clientX, e.clientY);
    };

    const finishDrag = () => {
      const target = overRef.current;
      if (target !== null && target !== dragIndex) onReorder(dragIndex, target);
      overRef.current = null;
      setDragIndex(null);
      setOverIndex(null);
    };

    window.addEventListener("pointermove", trackPointer);
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", finishDrag);
    window.addEventListener("blur", finishDrag);

    const previousCursor = document.body.style.cursor;
    document.body.style.cursor = "grabbing";

    // Auto-scroll the nearest scrollable ancestor while the pointer hugs an
    // edge. `scroll-behavior: smooth` would make the position jumps lag behind
    // the pointer, so it is pinned to `auto` for the duration of the drag.
    const scrollParent = findScrollParent(containerRef.current);
    const previousScrollBehavior = scrollParent?.style.scrollBehavior ?? "";
    if (scrollParent) scrollParent.style.scrollBehavior = "auto";

    const autoScroll = () => {
      frameRef.current = requestAnimationFrame(autoScroll);
      const el = scrollParent;
      const p = pointerRef.current;
      if (!el || !p) return;
      const rect = el.getBoundingClientRect();
      let dx = 0;
      let dy = 0;
      if (el.scrollWidth > el.clientWidth) {
        if (p.x < rect.left + AUTOSCROLL_EDGE) {
          dx = -Math.round(
            ((rect.left + AUTOSCROLL_EDGE - p.x) / AUTOSCROLL_EDGE) * AUTOSCROLL_MAX_SPEED,
          );
        } else if (p.x > rect.right - AUTOSCROLL_EDGE) {
          dx = Math.round(
            ((p.x - (rect.right - AUTOSCROLL_EDGE)) / AUTOSCROLL_EDGE) * AUTOSCROLL_MAX_SPEED,
          );
        }
      }
      if (el.scrollHeight > el.clientHeight) {
        if (p.y < rect.top + AUTOSCROLL_EDGE) {
          dy = -Math.round(
            ((rect.top + AUTOSCROLL_EDGE - p.y) / AUTOSCROLL_EDGE) * AUTOSCROLL_MAX_SPEED,
          );
        } else if (p.y > rect.bottom - AUTOSCROLL_EDGE) {
          dy = Math.round(
            ((p.y - (rect.bottom - AUTOSCROLL_EDGE)) / AUTOSCROLL_EDGE) * AUTOSCROLL_MAX_SPEED,
          );
        }
      }
      if (dx === 0 && dy === 0) return;
      el.scrollLeft += dx;
      el.scrollTop += dy;
      // Rows slid under the pointer; re-resolve which one it is over.
      resolveOver(p.x, p.y);
    };
    frameRef.current = requestAnimationFrame(autoScroll);

    return () => {
      document.body.style.cursor = previousCursor;
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      if (scrollParent) scrollParent.style.scrollBehavior = previousScrollBehavior;
      window.removeEventListener("pointermove", trackPointer);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
      window.removeEventListener("blur", finishDrag);
    };
  }, [dragIndex, onReorder]);

  const startDrag = useCallback((index: number, point?: DragPoint) => {
    overRef.current = index;
    movedRef.current = false;
    startPointRef.current = point ?? null;
    pointerRef.current = point ?? null;
    setOverIndex(index);
    setDragIndex(index);
  }, []);

  return { containerRef, dragIndex, overIndex, startDrag, movedRef };
}
