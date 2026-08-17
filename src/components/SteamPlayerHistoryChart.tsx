import { useMemo, useState } from "react";
import LineChart, { niceCeil } from "./charts/LineChart";
import { formatCompactPlayerCount } from "./SteamPlayerCount";
import { useLanguage } from "../context/LanguageContext";
import {
  useSteamPlayerHistory,
  type PlayerHistoryRange,
} from "../hooks/useSteamPlayerHistory";

/**
 * SteamPlayerHistoryChart
 *
 *  Historical concurrent-player line chart for the Steam stats popover.
 *  Replaces the old 24h sparkline with a proper long-range graph backed
 *  by the free steamcharts.com CCU feed (same data SteamDB charts show).
 *
 *  Layout
 *  ──────
 *    ┌─────────────────────────────────────┐
 *    │  PLAYER ACTIVITY       30d 90d 180d ALL│  ← header + range toggle
 *    │  ┌─────────────────────────────┐    │
 *    │  │      __/\___/\_  (line)      │    │  ← LineChart (hover = tooltip)
 *    │  └─────────────────────────────┘    │
 *    │  1.2M   CUR   4.5M  PEAK  2.0M AVG  │  ← 3 stat tiles
 *    └─────────────────────────────────────┘
 *
 *  Hover behavior (the "with mouse hover" ask)
 *  ────────────────────────────────────────
 *  The `LineChart` already renders a crosshair + floating tooltip as the
 *  cursor moves across the plot, so pointing at any point reveals its
 *  date + exact concurrent-player count for free. This component just
 *  feeds it the data.
 *
 *  Range
 *  ─────
 *  30 / 90 / 180 days + All-time, defaulting to 90d (per product
 *  decision). Switching range re-filters the backend's cached full
 *  series in-memory — no second network call inside the TTL.
 */

interface SteamPlayerHistoryChartProps {
  appId: number | undefined;
}

type RangeOption = { label: string; value: PlayerHistoryRange };

const RANGE_OPTIONS: RangeOption[] = [
  { label: "30d", value: 30 },
  { label: "90d", value: 90 },
  { label: "180d", value: 180 },
  { label: "All", value: 0 },
];

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatLabel(ts: number, allTime: boolean): string {
  const d = new Date(ts);
  const mon = MONTHS[d.getMonth()];
  if (allTime) {
    const yy = String(d.getFullYear()).slice(-2);
    return `${mon} '${yy}`;
  }
  return `${mon} ${d.getDate()}`;
}

export default function SteamPlayerHistoryChart({
  appId,
}: SteamPlayerHistoryChartProps) {
  const { t } = useLanguage();
  const [range, setRange] = useState<PlayerHistoryRange>(90);
  const { data, isLoading, error } = useSteamPlayerHistory(appId, range);

  const allTime = range === 0;

  const { series, labels } = useMemo(() => {
    if (!data || data.points.length === 0) {
      return { series: [], labels: [] as string[] };
    }
    const counts = data.points.map((p) => p.count);
    const lbls = data.points.map((p) => formatLabel(p.timestamp, allTime));
    return {
      series: [{ data: counts, color: "var(--color-accent)", label: "Players" }],
      labels: lbls,
    };
  }, [data, allTime]);

  if (!appId) return null;

  const showChart = !!data && data.points.length >= 2;
  const hasData = !!data && data.sampleCount > 0;

  return (
    <section className="steam-history-chart">
      <div className="steam-history-chart-header">
        <span className="steam-stats-popover-section-title">
          <svg
            viewBox="0 0 24 24"
            width="13"
            height="13"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="steam-history-title-icon"
            aria-hidden="true"
          >
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
          {t("steamPlayer.activityTitle")}
        </span>
        <div
          className="player-history-range-toggle"
          role="group"
          aria-label={t("steamPlayer.historyRangeAria")}
        >
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              type="button"
              className={`player-history-range-btn ${
                range === opt.value ? "is-active" : ""
              }`.trim()}
              aria-pressed={range === opt.value}
              onClick={() => setRange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="steam-history-chart-plot">
        {isLoading && !hasData ? (
          <div className="steam-history-chart-skeleton">
            <div className="steam-history-chart-skeleton-bar" />
            <div className="steam-history-chart-skeleton-tiles">
              <span className="steam-stats-popover-skeleton-pill" />
              <span className="steam-stats-popover-skeleton-pill" />
              <span className="steam-stats-popover-skeleton-pill" />
            </div>
          </div>
        ) : error ? (
          <div className="steam-stats-popover-section-error">
            {t("steamPlayer.historyUnavailable")}
          </div>
        ) : showChart ? (
          <LineChart
            series={series}
            labels={labels}
            height={190}
            smooth
            niceMax
            legend={false}
            fillOpacity={0.16}
            formatValue={formatCompactPlayerCount}
            // Extend the y-axis to the TRUE in-range peak (computed from
            // the full series pre-downsample) so a decimated line whose
            // spike day was sampled out still reads against the real
            // peak, and the dashed Peak guide line below always sits
            // inside the plot.
            maxY={niceCeil(data.peakInRange)}
            thresholds={[
              {
                value: data.peakInRange,
                label: t("steamPlayer.statPeak"),
              },
            ]}
          />
        ) : (
          <div className="steam-stats-popover-activity-empty">
            <span
              className="steam-stats-popover-activity-empty-dot"
              aria-hidden="true"
            />
            <span className="steam-stats-popover-activity-empty-text">
              {t("steamPlayer.noHistoryYet")}
            </span>
          </div>
        )}
      </div>

      {hasData && data && (
        <div className="steam-history-chart-stats">
          <HistoryStat
            label={t("steamPlayer.statCurrent")}
            value={formatCompactPlayerCount(data.current)}
            highlight="current"
            icon={
              <span className="steam-stat-live-dot" aria-hidden="true" />
            }
          />
          <HistoryStat
            label={t("steamPlayer.statAvg")}
            value={formatCompactPlayerCount(Math.round(data.averageInRange))}
            icon={
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="18" y1="20" x2="18" y2="10" />
                <line x1="12" y1="20" x2="12" y2="4" />
                <line x1="6" y1="20" x2="6" y2="14" />
              </svg>
            }
          />
          <HistoryStat
            label={allTime ? t("steamPlayer.statAllTimePeak") : t("steamPlayer.statPeak")}
            value={formatCompactPlayerCount(allTime ? data.peakAllTime : data.peakInRange)}
            highlight="alltime"
            icon={
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            }
          />
        </div>
      )}
    </section>
  );
}

function HistoryStat({
  label,
  value,
  highlight,
  icon,
}: {
  label: string;
  value: string;
  highlight?: "current" | "alltime";
  icon?: React.ReactNode;
}) {
  return (
    <div
      className={`steam-history-chart-stat ${
        highlight ? `steam-history-chart-stat--${highlight}` : ""
      }`.trim()}
    >
      <div className="steam-history-chart-stat-header">
        {icon && <span className="steam-history-stat-icon">{icon}</span>}
        <span className="steam-history-chart-stat-label">{label}</span>
      </div>
      <span className="steam-history-chart-stat-value">{value}</span>
    </div>
  );
}
