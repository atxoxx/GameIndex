import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSplash } from "../context/SplashContext";

interface RetryEvent {
  gameId: string;
}

/**
 * Mirrors the main window's splash state machine into the standalone
 * `launch-splash` window. Opening happens in `SplashContext.open` (so the
 * window exists before `launch_game` hides the main window); this bridge
 * forwards status flips and teardown, and routes the splash window's
 * retry/closed signals back into the context.
 */
export default function LaunchSplashBridge() {
  const { record, close } = useSplash();

  // Last state pushed to Rust — the effect below only fires IPC when the
  // record actually changes, and the ref survives the record going null.
  const syncedRef = useRef<{
    startedAt: number;
    status: string;
    errorMessage: string | null;
  } | null>(null);

  const recordRef = useRef(record);
  recordRef.current = record;

  useEffect(() => {
    if (!record) {
      if (syncedRef.current !== null) {
        syncedRef.current = null;
        void invoke("close_launch_splash").catch(() => {});
      }
      return;
    }

    const synced = syncedRef.current;
    if (!synced || synced.startedAt !== record.startedAt) {
      // A fresh launch: `open_launch_splash` already reset the window.
      syncedRef.current = {
        startedAt: record.startedAt,
        status: record.status,
        errorMessage: record.errorMessage,
      };
      return;
    }

    if (synced.status !== record.status || synced.errorMessage !== record.errorMessage) {
      syncedRef.current = {
        startedAt: record.startedAt,
        status: record.status,
        errorMessage: record.errorMessage,
      };
      void invoke("update_launch_splash_status", {
        status: record.status,
        errorMessage: record.errorMessage ?? null,
      }).catch(() => {});
    }
  }, [record]);

  useEffect(() => {
    const retryUnlisten = listen<RetryEvent>("launch-splash-retry", (event) => {
      const current = recordRef.current;
      if (current?.retry && current.game.id === event.payload.gameId) {
        current.retry();
      }
    });
    const closedUnlisten = listen("launch-splash-closed", () => {
      close();
    });
    return () => {
      void retryUnlisten.then((unlisten) => unlisten());
      void closedUnlisten.then((unlisten) => unlisten());
    };
  }, [close]);

  return null;
}
