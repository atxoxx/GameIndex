import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import StoreFilterSidebar from "./StoreFilterSidebar";
import type { StoreCatalogue } from "../../hooks/useStoreCatalogue";
import { useLanguage } from "../../context/LanguageContext";

interface StoreFilterPanelProps {
  catalogue: StoreCatalogue;
}

/**
 * The catalogue filter drawer. Filters used to live in a permanently
 * mounted rail; they now open from the sticky command bar (or the chip
 * row) and close back to the grid. The drawer is portaled so it can never
 * be trapped by the page's animation wrappers.
 */
export default function StoreFilterPanel({ catalogue: c }: StoreFilterPanelProps) {
  const { t } = useLanguage();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const open = c.filtersOpen;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") c.setFiltersOpen(false);
    };
    document.addEventListener("keydown", onKey);
    // Move focus into the drawer once it is visible.
    const focusTimer = window.setTimeout(() => closeRef.current?.focus(), 40);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(focusTimer);
    };
  }, [open, c.setFiltersOpen]);

  return createPortal(
    <>
      <div
        className={`store-filter-drawer-scrim${open ? " open" : ""}`}
        onClick={() => c.setFiltersOpen(false)}
        aria-hidden="true"
      />
      <aside
        className={`store-filter-drawer${open ? " open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={t("store.filtersTitle")}
        aria-hidden={!open}
      >
        <div className="store-filter-drawer-header">
          <h3>{t("store.filtersTitle")}</h3>
          <button
            ref={closeRef}
            type="button"
            className="store-filter-drawer-close"
            onClick={() => c.setFiltersOpen(false)}
            aria-label={t("store.closeFilters")}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="store-filter-drawer-body">
          <StoreFilterSidebar
            selectedGenres={c.selectedGenres}
            selectedPlatforms={c.selectedPlatforms}
            platformNames={c.platformNames}
            yearMin={c.yearMin}
            yearMax={c.yearMax}
            ratingMin={c.ratingMin}
            selectedSourceIds={c.selectedSourceIds}
            onGenresChange={c.setSelectedGenres}
            onPlatformsChange={c.setSelectedPlatforms}
            onYearRangeChange={c.setYearRange}
            onRatingMinChange={c.setRatingMin}
            onSourcesChange={c.setSelectedSourceIds}
            sourceCounts={c.sourceCounts}
            sourceMatchMode={c.sourceMatchMode}
            onSourceMatchModeChange={c.setSourceMatchMode}
            countSource={c.displayedGames}
            onReset={c.resetFilters}
          />
        </div>

        <div className="store-filter-drawer-footer">
          <button
            type="button"
            className="store-filter-drawer-clear"
            onClick={c.resetFilters}
          >
            {t("store.chips.clearAll")}
          </button>
          <button
            type="button"
            className="store-filter-drawer-apply"
            onClick={() => c.setFiltersOpen(false)}
          >
            {t("store.drawer.showResults", { count: c.displayedGames.length })}
          </button>
        </div>
      </aside>
    </>,
    document.body
  );
}
