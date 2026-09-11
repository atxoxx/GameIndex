import { useCallback, useState } from "react";
import type { MouseEvent } from "react";

export interface ContextMenuState<T> {
  target: T;
  x: number;
  y: number;
}

/**
 * State helper for mounting a `ContextMenu`. Captures the click position
 * (and an optional target) then hands it back to the caller, so row/card
 * components can own their menu without page-level plumbing.
 */
export function useContextMenu<T = undefined>() {
  const [state, setState] = useState<ContextMenuState<T> | null>(null);

  const open = useCallback((e: MouseEvent, target?: T) => {
    e.preventDefault();
    e.stopPropagation();
    setState({ target: target as T, x: e.clientX, y: e.clientY });
  }, []);

  const close = useCallback(() => setState(null), []);

  return { state, open, close };
}
