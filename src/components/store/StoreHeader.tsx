import type { StoreCatalogue } from "../../hooks/useStoreCatalogue";
import { useLanguage } from "../../context/LanguageContext";

interface StoreHeaderProps {
  catalogue: StoreCatalogue;
}

/**
 * Sticky top bar for the Store catalogue: branding, live result
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
