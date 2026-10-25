import type { ScoreTone } from "./ratingsShared";

export interface RatingsScoreboardCell {
  id: string;
  label: string;
  value: string;
  meta?: string;
  tone: ScoreTone | null;
  /** When provided the cell becomes a shortcut to the matching tab. */
  onSelect?: () => void;
}

interface RatingsScoreboardProps {
  cells: RatingsScoreboardCell[];
  ariaLabel: string;
}

/**
 * The score strip under the hero: every source at a glance. Cells that
 * have a detail view are buttons that jump straight to it; IGDB, which
 * has no breakdown, stays a static cell.
 */
export function RatingsScoreboard({ cells, ariaLabel }: RatingsScoreboardProps) {
  if (cells.length === 0) return null;

  return (
    <div className="rt-scoreboard" role="group" aria-label={ariaLabel}>
      {cells.map((cell) => {
        const className = [
          "rt-score",
          cell.tone ? `rt-score--${cell.tone}` : "rt-score--none",
          cell.onSelect ? "rt-score--action" : "",
        ]
          .filter(Boolean)
          .join(" ");

        const body = (
          <>
            <span className="rt-score__label">{cell.label}</span>
            <span className="rt-score__value">{cell.value}</span>
            {cell.meta && <span className="rt-score__meta">{cell.meta}</span>}
          </>
        );

        return cell.onSelect ? (
          <button
            key={cell.id}
            type="button"
            className={className}
            onClick={cell.onSelect}
            aria-label={`${cell.label}: ${cell.value}. ${cell.meta ?? ""}`.trim()}
          >
            {body}
          </button>
        ) : (
          <div key={cell.id} className={className}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

export default RatingsScoreboard;
