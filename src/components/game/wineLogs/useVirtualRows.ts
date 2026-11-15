import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/**
 * Fixed-row-height windowing for the log terminal.
 *
 * Only used while wrapping is off, where every row is exactly `rowHeight`
 * tall. Scroll events are coalesced through `requestAnimationFrame` (falling
 * back to a direct update when rAF is unavailable, e.g. in jsdom) so a fast
 * wheel spin never schedules one React render per scroll event.
 */

export interface VirtualRowsOptions {
  count: number;
  rowHeight: number;
  enabled: boolean;
  /** Rows rendered above/below the viewport to hide fast-scroll gaps. */
  overscan?: number;
}

export interface VirtualRows {
  scrollRef: RefObject<HTMLDivElement | null>;
  enabled: boolean;
  start: number;
  end: number;
  topSpacer: number;
  bottomSpacer: number;
  onScroll: () => void;
  scrollToIndex: (index: number) => void;
}

function scheduleFrame(callback: () => void): number {
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    return window.requestAnimationFrame(callback);
  }
  return window.setTimeout(callback, 16);
}

function cancelFrame(handle: number): void {
  if (typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
    window.cancelAnimationFrame(handle);
    return;
  }
  window.clearTimeout(handle);
}

export function useVirtualRows({
  count,
  rowHeight,
  enabled,
  overscan = 12,
}: VirtualRowsOptions): VirtualRows {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const latestTop = useRef(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setViewportHeight(el.clientHeight);
    setScrollTop(el.scrollTop);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    measure();
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled, measure]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelFrame(frameRef.current);
    },
    []
  );

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    latestTop.current = el.scrollTop;
    if (frameRef.current !== null) return;
    frameRef.current = scheduleFrame(() => {
      frameRef.current = null;
      setScrollTop(latestTop.current);
    });
  }, []);

  const scrollToIndex = useCallback(
    (index: number) => {
      const el = scrollRef.current;
      if (!el) return;
      const top = Math.max(0, index * rowHeight);
      const visibleTop = el.scrollTop;
      const visibleBottom = visibleTop + el.clientHeight;
      if (top < visibleTop || top + rowHeight > visibleBottom) {
        el.scrollTop = Math.max(0, top - Math.floor(el.clientHeight / 2));
        setScrollTop(el.scrollTop);
      }
    },
    [rowHeight]
  );

  if (!enabled) {
    return {
      scrollRef,
      enabled,
      start: 0,
      end: count,
      topSpacer: 0,
      bottomSpacer: 0,
      onScroll,
      scrollToIndex,
    };
  }

  // Before the first measurement, assume a one-row viewport: the overscan
  // band still renders enough content for the ResizeObserver pass.
  const height = viewportHeight > 0 ? viewportHeight : rowHeight;
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(count, Math.ceil((scrollTop + height) / rowHeight) + overscan);

  return {
    scrollRef,
    enabled,
    start,
    end,
    topSpacer: start * rowHeight,
    bottomSpacer: Math.max(0, (count - end) * rowHeight),
    onScroll,
    scrollToIndex,
  };
}
