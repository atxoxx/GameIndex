import type { StatBandItem } from "../ui/StatBand";

/**
 * One metric in the overview's quick-stats row. The data still comes from
 * the shared `StatBandItem` shape; only the presentation is a card now, so
 * the row can breathe and centre itself instead of stretching edge to edge.
 */
export function QuickStatCard({ item }: { item: StatBandItem }) {
  const tone = item.tone ?? "accent";
  const progress =
    item.progress != null ? Math.max(0, Math.min(100, item.progress)) : null;

  const content = (
    <>
      <span className="quick-stat-card__head">
        {item.icon && (
          <span className="quick-stat-card__icon" aria-hidden="true">
            {item.icon}
          </span>
        )}
        <span className="quick-stat-card__label">{item.label}</span>
      </span>

      <span className="quick-stat-card__value">
        {item.value}
        {item.unit && <span className="quick-stat-card__unit">{item.unit}</span>}
      </span>

      {item.detail && <span className="quick-stat-card__detail">{item.detail}</span>}

      {progress != null && (
        <span className="quick-stat-card__bar" aria-hidden="true">
          <span
            className="quick-stat-card__fill"
            style={{ width: `${progress}%` }}
          />
        </span>
      )}
    </>
  );

  const className = [
    "quick-stat-card",
    `quick-stat-card--${tone}`,
    item.onClick ? "quick-stat-card--action" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return item.onClick ? (
    <button
      type="button"
      className={className}
      onClick={item.onClick}
      title={item.hint}
    >
      {content}
    </button>
  ) : (
    <div className={className} title={item.hint}>
      {content}
    </div>
  );
}

export default QuickStatCard;
