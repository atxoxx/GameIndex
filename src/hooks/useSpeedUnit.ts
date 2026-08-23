import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_SPEED_UNIT,
  SPEED_UNITS,
  SPEED_UNIT_STORAGE_KEY,
  type SpeedUnit,
} from "../types/game";
import { formatBytesPerSecond } from "../types/download";
import { useLanguage } from "../context/LanguageContext";

/**
 * useSpeedUnit: user-toggleable display unit for network/download speeds.
 *
 * - Reads from localStorage on first render (safe synchronous init for SPAs).
 * - Persists every change back to localStorage via an effect.
 * - Subscribes to the `storage` event so changes in another tab/component sync live.
 * - Falls back to DEFAULT_SPEED_UNIT ("bytes") when missing or invalid.
 * - Provides a bound `formatSpeed` helper aware of active unit & language.
 */
export function useSpeedUnit(): {
  unit: SpeedUnit;
  setUnit: (next: SpeedUnit) => void;
  formatSpeed: (bytesPerSec: number) => string;
} {
  const { language } = useLanguage();
  const [unit, setUnitState] = useState<SpeedUnit>(() => {
    try {
      const raw = localStorage.getItem(SPEED_UNIT_STORAGE_KEY);
      if (raw && (SPEED_UNITS as readonly string[]).includes(raw)) {
        return raw as SpeedUnit;
      }
    } catch {
      // localStorage may be unavailable in this environment.
    }
    return DEFAULT_SPEED_UNIT;
  });

  // Persist on every change.
  useEffect(() => {
    try {
      localStorage.setItem(SPEED_UNIT_STORAGE_KEY, unit);
    } catch {
      // localStorage may throw in private browsing modes.
    }
  }, [unit]);

  // Cross-tab sync via the browser `storage` event.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== SPEED_UNIT_STORAGE_KEY || !e.newValue) return;
      const next = e.newValue;
      if ((SPEED_UNITS as readonly string[]).includes(next)) {
        setUnitState(next as SpeedUnit);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setUnit = useCallback((next: SpeedUnit) => {
    setUnitState(next);
    try {
      localStorage.setItem(SPEED_UNIT_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const formatSpeedBound = useCallback(
    (bytesPerSec: number) => formatBytesPerSecond(bytesPerSec, unit, language),
    [unit, language]
  );

  return { unit, setUnit, formatSpeed: formatSpeedBound };
}
