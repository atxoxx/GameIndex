import { useId } from "react";

/**
 * OverlaySparkline — a dependency-free SVG area chart for the overlay's
 * rolling telemetry window. Colors come from theme tokens via CSS so every
 * theme (light included) renders correctly.
 */
export interface OverlaySparklineProps {
  /** Samples, oldest first. Non-finite entries are ignored. */
  values: number[];
  /** Fixed upper bound for the Y axis (e.g. 100 for percentages). */
  max?: number;
  /** Caption for the series. */
  label?: string;
  /** Latest value shown in the header, when provided. */
  value?: number;
  /** Unit suffix for the value (e.g. `%`, `°`). */
  unit?: string;
  /** Full-width, taller treatment for a headline metric. */
  featured?: boolean;
  /** Message shown inside the plot while there is no data to draw. */
  emptyLabel?: string;
  className?: string;
  testId?: string;
}

const WIDTH = 100;
const HEIGHT = 32;
const PAD = 2;

export default function OverlaySparkline({
  values,
  max,
  label,
  value,
  unit,
  featured = false,
  emptyLabel,
  className,
  testId = "overlay-sparkline",
}: OverlaySparklineProps) {
  // `useId` can contain `:` which is unsafe inside a `url(#…)` reference.
  const gradientId = `spark-${useId().replace(/[:]/g, "")}`;

  const clean = values.filter((entry) => Number.isFinite(entry));
  const hasData = clean.length > 1;
  const peak = Math.max(1, max ?? (clean.length ? Math.max(...clean) : 0));
  const usable = HEIGHT - PAD * 2;
  const step = clean.length > 1 ? (WIDTH - PAD * 2) / (clean.length - 1) : 0;
  const baseline = HEIGHT - PAD;

  const points = clean.map((entry, index) => {
    const x = PAD + index * step;
    const clamped = Math.min(Math.max(entry, 0), peak);
    const y = PAD + usable - (clamped / peak) * usable;
    return [x, y] as const;
  });

  const line = points
    .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" ");

  const area =
    points.length > 1
      ? `M ${points[0][0].toFixed(2)},${baseline.toFixed(2)} ` +
        points.map(([x, y]) => `L ${x.toFixed(2)},${y.toFixed(2)}`).join(" ") +
        ` L ${points[points.length - 1][0].toFixed(2)},${baseline.toFixed(2)} Z`
      : "";

  const display =
    typeof value === "number" && Number.isFinite(value)
      ? `${Math.round(value)}${unit ?? ""}`
      : null;

  return (
    <div
      className={[
        "overlay-sparkline",
        featured ? "overlay-sparkline--featured" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      data-testid={testId}
    >
      {(label || display) && (
        <div className="overlay-sparkline__head">
          {label && <span className="overlay-sparkline__label">{label}</span>}
          {display && <span className="overlay-sparkline__value">{display}</span>}
        </div>
      )}
      <div className="overlay-sparkline__plot">
        <svg
          className="overlay-sparkline__svg"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={label}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop className="overlay-sparkline__stop-top" offset="0" />
              <stop className="overlay-sparkline__stop-bottom" offset="1" />
            </linearGradient>
          </defs>
          {area && (
            <path
              className="overlay-sparkline__area"
              d={area}
              fill={`url(#${gradientId})`}
            />
          )}
          {hasData ? (
            <polyline className="overlay-sparkline__line" points={line} />
          ) : (
            <line
              className="overlay-sparkline__baseline"
              x1={PAD}
              y1={baseline}
              x2={WIDTH - PAD}
              y2={baseline}
            />
          )}
        </svg>
        {!hasData && emptyLabel && (
          <span className="overlay-sparkline__empty">{emptyLabel}</span>
        )}
      </div>
    </div>
  );
}
