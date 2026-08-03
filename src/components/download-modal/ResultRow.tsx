import type { DisplayMatch } from "./types";
import { useLanguage } from "../../context/LanguageContext";
import { formatUploadDate } from "./helpers";

export function ResultRow({
  match,
  selected,
  onSelect,
  isDownloaded,
}: {
  match: DisplayMatch;
  selected: boolean;
  onSelect: (id: string) => void;
  isDownloaded: (title: string) => boolean;
}) {
  const { t, language } = useLanguage();
  const score = match.matchScore;
  // Confidence tier, kept intentionally out of the row's cramped meta
  // line: the row shows a compact colored dot + tier label, while the
  // detail panel carries the full percentage and a richer breakdown.
  const tier = score >= 0.8 ? "high" : score >= 0.4 ? "partial" : "low";
  const tierLabel =
    score >= 0.8
      ? t("downloadModal.matchHigh")
      : score >= 0.4
        ? t("downloadModal.matchPartial")
        : t("downloadModal.matchPossible");

  return (
    <button
      type="button"
      className={`dl-result-row${selected ? " selected" : ""}`}
      onClick={() => onSelect(match.id)}
      aria-pressed={selected}
    >
      <div className="dl-result-info">
        <div className="dl-result-title">
          <span className="dl-result-title-text">{match.title}</span>
          <span className="dl-result-badges">
            {match.isNew && (
              <span className="dl-badge dl-badge-new" title={t("downloads.newlyAddedSource")}>
                NEW
              </span>
            )}
            {isDownloaded(match.title) && (
              <span className="dl-badge dl-badge-downloaded" title={t("downloads.alreadyDownloaded")}>
                Downloaded
              </span>
            )}
          </span>
        </div>
        <div className="dl-result-meta">
          <span className="dl-result-source">{match.sourceName}</span>
          <span>·</span>
          <span>{match.fileSize || t("downloadModal.unknownSize")}</span>
          {match.uploadDate && (
            <>
              <span>·</span>
              <span>{formatUploadDate(match.uploadDate, language)}</span>
            </>
          )}
          <span className={`dl-result-score ${tier}`} title={t("downloadModal.detailConfidence")}>
            <span className="dl-tier-dot" aria-hidden />
            {tierLabel}
          </span>
        </div>
      </div>
      <div className="dl-result-actions" aria-hidden>
        {selected ? (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ width: 18, height: 18 }}
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ width: 18, height: 18, opacity: 0.4 }}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        )}
      </div>
    </button>
  );
}
