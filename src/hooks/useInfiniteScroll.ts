import { useCallback, useEffect, useRef, useState } from "react";

export interface UseInfiniteScrollOptions {
  /**
   * Observation switch. Pass `false` when the list has no more pages, while a
   * page is in flight, or when the surface showing the list is not visible.
   */
  enabled?: boolean;
  /** Distance below the viewport that starts the next page. */
  rootMargin?: string;
  /** Scroll container to observe against; the viewport when omitted. */
  root?: Element | null;
  /**
   * Re-arms the sentinel when it changes. Pass a value that moves on every
   * resolved page (a visible-item count) and on every filter change, so a
   * short list that still fills the viewport keeps pulling pages.
   */
  resetKey?: string | number;
}

/** Ref callback for the sentinel element at the end of the list. */
export type InfiniteScrollRef<T extends Element> = (node: T | null) => void;

/**
 * Fires `onLoadMore` when the sentinel scrolls into (or near) view.
 *
 * The observer is armed once per resolved page: it disarms as soon as it
 * fires and only re-arms when `enabled` or `resetKey` changes. That keeps a
 * sentinel that is still on screen after a page was appended — a list shorter
 * than the viewport — from firing twice for the same page, while still
 * pulling the next page once the previous one settled.
 */
export function useInfiniteScroll<T extends Element = HTMLDivElement>(
  onLoadMore: () => void,
  {
    enabled = true,
    rootMargin = "400px",
    root = null,
    resetKey,
  }: UseInfiniteScrollOptions = {},
): InfiniteScrollRef<T> {
  const [sentinel, setSentinel] = useState<T | null>(null);
  const callbackRef = useRef(onLoadMore);
  const firedRef = useRef(false);

  useEffect(() => {
    callbackRef.current = onLoadMore;
  }, [onLoadMore]);

  const sentinelRef = useCallback<InfiniteScrollRef<T>>((node) => {
    setSentinel(node);
  }, []);

  useEffect(() => {
    if (!sentinel || !enabled) return;
    // Old webviews and the plain jsdom harness have no observer — stay inert
    // instead of crashing; the list simply shows its first page.
    if (typeof IntersectionObserver === "undefined") return;

    firedRef.current = false;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting || firedRef.current) return;
        firedRef.current = true;
        callbackRef.current();
      },
      { root, rootMargin },
    );
    observer.observe(sentinel);

    return () => observer.disconnect();
  }, [sentinel, enabled, root, rootMargin, resetKey]);

  return sentinelRef;
}
