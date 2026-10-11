import { useCallback, useEffect, useState } from "react";

export interface IncrementalList<T> {
  /** The current window of items — never longer than the live list. */
  visible: T[];
  /** True while there are items past the current window. */
  hasMore: boolean;
  /** Widen the window by one more `pageSize` chunk. */
  showMore: () => void;
  /** Bumps whenever the window is clamped back by a shrinking list. */
  resetKey: number;
}

/**
 * Renders a list incrementally so large collections stay cheap: the first
 * `pageSize` items are shown, `showMore` extends the window, and the window is
 * clamped when the live list shrinks below it (filter, delete, wholesale swap).
 * No virtualization — just bounded DOM.
 */
export function useIncrementalList<T>(
  items: T[],
  pageSize = 40,
): IncrementalList<T> {
  const safePageSize = pageSize > 0 ? pageSize : 1;
  const [pages, setPages] = useState(1);
  const [resetKey, setResetKey] = useState(0);

  const count = items.length;
  const totalPages = Math.max(1, Math.ceil(count / safePageSize));

  // Clamp when the list shrinks below the current window. Keyed off page count
  // (not length) so a growing list keeps whatever the user already expanded.
  useEffect(() => {
    if (pages <= totalPages) return;
    setPages(totalPages);
    setResetKey((k) => k + 1);
  }, [pages, totalPages]);

  const visible = items.slice(0, pages * safePageSize);
  const hasMore = visible.length < count;

  const showMore = useCallback(() => setPages((p) => p + 1), []);

  return { visible, hasMore, showMore, resetKey };
}
