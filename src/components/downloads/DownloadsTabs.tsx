import { CalendarClock, History, LayoutList } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { SubTabs, type SubTabItem } from "../ui/SubTabs";

export type DownloadsTabKey = "active" | "scheduled" | "history";

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
];

/**
 * DownloadsTabs — the page's section switcher.
 *
 * Rides the shared `SubTabs` strip so downloads navigation matches every
 * other page: labels in the flow, one sliding accent underline, no tray.
 */
export default function DownloadsTabs({
  activeTab,
  onTabChange,
  counts,
  windowOpen = false,
}: DownloadsTabsProps) {
  const { t } = useLanguage();

  const items: SubTabItem<DownloadsTabKey>[] = TABS.map(
    ({ key, labelKey, icon }) => ({
      id: key,
      label: t(labelKey),
      icon,
      count: counts[key],
      badge:
        key === "scheduled" && windowOpen ? (
          <span
            className="dl-tab-dot"
            title={t("scheduler.windowOpen")}
            aria-hidden="true"
          />
        ) : undefined,
    }),
  );

  return (
    <SubTabs
      items={items}
      value={activeTab}
      onChange={onTabChange}
      ariaLabel={t("downloads.title")}
      className="dl-tabs"
    />
  );
}
