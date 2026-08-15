import { useState } from "react";
import { type ReviewItem } from "./types";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { BbCodeRenderer } from "./BbCodeRenderer";

interface CriticReviewRowProps {
  review: ReviewItem;
  searchQuery?: string;
}

function SourceMonogram({ source }: { source: ReviewItem["source"] }) {
  if (source === "metacritic") {
    return <span className="rv-mono" aria-hidden="true">MC</span>;
  }
  if (source === "opencritic") {
    return <span className="rv-mono" aria-hidden="true">OC</span>;
  }
  return <span className="rv-mono" aria-hidden="true">CR</span>;
}

function formatShortDate(ts?: number): string {
  if (!ts) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(ts));
  } catch {
    return new Date(ts).toLocaleDateString();
  }
}

export function CriticReviewRow({ review, searchQuery }: CriticReviewRowProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const isPos = review.sentiment === "positive" || (review.rating !== null && review.rating >= 60);

  const handleCopyReview = async () => {
    try {
      await navigator.clipboard.writeText(review.content);
      showToast(t("reviewsTab.reviewCopiedToast"), "info");
    } catch {
      // ignore
    }
  };

  const isLong = review.content.length > 400;

  return (
    <article className={`rv-row rv-critic-row rv-source-${review.source}`}>
      <header className="rv-critic-header">
        <span className="rv-critic-mono" aria-hidden="true">
          <SourceMonogram source={review.source} />
        </span>
        <div className="rv-critic-meta">
          <span className="rv-critic-source">{review.sourceLabel}</span>
          <span className="rv-critic-author">{review.username || review.sourceLabel}</span>
        </div>

        {review.rating !== null && review.rating !== undefined && (
          <span
            className={`rv-critic-score${isPos ? " rv-critic-score-pos" : " rv-critic-score-neg"}`}
            title={isPos ? t("review.recommended") : t("review.notRecommended")}
          >
            <span className="rv-critic-score-value">{Math.round(review.rating)}</span>
            <span className="rv-critic-score-denom">/100</span>
          </span>
        )}

        <button
          type="button"
          className="rv-copy-review-btn"
          onClick={handleCopyReview}
          title={t("reviewsTab.copyReviewText")}
          aria-label={t("reviewsTab.copyReviewText")}
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        </button>
      </header>

      {review.title && <h3 className="rv-critic-title">“{review.title}”</h3>}

      {review.content && (
        <div className="rv-critic-body">
          <div className={`rv-critic-content${!expanded && isLong ? " clamp" : ""}`}>
            <BbCodeRenderer text={review.content} highlightQuery={searchQuery} />
          </div>
          {isLong && (
            <button
              type="button"
              className="rv-expand-btn"
              onClick={() => setExpanded((p) => !p)}
              aria-expanded={expanded}
            >
              {t(expanded ? "review.showLess" : "review.showMore")}
              <svg
                className={`rv-expand-chevron${expanded ? " open" : ""}`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          )}
        </div>
      )}

      <footer className="rv-critic-footer">
        {review.dateAdded ? (
          <span className="rv-critic-date">{formatShortDate(review.dateAdded)}</span>
        ) : (
          <span />
        )}
        <span className={`rv-critic-verdict${isPos ? " rv-critic-verdict-pos" : " rv-critic-verdict-neg"}`}>
          {isPos ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M7 10v12" />
              <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M17 14V2" />
              <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z" />
            </svg>
          )}
          {isPos ? t("review.recommended") : t("review.notRecommended")}
        </span>
      </footer>
    </article>
  );
}
