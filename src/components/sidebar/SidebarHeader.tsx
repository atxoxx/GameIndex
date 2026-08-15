import { memo } from "react";
import { useLanguage } from "../../context/LanguageContext";
import { Button } from "../ui";
import SidebarSearch from "./SidebarSearch";
import SidebarImportDropdown from "./SidebarImportDropdown";
import type { SidebarHeaderProps } from "./types";

/**
 * SidebarHeader
 * ─────────────
 * Top toolbar of the sidebar containing collapse controls,
 * search input, advanced filters launcher, and import action.
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
  showImportMenu,
  importMenuAnchor,
  onToggleImportMenu,
  onImportExe,
  onImportFolder,
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
        <span className="sidebar-header-title">{t("nav.library")}</span>
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
      </div>
    </div>
  );
}

export const SidebarHeader = memo(SidebarHeaderBase);
export default SidebarHeader;
