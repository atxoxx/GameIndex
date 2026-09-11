import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Game } from "../types/game";
import {
  SplashContext,
  type LaunchStep,
  type SplashContextType,
  type SplashRecord,
  type SplashStatus,
} from "../context/SplashContext";
import { LanguageProvider } from "../context/LanguageContext";
import { ThemeProvider } from "../context/ThemeContext";
import Splashscreen from "./Splashscreen";
// Only the styles the splash actually needs — the full App.css barrel would
// drag every page stylesheet into this short-lived window.
import "../styles/theme.css";
import "../styles/themes.css";
import "../styles/splashscreen.css";

/** Snapshot mirrored from Rust (`launch_splash::LaunchSplashSnapshot`). */
export interface LaunchSplashState {
  gameId: string;
  status: SplashStatus;
  errorMessage: string | null;
  startedAt: number;
  payload: Game;
}

/** Later statuses win when folding an out-of-order snapshot in. */
const STATUS_RANK: Record<SplashStatus, number> = {
  launching: 0,
  error: 1,
  started: 2,
};

/**
 * Fold a backend snapshot into the record the splash renders. A stale
 * `get_launch_splash_state` response must not rewind a `started`/`error`
 * splash back to `launching`, and a snapshot from a previous launch is
 * ignored. The animated `launchStep` survives status flips within the
 * same launch so an error doesn't restart the step sequence.
 */
export function mergeSplashRecord(
  prev: SplashRecord | null,
  state: LaunchSplashState,
  retry: () => void
): SplashRecord {
  if (prev && prev.startedAt > state.startedAt) return prev;

  if (prev && prev.startedAt === state.startedAt) {
    if (STATUS_RANK[state.status] < STATUS_RANK[prev.status]) return prev;
    return {
      ...prev,
      game: state.payload,
      status: state.status,
      errorMessage: state.status === "error" ? state.errorMessage ?? null : null,
      retry: state.status === "error" ? retry : undefined,
    };
  }

  return {
    game: state.payload,
    status: state.status,
    startedAt: state.startedAt,
    launchStep: 0,
    errorMessage: state.status === "error" ? state.errorMessage ?? null : null,
    retry: state.status === "error" ? retry : undefined,
  };
}

function LaunchSplashHost() {
  const [record, setRecord] = useState<SplashRecord | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const shownRef = useRef(false);

  const retry = useCallback(() => {
    void invoke("retry_launch_splash").catch(() => {});
  }, []);
  const retryRef = useRef(retry);
  retryRef.current = retry;

  const close = useCallback(() => {
    setRecord(null);
    void invoke("close_launch_splash").catch(() => {});
  }, []);

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

  // This window is display-only; the main window owns opening.
  const open = useCallback(() => {}, []);

  // The Tauri window is transparent, so the page must be too or the
  // body/App.css background would paint the whole rectangle around the card.
  useEffect(() => {
    document.body.classList.add("launch-splash-window");
    return () => document.body.classList.remove("launch-splash-window");
  }, []);

  // Subscribe before hydrating so an update emitted while the webview
  // boots is never lost — the fetch then folds in without rewinding it.
  useEffect(() => {
    let disposed = false;
    const unlisten = listen<LaunchSplashState>("launch-splash-state", (event) => {
      setRecord((prev) => mergeSplashRecord(prev, event.payload, retryRef.current));
    });
    invoke<LaunchSplashState | null>("get_launch_splash_state")
      .then((state) => {
        if (disposed) return;
        if (state) {
          setRecord((prev) => mergeSplashRecord(prev, state, retryRef.current));
        }
        setHydrated(true);
      })
      .catch(() => {
        if (!disposed) setHydrated(true);
      });
    return () => {
      disposed = true;
      void unlisten.then((unlisten) => unlisten());
    };
  }, []);

  // Reveal once there is something to render. A snapshot that is already
  // gone (window built after teardown) closes instead of lingering hidden.
  useEffect(() => {
    if (!hydrated || shownRef.current) return;
    if (!record) {
      void invoke("close_launch_splash").catch(() => {});
      return;
    }
    shownRef.current = true;
    void invoke("show_launch_splash_window").catch(() => {});
  }, [hydrated, record]);

  const value = useMemo<SplashContextType>(
    () => ({
      visible: record !== null,
      inline: true,
      record,
      open,
      updateStatus,
      updateLaunchStep,
      close,
    }),
    [record, open, updateStatus, updateLaunchStep, close]
  );

  return (
    <SplashContext.Provider value={value}>
      <Splashscreen variant="window" />
    </SplashContext.Provider>
  );
}

/**
 * Entry mounted by the `launch-splash` webview. It renders the same
 * `Splashscreen` used by the inline fallback, fed from the Rust snapshot
 * instead of the main window's `SplashProvider`.
 */
export default function LaunchSplashWindow() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <LaunchSplashHost />
      </LanguageProvider>
    </ThemeProvider>
  );
}
