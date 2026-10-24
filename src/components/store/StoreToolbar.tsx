import { SlidersHorizontal } from "lucide-react";
import StoreSortDropdown from "./StoreSortDropdown";
import StoreSearchBar from "./StoreSearchBar";
import StoreSearchPalette from "./StoreSearchPalette";
import DensityToggle from "../DensityToggle";
import PageWidget from "../PageWidget";
import type { StoreCatalogue } from "../../hooks/useStoreCatalogue";
import { useLanguage } from "../../context/LanguageContext";

interface StoreToolbarProps {
  catalogue: StoreCatalogue;
}

/**
 * The sticky command bar. It carries the four controls that need to stay
 * reachable while scrolling a long catalogue — search, sort, filters and
 * density — plus the live result count. Bulk selection and compare moved
 * to the page header, where they are not part of the browsing loop.
 */
export default function StoreToolbar({ catalogue: c }: StoreToolbarProps) {
  const { t } = useLanguage();

  return (
    <div className="store-toolbar store-command-bar">
      <div className="store-toolbar-search">
        <StoreSearchBar
          value={c.searchQuery}
          onChange={c.setSearchQuery}
          visible
          recentSearches={c.recentSearches}
          onRemoveRecent={c.removeRecentSearch}
          onClearRecentSearches={c.clearRecentSearches}
          onPickSuggestion={c.onCardClick}
          flushSearch={c.flushSearch}
          setSearchQueryImmediate={c.setSearchQueryImmediate}
        />
        {/* Command palette (Ctrl+K / Cmd+K) */}
        <StoreSearchPalette catalogue={c} />
      </div>

      <div className="store-toolbar-right">
        <span className="store-toolbar-count">
          {t("storage.gamesCount", {
            count:
              c.sourceFilterChipCount !== undefined
                ? c.sourceFilterChipCount
                : c.displayedGames.length,
            plural: c.displayedGames.length !== 1 ? "s" : "",
          })}
          {/* No-flash refetch cue: during a live search the old results stay
              on screen until the new batch lands, so a quiet "refreshing"
              readout sits next to the count instead of a skeleton flash. */}
          {c.isSearching && c.loading && (
            <span className="store-refresh-cue" role="status" aria-live="polite">
              <span className="store-refresh-cue-dot" aria-hidden="true" />
              {t("store.refreshingResults")}
            </span>
          )}
        </span>

        <StoreSortDropdown value={c.sort} onChange={c.setSort} />

        <PageWidget page="store" widget="filters">
          <button
            type="button"
            className={`store-filter-trigger ui-item-filters${c.activeFilterCount > 0 ? " has-active" : ""}`}
            onClick={() => c.setFiltersOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={c.filtersOpen}
          >
            <SlidersHorizontal size={14} aria-hidden="true" />
            <span>{t("store.filters")}</span>
            {c.activeFilterCount > 0 && (
              <span className="store-filter-trigger-badge">{c.activeFilterCount}</span>
            )}
          </button>
        </PageWidget>

        <div className="store-density-toolbar" aria-label={t("store.toolbar.viewOptions")}>
          <DensityToggle density={c.density} onChange={c.setDensity} />
        </div>
      </div>
    </div>
  );
}
