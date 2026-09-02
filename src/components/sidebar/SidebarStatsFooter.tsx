import { memo } from "react";
import { useLanguage } from "../../context/LanguageContext";
import { formatMinutesTotal } from "./utils";
import type { SidebarStatsFooterProps } from "./types";

/**
 * SidebarStatsFooter
 * ──────────────────
 * Sticky bottom library overview bar displaying total titles, installed titles,
 * and total hours played.
 */
function SidebarStatsFooterBase({
  stats,
  isFilteringActive,
  onFilterInstalled,
}: SidebarStatsFooterProps) {
  const { t } = useLanguage();

  return (
    <footer
      className={`sidebar-stats-footer ${isFilteringActive ? "sidebar-stats-footer--filtered" : ""}`.trim()}
      aria-label={t("sidebar.statsAria")}
    >
      <div className="sidebar-stats-footer__items">
        <div className="sidebar-stats-footer__item" title={t("sidebar.statsTotalTooltip", { count: stats.total })}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="6" width="20" height="12" rx="2" />
            <path d="M6 12h4m-2-2v4m7-2h.01m3 0h.01" />
          </svg>
          <span>{stats.total}</span>
        </div>

        <button
          type="button"
          className="sidebar-stats-footer__item sidebar-stats-footer__item--clickable"
          onClick={onFilterInstalled}
          title={t("sidebar.statsInstalledTooltip", { count: stats.installed })}
        >
          <span className="sidebar-stats-footer__dot" aria-hidden="true" />
          <span>{stats.installed}</span>
        </button>

        <div className="sidebar-stats-footer__item" title={t("sidebar.statsPlaytimeTooltip")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <span>{formatMinutesTotal(stats.totalPlaytimeMinutes)}</span>
        </div>
      </div>
    </footer>
  );
}

export const SidebarStatsFooter = memo(SidebarStatsFooterBase);
export default SidebarStatsFooter;
