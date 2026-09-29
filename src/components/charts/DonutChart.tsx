import { useMemo, useState } from "react";
import { useLanguage } from "../../context/LanguageContext";

export interface DonutSlice {
  value: number;
  color: string;
  label: string;
}

export interface DonutChartProps {
  slices: DonutSlice[];
  size?: number;
  innerRadius?: number;
  showLegend?: boolean;
  formatValue?: (v: number) => string;
  centerLabel?: string;
  onSliceClick?: (slice: DonutSlice, index: number) => void;
}

const DONUT_COLORS = [
  "var(--color-accent)",
  "var(--color-info)",
  "var(--color-success)",
  "var(--color-warning)",
  "var(--color-danger)",
  "var(--color-stale, var(--color-text-muted))",
  "color-mix(in srgb, var(--color-accent) 60%, var(--color-info))",
  "color-mix(in srgb, var(--color-info) 60%, var(--color-success))",
  "color-mix(in srgb, var(--color-success) 60%, var(--color-warning))",
  "color-mix(in srgb, var(--color-warning) 60%, var(--color-danger))",
];

export default function DonutChart({
  slices,
  size = 210,
  innerRadius = 58,
  showLegend = true,
  formatValue = (v) => String(v),
  centerLabel,
  onSliceClick,
}: DonutChartProps) {
  const { t } = useLanguage();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const total = useMemo(() => {
    const raw = slices.reduce((s, sl) => s + sl.value, 0) || 1;
    return Math.round(raw * 100) / 100;
  }, [slices]);

  const arcs = useMemo(() => {
    let startAngle = -90;
    return slices
      .filter((s) => s.value > 0)
      .map((slice, i) => {
        const pct = slice.value / total;
        const angle = pct * 360;
        const endAngle = startAngle + angle;
        const color = slice.color || DONUT_COLORS[i % DONUT_COLORS.length];

        const cx = size / 2;
        const cy = size / 2;
        const outerR = size / 2 - 6;
        const innerR = innerRadius;

        const startRad = (startAngle * Math.PI) / 180;
        const endRad = (endAngle * Math.PI) / 180;

        const x1 = cx + outerR * Math.cos(startRad);
        const y1 = cy + outerR * Math.sin(startRad);
        const x2 = cx + outerR * Math.cos(endRad);
        const y2 = cy + outerR * Math.sin(endRad);

        const ix1 = cx + innerR * Math.cos(startRad);
        const iy1 = cy + innerR * Math.sin(startRad);
        const ix2 = cx + innerR * Math.cos(endRad);
        const iy2 = cy + innerR * Math.sin(endRad);

        const largeArc = angle > 180 ? 1 : 0;

        const d = [
          `M ${x1} ${y1}`,
          `A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2}`,
          `L ${ix2} ${iy2}`,
          `A ${innerR} ${innerR} 0 ${largeArc} 0 ${ix1} ${iy1}`,
          "Z",
        ].join(" ");

        const midAngle = startAngle + angle / 2;
        const midRad = (midAngle * Math.PI) / 180;
        // Direction vector for slight outward hover expansion
        const popX = Math.cos(midRad) * 4;
        const popY = Math.sin(midRad) * 4;

        const result = {
          d,
          color,
          label: slice.label,
          value: slice.value,
          pct,
          startAngle,
          endAngle,
          popX,
          popY,
          slice,
        };
        startAngle = endAngle;
        return result;
      });
  }, [slices, total, size, innerRadius]);

  const activeArc = hoveredIndex !== null ? arcs[hoveredIndex] : null;

  return (
    <div className="donut-chart-container">
      <div className="donut-chart-svg-wrap" style={{ width: size, height: size }}>
        <svg
          viewBox={`0 0 ${size} ${size}`}
          width="100%"
          height="100%"
          style={{ overflow: "visible" }}
        >
          <defs>
            {arcs.map((arc, i) => (
              <filter
                key={`donut-glow-${i}`}
                id={`donut-glow-${i}`}
                x="-20%"
                y="-20%"
                width="140%"
                height="140%"
              >
                <feDropShadow
                  dx="0"
                  dy="0"
                  stdDeviation="4"
                  floodColor={arc.color}
                  floodOpacity="0.6"
                />
              </filter>
            ))}
          </defs>

          {arcs.map((arc, i) => {
            const isHovered = hoveredIndex === i;
            const isDimmed = hoveredIndex !== null && !isHovered;

            return (
              <g
                key={`arc-${i}`}
                transform={isHovered ? `translate(${arc.popX}, ${arc.popY})` : undefined}
                style={{
                  transition: "transform 180ms cubic-bezier(0.16, 1, 0.3, 1)",
                  cursor: "pointer",
                }}
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex(null)}
                onClick={() => onSliceClick?.(arc.slice, i)}
              >
                <path
                  d={arc.d}
                  fill={arc.color}
                  opacity={isDimmed ? 0.35 : 1}
                  stroke="var(--color-bg-primary)"
                  strokeWidth="2.5"
                  filter={isHovered ? `url(#donut-glow-${i})` : "none"}
                  style={{
                    transition: "opacity 160ms, filter 160ms",
                  }}
                >
                  <title>
                    {arc.label}: {formatValue(arc.value)} ({Math.round(arc.pct * 100)}%)
                  </title>
                </path>
              </g>
            );
          })}

          {/* Dynamic Center content */}
          {activeArc ? (
            <>
              <text
                x={size / 2}
                y={size / 2 - 8}
                textAnchor="middle"
                fill="var(--color-text-primary)"
                fontSize="18"
                fontWeight="800"
              >
                {Math.round(activeArc.pct * 100)}%
              </text>
              <text
                x={size / 2}
                y={size / 2 + 10}
                textAnchor="middle"
                fill="var(--color-text-secondary)"
                fontSize="10.5"
                fontWeight="600"
                style={{ textTransform: "capitalize" }}
              >
                {activeArc.label.length > 14
                  ? `${activeArc.label.slice(0, 12)}…`
                  : activeArc.label}
              </text>
              <text
                x={size / 2}
                y={size / 2 + 24}
                textAnchor="middle"
                fill="var(--color-text-muted)"
                fontSize="9.5"
                fontWeight="500"
              >
                {formatValue(activeArc.value)}
              </text>
            </>
          ) : (
            <>
              <text
                x={size / 2}
                y={size / 2 - 2}
                textAnchor="middle"
                fill="var(--color-text-primary)"
                fontSize="18"
                fontWeight="800"
              >
                {formatValue(total)}
              </text>
              <text
                x={size / 2}
                y={size / 2 + 16}
                textAnchor="middle"
                fill="var(--color-text-muted)"
                fontSize="11"
                fontWeight="600"
              >
                {centerLabel || t("charts.total")}
              </text>
            </>
          )}
        </svg>
      </div>

      {/* Interactive Legend with Progress Mini-Bars */}
      {showLegend && (
        <div className="donut-chart-legend">
          {arcs.map((arc, i) => {
            const isHovered = hoveredIndex === i;
            const isDimmed = hoveredIndex !== null && !isHovered;

            return (
              <button
                key={`leg-${i}`}
                type="button"
                className={`donut-legend-item ${isHovered ? "is-hovered" : ""} ${
                  isDimmed ? "is-dimmed" : ""
                }`}
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex(null)}
                onClick={() => onSliceClick?.(arc.slice, i)}
              >
                <div
                  className="donut-legend-dot"
                  style={{
                    background: arc.color,
                    boxShadow: isHovered ? `0 0 8px ${arc.color}` : "none",
                  }}
                />
                <span className="donut-legend-label" title={arc.label}>
                  {arc.label}
                </span>

                <div className="donut-legend-bar-wrap">
                  <div
                    className="donut-legend-bar-fill"
                    style={{
                      width: `${Math.round(arc.pct * 100)}%`,
                      backgroundColor: arc.color,
                    }}
                  />
                </div>

                <span className="donut-legend-pct">
                  {Math.round(arc.pct * 100)}%
                </span>
                <span className="donut-legend-val">
                  {formatValue(arc.value)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
