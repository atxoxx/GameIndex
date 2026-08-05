import { useMemo } from "react";
import * as Icons from "../Icons";
import { GameThumbnail } from "../GameThumbnail";
import type { GamePerfAvg } from "./perfData";
import { useLanguage } from "../../../context/LanguageContext";
import type { TempUnit } from "../../../context/SettingsContext";
import { toDisplayTemp, tempUnitLabel } from "../../../utils/temp";

export type ComparisonMetric = "fps" | "temps" | "ram";

const TOP_ROWS = 8;

interface BarRow {
  game: GamePerfAvg;
  value: number;
  label: string;
}

/**
 * Rank a bar row: 0 = best, then 1/2 for the podium, null beyond. Sorting is
 * descending by value so rank 0 is always the top performer.
 */
function rankOf(index: number): number | null {
  return index < 3 ? index : null;
}

/** Shared palette for the per-metric fill colors (CSS vars — theme-aware). */
function barColorFor(metric: ComparisonMetric): string {
  if (metric === "fps") return "var(--color-brand-teal)";
  if (metric === "temps") return "var(--color-danger)";
  return "var(--color-brand-blue)";
}

export function PerformanceComparison({
  games,
  metricTab,
  tempUnit,
  totalRamGb,
  onMetricTabChange,
}: {
  games: GamePerfAvg[];
  metricTab: ComparisonMetric;
  tempUnit: TempUnit;
  totalRamGb: number;
  onMetricTabChange: (m: ComparisonMetric) => void;
}) {
  const { t } = useLanguage();

  const rows = useMemo((): BarRow[] => {
    const list: BarRow[] = games.map((g) => {
      if (metricTab === "fps") {
        return {
          game: g,
          value: g.avgFps,
          label: g.avgFps > 0 ? `${g.avgFps} FPS` : "—",
        };
      }
      if (metricTab === "temps") {
        // The hottest of CPU/GPU drives the bar length; both are shown in the
        // label and always honour the user's temperature unit.
        const cpu = toDisplayTemp(g.avgCpuTemp, tempUnit);
        const gpu = toDisplayTemp(g.avgGpuTemp, tempUnit);
        const value = Math.max(g.avgCpuTemp, g.avgGpuTemp);
        const unit = tempUnitLabel(tempUnit);
        const cpuLabel = g.avgCpuTemp > 0 ? `${Math.round(cpu)}${unit}` : "—";
        const gpuLabel = g.avgGpuTemp > 0 ? `${Math.round(gpu)}${unit}` : "—";
        return {
          game: g,
          value,
          label: g.avgCpuTemp > 0 || g.avgGpuTemp > 0 ? `CPU ${cpuLabel} / GPU ${gpuLabel}` : "—",
        };
      }
      const totalRam = totalRamGb || 16;
      const gb = (totalRam * g.avgRamUsage) / 100;
      return {
        game: g,
        value: g.avgRamUsage,
        label: g.avgRamUsage > 0 ? `${gb.toFixed(1)} GB (${g.avgRamUsage}%)` : "—",
      };
    });
    // Games without a reading sink to the bottom; never fabricate a value.
    return list
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, TOP_ROWS);
  }, [games, metricTab, tempUnit, totalRamGb]);

  const maxVal = useMemo(() => {
    let max = 100;
    for (const r of rows) max = Math.max(max, r.value);
    return max;
  }, [rows]);

  const barColor = barColorFor(metricTab);

  return (
    <div className="section-panel performance-insights__chart-panel">
      <div className="performance-insights__chart-header">
        <h3 className="section-panel__title">
          <Icons.BarChart3 size={14} />
          {t("activityPerf.gameComparisons")}
        </h3>
        <div className="performance-insights__tabs" role="tablist" aria-label={t("activityPerf.gameComparisons")}>
          {(["fps", "temps", "ram"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={metricTab === m}
              className={`performance-insights__tab-btn ${
                metricTab === m ? "performance-insights__tab-btn--active" : ""
              }`}
              onClick={() => onMetricTabChange(m)}
            >
              {m === "fps" && <Icons.BarChart3 size={12} />}
              {m === "temps" && <Icons.Flame size={12} />}
              {m === "ram" && <Icons.Cpu size={12} />}
              {m === "fps"
                ? t("activityPerf.avgFps")
                : m === "temps"
                  ? t("activityPerf.tempsUnit", { unit: tempUnitLabel(tempUnit).replace("°", "") })
                  : t("activityPerf.ramGb")}
            </button>
          ))}
        </div>
      </div>

      <div className="performance-compare-bar">
        {rows.map((row, index) => {
          const pct = Math.max(5, Math.min(100, (row.value / maxVal) * 100));
          const rank = rankOf(index);
          return (
            <div key={row.game.gameId} className="performance-compare-bar__row">
              <div className="performance-compare-bar__identity">
                <GameThumbnail
                  iconUrl={row.game.gameIconUrl}
                  coverArtUrl={row.game.coverArtUrl}
                  steamAppId={row.game.steamAppId}
                  name={row.game.gameTitle}
                  className="performance-compare-bar__icon"
                />
                <span className="performance-compare-bar__game-name" title={row.game.gameTitle}>
                  {row.game.gameTitle}
                </span>
              </div>
              <div className="performance-compare-bar__track">
                <div
                  className="performance-compare-bar__fill"
                  style={{ width: `${pct}%`, backgroundColor: barColor }}
                />
              </div>
              <div className="performance-compare-bar__meta">
                {rank !== null && (
                  <span
                    className={`performance-compare-bar__rank performance-compare-bar__rank--${rank}`}
                    title={t("activityPerf.rankTitle")}
                  >
                    {rank === 0 && <Icons.Trophy size={10} />}
                    {rank + 1}
                  </span>
                )}
                <span className="performance-compare-bar__value">{row.label}</span>
              </div>
            </div>
          );
        })}
        {rows.length === 0 && (
          <div className="performance-compare-bar__empty">
            {t("activityPerf.noComparisonData")}
          </div>
        )}
      </div>
    </div>
  );
}
