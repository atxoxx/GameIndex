import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Game } from "../types/game";

/**
 * Status visible in the splash card. Drives the status pill copy and
 * the splash's auto-close lifecycle.
 */
export type SplashStatus = "launching" | "started" | "error";

/**
 * Animated launch-step index. Advances on a timer while status is
 * "launching" so the user sees progressive feedback instead of a
 * static "Launching..." message.
 */
export type LaunchStep = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Pre-rendered payload displayed in the splash overlay. Includes the
 * last session so the splash doesn't need to bootstrap ActivityContext
 * on mount and excludes the full game list.
 */
export interface SplashPayload {
  game: Game;
}

/**
 * Record currently displayed by the splash. Stamps `startedAt` so the
 * splash can compute a min-visibility hold regardless of how many
 * status flips happened after launch_game resolved.
 */
export interface SplashRecord extends SplashPayload {
  status: SplashStatus;
  startedAt: number;
  launchStep: LaunchStep;
  /** Failure reason shown in the error state. Null unless a launch failed. */
  errorMessage: string | null;
  /** Re-runs the failed launch. Set by GameContext when opening the splash. */
  retry?: () => void;
}

function buildSplashRecord(
  payload: SplashPayload,
  status: SplashStatus
): SplashRecord {
  return {
    ...payload,
    status,
    startedAt: Date.now(),
    launchStep: 0,
    errorMessage: null,
  };
}

export interface SplashContextType {
  /** Whether the splash overlay is currently visible. */
  visible: boolean;
  /** True when the splash renders as an in-window overlay. The standalone
   *  splash window is the default; this is only a fallback for runs without
   *  a Tauri shell (plain `npm run dev`) or when the window build fails. */
  inline: boolean;
  /** Current splash record. Null when no launch is in flight. */
  record: SplashRecord | null;
  /** Draw the splash with status "launching". Idempotent — re-calling
   *  with a different game wipes the previous record. `actions.retry`
   *  re-launches the same game from the splash's error state. */
  open: (payload: SplashPayload, actions?: { retry?: () => void }) => void;
  /** Flip just the status field, preserving `startedAt` so the splash's
   *  min-visibility timer is consistent across status flips. `errorMessage`
   *  is surfaced (and stored) only when status is "error". */
  updateStatus: (status: SplashStatus, errorMessage?: string) => void;
  /** Advance the animated launch-step counter. Safe to call even when
   *  the splash has already closed (no-op in that case). */
  updateLaunchStep: (step: LaunchStep) => void;
  /** Tear the splash down. The Splashscreen component calls this from
   *  its fade lifecycle. */
  close: () => void;
}

// Persist the React context instance across Vite HMR module re-evaluations so
// lazy-loaded page chunks never lose their Provider instance.
const globalSplashObj = globalThis as unknown as {
  __gamelib_splash_context__?: React.Context<SplashContextType | null>;
};
export const SplashContext =
  globalSplashObj.__gamelib_splash_context__ ??
  (globalSplashObj.__gamelib_splash_context__ = createContext<SplashContextType | null>(null));

/** localStorage key for the user-controlled "show launch splash"
 *  preference. Read fresh on every launchGame call so a Settings
 *  toggle takes effect on the very next click without a remount. */
const SPLASH_ENABLED_KEY = "gamelib-show-splash";

/** Per-window user preference stored in localStorage (intentionally
 *  per-window — it's the user's own setting, not an IPC payload).
 *  Defaults to ON. */
export function isSplashEnabled(): boolean {
  try {
    if (typeof localStorage === "undefined") return true;
    return localStorage.getItem(SPLASH_ENABLED_KEY) !== "false";
  } catch {
    return true;
  }
}

export function SplashProvider({ children }: { children: ReactNode }) {
  const [record, setRecord] = useState<SplashRecord | null>(null);
  const [inline, setInline] = useState(false);
  // Identifies the launch whose window-open call is still in flight, so a
  // stale failure can't pull a newer launch back into the overlay.
  const activeStartedAtRef = useRef<number | null>(null);

  const open = useCallback(
    (payload: SplashPayload, actions?: { retry?: () => void }) => {
      const next = { ...buildSplashRecord(payload, "launching"), retry: actions?.retry };
      activeStartedAtRef.current = next.startedAt;
      setRecord(next);
      setInline(false);
      // The splash renders in its own always-on-top window so it survives
      // minimize-on-launch hiding the app. Fire-and-forget: the bridge
      // mirrors later status flips, and a failed build flips this window
      // to the inline overlay fallback.
      void invoke("open_launch_splash", {
        payload: payload.game,
        gameId: payload.game.id,
        startedAt: next.startedAt,
      }).catch(() => {
        if (activeStartedAtRef.current === next.startedAt) setInline(true);
      });
    },
    []
  );

  const updateStatus = useCallback(
    (status: SplashStatus, errorMessage?: string) => {
      setRecord((prev) =>
        prev ? { ...prev, status, errorMessage: errorMessage ?? null } : prev
      );
    },
    []
  );

  const updateLaunchStep = useCallback((step: LaunchStep) => {
    setRecord((prev) => (prev ? { ...prev, launchStep: step } : prev));
  }, []);

  const close = useCallback(() => {
    activeStartedAtRef.current = null;
    setRecord(null);
  }, []);

  const value = useMemo<SplashContextType>(
    () => ({
      visible: record !== null,
      inline,
      record,
      open,
      updateStatus,
      updateLaunchStep,
      close,
    }),
    [record, inline, open, updateStatus, updateLaunchStep, close]
  );

  return (
    <SplashContext.Provider value={value}>{children}</SplashContext.Provider>
  );
}

export function useSplash(): SplashContextType {
  const ctx = useContext(SplashContext);
  if (!ctx) {
    throw new Error("useSplash must be used within a SplashProvider");
  }
  return ctx;
}
