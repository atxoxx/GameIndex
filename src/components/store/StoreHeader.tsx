import type { StoreCatalogue } from "../../hooks/useStoreCatalogue";
import { useLanguage } from "../../context/LanguageContext";

interface StoreHeaderProps {
  catalogue: StoreCatalogue;
}

/**
 * Hydra-style sticky top bar for the Store catalogue: branding, live result
 * count, the "Show hidden" toggle, and the Filters trigger. The search, sort,
 * select, and density controls live in `StoreToolbar` between the rail and the
 * grid. Keeping it as its own component keeps `StorePage` a thin root.
 */
export default function StoreHeader({ catalogue: c }: StoreHeaderProps) {
  const { t } = useLanguage();
  return (
    <header className="store-header">
      <div className="store-header-top">
        <div className="store-header-brand">
          <span className="brand-eyebrow">{t("nav.store")}</span>
          <h2 className="brand-text">{c.resultsTitle}</h2>
          <span className="store-toolbar-count">
            {t("storage.gamesCount", {
              count:
                c.sourceFilterChipCount !== undefined
                  ? c.sourceFilterChipCount
                  : c.displayedGames.length,
              plural: c.displayedGames.length !== 1 ? "s" : "",
            })}
          </span>
        </div>

        <div className="store-header-actions">
          {c.hiddenCount > 0 && (
            <button
              type="button"
              className={`store-toolbar-toggle${c.showHidden ? " active" : ""}`}
              onClick={() => c.setShowHidden(!c.showHidden)}
              title={c.showHidden ? t("storeHeader.toggleDismissed") : t("storeHeader.toggleDismissedShow")}
            >
              {c.showHidden ? t("store.hideDismissed") : t("store.showHidden", { count: c.hiddenCount })}
            </button>
          )}

          <button
            type="button"
            className={`store-filter-trigger${c.activeFilterCount > 0 ? " has-active" : ""}`}
            onClick={() => c.setFiltersOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={c.filtersOpen}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="7" y1="12" x2="17" y2="12" />
              <line x1="10" y1="18" x2="14" y2="18" />
            </svg>
            {t("store.filters")}
            {c.activeFilterCount > 0 && (
              <span className="store-filter-trigger-badge">{c.activeFilterCount}</span>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
