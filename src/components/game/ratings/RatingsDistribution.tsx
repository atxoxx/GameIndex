import type { DistributionRow } from "./ratingsShared";
import { rowsTotal } from "./ratingsShared";

interface RatingsDistributionProps {
  rows: DistributionRow[];
  /** Accessible name for the bar, e.g. "Critic reviews". */
  ariaLabel: string;
}

/**
 * Positive / mixed / negative split rendered as one stacked bar plus a
 * legend that carries both share and raw count. Shared by the critics,
 * player, Steam and overview blocks so every source reads the same way.
 */
export function RatingsDistribution({ rows, ariaLabel }: RatingsDistributionProps) {
  const total = rowsTotal(rows);
  if (total <= 0) return null;

  return (
    <div className="rt-dist">
      <div className="rt-dist__bar" role="img" aria-label={ariaLabel}>
        {rows.map((row) =>
          row.count > 0 ? (
            <span
              key={row.key}
              className={`rt-dist__seg rt-dist__seg--${row.tone}`}
              style={{ width: `${(row.count / total) * 100}%` }}
            />
          ) : null,
        )}
      </div>
      <ul className="rt-dist__legend">
        {rows.map((row) => (
          <li key={row.key} className={`rt-dist__legend-item rt-dist__legend-item--${row.tone}`}>
            <span className={`rt-dist__dot rt-dist__dot--${row.tone}`} aria-hidden="true" />
            <span className="rt-dist__legend-label">{row.label}</span>
            <span className="rt-dist__legend-value">
              {Math.round((row.count / total) * 100)}%
            </span>
            <span className="rt-dist__legend-count">{row.count.toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default RatingsDistribution;
