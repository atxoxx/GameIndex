import type { StoreCatalogue } from "../../hooks/useStoreCatalogue";
import { useLanguage } from "../../context/LanguageContext";

interface StoreHeaderProps {
  catalogue: StoreCatalogue;
}

/**
 * Hydra-style sticky top bar for the Store catalogue: branding, live result
 * count, and the "Show hidden" toggle. The search, sort, select, filter,
 * and density controls live in `StoreToolbar` between the rail and the
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
            {/* No-flash refetch cue: during a live search the old results
                stay on screen until the new batch lands, so a quiet
                "refreshing" readout sits next to the count instead of a
                skeleton flash. */}
            {c.isSearching && c.loading && (
              <span className="store-refresh-cue" role="status" aria-live="polite">
                <span className="store-refresh-cue-dot" aria-hidden="true" />
                {t("store.refreshingResults")}
              </span>
            )}
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
        </div>
      </div>
    </header>
  );
}
