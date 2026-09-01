import { useMemo, useState } from "react";
import type { DealItem } from "../../types/deals";
import { useLanguage } from "../../context/LanguageContext";
import { useWishlist } from "../../hooks/useWishlist";
import { useGames } from "../../context/GameContext";
import { useGameCardArt } from "../../hooks/useGameCardArt";
import {
  formatPrice,
  calculateSavings,
  discountTier,
  formatExpiry,
  storeTint,
  titleToSlug,
} from "../../pages/deals/dealsConstants";

interface DealCardProps {
  deal: DealItem;
  onOpenUrl: (url: string | null | undefined) => void;
  onInspect?: (deal: DealItem) => void;
  index: number;
  density?: string;
}

export default function DealCard({
  deal,
  onOpenUrl,
  onInspect,
  index,
  density = "cozy",
}: DealCardProps) {
  const { t } = useLanguage();
  const { isWishlisted, toggle } = useWishlist();
  const { games } = useGames();
  const [copied, setCopied] = useState(false);
  const [hovered, setHovered] = useState(false);

  const steamAppId = useMemo(() => {
    if (deal.storeUrl) {
      const m = deal.storeUrl.match(/store\.steampowered\.com\/app\/(\d+)/i);
      if (m && m[1]) return parseInt(m[1], 10);
    }
    return null;
  }, [deal.storeUrl]);

  const { displayUrl, staticPosterUrl, animatedPosterUrl, handleError } = useGameCardArt({
    appId: steamAppId,
    defaultCoverUrl: deal.thumbnail,
    isHovered: hovered,
  });

  const slug = useMemo(() => titleToSlug(deal.gameTitle), [deal.gameTitle]);
  const wishlisted = isWishlisted(slug);
  const ownedInLibrary = useMemo(() => {
    const titleNorm = deal.gameTitle.toLowerCase().trim();
    return games.some((g) => g.name.toLowerCase().trim() === titleNorm);
  }, [deal.gameTitle, games]);

  const tier = discountTier(deal.discountPercent);
  const expiry = formatExpiry(deal.expiration);
  const { originalPrice, savings } = calculateSavings(
    deal.dealPrice,
    deal.discountPercent,
  );

  const handleToggleWishlist = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggle({
      id: 0,
      name: deal.gameTitle,
      slug,
      summary: null,
      rating: null,
      aggregatedRating: null,
      coverUrl: deal.thumbnail ?? null,
      logoUrl: null,
      genres: [],
      platforms: [deal.platform],
      firstReleaseDate: null,
      totalRatingCount: 0,
      hypes: 0,
    });
  };

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (navigator?.clipboard) {
        await navigator.clipboard.writeText(deal.storeUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      /* clipboard fallback */
    }
  };

  return (
    <article
      className={`deals-deal-card deals-card-enter density-${density} ${
        ownedInLibrary ? "is-owned" : ""
      } ${wishlisted ? "is-wishlisted" : ""}`}
      style={{ animationDelay: `${Math.min(index * 30, 450)}ms` }}
      role="button"
      tabIndex={0}
      onClick={() => (onInspect ? onInspect(deal) : onOpenUrl(deal.storeUrl))}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (onInspect) onInspect(deal);
          else onOpenUrl(deal.storeUrl);
        }
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-label={t("deals.openDealLabel", {
        game: deal.gameTitle,
        store: deal.storeName,
      })}
    >
      <div className="deals-deal-card-image-wrap">
        {(staticPosterUrl || displayUrl) ? (
          <>
            <img
              className="deals-deal-card-image deals-deal-card-image-static"
              src={staticPosterUrl || displayUrl!}
              alt={deal.gameTitle}
              loading="lazy"
              decoding="async"
              onError={handleError}
            />
            {animatedPosterUrl && hovered && (
              <img
                className="deals-deal-card-image deals-deal-card-image-animated is-active"
                src={animatedPosterUrl}
                alt=""
                aria-hidden="true"
                decoding="async"
                onError={handleError}
              />
            )}
          </>
        ) : null}

        <div
          className="deals-deal-card-image-fallback"
          style={{
            display: deal.thumbnail ? "none" : "flex",
            background: `color-mix(in srgb, ${storeTint(
              deal.storeName,
            )} 18%, var(--color-bg-secondary))`,
            color: storeTint(deal.storeName),
          }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="12" y1="1" x2="12" y2="23" />
            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
          </svg>
        </div>

        {/* Discount corner badge */}
        <span className={`deals-deal-card-discount-corner ${tier}`}>
          -{deal.discountPercent}%
        </span>

        {/* Status badges: Owned or Wishlisted */}
        <div className="deals-card-top-badges">
          {ownedInLibrary && (
            <span className="deals-card-badge deals-card-badge--owned" title={t("deals.inLibrary")}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
          )}
          {wishlisted && (
            <span className="deals-card-badge deals-card-badge--wishlist" title={t("deals.onWishlist")}>
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
            </span>
          )}
        </div>

        {/* Quick action buttons on card hover */}
        <div className="deals-card-quick-actions">
          <button
            type="button"
            className={`deals-card-action-btn ${wishlisted ? "active" : ""}`}
            onClick={handleToggleWishlist}
            title={wishlisted ? t("deals.removeFromWishlist") : t("deals.addToWishlist")}
            aria-label={wishlisted ? t("deals.removeFromWishlist") : t("deals.addToWishlist")}
          >
            <svg
              viewBox="0 0 24 24"
              fill={wishlisted ? "currentColor" : "none"}
              stroke="currentColor"
              strokeWidth="2"
            >
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </button>

          <button
            type="button"
            className="deals-card-action-btn"
            onClick={handleCopy}
            title={copied ? t("gameInfo.copied") : t("deals.copyLink")}
            aria-label={t("deals.copyLink")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
        </div>
      </div>

      <div className="deals-deal-card-body">
        <h3 className="deals-deal-card-title" title={deal.gameTitle}>
          {deal.gameTitle}
        </h3>

        <div className="deals-deal-card-price-container">
          <span className="deals-deal-card-current">
            {formatPrice(deal.dealPrice)}
          </span>
          {savings > 0 && (
            <span className="deals-deal-card-original">
              {formatPrice(originalPrice)}
            </span>
          )}
        </div>

        <div className="deals-deal-card-meta">
          <span
            className="deals-deal-card-store"
            style={{
              borderColor: storeTint(deal.storeName),
            }}
          >
            {deal.storeName}
          </span>

          <span className="deals-deal-card-platform">
            {deal.platform}
          </span>

          {expiry && (
            <span className="deals-deal-card-expiry">
              {t("deals.ends", { date: expiry })}
            </span>
          )}
        </div>
      </div>

    </article>
  );
}
