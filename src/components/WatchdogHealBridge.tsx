// Watchdog healing bridge — listens for `game-failed` from the backend
// watcher (launch never attached, or the process died within seconds)
// and surfaces a guided heal dialog. No auto-retry: every action is a
// deliberate user choice, and "don't ask again" silences a game for
// good (games the user always quit quickly stay quiet).

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, FolderOpen, Terminal, X } from "lucide-react";
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

  /** The launch target that failed: an extra executable keeps its own path and
   *  arguments, so "Relaunch" retries exactly what just died. */
  const failedExtra = failure?.executable
    ? game?.extraExecutables?.find(
        (exe) => exe.path.toLowerCase() === failure.executable?.toLowerCase(),
      ) ?? null
    : null;
  const executableName = failure?.executable
    ? failure.executable.split(/[/\\]/).pop() || failure.executable
    : null;

  function relaunch(asAdmin: boolean) {
    if (!game || !failure) return;
    setFailure(null);
    const override = failedExtra
      ? { ...failedExtra, runAsAdmin: asAdmin || failedExtra.runAsAdmin }
      : asAdmin
        ? { path: game.path, runAsAdmin: true }
        : undefined;
    launchGame(game, override);
    showToast(t("gameContext.launched", { name: game.name }), "info");
  }

  function openFolder() {
    const target = failure?.executable || game?.path;
    if (!target) return;
    close();
    openPath(installFolderOf(target)).catch((err) =>
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
        <div className="modal-header heal-modal__header">
          <h2 className="modal-title" id="heal-modal-title">
            {t("watchdog.title", { name: failure.gameName })}
          </h2>
          <button
            type="button"
            className="heal-modal__close"
            onClick={close}
            aria-label={t("common.close")}
            title={t("common.close")}
          >
            <X size={16} aria-hidden />
          </button>
        </div>

        <div className="modal-body heal-modal__body">
          <div className="heal-modal__diagnosis">
            <span className="heal-modal__diagnosis-icon" aria-hidden>
              <AlertTriangle size={16} />
            </span>
            <div className="heal-modal__diagnosis-text">
              <p className="heal-modal__reason">
                {reason === "crashed"
                  ? t("watchdog.crashed", { seconds: failure.elapsedSeconds })
                  : t("watchdog.notFound")}
              </p>
              <p className="heal-modal__hint">
                {reason === "crashed" ? t("watchdog.crashedHint") : t("watchdog.notFoundHint")}
              </p>
            </div>
          </div>

          {executableName ? (
            <div className="heal-modal__facts">
              <span className="heal-modal__fact" title={failure.executable}>
                <Terminal size={12} aria-hidden />
                <span className="heal-modal__fact-text">{executableName}</span>
              </span>
            </div>
          ) : null}

          {failure.executable || game?.path ? (
            <div className="heal-modal__links">
              <button type="button" className="heal-modal__link" onClick={openFolder}>
                <FolderOpen size={13} aria-hidden />
                {t("watchdog.openFolder")}
              </button>
            </div>
          ) : null}
        </div>

        <div className="modal-footer heal-modal__footer">
          <Button variant="ghost" size="sm" onClick={muteAndClose}>
            {t("watchdog.mute")}
          </Button>
          <div className="heal-modal__primary">
            {IS_WINDOWS_HOST && (
              <Button variant="secondary" size="md" onClick={() => relaunch(true)}>
                {t("watchdog.relaunchAdmin")}
              </Button>
            )}
            <Button variant="primary" size="md" onClick={() => relaunch(false)}>
              {t("watchdog.relaunch")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
