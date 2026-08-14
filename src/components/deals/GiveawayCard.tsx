import type { Giveaway } from "../../types/deals";
import { useLanguage } from "../../context/LanguageContext";
import { storeTint, formatExpiry } from "../../pages/deals/dealsConstants";

interface GiveawayCardProps {
  giveaway: Giveaway;
  onOpenUrl: (url: string | null | undefined) => void;
  index: number;
}

export default function GiveawayCard({
  giveaway,
  onOpenUrl,
  index,
}: GiveawayCardProps) {
  const { t } = useLanguage();
  const expiry = formatExpiry(giveaway.expiry);

  return (
    <article
      className="deals-giveaway-card deals-card-enter"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <div className="deals-giveaway-card-image-wrap">
        {giveaway.imageUrl ? (
          <img
            className="deals-giveaway-card-image"
            src={giveaway.imageUrl}
            alt={giveaway.title}
            loading="lazy"
          />
        ) : (
          <div
            className="deals-giveaway-card-image-fallback"
            style={{
              background: `color-mix(in srgb, ${storeTint(giveaway.storeName)} 14%, var(--color-bg-tertiary))`,
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
            </svg>
          </div>
        )}
        <span className="deals-giveaway-card-free-badge">
          {t("deals.freeBadge")}
        </span>
        {giveaway.isMature && (
          <span className="deals-giveaway-card-mature-badge">18+</span>
        )}
      </div>
      <div className="deals-giveaway-card-body">
        <h3 className="deals-giveaway-card-title">{giveaway.title}</h3>
        {giveaway.bundleTitle &&
          giveaway.bundleTitle !== giveaway.title && (
            <div className="deals-giveaway-card-bundle">
              {giveaway.bundleTitle}
            </div>
          )}
        <div className="deals-giveaway-card-meta">
          <span className="deals-giveaway-card-store">
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
          onClick={() => onOpenUrl(giveaway.dealUrl)}
        >
           {t("deals.getItFree")}
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
        </button>
      </div>
    </article>
  );
}
