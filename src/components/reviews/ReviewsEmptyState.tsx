import { type SourceFilter } from "./types";
import { useLanguage } from "../../context/LanguageContext";

interface ReviewsEmptyStateProps {
  type: "empty-all" | "no-matches" | "critic-loading" | "critic-empty";
  criticSource?: SourceFilter;
  criticLabel?: string;
  onResetFilters?: () => void;
  onOpenExternalCritic?: () => void;
}

export function ReviewsEmptyState({
  type,
  criticSource,
  criticLabel = "Critic",
  onResetFilters,
  onOpenExternalCritic,
}: ReviewsEmptyStateProps) {
  const { t } = useLanguage();

  if (type === "critic-loading") {
    return (
      <div className="rv-empty">
        <div className="rv-empty-icon">
          <span className="rv-spinner" aria-hidden="true" style={{ width: 28, height: 28, borderWidth: 3 }} />
        </div>
        <h3 className="rv-empty-title">{t("review.loadingTitle")}</h3>
        <p className="rv-empty-subtitle">{t("review.loadingFrom", { source: criticLabel })}</p>
      </div>
    );
  }

  if (type === "critic-empty") {
    const monogram =
      criticSource === "metacritic"
        ? "MC"
        : criticSource === "opencritic"
        ? "OC"
        : "CR";

    return (
      <div className="rv-empty">
        <div className="rv-empty-icon">
          <span className="rv-mono" style={{ fontSize: 16, fontWeight: 900 }}>{monogram}</span>
        </div>
        <h3 className="rv-empty-title">{t("reviewsTab.noCriticReviews")}</h3>
        <p className="rv-empty-subtitle">
          {t("reviewsTab.noCriticReviewsHint", { source: criticLabel })}
        </p>
        {onOpenExternalCritic && (
          <button type="button" className="rv-btn rv-btn-ghost" onClick={onOpenExternalCritic}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            {t("reviewsTab.openOnSource", { source: criticLabel })}
          </button>
        )}
      </div>
    );
  }

  if (type === "no-matches") {
    return (
      <div className="rv-empty rv-empty-small">
        <div className="rv-empty-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
            <line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </div>
        <h3 className="rv-empty-title">{t("review.noMatchTitle")}</h3>
        <p className="rv-empty-subtitle">{t("review.noMatchDesc")}</p>
        {onResetFilters && (
          <button type="button" className="rv-btn rv-btn-ghost" onClick={onResetFilters}>
            {t("review.resetFilters")}
          </button>
        )}
      </div>
    );
  }

  // Default: empty-all
  return (
    <div className="rv-empty">
      <div className="rv-empty-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          <path d="M9 10h.01" />
          <path d="M13 10h.01" />
          <path d="M17 10h.01" />
        </svg>
      </div>
      <h3 className="rv-empty-title">{t("review.emptyTitle")}</h3>
      <p className="rv-empty-subtitle">{t("review.emptyDesc")}</p>
    </div>
  );
}
