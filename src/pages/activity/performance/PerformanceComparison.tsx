import { useMemo } from "react";
import * as Icons from "../Icons";
import { GameThumbnail } from "../GameThumbnail";
import { SectionPanel, Segmented } from "../../../components/activity";
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

function rankOf(index: number): number | null {
  return index < 3 ? index : null;
}

function barGradientFor(metric: ComparisonMetric): string {
  if (metric === "fps") {
    return "linear-gradient(90deg, var(--color-brand-teal) 0%, color-mix(in srgb, var(--color-brand-teal) 70%, #5eead4) 100%)";
  }
  if (metric === "temps") {
    return "linear-gradient(90deg, var(--color-warning) 0%, var(--color-danger) 100%)";
  }
  return "linear-gradient(90deg, var(--color-brand-blue) 0%, color-mix(in srgb, var(--color-brand-blue) 75%, #93c5fd) 100%)";
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
        const cpu = toDisplayTemp(g.avgCpuTemp, tempUnit);
        const gpu = toDisplayTemp(g.avgGpuTemp, tempUnit);
        const value = g.avgCpuTemp > 0 || g.avgGpuTemp > 0 ? Math.max(cpu, gpu) : 0;
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

  const avgVal = useMemo(() => {
    if (rows.length === 0) return 0;
    return Math.round(rows.reduce((sum, r) => sum + r.value, 0) / rows.length);
  }, [rows]);

  const barBackground = barGradientFor(metricTab);

  return (
    <SectionPanel
      icon={<Icons.BarChart3 size={14} />}
      title={t("activityPerf.gameComparisons")}
      tools={
        <div className="performance-compare-tools">
          <Segmented<ComparisonMetric>
            size="sm"
            ariaLabel={t("activityPerf.gameComparisons")}
            value={metricTab}
            onChange={onMetricTabChange}
            options={[
              { value: "fps", label: <><Icons.BarChart3 size={12} /> {t("activityPerf.avgFps")}</> },
              {
                value: "temps",
                label: <><Icons.Flame size={12} /> {t("activityPerf.tempsUnit", { unit: tempUnitLabel(tempUnit).replace("°", "") })}</>,
              },
              { value: "ram", label: <><Icons.Cpu size={12} /> {t("activityPerf.ramGb")}</> },
            ]}
          />
        </div>
      }
    >
      <div className="performance-compare-bar">
        {rows.map((row, index) => {
          const pct = Math.max(6, Math.min(100, (row.value / maxVal) * 100));
          const rank = rankOf(index);
          const diffVsAvg = avgVal > 0 ? Math.round(((row.value - avgVal) / avgVal) * 100) : 0;

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
                  style={{
                    width: `${pct}%`,
                    background: barBackground,
                    boxShadow: "0 1px 4px rgba(0, 0, 0, 0.2)",
                  }}
                />
              </div>
              <div className="performance-compare-bar__meta">
                {rank !== null && (
                  <span
                    className={`performance-compare-bar__rank performance-compare-bar__rank--${rank}`}
                    title={t("activityPerf.rankTitle")}
                  >
                    {rank === 0 && <Icons.Trophy size={11} />}
                    {rank + 1}
                  </span>
                )}
                <span className="performance-compare-bar__value">{row.label}</span>
                {diffVsAvg !== 0 && (
                  <span
                    className={`performance-compare-bar__diff ${
                      (metricTab === "fps" ? diffVsAvg > 0 : diffVsAvg < 0)
                        ? "is-good"
                        : "is-bad"
                    }`}
                  >
                    {diffVsAvg > 0 ? `+${diffVsAvg}%` : `${diffVsAvg}%`}
                  </span>
                )}
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
    </SectionPanel>
  );
}
