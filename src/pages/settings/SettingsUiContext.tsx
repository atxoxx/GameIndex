import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * SettingsUiContext — view-level state shared by the settings shell and the
 * individual tabs that are rendered inside it. It deliberately holds only
 * presentation concerns (never persisted settings values):
 *
 *  - `showAdvanced` toggles the Essentials filter. Every section flagged
 *    `advanced` collapses out of the page while it is off, so a first-time
 *    user sees the handful of choices that actually matter.
 *  - `revealSection` lets the shell force a hidden section open after a
 *    deep link or a search jump.
 *
 * The preference is stored in localStorage (like the other interface-only
 * knobs) so it survives a reload without touching the backend.
 */

const STORAGE_KEY = "gamelib.settings.showAdvanced";

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

interface SettingsUiValue {
  /** True when expert-only sections are visible. */
  showAdvanced: boolean;
  setShowAdvanced: (value: boolean) => void;
}

/**
 * Safe default: outside the settings shell (component tests, isolated
 * stories) every section renders, which is the pre-filter behaviour.
 */
const SettingsUiContext = createContext<SettingsUiValue>({
  showAdvanced: true,
  setShowAdvanced: () => {},
});

export function SettingsUiProvider({ children }: { children: ReactNode }) {
  const [showAdvanced, setShowAdvancedState] = useState<boolean>(readStored);

  const setShowAdvanced = useCallback((value: boolean) => {
    setShowAdvancedState(value);
    try {
      localStorage.setItem(STORAGE_KEY, String(value));
    } catch {
      // Storage can be unavailable (private mode) — the session still works.
    }
  }, []);

  const value = useMemo<SettingsUiValue>(
    () => ({ showAdvanced, setShowAdvanced }),
    [showAdvanced, setShowAdvanced],
  );

  return (
    <SettingsUiContext.Provider value={value}>
      {children}
    </SettingsUiContext.Provider>
  );
}

export function useSettingsUi(): SettingsUiValue {
  return useContext(SettingsUiContext);
}
