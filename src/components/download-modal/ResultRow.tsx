import { useState } from "react";
import type { DisplayMatch } from "./types";
import { useLanguage } from "../../context/LanguageContext";
import { formatUploadDate } from "./helpers";

/** Shorten a long hash for display, keeping both ends readable:
 *  "a1b2c3d4e5f6a7b8c9d0e1f2…3a4b5c6d" */
function truncateMiddle(value: string, keep = 16, tail = 8): string {
  if (value.length <= keep + tail + 1) return value;
  return `${value.slice(0, keep)}…${value.slice(-tail)}`;
}

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
  // Which copy chip just succeeded — shows a brief "Copied" state.
  const [copiedChip, setCopiedChip] = useState<"hash" | "magnet" | "torrent" | null>(null);

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

  const copyText = async (text: string, chip: "hash" | "magnet" | "torrent") => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedChip(chip);
      window.setTimeout(() => {
        setCopiedChip((current) => (current === chip ? null : current));
      }, 1200);
    } catch {
      // Clipboard unavailable (non-secure context / permission) — the
      // chip is still selectable so the user can copy manually.
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
      <div className="dl-result-info">
        <div className="dl-result-title">
          <span className="dl-result-title-text">{match.title}</span>
          <span className="dl-result-badges">
            {isPlugin && (
              <span
                className="dl-badge dl-badge-plugin"
                title={t("downloadModal.pluginBadgeTitle")}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
                {match.pluginId ?? match.sourceName}
              </span>
            )}
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

        {isPlugin && (
          <div className="dl-plugin-extras">
            {match.provenance && (
              <span
                className="dl-badge dl-badge-provenance"
                title={t("downloadModal.provenanceTitle")}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
                {match.provenance}
              </span>
            )}
            {match.verified && (
              <span className="dl-badge dl-badge-verified" title={t("downloadModal.verified")}>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {t("downloadModal.verified")}
              </span>
            )}
            {match.seeds != null && match.peers != null && (
              <span className="dl-plugin-swarm">
                {t("downloadModal.seeds", { count: match.seeds })} ·{" "}
                {t("downloadModal.peers", { count: match.peers })}
              </span>
            )}
            {match.infohash && (
              <button
                type="button"
                className={`dl-plugin-chip dl-plugin-chip--mono${copiedChip === "hash" ? " copied" : ""}`}
                title={match.infohash}
                aria-label={`${t("downloadModal.infohash")}: ${match.infohash}`}
                onClick={(e) => {
                  e.stopPropagation();
                  void copyText(match.infohash!, "hash");
                }}
              >
                {copiedChip === "hash" ? t("downloadModal.copied") : truncateMiddle(match.infohash)}
              </button>
            )}
            {match.magnet && (
              <button
                type="button"
                className={`dl-plugin-chip${copiedChip === "magnet" ? " copied" : ""}`}
                title={match.magnet}
                onClick={(e) => {
                  e.stopPropagation();
                  void copyText(match.magnet!, "magnet");
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M6 15a6 6 0 1 0 12 0c0-4.97-4-9-6-12-2 3-6 7.03-6 12z" />
                  <path d="M9.5 15.5c0 1.38 1.12 2.5 2.5 2.5" />
                </svg>
                {copiedChip === "magnet" ? t("downloadModal.copied") : t("downloadModal.magnet")}
              </button>
            )}
            {match.torrentUrl && (
              <button
                type="button"
                className={`dl-plugin-chip${copiedChip === "torrent" ? " copied" : ""}`}
                title={match.torrentUrl}
                onClick={(e) => {
                  e.stopPropagation();
                  void copyText(match.torrentUrl!, "torrent");
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <path d="M12 18v-6" />
                  <path d="M9 15l3 3 3-3" />
                </svg>
                {copiedChip === "torrent" ? t("downloadModal.copied") : t("downloadModal.torrentFile")}
              </button>
            )}
          </div>
        )}
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
    </div>
  );
}
