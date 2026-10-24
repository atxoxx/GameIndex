import type { ViewDensity } from "../../types/game";

interface DealsSkeletonGridProps {
  density: ViewDensity;
  count?: number;
}

/**
 * Loading placeholders that mirror the real tile geometry (landscape art,
 * two text lines, price row) so the grid does not jump when data lands.
 */
export default function DealsSkeletonGrid({
  density,
  count = 8,
}: DealsSkeletonGridProps) {
  return (
    <div className={`deals-grid deals-grid--${density}`} aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="deals-skeleton">
          <div className="deals-skeleton__art" />
          <div className="deals-skeleton__body">
            <span className="deals-skeleton__line deals-skeleton__line--title" />
            <span className="deals-skeleton__line deals-skeleton__line--meta" />
            <div className="deals-skeleton__row">
              <span className="deals-skeleton__line deals-skeleton__line--price" />
              <span className="deals-skeleton__line deals-skeleton__line--badge" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
