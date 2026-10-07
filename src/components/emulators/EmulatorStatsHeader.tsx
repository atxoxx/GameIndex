import { memo, type ReactNode } from "react";
import { useLanguage } from "../../context/LanguageContext";
import { formatBytesShort } from "../../types/download";
import type { EmuStatusFilter } from "./emulatorUi";

interface StatsProps {
  kpis: {
    systems: number;
    ready: number;
    games: number;
    totalSizeBytes: number;
  };
  activeFilter: EmuStatusFilter;
  onFilterChange: (filter: EmuStatusFilter) => void;
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

function EmulatorStatsHeaderBase({
  kpis,
  activeFilter,
  onFilterChange,
}: StatsProps) {
  const { t } = useLanguage();

  const statItems: {
    key: string;
    icon: ReactNode;
    value: string | number;
    label: string;
    filter: EmuStatusFilter | null;
    tone: string;
  }[] = [
    {
      key: "systems",
      icon: (
        <svg {...ICON}>
          <polygon points="12 2 2 7 12 12 22 7 12 2" />
          <polyline points="2 17 12 22 22 17" />
          <polyline points="2 12 12 17 22 12" />
        </svg>
      ),
      value: kpis.systems,
      label: t("emulators.stats.systems"),
      filter: "all",
      tone: "emu-stat--accent",
    },
    {
      key: "ready",
      icon: (
        <svg {...ICON}>
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      ),
      value: kpis.ready,
      label: t("emulators.stats.ready"),
      filter: "ready",
      tone: "emu-stat--success",
    },
    {
      key: "games",
      icon: (
        <svg {...ICON}>
          <line x1="6" y1="11" x2="10" y2="11" />
          <line x1="8" y1="9" x2="8" y2="13" />
          <line x1="15" y1="12" x2="15.01" y2="12" />
          <line x1="18" y1="10" x2="18.01" y2="10" />
          <path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z" />
        </svg>
      ),
      value: kpis.games,
      label: t("emulators.stats.games"),
      filter: null,
      tone: "emu-stat--info",
    },
    {
      key: "storage",
      icon: (
        <svg {...ICON}>
          <line x1="22" y1="12" x2="2" y2="12" />
          <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
          <line x1="6" y1="16" x2="6.01" y2="16" />
          <line x1="10" y1="16" x2="10.01" y2="16" />
        </svg>
      ),
      value:
        kpis.totalSizeBytes > 0
          ? formatBytesShort(kpis.totalSizeBytes)
          : "—",
      label: t("emulators.stats.storage"),
      filter: null,
      tone: "emu-stat--info",
    },
  ];

  return (
    <div className="emulators-stats" role="region" aria-label={t("emulators.title")}>
      {statItems.map((s) => {
        const isClickable = s.filter !== null;
        const isActive = isClickable && activeFilter === s.filter;
        return (
          <button
            key={s.key}
            type="button"
            className={`emu-stat${isClickable ? " is-clickable" : ""}${
              isActive ? " is-active" : ""
            } ${s.tone}`}
            onClick={() => s.filter && onFilterChange(s.filter)}
            disabled={!isClickable}
            title={isClickable ? t("emulators.stats.clickToFilter") : undefined}
            aria-pressed={isClickable ? isActive : undefined}
          >
            <span className="emu-stat-icon">{s.icon}</span>
            <span className="emu-stat-body">
              <div className="emu-stat-row">
                <span className="emu-stat-value">{s.value}</span>
              </div>
              <span className="emu-stat-label">{s.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default memo(EmulatorStatsHeaderBase);
