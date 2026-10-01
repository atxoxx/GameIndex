import { useCallback, useEffect, useRef, useState } from "react";

/**
 * usePersistedState — a localStorage-backed `useState` for small,
 * user-toggleable UI preferences (view modes, preview modes, sub-tab
 * selections) that must survive route changes and app restarts.
 *
 * Why a shared hook instead of a fresh `useState` + `useEffect` pair in
 * every component: the read/validate/write logic has to be identical
 * everywhere, including the try/catch around `localStorage` (private
 * browsing and sandboxed contexts throw) and the cross-tab `storage`
 * listener. Drifting copies is how stale keys and mount crashes appear.
 *
 * Args:
 *  - `key`          Versioned localStorage key (`...v1`) so the schema
 *                   can change without colliding with stale reads.
 *  - `defaultValue` Value used on first visit or when the stored value
 *                   is missing/invalid.
 *  - `allowed`      Accepted string values. Anything else is ignored on
 *                   read; the setter is typed to this union at call sites.
 *
 * The setter writes synchronously (in addition to the persist effect) so
 * a value chosen just before unmount is never lost. Like React's own
 * `useState`, it accepts either a value or an updater function.
 */
export function usePersistedState<T extends string>(
  key: string,
  defaultValue: T,
  allowed: readonly T[],
): [T, (next: T | ((prev: T) => T)) => void] {
  const allowedRef = useRef(allowed);
  allowedRef.current = allowed;

  const [value, setValueState] = useState<T>(() => readStored(key, defaultValue, allowed));

  // Mirror of the latest committed value so the setter can resolve
  // updater functions without reading stale state.
  const valueRef = useRef(value);
  valueRef.current = value;

  // Persist on every change.
  useEffect(() => {
    writeStored(key, value);
  }, [key, value]);

  // Cross-tab / multi-component sync via the browser `storage` event.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key || e.newValue === null) return;
      const next = e.newValue as T;
      if (allowedRef.current.includes(next)) setValueState(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key]);

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      const resolved = typeof next === "function" ? (next as (prev: T) => T)(valueRef.current) : next;
      setValueState(resolved);
      writeStored(key, resolved);
    },
    [key],
  );

  return [value, setValue];
}

/** Read a validated value from localStorage, falling back on first visit
 *  or when the stored entry is corrupt/unknown. */
function readStored<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    if (typeof localStorage === "undefined") return fallback;
    const raw = localStorage.getItem(key);
    if (raw !== null && (allowed as readonly string[]).includes(raw)) {
      return raw as T;
    }
  } catch {
    /* localStorage may be unavailable in this environment. */
  }
  return fallback;
}

/** Mirror of readStored for writes; swallows quota/sandbox errors. */
function writeStored(key: string, value: string): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}
