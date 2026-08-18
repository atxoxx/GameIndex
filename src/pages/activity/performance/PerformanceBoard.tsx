import { useMemo, useState } from "react";
import * as Icons from "../Icons";
import { GameThumbnail } from "../GameThumbnail";
import { SectionPanel } from "../../../components/activity";
import type { GamePerfAvg } from "./perfData";
import { useLanguage } from "../../../context/LanguageContext";
import type { TempUnit } from "../../../context/SettingsContext";
import { formatTemp } from "../../../utils/temp";

type SortKey = "game" | "sessions" | "fps" | "cpuTemp" | "gpuTemp" | "ram" | "cpu" | "gpu";
type SortDir = "asc" | "desc";

const INITIAL_ROWS = 10;

interface Column {
  key: SortKey;
  labelKey: string;
  align?: "right";
}

const COLUMNS: Column[] = [
  { key: "game", labelKey: "activityPerf.columnGame" },
  { key: "sessions", labelKey: "activityPerf.columnSessions", align: "right" },
  { key: "fps", labelKey: "activityPerf.columnAvgFps", align: "right" },
  { key: "cpuTemp", labelKey: "activityPerf.columnAvgCpuTemp", align: "right" },
  { key: "gpuTemp", labelKey: "activityPerf.columnAvgGpuTemp", align: "right" },
  { key: "ram", labelKey: "activityPerf.columnAvgRam", align: "right" },
  { key: "cpu", labelKey: "activityPerf.columnAvgCpuLoad", align: "right" },
  { key: "gpu", labelKey: "activityPerf.columnAvgGpuLoad", align: "right" },
];

function cellValue(g: GamePerfAvg, key: SortKey): number | string {
  switch (key) {
    case "game": return g.gameTitle.toLowerCase();
    case "sessions": return g.sessionsCount;
    case "fps": return g.avgFps;
    case "cpuTemp": return g.avgCpuTemp;
    case "gpuTemp": return g.avgGpuTemp;
    case "ram": return g.avgRamUsage;
    case "cpu": return g.avgCpuUsage;
    case "gpu": return g.avgGpuUsage;
  }
}

export function PerformanceBoard({
  games,
  tempUnit,
  totalRamGb,
}: {
  games: GamePerfAvg[];
  tempUnit: TempUnit;
  totalRamGb: number;
}) {
  const { t } = useLanguage();
  const [sortKey, setSortKey] = useState<SortKey>("fps");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [showAll, setShowAll] = useState(false);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...games].sort((a, b) => {
      const va = cellValue(a, sortKey);
      const vb = cellValue(b, sortKey);
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  }, [games, sortKey, sortDir]);

  const visible = showAll ? sorted : sorted.slice(0, INITIAL_ROWS);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Numeric columns default to descending (biggest first), names to ascending.
      setSortDir(key === "game" ? "asc" : "desc");
    }
  };

  const showSortIcon = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? <Icons.ChevronUp size={11} /> : <Icons.ChevronDown size={11} />) : <Icons.ArrowUpDown size={11} />;

  const fpsRange = (g: GamePerfAvg) => {
    if (g.minFps > 0 && g.maxFps > 0) return `${g.minFps}–${g.maxFps}`;
    if (g.avgFps > 0) return g.fpsCount > 1 ? `${g.minFps || "?"}–${g.maxFps || "?"}` : "";
    return "";
  };

  return (
    <SectionPanel
      icon={<Icons.BarChart3 size={14} />}
      title={t("activityPerf.detailedBoard")}
      tools={<span className="act-panel__sub">{t("activityPerf.boardCount", { count: games.length })}</span>}
    >
      <div className="performance-insights__table-wrapper">
        <table className="performance-insights__table">
          <thead>
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className={col.align ? "performance-insights__th--right" : ""}
                  aria-sort={sortKey === col.key ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                >
                  <button
                    type="button"
                    className={`performance-insights__sort-btn${
                      sortKey === col.key ? " performance-insights__sort-btn--active" : ""
                    }`}
                    onClick={() => toggleSort(col.key)}
                    aria-label={
                      sortKey === col.key
                        ? `${t("activityPerf.sortBy", { key: t(col.labelKey) })} — ${sortDir === "asc" ? t("activityPerf.sortAsc") : t("activityPerf.sortDesc")}`
                        : t("activityPerf.sortBy", { key: t(col.labelKey) })
                    }
                  >
                    {t(col.labelKey)}
                    <span className="performance-insights__sort-icon">{showSortIcon(col.key)}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="section-panel__empty">
                  {t("activityPerf.noMetrics")}
                </td>
              </tr>
            ) : (
              visible.map((g) => {
                const isFpsHigh = g.avgFps >= 60;
                const isCpuHot = g.avgCpuTemp >= 75;
                const isGpuHot = g.avgGpuTemp >= 75;
                const isRamHigh = g.avgRamUsage >= 90;
                const isCpuHigh = g.avgCpuUsage >= 90;
                const isGpuHigh = g.avgGpuUsage >= 90;

                return (
                  <tr key={g.gameId}>
                    <td>
                      <div className="performance-insights__game-cell">
                        <GameThumbnail
                          iconUrl={g.gameIconUrl}
                          coverArtUrl={g.coverArtUrl}
                          steamAppId={g.steamAppId}
                          name={g.gameTitle}
                          className="performance-insights__game-icon"
                        />
                        <span className="performance-insights__game-title">{g.gameTitle}</span>
                      </div>
                    </td>
                    <td className="performance-insights__td--num">{g.sessionsCount}</td>
                    <td className={`performance-insights__td--num ${isFpsHigh ? "text-high-fps" : ""}`}>
                      {g.avgFps > 0 ? g.avgFps : "—"}
                      {fpsRange(g) && (
                        <span className="performance-insights__cell-sub" title={t("activityPerf.fpsRange")}>
                          {fpsRange(g)}
                        </span>
                      )}
                    </td>
                    <td className={`performance-insights__td--num ${isCpuHot ? "text-hot-temp" : ""}`}>
                      {g.avgCpuTemp > 0 ? formatTemp(g.avgCpuTemp, tempUnit) : "—"}
                    </td>
                    <td className={`performance-insights__td--num ${isGpuHot ? "text-hot-temp" : ""}`}>
                      {g.avgGpuTemp > 0 ? formatTemp(g.avgGpuTemp, tempUnit) : "—"}
                    </td>
                    <td className={`performance-insights__td--num ${isRamHigh ? "text-hot-temp" : ""}`}>
                      {g.avgRamUsage > 0
                        ? `${(((totalRamGb || 16) * g.avgRamUsage) / 100).toFixed(1)} GB`
                        : "—"}
                    </td>
                    <td className={`performance-insights__td--num ${isCpuHigh ? "text-hot-temp" : ""}`}>
                      {g.avgCpuUsage > 0 ? `${g.avgCpuUsage}%` : "—"}
                    </td>
                    <td className={`performance-insights__td--num ${isGpuHigh ? "text-hot-temp" : ""}`}>
                      {g.avgGpuUsage > 0 ? `${g.avgGpuUsage}%` : "—"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {games.length > INITIAL_ROWS && (
        <div className="performance-insights__footer">
          <button
            type="button"
            className="performance-insights__show-more"
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll
              ? t("activityPerf.showTop", { n: INITIAL_ROWS })
              : t("activityPerf.showAll", { count: games.length })}
          </button>
        </div>
      )}
    </SectionPanel>
  );
}
