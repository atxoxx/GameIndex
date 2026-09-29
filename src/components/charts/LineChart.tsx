import { useMemo, useState, useCallback, useRef, useLayoutEffect, useId } from "react";
import { useLanguage } from "../../context/LanguageContext";

export interface Series {
  data: number[];
  color: string;
  label: string;
}

export interface ChartThreshold {
  value: number;
  label?: string;
  color?: string;
}

export interface ChartBand {
  from: number;
  to: number;
  color?: string;
  opacity?: number;
}

export interface LineChartProps {
  series: Series[];
  labels: string[];
  width?: number;
  height?: number;
  formatValue?: (v: number) => string;
  /**
   * Optional rich formatter used only for the floating tooltip. Falls back to
   * `formatValue` when omitted. Accepts a ReactNode so the tooltip can render
   * multi-line content (e.g. percentage on the first row, raw GB on the second
   * when a value exceeds 100%).
   */
  formatTooltipValue?: (v: number) => React.ReactNode;
  legend?: boolean;
  interactiveLegend?: boolean;
  fillOpacity?: number;
  minY?: number;
  maxY?: number;
  /** Render smooth Catmull-Rom splines instead of straight segments. */
  smooth?: boolean;
  /**
   * When `maxY` is not supplied, round the auto-computed maximum up to a
   * "nice" round number so the Y-axis reads 0/30/60/… instead of 0/28/57/….
   */
  niceMax?: boolean;
  /** Dashed horizontal reference lines (e.g. a 60 FPS target or 85°C danger). */
  thresholds?: ChartThreshold[];
  /** Shaded vertical regions spanning a value range (e.g. a hot-zone band). */
  bands?: ChartBand[];
  /** Control data point circles: 'hover-only' (default, clean line), 'always', or 'never'. */
  showDots?: "hover-only" | "always" | "never";
  /** Highlight highest peak and lowest dip with visual callout badges */
  showExtremes?: boolean;
  /** Display a quick KPI strip (Min, Avg, Max, Current) above the chart */
  showSummary?: boolean;
  /** Callback when user clicks on a data point / column */
  onPointClick?: (index: number, label: string) => void;
}

/** Round a value up to the nearest "nice" number (1/2/2.5/5/10 × 10ⁿ). */
export function niceCeil(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = Math.pow(10, exp);
  const f = v / base;
  let nf: number;
  if (f <= 1) nf = 1;
  else if (f <= 2) nf = 2;
  else if (f <= 2.5) nf = 2.5;
  else if (f <= 5) nf = 5;
  else nf = 10;
  return nf * base;
}

/**
 * Build a smooth path through the given pixel-space points using a
 * Catmull-Rom → cubic Bézier conversion. Produces a natural, continuous
 * curve without the kinks of straight segments.
 */
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

export default function LineChart({
  series,
  labels,
  width = 640,
  height = 280,
  formatValue = (v) => String(v),
  formatTooltipValue,
  legend = true,
  interactiveLegend = true,
  fillOpacity = 0.18,
  minY,
  maxY,
  smooth = false,
  niceMax = false,
  thresholds,
  bands,
  showDots = "hover-only",
  showExtremes = false,
  showSummary = false,
  onPointClick,
}: LineChartProps) {
  const { t } = useLanguage();
  const gradientId = `line-chart-fill-${useId().replace(/:/g, "")}`;
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [hiddenSeriesIndices, setHiddenSeriesIndices] = useState<Set<number>>(new Set());

  // Measure container width for responsive SVG viewBox
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const effectiveWidth = measuredWidth && measuredWidth > 0 ? measuredWidth : width;

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setMeasuredWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Filter visible series for rendering
  const activeSeries = useMemo(() => {
    return series.map((s, idx) => ({
      ...s,
      originalIndex: idx,
      visible: !hiddenSeriesIndices.has(idx),
    }));
  }, [series, hiddenSeriesIndices]);

  const visibleSeries = useMemo(() => {
    const active = activeSeries.filter((s) => s.visible);
    return active.length > 0 ? active : activeSeries;
  }, [activeSeries]);

  const chart = useMemo(() => {
    const padding = { top: 24, right: 24, bottom: 36, left: 56 };
    const chartW = Math.max(10, effectiveWidth - padding.left - padding.right);
    const chartH = Math.max(10, height - padding.top - padding.bottom);

    const allValues = visibleSeries.flatMap((s) => s.data);

    const rawMax = Math.max(...allValues, 0);
    const computedMax = niceMax ? niceCeil(rawMax) : rawMax;
    const maxVal = maxY !== undefined ? maxY : computedMax;
    const minVal = minY !== undefined ? minY : Math.min(...allValues, 0);
    const range = maxVal - minVal || 1;

    return { padding, chartW, chartH, maxVal, minVal, range };
  }, [visibleSeries, effectiveWidth, height, minY, maxY, niceMax]);

  const { padding, chartW, chartH, minVal, maxVal, range } = chart;

  // Evenly spaced X-axis labels based on container width
  const visibleLabelIndices = useMemo(() => {
    if (labels.length === 0) return new Set<number>();
    if (labels.length === 1) return new Set<number>([0]);
    const targetCount = Math.max(2, Math.min(labels.length, Math.floor(chartW / 70)));
    const indices = new Set<number>();
    for (let k = 0; k < targetCount; k++) {
      const idx = Math.round((k * (labels.length - 1)) / (targetCount - 1));
      indices.add(idx);
    }
    return indices;
  }, [labels.length, chartW]);

  const gridLines = 5;
  const gridValues = Array.from({ length: gridLines + 1 }, (_, i) =>
    Math.round(minVal + (range / gridLines) * i)
  );

  const yForValue = useCallback(
    (v: number) => padding.top + chartH - ((v - minVal) / range) * chartH,
    [padding.top, chartH, minVal, range]
  );

  function buildPath(data: number[]): string {
    if (data.length === 0) return "";
    return data
      .map((v, i) => {
        const x = padding.left + (i / Math.max(data.length - 1, 1)) * chartW;
        const y = padding.top + chartH - ((v - minVal) / range) * chartH;
        return `${i === 0 ? "M" : "L"}${x},${y}`;
      })
      .join(" ");
  }

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const scaleX = effectiveWidth / rect.width;
      const mouseX = (e.clientX - rect.left) * scaleX;

      const dataLen = series[0]?.data.length ?? 0;
      if (dataLen === 0) return;
      let idx: number;
      if (mouseX <= padding.left) idx = 0;
      else if (mouseX >= padding.left + chartW) idx = dataLen - 1;
      else idx = Math.round(((mouseX - padding.left) / chartW) * (dataLen - 1));
      const clampedIdx = Math.max(0, Math.min(dataLen - 1, idx));

      setHoverIndex(clampedIdx);
    },
    [effectiveWidth, padding.left, chartW, series]
  );

  const handleMouseLeave = useCallback(() => {
    setHoverIndex(null);
  }, []);

  const handleClick = useCallback(() => {
    if (hoverIndex !== null && onPointClick && labels[hoverIndex]) {
      onPointClick(hoverIndex, labels[hoverIndex]);
    }
  }, [hoverIndex, onPointClick, labels]);

  // Compute point positions for each series
  const pointPositions = useMemo(() => {
    return series.map((s) =>
      s.data.map((v, i) => {
        const x = padding.left + (i / Math.max(s.data.length - 1, 1)) * chartW;
        const y = padding.top + chartH - ((v - minVal) / range) * chartH;
        return { x, y, value: v };
      })
    );
  }, [series, padding.left, chartW, chartH, minVal, range]);

  // Tooltip values for hovered point
  const tooltipValues = useMemo(() => {
    if (hoverIndex === null) return null;
    return visibleSeries.map((s) => ({
      label: s.label,
      value: s.data[hoverIndex] ?? 0,
      color: s.color,
      y: pointPositions[s.originalIndex]?.[hoverIndex]?.y ?? 0,
    }));
  }, [hoverIndex, visibleSeries, pointPositions]);

  const crosshairX =
    hoverIndex !== null && pointPositions[0]?.[hoverIndex]
      ? pointPositions[0][hoverIndex].x
      : null;

  const seriesLinePath = (originalIdx: number): string =>
    smooth
      ? buildSmoothPath(pointPositions[originalIdx] ?? [])
      : buildPath(series[originalIdx].data);

  const seriesAreaPath = (originalIdx: number): string => {
    const p = pointPositions[originalIdx];
    if (!p || p.length === 0) return "";
    const bottomY = padding.top + chartH;
    const line = smooth ? buildSmoothPath(p) : buildPath(series[originalIdx].data);
    const lastX = p[p.length - 1].x;
    const firstX = p[0].x;
    return `${line} L ${lastX},${bottomY} L ${firstX},${bottomY} Z`;
  };

  // Find overall peak and valley for visual callouts
  const extremes = useMemo(() => {
    if (!showExtremes || visibleSeries.length === 0) return null;
    let peak = { val: -Infinity, si: 0, idx: 0, x: 0, y: 0 };
    let valley = { val: Infinity, si: 0, idx: 0, x: 0, y: 0 };

    visibleSeries.forEach((s) => {
      const pts = pointPositions[s.originalIndex];
      if (!pts) return;
      pts.forEach((pt, i) => {
        if (pt.value > peak.val) {
          peak = { val: pt.value, si: s.originalIndex, idx: i, x: pt.x, y: pt.y };
        }
        if (pt.value < valley.val && pt.value >= 0) {
          valley = { val: pt.value, si: s.originalIndex, idx: i, x: pt.x, y: pt.y };
        }
      });
    });

    return { peak, valley };
  }, [showExtremes, visibleSeries, pointPositions]);

  // Overall quick stats for optional summary
  const summaryStats = useMemo(() => {
    if (!showSummary || visibleSeries.length === 0) return null;
    const vals = visibleSeries.flatMap((s) => s.data);
    if (vals.length === 0) return null;
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    const current = visibleSeries[0]?.data[visibleSeries[0].data.length - 1] ?? 0;
    return { min, max, avg, current };
  }, [showSummary, visibleSeries]);

  // Interactive legend handlers
  const handleToggleSeries = (idx: number, e: React.MouseEvent) => {
    if (!interactiveLegend || series.length <= 1) return;
    if (e.altKey) {
      // Solo this series: hide all others, or if already soloed, restore all
      if (hiddenSeriesIndices.size === series.length - 1 && !hiddenSeriesIndices.has(idx)) {
        setHiddenSeriesIndices(new Set());
      } else {
        const next = new Set<number>();
        series.forEach((_, i) => {
          if (i !== idx) next.add(i);
        });
        setHiddenSeriesIndices(next);
      }
      return;
    }

    setHiddenSeriesIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        // Prevent hiding the very last series
        if (next.size < series.length - 1) {
          next.add(idx);
        }
      }
      return next;
    });
  };

  return (
    <div
      ref={containerRef}
      className="chart-line-wrapper"
      style={{ position: "relative", width: "100%" }}
    >
      {/* Quick summary stats strip */}
      {summaryStats && (
        <div className="chart-summary-strip">
          <div className="chart-summary-item">
            <span className="chart-summary-label">{t("charts.min")}</span>
            <span className="chart-summary-val">{formatValue(summaryStats.min)}</span>
          </div>
          <div className="chart-summary-item">
            <span className="chart-summary-label">{t("charts.average")}</span>
            <span className="chart-summary-val">{formatValue(summaryStats.avg)}</span>
          </div>
          <div className="chart-summary-item chart-summary-item--peak">
            <span className="chart-summary-label">{t("charts.peak")}</span>
            <span className="chart-summary-val">{formatValue(summaryStats.max)}</span>
          </div>
          <div className="chart-summary-item">
            <span className="chart-summary-label">{t("activitySpark.avg")}</span>
            <span className="chart-summary-val">{formatValue(summaryStats.current)}</span>
          </div>
        </div>
      )}

      <svg
        ref={svgRef}
        viewBox={`0 0 ${effectiveWidth} ${height}`}
        width="100%"
        height={height}
        style={{
          fontFamily: "inherit",
          cursor: onPointClick ? "pointer" : "crosshair",
          display: "block",
          overflow: "visible",
        }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
      >
        <defs>
          {series.map((s, idx) => (
            <linearGradient
              key={`series-gradient-${idx}`}
              id={`${gradientId}-${idx}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor={s.color} stopOpacity={fillOpacity} />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>

        {/* Shaded bands */}
        {bands?.map((band, bi) => {
          const lo = Math.min(band.from, band.to);
          const hi = Math.max(band.from, band.to);
          if (hi < minVal || lo > maxVal) return null;
          const yHi = yForValue(Math.min(hi, maxVal));
          const yLo = yForValue(Math.max(lo, minVal));
          const color = band.color ?? "var(--color-danger)";
          return (
            <rect
              key={`band-${bi}`}
              x={padding.left}
              y={yHi}
              width={chartW}
              height={Math.max(0, yLo - yHi)}
              fill={color}
              opacity={band.opacity ?? 0.08}
              rx="4"
            />
          );
        })}

        {/* Grid lines with soft tick labels */}
        {gridValues.map((v, i) => {
          const y = padding.top + chartH - ((v - minVal) / range) * chartH;
          return (
            <g key={`grid-${i}`}>
              <line
                x1={padding.left}
                y1={y}
                x2={padding.left + chartW}
                y2={y}
                stroke="var(--color-border)"
                strokeWidth="1"
                strokeDasharray="4 4"
                opacity={0.4}
              />
              <text
                x={padding.left - 10}
                y={y + 3.5}
                textAnchor="end"
                fill="var(--color-text-muted)"
                fontSize="10"
                fontWeight="500"
              >
                {formatValue(v)}
              </text>
            </g>
          );
        })}

        {/* Visible Series lines */}
        {visibleSeries.map((s) => (
          <g key={`series-${s.originalIndex}`}>
            {/* Area Fill only if fillOpacity is explicitly requested */}
            {fillOpacity > 0 && (
              <path
                d={seriesAreaPath(s.originalIndex)}
                fill={`url(#${gradientId}-${s.originalIndex})`}
                style={{ transition: "d 200ms ease" }}
              />
            )}
            {/* Clean crisp line without blurry glow filter */}
            <path
              d={seriesLinePath(s.originalIndex)}
              fill="none"
              stroke={s.color}
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ transition: "d 200ms ease" }}
            />
          </g>
        ))}

        {/* Threshold reference lines */}
        {thresholds?.map((tRef, ti) => {
          if (tRef.value < minVal || tRef.value > maxVal) return null;
          const y = yForValue(tRef.value);
          const color = tRef.color ?? "var(--color-text-muted)";
          return (
            <g key={`thresh-${ti}`}>
              <line
                x1={padding.left}
                y1={y}
                x2={padding.left + chartW}
                y2={y}
                stroke={color}
                strokeWidth="1.2"
                strokeDasharray="5 4"
                opacity={0.75}
              />
              {tRef.label && (
                <g transform={`translate(${padding.left + chartW - 6}, ${y - 4})`}>
                  <rect
                    x="-65"
                    y="-11"
                    width="65"
                    height="14"
                    rx="3"
                    fill="var(--color-bg-surface)"
                    opacity="0.9"
                    stroke={color}
                    strokeWidth="0.8"
                  />
                  <text
                    x="-4"
                    y="-1"
                    textAnchor="end"
                    fill={color}
                    fontSize="8.5"
                    fontWeight={700}
                    letterSpacing="0.4px"
                  >
                    {tRef.label}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* Peak & Valley callout pins */}
        {extremes?.peak && extremes.peak.val > 0 && (
          <g transform={`translate(${extremes.peak.x}, ${extremes.peak.y})`} className="chart-peak-pin">
            <circle r="5" fill="var(--color-warning)" opacity="0.25" />
            <circle r="2.5" fill="var(--color-warning)" stroke="var(--color-bg-primary)" strokeWidth="1.5" />
          </g>
        )}

        {/* Data point dots (always / small series) */}
        {(showDots === "always" || (showDots === "hover-only" && (series[0]?.data.length ?? 0) <= 12)) &&
          visibleSeries.map((s) => {
            const points = pointPositions[s.originalIndex] ?? [];
            return points.map(({ x, y }, i) => {
              const isActive = hoverIndex === i;
              const isDimmed = hoverIndex !== null && hoverIndex !== i;
              return (
                <circle
                  key={`dot-${s.originalIndex}-${i}`}
                  cx={x}
                  cy={y}
                  r={isActive ? 4.5 : 2.5}
                  fill={s.color}
                  stroke="var(--color-bg-primary)"
                  strokeWidth={isActive ? 2 : 1}
                  opacity={isDimmed ? 0.25 : 0.85}
                  style={{
                    transition: "opacity 150ms, r 150ms",
                  }}
                />
              );
            });
          })}

        {/* Crosshair vertical guide line */}
        {crosshairX !== null && hoverIndex !== null && (
          <line
            x1={crosshairX}
            y1={padding.top}
            x2={crosshairX}
            y2={padding.top + chartH}
            stroke="var(--color-accent)"
            strokeWidth="1.2"
            strokeDasharray="3 3"
            opacity={0.8}
          />
        )}

        {/* Active hover multi-ring target dot on each series intersection */}
        {hoverIndex !== null &&
          visibleSeries.map((s) => {
            const pt = pointPositions[s.originalIndex]?.[hoverIndex];
            if (!pt) return null;
            return (
              <g key={`cross-${s.originalIndex}`}>
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r="8"
                  fill={s.color}
                  opacity={0.3}
                />
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r="4.5"
                  fill={s.color}
                  stroke="var(--color-bg-primary)"
                  strokeWidth="2"
                />
              </g>
            );
          })}

        {/* X-axis labels */}
        {labels.map((label, i) => {
          if (!visibleLabelIndices.has(i)) return null;
          const x = padding.left + (i / Math.max(labels.length - 1, 1)) * chartW;
          const isActive = hoverIndex === i;
          const isFirst = i === 0;
          const isLast = i === labels.length - 1;
          const anchor = isFirst ? "start" : isLast ? "end" : "middle";
          return (
            <text
              key={`label-${i}`}
              x={x}
              y={padding.top + chartH + 20}
              textAnchor={anchor}
              fill={isActive ? "var(--color-text-primary)" : "var(--color-text-muted)"}
              fontSize={isActive ? "10" : "9"}
              fontWeight={isActive ? "700" : "500"}
              style={{ transition: "all 150ms" }}
            >
              {label}
            </text>
          );
        })}
      </svg>

      {/* Floating tooltip card */}
      {hoverIndex !== null && tooltipValues && (
        <div
          className="chart-tooltip-card"
          style={{
            position: "absolute",
            left:
              crosshairX !== null
                ? `clamp(8px, ${
                    ((crosshairX + (crosshairX > effectiveWidth * 0.6 ? -184 : 12)) /
                      effectiveWidth) *
                    100
                  }%, calc(100% - 190px))`
                : "0%",
            top: "10px",
            pointerEvents: "none",
            zIndex: 30,
          }}
        >
          <div className="chart-tooltip-label">
            <svg
              viewBox="0 0 24 24"
              width="10"
              height="10"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              style={{ display: "inline-block", marginRight: "4px", verticalAlign: "middle" }}
            >
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            {labels[hoverIndex]}
          </div>
          <div className="chart-tooltip-values">
            {tooltipValues.map((tv, i) => (
              <div key={i} className="chart-tooltip-row">
                <span
                  className="chart-tooltip-dot"
                  style={{
                    background: tv.color,
                    boxShadow: `0 0 6px ${tv.color}`,
                  }}
                />
                <span className="chart-tooltip-name">{tv.label}</span>
                <span className="chart-tooltip-val">
                  {formatTooltipValue
                    ? formatTooltipValue(tv.value)
                    : formatValue(tv.value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Interactive Legend Bar */}
      {legend && series.length > 0 && (
        <div className="chart-interactive-legend" role="toolbar" aria-label="Chart Series Legend">
          {series.map((s, i) => {
            const isHidden = hiddenSeriesIndices.has(i);
            const latestVal = s.data.length > 0 ? s.data[s.data.length - 1] : null;

            return (
              <button
                key={`leg-btn-${i}`}
                type="button"
                className={`chart-legend-pill ${isHidden ? "is-hidden" : ""}`}
                title={interactiveLegend && series.length > 1 ? t("charts.clickToSolo") : s.label}
                onClick={(e) => handleToggleSeries(i, e)}
              >
                <span
                  className="chart-legend-dot"
                  style={{
                    backgroundColor: s.color,
                    boxShadow: isHidden ? "none" : `0 0 8px ${s.color}`,
                  }}
                />
                <span className="chart-legend-name">{s.label}</span>
                {latestVal !== null && !isHidden && (
                  <span className="chart-legend-badge">{formatValue(latestVal)}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
