import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_SIZE_UNIT,
  formatSize as formatSizeHelper,
  SIZE_UNITS,
  SIZE_UNIT_STORAGE_KEY,
  type SizeUnit,
} from "../types/game";
import { formatBytesShort } from "../types/download";
import { useLanguage } from "../context/LanguageContext";

/**
 * useSizeUnit: user-toggleable display unit for disk sizes.
 *
 * - Reads from localStorage on first render (safe synchronous init for SPAs).
 * - Persists every change back to localStorage via an effect.
 * - Subscribes to the `storage` event so settings changed in another tab
 *   (or in a different component that calls `setSizeUnit`) update this
 *   tab live.
 * - Falls back to DEFAULT_SIZE_UNIT when the stored value is missing or
 *   invalid.
 *
 * localStorage access is wrapped in try/catch because private-browsing
 * modes and some sandboxed contexts throw on read/write.
 *
 * Pattern mirrors `useViewDensity` for consistency.
 */
export function useSizeUnit(): {
  unit: SizeUnit;
  setUnit: (next: SizeUnit) => void;
  formatSize: (bytes: number | null | undefined) => string;
  formatBytes: (bytes: number | null | undefined) => string;
} {
  const { language } = useLanguage();
  const [unit, setUnitState] = useState<SizeUnit>(() => {
    try {
      const raw = localStorage.getItem(SIZE_UNIT_STORAGE_KEY);
      if (raw && (SIZE_UNITS as readonly string[]).includes(raw)) {
        return raw as SizeUnit;
      }
    } catch {
      // localStorage may be unavailable in this environment.
    }
    return DEFAULT_SIZE_UNIT;
  });

  // Persist on every change.
  useEffect(() => {
    try {
      localStorage.setItem(SIZE_UNIT_STORAGE_KEY, unit);
    } catch {
      // localStorage may throw in private browsing modes.
    }
  }, [unit]);

  // Cross-tab sync via the browser `storage` event.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== SIZE_UNIT_STORAGE_KEY || !e.newValue) return;
      const next = e.newValue;
      if ((SIZE_UNITS as readonly string[]).includes(next)) {
        setUnitState(next as SizeUnit);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // setUnit is wrapped so state and storage update synchronously.
  const setUnit = useCallback((next: SizeUnit) => {
    setUnitState(next);
    try {
      localStorage.setItem(SIZE_UNIT_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const formatSizeBound = useCallback(
    (bytes: number | null | undefined) => formatSizeHelper(bytes, unit, language),
    [unit, language]
  );

  const formatBytesBound = useCallback(
    (bytes: number | null | undefined) => formatBytesShort(bytes, unit, language),
    [unit, language]
  );

  return { unit, setUnit, formatSize: formatSizeBound, formatBytes: formatBytesBound };
}
