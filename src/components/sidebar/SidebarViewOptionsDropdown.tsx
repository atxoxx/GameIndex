import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "../../context/LanguageContext";
import type { LibrarySort } from "../../hooks/useLibraryFilters";
import { SORT_LABELS, SORT_OPTIONS } from "../../hooks/useLibraryFilters";
import type {
  SidebarDensity,
  SidebarGroupBy,
  SidebarViewOptionsDropdownProps,
} from "./types";

/**
 * SidebarViewOptionsDropdown
 * ──────────────────────────
 * Portaled panel for configuring sidebar grouping, sorting order & direction,
 * row display density (Compact / Standard / Detailed), and metadata toggles.
 */
export default function SidebarViewOptionsDropdown({
  anchorEl,
  onClose,
  groupBy,
  onGroupByChange,
  sort,
  onSortChange,
  sortDirection,
  onToggleSortDirection,
  density,
  onDensityChange,
  viewOptions,
  onToggleOption,
  onExpandAllGroups,
  onCollapseAllGroups,
  hasGroups,
}: SidebarViewOptionsDropdownProps) {
  const { t } = useLanguage();
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on Escape or click outside
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (!anchorEl) return null;

  const rect = anchorEl.getBoundingClientRect();
  const menuWidth = 280;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 8));
  const top = rect.bottom + 6;

  const GROUP_BY_OPTIONS: { id: SidebarGroupBy; labelKey: string }[] = [
    { id: "none", labelKey: "sidebar.groupBy.none" },
    { id: "platform", labelKey: "sidebar.groupBy.platform" },
    { id: "play_status", labelKey: "sidebar.groupBy.status" },
    { id: "genre", labelKey: "sidebar.groupBy.genre" },
    { id: "letter", labelKey: "sidebar.groupBy.letter" },
    { id: "installed", labelKey: "sidebar.groupBy.installed" },
    { id: "decade", labelKey: "sidebar.groupBy.decade" },
  ];

  const DENSITY_OPTIONS: { id: SidebarDensity; labelKey: string }[] = [
    { id: "compact", labelKey: "sidebar.density.compact" },
    { id: "standard", labelKey: "sidebar.density.standard" },
    { id: "detailed", labelKey: "sidebar.density.detailed" },
  ];

  return createPortal(
    <div
      ref={menuRef}
      className="sidebar-view-options-menu"
      data-sidebar-context-menu="true"
      style={{
        position: "fixed",
        top,
        left,
        width: menuWidth,
        zIndex: "var(--z-popover)",
      }}
      onMouseDown={(e) => e.stopPropagation()}
      role="menu"
      aria-label={t("sidebar.viewOptionsTitle")}
    >
      <div className="sidebar-view-options-menu__header">
        <span className="sidebar-view-options-menu__title">{t("sidebar.viewOptionsTitle")}</span>
      </div>

      {/* ── Group By Section ── */}
      <div className="sidebar-view-options-menu__section">
        <label className="sidebar-view-options-menu__label">
          {t("sidebar.groupByLabel")}
        </label>
        <div className="sidebar-view-options-menu__pill-grid">
          {GROUP_BY_OPTIONS.map((opt) => {
            const active = groupBy === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                className={`sidebar-view-option-pill${active ? " active" : ""}`}
                onClick={() => onGroupByChange(opt.id)}
              >
                {t(opt.labelKey)}
              </button>
            );
          })}
        </div>

        {hasGroups && (
          <div className="sidebar-view-options-menu__actions-row">
            <button
              type="button"
              className="sidebar-view-options-menu__action-link"
              onClick={onExpandAllGroups}
            >
              {t("sidebar.expandAllGroups")}
            </button>
            <button
              type="button"
              className="sidebar-view-options-menu__action-link"
              onClick={onCollapseAllGroups}
            >
              {t("sidebar.collapseAllGroups")}
            </button>
          </div>
        )}
      </div>

      {/* ── Sort & Direction Section ── */}
      <div className="sidebar-view-options-menu__section">
        <label className="sidebar-view-options-menu__label">
          {t("sidebarFilter.sort")}
        </label>
        <div className="sidebar-view-options-menu__sort-row">
          <select
            className="sidebar-view-options-menu__select"
            value={sort}
            onChange={(e) => onSortChange(e.target.value as LibrarySort)}
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {SORT_LABELS[opt]}
              </option>
            ))}
          </select>

          <button
            type="button"
            className={`sidebar-view-options-menu__dir-btn${sortDirection === "desc" ? " desc" : ""}`}
            onClick={onToggleSortDirection}
            title={
              sortDirection === "asc"
                ? t("sidebar.sortDirection.ascending")
                : t("sidebar.sortDirection.descending")
            }
            aria-label={
              sortDirection === "asc"
                ? t("sidebar.sortDirection.ascending")
                : t("sidebar.sortDirection.descending")
            }
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                transform: sortDirection === "desc" ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform var(--transition-fast)",
              }}
            >
              <polyline points="18 15 12 9 6 15" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Display Density Section ── */}
      <div className="sidebar-view-options-menu__section">
        <label className="sidebar-view-options-menu__label">
          {t("sidebar.densityLabel")}
        </label>
        <div className="sidebar-view-options-menu__pill-grid sidebar-view-options-menu__pill-grid--tri">
          {DENSITY_OPTIONS.map((d) => {
            const active = density === d.id;
            return (
              <button
                key={d.id}
                type="button"
                className={`sidebar-view-option-pill${active ? " active" : ""}`}
                onClick={() => onDensityChange(d.id)}
              >
                {t(d.labelKey)}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Metadata Display Toggles ── */}
      <div className="sidebar-view-options-menu__section">
        <label className="sidebar-view-options-menu__label">
          {t("sidebar.visibleMetadataLabel")}
        </label>
        <div className="sidebar-view-options-menu__toggles">
          <label className="sidebar-view-options-menu__toggle-item">
            <span>{t("sidebar.metaShowPlaytime")}</span>
            <input
              type="checkbox"
              checked={viewOptions.showPlaytime}
              onChange={() => onToggleOption("showPlaytime")}
            />
          </label>
          <label className="sidebar-view-options-menu__toggle-item">
            <span>{t("sidebar.metaShowPlatform")}</span>
            <input
              type="checkbox"
              checked={viewOptions.showPlatformBadge}
              onChange={() => onToggleOption("showPlatformBadge")}
            />
          </label>
          <label className="sidebar-view-options-menu__toggle-item">
            <span>{t("sidebar.metaShowAchievements")}</span>
            <input
              type="checkbox"
              checked={viewOptions.showAchievements}
              onChange={() => onToggleOption("showAchievements")}
            />
          </label>
          <label className="sidebar-view-options-menu__toggle-item">
            <span>{t("sidebar.metaShowRatings")}</span>
            <input
              type="checkbox"
              checked={viewOptions.showRatings}
              onChange={() => onToggleOption("showRatings")}
            />
          </label>
        </div>
      </div>
    </div>,
    document.body
  );
}
