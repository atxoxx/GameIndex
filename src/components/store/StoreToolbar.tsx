import StoreSortDropdown from "./StoreSortDropdown";
import StoreSearchBar from "./StoreSearchBar";
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
          onPickSuggestion={c.onCardClick}
        />
      </div>

      <div className="store-toolbar-right">
        <StoreSortDropdown value={c.sort} onChange={c.setSort} />

        <button
          type="button"
          className={`store-toolbar-toggle${c.bulkMode ? " active" : ""}`}
          onClick={() => {
            c.setBulkMode(!c.bulkMode);
            c.clearSelection();
          }}
          title="Select multiple games"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="9 11 12 14 22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
          {t("store.selectLabel")}
        </button>

        <div className="store-density-toolbar" aria-label="Layout controls">
          <DensityToggle density={c.density} onChange={c.setDensity} />
        </div>
      </div>
    </div>
  );
}
