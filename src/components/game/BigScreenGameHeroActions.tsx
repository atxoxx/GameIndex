// BigScreenGameHeroActions — the game hub's hero action row.
//
// One job: make the ONE thing the user came here for obvious. The row
// renders the primary action (Play, Install, or Force Close while the
// game is running), then at most two quiet secondaries (Trailer when the
// game actually has a playable file, Find download). The primary action
// carries `data-primary-action="true"`, which is what the page focuses on
// entry — see `focusPrimaryAction`.
//
// Deliberately NOT here: Edit / Remove. Those used to sit in this row
// wired to the Back handler, so pressing them navigated away and did
// nothing they claimed. Metadata editing is a desktop task; a couch user
// gets launch, trailer, and downloads.

import { useLanguage } from "../../context/LanguageContext";
import { useFocusable } from "../../hooks/useFocusable";

/** Marks the single primary action in the hero. The page focuses it. */
export const PRIMARY_ACTION_ATTR = "data-primary-action";

/**
 * Focus the hero's primary action inside `root`. Returns whether one was
 * found. The marked element is always registered with the focus registry
 * (the row spreads `useFocusable` onto it), so focusing it also syncs the
 * engine's focused ref and D-pad navigation stays alive.
 */
export function focusPrimaryAction(root: HTMLElement | null): boolean {
  const el = root?.querySelector<HTMLElement>(`[${PRIMARY_ACTION_ATTR}="true"]`);
  if (!el) return false;
  el.focus({ preventScroll: true });
  return true;
}

export interface BigScreenGameHeroActionsProps {
  /** The game is running right now (Force Close becomes primary). */
  isRunning: boolean;
  /** A force-close request is in flight. */
  isClosing: boolean;
  /** The game is not installed but Steam can install it. */
  showInstall: boolean;
  /** The game has at least one video the lightbox can actually play. */
  hasPlayableTrailer: boolean;
  onPlay: () => void;
  onInstall: () => void;
  onForceClose: () => void;
  onDownload: () => void;
  onTrailer: () => void;
}

export default function BigScreenGameHeroActions({
  isRunning,
  isClosing,
  showInstall,
  hasPlayableTrailer,
  onPlay,
  onInstall,
  onForceClose,
  onDownload,
  onTrailer,
}: BigScreenGameHeroActionsProps) {
  const { t } = useLanguage();

  // Declared unconditionally so the hook order never depends on which
  // action is primary this render.
  const playProps = useFocusable(onPlay);
  const installProps = useFocusable(onInstall);
  const forceCloseProps = useFocusable(onForceClose);
  const downloadProps = useFocusable(onDownload);
  const trailerProps = useFocusable(onTrailer);

  return (
    <div className="bigscreen-gamepage-hero-actions">
      {isRunning ? (
        <button
          type="button"
          className="bigscreen-details-btn bigscreen-details-btn--danger"
          data-primary-action="true"
          {...forceCloseProps}
          disabled={isClosing}
        >
          {isClosing ? (
            <span className="bigscreen-gamepage-hero-btn-spinner" aria-hidden />
          ) : (
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="6" y="6" width="12" height="12" rx="1.5" />
            </svg>
          )}
          <span>{isClosing ? t("game.closing") : t("game.forceClose")}</span>
        </button>
      ) : showInstall ? (
        <button
          type="button"
          className="bigscreen-details-btn bigscreen-details-btn--primary"
          data-primary-action="true"
          {...installProps}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="20" height="20" aria-hidden>
            <polyline points="8 17 12 21 16 17" />
            <line x1="12" y1="12" x2="12" y2="21" />
            <path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29" />
          </svg>
          <span>{t("game.installViaSteam")}</span>
        </button>
      ) : (
        <button
          type="button"
          className="bigscreen-details-btn bigscreen-details-btn--primary"
          data-primary-action="true"
          {...playProps}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20" aria-hidden>
            <polygon points="6 4 20 12 6 20 6 4" />
          </svg>
          <span>{t("game.play")}</span>
        </button>
      )}

      {hasPlayableTrailer && (
        <button
          type="button"
          className="bigscreen-details-btn bigscreen-details-btn--secondary bigscreen-gamepage-hero-btn--trailer"
          {...trailerProps}
          aria-label={t("game.watchTrailer")}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden width="20" height="20">
            <polygon points="6 4 20 12 6 20 6 4" />
          </svg>
          <span>{t("game.trailer")}</span>
        </button>
      )}

      <button
        type="button"
        className="bigscreen-details-btn bigscreen-details-btn--secondary"
        {...downloadProps}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="20" height="20" aria-hidden>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        <span>{t("game.findDownload")}</span>
      </button>
    </div>
  );
}
