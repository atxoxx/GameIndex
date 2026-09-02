import { memo } from "react";
import { useLanguage } from "../../context/LanguageContext";
import { Button } from "../ui";
import SidebarSearch from "./SidebarSearch";
import SidebarImportDropdown from "./SidebarImportDropdown";
import SidebarQuickFilterBar from "./SidebarQuickFilterBar";
import SidebarViewOptionsDropdown from "./SidebarViewOptionsDropdown";
import type { SidebarHeaderProps } from "./types";

/**
 * SidebarHeader
 * ─────────────
 * Top toolbar of the sidebar containing collapse controls,
 * search input, view options dropdown trigger, random game roll button,
 * quick filter presets bar, advanced filters launcher, and import action.
 */
function SidebarHeaderBase({
  isIconRail,
  onToggleIconRail,
  searchQuery,
  onSearchChange,
  onClearSearch,
  advancedFilterCount,
  showFilterPopover,
  onToggleFilterPopover,
  filterButtonRef,
  importButtonRef,
  viewOptionsButtonRef,
  showImportMenu,
  importMenuAnchor,
  onToggleImportMenu,
  showViewOptionsMenu,
  onToggleViewOptionsMenu,
  onImportExe,
  onImportFolder,
  onRandomGame,
  activeQuickPreset,
  onSelectQuickPreset,
  quickPresetCounts,
  groupBy,
  onGroupByChange,
  sort,
  onSortChange,
  sortDirection,
  onToggleSortDirection,
  density,
  onDensityChange,
  viewOptions,
  onToggleViewOption,
  onExpandAllGroups,
  onCollapseAllGroups,
  hasGroups,
}: SidebarHeaderProps) {
  const { t } = useLanguage();

  return (
    <div className="sidebar-header">
      <div className="sidebar-header-bar">
        <button
          type="button"
          className="sidebar-collapse-toggle"
          onClick={onToggleIconRail}
          aria-label={isIconRail ? t("sidebar.expand") : t("sidebar.collapse")}
          aria-pressed={isIconRail}
          title={isIconRail ? t("sidebar.expand") : t("sidebar.collapseToRail")}
        >
          {isIconRail ? (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          ) : (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
          )}
        </button>

        {!isIconRail && (
          <div className="sidebar-header-actions-row">
            <span className="sidebar-header-title">{t("nav.library")}</span>

            <div className="sidebar-header-tools">
              {/* Random Roll / Surprise Me Button */}
              <button
                type="button"
                className="sidebar-header-tool-btn"
                onClick={onRandomGame}
                title={t("sidebar.randomGame")}
                aria-label={t("sidebar.randomGame")}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                  <path d="M16 8h.01" />
                  <path d="M8 8h.01" />
                  <path d="M8 16h.01" />
                  <path d="M16 16h.01" />
                  <path d="M12 12h.01" />
                </svg>
              </button>

              {/* View Options (Group / Sort / Density) Dropdown Trigger */}
              <button
                ref={viewOptionsButtonRef}
                type="button"
                className={`sidebar-header-tool-btn${showViewOptionsMenu || groupBy !== "none" ? " active" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleViewOptionsMenu(e.currentTarget);
                }}
                title={t("sidebar.viewOptionsTitle")}
                aria-label={t("sidebar.viewOptionsTitle")}
                aria-haspopup="menu"
                aria-expanded={showViewOptionsMenu}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <line x1="4" y1="6" x2="20" y2="6" />
                  <line x1="4" y1="12" x2="14" y2="12" />
                  <line x1="4" y1="18" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="sidebar-search-row">
        <SidebarSearch
          searchQuery={searchQuery}
          onSearchChange={onSearchChange}
          onClear={onClearSearch}
        />

        <button
          ref={filterButtonRef}
          className={`sidebar-filter-btn${advancedFilterCount > 0 ? " active" : ""}`}
          aria-label={t("sidebar.filterGames")}
          aria-haspopup="dialog"
          aria-expanded={showFilterPopover}
          onClick={onToggleFilterPopover}
          title={t("sidebar.filterGames")}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
          </svg>
          {advancedFilterCount > 0 && (
            <span className="sidebar-filter-count">{advancedFilterCount}</span>
          )}
        </button>
      </div>

      {/* Quick View Presets Bar: All | Installed | Favorites | Playing */}
      {!isIconRail && (
        <SidebarQuickFilterBar
          activePreset={activeQuickPreset}
          onSelectPreset={onSelectQuickPreset}
          counts={quickPresetCounts}
        />
      )}

      <div className="sidebar-import-wrapper">
        <Button
          ref={importButtonRef}
          variant="secondary"
          className="sidebar-import-btn"
          title={t("sidebar.importGamesTitle")}
          onClick={(e) => {
            e.stopPropagation();
            onToggleImportMenu(e.currentTarget);
          }}
          leftIcon={
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ width: 16, height: 16 }}
              aria-hidden="true"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          }
        >
          {t("lib.hero.importGames")}
        </Button>

        {showImportMenu && (
          <SidebarImportDropdown
            anchorEl={importMenuAnchor ?? importButtonRef.current}
            onClose={() => onToggleImportMenu(importButtonRef.current!)}
            onImportExe={onImportExe}
            onImportFolder={onImportFolder}
          />
        )}

        {showViewOptionsMenu && (
          <SidebarViewOptionsDropdown
            anchorEl={viewOptionsButtonRef.current}
            onClose={() => onToggleViewOptionsMenu(viewOptionsButtonRef.current!)}
            groupBy={groupBy}
            onGroupByChange={onGroupByChange}
            sort={sort}
            onSortChange={onSortChange}
            sortDirection={sortDirection}
            onToggleSortDirection={onToggleSortDirection}
            density={density}
            onDensityChange={onDensityChange}
            viewOptions={viewOptions}
            onToggleOption={onToggleViewOption}
            onExpandAllGroups={onExpandAllGroups}
            onCollapseAllGroups={onCollapseAllGroups}
            hasGroups={hasGroups}
          />
        )}
      </div>
    </div>
  );
}

export const SidebarHeader = memo(SidebarHeaderBase);
export default SidebarHeader;
