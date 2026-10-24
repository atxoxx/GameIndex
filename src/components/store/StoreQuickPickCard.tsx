import { Star } from "lucide-react";
import type { StoreGameSummary } from "../../types/game";
import { ArtworkImage } from "../ui/ArtworkImage";

interface StoreQuickPickCardProps {
  game: StoreGameSummary;
  onClick: (game: StoreGameSummary) => void;
}

/**
 * The discovery-rail card. Deliberately separate from `StoreGameCard`: the
 * rail only needs artwork, title and a score, so it skips the price,
 * crack-watch, wishlist and context-menu subscriptions that the full card
 * carries. Ten of those mounted above the grid made the catalogue pay twice
 * for the same data and noticeably softened scroll performance.
 */
export default function StoreQuickPickCard({
  game,
  onClick,
}: StoreQuickPickCardProps) {
  const year = game.firstReleaseDate
    ? new Date(game.firstReleaseDate).getFullYear()
    : null;

  return (
    <button
      type="button"
      className="store-quick-pick-card"
      onClick={() => onClick(game)}
      title={game.name}
      aria-label={`${game.name}${game.rating != null ? `, ${Math.round(game.rating)}%` : ""}`}
    >
      <span className="store-quick-pick-cover">
        {game.coverUrl ? (
          <ArtworkImage src={game.coverUrl} alt="" draggable={false} />
        ) : (
          <span className="store-quick-pick-cover-fallback" aria-hidden="true" />
        )}
        {game.rating != null && (
          <span className="store-quick-pick-score">
            <Star size={9} fill="currentColor" aria-hidden="true" />
            {Math.round(game.rating)}%
          </span>
        )}
      </span>

      <span className="store-quick-pick-name">{game.name}</span>
      <span className="store-quick-pick-meta">
        {year != null && <span>{year}</span>}
        {game.genres?.[0] && <span>{game.genres[0]}</span>}
      </span>
    </button>
  );
}
