import { Activity, CalendarClock, History, LayoutList } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";

export type DownloadsTabKey = "active" | "scheduled" | "history" | "diagnostics";

interface DownloadsTabsProps {
  activeTab: DownloadsTabKey;
  onTabChange: (tab: DownloadsTabKey) => void;
  counts: { active: number; scheduled: number; history: number };
  /** True when the scheduler's start window is currently open. */
  windowOpen?: boolean;
}

const TABS: { key: DownloadsTabKey; labelKey: string; icon: LucideIcon }[] = [
  { key: "active", labelKey: "downloads.tabActive", icon: LayoutList },
  { key: "scheduled", labelKey: "downloads.tabScheduled", icon: CalendarClock },
  { key: "history", labelKey: "downloads.tabHistory", icon: History },
  { key: "diagnostics", labelKey: "downloads.tabDiagnostics", icon: Activity },
];

/**
 * DownloadsTabs — the page's section switcher. Mirrors the
 * `dl-stats-nav-bar` tab convention used by the stats modal so the
 * role/aria contract stays identical across the download UI.
 */
export default function DownloadsTabs({
  activeTab,
  onTabChange,
  counts,
  windowOpen = false,
}: DownloadsTabsProps) {
  const { t } = useLanguage();

  const countFor = (key: DownloadsTabKey): number | undefined => {
    if (key === "active") return counts.active;
    if (key === "scheduled") return counts.scheduled;
    if (key === "history") return counts.history;
    return undefined;
  };

  return (
    <div className="dl-tabs-bar" role="tablist" aria-label={t("downloads.title")}>
      {TABS.map(({ key, labelKey, icon: Icon }) => {
        const count = countFor(key);
        const isActive = activeTab === key;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`dl-tab-btn${isActive ? " active" : ""}`}
            onClick={() => onTabChange(key)}
          >
            <Icon size={15} aria-hidden="true" />
            <span>{t(labelKey)}</span>
            {key === "scheduled" && windowOpen && (
              <span className="dl-tab-dot" title={t("scheduler.windowOpen")} aria-hidden="true" />
            )}
            {typeof count === "number" && count > 0 && (
              <span className="dl-tab-count">{count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
