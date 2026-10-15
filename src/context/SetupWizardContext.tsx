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
import { invoke } from "@tauri-apps/api/core";
import { useGames } from "./GameContext";
import { DEFAULT_SETUP_STATE, type SetupState } from "../types/setup";

interface SetupWizardContextValue {
  state: SetupState;
  /** Convenience: `state.completed`. */
  completed: boolean;
  /** True while the wizard overlay is mounted. */
  isOpen: boolean;
  openWizard: () => void;
  /** Dismiss (Skip / X / Esc) — records the wizard as seen. */
  closeWizard: () => void;
  /** Complete via Finish — records the wizard as seen (not skipped). */
  finishWizard: () => void;
}

const SetupWizardContext = createContext<SetupWizardContextValue | null>(null);

/**
 * SetupWizardProvider — owns the persisted wizard state and auto-opens
 * the wizard once on a fresh install. The completion flag lives in the
 * backend kv store, so it survives a localStorage wipe; the wizard is
 * only suppressed once it has actually been seen.
 */
export function SetupWizardProvider({ children }: { children: ReactNode }) {
  const { gamesHydrated } = useGames();
  const [state, setState] = useState<SetupState>(DEFAULT_SETUP_STATE);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const autoOpenedRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = await invoke<SetupState>("setup_get_state");
        if (!cancelled) setState({ ...DEFAULT_SETUP_STATE, ...next });
      } catch {
        // Frontend-only dev (Tauri stubbed) or a backend hiccup: never
        // auto-open in that case, so a broken bridge can't nag on boot.
        if (!cancelled) setLoadFailed(true);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-open on a fresh install, but only once the library has hydrated
  // so the launch splash/reveal has finished and the shell is on screen.
  useEffect(() => {
    if (!loaded || loadFailed || autoOpenedRef.current) return;
    if (state.completed || !gamesHydrated) return;
    autoOpenedRef.current = true;
    setIsOpen(true);
  }, [loaded, loadFailed, state.completed, gamesHydrated]);

  const persist = useCallback((patch: Partial<SetupState>) => {
    const next = { ...stateRef.current, ...patch };
    setState(next);
    void invoke("setup_set_state", { state: next }).catch(() => {
      // No backend: keep the in-memory state so Skip/Finish still close
      // the wizard for this session.
    });
  }, []);

  const openWizard = useCallback(() => setIsOpen(true), []);
  const closeWizard = useCallback(() => {
    persist({ completed: true, skipped: true, completedAtMs: Date.now() });
    setIsOpen(false);
  }, [persist]);
  const finishWizard = useCallback(() => {
    persist({ completed: true, skipped: false, completedAtMs: Date.now() });
    setIsOpen(false);
  }, [persist]);

  const value = useMemo<SetupWizardContextValue>(
    () => ({
      state,
      completed: state.completed,
      isOpen,
      openWizard,
      closeWizard,
      finishWizard,
    }),
    [state, isOpen, openWizard, closeWizard, finishWizard],
  );

  return (
    <SetupWizardContext.Provider value={value}>
      {children}
    </SetupWizardContext.Provider>
  );
}

export function useSetupWizard(): SetupWizardContextValue {
  const ctx = useContext(SetupWizardContext);
  if (!ctx) {
    throw new Error("useSetupWizard must be used within a SetupWizardProvider");
  }
  return ctx;
}
