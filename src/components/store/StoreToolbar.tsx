import StoreSortDropdown from "./StoreSortDropdown";
import StoreSearchBar from "./StoreSearchBar";
import StoreSearchPalette from "./StoreSearchPalette";
import DensityToggle from "../DensityToggle";
import type { StoreCatalogue } from "../../hooks/useStoreCatalogue";
import { useLanguage } from "../../context/LanguageContext";

interface StoreToolbarProps {
  catalogue: StoreCatalogue;
}

/**
 * StoreToolbar: a slim utility bar that sits between the filter rail and the
 * game grid. It groups the search box, sort dropdown, multi-select toggle, and
 * the card density control into one coherent row so the sticky header can stay
 * focused on branding + result count.
 */
export default function StoreToolbar({ catalogue: c }: StoreToolbarProps) {
  const { t } = useLanguage();
  return (
    <div className="store-toolbar">
      <div className="store-toolbar-search">
        <StoreSearchBar
          value={c.searchQuery}
          onChange={c.setSearchQuery}
          visible
          recentSearches={c.recentSearches}
          onRemoveRecent={c.removeRecentSearch}
          onClearRecentSearches={c.clearRecentSearches}
          onPickSuggestion={c.onCardClick}
          activeFilters={{
            genres: c.selectedGenres,
            platforms: c.selectedPlatforms,
            yearMin: c.yearMin,
            yearMax: c.yearMax,
            ratingMin: c.ratingMin,
          }}
          onRemoveFilter={(type, value) => {
            if (type === "genre" && value) c.setSelectedGenres(c.selectedGenres.filter((g) => g !== value));
            else if (type === "platform" && value) c.setSelectedPlatforms(c.selectedPlatforms.filter((p) => p !== value));
            else if (type === "year") c.setYearRange(null, null);
            else if (type === "rating") c.setRatingMin(null);
            else if (type === "all") c.resetFilters();
          }}
          flushSearch={c.flushSearch}
          setSearchQueryImmediate={c.setSearchQueryImmediate}
        />
        {/* Command palette (Ctrl+K / Cmd+K) */}
        <StoreSearchPalette catalogue={c} />
      </div>

      <div className="store-toolbar-right">
        <StoreSortDropdown value={c.sort} onChange={c.setSort} />

        <button
          type="button"
          className={`store-filter-trigger${c.activeFilterCount > 0 ? " has-active" : ""}`}
          onClick={() => c.setFiltersOpen(!c.filtersOpen)}
          aria-haspopup="dialog"
          aria-expanded={c.filtersOpen}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="4" y1="6" x2="20" y2="6" />
            <line x1="7" y1="12" x2="17" y2="12" />
            <line x1="10" y1="18" x2="14" y2="18" />
          </svg>
          {t("store.filters")}
          {c.activeFilterCount > 0 && <span className="store-filter-trigger-badge">{c.activeFilterCount}</span>}
        </button>

        <button
          type="button"
          className={`store-toolbar-toggle${c.bulkMode ? " active" : ""}`}
          onClick={() => {
            c.setBulkMode(!c.bulkMode);
            c.clearSelection();
          }}
          title={t("storeToolbar.selectMultiple")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="9 11 12 14 22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
          {t("store.selectLabel")}
        </button>

        <div className="store-density-toolbar" aria-label={t("store.toolbar.layoutControls")}>
          <DensityToggle density={c.density} onChange={c.setDensity} />
        </div>
      </div>
    </div>
  );
}
