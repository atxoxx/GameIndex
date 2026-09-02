import { memo } from "react";
import { useLanguage } from "../../context/LanguageContext";
import type { SidebarSectionHeaderProps } from "./types";

/**
 * SidebarSectionHeader
 * ────────────────────
 * Section header component with support for collapsible toggle,
 * title icon, custom badge color tint, and count / search result badge.
 */
function SidebarSectionHeaderBase({
  title,
  count,
  icon,
  collapsible = false,
  isCollapsed = false,
  onToggleCollapse,
  resultLabel,
  badgeColor,
}: SidebarSectionHeaderProps) {
  const { t } = useLanguage();

  if (collapsible && onToggleCollapse) {
    return (
      <div className="sidebar-section-header sidebar-section-header--collapsible">
        <button
          type="button"
          className="sidebar-section-toggle"
          onClick={onToggleCollapse}
          aria-expanded={!isCollapsed}
          title={isCollapsed ? t("sidebar.expandSection") : t("sidebar.collapseSection")}
        >
          <span className="sidebar-section-toggle__chevron" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
                transition: "transform var(--transition-fast)",
              }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </span>
          <span className="sidebar-section-title-group">
            {icon}
            <span className="sidebar-section-title-text">{title}</span>
          </span>
        </button>
        {resultLabel ? (
          <span className="sidebar-list-result">{resultLabel}</span>
        ) : (
          <span
            className="sidebar-list-count"
            style={badgeColor ? { color: badgeColor, backgroundColor: `color-mix(in srgb, ${badgeColor} 16%, transparent)` } : undefined}
          >
            {count}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="sidebar-section-header">
      <span className="sidebar-section-title-group">
        {icon}
        <span className="sidebar-section-title-text">{title}</span>
      </span>
      {resultLabel ? (
        <span className="sidebar-list-result">{resultLabel}</span>
      ) : (
        <span
          className="sidebar-list-count"
          style={badgeColor ? { color: badgeColor, backgroundColor: `color-mix(in srgb, ${badgeColor} 16%, transparent)` } : undefined}
        >
          {count}
        </span>
      )}
    </div>
  );
}

export const SidebarSectionHeader = memo(SidebarSectionHeaderBase);
export default SidebarSectionHeader;
