import { useMemo, useState } from "react";
import type { Giveaway } from "../../types/deals";
import { useLanguage } from "../../context/LanguageContext";
import { useWishlist } from "../../hooks/useWishlist";
import { useGames } from "../../context/GameContext";
import {
  storeTint,
  formatExpiry,
  formatCountdown,
  titleToSlug,
} from "../../pages/deals/dealsConstants";

interface GiveawayCardProps {
  giveaway: Giveaway;
  onOpenUrl: (url: string | null | undefined) => void;
  onInspect?: (giveaway: Giveaway) => void;
  index: number;
  density?: string;
}

export default function GiveawayCard({
  giveaway,
  onOpenUrl,
  onInspect,
  index,
  density = "cozy",
}: GiveawayCardProps) {
  const { t } = useLanguage();
  const { isWishlisted, toggle } = useWishlist();
  const { games } = useGames();
  const [copied, setCopied] = useState(false);

  const slug = useMemo(() => titleToSlug(giveaway.title), [giveaway.title]);
  const wishlisted = isWishlisted(slug);
  const ownedInLibrary = useMemo(() => {
    const titleNorm = giveaway.title.toLowerCase().trim();
    return games.some((g) => g.name.toLowerCase().trim() === titleNorm);
  }, [giveaway.title, games]);

  const countdown = formatCountdown(giveaway.expiry);
  const expiry = formatExpiry(giveaway.expiry);

  const handleToggleWishlist = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggle({
      id: 0,
      name: giveaway.title,
      slug,
      summary: giveaway.bundleTitle ?? null,
      rating: null,
      aggregatedRating: null,
      coverUrl: giveaway.imageUrl ?? null,
      logoUrl: null,
      genres: [],
      platforms: [],
      firstReleaseDate: null,
      totalRatingCount: 0,
      hypes: 0,
    });
  };

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (navigator?.clipboard) {
        await navigator.clipboard.writeText(giveaway.dealUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      /* clipboard fallback */
    }
  };

  return (
    <article
      className={`deals-giveaway-card deals-card-enter density-${density} ${
        ownedInLibrary ? "is-owned" : ""
      } ${wishlisted ? "is-wishlisted" : ""}`}
      style={{ animationDelay: `${Math.min(index * 30, 450)}ms` }}
      role="button"
      tabIndex={0}
      onClick={() => (onInspect ? onInspect(giveaway) : onOpenUrl(giveaway.dealUrl))}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (onInspect) onInspect(giveaway);
          else onOpenUrl(giveaway.dealUrl);
        }
      }}
    >
      <div className="deals-giveaway-card-image-wrap">
        {giveaway.imageUrl ? (
          <img
            className="deals-giveaway-card-image"
            src={giveaway.imageUrl}
            alt={giveaway.title}
            loading="lazy"
            onError={(e) => {
              const target = e.currentTarget;
              target.style.display = "none";
              const fb = target.parentElement?.querySelector(
                ".deals-giveaway-card-image-fallback",
              ) as HTMLElement | null;
              if (fb) fb.style.display = "flex";
            }}
          />
        ) : null}

        <div
          className="deals-giveaway-card-image-fallback"
          style={{
            display: giveaway.imageUrl ? "none" : "flex",
            background: `color-mix(in srgb, ${storeTint(
              giveaway.storeName,
            )} 14%, var(--color-bg-tertiary))`,
            color: storeTint(giveaway.storeName),
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
            <polyline points="20 12 20 22 4 22 4 12" />
            <rect x="2" y="7" width="20" height="5" />
            <line x1="12" y1="22" x2="12" y2="7" />
            <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
            <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
          </svg>
        </div>

        <span className="deals-giveaway-card-free-badge">
          {t("deals.freeBadge")}
        </span>

        {giveaway.isMature && (
          <span className="deals-giveaway-card-mature-badge">18+</span>
        )}

        {/* Countdown Badge */}
        {countdown && (
          <span
            className={`deals-giveaway-card-timer-badge ${
              countdown.isUrgent ? "urgent" : ""
            }`}
          >
            ⏱ {countdown.label}
          </span>
        )}

        {/* Status badges */}
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

        {/* Quick action buttons */}
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

      <div className="deals-giveaway-card-body">
        <h3 className="deals-giveaway-card-title" title={giveaway.title}>
          {giveaway.title}
        </h3>

        {giveaway.bundleTitle && giveaway.bundleTitle !== giveaway.title && (
          <div className="deals-giveaway-card-bundle">
            {giveaway.bundleTitle}
          </div>
        )}

        <div className="deals-giveaway-card-meta">
          <span
            className="deals-giveaway-card-store"
            style={{ borderColor: storeTint(giveaway.storeName) }}
          >
            {giveaway.storeName}
          </span>
          {expiry && (
            <span className="deals-giveaway-card-expiry">
              {t("deals.ends", { date: expiry })}
            </span>
          )}
        </div>

        <button
          type="button"
          className="deals-giveaway-card-cta"
          onClick={(e) => {
            e.stopPropagation();
            onOpenUrl(giveaway.dealUrl);
          }}
        >
          {t("deals.getItFree")}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </button>
      </div>
    </article>
  );
}
