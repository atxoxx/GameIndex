import { memo, useRef, useState } from "react";
import { useLanguage } from "../../context/LanguageContext";
import SidebarSearch from "./SidebarSearch";
import SidebarOverflowMenu from "./SidebarOverflowMenu";
import type { SidebarHeaderProps } from "./types";

/**
 * SidebarHeader
 * ─────────────
 * Search-first header for the game rail:
 *
 *   [‹] LIBRARY 128                                   [⋯]
 *   [ search games…                              ] [filter 2]
 *
 * Import, the random roll and the view options live in the "…" panel, so the
 * header reads as one identity row plus one input row.
 */
function SidebarHeaderBase({
  isIconRail,
  onToggleIconRail,
  gameCount,
  searchQuery,
  onSearchChange,
  onClearSearch,
  advancedFilterCount,
  showFilterPopover,
  onToggleFilterPopover,
  filterButtonRef,
  onImportExe,
  onImportFolder,
  onRandomGame,
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
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="sidebar-header">
      <div className="sbn-title-row">
        <button
          type="button"
          className="sidebar-collapse-toggle sbn-icon-btn"
          onClick={onToggleIconRail}
          aria-label={isIconRail ? t("sidebar.expand") : t("sidebar.collapse")}
          aria-pressed={isIconRail}
          title={isIconRail ? t("sidebar.expand") : t("sidebar.collapseToRail")}
        >
          {isIconRail ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          )}
        </button>

        {!isIconRail && (
          <>
            <span className="sbn-title">{t("nav.library")}</span>
            <span className="sbn-title-count" title={t("sidebar.statsTotalTooltip", { count: gameCount })}>
              {gameCount}
            </span>

            <button
              ref={overflowButtonRef}
              type="button"
              className={`sbn-icon-btn sbn-overflow-btn${overflowOpen ? " is-open" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                setOverflowOpen((v) => !v);
              }}
              title={t("sidebar.menuTitle")}
              aria-label={t("sidebar.menuTitle")}
              aria-haspopup="menu"
              aria-expanded={overflowOpen}
            >
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <circle cx="5" cy="12" r="1.7" />
                <circle cx="12" cy="12" r="1.7" />
                <circle cx="19" cy="12" r="1.7" />
              </svg>
            </button>
          </>
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
          type="button"
          className={`sidebar-filter-btn${advancedFilterCount > 0 ? " active" : ""}`}
          aria-label={t("sidebar.filterGames")}
          aria-haspopup="dialog"
          aria-expanded={showFilterPopover}
          onClick={onToggleFilterPopover}
          title={t("sidebar.filterGames")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
          </svg>
          {advancedFilterCount > 0 && (
            <span className="sidebar-filter-count">{advancedFilterCount}</span>
          )}
        </button>
      </div>

      {overflowOpen && !isIconRail && (
        <SidebarOverflowMenu
          anchorEl={overflowButtonRef.current}
          onClose={() => setOverflowOpen(false)}
          onImportExe={onImportExe}
          onImportFolder={onImportFolder}
          onRandomGame={onRandomGame}
          viewOptions={{
            groupBy,
            onGroupByChange,
            sort,
            onSortChange,
            sortDirection,
            onToggleSortDirection,
            density,
            onDensityChange,
            options: viewOptions,
            onToggleOption: onToggleViewOption,
            onExpandAllGroups,
            onCollapseAllGroups,
            hasGroups,
          }}
        />
      )}
    </div>
  );
}

export const SidebarHeader = memo(SidebarHeaderBase);
export default SidebarHeader;
