import { useMemo, useState, useCallback, useLayoutEffect, useRef, useId } from "react";
import { useLanguage } from "../../context/LanguageContext";

export interface BarChartProps {
  data: number[];
  labels: string[];
  width?: number;
  height?: number;
  color?: string;
  formatValue?: (v: number) => string;
  tooltip?: boolean;
  /** Whether to show a dashed horizontal benchmark line for the average value */
  showAverage?: boolean;
  /** Highlight the highest peak bar with a visual badge */
  showExtremes?: boolean;
  /** Use rich vertical depth gradients on bars instead of flat fills */
  gradient?: boolean;
  /** Optional click handler for drilling into a specific bar/day */
  onBarClick?: (index: number, label: string, value: number) => void;
  /** Optional summary strip above the chart */
  showSummary?: boolean;
}

export default function BarChart({
  data,
  labels,
  width = 600,
  height = 220,
  color = "var(--color-accent)",
  formatValue = (v) => String(v),
  tooltip = true,
  showAverage = true,
  showExtremes = true,
  gradient = true,
  onBarClick,
  showSummary = false,
}: BarChartProps) {
  const { t } = useLanguage();
  const rawId = useId();
  const chartId = useMemo(() => `bc-${rawId.replace(/[:]/g, "")}`, [rawId]);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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

  const totalSum = useMemo(() => data.reduce((a, b) => a + b, 0), [data]);
  const averageVal = useMemo(
    () => (data.length > 0 ? totalSum / data.length : 0),
    [data, totalSum]
  );
  const maxValRaw = useMemo(() => Math.max(...data, 1), [data]);
  const peakIndex = useMemo(() => {
    if (data.length === 0 || maxValRaw <= 0) return -1;
    return data.indexOf(maxValRaw);
  }, [data, maxValRaw]);

  const chart = useMemo(() => {
    const padding = { top: 24, right: 20, bottom: 32, left: 44 };
    const chartW = Math.max(10, effectiveWidth - padding.left - padding.right);
    const chartH = Math.max(10, height - padding.top - padding.bottom);
    const maxVal = maxValRaw;
    const barGap = Math.max(3, chartW / (data.length * 3.2));
    const barW = Math.max(2, (chartW - barGap * (data.length - 1)) / (data.length || 1));

    const labelBudgetPx = 42;
    const maxLabels = Math.max(2, Math.floor(chartW / labelBudgetPx));
    const labelStride = Math.max(1, Math.ceil(data.length / maxLabels));
    const showValuesOnTop = barW >= 24;

    return {
      padding,
      chartW,
      chartH,
      maxVal,
      barGap,
      barW,
      labelStride,
      showValuesOnTop,
    };
  }, [data, effectiveWidth, height, maxValRaw]);

  const {
    padding,
    chartW,
    chartH,
    maxVal,
    barGap,
    barW,
    labelStride,
    showValuesOnTop,
  } = chart;

  const gridLines = 5;
  const gridValues = Array.from({ length: gridLines + 1 }, (_, i) =>
    Math.round((maxVal / gridLines) * i)
  );

  const avgY = useMemo(() => {
    if (!showAverage || averageVal <= 0 || averageVal > maxVal) return null;
    return padding.top + chartH - (averageVal / maxVal) * chartH;
  }, [showAverage, averageVal, maxVal, padding.top, chartH]);

  const handleMouseEnter = useCallback((i: number) => {
    setHoverIndex(i);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setHoverIndex(null);
  }, []);

  const handleBarClick = useCallback(
    (i: number) => {
      if (onBarClick && labels[i] !== undefined && data[i] !== undefined) {
        onBarClick(i, labels[i], data[i]);
      }
    },
    [onBarClick, labels, data]
  );

  // Stats for hover tooltip diff vs avg
  const hoveredDiffVsAvg = useMemo(() => {
    if (hoverIndex === null || averageVal <= 0) return null;
    const val = data[hoverIndex] ?? 0;
    const diffPct = Math.round(((val - averageVal) / averageVal) * 100);
    return diffPct;
  }, [hoverIndex, data, averageVal]);

  const hoveredPctOfTotal = useMemo(() => {
    if (hoverIndex === null || totalSum <= 0) return null;
    const val = data[hoverIndex] ?? 0;
    return Math.round((val / totalSum) * 100);
  }, [hoverIndex, data, totalSum]);

  return (
    <div
      ref={containerRef}
      className="chart-bar-wrapper"
      style={{ position: "relative", width: "100%" }}
    >
      {/* Optional quick KPI summary */}
      {showSummary && (
        <div className="chart-summary-strip">
          <div className="chart-summary-item">
            <span className="chart-summary-label">{t("charts.total")}</span>
            <span className="chart-summary-val">{formatValue(Math.round(totalSum))}</span>
          </div>
          <div className="chart-summary-item">
            <span className="chart-summary-label">{t("charts.average")}</span>
            <span className="chart-summary-val">{formatValue(Math.round(averageVal))}</span>
          </div>
          <div className="chart-summary-item chart-summary-item--peak">
            <span className="chart-summary-label">{t("charts.peak")}</span>
            <span className="chart-summary-val">{formatValue(maxValRaw)}</span>
          </div>
        </div>
      )}

      <svg
        viewBox={`0 0 ${effectiveWidth} ${height}`}
        width="100%"
        height={height}
        style={{
          fontFamily: "inherit",
          display: "block",
          overflow: "visible",
        }}
      >
        <defs>
          {/* Depth vertical gradient */}
          <linearGradient
            id={`${chartId}-grad`}
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop offset="0%" stopColor={color} stopOpacity="1" />
            <stop
              offset="100%"
              stopColor={`color-mix(in srgb, ${color} 45%, var(--color-bg-primary))` }
              stopOpacity="0.85"
            />
          </linearGradient>

          {/* Hover bar glow filter */}
          <filter
            id={`${chartId}-bar-glow`}
            x="-20%"
            y="-20%"
            width="140%"
            height="140%"
          >
            <feDropShadow
              dx="0"
              dy="2"
              stdDeviation="3"
              floodColor={color}
              floodOpacity="0.5"
            />
          </filter>
        </defs>

        {/* Grid lines with deduplicated labels */}
        {(() => {
          const seen = new Set<number>();
          return gridValues.map((v, i) => {
            const y = padding.top + chartH - (v / maxVal) * chartH;
            const isDup = seen.has(v);
            seen.add(v);
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
                {!isDup && (
                  <text
                    x={padding.left - 8}
                    y={y + 3.5}
                    textAnchor="end"
                    fill="var(--color-text-muted)"
                    fontSize="10"
                    fontWeight="500"
                  >
                    {formatValue(v)}
                  </text>
                )}
              </g>
            );
          });
        })()}

        {/* Average Benchmark Dashed Line */}
        {avgY !== null && (
          <g className="chart-average-line">
            <line
              x1={padding.left}
              y1={avgY}
              x2={padding.left + chartW}
              y2={avgY}
              stroke="var(--color-text-muted)"
              strokeWidth="1.2"
              strokeDasharray="4 3"
              opacity={0.65}
            />
            <g transform={`translate(${padding.left + chartW}, ${avgY - 3})`}>
              <rect
                x="-52"
                y="-10"
                width="52"
                height="13"
                rx="3"
                fill="var(--color-bg-surface)"
                opacity="0.9"
                stroke="var(--color-border)"
                strokeWidth="0.8"
              />
              <text
                x="-4"
                y="-1"
                textAnchor="end"
                fill="var(--color-text-secondary)"
                fontSize="8"
                fontWeight="700"
              >
                {t("charts.average")}: {formatValue(Math.round(averageVal))}
              </text>
            </g>
          </g>
        )}

        {/* Bars */}
        {data.map((value, i) => {
          const barH = (value / maxVal) * chartH;
          const x = padding.left + i * (barW + barGap);
          const y = padding.top + chartH - barH;
          const isHovered = hoverIndex === i;
          const isDimmed = hoverIndex !== null && hoverIndex !== i;
          const isPeak = showExtremes && i === peakIndex && value > 0;

          const isStrideTick = i % labelStride === 0;
          const isLastTick = i === data.length - 1;
          const collapsesWithLast =
            !isLastTick &&
            data.length - 1 - i < Math.ceil(labelStride * 0.6);
          const showXLabel =
            (isStrideTick && !collapsesWithLast) || isLastTick || isHovered;
          const showTopValue = (showValuesOnTop || isHovered) && value > 0;

          return (
            <g
              key={`bar-${i}`}
              className="chart-bar-group"
              style={{ cursor: onBarClick ? "pointer" : "default" }}
              onMouseEnter={() => handleMouseEnter(i)}
              onMouseLeave={handleMouseLeave}
              onClick={() => handleBarClick(i)}
            >
              {/* Hit area */}
              <rect
                x={x - barGap / 2}
                y={padding.top}
                width={barW + barGap}
                height={chartH + padding.bottom}
                fill="transparent"
                style={{ pointerEvents: "all" }}
              />

              {/* Bar pillar */}
              <rect
                x={x}
                y={y}
                width={Math.max(barW, 2)}
                height={Math.max(barH, 1)}
                rx={Math.min(5, barW / 2)}
                fill={gradient ? `url(#${chartId}-grad)` : color}
                opacity={isDimmed ? 0.3 : 1}
                filter={isHovered ? `url(#${chartId}-bar-glow)` : "none"}
                style={{
                  transition: "opacity 160ms, filter 160ms, transform 160ms",
                  transformOrigin: `${x + barW / 2}px ${padding.top + chartH}px`,
                  transform: isHovered ? "scaleY(1.02)" : "none",
                }}
              >
                {tooltip && <title>{labels[i]}: {formatValue(value)}</title>}
              </rect>

              {/* Focus border ring on hovered bar */}
              <rect
                x={x - 1.5}
                y={(value / maxVal) * chartH === 0 ? padding.top + chartH - 4 : y - 2}
                width={barW + 3}
                height={Math.max((value / maxVal) * chartH, 1) + 4}
                rx={Math.min(6, barW / 2 + 1)}
                fill="none"
                stroke={color}
                strokeWidth={isHovered ? 2 : 0}
                opacity={isHovered ? 0.9 : 0}
                style={{
                  transition: "opacity 160ms",
                  pointerEvents: "none",
                }}
              />

              {/* Peak indicator crown / star */}
              {isPeak && !isHovered && barW >= 12 && (
                <g transform={`translate(${x + barW / 2}, ${y - 8})`}>
                  <circle r="3" fill="var(--color-warning)" opacity="0.9" />
                </g>
              )}

              {/* X-axis label */}
              {showXLabel && (
                <text
                  x={x + barW / 2}
                  y={padding.top + chartH + 18}
                  textAnchor="middle"
                  fill={isHovered ? "var(--color-text-primary)" : "var(--color-text-muted)"}
                  fontSize={isHovered ? "11" : "10"}
                  fontWeight={isHovered ? "700" : "500"}
                  style={{ transition: "all 150ms" }}
                >
                  {labels[i]}
                </text>
              )}

              {/* Top value label */}
              {showTopValue && (
                <text
                  x={x + barW / 2}
                  y={y - 6}
                  textAnchor="middle"
                  fill={isHovered ? "var(--color-text-primary)" : "var(--color-text-secondary)"}
                  fontSize={isHovered ? "11" : "10"}
                  fontWeight={isHovered ? "700" : "600"}
                  opacity={isDimmed ? 0.35 : 1}
                  style={{ transition: "all 150ms" }}
                >
                  {formatValue(value)}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Modern Glassmorphic Tooltip */}
      {hoverIndex !== null && data[hoverIndex] !== undefined && (
        <div
          className="chart-bar-tooltip"
          style={{
            position: "absolute",
            top: "6px",
            left: `${clampTooltipPosition(
              ((hoverIndex + 0.5) / (data.length || 1)) * 100,
              12,
              88
            )}%`,
            transform: "translateX(-50%)",
            pointerEvents: "none",
            zIndex: 30,
          }}
        >
          <div className="bar-tooltip-label">
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
          <div className="bar-tooltip-value">
            {formatValue(data[hoverIndex])}
          </div>
          <div className="bar-tooltip-meta">
            {hoveredPctOfTotal !== null && (
              <span className="bar-tooltip-share">{hoveredPctOfTotal}% {t("charts.total").toLowerCase()}</span>
            )}
            {hoveredDiffVsAvg !== null && (
              <span
                className={`bar-tooltip-diff ${
                  hoveredDiffVsAvg >= 0 ? "is-positive" : "is-negative"
                }`}
              >
                {hoveredDiffVsAvg >= 0 ? `+${hoveredDiffVsAvg}%` : `${hoveredDiffVsAvg}%`} {t("activity.avg").toLowerCase()}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function clampTooltipPosition(pct: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, pct));
}
