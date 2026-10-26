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
import { hasReliabilitySample, type SourceReliability } from "./reliability";
import { accentForPlatform } from "../../types/emulator";

/**
 * ResultRow — one source release, in two lines.
 *
 *   line 1  the release title, plus the state flags and the copy/compare actions
 *   line 2  one quiet fact line: source, size, version, health, date, match
 *
 * The previous card spread the same facts over three stacked chip rows, which
 * made every row ~40% taller and gave eight badges the same visual weight. Here
 * only the source and the platform keep a tinted container; everything else is
 * plain text separated by hairlines, so the eye can scan one fact line.
 */
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
  const platformAccent = match.platform ? accentForPlatform(match.platform) : null;
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
  const displayTitle = match.title?.trim() || match.matchTitle?.trim() || "";

  // The plugin-provided version wins over the title heuristic (the same
  // precedence parseReleaseMetadata applies, surfaced as one fact).
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
  const cacheChecked =
    cacheStatus === "cached" || cacheStatus === "uncached" || cacheStatus === "checking";
  const hasUpdate = meta.versionComparison === "newer";

  return (
    <div
      role="button"
      tabIndex={0}
      className={`dl-result-card${selected ? " selected" : ""}${batchChecked ? " is-batch-checked" : ""}`}
      style={platformAccent ? ({ "--dl-platform-accent": platformAccent } as React.CSSProperties) : undefined}
      onClick={() => onSelect(match.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(match.id);
        }
      }}
      aria-pressed={selected}
    >
      <span className="dl-result-accent-bar" aria-hidden />

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

      <div className="dl-result-body">
        {/* Line 1 — the release itself, its state, and its actions. */}
        <div className="dl-result-head">
          <span className={`dl-result-title${hasUpdate ? " is-update" : ""}`} title={displayTitle}>
            {recommended && (
              <span className="dl-result-star" title={t("downloadModal.recommended")} aria-label={t("downloadModal.recommended")}>
                <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden>
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </span>
            )}
            {titleSegments.map((seg, i) =>
              seg.highlight ? (
                <mark key={i} className="dl-result-highlight">
                  {seg.text}
                </mark>
              ) : (
                <span key={i}>{seg.text}</span>
              ),
            )}
          </span>

          <div className="dl-result-flags">
            {hasUpdate && (
              <span className="dl-flag dl-flag--update" title={t("downloadModal.rowStatusUpdateHint")}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <line x1="12" y1="19" x2="12" y2="5" />
                  <polyline points="5 12 12 5 19 12" />
                </svg>
                {t("downloadModal.versionNewer")}
              </span>
            )}
            {match.isNew && <span className="dl-flag">{t("downloads.newlyAddedSource")}</span>}
            {downloaded && (
              <span className="dl-flag dl-flag--done" title={t("downloads.alreadyDownloaded")}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {t("downloads.alreadyDownloaded")}
              </span>
            )}
            {match.verified && (
              <span className="dl-flag dl-flag--done" title={t("downloadModal.verified")}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {t("downloadModal.verified")}
              </span>
            )}
            {cacheChecked && (
              <span
                className={`dl-flag dl-flag--cache dl-flag--cache-${cacheStatus}`}
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
                {cacheStatus === "cached"
                  ? t("downloadModal.rowCacheCached")
                  : cacheStatus === "uncached"
                    ? t("downloadModal.rowCacheUncached")
                    : t("downloadModal.rowCacheChecking")}
              </span>
            )}
          </div>

          <div className="dl-result-actions" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className={`dl-icon-btn dl-icon-btn--pin${comparePinned ? " is-active" : ""}`}
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
                className={`dl-icon-btn${copiedKey === "hash" ? " is-copied" : ""}`}
                title={`Hash: ${match.infohash}`}
                onClick={(e) => void copyText(e, match.infohash!, "hash")}
                aria-label={t("downloadModal.copyHash")}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              </button>
            )}

            {match.magnet && (
              <button
                type="button"
                className={`dl-icon-btn${copiedKey === "magnet" ? " is-copied" : ""}`}
                title={t("downloadModal.copyMagnet")}
                onClick={(e) => void copyText(e, match.magnet!, "magnet")}
                aria-label={t("downloadModal.copyMagnet")}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M6 15a6 6 0 1 0 12 0c0-4.97-4-9-6-12-2 3-6 7.03-6 12z" />
                  <path d="M9.5 15.5c0 1.38 1.12 2.5 2.5 2.5" />
                </svg>
              </button>
            )}

            {match.torrentUrl && (
              <button
                type="button"
                className={`dl-icon-btn${copiedKey === "torrent" ? " is-copied" : ""}`}
                title={t("downloadModal.copyTorrent")}
                onClick={(e) => void copyText(e, match.torrentUrl!, "torrent")}
                aria-label={t("downloadModal.copyTorrent")}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Line 2 — one quiet fact line. */}
        <div className="dl-result-facts">
          <span
            className={`dl-fact dl-fact--source${isPlugin ? " dl-fact--plugin" : ""}`}
            title={match.sourceName}
          >
            {match.sourceName}
          </span>

          {formatBadge && <span className="dl-fact dl-fact--type">{formatBadge}</span>}

          <span className="dl-fact dl-fact--size">
            {match.fileSize || t("downloadModal.unknownSize")}
          </span>

          {versionLabel && (
            <span className={`dl-fact dl-fact--version${hasUpdate ? " is-newer" : ""}`}>
              {versionLabel}
            </span>
          )}

          {hasSwarm && (
            <span
              className={`dl-fact dl-fact--health ${swarmHealthy ? "is-good" : "is-low"}`}
              title={`${t("downloadModal.seeds", { count: seeds })} · ${t("downloadModal.peers", { count: peers })}`}
            >
              <span className="dl-fact-dot" aria-hidden />
              {t("downloadModal.seeds", { count: seeds })}
            </span>
          )}

          {reliability && hasReliabilitySample(reliability) && (
            <span className="dl-fact dl-fact--reliability">
              <ReliabilityBadge reliability={reliability} compact />
            </span>
          )}

          {match.uploadDate && (
            <span className="dl-fact dl-fact--date">{formatUploadDate(match.uploadDate, language)}</span>
          )}

          <span
            className={`dl-fact dl-fact--match ${tier}`}
            title={`${t("downloadModal.detailConfidence")}: ${tierLabel}`}
          >
            <span className="dl-fact-dot" aria-hidden />
            {Math.round(score * 100)}%
          </span>

          {meta.group && (
            <span className="dl-fact dl-fact--group" title={`${t("downloadModal.detailReleaseGroup")}: ${meta.group}`}>
              {meta.group}
            </span>
          )}

          {meta.edition && (
            <span className="dl-fact" title={`${t("downloadModal.detailEdition")}: ${meta.edition}`}>
              {meta.edition}
            </span>
          )}

          {match.platform && (
            <span className="dl-fact dl-fact--platform" title={match.platform}>
              {match.platform}
            </span>
          )}

          {match.region && (
            <span className="dl-fact" title={`${t("downloadModal.detailRegion")}: ${match.region}`}>
              {match.region}
            </span>
          )}

          {meta.isMultiPart && (
            <span className="dl-fact">
              {meta.partCount ? `${meta.partCount} ${t("downloadModal.partsShort")}` : t("downloadModal.multiPartPackage")}
            </span>
          )}

          {mirrorCount > 1 && (
            <span className="dl-fact" title={`${mirrorCount} Mirrors`}>
              {t("downloadModal.mirrorsCount", { count: mirrorCount })}
            </span>
          )}

          {match.provenance && (
            <span className="dl-fact dl-fact--provenance" title={t("downloadModal.provenanceTitle")}>
              {match.provenance}
            </span>
          )}
        </div>
      </div>

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
