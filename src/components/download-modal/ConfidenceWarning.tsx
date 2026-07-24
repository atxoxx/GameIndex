import type { MatchedDownload } from "../../types/source";
import { useLanguage } from "../../context/LanguageContext";

/**
 * Confidence gate. The Rust side already filters out anything below
 * a 0.2 similarity floor, so every result shown is at least a
 * plausible match — but a 0.2–0.8 result can still be a *similar
 * game name* (e.g. searching "Doom" and landing on "Doom Eternal"
 * when the user wanted the 2016 reboot). Surface an explicit
 * warning when the best available result isn't a high-confidence
 * match so the user double-checks before downloading the wrong
 * game.
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
  const label = best >= 0.4 ? t('downloadModal.partialMatch') : t('downloadModal.lowConfidenceMatch');

  return (
    <div className="dl-confirm-warning" role="alert">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        width="16"
        height="16"
        className="dl-confirm-warning-icon"
        aria-hidden
      >
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <span>
        {t('downloadModal.confidenceBefore')} <strong>{label}</strong>
        {t('downloadModal.confidenceAfter', { gameName })}{" "}
        <strong>{t('downloadModal.confidenceSettings')}</strong>.
      </span>
    </div>
  );
}
