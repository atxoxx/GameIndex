import { useState } from "react";
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
  const isPlugin = match.provider === "plugin";
  const [copiedChip, setCopiedChip] = useState<string | null>(null);

  const score = match.matchScore;
  const tier = score >= 0.8 ? "high" : score >= 0.4 ? "partial" : "low";
  const tierLabel =
    score >= 0.8
      ? t("downloadModal.matchHigh")
      : score >= 0.4
        ? t("downloadModal.matchPartial")
        : t("downloadModal.matchPossible");

  const copyText = async (text: string, label: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedChip(label);
      window.setTimeout(() => {
        setCopiedChip((curr) => (curr === label ? null : curr));
      }, 1400);
    } catch {
      // Ignore clipboard fallback
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      className={`dl-result-row${selected ? " selected" : ""}`}
      onClick={() => onSelect(match.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(match.id);
        }
      }}
      aria-pressed={selected}
    >
      <div className="dl-result-selection-bar" aria-hidden />

      <div className="dl-result-info">
        {/* Source Badge & Title */}
        <div className="dl-result-header-line">
          <span className={`dl-source-tag${isPlugin ? " dl-source-tag--plugin" : ""}`}>
            {match.sourceName}
          </span>
          {match.platform && (
            <span className="dl-badge dl-badge-platform">{match.platform}</span>
          )}
          {match.isNew && (
            <span className="dl-badge dl-badge-new">{t("downloads.newlyAddedSource")}</span>
          )}
          {isDownloaded(match.title) && (
            <span className="dl-badge dl-badge-downloaded">{t("downloads.alreadyDownloaded")}</span>
          )}
          {match.verified && (
            <span className="dl-badge dl-badge-verified" title={t("downloadModal.verified")}>
              ✓ {t("downloadModal.verified")}
            </span>
          )}
        </div>

        <h4 className="dl-result-title" title={match.title}>
          {match.title}
        </h4>

        {/* Clean Metadata Pills */}
        <div className="dl-result-meta-pills">
          <span className="dl-meta-pill dl-meta-pill--size">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {match.fileSize || t("downloadModal.unknownSize")}
          </span>

          {match.uploadDate && (
            <span className="dl-meta-pill dl-meta-pill--date">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              {formatUploadDate(match.uploadDate, language)}
            </span>
          )}

          <span className={`dl-meta-pill dl-meta-pill--score ${tier}`} title={t("downloadModal.detailConfidence")}>
            <span className="dl-tier-dot" aria-hidden />
            {tierLabel} · {(score * 100).toFixed(0)}%
          </span>

          {match.seeds != null && match.peers != null && (
            <span className="dl-meta-pill dl-meta-pill--swarm">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              {t("downloadModal.seeds", { count: match.seeds })} · {t("downloadModal.peers", { count: match.peers })}
            </span>
          )}

          {match.provenance && (
            <span className="dl-meta-pill dl-meta-pill--provenance" title={t("downloadModal.provenanceTitle")}>
              {match.provenance}
            </span>
          )}
        </div>

        {/* Technical actions (Magnet, Torrent, Hash copy) */}
        {(match.infohash || match.magnet || match.torrentUrl) && (
          <div className="dl-result-quick-actions" onClick={(e) => e.stopPropagation()}>
            {match.infohash && (
              <button
                type="button"
                className={`dl-quick-action-btn${copiedChip === "hash" ? " copied" : ""}`}
                title={match.infohash}
                onClick={() => void copyText(match.infohash!, "hash")}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                <span>{copiedChip === "hash" ? t("downloadModal.copied") : t("downloadModal.copyHash")}</span>
              </button>
            )}

            {match.magnet && (
              <button
                type="button"
                className={`dl-quick-action-btn${copiedChip === "magnet" ? " copied" : ""}`}
                title={match.magnet}
                onClick={() => void copyText(match.magnet!, "magnet")}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M6 15a6 6 0 1 0 12 0c0-4.97-4-9-6-12-2 3-6 7.03-6 12z" />
                  <path d="M9.5 15.5c0 1.38 1.12 2.5 2.5 2.5" />
                </svg>
                <span>{copiedChip === "magnet" ? t("downloadModal.copied") : t("downloadModal.copyMagnet")}</span>
              </button>
            )}

            {match.torrentUrl && (
              <button
                type="button"
                className={`dl-quick-action-btn${copiedChip === "torrent" ? " copied" : ""}`}
                title={match.torrentUrl}
                onClick={() => void copyText(match.torrentUrl!, "torrent")}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                <span>{copiedChip === "torrent" ? t("downloadModal.copied") : t("downloadModal.copyTorrent")}</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Selected Indicator */}
      <div className="dl-result-indicator-col" aria-hidden>
        <div className={`dl-result-check${selected ? " active" : ""}`}>
          {selected ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <div className="dl-result-radio-ring" />
          )}
        </div>
      </div>
    </div>
  );
}

