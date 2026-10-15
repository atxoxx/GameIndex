import { useState, useMemo } from "react";
import type { CacheCheckStatus, DisplayMatch } from "./types";
import { useLanguage } from "../../context/LanguageContext";
import {
  formatUploadDate,
  classifyUri,
  resolveSourceUri,
  webUrlFor,
  parseReleaseMetadata,
} from "./helpers";
import { highlightSegments, type ParsedQuery } from "./searchQuery";
import { ReliabilityBadge } from "./ReliabilityBadge";
import type { SourceReliability } from "./reliability";

export function ResultRow({
  match,
  selected,
  onSelect,
  isDownloaded,
  installedVersion,
  highlightQuery,
  reliability,
  recommended = false,
  batchMode = false,
  batchChecked = false,
  onToggleBatch,
  comparePinned = false,
  onToggleCompare,
  cacheStatus,
}: {
  match: DisplayMatch;
  selected: boolean;
  onSelect: (id: string) => void;
  isDownloaded: (title: string) => boolean;
  installedVersion?: string | null;
  highlightQuery?: ParsedQuery;
  reliability?: SourceReliability;
  recommended?: boolean;
  batchMode?: boolean;
  batchChecked?: boolean;
  onToggleBatch?: (id: string) => void;
  comparePinned?: boolean;
  onToggleCompare?: (id: string) => void;
  cacheStatus?: CacheCheckStatus;
}) {
  const { t, language } = useLanguage();
  const isPlugin = match.provider === "plugin";
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const score = match.matchScore;
  const tier = score >= 0.8 ? "high" : score >= 0.4 ? "partial" : "low";
  const tierLabel =
    score >= 0.8
      ? t("downloadModal.matchHigh")
      : score >= 0.4
        ? t("downloadModal.matchPartial")
        : t("downloadModal.matchPossible");

  const uri = resolveSourceUri(match, 0);
  const { isMagnet, isTorrentFile, isDirect } = classifyUri(uri, match.torrentUrl);
  const isWeb = Boolean(webUrlFor(match));

  const formatBadge = isWeb
    ? t("downloadModal.typeWeb")
    : isMagnet
      ? t("downloadModal.typeMagnet")
      : isTorrentFile
        ? t("downloadModal.typeTorrent")
        : isDirect
          ? t("downloadModal.typeDirect")
          : null;

  const meta = useMemo(
    () => parseReleaseMetadata(match.title, installedVersion, match),
    [match, installedVersion],
  );
  const mirrorCount = match.uris ? match.uris.length : 0;

  // Plugins may supply a cleaner display name; `title` stays the source of
  // truth for copy actions, downloaded-state checks and library matching.
  const displayTitle = match.matchTitle?.trim() || match.title;

  // The plugin-provided version wins over the title heuristic (the same
  // precedence parseReleaseMetadata applies, surfaced as one badge).
  const versionLabel = match.version?.trim() || meta.version;

  const titleSegments = useMemo(
    () =>
      highlightQuery ? highlightSegments(displayTitle, highlightQuery) : [{ text: displayTitle, highlight: false }],
    [displayTitle, highlightQuery],
  );

  const copyText = async (e: React.MouseEvent, text: string, label: string) => {
    e.stopPropagation();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(label);
      window.setTimeout(() => {
        setCopiedKey((curr) => (curr === label ? null : curr));
      }, 1400);
    } catch {
      // Ignore clipboard failure
    }
  };

  const seeds = match.seeds ?? 0;
  const peers = match.peers ?? 0;
  const hasSwarm = match.seeds != null && match.peers != null;
  const swarmHealthy = seeds >= 5;

  const downloaded = isDownloaded(match.title);
  const showCacheStatus = cacheStatus === "checking" || cacheStatus === "cached" || cacheStatus === "uncached";
  const hasStatus = meta.versionComparison === "newer" || match.isNew || downloaded || match.verified || showCacheStatus;

  return (
    <div
      role="button"
      tabIndex={0}
      className={`dl-result-card${selected ? " selected" : ""}${batchChecked ? " is-batch-checked" : ""}`}
      onClick={() => onSelect(match.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(match.id);
        }
      }}
      aria-pressed={selected}
    >
      <div className="dl-result-accent-bar" aria-hidden />

      {batchMode && (
        <label className="dl-result-batch-check" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={batchChecked}
            onChange={() => onToggleBatch?.(match.id)}
            aria-label={t("downloadModal.checkboxAria")}
          />
          <span className="dl-result-batch-checkmark" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </span>
        </label>
      )}

      {/* Main card body */}
      <div className="dl-result-body">
        {/* Identity row — what this release is */}
        <div className="dl-result-header">
          <div className="dl-result-tags">
            {recommended && (
              <span className="dl-badge dl-badge--recommended" title={t("downloadModal.recommended")}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
                {t("downloadModal.recommended")}
              </span>
            )}

            <span className={`dl-source-pill-badge${isPlugin ? " dl-source-pill-badge--plugin" : ""}`}>
              {match.sourceName}
            </span>

            <ReliabilityBadge reliability={reliability} compact />

            {formatBadge && <span className="dl-badge dl-badge--format">{formatBadge}</span>}

            {versionLabel && (
              <span
                className="dl-badge dl-badge--version"
                title={`${t("downloadModal.detailVersion")}: ${versionLabel}`}
              >
                {versionLabel}
              </span>
            )}
          </div>

          {/* Quick Actions (Right side of header) */}
          <div className="dl-result-actions" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className={`dl-action-chip dl-action-chip--pin${comparePinned ? " active" : ""}`}
              title={comparePinned ? t("downloadModal.compareUnpin") : t("downloadModal.comparePin")}
              aria-label={comparePinned ? t("downloadModal.compareUnpin") : t("downloadModal.comparePin")}
              aria-pressed={comparePinned}
              onClick={(e) => {
                e.stopPropagation();
                onToggleCompare?.(match.id);
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <line x1="18" y1="10" x2="6" y2="10" />
                <line x1="12" y1="2" x2="12" y2="10" />
                <path d="M12 10l-3 6h6z" />
                <line x1="9" y1="20" x2="15" y2="20" />
              </svg>
            </button>

            {match.infohash && (
              <button
                type="button"
                className={`dl-action-chip${copiedKey === "hash" ? " copied" : ""}`}
                title={`Hash: ${match.infohash}`}
                onClick={(e) => void copyText(e, match.infohash!, "hash")}
                aria-label={t("downloadModal.copyHash")}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                {copiedKey === "hash" && <span>{t("downloadModal.copied")}</span>}
              </button>
            )}

            {match.magnet && (
              <button
                type="button"
                className={`dl-action-chip${copiedKey === "magnet" ? " copied" : ""}`}
                title={t("downloadModal.copyMagnet")}
                onClick={(e) => void copyText(e, match.magnet!, "magnet")}
                aria-label={t("downloadModal.copyMagnet")}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M6 15a6 6 0 1 0 12 0c0-4.97-4-9-6-12-2 3-6 7.03-6 12z" />
                  <path d="M9.5 15.5c0 1.38 1.12 2.5 2.5 2.5" />
                </svg>
                {copiedKey === "magnet" && <span>{t("downloadModal.copied")}</span>}
              </button>
            )}

            {match.torrentUrl && (
              <button
                type="button"
                className={`dl-action-chip${copiedKey === "torrent" ? " copied" : ""}`}
                title={t("downloadModal.copyTorrent")}
                onClick={(e) => void copyText(e, match.torrentUrl!, "torrent")}
                aria-label={t("downloadModal.copyTorrent")}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                {copiedKey === "torrent" && <span>{t("downloadModal.copied")}</span>}
              </button>
            )}
          </div>
        </div>

        {/* Release Title */}
        <h4 className="dl-result-title" title={displayTitle}>
          {titleSegments.map((seg, i) =>
            seg.highlight ? (
              <mark key={i} className="dl-result-highlight">
                {seg.text}
              </mark>
            ) : (
              <span key={i}>{seg.text}</span>
            ),
          )}
        </h4>

        {/* Metrics + demoted secondary metadata, one quiet, even line */}
        <div className="dl-result-meta-row">
          <span className="dl-meta-chip dl-meta-chip--size">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <strong>{match.fileSize || t("downloadModal.unknownSize")}</strong>
          </span>

          {hasSwarm && (
            <span className={`dl-meta-chip dl-meta-chip--swarm ${swarmHealthy ? "healthy" : "low"}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <span>{t("downloadModal.seeds", { count: seeds })}</span>
              <span className="dl-meta-chip-sep">·</span>
              <span>{t("downloadModal.peers", { count: peers })}</span>
            </span>
          )}

          {match.uploadDate && (
            <span className="dl-meta-chip dl-meta-chip--date">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              {formatUploadDate(match.uploadDate, language)}
            </span>
          )}

          <span className={`dl-meta-chip dl-meta-chip--score ${tier}`} title={t("downloadModal.detailConfidence")}>
            <span className="dl-tier-dot" aria-hidden />
            <span>{tierLabel}</span>
            <span className="dl-tier-percent">{(score * 100).toFixed(0)}%</span>
          </span>

          {meta.group && (
            <span className="dl-meta-chip dl-meta-chip--group" title={`${t("downloadModal.detailReleaseGroup")}: ${meta.group}`}>
              {meta.group}
            </span>
          )}

          {meta.edition && (
            <span className="dl-meta-chip" title={`${t("downloadModal.detailEdition")}: ${meta.edition}`}>
              {meta.edition}
            </span>
          )}

          {match.platform && (
            <span className="dl-meta-chip dl-meta-chip--platform" title={match.platform}>
              {match.platform}
            </span>
          )}

          {match.region && (
            <span className="dl-meta-chip" title={`${t("downloadModal.detailRegion")}: ${match.region}`}>
              {match.region}
            </span>
          )}

          {meta.isMultiPart && (
            <span className="dl-meta-chip">
              {meta.partCount ? `${meta.partCount} ${t("downloadModal.partsShort")}` : t("downloadModal.multiPartPackage")}
            </span>
          )}

          {mirrorCount > 1 && (
            <span className="dl-meta-chip" title={`${mirrorCount} Mirrors`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              {t("downloadModal.mirrorsCount", { count: mirrorCount })}
            </span>
          )}

          {match.provenance && (
            <span className="dl-meta-chip dl-meta-chip--provenance" title={t("downloadModal.provenanceTitle")}>
              {match.provenance}
            </span>
          )}
        </div>
      </div>

      {/* Status cluster — what's happening with this release, kept near the
          selection indicator and apart from the identity badges. */}
      {hasStatus && (
        <div className="dl-result-status">
          {meta.versionComparison === "newer" && (
            <span className="dl-badge dl-badge--status" title={t("downloadModal.rowStatusUpdateHint")}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
              {t("downloadModal.versionNewer")}
            </span>
          )}

          {match.isNew && (
            <span className="dl-badge dl-badge--status">{t("downloads.newlyAddedSource")}</span>
          )}

          {downloaded && (
            <span className="dl-badge dl-badge--status" title={t("downloads.alreadyDownloaded")}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <polyline points="20 6 9 17 4 12" />
              </svg>
              {t("downloads.alreadyDownloaded")}
            </span>
          )}

          {match.verified && (
            <span className="dl-badge dl-badge--status" title={t("downloadModal.verified")}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <polyline points="20 6 9 17 4 12" />
              </svg>
              {t("downloadModal.verified")}
            </span>
          )}

          {showCacheStatus && (
            <span
              className={`dl-badge dl-badge--status dl-badge--cache dl-badge--cache-${cacheStatus}`}
              title={
                cacheStatus === "cached"
                  ? t("downloadModal.rowCacheCached")
                  : cacheStatus === "uncached"
                    ? t("downloadModal.rowCacheUncached")
                    : t("downloadModal.rowCacheChecking")
              }
            >
              {cacheStatus === "checking" && <span className="dl-cache-spinner" aria-hidden />}
              {cacheStatus === "cached" && (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
              )}
              {cacheStatus === "uncached" && (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <circle cx="12" cy="12" r="9" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                </svg>
              )}
              {cacheStatus === "cached"
                ? t("downloadModal.rowCacheCached")
                : cacheStatus === "uncached"
                  ? t("downloadModal.rowCacheUncached")
                  : t("downloadModal.rowCacheChecking")}
            </span>
          )}
        </div>
      )}

      {/* Radio Selection Indicator */}
      <div className="dl-result-indicator" aria-hidden>
        <div className={`dl-selection-indicator${selected ? " active" : ""}`}>
          {selected ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <div className="dl-selection-ring" />
          )}
        </div>
      </div>
    </div>
  );
}
