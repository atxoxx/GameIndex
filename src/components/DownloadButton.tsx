// Self-contained "Download" trigger + modal.
//
// Renders a button that opens a `DownloadModal` on click. Owns its
// own open/close state so callers don't have to manage modal
// plumbing themselves — they just drop in `<DownloadButton
// gameName={…} gameId={…} />` next to their existing actions.
//
// The button has two visual variants:
//
//   * "default" — neutral outline button, sits next to "Launch Game"
//                  in the GamePage hero
//   * "prominent" — accent-tinted button, used as the primary CTA
//                  on a not-yet-added StoreGameDetail card

import { useState, type CSSProperties } from "react";
import DownloadModal from "./DownloadModal";
import { useLanguage } from "../context/LanguageContext";

export interface DownloadButtonProps {
  gameName: string;
  gameId?: string;
  /** Poster of the game page this download starts from (URL or base64). */
  gamePoster?: string;
  steamAppId?: number;
  /** Visual style. Default = "default". */
  variant?: "default" | "prominent";
  /** Optional label override. Default = "Download". */
  label?: string;
  /**
   * When true, the button swaps to the accent "Update available"
   * label + styling. Set by `useGameUpdateCheck` for installed games.
   */
  updateAvailable?: boolean;
  /**
   * When true, the button keeps the default label but its tooltip says
   * "Up to date". Set by `useGameUpdateCheck` for installed games.
   */
  upToDate?: boolean;
  /** Extra inline style. Useful for grid placement. */
  style?: CSSProperties;
  /** Optional className. */
  className?: string;
}

export default function DownloadButton({
  gameName,
  gameId,
  gamePoster,
  steamAppId,
  variant = "default",
  label = "Download",
  updateAvailable = false,
  upToDate = false,
  style,
  className,
}: DownloadButtonProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  const buttonLabel = updateAvailable ? t("downloads.updateAvailable") : label;
  const buttonTitle = updateAvailable
    ? t("downloads.updateAvailable")
    : upToDate
      ? t("downloads.upToDate")
      : t("downloads.findDownloadSource");

  return (
    <>
      <button
        type="button"
        className={`game-download-btn game-download-btn--${variant}${updateAvailable ? " game-download-btn--update" : ""}${className ? ` ${className}` : ""}`}
        onClick={() => setOpen(true)}
        style={style}
        title={buttonTitle}
        aria-label={t("downloads.openDownloadSourcesAria")}
      >
        {updateAvailable ? (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
          </svg>
        ) : (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        )}
        {buttonLabel}
      </button>
      {open && (
        <DownloadModal
          gameName={gameName}
          gameId={gameId}
          gamePoster={gamePoster}
          steamAppId={steamAppId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
