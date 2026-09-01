// BigScreenGameCard — oversized game card for Big Screen Mode.
// Mirrors the desktop library-card design but scaled up for TV
// viewing distance, with controller focus support via the shared
// GamepadProvider context.
//
// Focus state: card lifts with translateY(-8px), gets a glowing
// accent border. The A button triggers `onClick` (which should
// navigate to the game detail page).
//
// As of PR 1, focus registration is delegated to `useFocusable` —
// the ref callback is stable across renders, so the focus registry
// doesn't thrash on every parent render the way the previous
// `useCallback` + cleanupRef pattern did.

import { useState } from "react";
import { type Game } from "../../types/game";
import { useGames } from "../../context/GameContext";
import { useFocusable } from "../../hooks/useFocusable";
import { useLanguage } from "../../context/LanguageContext";
import { useGameCardArt } from "../../hooks/useGameCardArt";

interface BigScreenGameCardProps {
  game: Game;
  onClick: () => void;
}

export default function BigScreenGameCard({
  game,
  onClick,
}: BigScreenGameCardProps) {
  const { runningGameIds } = useGames();
  const { t } = useLanguage();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const isRunning = runningGameIds.includes(game.id);

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
      data-game-id={game.id}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      <div className="bigscreen-game-card-cover">
        {(staticPosterUrl || displayUrl) ? (
          <>
            <img
              src={staticPosterUrl || displayUrl!}
              alt={game.name}
              loading="lazy"
              decoding="async"
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
        <h3 className="bigscreen-game-card-name">{game.name}</h3>
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