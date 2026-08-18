import * as Icons from "../Icons";
import type { PerfOverview } from "./perfData";
import { useLanguage } from "../../../context/LanguageContext";
import type { TempUnit } from "../../../context/SettingsContext";
import { toDisplayTemp, tempUnitLabel } from "../../../utils/temp";
import { StatBand, StatCell } from "../../../components/activity";

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
  const hottest =
    overview.hottestGpuTemp >= overview.hottestCpuTemp
      ? { temp: overview.hottestGpuTemp, game: overview.hottestGpuGame }
      : { temp: overview.hottestCpuTemp, game: overview.hottestCpuGame };

  return (
    <StatBand>
      <StatCell
        hero
        icon={<Icons.Gauge size={15} />}
        label={t("activityPerf.avgFps")}
        value={overview.avgFps > 0 ? overview.avgFps : "—"}
      />
      <StatCell
        icon={<Icons.Activity size={15} />}
        label={t("activityPerf.trackedSessions")}
        value={overview.telemetrySessions}
      />
      <StatCell
        icon={<Icons.Trophy size={15} />}
        label={t("activityPerf.bestGame")}
        value={overview.bestGame ? overview.bestGame.avgFps : "—"}
        sub={overview.bestGame ? overview.bestGame.gameTitle : t("activityPerf.noFpsData")}
      />
      <StatCell
        icon={<Icons.Thermometer size={15} />}
        label={t("activityPerf.hottestTemp")}
        value={hottest.temp > 0 ? `${toDisplayTemp(hottest.temp, tempUnit)}${tempUnitLabel(tempUnit)}` : "—"}
        sub={hottest.game || t("activityPerf.noTempData")}
      />
      <StatCell
        icon={<Icons.MemoryStick size={15} />}
        label={t("activityPerf.ramAvg")}
        value={overview.avgRamPercent > 0 ? ramGb.toFixed(1) : "—"}
        sub={overview.avgRamPercent > 0 ? `${overview.avgRamPercent}% · ${totalRamGb} GB` : t("activityPerf.noRamData")}
      />
    </StatBand>
  );
}
