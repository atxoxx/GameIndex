import { useState, useMemo } from "react";
import type { DisplayMatch } from "./types";
import { useLanguage } from "../../context/LanguageContext";
import {
  formatUploadDate,
  classifyUri,
  resolveSourceUri,
  webUrlFor,
  parseReleaseMetadata,
} from "./helpers";
import { accentForPlatform } from "../../types/emulator";

export function ResultRow({
  match,
  selected,
  onSelect,
  isDownloaded,
  installedVersion,
}: {
  match: DisplayMatch;
  selected: boolean;
  onSelect: (id: string) => void;
  isDownloaded: (title: string) => boolean;
  installedVersion?: string | null;
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
    () => parseReleaseMetadata(match.title, installedVersion),
    [match.title, installedVersion],
  );
  const mirrorCount = match.uris ? match.uris.length : 0;

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

  return (
    <div
      role="button"
      tabIndex={0}
      className={`dl-result-card${selected ? " selected" : ""}`}
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

      {/* Main card body */}
      <div className="dl-result-body">
        {/* Header Badges */}
        <div className="dl-result-header">
          <div className="dl-result-tags">
            <span className={`dl-source-pill-badge${isPlugin ? " dl-source-pill-badge--plugin" : ""}`}>
              {match.sourceName}
            </span>

            {formatBadge && (
              <span className="dl-badge dl-badge--format">
                {formatBadge}
              </span>
            )}

            {/* Repack / Scene Group Badge */}
            {meta.group && (
              <span className="dl-badge dl-badge--group" title={`Group: ${meta.group}`}>
                {meta.group}
              </span>
            )}

            {/* Version Badge with Relative Comparison */}
            {meta.version && (
              <span
                className={`dl-badge dl-badge--version${
                  meta.versionComparison === "newer"
                    ? " dl-badge--version-newer"
                    : meta.versionComparison === "same"
                      ? " dl-badge--version-same"
                      : meta.versionComparison === "older"
                        ? " dl-badge--version-older"
                        : ""
                }`}
                title={
                  meta.versionComparison === "newer"
                    ? `${meta.version} (${t("downloadModal.versionNewer")})`
                    : meta.versionComparison === "same"
                      ? `${meta.version} (${t("downloadModal.versionCurrent")})`
                      : meta.versionComparison === "older"
                        ? `${meta.version} (${t("downloadModal.versionOlder")})`
                        : `Version: ${meta.version}`
                }
              >
                {meta.versionComparison === "newer" && (
                  <svg
                    viewBox="0 0 24 24"
                    width="10"
                    height="10"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <line x1="12" y1="19" x2="12" y2="5" />
                    <polyline points="5 12 12 5 19 12" />
                  </svg>
                )}
                <span>{meta.version}</span>
                {meta.versionComparison === "newer" && (
                  <span className="dl-version-status-pill">{t("downloadModal.versionNewer")}</span>
                )}
                {meta.versionComparison === "same" && (
                  <span className="dl-version-status-pill">{t("downloadModal.versionCurrent")}</span>
                )}
              </span>
            )}

            {/* Edition Badge */}
            {meta.edition && (
              <span className="dl-badge dl-badge--edition" title={`Edition: ${meta.edition}`}>
                {meta.edition}
              </span>
            )}

            {/* Multi-part Badge */}
            {meta.isMultiPart && (
              <span className="dl-badge dl-badge--multipart">
                {meta.partCount ? `${meta.partCount} Parts` : t("downloadModal.multiPartPackage")}
              </span>
            )}

            {/* Mirror Count */}
            {mirrorCount > 1 && (
              <span className="dl-badge dl-badge--mirrors" title={`${mirrorCount} Mirrors`}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
                {t("downloadModal.mirrorsCount", { count: mirrorCount })}
              </span>
            )}

            {match.platform && (() => {
              const platformColor = accentForPlatform(match.platform);
              return (
                <span
                  className="dl-badge dl-badge--platform"
                  style={{
                    color: platformColor,
                    backgroundColor: `color-mix(in srgb, ${platformColor} 16%, transparent)`,
                    borderColor: `color-mix(in srgb, ${platformColor} 40%, transparent)`,
                  }}
                  title={match.platform}
                >
                  {match.platform}
                </span>
              );
            })()}

            {match.isNew && (
              <span className="dl-badge dl-badge--new">
                {t("downloads.newlyAddedSource")}
              </span>
            )}

            {isDownloaded(match.title) && (
              <span className="dl-badge dl-badge--downloaded">
                ✓ {t("downloads.alreadyDownloaded")}
              </span>
            )}

            {match.verified && (
              <span className="dl-badge dl-badge--verified" title={t("downloadModal.verified")}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {t("downloadModal.verified")}
              </span>
            )}
          </div>

          {/* Quick Actions (Right side of header) */}
          <div className="dl-result-actions" onClick={(e) => e.stopPropagation()}>
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
        <h4 className="dl-result-title" title={match.title}>
          {match.title}
        </h4>

        {/* Metric Badges */}
        <div className="dl-result-meta-row">
          {/* File Size */}
          <span className="dl-meta-chip dl-meta-chip--size">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <strong>{match.fileSize || t("downloadModal.unknownSize")}</strong>
          </span>

          {/* Swarm Health (Seeds & Peers) */}
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

          {/* Upload Date */}
          {match.uploadDate && (
            <span className="dl-meta-chip dl-meta-chip--date">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              {formatUploadDate(match.uploadDate, language)}
            </span>
          )}

          {/* Match Confidence Score */}
          <span className={`dl-meta-chip dl-meta-chip--score ${tier}`} title={t("downloadModal.detailConfidence")}>
            <span className="dl-tier-dot" aria-hidden />
            <span>{tierLabel}</span>
            <span className="dl-tier-percent">{(score * 100).toFixed(0)}%</span>
          </span>

          {/* Provenance if available */}
          {match.provenance && (
            <span className="dl-meta-chip dl-meta-chip--provenance" title={t("downloadModal.provenanceTitle")}>
              {match.provenance}
            </span>
          )}
        </div>
      </div>

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
