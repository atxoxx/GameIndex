import { useLanguage } from "../../context/LanguageContext";

interface LibraryFilterRailProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  children: React.ReactNode;
}

/**
 * LibraryFilterRail — the collapsible left rail that hosts the filter
 * sidebar. Owns only the collapse toggle chrome; the actual filter UI is
 * passed in as children so this component stays layout-only.
 */
export default function LibraryFilterRail({
  collapsed,
  onToggleCollapsed,
  children,
}: LibraryFilterRailProps) {
  const { t } = useLanguage();

  return (
    <div className={`lib-rail-wrap${collapsed ? " collapsed" : ""}`}>
      <button
        type="button"
        className="lib-rail-toggle-btn"
        onClick={onToggleCollapsed}
        aria-label={collapsed ? t("page.library.expandFilters") : t("page.library.collapseFilters")}
        aria-expanded={!collapsed}
        title={collapsed ? t("page.library.expandFilters") : t("page.library.collapseFilters")}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
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
      </button>
      {!collapsed && children}
    </div>
  );
}
