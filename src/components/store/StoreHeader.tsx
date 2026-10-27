import { useState } from "react";
import { BarChart3, CheckSquare, Eye, EyeOff, Shuffle } from "lucide-react";
import type { StoreCatalogue } from "../../hooks/useStoreCatalogue";
import { useLanguage } from "../../context/LanguageContext";
import type { StoreGameSummary } from "../../types/game";
import StoreSurpriseModal from "./StoreSurpriseModal";

interface StoreHeaderProps {
  catalogue: StoreCatalogue;
  /** Navigate to a game picked from the surprise drawer. */
  onPickGame: (game: StoreGameSummary) => void;
}

/**
 * Store page header: the title block plus the page-level action cluster.
 * Density lives in the sticky command bar, so the header keeps only the
 * actions that are not part of the browsing flow: bulk selection, the
 * compare tray, surprise-me, and the dismissed-games toggle.
 */
export default function StoreHeader({ catalogue: c, onPickGame }: StoreHeaderProps) {
  const { t } = useLanguage();
  const [surpriseOpen, setSurpriseOpen] = useState(false);

  const compareCount = c.compareGames.length;
  const resultCount = c.sourceFilterChipCount ?? c.displayedGames.length;

  return (
    <header className="store-header">
      <div className="store-header-top">
        <div className="store-header-brand">
          <span className="brand-eyebrow">{t("nav.store")}</span>
          <h2 className="brand-text">{c.resultsTitle}</h2>
          <span className="store-header-count">
            {t("storage.gamesCount", {
              count: resultCount,
              plural: resultCount !== 1 ? "s" : "",
            })}
          </span>
        </div>

        <div className="store-header-actions" aria-label={t("store.header.actions")}>
          <button
            type="button"
            className={`store-header-action-btn${c.bulkMode ? " active" : ""}`}
            onClick={() => {
              c.setBulkMode(!c.bulkMode);
              c.clearSelection();
            }}
            aria-pressed={c.bulkMode}
            aria-label={t("storeToolbar.selectMultiple")}
            title={t("storeToolbar.selectMultiple")}
          >
            <CheckSquare size={14} aria-hidden="true" />
            <span>{t("store.header.bulk")}</span>
          </button>

          <button
            type="button"
            className={`store-header-action-btn${c.compareOpen ? " active" : ""}`}
            onClick={() => c.setCompareOpen(true)}
            disabled={compareCount === 0}
            aria-label={
              compareCount > 0
                ? t("store.header.compareCount", { count: compareCount })
                : t("store.header.compare")
            }
            title={t("store.header.compare")}
          >
            <BarChart3 size={14} aria-hidden="true" />
            <span>
              {compareCount > 0
                ? t("store.header.compareCount", { count: compareCount })
                : t("store.header.compare")}
            </span>
          </button>

          <button
            type="button"
            className="store-header-action-btn"
            onClick={() => setSurpriseOpen(true)}
            aria-label={t("store.surpriseTitle")}
            title={t("store.surpriseTitle")}
          >
            <Shuffle size={14} aria-hidden="true" />
            <span>{t("store.header.surprise")}</span>
          </button>

          {c.hiddenCount > 0 && (
            <button
              type="button"
              className={`store-header-action-btn${c.showHidden ? " active" : ""}`}
              onClick={() => c.setShowHidden(!c.showHidden)}
              aria-pressed={c.showHidden}
              aria-label={
                c.showHidden
                  ? t("storeHeader.toggleDismissed")
                  : t("storeHeader.toggleDismissedShow")
              }
              title={
                c.showHidden
                  ? t("storeHeader.toggleDismissed")
                  : t("storeHeader.toggleDismissedShow")
              }
            >
              {c.showHidden ? (
                <Eye size={14} aria-hidden="true" />
              ) : (
                <EyeOff size={14} aria-hidden="true" />
              )}
              <span>
                {c.showHidden
                  ? t("store.hideDismissed")
                  : t("store.showHidden", { count: c.hiddenCount })}
              </span>
            </button>
          )}
        </div>
      </div>

      {surpriseOpen && (
        <StoreSurpriseModal
          onClose={() => setSurpriseOpen(false)}
          onOpenGame={(game) => {
            setSurpriseOpen(false);
            onPickGame(game);
          }}
        />
      )}
    </header>
  );
}
