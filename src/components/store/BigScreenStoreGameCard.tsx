import { useState } from "react";
import { useFocusable } from "../../hooks/useFocusable";
import type { StoreGameSummary } from "../../types/game";
import { useGameCardArt } from "../../hooks/useGameCardArt";

interface BigScreenStoreGameCardProps {
  game: StoreGameSummary;
  onClick: (game: StoreGameSummary) => void;
}

export default function BigScreenStoreGameCard({
  game,
  onClick,
}: BigScreenStoreGameCardProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const focusable = useFocusable(() => onClick(game));

  const { displayUrl, handleError } = useGameCardArt({
    game,
    isHovered: hovered,
    isFocused: focused,
  });

  return (
    <div
      className="bigscreen-game-card bigscreen-store-game-card"
      {...focusable}
      data-game-id={game.id}
      data-game-slug={game.slug}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      <div className="bigscreen-game-card-cover">
        {displayUrl ? (
          <img src={displayUrl} alt={game.name} loading="lazy" onError={handleError} />
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
        {game.rating != null && (
          <span className="bigscreen-store-card-rating">
            ★ {Math.round(game.rating)}
          </span>
        )}
      </div>
      <div className="bigscreen-game-card-body">
        <h3 className="bigscreen-game-card-name">{game.name}</h3>
        <div className="bigscreen-game-card-meta">
          <span className="bigscreen-game-card-platform">
            {game.platforms.slice(0, 2).join(" · ")}
          </span>
        </div>
      </div>
    </div>
  );
}
