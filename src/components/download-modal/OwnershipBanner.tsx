import { useState } from "react";
import type { OwnershipResult } from "../../types/download";
import type { DownloadStep } from "./types";
import { useLanguage } from "../../context/LanguageContext";

/**
 * Modern store ownership banner.
 * Alerts user if they own the game on Steam, Epic, GOG, etc.
 */
export function OwnershipBanner({
  ownership,
  step,
}: {
  ownership: OwnershipResult | null;
  step: DownloadStep;
}) {
  const { t } = useLanguage();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  if (step === "checking" || !ownership) {
    return (
      <div className="dl-ownership-card dl-ownership-card--checking">
        <div className="dl-ownership-icon-box dl-ownership-icon-box--checking">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </div>
        <div className="dl-ownership-content">
          <span className="dl-ownership-header">{t("downloadModal.checkingOwnership")}</span>
          <span className="dl-ownership-subtitle">{t("downloadModal.checkingOwnershipDesc")}</span>
        </div>
      </div>
    );
  }

  if (!ownership.isOwnedAnywhere) return null;

  const ownedStores = ownership.ownedStores.filter((s) => s.owned);
  const primary = ownedStores[0];
  const others = ownedStores.slice(1);
  const othersText =
    others.length > 0
      ? ` · ${t("downloadModal.alsoOwnedOn", { stores: others.map((o) => o.store).join(", ") })}`
      : "";
  const detailsText = primary?.details ? ` (${primary.details})` : "";

  return (
    <div className="dl-ownership-card dl-ownership-card--owned">
      <div className="dl-ownership-icon-box dl-ownership-icon-box--owned">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </div>
      <div className="dl-ownership-content">
        <div className="dl-ownership-text-row">
          <span className="dl-ownership-header">
            {t("downloadModal.youOwnThis", { store: primary?.store || "Store" })}
            {detailsText}
          </span>
          <span className="dl-ownership-sep" aria-hidden>—</span>
          <span className="dl-ownership-subtitle">
            {t("downloadModal.ownedText")}
            {othersText}
          </span>
        </div>
        <div className="dl-ownership-store-pills">
          {ownedStores.map((s) => (
            <span key={s.store} className="dl-store-badge">
              {s.store}
            </span>
          ))}
        </div>
      </div>
      <button
        type="button"
        className="dl-ownership-close-btn"
        onClick={() => setDismissed(true)}
        aria-label={t("common.close")}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
