import { useMemo, useRef, useState } from "react";
import { useLanguage } from "../../context/LanguageContext";
import type { PerfSample } from "../../types/game";

export interface ActivitySparklineProps {
  data: { x: number; y: number }[];
  label: string;
  unit: string;
  value: number;
  max?: number;
  min?: number;
  thresholds?: { warn: number; danger: number };
  inverted?: boolean;
  /** Render a smooth spline instead of straight segments. */
  smooth?: boolean;
  /** Show trend pill badge */
  showTrend?: boolean;
}

function buildSmoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  if (pts.length < 3) {
    return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  }
  let d = `M ${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
  }
  return d;
}

export function ActivitySparkline({
  data,
  label,
  unit,
  value,
  max,
  min,
  thresholds,
  inverted,
  smooth = true,
  showTrend = true,
}: Readonly<ActivitySparklineProps>) {
  const { t } = useLanguage();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const getStatus = (): "good" | "warn" | "danger" => {
    if (!thresholds || !Number.isFinite(value)) return "good";
    if (inverted) {
      if (value <= thresholds.danger) return "danger";
      if (value <= thresholds.warn) return "warn";
      return "good";
    }
    if (value >= thresholds.danger) return "danger";
    if (value >= thresholds.warn) return "warn";
    return "good";
  };

  const status = getStatus();
  const statusColors = {
    good: "var(--color-success)",
    warn: "var(--color-warning)",
    danger: "var(--color-danger)",
  };
  const color = statusColors[status];

  // Calculate trend from first quarter to last quarter of data
  const trend = useMemo(() => {
    if (!showTrend || !data || data.length < 4) return null;
    const qLen = Math.max(1, Math.floor(data.length / 4));
    const firstQ = data.slice(0, qLen).reduce((acc, p) => acc + p.y, 0) / qLen;
    const lastQ = data.slice(-qLen).reduce((acc, p) => acc + p.y, 0) / qLen;
    if (firstQ <= 0) return null;
    const diffPct = Math.round(((lastQ - firstQ) / firstQ) * 100);
    return diffPct;
  }, [showTrend, data]);

  const activeValue = hoverIdx !== null
    ? (unit === "GB" ? Number(data[hoverIdx].y.toFixed(1)) : Math.round(data[hoverIdx].y))
    : value;

  const renderValueGroup = () => (
    <div className="activity-sparkline__value-group">
      <div className="activity-sparkline__value-item">
        <span className="activity-sparkline__value-item-label">
          {hoverIdx !== null ? "CURRENT" : t("activitySpark.avg")}
        </span>
        <span
          className={`activity-sparkline__value activity-sparkline__value--${status}`}
          style={{ color }}
        >
          {Number.isFinite(activeValue) ? activeValue : "—"}
          {unit}
        </span>
      </div>
      {max !== undefined && Number.isFinite(max) && (
        <div className="activity-sparkline__value-item">
          <span className="activity-sparkline__value-item-label">{t("activitySpark.max")}</span>
          <span className="activity-sparkline__value activity-sparkline__value--max">
            {max}
            {unit}
          </span>
        </div>
      )}
      {min !== undefined && Number.isFinite(min) && (
        <div className="activity-sparkline__value-item">
          <span className="activity-sparkline__value-item-label">{t("activitySpark.min")}</span>
          <span className="activity-sparkline__value activity-sparkline__value--min">
            {min}
            {unit}
          </span>
        </div>
      )}
    </div>
  );

  if (!data || data.length < 2) {
    return (
      <div className="activity-sparkline">
        {label && <span className="activity-sparkline__label">{label}</span>}
        {renderValueGroup()}
      </div>
    );
  }

  const width = 240;
  const height = 46;
  const padding = 4;
  const yValues = data.map((d) => d.y);
  const minVal = Math.min(...yValues);
  const maxVal = Math.max(...yValues);
  const dataRange = maxVal - minVal || 1;

  const toXY = (d: { x: number; y: number }, i: number) => {
    const x = (i / (data.length - 1)) * width;
    const y =
      height - padding - ((d.y - minVal) / dataRange) * (height - padding * 2);
    return { x, y };
  };

  const points = data.map(toXY);

  const linePath = smooth
    ? buildSmoothPath(points)
    : points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");

  const thresholdY = useMemo(() => {
    if (!thresholds) return null;
    const tVal = thresholds.warn;
    if (tVal < minVal || tVal > maxVal) return null;
    return height - padding - ((tVal - minVal) / dataRange) * (height - padding * 2);
  }, [thresholds, minVal, maxVal, height, padding, dataRange]);

  const hoverHandle = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const scaleX = width / rect.width;
    const mouseX = (e.clientX - rect.left) * scaleX;
    const idx = Math.round((mouseX / width) * (data.length - 1));
    setHoverIdx(Math.max(0, Math.min(data.length - 1, idx)));
  };

  const hoverPoint = hoverIdx !== null ? points[hoverIdx] : null;

  return (
    <div className="activity-sparkline">
      <div className="activity-sparkline__header">
        {label && <span className="activity-sparkline__label">{label}</span>}
        {hoverIdx !== null ? (
          <span
            className="activity-sparkline__trend-pill activity-sparkline__hover-badge"
            style={{ color, borderColor: color }}
          >
            {activeValue}{unit}
          </span>
        ) : trend !== null ? (
          <span
            className={`activity-sparkline__trend-pill ${
              trend > 3 ? "is-up" : trend < -3 ? "is-down" : "is-stable"
            }`}
          >
            {trend > 0 ? `+${trend}% ▲` : trend < 0 ? `${trend}% ▼` : "—"}
          </span>
        ) : null}
      </div>

      <div className="activity-sparkline__chart">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height={height}
          preserveAspectRatio="none"
          style={{ cursor: "crosshair", display: "block" }}
          onMouseMove={hoverHandle}
          onMouseLeave={() => setHoverIdx(null)}
        >
          {/* Threshold guide line */}
          {thresholdY !== null && (
            <line
              x1={0}
              y1={thresholdY}
              x2={width}
              y2={thresholdY}
              stroke={color}
              strokeWidth="1"
              strokeDasharray="3 3"
              opacity={0.45}
            />
          )}

          {/* Crisp line without blurry shadow or muddy gradient area */}
          <path
            d={linePath}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Min / Max glowing markers */}
          {(() => {
            const minI = yValues.indexOf(minVal);
            const maxI = yValues.indexOf(maxVal);
            return (
              <>
                <circle cx={points[minI].x} cy={points[minI].y} r={2.5} fill={color} opacity={0.6} />
                <circle cx={points[maxI].x} cy={points[maxI].y} r={3} fill={color} opacity={0.9} />
              </>
            );
          })()}

          {/* Hover crosshair guide + readout marker */}
          {hoverPoint && (
            <>
              <line
                x1={hoverPoint.x}
                y1={0}
                x2={hoverPoint.x}
                y2={height}
                stroke="var(--color-accent)"
                strokeWidth={1.2}
                strokeDasharray="2 2"
                opacity={0.7}
              />
              <circle
                cx={hoverPoint.x}
                cy={hoverPoint.y}
                r={4}
                fill={color}
                stroke="var(--color-bg-primary)"
                strokeWidth={1.5}
              />
            </>
          )}
        </svg>
      </div>

      {renderValueGroup()}
    </div>
  );
}

export function samplesToSparklineData(
  samples: PerfSample[] | Record<string, unknown>[],
  metric: string
): { x: number; y: number }[] {
  if (!samples || samples.length === 0) return [];
  const step = Math.max(1, Math.floor(samples.length / 30));
  return samples
    .filter((_, i) => i % step === 0)
    .map((sample, idx) => {
      const record = sample as Record<string, unknown>;
      const val = (record[metric] || record[metric.replace("MB", "")]) as number;
      return {
        x: idx,
        y: typeof val === "number" ? val : 0,
      };
    });
}
