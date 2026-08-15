import { memo } from "react";
import { useLanguage } from "../../context/LanguageContext";
import type { SidebarEmptyStateProps } from "./types";

/**
 * SidebarEmptyState
 * ─────────────────
 * Renders an informative empty state when the library has no games
 * or when active filters match zero games.
 */
function SidebarEmptyStateBase({
  hasZeroLibraryGames,
  isFilteringActive,
  onImportClick,
  onClearFilters,
}: SidebarEmptyStateProps) {
  const { t } = useLanguage();

  return (
    <div className="sidebar-empty">
      <div className="sidebar-empty-icon" aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
      </div>

      <p className="sidebar-empty-title">
        {hasZeroLibraryGames
          ? t("sidebar.noGamesImported")
          : t("sidebar.noGamesFound")}
      </p>

      {hasZeroLibraryGames ? (
        <button
          type="button"
          className="sidebar-empty-cta"
          onClick={onImportClick}
        >
          {t("sidebar.importGames")}
        </button>
      ) : isFilteringActive ? (
        <button
          type="button"
          className="sidebar-empty-cta sidebar-empty-cta--ghost"
          onClick={onClearFilters}
        >
          {t("sidebar.clearFilters")}
        </button>
      ) : null}
    </div>
  );
}

export const SidebarEmptyState = memo(SidebarEmptyStateBase);
export default SidebarEmptyState;
