import type { DealItem } from "../../types/deals";
import { useLanguage } from "../../context/LanguageContext";
import { formatPrice, discountTier, formatExpiry } from "../../pages/deals/dealsConstants";

interface DealCardProps {
  deal: DealItem;
  onOpenUrl: (url: string | null | undefined) => void;
  index: number;
}

export default function DealCard({ deal, onOpenUrl, index }: DealCardProps) {
  const { t } = useLanguage();
  const tier = discountTier(deal.discountPercent);
  const expiry = formatExpiry(deal.expiration);

  return (
    <article
      className="deals-deal-card deals-card-enter"
      style={{ animationDelay: `${index * 40}ms` }}
      role="button"
      tabIndex={0}
      onClick={() => onOpenUrl(deal.storeUrl)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenUrl(deal.storeUrl);
        }
      }}
      aria-label={t("deals.openDealLabel", {
        game: deal.gameTitle,
        store: deal.storeName,
      })}
    >
      {deal.thumbnail ? (
        <div className="deals-deal-card-image-wrap">
          <img
            className="deals-deal-card-image"
            src={deal.thumbnail}
            alt={deal.gameTitle}
            loading="lazy"
          />
        </div>
      ) : (
        <div className="deals-deal-card-image-wrap">
          <div className="deals-deal-card-image-fallback">
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
        </div>
      )}

      <span className={`deals-deal-card-discount-corner ${tier}`}>
        -{deal.discountPercent}%
      </span>

      <div className="deals-deal-card-body">
        <h3 className="deals-deal-card-title">{deal.gameTitle}</h3>
        <div className="deals-deal-card-price">
          <span className="deals-deal-card-current">
            {formatPrice(deal.dealPrice)}
          </span>
        </div>
        <div className="deals-deal-card-meta">
          <span className="deals-deal-card-meta-item">
            <span className="deals-deal-card-store">{deal.storeName}</span>
          </span>
          <span className="deals-deal-card-meta-item">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
            {deal.platform}
          </span>
          {expiry && (
            <span className="deals-deal-card-expiry deals-deal-card-meta-item">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              {t("deals.ends", { date: expiry })}
            </span>
          )}
        </div>
      </div>

      <div className="deals-deal-card-overlay">
        <span className="deals-deal-card-cta">
           {t("deals.openDeal")}
          <svg
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
        </span>
      </div>
    </article>
  );
}
