import * as Icons from "../Icons";
import type { PerfOverview } from "./perfData";
import { useLanguage } from "../../../context/LanguageContext";
import type { TempUnit } from "../../../context/SettingsContext";
import { toDisplayTemp, tempUnitLabel } from "../../../utils/temp";

/**
 * Headline KPI strip for the Performance tab. Reuses the dashboard's stats
 * band classes (`.activity__stats`) so the two tabs share one visual language:
 * hairline-divided zones with a hero accent on the first cell.
 */
export function PerformanceOverview({
  overview,
  totalRamGb,
  tempUnit,
}: {
  overview: PerfOverview;
  totalRamGb: number;
  tempUnit: TempUnit;
}) {
  const { t } = useLanguage();
  const ramGb = totalRamGb > 0 ? (totalRamGb * overview.avgRamPercent) / 100 : 0;
  // Show the hotter of CPU/GPU as the headline temp number.
  const hottest = overview.hottestGpuTemp >= overview.hottestCpuTemp
    ? { temp: overview.hottestGpuTemp, game: overview.hottestGpuGame }
    : { temp: overview.hottestCpuTemp, game: overview.hottestCpuGame };

  return (
    <div className="activity__stats performance-overview">
      <div className="activity__stat activity__stat--hero">
        <div className="activity__stat-icon">
          <Icons.Gauge size={15} />
        </div>
        <div className="activity__stat-body">
          <span className="activity__stat-label">{t("activityPerf.avgFps")}</span>
          <span className="activity__stat-value">
            {overview.avgFps > 0 ? overview.avgFps : "—"}
          </span>
        </div>
      </div>

      <div className="activity__stat">
        <div className="activity__stat-icon">
          <Icons.Activity size={15} />
        </div>
        <div className="activity__stat-body">
          <span className="activity__stat-label">{t("activityPerf.trackedSessions")}</span>
          <span className="activity__stat-value">{overview.telemetrySessions}</span>
        </div>
      </div>

      <div className="activity__stat">
        <div className="activity__stat-icon">
          <Icons.Trophy size={15} />
        </div>
        <div className="activity__stat-body">
          <span className="activity__stat-label">{t("activityPerf.bestGame")}</span>
          <span className="activity__stat-value activity__stat-value--sub">
            {overview.bestGame ? `${overview.bestGame.avgFps}` : "—"}
          </span>
          <span className="activity__stat-sub">
            {overview.bestGame ? overview.bestGame.gameTitle : t("activityPerf.noFpsData")}
          </span>
        </div>
      </div>

      <div className="activity__stat">
        <div className="activity__stat-icon">
          <Icons.Thermometer size={15} />
        </div>
        <div className="activity__stat-body">
          <span className="activity__stat-label">{t("activityPerf.hottestTemp")}</span>
          <span className="activity__stat-value activity__stat-value--sub">
            {hottest.temp > 0 ? toDisplayTemp(hottest.temp, tempUnit) : "—"}
            {hottest.temp > 0 ? tempUnitLabel(tempUnit) : ""}
          </span>
          <span className="activity__stat-sub">
            {hottest.game ? hottest.game : t("activityPerf.noTempData")}
          </span>
        </div>
      </div>

      <div className="activity__stat">
        <div className="activity__stat-icon">
          <Icons.MemoryStick size={15} />
        </div>
        <div className="activity__stat-body">
          <span className="activity__stat-label">{t("activityPerf.ramAvg")}</span>
          <span className="activity__stat-value activity__stat-value--sub">
            {overview.avgRamPercent > 0 ? ramGb.toFixed(1) : "—"}
          </span>
          <span className="activity__stat-sub">
            {overview.avgRamPercent > 0 ? `${overview.avgRamPercent}% · ${totalRamGb} GB` : t("activityPerf.noRamData")}
          </span>
        </div>
      </div>
    </div>
  );
}
