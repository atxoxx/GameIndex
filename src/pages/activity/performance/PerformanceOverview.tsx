import { useMemo } from "react";
import * as Icons from "../Icons";
import type { PerfOverview, GamePerfAvg } from "./perfData";
import { useLanguage } from "../../../context/LanguageContext";
import type { TempUnit } from "../../../context/SettingsContext";
import { toDisplayTemp, tempUnitLabel, tempThreshold } from "../../../utils/temp";
import { StatBand, StatCell } from "../../../components/activity";

export function PerformanceOverview({
  overview,
  gameAverages,
  totalRamGb,
  tempUnit,
}: {
  overview: PerfOverview;
  gameAverages: GamePerfAvg[];
  totalRamGb: number;
  tempUnit: TempUnit;
}) {
  const { t } = useLanguage();
  const ramGb = totalRamGb > 0 ? (totalRamGb * overview.avgRamPercent) / 100 : 0;
  const hottest =
    overview.hottestGpuTemp >= overview.hottestCpuTemp
      ? { temp: overview.hottestGpuTemp, game: overview.hottestGpuGame, type: "GPU" }
      : { temp: overview.hottestCpuTemp, game: overview.hottestCpuGame, type: "CPU" };

  const isThermalWarning = hottest.temp >= tempThreshold(85, tempUnit);

  // FPS Tiers Breakdown
  const fpsTiers = useMemo(() => {
    let ultra = 0;
    let smooth = 0;
    let playable = 0;
    let low = 0;

    gameAverages.forEach((g) => {
      if (g.avgFps >= 120) ultra++;
      else if (g.avgFps >= 60) smooth++;
      else if (g.avgFps >= 30) playable++;
      else if (g.avgFps > 0) low++;
    });

    return { ultra, smooth, playable, low };
  }, [gameAverages]);

  return (
    <div className="performance-overview-wrapper">
      <StatBand>
        <StatCell
          hero
          icon={<Icons.Gauge size={15} />}
          label={t("activityPerf.avgFps")}
          value={overview.avgFps > 0 ? `${overview.avgFps}` : "—"}
          sub={overview.avgFps > 0 ? "FPS" : undefined}
        />
        <StatCell
          icon={<Icons.Activity size={15} />}
          label={t("activityPerf.trackedSessions")}
          value={overview.telemetrySessions}
          sub={t("activityPerf.acrossGames", { count: gameAverages.length })}
        />
        <StatCell
          icon={<Icons.Trophy size={15} />}
          label={t("activityPerf.bestGame")}
          value={overview.bestGame ? `${overview.bestGame.avgFps} FPS` : "—"}
          sub={overview.bestGame ? overview.bestGame.gameTitle : t("activityPerf.noFpsData")}
        />
        <StatCell
          icon={<Icons.Thermometer size={15} />}
          label={t("activityPerf.hottestTemp")}
          value={
            hottest.temp > 0
              ? `${toDisplayTemp(hottest.temp, tempUnit)}${tempUnitLabel(tempUnit)}`
              : "—"
          }
          sub={hottest.game ? `${hottest.type} • ${hottest.game}` : t("activityPerf.noTempData")}
        />
        <StatCell
          icon={<Icons.MemoryStick size={15} />}
          label={t("activityPerf.ramAvg")}
          value={overview.avgRamPercent > 0 ? `${ramGb.toFixed(1)} GB` : "—"}
          sub={
            overview.avgRamPercent > 0
              ? `${overview.avgRamPercent}% ${totalRamGb > 0 ? `• ${totalRamGb} GB` : ""}`
              : t("activityPerf.noRamData")
          }
        />
      </StatBand>

      {/* FPS Performance Tiers & Thermal Alert */}
      <div className="performance-tiers-bar">
        <div className="performance-tiers-bar__left">
          <span className="performance-tiers-bar__title">{t("activityPerf.tierDistribution")}:</span>
          <div className="performance-tiers-bar__chips">
            <span className="performance-tier-chip performance-tier-chip--ultra" title="120+ FPS">
              <Icons.Zap size={11} /> Ultra 120+: <strong>{fpsTiers.ultra}</strong>
            </span>
            <span className="performance-tier-chip performance-tier-chip--smooth" title="60-120 FPS">
              <Icons.Check size={11} /> Smooth 60+: <strong>{fpsTiers.smooth}</strong>
            </span>
            <span className="performance-tier-chip performance-tier-chip--playable" title="30-60 FPS">
              <Icons.Gauge size={11} /> Playable 30+: <strong>{fpsTiers.playable}</strong>
            </span>
            {fpsTiers.low > 0 && (
              <span className="performance-tier-chip performance-tier-chip--low" title="<30 FPS">
                <Icons.Info size={11} /> &lt;30 FPS: <strong>{fpsTiers.low}</strong>
              </span>
            )}
          </div>
        </div>

        {isThermalWarning && (
          <div className="performance-thermal-alert">
            <Icons.Flame size={13} className="performance-thermal-alert__icon" />
            <span>
              {t("activityPerf.thermalWarning", {
                temp: `${toDisplayTemp(hottest.temp, tempUnit)}${tempUnitLabel(tempUnit)}`,
              })}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
