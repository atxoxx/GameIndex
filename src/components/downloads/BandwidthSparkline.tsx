import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useBandwidthHistory } from "../../hooks/useBandwidthHistory";
import { useDownloads } from "../../context/DownloadContext";
import { useSpeedUnit } from "../../hooks/useSpeedUnit";
import { useLanguage } from "../../context/LanguageContext";
import { formatBytesPerSecond } from "../../types/download";
import { ActivityIcon, ChevronIcon } from "./DownloadIcons";
import {
  computeBandwidthScale,
  formatAxisSpeed,
  sliceToWindow,
  timeAxisTicks,
} from "./bandwidthChart";

const VIEW_HEIGHT = 160;
const MARGIN = { top: 14, right: 16, bottom: 26, left: 68 };
const MIN_CHART_WIDTH = 320;

type TimeWindow = 60 | 180 | 300;

interface SplinePoint {
  x: number;
  y: number;
}

interface ChartPoint extends SplinePoint {
  speed: number;
  time: string;
}

interface SparklinePaths {
  dlPath: string;
  ulPath: string;
  dlArea: string;
  ulArea: string;
  dlPoints: ChartPoint[];
  ulPoints: ChartPoint[];
}

const fmt = (v: number) => v.toFixed(1);

// Monotone cubic Hermite spline emitted as cubic Beziers. Fritsch-Carlson
// keeps the curve smooth while never exceeding the sampled values between
// points (no overshoot below the baseline on spiky bandwidth data).
function smoothPath(points: SplinePoint[]): string {
  const n = points.length;
  if (n === 0) return "";
  if (n === 1) return `M ${fmt(points[0].x)} ${fmt(points[0].y)}`;
  if (n === 2) {
    return `M ${fmt(points[0].x)} ${fmt(points[0].y)} L ${fmt(points[1].x)} ${fmt(points[1].y)}`;
  }

  const dx: number[] = [];
  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const h = points[i + 1].x - points[i].x;
    dx.push(h);
    slopes.push(h === 0 ? 0 : (points[i + 1].y - points[i].y) / h);
  }

  const m: number[] = new Array(n);
  m[0] = slopes[0];
  m[n - 1] = slopes[n - 2];
  for (let i = 1; i < n - 1; i++) {
    m[i] = slopes[i - 1] * slopes[i] <= 0 ? 0 : (slopes[i - 1] + slopes[i]) / 2;
  }

  for (let i = 0; i < n - 1; i++) {
    if (slopes[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / slopes[i];
    const b = m[i + 1] / slopes[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * slopes[i];
      m[i + 1] = t * b * slopes[i];
    }
  }

  let d = `M ${fmt(points[0].x)} ${fmt(points[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i];
    const c1x = points[i].x + h / 3;
    const c1y = points[i].y + (m[i] * h) / 3;
    const c2x = points[i + 1].x - h / 3;
    const c2y = points[i + 1].y - (m[i + 1] * h) / 3;
    d += ` C ${fmt(c1x)} ${fmt(c1y)} ${fmt(c2x)} ${fmt(c2y)} ${fmt(points[i + 1].x)} ${fmt(points[i + 1].y)}`;
  }
  return d;
}

function useChartWidth(active: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(MIN_CHART_WIDTH);

  // The canvas unmounts while the card is collapsed. Re-attach the observer
  // when it comes back, otherwise a 0-width reading from the removal would
  // leave the reopened chart stuck at the minimum width.
  useLayoutEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      const measured = Math.round(el.getBoundingClientRect().width);
      if (measured > 0) setWidth(Math.max(MIN_CHART_WIDTH, measured));
    };
    measure();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [active]);

  return { ref, width };
}

export default function BandwidthSparkline() {
  const history = useBandwidthHistory();
  const { activeDownloads } = useDownloads();
  const { unit } = useSpeedUnit();
  const { t, language } = useLanguage();
  const gradientId = useId().replace(/[^a-zA-Z0-9_-]/g, "");

  const totalDownloadSpeed = activeDownloads.reduce((acc, d) => acc + (d.downloadSpeed || 0), 0);
  const totalUploadSpeed = activeDownloads.reduce((acc, d) => acc + (d.uploadSpeed || 0), 0);

  const [timeWindow, setTimeWindow] = useState<TimeWindow>(60);
  const [collapsed, setCollapsed] = useState(false);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const { ref: chartRef, width: chartWidth } = useChartWidth(!collapsed);

  const windowMs = timeWindow * 1000;
  const now = Date.now();
  const visibleHistory = useMemo(
    () => sliceToWindow(history, now, windowMs),
    [history, now, windowMs],
  );

  const peakDown = useMemo(
    () => Math.max(...visibleHistory.map((pt) => pt.down), totalDownloadSpeed, 0),
    [visibleHistory, totalDownloadSpeed],
  );
  const peakUp = useMemo(
    () => Math.max(...visibleHistory.map((pt) => pt.up), totalUploadSpeed, 0),
    [visibleHistory, totalUploadSpeed],
  );
  const peakSpeed = Math.max(peakDown, peakUp);
  const scale = useMemo(
    () => computeBandwidthScale(visibleHistory, totalDownloadSpeed, totalUploadSpeed),
    [visibleHistory, totalDownloadSpeed, totalUploadSpeed],
  );

  const plotLeft = MARGIN.left;
  const plotRight = Math.max(plotLeft + 1, chartWidth - MARGIN.right);
  const plotTop = MARGIN.top;
  const plotBottom = VIEW_HEIGHT - MARGIN.bottom;
  const plotHeight = plotBottom - plotTop;
  const plotWidth = plotRight - plotLeft;

  const yFor = (speed: number) =>
    plotBottom - Math.min(speed / scale.max, 1) * plotHeight;

  const spark = useMemo<SparklinePaths>(() => {
    const n = visibleHistory.length;
    if (n === 0) {
      return { dlPath: "", ulPath: "", dlArea: "", ulArea: "", dlPoints: [], ulPoints: [] };
    }

    const windowStart = now - windowMs;
    const xFor = (ts: number) =>
      plotLeft + ((ts - windowStart) / windowMs) * plotWidth;
    const yForSample = (speed: number) =>
      plotBottom - Math.min(speed / scale.max, 1) * plotHeight;

    const dlPts: ChartPoint[] = [];
    const ulPts: ChartPoint[] = [];
    for (const sample of visibleHistory) {
      const x = xFor(sample.ts);
      dlPts.push({ x, y: yForSample(sample.down), speed: sample.down, time: sample.time });
      ulPts.push({ x, y: yForSample(sample.up), speed: sample.up, time: sample.time });
    }

    const dlLine = smoothPath(dlPts);
    const ulLine = smoothPath(ulPts);
    const firstX = dlPts[0].x;
    const lastX = dlPts[n - 1].x;
    const area = (line: string) =>
      `${line} L ${fmt(lastX)} ${fmt(plotBottom)} L ${fmt(firstX)} ${fmt(plotBottom)} Z`;

    return {
      dlPath: dlLine,
      ulPath: ulLine,
      dlArea: n > 1 ? area(dlLine) : "",
      ulArea: n > 1 ? area(ulLine) : "",
      dlPoints: dlPts,
      ulPoints: ulPts,
    };
  }, [visibleHistory, now, windowMs, scale.max, plotLeft, plotWidth, plotBottom, plotHeight]);

  const { dlPath, ulPath, dlArea, ulArea, dlPoints, ulPoints } = spark;
  const latestDl = dlPoints.length > 0 ? dlPoints[dlPoints.length - 1] : null;
  const latestUl = ulPoints.length > 0 ? ulPoints[ulPoints.length - 1] : null;

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (dlPoints.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * chartWidth;
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < dlPoints.length; i++) {
      const distance = Math.abs(dlPoints[i].x - x);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    setHoverIndex(best);
  };

  const handlePointerLeave = () => setHoverIndex(null);

  const hoveredDl = hoverIndex !== null ? dlPoints[hoverIndex] : null;
  const hoveredUl = hoverIndex !== null ? ulPoints[hoverIndex] : null;
  const tooltipLeft = hoveredDl
    ? Math.min(Math.max(hoveredDl.x, 96), chartWidth - 96)
    : 0;

  const xTickCount = chartWidth >= 760 ? 5 : chartWidth >= 520 ? 4 : 3;
  const xTicks = useMemo(
    () => timeAxisTicks(now, windowMs, xTickCount),
    [now, windowMs, xTickCount],
  );

  const idle = peakSpeed <= 0;

  return (
    <div className="dl-sparkline-box" role="region" aria-label={t("downloads.networkTelemetry")}>
      <div className="dl-sparkline-bar-header">
        <div className="dl-sparkline-title-group">
          <span className="dl-sparkline-title">
            <ActivityIcon className="dl-sparkline-icon" />
            {t("downloads.networkTelemetry")}
          </span>

          <div className="dl-sparkline-time-toggles" role="group" aria-label={t("downloads.timeWindow")}>
            <button
              type="button"
              className={`dl-sparkline-time-btn${timeWindow === 60 ? " active" : ""}`}
              onClick={() => setTimeWindow(60)}
            >
              {t("downloads.time60s")}
            </button>
            <button
              type="button"
              className={`dl-sparkline-time-btn${timeWindow === 180 ? " active" : ""}`}
              onClick={() => setTimeWindow(180)}
            >
              {t("downloads.time3m")}
            </button>
            <button
              type="button"
              className={`dl-sparkline-time-btn${timeWindow === 300 ? " active" : ""}`}
              onClick={() => setTimeWindow(300)}
            >
              {t("downloads.time5m")}
            </button>
          </div>
        </div>

        <div className="dl-sparkline-stats-group">
          <div className="dl-sparkline-legend-item dl-sparkline-legend-dl">
            <span className="dl-sparkline-legend-swatch" />
            <span>
              ↓ {formatBytesPerSecond(hoveredDl ? hoveredDl.speed : totalDownloadSpeed, unit, language)}
            </span>
          </div>

          <div className="dl-sparkline-legend-item dl-sparkline-legend-ul">
            <span className="dl-sparkline-legend-swatch" />
            <span>
              ↑ {formatBytesPerSecond(hoveredUl ? hoveredUl.speed : totalUploadSpeed, unit, language)}
            </span>
          </div>

          <span className="dl-sparkline-stat-pill" title={t("downloads.peakThroughput")}>
            {t("downloads.maxSpeedLabel", { speed: formatBytesPerSecond(peakSpeed, unit, language) })}
          </span>

          <button
            type="button"
            className="dl-sparkline-collapse-btn"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? t("downloads.expandGraph") : t("downloads.collapseGraph")}
            title={collapsed ? t("downloads.expandGraph") : t("downloads.collapseGraph")}
          >
            <ChevronIcon
              style={{
                transform: collapsed ? "rotate(0deg)" : "rotate(180deg)",
                transition: "transform 0.2s ease",
                width: 13,
                height: 13,
              }}
            />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="dl-sparkline-canvas-wrapper" ref={chartRef}>
          <svg
            className="dl-sparkline-svg"
            viewBox={`0 0 ${chartWidth} ${VIEW_HEIGHT}`}
            aria-hidden="true"
            onPointerMove={handlePointerMove}
            onPointerLeave={handlePointerLeave}
          >
            <defs>
              <linearGradient id={`${gradientId}-dl`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.32" />
                <stop offset="70%" stopColor="var(--color-accent)" stopOpacity="0.07" />
                <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
              </linearGradient>
              <linearGradient id={`${gradientId}-ul`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-success)" stopOpacity="0.16" />
                <stop offset="100%" stopColor="var(--color-success)" stopOpacity="0" />
              </linearGradient>
              <clipPath id={`${gradientId}-clip`}>
                <rect
                  x={plotLeft}
                  y={plotTop}
                  width={plotWidth}
                  height={plotHeight}
                />
              </clipPath>
            </defs>

            {scale.ticks.map((tick, i) => {
              const y = yFor(tick);
              return (
                <g key={tick}>
                  <line
                    x1={plotLeft}
                    x2={plotRight}
                    y1={y}
                    y2={y}
                    className={i === 0 ? "dl-sparkline-baseline" : "dl-sparkline-gridline"}
                  />
                  <text
                    x={plotLeft - 10}
                    y={y}
                    textAnchor="end"
                    dominantBaseline="middle"
                    className="dl-sparkline-axis-label"
                  >
                    {formatAxisSpeed(tick, unit, language)}
                  </text>
                </g>
              );
            })}

            <g clipPath={`url(#${gradientId}-clip)`}>
              {ulArea && peakUp > 0 && <path d={ulArea} fill={`url(#${gradientId}-ul)`} />}
              {dlArea && peakDown > 0 && <path d={dlArea} fill={`url(#${gradientId}-dl)`} />}
              {ulPath && peakUp > 0 && <path d={ulPath} className="dl-sparkline-line-ul" />}
              {dlPath && peakDown > 0 && <path d={dlPath} className="dl-sparkline-line-dl" />}
            </g>

            {latestDl && peakDown > 0 && (
              <g className="dl-sparkline-live-dot dl-sparkline-live-dot-dl">
                <circle cx={latestDl.x} cy={latestDl.y} r="6" className="dl-sparkline-live-halo" />
                <circle cx={latestDl.x} cy={latestDl.y} r="3.5" className="dl-sparkline-live-core" />
              </g>
            )}
            {latestUl && peakUp > 0 && (
              <g className="dl-sparkline-live-dot dl-sparkline-live-dot-ul">
                <circle cx={latestUl.x} cy={latestUl.y} r="5" className="dl-sparkline-live-halo" />
                <circle cx={latestUl.x} cy={latestUl.y} r="3" className="dl-sparkline-live-core" />
              </g>
            )}

            {xTicks.map((tick, i) => {
              const x =
                plotLeft + ((tick.ts - (now - windowMs)) / windowMs) * plotWidth;
              const anchor = i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle";
              return (
                <text
                  key={tick.ts}
                  x={x}
                  y={VIEW_HEIGHT - 7}
                  textAnchor={anchor}
                  className="dl-sparkline-axis-label dl-sparkline-x-label"
                >
                  {tick.label}
                </text>
              );
            })}

            {hoverIndex !== null && hoveredDl && (
              <g className="dl-sparkline-hover-group">
                <line
                  x1={hoveredDl.x}
                  y1={plotTop}
                  x2={hoveredDl.x}
                  y2={plotBottom}
                  className="dl-sparkline-crosshair"
                />
                <circle cx={hoveredDl.x} cy={hoveredDl.y} r="4" className="dl-sparkline-hover-dl" />
                {hoveredUl && (
                  <circle cx={hoveredUl.x} cy={hoveredUl.y} r="3.5" className="dl-sparkline-hover-ul" />
                )}
              </g>
            )}
          </svg>

          {idle && (
            <div className="dl-sparkline-idle">
              <span className="dl-sparkline-idle-title">{t("downloads.graphIdleTitle")}</span>
              <span className="dl-sparkline-idle-hint">{t("downloads.graphIdleHint")}</span>
            </div>
          )}

          {hoverIndex !== null && hoveredDl && (
            <div className="dl-sparkline-hover-tooltip" style={{ left: tooltipLeft }}>
              <span className="dl-sparkline-tooltip-time">{hoveredDl.time}</span>
              <span className="dl-sparkline-tooltip-row dl-sparkline-tooltip-dl">
                <span className="dl-sparkline-tooltip-dot" />
                <span>↓</span>
                <strong>{formatBytesPerSecond(hoveredDl.speed, unit, language)}</strong>
              </span>
              {hoveredUl && (
                <span className="dl-sparkline-tooltip-row dl-sparkline-tooltip-ul">
                  <span className="dl-sparkline-tooltip-dot" />
                  <span>↑</span>
                  <strong>{formatBytesPerSecond(hoveredUl.speed, unit, language)}</strong>
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
