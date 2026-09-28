import { useMemo, useState } from "react";
import { useBandwidthHistory, type BandwidthPoint } from "../../hooks/useBandwidthHistory";
import { useDownloads } from "../../context/DownloadContext";
import { useSpeedUnit } from "../../hooks/useSpeedUnit";
import { useLanguage } from "../../context/LanguageContext";
import { formatBytesPerSecond } from "../../types/download";
import { ActivityIcon, ChevronIcon } from "./DownloadIcons";

const VIEW_WIDTH = 600;
const VIEW_HEIGHT = 64;
const PADDING = 6;

type TimeWindow = 60 | 180 | 300;

interface SplinePoint {
  x: number;
  y: number;
}

const fmt = (v: number) => v.toFixed(1);

// Monotone cubic Hermite spline emitted as cubic Beziers. A plain polyline
// reads as a sawtooth at one-sample-per-pixel, and a Catmull-Rom curve would
// overshoot below the baseline on spiky bandwidth data. Fritsch-Carlson keeps
// the curve smooth while never exceeding the sampled values between points.
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

  // Slice history points based on selected time window
  const visibleHistory = useMemo(() => {
    return history.slice(-timeWindow);
  }, [history, timeWindow]);

  const peakDown = useMemo(() => {
    return Math.max(...visibleHistory.map((pt: BandwidthPoint) => pt.down), totalDownloadSpeed, 1024);
  }, [visibleHistory, totalDownloadSpeed]);

  const peakUp = useMemo(() => {
    return Math.max(...visibleHistory.map((pt: BandwidthPoint) => pt.up), totalUploadSpeed, 1024);
  }, [visibleHistory, totalUploadSpeed]);

  const maxSpeed = Math.max(peakDown, peakUp, 10 * 1024);

  const { dlPath, ulPath, dlArea, ulArea, dlPoints, ulPoints } = useMemo(() => {
    const n = visibleHistory.length;
    if (n === 0) {
      return { dlPath: "", ulPath: "", dlArea: "", ulArea: "", dlPoints: [], ulPoints: [] };
    }

    const usableH = VIEW_HEIGHT - PADDING * 2;
    const xStep = n > 1 ? (VIEW_WIDTH - PADDING * 2) / (n - 1) : 0;

    const dlPts: { x: number; y: number; speed: number; time: string }[] = [];
    const ulPts: { x: number; y: number; speed: number; time: string }[] = [];

    for (let i = 0; i < n; i++) {
      const pt = visibleHistory[i];
      const x = PADDING + i * xStep;

      const normDl = Math.min(pt.down / maxSpeed, 1);
      const yDl = VIEW_HEIGHT - PADDING - normDl * usableH;

      const normUl = Math.min(pt.up / maxSpeed, 1);
      const yUl = VIEW_HEIGHT - PADDING - normUl * usableH;

      dlPts.push({ x, y: yDl, speed: pt.down, time: pt.time });
      ulPts.push({ x, y: yUl, speed: pt.up, time: pt.time });
    }

    const firstX = PADDING;
    const lastX = PADDING + (n - 1) * xStep;
    const bottomY = VIEW_HEIGHT - PADDING;

    const dlLine = smoothPath(dlPts);
    const ulLine = smoothPath(ulPts);

    const dlAreaPath = n > 0
      ? `${dlLine} L ${fmt(lastX)} ${fmt(bottomY)} L ${fmt(firstX)} ${fmt(bottomY)} Z`
      : "";

    const ulAreaPath = n > 0
      ? `${ulLine} L ${fmt(lastX)} ${fmt(bottomY)} L ${fmt(firstX)} ${fmt(bottomY)} Z`
      : "";

    return {
      dlPath: dlLine,
      ulPath: ulLine,
      dlArea: dlAreaPath,
      ulArea: ulAreaPath,
      dlPoints: dlPts,
      ulPoints: ulPts,
    };
  }, [visibleHistory, maxSpeed]);

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
            {t("downloads.maxSpeedLabel", { speed: formatBytesPerSecond(maxSpeed, unit) })}
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
                <stop offset="0%" stopColor="var(--color-success)" stopOpacity="0.2" />
                <stop offset="100%" stopColor="var(--color-success)" stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* Subtle Grid Guidelines */}
            <line
              x1={0}
              y1={VIEW_HEIGHT - PADDING}
              x2={VIEW_WIDTH}
              y2={VIEW_HEIGHT - PADDING}
              className="dl-sparkline-baseline"
            />
            <line
              x1={0}
              y1={VIEW_HEIGHT / 2}
              x2={VIEW_WIDTH}
              y2={VIEW_HEIGHT / 2}
              className="dl-sparkline-midline"
            />
            <line
              x1={0}
              y1={PADDING}
              x2={VIEW_WIDTH}
              y2={PADDING}
              className="dl-sparkline-baseline"
              strokeOpacity="0.2"
            />

            {/* Gradient Area Fills */}
            {ulArea && <path d={ulArea} fill="url(#ulAreaGradient)" />}
            {dlArea && <path d={dlArea} fill="url(#dlAreaGradient)" />}

            {/* Graph Lines */}
            {ulPath && <path d={ulPath} className="dl-sparkline-line-ul" />}
            {dlPath && <path d={dlPath} className="dl-sparkline-line-dl" />}

            {/* Interactive Crosshair & Point Dots */}
            {hoverIndex !== null && hoveredDl && (
              <g className="dl-sparkline-hover-group">
                <line
                  x1={hoveredDl.x}
                  y1={0}
                  x2={hoveredDl.x}
                  y2={VIEW_HEIGHT}
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
