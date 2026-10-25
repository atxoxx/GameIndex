// Big Screen preferences provider — layout preset + nav visibility.
//
// One provider sits above both shells (desktop and Big Screen) so the
// System hub, the Guide's quick settings and desktop Settings can read
// and change the TV layout. Writes go through `prefs.ts` (SQLite kv,
// mirrored to localStorage) and the resolved preset is mirrored onto
// <html> as `data-bs-preset` so portaled overlays inherit the same
// geometry tokens as the shell.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_PREFS,
  loadPrefs,
  sanitizePrefs,
  savePrefs,
  type BigScreenPrefs,
} from "../bigscreen/prefs";
import {
  coercePreset,
  getPreset,
  isNavVisibility,
  type BigScreenPresetId,
  type NavVisibility,
} from "../bigscreen/presets";

export interface BigScreenPrefsContextValue {
  prefs: BigScreenPrefs;
  /** False until the durable copy has been read (first paint uses the mirror). */
  ready: boolean;
  setPreset: (preset: BigScreenPresetId) => void;
  setNavVisibility: (visibility: NavVisibility) => void;
  /** Restore the shipped defaults (used by the quick-settings reset). */
  resetPrefs: () => void;
}

const BigScreenPrefsContext = createContext<BigScreenPrefsContextValue | null>(
  null,
);

/** HMR keeps the context identity stable so lazy chunks never split it. */
const HMR_KEY = "__gamelib_bigscreen_prefs_context__";
type HmrCarrier = typeof globalThis & {
  [HMR_KEY]?: typeof BigScreenPrefsContext;
};
const sharedContext = (() => {
  const carrier = globalThis as HmrCarrier;
  carrier[HMR_KEY] ??= BigScreenPrefsContext;
  return carrier[HMR_KEY];
})();

export function BigScreenPrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<BigScreenPrefs>(DEFAULT_PREFS);
  const [ready, setReady] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    void loadPrefs().then((loaded) => {
      if (!alive.current) return;
      setPrefs(loaded);
      setReady(true);
    });
    return () => {
      alive.current = false;
    };
  }, []);

  // Mirror onto <html> for portaled overlays and preset-scoped tokens.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-bs-preset", prefs.preset);
    root.setAttribute("data-bs-nav", prefs.navVisibility);
    return () => {
      root.removeAttribute("data-bs-preset");
      root.removeAttribute("data-bs-nav");
    };
  }, [prefs.preset, prefs.navVisibility]);

  const commit = useCallback((next: BigScreenPrefs) => {
    const clean = sanitizePrefs(next);
    setPrefs(clean);
    void savePrefs(clean);
  }, []);

  const setPreset = useCallback(
    (preset: BigScreenPresetId) => {
      const next = coercePreset(preset);
      setPrefs((current) => {
        const value: BigScreenPrefs = {
          preset: next,
          // Switching layout adopts the new preset's intent unless the
          // user has explicitly overridden nav visibility. We can't tell
          // the two apart, so keep the current visibility when the user
          // has already changed it away from the old preset default.
          navVisibility:
            current.navVisibility === getPreset(current.preset).navVisibility
              ? getPreset(next).navVisibility
              : current.navVisibility,
        };
        void savePrefs(value);
        return value;
      });
    },
    [],
  );

  const setNavVisibility = useCallback((visibility: NavVisibility) => {
    if (!isNavVisibility(visibility)) return;
    setPrefs((current) => {
      const value: BigScreenPrefs = {
        ...current,
        navVisibility: visibility,
      };
      void savePrefs(value);
      return value;
    });
  }, []);

  const resetPrefs = useCallback(() => commit(DEFAULT_PREFS), [commit]);

  const value = useMemo<BigScreenPrefsContextValue>(
    () => ({ prefs, ready, setPreset, setNavVisibility, resetPrefs }),
    [prefs, ready, setPreset, setNavVisibility, resetPrefs],
  );

  return (
    <sharedContext.Provider value={value}>
      {children}
    </sharedContext.Provider>
  );
}

export function useBigScreenPrefs(): BigScreenPrefsContextValue {
  const ctx = useContext(sharedContext);
  if (!ctx) {
    throw new Error(
      "useBigScreenPrefs must be used inside <BigScreenPrefsProvider>",
    );
  }
  return ctx;
}

/** Resolved preset traits for the active layout. */
export function useActivePreset() {
  const { prefs } = useBigScreenPrefs();
  return getPreset(prefs.preset);
}
