import type { ReactNode, RefObject } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import DensityToggle from "../DensityToggle";
import LibrarySortMenu from "./LibrarySortMenu";
import LibraryGroupMenu, { type LibraryGroupBy } from "./LibraryGroupMenu";
import type { LibrarySort } from "../../hooks/useLibraryFilters";
import type { LibraryDensity } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";

interface LibraryCommandBarProps {
  /** The scope ribbon, rendered by the page inside the sticky band. */
  scopeBar: ReactNode;
  search: string;
  onSearchChange: (query: string) => void;
  activeFilterCount: number;
  filtersOpen: boolean;
  onToggleFilters: () => void;
  /** Anchor for the filter popover. */
  filtersButtonRef?: RefObject<HTMLButtonElement | null>;
  sort: LibrarySort;
  onSortChange: (sort: LibrarySort) => void;
  groupBy: LibraryGroupBy;
  onGroupByChange: (group: LibraryGroupBy) => void;
  density: LibraryDensity;
  onDensityChange: (density: LibraryDensity) => void;
}

/**
 * LibraryCommandBar — the sticky band that owns the browsing loop.
 *
 * Two rows: the scope ribbon on top, then search and the filter/sort/group/
 * density controls. Everything here stays reachable while the grid scrolls,
 * which is what the old page split between a toolbar and a filter rail.
 */
export default function LibraryCommandBar({
  scopeBar,
  search,
  onSearchChange,
  activeFilterCount,
  filtersOpen,
  onToggleFilters,
  filtersButtonRef,
  sort,
  onSortChange,
  groupBy,
  onGroupByChange,
  density,
  onDensityChange,
}: LibraryCommandBarProps) {
  const { t } = useLanguage();

  return (
    <div className="library-command">
      <div className="library-command-scopes">{scopeBar}</div>

      <div className="library-command-controls">
        <div className={`library-search${search ? " has-value" : ""}`}>
          <Search size={15} className="library-search-icon" aria-hidden="true" />
          <input
            type="search"
            className="library-search-input"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={t("page.library.searchPlaceholder")}
            aria-label={t("page.library.searchLabel")}
          />
          {search.length > 0 && (
            <button
              type="button"
              className="library-search-clear"
              onClick={() => onSearchChange("")}
              aria-label={t("common.clearSearch")}
              title={t("common.clearSearch")}
            >
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="library-command-actions">
          <button
            ref={filtersButtonRef}
            type="button"
            className={`library-filters-trigger${activeFilterCount > 0 ? " has-active" : ""}${filtersOpen ? " is-open" : ""}`}
            onClick={onToggleFilters}
            aria-haspopup="dialog"
            aria-expanded={filtersOpen}
            aria-label={
              activeFilterCount > 0
                ? `${t("store.filtersTitle")}, ${t("library.filterCount", { count: activeFilterCount })}`
                : t("store.filtersTitle")
            }
            title={t("store.filtersTitle")}
          >
            <SlidersHorizontal size={14} aria-hidden="true" />
            <span>{t("store.filters")}</span>
            {activeFilterCount > 0 && (
              <span className="library-filters-badge" aria-hidden="true">
                {activeFilterCount}
              </span>
            )}
          </button>

          <LibrarySortMenu value={sort} onChange={onSortChange} />
          <LibraryGroupMenu value={groupBy} onChange={onGroupByChange} />

          <span className="library-command-sep" aria-hidden="true" />

          <div className="library-command-density" aria-label={t("library.viewOptions")}>
            <DensityToggle
              density={density}
              options={["cozy", "compact", "list"]}
              onChange={(next) => {
                if (next !== "cinematic") onDensityChange(next);
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
