import type { ReactNode } from "react";
import { useLanguage } from "../../context/LanguageContext";
import { formatBytesShort } from "../../types/download";

export type EmuFilter = "all" | "added" | "notAdded" | "configured" | "notConfigured";

interface StatsProps {
  stats: {
    catalog: number;
    added: number;
    configured: number;
    roms: number;
    totalSizeBytes: number;
  };
  activeFilter: EmuFilter;
  onFilterChange: (filter: EmuFilter) => void;
}

const ICON = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export default function EmulatorStatsHeader({
  stats,
  activeFilter,
  onFilterChange,
}: StatsProps) {
  const { t } = useLanguage();

  const statItems: {
    key: string;
    icon: ReactNode;
    value: string | number;
    label: string;
    filter: EmuFilter | null;
    tone: string;
    subLabel?: string;
  }[] = [
    {
      key: "catalog",
      icon: (
        <svg {...ICON}>
          <polygon points="12 2 2 7 12 12 22 7 12 2" />
          <polyline points="2 17 12 22 22 17" />
          <polyline points="2 12 12 17 22 12" />
        </svg>
      ),
      value: stats.catalog,
      label: t("emulators.stats.catalog"),
      filter: null,
      tone: "emu-stat--neutral",
    },
    {
      key: "added",
      icon: (
        <svg {...ICON}>
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
      ),
      value: stats.added,
      label: t("emulators.stats.added"),
      filter: "added",
      tone: "emu-stat--accent",
    },
    {
      key: "configured",
      icon: (
        <svg {...ICON}>
          <line x1="4" y1="21" x2="4" y2="14" />
          <line x1="4" y1="10" x2="4" y2="3" />
          <line x1="12" y1="21" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12" y2="3" />
          <line x1="20" y1="21" x2="20" y2="16" />
          <line x1="20" y1="12" x2="20" y2="3" />
          <line x1="1" y1="14" x2="7" y2="14" />
          <line x1="9" y1="8" x2="15" y2="8" />
          <line x1="17" y1="16" x2="23" y2="16" />
        </svg>
      ),
      value: stats.configured,
      label: t("emulators.stats.configured"),
      filter: "configured",
      tone: "emu-stat--success",
    },
    {
      key: "roms",
      icon: (
        <svg {...ICON}>
          <line x1="6" y1="11" x2="10" y2="11" />
          <line x1="8" y1="9" x2="8" y2="13" />
          <line x1="15" y1="12" x2="15.01" y2="12" />
          <line x1="18" y1="10" x2="18.01" y2="10" />
          <path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z" />
        </svg>
      ),
      value: stats.roms,
      label: t("emulators.stats.roms"),
      subLabel: stats.totalSizeBytes > 0 ? formatBytesShort(stats.totalSizeBytes) : undefined,
      filter: null,
      tone: "emu-stat--info",
    },
  ];

  return (
    <div className="emulators-stats" role="region" aria-label={t("emulators.stats.catalog")}>
      {statItems.map((s) => {
        const isClickable = s.filter !== null;
        const isActive = s.filter && activeFilter === s.filter;
        return (
          <button
            key={s.key}
            type="button"
            className={`emu-stat${isClickable ? " is-clickable" : ""}${
              isActive ? " is-active" : ""
            } ${s.tone}`}
            onClick={() => s.filter && onFilterChange(s.filter)}
            disabled={!isClickable}
            title={s.filter ? t("emulators.stats.clickToFilter") : undefined}
          >
            <span className="emu-stat-icon">{s.icon}</span>
            <span className="emu-stat-body">
              <div className="emu-stat-row">
                <span className="emu-stat-value">{s.value}</span>
                {s.subLabel && <span className="emu-stat-sublabel">{s.subLabel}</span>}
              </div>
              <span className="emu-stat-label">{s.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
