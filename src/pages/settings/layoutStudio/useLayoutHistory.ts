// useLayoutHistory — session-scoped undo for the Layout Studio.
//
// Every studio control writes straight to its persisted setting, so without
// history an exploratory click is final. This keeps the last N snapshots and
// can restore them through the same `applySnapshot` the presets use, which
// means undo covers reorders, hides, master switches and preset application
// with no per-setting code.

import { useCallback, useEffect, useRef, useState } from "react";

export interface LayoutHistory {
  canUndo: boolean;
  /** Restore the previous snapshot. Returns false when the stack is empty. */
  undo: () => boolean;
  /** Drop the stack, e.g. after a full reset that is itself the new baseline. */
  clear: () => void;
}

export function useLayoutHistory<T>(
  current: T,
  apply: (snapshot: T) => void,
  limit = 30,
): LayoutHistory {
  const pastRef = useRef<T[]>([]);
  const lastRef = useRef<T>(current);
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const [canUndo, setCanUndo] = useState(false);

  useEffect(() => {
    if (current === lastRef.current) return;
    // A value-equal snapshot (fresh object, same content) is not a new edit.
    if (JSON.stringify(current) === JSON.stringify(lastRef.current)) {
      lastRef.current = current;
      return;
    }
    pastRef.current.push(lastRef.current);
    if (pastRef.current.length > limit) pastRef.current.shift();
    lastRef.current = current;
    setCanUndo(pastRef.current.length > 0);
  }, [current, limit]);

  const undo = useCallback(() => {
    const previous = pastRef.current.pop();
    if (previous === undefined) return false;
    // Pre-seed the baseline so the effect above does not record the restore
    // itself as a new edit.
    lastRef.current = previous;
    setCanUndo(pastRef.current.length > 0);
    applyRef.current(previous);
    return true;
  }, []);

  const clear = useCallback(() => {
    pastRef.current = [];
    setCanUndo(false);
  }, []);

  return { canUndo, undo, clear };
}
