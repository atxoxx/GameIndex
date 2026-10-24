import { useMemo } from "react";
import {
  AlertTriangle,
  Gamepad2,
  HardDrive,
  HelpCircle,
  Layers,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { Game } from "../../types/game";
import { formatSize } from "../../types/game";
import { StatBand, type StatBandItem } from "../../components/ui";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { useLanguage } from "../../context/LanguageContext";
import type { DriveUsage } from "./useDriveUsage";
import {
  getLargestGame,
  sizeCoverage,
  totalBytesWithMods,
  type StorageFilter,
  type StorageTab,
} from "./utils";
import { LOW_SPACE_PCT } from "./recommendations";

interface Props {
  games: Game[];
  staleCount: number;
  driveUsage: Map<string, DriveUsage>;
  onFilter: (filter: StorageFilter) => void;
  onOpenTab: (tab: StorageTab) => void;
}

/**
 * StorageStatBand — the page's only summary surface.
 *
 * Deliberately not a grid of KPI tiles: figures float on the page, and only
 * the two states that need action (unmeasured, broken paths) are clickable.
 * Replaces the four-card hero that used to push the library below the fold.
 */
export function StorageStatBand({ games, staleCount, driveUsage, onFilter, onOpenTab }: Props) {
  const { t } = useLanguage();
  const { unit } = useSizeUnit();

  const total = useMemo(() => totalBytesWithMods(games), [games]);
  const coverage = useMemo(() => sizeCoverage(games), [games]);
  const largest = useMemo(() => getLargestGame(games), [games]);
  const modsBytes = useMemo(
    () => games.reduce((sum, game) => sum + (game.modsSizeBytes ?? 0), 0),
    [games],
  );

  const capacity = useMemo(() => {
    let totalCap = 0;
    let available = 0;
    for (const usage of driveUsage.values()) {
      totalCap += usage.total;
      available += usage.available;
    }
    return { totalCap, available, freePct: totalCap > 0 ? (available / totalCap) * 100 : 0 };
  }, [driveUsage]);

  const items: StatBandItem[] = [
    {
      id: "tracked",
      label: t("storageStat.tracked"),
      value: formatSize(total, unit),
      tone: "accent",
      icon: <HardDrive />,
      hint: t("storageStat.trackedHint"),
    },
    {
      id: "free",
      label: t("storageStat.free"),
      value: capacity.totalCap > 0 ? formatSize(capacity.available, unit) : "—",
      tone: capacity.totalCap > 0 && capacity.freePct < LOW_SPACE_PCT ? "danger" : "default",
      icon: <Layers />,
      detail:
        capacity.totalCap > 0
          ? t("storageStat.freeOf", { total: formatSize(capacity.totalCap, unit) })
          : t("storageStat.noCapacity"),
      progress: capacity.totalCap > 0 ? 100 - capacity.freePct : undefined,
    },
    {
      id: "games",
      label: t("storageStat.games"),
      value: String(games.length),
      icon: <Gamepad2 />,
      detail: t("storageStat.installedOnly"),
    },
    {
      id: "unmeasured",
      label: t("storageStat.unmeasured"),
      value: String(coverage.unsized),
      tone: coverage.unsized > 0 ? "warning" : "success",
      icon: <HelpCircle />,
      detail:
        coverage.unsized > 0
          ? t("storageStat.measureNow")
          : t("storageStat.allMeasured"),
      onClick: coverage.unsized > 0 ? () => onFilter("missing") : undefined,
      hint: t("storageStat.unmeasuredHint"),
    },
    {
      id: "stale",
      label: t("storageStat.stale"),
      value: String(staleCount),
      tone: staleCount > 0 ? "danger" : "success",
      icon: <AlertTriangle />,
      detail: staleCount > 0 ? t("storageStat.fixPaths") : t("storageStat.pathsHealthy"),
      onClick: staleCount > 0 ? () => onOpenTab("health") : undefined,
      hint: t("storageStat.staleHint"),
    },
    {
      id: "largest",
      label: t("storageStat.largest"),
      value: largest ? formatSize(totalBytesWithMods([largest]), unit) : "—",
      icon: <Sparkles />,
      detail: largest ? largest.displayName || largest.name : t("storageStat.noGames"),
      hint: largest ? largest.displayName || largest.name : undefined,
    },
    {
      id: "mods",
      label: t("storageStat.mods"),
      value: formatSize(modsBytes, unit),
      tone: modsBytes > 0 ? "info" : "default",
      icon: <Trash2 />,
      detail: t("storageStat.modsDetail"),
    },
  ];

  return (
    <StatBand
      ariaLabel={t("storageStat.aria")}
      items={items}
      className="storage-statband"
    />
  );
}
