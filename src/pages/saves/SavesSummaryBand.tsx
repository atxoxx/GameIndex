import { Archive, Clock, FolderOpen, Gamepad2, TriangleAlert } from "lucide-react";
import { StatBand, type StatBandItem } from "../../components/ui";
import { useLanguage } from "../../context/LanguageContext";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import type { SavesSummary } from "../../types/saves";
import { formatRelative } from "../../utils/savesTime";
import type { SavesOverview } from "./savesData";

interface SavesSummaryBandProps {
  summary: SavesSummary | null;
  overview: SavesOverview;
  /** Probed missing path count; falls back to the backend summary while loading. */
  missingLocations: number;
}

/** The page's summary row: figures only, no tiles or frames. */
export default function SavesSummaryBand({
  summary,
  overview,
  missingLocations,
}: SavesSummaryBandProps) {
  const { t, language } = useLanguage();
  const { formatBytes } = useSizeUnit();

  const installed = overview.tracked.filter((entry) => entry.installed).length;
  const attention = overview.counts.attention;
  const lastBackupAt = summary?.lastBackupAt ?? null;

  const items: StatBandItem[] = [
    {
      id: "games",
      label: t("saves.kpi.games"),
      value: overview.tracked.length || summary?.gamesWithLocations || 0,
      detail:
        attention > 0
          ? t("saves.kpi.attentionCount", { count: attention })
          : t("saves.kpi.installedCount", { count: installed }),
      tone: attention > 0 ? "warning" : "accent",
      icon: <Gamepad2 size={14} />,
    },
    {
      id: "locations",
      label: t("saves.kpi.locations"),
      value: summary?.totalLocations ?? 0,
      detail: missingLocations > 0 ? t("saves.kpi.missing", { count: missingLocations }) : undefined,
      tone: missingLocations > 0 ? "danger" : "default",
      icon: <FolderOpen size={14} />,
    },
    {
      id: "snapshots",
      label: t("saves.kpi.backups"),
      value: summary?.totalBackups ?? 0,
      detail: formatBytes(summary?.totalBackupBytes ?? overview.totalSnapshotBytes),
      tone: "info",
      icon: <Archive size={14} />,
    },
    {
      id: "last",
      label: t("saves.kpi.lastBackup"),
      value: lastBackupAt ? formatRelative(lastBackupAt, language) : t("saves.kpi.never"),
      tone: missingLocations > 0 ? "warning" : "default",
      icon: missingLocations > 0 ? <TriangleAlert size={14} /> : <Clock size={14} />,
    },
  ];

  return <StatBand items={items} ariaLabel={t("saves.kpi.label")} className="saves-stats" />;
}
