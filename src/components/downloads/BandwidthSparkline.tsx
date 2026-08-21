import { useMemo, useState } from "react";
import { useBandwidthHistory, type BandwidthPoint } from "../../hooks/useBandwidthHistory";
import { useDownloads } from "../../context/DownloadContext";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { useLanguage } from "../../context/LanguageContext";
import { formatBytesPerSecond } from "../../types/download";
import { ActivityIcon, ChevronIcon } from "./DownloadIcons";

const VIEW_WIDTH = 600;
const VIEW_HEIGHT = 64;
const PADDING = 6;

type TimeWindow = 60 | 180 | 300;

export default function BandwidthSparkline() {
  const history = useBandwidthHistory();
  const { activeDownloads } = useDownloads();
  const { unit } = useSizeUnit();
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

    const dlSegments: string[] = [];
    const ulSegments: string[] = [];

    for (let i = 0; i < n; i++) {
      const pt = visibleHistory[i];
      const x = PADDING + i * xStep;

      const normDl = Math.min(pt.down / maxSpeed, 1);
      const yDl = VIEW_HEIGHT - PADDING - normDl * usableH;

      const normUl = Math.min(pt.up / maxSpeed, 1);
      const yUl = VIEW_HEIGHT - PADDING - normUl * usableH;

      dlPts.push({ x, y: yDl, speed: pt.down, time: pt.time });
      ulPts.push({ x, y: yUl, speed: pt.up, time: pt.time });

      const command = i === 0 ? "M" : "L";
      dlSegments.push(`${command} ${x.toFixed(1)} ${yDl.toFixed(1)}`);
      ulSegments.push(`${command} ${x.toFixed(1)} ${yUl.toFixed(1)}`);
    }

    const firstX = PADDING;
    const lastX = PADDING + (n - 1) * xStep;
    const bottomY = VIEW_HEIGHT - PADDING;

    const dlAreaPath = n > 0
      ? `${dlSegments.join(" ")} L ${lastX.toFixed(1)} ${bottomY} L ${firstX.toFixed(1)} ${bottomY} Z`
      : "";

    const ulAreaPath = n > 0
      ? `${ulSegments.join(" ")} L ${lastX.toFixed(1)} ${bottomY} L ${firstX.toFixed(1)} ${bottomY} Z`
      : "";

    return {
      dlPath: dlSegments.join(" "),
      ulPath: ulSegments.join(" "),
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

          <div className="dl-sparkline-time-toggles" role="group" aria-label="Time window">
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

          <span className="dl-sparkline-stat-pill" title="Peak throughput in current window">
            Max: {formatBytesPerSecond(maxSpeed, unit)}
          </span>

          <button
            type="button"
            className="dl-sparkline-collapse-btn"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? "Expand graph" : "Collapse graph"}
            title={collapsed ? "Expand graph" : "Collapse graph"}
          >
            <ChevronIcon
              style={{
                transform: collapsed ? "rotate(180deg)" : "rotate(0deg)",
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
