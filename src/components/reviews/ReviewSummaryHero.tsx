import { useId } from "react";
import { type ReviewItem } from "./types";
import { useLanguage } from "../../context/LanguageContext";

interface ReviewSummaryHeroProps {
  reviews: ReviewItem[];
  totalReviewCount: number;
  steamReviewScoreDesc: string | null;
  steamReviewScore?: number | null;
  steamTotalPositive: number | null;
  steamTotalNegative: number | null;
  onFilterSentiment?: (sentiment: "all" | "positive" | "negative") => void;
  activeSentimentFilter?: "all" | "positive" | "negative";
}

export function StarRow({
  score,
  size = 14,
  overrideStars,
}: {
  score?: number;
  size?: number;
  overrideStars?: number;
}) {
  const reactId = useId();
  const stars =
    overrideStars !== undefined
      ? overrideStars
      : score !== undefined
      ? Math.max(0, Math.min(5, Math.round((score / 100) * 5 * 2) / 2))
      : 0;
  const full = Math.floor(stars);
  const half = stars - full >= 0.5;
  const empty = Math.max(0, 5 - full - (half ? 1 : 0));

  return (
    <div className="rv-stars" aria-label={`${stars} out of 5`}>
      {Array.from({ length: full }).map((_, i) => (
        <svg key={`${reactId}-f${i}`} width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      ))}
      {half && (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <defs>
            <linearGradient id={`half-${reactId}`}>
              <stop offset="50%" stopColor="currentColor" />
              <stop offset="50%" stopColor="var(--color-text-muted)" />
            </linearGradient>
          </defs>
          <polygon fill={`url(#half-${reactId})`} points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      )}
      {Array.from({ length: empty }).map((_, i) => (
        <svg key={`${reactId}-e${i}`} width={size} height={size} viewBox="0 0 24 24" fill="var(--color-text-muted)">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      ))}
    </div>
  );
}

export function ReviewSummaryHero({
  reviews,
  totalReviewCount,
  steamReviewScoreDesc,
  steamReviewScore,
  steamTotalPositive,
  steamTotalNegative,
  onFilterSentiment,
  activeSentimentFilter = "all",
}: ReviewSummaryHeroProps) {
  const { t } = useLanguage();

  const ratings = reviews.filter((r) => r.rating !== null);
  const steamReviews = reviews.filter((r) => r.source === "steam");
  const hasRealSteamStats = steamTotalPositive !== null && steamTotalNegative !== null;

  const positiveCount = hasRealSteamStats
    ? steamTotalPositive
    : reviews.filter((r) => r.sentiment === "positive").length;
  const negativeCount = hasRealSteamStats
    ? steamTotalNegative
    : reviews.filter((r) => r.sentiment === "negative").length;
  const totalSentiment = positiveCount + negativeCount;

  const hasLocalSteamFallback = !hasRealSteamStats && totalSentiment > 0 && steamReviews.length > 0;
  const isPercentageContext = hasRealSteamStats || hasLocalSteamFallback;

  const positivePct = totalSentiment > 0 ? Math.round((positiveCount / totalSentiment) * 100) : 0;
  const negativePct = totalSentiment > 0 ? 100 - positivePct : 0;

  const communityAvg = isPercentageContext
    ? positivePct
    : ratings.length > 0
    ? ratings.reduce((acc, r) => acc + (r.rating as number), 0) / ratings.length
    : 0;

  let stars = 0;
  if (communityAvg > 0) {
    if (isPercentageContext) {
      if (steamReviewScore != null) {
        stars =
          steamReviewScore >= 9 ? 5 :
          steamReviewScore >= 8 ? 4.5 :
          steamReviewScore >= 7 ? 4 :
          steamReviewScore >= 6 ? 3.5 :
          steamReviewScore >= 5 ? 3 :
          steamReviewScore >= 4 ? 2 :
          steamReviewScore >= 3 ? 1.5 :
          steamReviewScore >= 2 ? 1 : 0.5;
      } else if (positivePct >= 95) stars = 5;
      else if (positivePct >= 85) stars = 4.5;
      else if (positivePct >= 80) stars = 4;
      else if (positivePct >= 70) stars = 3.5;
      else if (positivePct >= 40) stars = 3;
      else if (positivePct >= 20) stars = 2;
      else stars = 1;
    } else {
      stars = Math.max(0, Math.min(5, Math.round((communityAvg / 100) * 5 * 2) / 2));
    }
  }

  const scoreColor = isPercentageContext
    ? steamReviewScore != null
      ? steamReviewScore >= 6
        ? "var(--color-success)"
        : steamReviewScore >= 5
        ? "var(--color-warning)"
        : "var(--color-danger)"
      : positivePct >= 70
      ? "var(--color-success)"
      : positivePct >= 40
      ? "var(--color-warning)"
      : "var(--color-danger)"
    : communityAvg >= 75
    ? "var(--color-success)"
    : communityAvg >= 50
    ? "var(--color-warning)"
    : "var(--color-danger)";

  const totalReviews = totalReviewCount > 0 ? totalReviewCount : reviews.length;
  const hasRatings = totalSentiment > 0;

  // Metadata KPI ratios derived from currently loaded sample
  const deckReviewsCount = reviews.filter((r) => r.primarilySteamDeck).length;
  const earlyAccessCount = reviews.filter((r) => r.writtenDuringEarlyAccess).length;
  const verifiedPurchaseCount = reviews.filter((r) => r.steamPurchase).length;
  const playtimeSample = reviews
    .map((r) => r.authorPlaytimeAtReview)
    .filter((v): v is number => typeof v === "number" && v > 0);
  const avgPlaytimeHours =
    playtimeSample.length > 0
      ? Math.round((playtimeSample.reduce((a, b) => a + b, 0) / playtimeSample.length / 60) * 10) / 10
      : null;

  return (
    <div className="rv-summary">
      <div className="rv-summary-left">
        <div className="rv-summary-score-wrap">
          <div className="rv-summary-score" style={{ color: scoreColor }}>
            {communityAvg > 0 ? (isPercentageContext ? `${positivePct}%` : Math.round(communityAvg)) : "—"}
          </div>
          <div className="rv-summary-score-label">
            {isPercentageContext ? t("review.positive") : t("review.per100avg")}
          </div>
        </div>

        <div className="rv-summary-stats">
          <div className="rv-summary-source-stars">
            {communityAvg > 0 && <StarRow score={0} overrideStars={stars} size={18} />}
          </div>
          {steamReviewScoreDesc && (
            <div className="rv-summary-desc" style={{ color: scoreColor }}>
              {steamReviewScoreDesc}
            </div>
          )}
          <div className="rv-summary-count">
            {t("review.reviewCount", { count: totalReviews.toLocaleString() })}
          </div>
          {hasRatings && (
            <div className="rv-summary-sentiment">
              <span className="rv-summary-pos">{positivePct}% {t("review.positive")}</span>
              <span className="rv-summary-neg">{negativePct}% {t("review.negative")}</span>
            </div>
          )}
        </div>
      </div>

      <div className="rv-summary-right">
        {hasRatings && (
          <div className="rv-summary-distribution">
            <button
              type="button"
              className={`rv-distribution-row rv-distribution-btn${activeSentimentFilter === "positive" ? " active" : ""}`}
              onClick={() => onFilterSentiment?.(activeSentimentFilter === "positive" ? "all" : "positive")}
              title={t("review.filter.positive")}
            >
              <span className="rv-distribution-label rv-distribution-label-pos">
                {t("review.positive")}
              </span>
              <div className="rv-distribution-bar-track">
                <div
                  className="rv-distribution-bar-fill rv-distribution-bar-fill-pos"
                  style={{ width: `${positivePct}%` }}
                />
              </div>
              <span className="rv-distribution-count" style={{ minWidth: "45px" }}>
                {positiveCount.toLocaleString()} ({positivePct}%)
              </span>
            </button>

            <button
              type="button"
              className={`rv-distribution-row rv-distribution-btn${activeSentimentFilter === "negative" ? " active" : ""}`}
              onClick={() => onFilterSentiment?.(activeSentimentFilter === "negative" ? "all" : "negative")}
              title={t("review.filter.negative")}
            >
              <span className="rv-distribution-label rv-distribution-label-neg">
                {t("review.negative")}
              </span>
              <div className="rv-distribution-bar-track">
                <div
                  className="rv-distribution-bar-fill rv-distribution-bar-fill-neg"
                  style={{ width: `${negativePct}%` }}
                />
              </div>
              <span className="rv-distribution-count" style={{ minWidth: "45px" }}>
                {negativeCount.toLocaleString()} ({negativePct}%)
              </span>
            </button>
          </div>
        )}

        {/* KPI Mini Badges */}
        <div className="rv-summary-kpis">
          {avgPlaytimeHours !== null && avgPlaytimeHours > 0 && (
            <span className="rv-kpi-pill" title="Average reviewer playtime on record at review time">
              <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              {t("reviewsTab.playtimeAvg", { hours: avgPlaytimeHours })}
            </span>
          )}
          {deckReviewsCount > 0 && (
            <span className="rv-kpi-pill" title="Reviewers who primarily played on Steam Deck">
              🎮 {t("reviewsTab.deckVerifiedRatio", { pct: Math.round((deckReviewsCount / reviews.length) * 100) })}
            </span>
          )}
          {earlyAccessCount > 0 && (
            <span className="rv-kpi-pill warning" title="Reviews written during Early Access">
              ⚡ {t("reviewsTab.earlyAccessRatio", { pct: Math.round((earlyAccessCount / reviews.length) * 100) })}
            </span>
          )}
          {verifiedPurchaseCount > 0 && (
            <span className="rv-kpi-pill success" title="Reviews from verified Steam purchases">
              ✓ {t("reviewsTab.verifiedPurchaseRatio", { pct: Math.round((verifiedPurchaseCount / reviews.length) * 100) })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
