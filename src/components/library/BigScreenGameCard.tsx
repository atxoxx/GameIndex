// BigScreenGameCard — oversized game card for Big Screen Mode.
// Mirrors the desktop library-card design but scaled up for TV
// viewing distance, with controller focus support via the shared
// GamepadProvider context.
//
// Focus state: the card lifts and scales by `--bs-card-lift`, gets a
// glowing accent border. The A button triggers `onClick` (which should
// navigate to the game detail page).
//
// The card deliberately has no `data-focus-key`: focusMemory derives the
// key from `data-game-id` + the nearest `[data-rail-id]`, so the same
// game in two rails restores to the rail the user left.
//
// As of PR 1, focus registration is delegated to `useFocusable` —
// the ref callback is stable across renders, so the focus registry
// doesn't thrash on every parent render the way the previous
// `useCallback` + cleanupRef pattern did.

import { useState } from "react";
import { gameDisplayName, type Game } from "../../types/game";
import { useRunningIds } from "../../context/GameContext";
import { useFocusable } from "../../hooks/useFocusable";
import { useLanguage } from "../../context/LanguageContext";
import { useGameCardArt } from "../../hooks/useGameCardArt";
import { ArtworkImage } from "../ui/ArtworkImage";

interface BigScreenGameCardProps {
  game: Game;
  onClick: () => void;
  /**
   * Marks this card as its page's entry point. `GameGrid` sets it on
   * the first painted card so route entry lands on a game instead of
   * the search chip; rails never do.
   */
  autoFocus?: boolean;
}

export default function BigScreenGameCard({
  game,
  onClick,
  autoFocus = false,
}: BigScreenGameCardProps) {
  const runningIds = useRunningIds();
  const { t } = useLanguage();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const isRunning = runningIds.includes(game.id);

  const focusable = useFocusable(onClick);

  const { displayUrl, staticPosterUrl, animatedPosterUrl, handleError } = useGameCardArt({
    game,
    isHovered: hovered,
    isFocused: focused,
  });

  const isActive = hovered || focused;

  return (
    <div
      className={`bigscreen-game-card${isRunning ? " running" : ""}`}
      {...focusable}
      role="link"
      data-game-id={game.id}
      data-bs-autofocus={autoFocus ? "true" : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      <div className="bigscreen-game-card-cover">
        {(staticPosterUrl || displayUrl) ? (
          <>
            <ArtworkImage
              src={staticPosterUrl || displayUrl!}
              alt={gameDisplayName(game)}
              onError={handleError}
              className="bigscreen-game-card-cover-static"
            />
            {animatedPosterUrl && (isActive) && (
              <img
                src={animatedPosterUrl}
                alt=""
                aria-hidden="true"
                decoding="async"
                className="bigscreen-game-card-cover-animated is-active"
                onError={handleError}
              />
            )}
          </>
        ) : (
          <div className="bigscreen-game-card-cover-placeholder">
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              opacity={0.3}
            >
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>
        )}
        {isRunning && (
          <span className="bigscreen-game-card-running-dot" title={t("game.running")} />
        )}
      </div>
      <div className="bigscreen-game-card-body">
        <h3 className="bigscreen-game-card-name">{gameDisplayName(game)}</h3>
        <div className="bigscreen-game-card-meta">
          <span className="bigscreen-game-card-platform">{game.platform}</span>
          {game.playTime && (
            <span className="bigscreen-game-card-playtime">{game.playTime}</span>
          )}
        </div>
      </div>
    </div>
  );
}