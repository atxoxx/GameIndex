// The Play / Details pair used by every home hero.
//
// One implementation so focus behaviour, the running state and the
// primary-action marker cannot drift between layouts; each layout
// styles the shared classes differently.

import type { Game } from "../../../types/game";
import { gameDisplayName } from "../../../types/game";
import { useFocusable } from "../../../hooks/useFocusable";
import { useLanguage } from "../../../context/LanguageContext";

export interface HomeHeroActionsProps {
  game: Game;
  isRunning: boolean;
  onPlay: () => void;
  onOpen: () => void;
  /** Let the shell land here on route entry. */
  autoFocusPrimary?: boolean;
  /** Labels follow the layout's tone (e.g. Steam says "Store page"). */
  detailsLabel?: string;
}

export default function HomeHeroActions({
  game,
  isRunning,
  onPlay,
  onOpen,
  autoFocusPrimary = false,
  detailsLabel,
}: HomeHeroActionsProps) {
  const { t } = useLanguage();
  const playProps = useFocusable(onPlay);
  const openProps = useFocusable(onOpen);

  return (
    <div className="bst-hero-actions">
      <button
        {...playProps}
        type="button"
        className="bst-btn bst-btn--primary"
        onClick={onPlay}
        disabled={isRunning}
        data-primary-action="true"
        data-bs-autofocus={autoFocusPrimary ? "true" : undefined}
        aria-label={`${isRunning ? t("game.running") : t("game.play")} ${gameDisplayName(game)}`}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <polygon points="6 4 20 12 6 20 6 4" />
        </svg>
        <span>{isRunning ? t("game.running") : t("game.play")}</span>
      </button>
      <button
        {...openProps}
        type="button"
        className="bst-btn bst-btn--ghost"
        onClick={onOpen}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 16v-4M12 8h.01" />
        </svg>
        <span>{detailsLabel ?? t("bigscreen.home.gameHub")}</span>
      </button>
    </div>
  );
}
