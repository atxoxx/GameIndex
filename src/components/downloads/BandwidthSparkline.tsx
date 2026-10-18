import { useMemo, useState } from "react";
import { useBandwidthHistory } from "../../hooks/useBandwidthHistory";
import { useDownloads } from "../../context/DownloadContext";
import { useSpeedUnit } from "../../hooks/useSpeedUnit";
import { useLanguage } from "../../context/LanguageContext";
import { formatBytesPerSecond } from "../../types/download";
import { ActivityIcon, ChevronIcon } from "./DownloadIcons";

const VIEW_WIDTH = 600;
const VIEW_HEIGHT = 116;
const PADDING = 6;
// Horizontal space reserved on the left for the Y-axis speed labels.
const LABEL_WIDTH = 56;
const FLOOR_BPS = 1_048_576; // 1 MiB/s — keeps idle/low-speed graphs readable.

type TimeWindow = 60 | 180 | 300;

interface SplinePoint {
  x: number;
  y: number;
}

interface SparklinePaths {
  dlPath: string;
  ulPath: string;
  dlArea: string;
  dlPoints: { x: number; y: number; speed: number; time: string }[];
  ulPoints: { x: number; y: number; speed: number; time: string }[];
}

const fmt = (v: number) => v.toFixed(1);

/** 95th percentile: the scale reflects *typical* traffic so a brief spike
 *  doesn't squash the whole trace to the baseline. */
function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(0.95 * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(rank, sorted.length - 1))];
}

/** Round `value` up to a "nice" number (1·10ⁿ, 2·10ⁿ or 5·10ⁿ) so axis
 *  labels are round and the scale only jumps at sensible thresholds. */
function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return FLOOR_BPS;
  let exp = Math.floor(Math.log10(value));
  const base = 10 ** exp;
  const frac = value / base;
  let n = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  if (n === 10) {
    n = 1;
    exp += 1;
  }
  return Math.max(n * (10 ** exp), FLOOR_BPS);
}

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

export default function BandwidthSparkline() {
  const history = useBandwidthHistory();
  const { activeDownloads } = useDownloads();
  const { unit } = useSpeedUnit();
  const { t } = useLanguage();

  const totalDownloadSpeed = activeDownloads.reduce((acc, d) => acc + (d.downloadSpeed || 0), 0);
  const totalUploadSpeed = activeDownloads.reduce((acc, d) => acc + (d.uploadSpeed || 0), 0);

  const [timeWindow, setTimeWindow] = useState<TimeWindow>(60);
  const [collapsed, setCollapsed] = useState(false);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const visibleHistory = useMemo(() => {
    return history.slice(-timeWindow);
  }, [history, timeWindow]);

  const peakDown = useMemo(() => {
    return Math.max(...visibleHistory.map((pt) => pt.down), totalDownloadSpeed, 0);
  }, [visibleHistory, totalDownloadSpeed]);

  const peakUp = useMemo(() => {
    return Math.max(...visibleHistory.map((pt) => pt.up), totalUploadSpeed, 0);
  }, [visibleHistory, totalUploadSpeed]);

  const peakSpeed = Math.max(peakDown, peakUp);

  // Stable scale: typical traffic (p95) fills the vertical range; brief spikes
  // may clip at the top edge and are reported by the peak pill instead of
  // squashing the rest of the trace.
  const scaleMax = useMemo(() => {
    const typical = Math.max(
      p95(visibleHistory.map((pt) => pt.down)),
      p95(visibleHistory.map((pt) => pt.up)),
    );
    return niceMax(Math.max(typical * 1.5, peakDown * 0.35, peakUp * 0.35));
  }, [visibleHistory, peakDown, peakUp]);

  const spark = useMemo<SparklinePaths>(() => {
    const n = visibleHistory.length;
    if (n === 0) {
      return { dlPath: "", ulPath: "", dlArea: "", dlPoints: [], ulPoints: [] };
    }

    const plotLeft = LABEL_WIDTH + PADDING;
    const plotRight = VIEW_WIDTH - PADDING;
    const plotTop = PADDING + 16; // room for the top Y-axis label
    const plotBottom = VIEW_HEIGHT - PADDING - 6; // room for the baseline label
    const usableH = plotBottom - plotTop;
    const xStep = n > 1 ? (plotRight - plotLeft) / (n - 1) : 0;
    const bottomY = plotBottom;

    const yFor = (speed: number) =>
      Math.round(
        plotBottom - Math.min(speed / scaleMax, 1) * usableH,
      );

    const dlPts: { x: number; y: number; speed: number; time: string }[] = [];
    const ulPts: { x: number; y: number; speed: number; time: string }[] = [];

    for (let i = 0; i < n; i++) {
      const pt = visibleHistory[i];
      const x = plotLeft + i * xStep;
      dlPts.push({ x, y: yFor(pt.down), speed: pt.down, time: pt.time });
      ulPts.push({ x, y: yFor(pt.up), speed: pt.up, time: pt.time });
    }

    const firstX = plotLeft;
    const lastX = plotRight;

    const dlLine = smoothPath(dlPts);
    const ulLine = smoothPath(ulPts);

    const dlAreaPath = n > 0
      ? `${dlLine} L ${fmt(lastX)} ${fmt(bottomY)} L ${fmt(firstX)} ${fmt(bottomY)} Z`
      : "";

    return {
      dlPath: dlLine,
      ulPath: ulLine,
      dlArea: dlAreaPath,
      dlPoints: dlPts,
      ulPoints: ulPts,
    };
  }, [visibleHistory, scaleMax]);

  const { dlPath, ulPath, dlArea, dlPoints, ulPoints } = spark;

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width;
    const idx = Math.round(relX * (visibleHistory.length - 1));
    if (idx >= 0 && idx < visibleHistory.length) {
      setHoverIndex(idx);
    }
  };

  const handleMouseLeave = () => {
    setHoverIndex(null);
  };

  const hoveredDl = hoverIndex !== null ? dlPoints[hoverIndex] : null;
  const hoveredUl = hoverIndex !== null ? ulPoints[hoverIndex] : null;

  // Y-axis label levels (top / mid / bottom).
  const labelLevels = useMemo(() => {
    const plotTop = PADDING + 16;
    const plotBottom = VIEW_HEIGHT - PADDING - 6;
    const usableH = plotBottom - plotTop;
    const yFor = (speed: number) =>
      Math.round(plotBottom - Math.min(speed / scaleMax, 1) * usableH);
    return [
      { speed: scaleMax, y: yFor(scaleMax), label: formatBytesPerSecond(scaleMax, unit) },
      { speed: scaleMax / 2, y: yFor(scaleMax / 2), label: formatBytesPerSecond(scaleMax / 2, unit) },
      { speed: 0, y: plotBottom, label: formatBytesPerSecond(0, unit) },
    ];
  }, [scaleMax, unit]);

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
              ↓ {formatBytesPerSecond(hoveredDl ? hoveredDl.speed : totalDownloadSpeed, unit)}
            </span>
          </div>

          <div className="dl-sparkline-legend-item dl-sparkline-legend-ul">
            <span className="dl-sparkline-legend-swatch" />
            <span>
              ↑ {formatBytesPerSecond(hoveredUl ? hoveredUl.speed : totalUploadSpeed, unit)}
            </span>
          </div>

          <span className="dl-sparkline-stat-pill" title={t("downloads.peakThroughput")}>
            {t("downloads.maxSpeedLabel", { speed: formatBytesPerSecond(peakSpeed, unit) })}
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
        <div className="dl-sparkline-canvas-wrapper">
          <svg
            className="dl-sparkline-svg"
            viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
            preserveAspectRatio="none"
            aria-hidden="true"
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          >
            <defs>
              <linearGradient id="dlAreaGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.25" />
                <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0.0" />
              </linearGradient>
              <linearGradient id="ulAreaGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-success)" stopOpacity="0.15" />
                <stop offset="100%" stopColor="var(--color-success)" stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* Horizontal gridlines at each labeled Y level */}
            {labelLevels.map((lvl, i) => (
              <line
                key={i}
                x1={LABEL_WIDTH}
                y1={lvl.y}
                x2={VIEW_WIDTH}
                y2={lvl.y}
                className="dl-sparkline-gridline"
              />
            ))}

            {/* Y-axis speed labels */}
            {labelLevels.map((lvl, i) => (
              <text
                key={i}
                x={4}
                y={lvl.y + (i === 2 ? 4 : 0)}
                className="dl-sparkline-axis-label"
                fill="var(--color-text-muted)"
                fontSize="11"
              >
                {lvl.label}
              </text>
            ))}

            {/* Baseline */}
            <line
              x1={LABEL_WIDTH}
              y1={VIEW_HEIGHT - PADDING - 6}
              x2={VIEW_WIDTH}
              y2={VIEW_HEIGHT - PADDING - 6}
              className="dl-sparkline-baseline"
            />

            {/* Gradient Area Fill (download only — upload is a line on top) */}
            {dlArea && <path d={dlArea} fill="url(#dlAreaGradient)" />}

            {/* Graph Lines */}
            {dlPath && <path d={dlPath} className="dl-sparkline-line-dl" />}
            {ulPath && <path d={ulPath} className="dl-sparkline-line-ul" />}

            {/* Interactive Crosshair & Point Dots */}
            {hoverIndex !== null && hoveredDl && (
              <g className="dl-sparkline-hover-group">
                <line
                  x1={hoveredDl.x}
                  y1={PADDING + 16}
                  x2={hoveredDl.x}
                  y2={VIEW_HEIGHT - PADDING - 6}
                  stroke="var(--color-border-light)"
                  strokeWidth="1"
                  strokeDasharray="2 2"
                />
                <circle cx={hoveredDl.x} cy={hoveredDl.y} r="4" fill="var(--color-accent)" stroke="var(--color-bg-primary)" strokeWidth="1.5" />
                {hoveredUl && (
                  <circle cx={hoveredUl.x} cy={hoveredUl.y} r="3.5" fill="var(--color-success)" stroke="var(--color-bg-primary)" strokeWidth="1.5" />
                )}
              </g>
            )}
          </svg>

          {hoverIndex !== null && hoveredDl && (
            <div
              className="dl-sparkline-hover-tooltip"
              style={{ left: `${Math.min(92, Math.max(8, (hoveredDl.x / VIEW_WIDTH) * 100))}%` }}
            >
              <span className="dl-tooltip-time">{hoveredDl.time}</span>
              <span className="dl-tooltip-dl">↓ {formatBytesPerSecond(hoveredDl.speed, unit)}</span>
              {hoveredUl && (
                <span className="dl-tooltip-ul">↑ {formatBytesPerSecond(hoveredUl.speed, unit)}</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
