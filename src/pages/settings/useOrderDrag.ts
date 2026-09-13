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
 */
export function useOrderDrag(onReorder: (from: number, to: number) => void) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  // Mirror of `overIndex` for the window-level listeners, which are subscribed
  // once per drag instead of once per hovered row.
  const overRef = useRef<number | null>(null);
  // True once the pointer reached a different row during the current drag.
  // Rows that also toggle on click (the Layout Studio preview) read this to
  // swallow the click that ends a drag.
  const movedRef = useRef(false);

  useEffect(() => {
    if (dragIndex === null) return;
    const trackPointer = (e: PointerEvent) => {
      const row = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest<HTMLElement>("[data-order-index]");
      if (!row || !containerRef.current?.contains(row)) return;
      const index = Number(row.dataset.orderIndex);
      if (Number.isFinite(index) && index !== overRef.current) {
        if (index !== dragIndex) movedRef.current = true;
        overRef.current = index;
        setOverIndex(index);
      }
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
    return () => {
      document.body.style.cursor = previousCursor;
      window.removeEventListener("pointermove", trackPointer);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
      window.removeEventListener("blur", finishDrag);
    };
  }, [dragIndex, onReorder]);

  const startDrag = useCallback((index: number) => {
    overRef.current = index;
    movedRef.current = false;
    setOverIndex(index);
    setDragIndex(index);
  }, []);

  return { containerRef, dragIndex, overIndex, startDrag, movedRef };
}
