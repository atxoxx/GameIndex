import { useState, useMemo } from "react";
import type { DealItem, GamePassGame, Giveaway } from "../../types/deals";
import {
  formatPrice,
  calculateSavings,
  discountTier,
  formatCountdown,
  storeTint,
} from "../../pages/deals/dealsConstants";
import { useLanguage } from "../../context/LanguageContext";
import { Button } from "../ui";
import type { ModalDealTarget } from "./DealDetailModal";

interface DealsHeroSpotlightProps {
  deals: DealItem[];
  giveaways: Giveaway[];
  gpGames: GamePassGame[];
  onOpenUrl: (url: string | null | undefined) => void;
  onInspect: (target: ModalDealTarget) => void;
}

export default function DealsHeroSpotlight({
  deals,
  giveaways,
  gpGames,
  onOpenUrl,
  onInspect,
}: DealsHeroSpotlightProps) {
  const { t } = useLanguage();
  const [activeSlide, setActiveSlide] = useState(0);

  // Pick the top items for the spotlight:
  // 1. Top discount deal (>= 75% or highest available)
  const topDeal = useMemo(() => {
    if (deals.length === 0) return null;
    return [...deals].sort((a, b) => b.discountPercent - a.discountPercent)[0];
  }, [deals]);

  // 2. Active giveaway (prioritizing non-expired, expiring soonest)
  const topGiveaway = useMemo(() => {
    if (giveaways.length === 0) return null;
    return giveaways[0];
  }, [giveaways]);

  // 3. Featured GamePass game (e.g. first with cover image)
  const topGamepass = useMemo(() => {
    if (gpGames.length === 0) return null;
    return gpGames.find((g) => g.coverImage) ?? gpGames[0];
  }, [gpGames]);

  // Build slides array
  const slides = useMemo(() => {
    const list: {
      id: string;
      kind: "deal" | "giveaway" | "gamepass";
      badge: string;
      title: string;
      subtitle: string;
      image: string | null;
      store: string;
      priceEl: React.ReactNode;
      actionLabel: string;
      directUrl: string | null;
      target: ModalDealTarget;
    }[] = [];

    if (topGiveaway) {
      const countdown = formatCountdown(topGiveaway.expiry);
      list.push({
        id: `gw-${topGiveaway.id}`,
        kind: "giveaway",
        badge: t("deals.spotlightFreeBadge"),
        title: topGiveaway.title,
        subtitle: topGiveaway.bundleTitle || topGiveaway.storeName,
        image: topGiveaway.imageUrl ?? null,
        store: topGiveaway.storeName,
        priceEl: (
          <div className="deals-spotlight-price">
            <span className="deals-spotlight-free-tag">{t("deals.freeBadge")}</span>
            {countdown && (
              <span className={`deals-spotlight-timer-chip ${countdown.isUrgent ? "urgent" : ""}`}>
                ⏱ {countdown.label}
              </span>
            )}
          </div>
        ),
        actionLabel: t("deals.claimFree"),
        directUrl: topGiveaway.dealUrl,
        target: { type: "giveaway", data: topGiveaway },
      });
    }

    if (topDeal) {
      const tier = discountTier(topDeal.discountPercent);
      const { originalPrice, savings } = calculateSavings(
        topDeal.dealPrice,
        topDeal.discountPercent,
      );
      list.push({
        id: `deal-${topDeal.id}`,
        kind: "deal",
        badge: t("deals.spotlightDealBadge"),
        title: topDeal.gameTitle,
        subtitle: topDeal.storeName,
        image: topDeal.thumbnail ?? null,
        store: topDeal.storeName,
        priceEl: (
          <div className="deals-spotlight-price">
            <span className={`deals-spotlight-cut ${tier}`}>
              -{topDeal.discountPercent}%
            </span>
            <span className="deals-spotlight-current">
              {formatPrice(topDeal.dealPrice)}
            </span>
            {savings > 0 && (
              <span className="deals-spotlight-old">
                {formatPrice(originalPrice)}
              </span>
            )}
          </div>
        ),
        actionLabel: t("deals.openDeal"),
        directUrl: topDeal.storeUrl,
        target: { type: "deal", data: topDeal },
      });
    }

    if (topGamepass) {
      list.push({
        id: `gp-${topGamepass.id}`,
        kind: "gamepass",
        badge: t("deals.spotlightGamePassBadge"),
        title: topGamepass.title,
        subtitle: topGamepass.categories.slice(0, 3).join(" • ") || topGamepass.developer || "Xbox Game Pass",
        image: topGamepass.coverImage ?? null,
        store: "Xbox Game Pass",
        priceEl: (
          <div className="deals-spotlight-price">
            <span className="deals-spotlight-gamepass-tag">
              🎮 {t("deals.gamepass")}
            </span>
          </div>
        ),
        actionLabel: t("deals.viewOnXbox"),
        directUrl: topGamepass.deeplink ?? null,
        target: { type: "gamepass", data: topGamepass },
      });
    }

    return list;
  }, [topDeal, topGiveaway, topGamepass, t]);

  if (slides.length === 0) return null;

  const current = slides[activeSlide] ?? slides[0];

  return (
    <div className="deals-hero-spotlight">
      {/* Background artwork blur */}
      {current.image && (
        <div
          className="deals-spotlight-bg"
          style={{ backgroundImage: `url("${current.image}")` }}
        />
      )}
      <div className="deals-spotlight-overlay" />

      {/* Main spotlight content */}
      <div className="deals-spotlight-inner">
        <div className="deals-spotlight-content">
          <div className="deals-spotlight-badge-row">
            <span className={`deals-spotlight-badge deals-spotlight-badge--${current.kind}`}>
              {current.badge}
            </span>
            <span
              className="deals-spotlight-store"
              style={{
                background: `color-mix(in srgb, ${storeTint(current.store)} 25%, var(--color-bg-secondary))`,
                borderColor: storeTint(current.store),
              }}
            >
              {current.store}
            </span>
          </div>

          <h2 className="deals-spotlight-title">{current.title}</h2>
          {current.subtitle && (
            <p className="deals-spotlight-subtitle">{current.subtitle}</p>
          )}

          {current.priceEl}

          <div className="deals-spotlight-actions">
            {current.directUrl && (
              <Button
                variant="primary"
                size="md"
                onClick={() => onOpenUrl(current.directUrl)}
                leftIcon={
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                }
              >
                {current.actionLabel}
              </Button>
            )}

            <Button
              variant="secondary"
              size="md"
              onClick={() => onInspect(current.target)}
              leftIcon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
              }
            >
              {t("deals.inspectDeal")}
            </Button>
          </div>
        </div>

        {/* Thumbnail Preview */}
        {current.image && (
          <div className="deals-spotlight-visual">
            <img src={current.image} alt={current.title} className="deals-spotlight-poster" />
          </div>
        )}
      </div>

      {/* Slide pagination dots / pills */}
      {slides.length > 1 && (
        <div className="deals-spotlight-dots">
          {slides.map((s, idx) => (
            <button
              key={s.id}
              type="button"
              className={`deals-spotlight-dot ${idx === activeSlide ? "active" : ""}`}
              onClick={() => setActiveSlide(idx)}
              aria-label={`Slide ${idx + 1}: ${s.title}`}
            >
              <span className="deals-spotlight-dot-pill" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
