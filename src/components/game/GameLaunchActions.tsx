import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useToast } from "../../context/ToastContext";
import { useGames, useLiveElapsed } from "../../context/GameContext";
import { useGameUpdateCheck } from "../../hooks/useGameUpdateCheck";
import { IconDownload, IconPlay } from "./icons";
import DownloadButton from "../DownloadButton";
import GameExecutablePickerModal from "./GameExecutablePickerModal";
import { formatPlayTime, gameDisplayName, type Game } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";

/**
 * GameLaunchActions
 *
 *  The button cluster on the hero overlay:
 *   - "Install via Steam" (only when the game is a Steam title
 *     that isn't installed)
 *   - "Launch Game" (disabled + pulsing dot when running)
 *   - The shared DownloadButton (magnet / direct / debrid flow)
 *
 *  Owns no local state; reads `isRunning` from the GameContext and
 *  calls `launchGame` to start the process. Errors during the
 *  Steam install hand-off are surfaced through the toast context
 *  so the rest of the app doesn't have to know about it.
 */

interface GameLaunchActionsProps {
  game: Game;
  onLaunch: () => void;
  size?: "sm" | "md";
}

export default function GameLaunchActions({
  game,
  onLaunch,
  size = "md",
}: GameLaunchActionsProps) {
  const { runningGameIds, closingGameIds, forceCloseGame, launchGame } = useGames();
  const liveElapsed = useLiveElapsed();
  const { showToast } = useToast();
  const { t } = useLanguage();
  // For installed games, a background check surfaces a "Update
  // available" label on the DownloadButton when the sources carry a
  // newer version than the installed exe.
  const { status: updateStatus } = useGameUpdateCheck(game);
  const isRunning = runningGameIds.includes(game.id);
  // Watcher-reported grace period (process gone, but may be a launcher
  // hand-off) — show "Closing…" instead of "Running" during the window.
  const watcherClosing = closingGameIds.includes(game.id);
  // In-flight flag for the destructive action. Set when the user
  // clicks "Force Close" and held until the running indicator
  // clears (which happens via the `game-exited` event arriving on
  // the next render tick). Lets us:
  //   1. Disable the button so a frantic spam-click doesn't fire
  //      N parallel `force_close_game` IPCs that each try to grab
  //      the watcher mutex.
  //   2. Surface a "Closing…" status so the user has feedback the
  //      click registered before the underlying OS process dies.
  const [isClosing, setIsClosing] = useState(false);
  // Open state for the executables picker (per-exe hero launch).
  const [pickerOpen, setPickerOpen] = useState(false);

  // Reset the in-flight flag once the running indicator has cleared.
  // Listening to `isRunning` (not the click) means we never race the
  //    game-exited event — if the kill fails outright and the watcher
  //    entry sticks around, the flag stays true and the button stays
  //    disabled, which is the safe fallback.
  useEffect(() => {
    if (!isRunning) {
      setIsClosing(false);
    }
  }, [isRunning]);

  function handleForceClose() {
    if (isRunning) {
      setIsClosing(true);
      forceCloseGame(game);
    }
  }

  const liveMinutes = liveElapsed[game.id] ? Math.floor(liveElapsed[game.id] / 60) : 0;
  const runningLabel = watcherClosing
    ? t("game.closing")
    : liveMinutes > 0
      ? t("game.runningTime", { time: formatPlayTime(liveMinutes) })
      : t("game.running");

  const showInstall =
    !game.installed && game.platform === "Steam" && game.steamAppId;

  function handleInstall() {
    if (!game.steamAppId) return;
    openUrl(`steam://install/${game.steamAppId}`).catch((err) =>
      showToast(t("launch.installFailedToast", { err: String(err) }), "error")
    );
  }

  return (
    <div className={`game-launch-actions game-launch-actions--${size}`}>
      {showInstall && (
        <button
          type="button"
          className="game-launch-btn game-launch-btn--install"
          onClick={handleInstall}
        >
          <IconDownload size={16} />
          {t("game.installViaSteam")}
        </button>
      )}
      {isRunning ? (
        // Running state — surfaces both a passive status pill and a
        // destructive action button. Splitting them keeps "Running…" as
        // pure informational feedback (still disabled + pulsing dot)
        // while the adjacent "Force Close" carries the click affordance.
        // The force-close action terminates the process and records the
        // session via the same `game-exited` path as a natural exit.
        <>
          <button type="button" className="game-launch-btn running" disabled>
            <span className="running-dot-pulse" />
            {runningLabel}
          </button>
          <button
            type="button"
            className="game-launch-btn game-launch-btn--force-close"
            onClick={handleForceClose}
            disabled={isClosing}
            title={isClosing ? t("launch.closingTitle", { name: gameDisplayName(game) }) : t("launch.forceCloseTitle", { name: gameDisplayName(game) })}
            aria-label={t("launch.forceCloseTitle", { name: gameDisplayName(game) })}
          >
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="6" y="6" width="12" height="12" rx="1.5" />
            </svg>
            {isClosing ? t("game.closing") : t("game.forceClose")}
          </button>
        </>
      ) : (
        <>
          {game.extraExecutables && game.extraExecutables.length > 0 ? (
            // Multi-exe layout: play stays the default launch target; the
            // attached chevron opens the executables picker.
            <div className="game-launch-split">
              <button
                type="button"
                className="game-launch-btn game-launch-btn--main"
                onClick={onLaunch}
              >
                <IconPlay size={16} />
                {t("launch.launchGame")}
              </button>
              <button
                type="button"
                className="game-launch-btn game-launch-btn--chevron"
                onClick={() => setPickerOpen(true)}
                title={t("game.execExtras.chooserTitle")}
                aria-label={t("game.execExtras.chooserTitle")}
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="game-launch-btn"
              onClick={onLaunch}
            >
              <IconPlay size={16} />
              {t("launch.launchGame")}
            </button>
          )}
        </>
      )}
      <DownloadButton
        gameName={game.name}
        gameId={game.id}
        gamePoster={game.coverSourceUrl ?? game.bannerUrl ?? game.coverArtUrl}
        steamAppId={game.steamAppId}
        updateAvailable={updateStatus === "update-available"}
        upToDate={updateStatus === "up-to-date"}
      />
      <GameExecutablePickerModal
        game={game}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onLaunch={(exe) => launchGame(game, exe)}
        launchGame={launchGame}
      />
    </div>
  );
}
