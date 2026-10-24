import { useCallback, useEffect, useRef, useState } from "react";

/**
 * usePersistedJson - `usePersistedState` for small object-shaped UI state
 * (per-tab filter sets) that must survive route changes and restarts.
 *
 * Reads are validated against `defaults`: unknown keys are dropped and a value
 * whose type no longer matches the default falls back to the default. That
 * keeps a stale `localStorage` entry from crashing a page after a filter
 * schema change, which a bare `JSON.parse` would do.
 */
export function usePersistedJson<T extends object>(
  key: string,
  defaults: T,
): [T, (next: T | ((prev: T) => T)) => void] {
  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;

  const [value, setValueState] = useState<T>(() => readStored(key, defaults));

  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    writeStored(key, value);
  }, [key, value]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key || e.newValue === null) return;
      setValueState(readStored(key, defaultsRef.current));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key]);

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      const resolved =
        typeof next === "function" ? (next as (prev: T) => T)(valueRef.current) : next;
      setValueState(resolved);
      writeStored(key, resolved);
    },
    [key],
  );

  return [value, setValue];
}

function readStored<T extends object>(key: string, defaults: T): T {
  try {
    if (typeof localStorage === "undefined") return { ...defaults };
    const raw = localStorage.getItem(key);
    if (raw === null) return { ...defaults };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ...defaults };
    }
    const stored = parsed as Record<string, unknown>;
    const merged = { ...defaults } as unknown as Record<string, unknown>;
    for (const field of Object.keys(defaults)) {
      const fallback = (defaults as unknown as Record<string, unknown>)[field];
      const candidate = stored[field];
      if (candidate === undefined) continue;
      if (Array.isArray(fallback)) {
        if (Array.isArray(candidate)) merged[field] = candidate;
        continue;
      }
      if (typeof candidate === typeof fallback) merged[field] = candidate;
    }
    return merged as T;
  } catch {
    return { ...defaults };
  }
}

function writeStored(key: string, value: unknown): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* localStorage can be unavailable or full; the UI still works in memory. */
  }
}
