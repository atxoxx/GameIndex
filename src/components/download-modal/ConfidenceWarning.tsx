import type { MatchedDownload } from "../../types/source";
import { useLanguage } from "../../context/LanguageContext";

/**
 * Confidence gate alert. Surfaces an explicit warning when the best available
 * result is not a high-confidence match (score < 0.8) so the user double-checks
 * before downloading the wrong game.
 */
export function ConfidenceWarning({
  matches,
  gameName,
}: {
  matches: MatchedDownload[];
  gameName: string;
}) {
  const { t } = useLanguage();
  if (matches.length === 0) return null;
  const best = matches.reduce((acc, m) => (m.matchScore > acc ? m.matchScore : acc), 0);
  if (best >= 0.8) return null;
  const label = best >= 0.4 ? t("downloadModal.partialMatch") : t("downloadModal.lowConfidenceMatch");

  return (
    <div className="dl-confirm-warning" role="alert">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="dl-confirm-warning-icon"
        aria-hidden
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <span className="dl-confirm-warning-text">
        {t("downloadModal.confidenceBefore")} <strong>{label}</strong>{" "}
        {t("downloadModal.confidenceAfter", { gameName, tier: label })}
      </span>
    </div>
  );
}

