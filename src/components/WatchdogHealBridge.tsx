// Watchdog healing bridge — listens for `game-failed` from the backend
// watcher (launch never attached, or the process died within seconds)
// and surfaces a guided heal dialog. No auto-retry: every action is a
// deliberate user choice, and "don't ask again" silences a game for
// good (games the user always quit quickly stay quiet).

import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { openPath } from "@tauri-apps/plugin-opener";
import { useGames } from "../context/GameContext";
import { useLanguage } from "../context/LanguageContext";
import { useToast } from "../context/ToastContext";
import { Button } from "./ui";
import {
  failureReason,
  installFolderOf,
  muteGame,
  shouldSurfaceFailure,
  type WatchdogFailure,
} from "./watchdog/heal";

// Same UA check `useLaunch` uses — the heal dialog is app-shell level,
// above SettingsProvider, so a settings-derived flag is out of reach.
const IS_WINDOWS_HOST =
  typeof navigator === "undefined" ||
  (navigator.platform || "").toLowerCase().includes("win") ||
  (navigator.userAgent || "").toLowerCase().includes("windows");

/**
 * Mounted once in the app shell. while the dialog is open a newer
 * failure replaces the shown one (e.g. a relaunch that fails again —
 * the user then sees the up-to-date diagnosis).
 */
export default function WatchdogHealBridge() {
  const { games, launchGame } = useGames();
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [failure, setFailure] = useState<WatchdogFailure | null>(null);

  useEffect(() => {
    const unlisten = listen<WatchdogFailure>("game-failed", (event) => {
      const f = event.payload;
      if (!shouldSurfaceFailure(f, (id) => games.some((g) => g.id === id))) return;
      setFailure(f);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [games]);

  const game = failure ? games.find((g) => g.id === failure.gameId) ?? null : null;
  const close = useCallback(() => setFailure(null), []);

  function relaunch(asAdmin: boolean) {
    if (!game || !failure) return;
    setFailure(null);
    launchGame(game, asAdmin ? { path: game.path, runAsAdmin: true } : undefined);
    showToast(t("gameContext.launched", { name: game.name }), "info");
  }

  function openFolder() {
    if (!game?.path) return;
    close();
    openPath(installFolderOf(game.path)).catch((err) =>
      showToast(t("watchdog.folderError", { error: String(err) }), "error")
    );
  }

  function muteAndClose() {
    if (!failure) return;
    muteGame(failure.gameId);
    close();
  }

  if (!failure) return null;

  const reason = failureReason(failure);

  return (
    <div className="modal-backdrop" onMouseDown={close} role="presentation">
      <div
        className="modal heal-modal"
        onMouseDown={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="heal-modal-title"
      >
        <div className="modal-header">
          <div className="modal-header-icon modal-header-icon--warning">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <div className="modal-header-text">
            <h2 className="modal-title" id="heal-modal-title">
              {t("watchdog.title", { name: failure.gameName })}
            </h2>
          </div>
        </div>

        <div className="modal-body heal-modal__body">
          <p className="heal-modal__reason">
            {reason === "crashed"
              ? t("watchdog.crashed", { seconds: failure.elapsedSeconds })
              : t("watchdog.notFound")}
          </p>
          <p className="heal-modal__hint">
            {reason === "crashed" ? t("watchdog.crashedHint") : t("watchdog.notFoundHint")}
          </p>
        </div>

        <div className="modal-footer heal-modal__footer">
          <div className="heal-modal__actions">
            <Button variant="secondary" size="md" onClick={() => relaunch(false)}>
              {t("watchdog.relaunch")}
            </Button>
            {IS_WINDOWS_HOST && (
              <Button variant="secondary" size="md" onClick={() => relaunch(true)}>
                {t("watchdog.relaunchAdmin")}
              </Button>
            )}
            {game?.path && (
              <Button variant="ghost" size="md" onClick={openFolder}>
                {t("watchdog.openFolder")}
              </Button>
            )}
            <Button variant="ghost" size="md" onClick={muteAndClose}>
              {t("watchdog.mute")}
            </Button>
            <Button variant="ghost" size="md" onClick={close}>
              {t("watchdog.dismiss")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
