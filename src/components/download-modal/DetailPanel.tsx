import { useId, useMemo, useRef, useState } from "react";
import { useLanguage } from "../../context/LanguageContext";
import {
  classifyUri,
  hostLabelForUri,
  hosterNeedsBrowser,
  resolveSourceUri,
  webUrlFor,
  extractMirrors,
  parseReleaseMetadata,
  formatByteSize,
  formatUploadDate,
} from "./helpers";
import type { DisplayMatch, CacheCheckStatus } from "./types";
import { OptionsSection } from "./OptionsSection";
import { SavePathPicker } from "./SavePathPicker";
import {
  DetailChecksumList,
  DetailDisclosure,
  DetailFactGrid,
  DetailSection,
  type DetailFact,
  type DetailFactTone,
} from "./DetailMetadata";
import "../../styles/download-modal-details.css";

/**
 * Selected-release dossier on the right side of the modal.
 *
 * The panel answers four questions in order: what release is selected, where
 * it comes from, how the user wants it downloaded, and (for power users) what
 * identifiers and checksums sit behind it. It deliberately does not own the
 * primary download action — the modal footer does — so the only prominent
 * buttons here are the source-specific browser resolver actions and the
 * existing option controls.
 */
export function DetailPanel({
  match,
  selectedMirrorIndex = 0,
  onSelectMirror,
  installedVersion,
  isDownloaded,
  savePath,
  gameName,
  onPickPath,
  autoExtract,
  onAutoExtract,
  chooseFiles,
  onChooseFiles,
  onSelectFiles,
  isFetchingFiles,
  useDebrid,
  onUseDebrid,
  debridConfigured,
  cacheStatus,
  onOpenPage,
  onOpenBrowserResolver,
  resolverActive,
  resolverPartsCaptured,
  className = "",
}: {
  match: DisplayMatch | null;
  selectedMirrorIndex?: number;
  onSelectMirror?: (idx: number) => void;
  installedVersion?: string | null;
  isDownloaded: (title: string) => boolean;
  savePath: string | null;
  gameName: string;
  onPickPath: () => void;
  autoExtract: boolean;
  onAutoExtract: (v: boolean) => void;
  chooseFiles: boolean;
  onChooseFiles: (v: boolean) => void;
  onSelectFiles: () => void;
  isFetchingFiles: boolean;
  useDebrid: boolean;
  onUseDebrid: (v: boolean) => void;
  debridConfigured: boolean;
  cacheStatus: CacheCheckStatus;
  onOpenPage: (url?: string) => void;
  onOpenBrowserResolver?: (url?: string) => void;
  resolverActive: boolean;
  resolverPartsCaptured: number;
  className?: string;
}) {
  const { t, language } = useLanguage();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const optionsRef = useRef<HTMLDivElement | null>(null);
  const baseId = useId();
  const summaryTitleId = `${baseId}-title`;
  const checksumHeadingId = `${baseId}-checksums`;
  const rawHeadingId = `${baseId}-raw`;

  const mirrors = useMemo(() => extractMirrors(match), [match]);
  const meta = useMemo(
    () => parseReleaseMetadata(match?.title ?? "", installedVersion, match),
    [match, installedVersion],
  );

  const copyText = async (text: string, label: string) => {
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

  const focusOptions = () => {
    const node = optionsRef.current;
    if (!node) return;
    const reduceMotion =
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    node.scrollIntoView?.({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "start",
    });
    node
      .querySelector<HTMLElement>("input, button, select")
      ?.focus({ preventScroll: true });
  };

  const rootClass = ["dl-detail-inspector", "dl-dossier", className]
    .filter(Boolean)
    .join(" ");

  if (!match) {
    return (
      <aside className={rootClass} aria-label={t("downloadModal.configHeader")}>
        <div className="dl-dossier-empty">
          <div className="dl-dossier-empty-icon">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <line x1="3" y1="9" x2="21" y2="9" />
              <line x1="9" y1="21" x2="9" y2="9" />
            </svg>
          </div>
          <h2 className="dl-dossier-empty-title">
            {t("downloadModal.detailEmpty")}
          </h2>
          <p className="dl-dossier-empty-hint">
            {t("downloadModal.pickResult")}
          </p>
        </div>
      </aside>
    );
  }

  const activeMirror = mirrors[selectedMirrorIndex] ?? mirrors[0];
  const sourceUri = activeMirror?.uri ?? resolveSourceUri(match, selectedMirrorIndex);
  const { isMagnet, isTorrentFile, isDirect } = classifyUri(
    sourceUri,
    match.torrentUrl,
  );
  const webUrl = webUrlFor(match);
  const detailUrl = match.detailUrl?.trim() || null;
  const showOpenPage = !webUrl && !isDirect && Boolean(detailUrl);
  const debridAvailable =
    debridConfigured && (isMagnet || isTorrentFile || isDirect);
  const hostLabel = sourceUri
    ? hostLabelForUri(sourceUri, selectedMirrorIndex)
    : null;
  const needsBrowser = hosterNeedsBrowser(sourceUri);

  const typeLabel = webUrl
    ? t("downloadModal.typeWeb")
    : isMagnet
      ? t("downloadModal.typeMagnet")
      : isTorrentFile
        ? t("downloadModal.typeTorrent")
        : isDirect
          ? t("downloadModal.typeDirect")
          : t("downloadModal.typeUnknown");

  const score = match.matchScore;
  const tier = score >= 0.8 ? "high" : score >= 0.4 ? "partial" : "low";
  const tierLabel =
    tier === "high"
      ? t("downloadModal.matchHigh")
      : tier === "partial"
        ? t("downloadModal.matchPartial")
        : t("downloadModal.matchPossible");
  const confidenceTone: DetailFactTone =
    tier === "high" ? "success" : tier === "partial" ? "warning" : "default";

  const releaseGroup = match.releaseGroup?.trim() || meta.group;
  const releaseVersion = match.version?.trim() || meta.version;
  const platform = match.platform?.trim();
  const region = match.region?.trim();
  const languages = meta.languages ?? [];
  const fileList = match.fileList ?? [];
  const checksums = match.checksums ?? [];
  const description = match.description?.trim();
  const coverUrl = match.coverUrl?.trim();
  const displayTitle = match.matchTitle?.trim() || match.title;
  const sourceName = match.sourceName || match.sourceId;
  const downloaded = isDownloaded(match.title);
  const hasSwarm = match.seeds != null && match.peers != null;
  const swarmLabel = hasSwarm
    ? `${t("downloadModal.seeds", { count: match.seeds })} · ${t("downloadModal.peers", { count: match.peers })}`
    : match.seeds != null
      ? t("downloadModal.seeds", { count: match.seeds })
      : match.peers != null
        ? t("downloadModal.peers", { count: match.peers })
        : null;

  const cacheLabel =
    cacheStatus === "checking"
      ? t("downloadModal.cacheChecking")
      : cacheStatus === "cached"
        ? t("downloadModal.cacheCached")
        : cacheStatus === "uncached"
          ? t("downloadModal.cacheUncached")
          : t("downloadModal.cacheError");
  const cacheTone: DetailFactTone =
    cacheStatus === "cached"
      ? "success"
      : cacheStatus === "uncached"
        ? "warning"
        : cacheStatus === "error"
          ? "danger"
          : "default";

  const facts: DetailFact[] = [];
  if (match.fileSize) {
    facts.push({
      key: "size",
      label: t("downloadModal.detailSize"),
      value: match.fileSize,
    });
  }
  if (match.uploadDate) {
    const uploaded = formatUploadDate(match.uploadDate, language);
    facts.push({
      key: "uploaded",
      label: t("downloadModal.detailUploaded"),
      value: uploaded,
      title: uploaded,
    });
  }
  if (platform) {
    facts.push({
      key: "platform",
      label: t("downloadModal.detailPlatform"),
      value: platform,
      title: platform,
    });
  }
  if (languages.length > 0) {
    facts.push({
      key: "language",
      label: t("common.language"),
      value: languages.join(" · "),
    });
  }
  if (region) {
    facts.push({
      key: "region",
      label: t("downloadModal.detailRegion"),
      value: region,
    });
  }
  if (releaseGroup) {
    facts.push({
      key: "group",
      label: t("downloadModal.detailReleaseGroup"),
      value: releaseGroup,
    });
  }
  if (mirrors.length > 0) {
    facts.push({
      key: "mirrors",
      label: t("downloadModal.sectionMirrors"),
      value: String(mirrors.length),
      title: t("downloadModal.mirrorCount", { count: mirrors.length }),
    });
  }
  if (fileList.length > 0) {
    facts.push({
      key: "files",
      label: t("downloadModal.detailFiles"),
      value: t("downloadModal.fileCount", { count: fileList.length }),
    });
  }
  if (checksums.length > 0) {
    facts.push({
      key: "checksums",
      label: t("downloadModal.detailChecksums"),
      value: t("downloadModal.checksumCount", { count: checksums.length }),
    });
  }
  facts.push({
    key: "confidence",
    label: t("downloadModal.detailConfidence"),
    value: `${Math.round(score * 100)}% · ${tierLabel}`,
    tone: confidenceTone,
  });
  if (cacheStatus !== "idle") {
    facts.push({
      key: "availability",
      label: t("downloadModal.filterAvailability"),
      value: cacheLabel,
      tone: cacheTone,
    });
  }

  const rawFacts: DetailFact[] = [];
  const infohash = match.infohash?.trim();
  if (infohash) {
    rawFacts.push({
      key: "infohash",
      label: t("downloadModal.infohash"),
      value: infohash,
      title: infohash,
      mono: true,
    });
  }
  const pluginId = match.pluginId?.trim();
  if (match.provider === "plugin" && pluginId) {
    rawFacts.push({
      key: "plugin",
      label: t("downloadModal.detailPlugin"),
      value: pluginId,
      mono: true,
    });
  }
  const sourceId = match.sourceId?.trim();
  if (sourceId) {
    rawFacts.push({
      key: "sourceId",
      label: t("downloadModal.detailSource"),
      value: sourceId,
      mono: true,
    });
  }
  const provenance = match.provenance?.trim();
  if (provenance) {
    rawFacts.push({
      key: "provenance",
      label: t("downloadModal.detailOrigin"),
      value: provenance,
    });
  }
  const torrentUrl = match.torrentUrl?.trim();
  if (torrentUrl) {
    rawFacts.push({
      key: "torrentUrl",
      label: t("downloadModal.torrentFile"),
      value: torrentUrl,
      title: torrentUrl,
      mono: true,
    });
  }
  const referer = match.referer?.trim();
  if (referer) {
    rawFacts.push({
      key: "referer",
      label: t("downloadModal.detailReferer"),
      value: referer,
      title: referer,
      mono: true,
    });
  }
  const cleanMatchTitle = match.matchTitle?.trim();
  if (cleanMatchTitle && cleanMatchTitle !== match.title) {
    rawFacts.push({
      key: "rawTitle",
      label: t("downloadModal.detailRawTitle"),
      value: match.title,
    });
  }

  const hasBadges = Boolean(releaseGroup || releaseVersion || meta.edition);
  const hasStateRow =
    downloaded || Boolean(match.verified) || match.isNew || swarmLabel != null;
  const hasSourceSection =
    mirrors.length > 1 || isDirect || Boolean(webUrl) || showOpenPage;
  const hasTechnical =
    checksums.length > 0 ||
    rawFacts.length > 0 ||
    Boolean(detailUrl && !webUrl);

  return (
    <aside className={rootClass} aria-label={t("downloadModal.configHeader")}>
      {/* Sticky identification bar — the only part that follows the scroll. */}
      <div className="dl-dossier-bar">
        <div className="dl-dossier-bar-title">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" />
            <line x1="3" y1="12" x2="3.01" y2="12" />
            <line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
          <span>{t("downloadModal.detailSelected")}</span>
        </div>
        <span className="dl-dossier-bar-type">{typeLabel}</span>
      </div>

      {/* Dossier summary */}
      <section className="dl-dossier-summary" aria-labelledby={summaryTitleId}>
        <div className="dl-dossier-summary-head">
          {coverUrl && (
            <div className="dl-dossier-cover">
              <img
                src={coverUrl}
                alt=""
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
              />
            </div>
          )}
          <div className="dl-dossier-summary-main">
            <div className="dl-dossier-source-line">
              <span className="dl-dossier-source" title={sourceName}>
                {sourceName}
              </span>
              {match.isNew && (
                <span className="dl-dossier-chip" data-tone="accent">
                  {t("downloads.newlyAddedSource")}
                </span>
              )}
              {downloaded && (
                <span className="dl-dossier-chip" data-tone="success">
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
                  {t("downloads.alreadyDownloaded")}
                </span>
              )}
              {match.verified && (
                <span className="dl-dossier-chip" data-tone="success">
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
            </div>

            <h2
              id={summaryTitleId}
              className="dl-dossier-title"
              title={match.title}
            >
              {displayTitle}
            </h2>

            {hasBadges && (
              <div className="dl-dossier-badges">
                {releaseGroup && (
                  <span className="dl-badge dl-badge--group">{releaseGroup}</span>
                )}
                {releaseVersion && (
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
                  >
                    {releaseVersion}
                  </span>
                )}
                {meta.edition && (
                  <span className="dl-badge dl-badge--edition">{meta.edition}</span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Installed vs. release version, when the library already knows one. */}
        {installedVersion && (
          <div className="dl-version-comparison-box">
            <div className="dl-version-compare-header">
              <span className="dl-version-compare-title">
                {t("downloadModal.versionComparison")}
              </span>
              {meta.versionComparison === "newer" && (
                <span className="dl-badge dl-badge--version-newer">
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
                  {t("downloadModal.versionNewer")}
                </span>
              )}
              {meta.versionComparison === "same" && (
                <span className="dl-badge dl-badge--version-same">
                  {t("downloadModal.versionCurrent")}
                </span>
              )}
              {meta.versionComparison === "older" && (
                <span className="dl-badge dl-badge--version-older">
                  {t("downloadModal.versionOlder")}
                </span>
              )}
            </div>
            <div className="dl-version-compare-flow">
              <div className="dl-version-compare-col">
                <span className="dl-version-compare-label">
                  {t("downloadModal.installedVersionLabel")}
                </span>
                <span className="dl-version-compare-val">{installedVersion}</span>
              </div>
              <div className="dl-version-compare-arrow" aria-hidden>
                <svg
                  viewBox="0 0 24 24"
                  width="14"
                  height="14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </div>
              <div className="dl-version-compare-col">
                <span className="dl-version-compare-label">
                  {t("downloadModal.releaseVersionLabel")}
                </span>
                <span className="dl-version-compare-val">
                  {releaseVersion || t("downloadModal.unknownVersion")}
                </span>
              </div>
            </div>
          </div>
        )}

        <DetailFactGrid facts={facts} />

        {hasStateRow && (
          <div className="dl-dossier-state-row">
            {swarmLabel && (
              <span
                className="dl-dossier-chip"
                title={swarmLabel}
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
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                </svg>
                {swarmLabel}
              </span>
            )}
          </div>
        )}

        <div className="dl-dossier-summary-actions">
          <button
            type="button"
            className="dl-dossier-options-link"
            onClick={focusOptions}
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
              <line x1="4" y1="21" x2="4" y2="14" />
              <line x1="4" y1="10" x2="4" y2="3" />
              <line x1="12" y1="21" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12" y2="3" />
              <line x1="20" y1="21" x2="20" y2="16" />
              <line x1="20" y1="12" x2="20" y2="3" />
              <line x1="1" y1="14" x2="7" y2="14" />
              <line x1="9" y1="8" x2="15" y2="8" />
              <line x1="17" y1="16" x2="23" y2="16" />
            </svg>
            <span>{t("downloadModal.options")}</span>
            <svg
              className="dl-dossier-options-chevron"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
      </section>

      {/* Plugin-provided release description */}
      {description && (
        <DetailSection title={t("downloadModal.detailDescription")}>
          <p className="dl-panel-description dl-dossier-description">
            {description}
          </p>
        </DetailSection>
      )}

      {/* Source access: mirror picker, hoster resolver, protected web link. */}
      {hasSourceSection && (
        <DetailSection title={t("downloadModal.detailSource")}>
          {mirrors.length > 1 && (
            <div className="dl-mirror-select-wrapper">
              <div className="dl-mirror-select-icon" aria-hidden>
                {activeMirror?.isMagnet ? (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M6 15a6 6 0 1 0 12 0c0-4.97-4-9-6-12-2 3-6 7.03-6 12z" />
                  </svg>
                ) : activeMirror?.isTorrentFile ? (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                ) : (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="2" y1="12" x2="22" y2="12" />
                  </svg>
                )}
              </div>

              <select
                className="dl-mirror-select"
                value={selectedMirrorIndex}
                onChange={(e) => onSelectMirror?.(Number(e.target.value))}
                aria-label={t("downloadModal.selectMirror")}
              >
                {mirrors.map((mirror) => {
                  const mirrorType = mirror.isMagnet
                    ? t("downloadModal.typeMagnet")
                    : mirror.isTorrentFile
                      ? t("downloadModal.typeTorrent")
                      : t("downloadModal.typeDirect");
                  return (
                    <option key={`${mirror.index}-${mirror.uri}`} value={mirror.index}>
                      {mirror.index + 1}. {mirror.hostName} ({mirrorType})
                    </option>
                  );
                })}
              </select>
            </div>
          )}

          {isDirect && (
            <div className="dl-resolver-banner">
              <div className="dl-resolver-banner-top">
                <div className="dl-resolver-icon-box">
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
                </div>
                <div className="dl-resolver-banner-info">
                  <span className="dl-resolver-banner-title">
                    {t("downloadModal.resolverTitle")}
                  </span>
                  {hostLabel && (
                    <span className="dl-resolver-banner-host">{hostLabel}</span>
                  )}
                </div>
              </div>

              <p className="dl-resolver-banner-desc">
                {needsBrowser
                  ? t("downloadModal.resolverNeedsBrowser")
                  : t("downloadModal.resolverDesc")}
              </p>

              <div className="dl-resolver-btn-row">
                <button
                  type="button"
                  className="dl-resolver-action-btn primary"
                  onClick={() => onOpenBrowserResolver?.(sourceUri ?? undefined)}
                  disabled={resolverActive}
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
                  <span>{t("downloadModal.resolverOpen")}</span>
                </button>
                <button
                  type="button"
                  className="dl-resolver-action-btn secondary"
                  onClick={() => onOpenPage(sourceUri ?? undefined)}
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
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                  <span>{t("downloadModal.openInBrowser")}</span>
                </button>
              </div>

              {resolverActive && (
                <div className="dl-resolver-live-state">
                  <span className="dl-resolver-live-pulse" aria-hidden />
                  {resolverPartsCaptured > 0 ? (
                    <span>
                      {t("downloadModal.resolverPartCaptured", {
                        part: resolverPartsCaptured,
                        count: resolverPartsCaptured,
                      })}
                    </span>
                  ) : (
                    <span>{t("downloadModal.resolverOpened")}</span>
                  )}
                </div>
              )}
            </div>
          )}

          {webUrl ? (
            <div className="dl-protected-banner">
              <div className="dl-protected-top">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                  className="dl-protected-badge-icon"
                >
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
                <span className="dl-protected-heading">
                  {t("downloadModal.protectedSourceTitle")}
                </span>
              </div>
              <p className="dl-protected-desc">
                {t("downloadModal.protectedSourceDesc")}
              </p>
              <div className="dl-protected-buttons">
                <button
                  type="button"
                  className="dl-resolver-action-btn primary"
                  onClick={() => onOpenPage(webUrl)}
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
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                  <span>{t("downloadModal.openInBrowser")}</span>
                </button>
                {onOpenBrowserResolver && (
                  <button
                    type="button"
                    className="dl-resolver-action-btn secondary"
                    onClick={() => onOpenBrowserResolver(webUrl)}
                    disabled={resolverActive}
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
                    <span>{t("downloadModal.openInBrowserResolver")}</span>
                  </button>
                )}
              </div>
            </div>
          ) : (
            showOpenPage && (
              <div className="dl-fallback-actions-card">
                <button
                  type="button"
                  className="dl-resolver-action-btn secondary"
                  onClick={() => onOpenPage(detailUrl ?? undefined)}
                  title={detailUrl ?? undefined}
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
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                  <span>{t("downloadModal.openPage")}</span>
                </button>
                {onOpenBrowserResolver && (
                  <button
                    type="button"
                    className="dl-resolver-action-btn secondary"
                    onClick={() =>
                      onOpenBrowserResolver(detailUrl ?? undefined)
                    }
                    title={t("downloadModal.browserResolverDesc")}
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
                    <span>{t("downloadModal.openInBrowserResolver")}</span>
                  </button>
                )}
              </div>
            )
          )}
        </DetailSection>
      )}

      {/* Save location — only meaningful when the app fetches the file. */}
      {!webUrl && (
        <DetailSection title={t("downloadModal.sectionSave")}>
          <SavePathPicker
            savePath={savePath}
            gameName={gameName}
            onPickPath={onPickPath}
          />
        </DetailSection>
      )}

      {/* Download options */}
      <div ref={optionsRef} className="dl-dossier-options-anchor">
        <DetailSection title={t("downloadModal.options")}>
          <OptionsSection
            autoExtract={autoExtract}
            onAutoExtract={onAutoExtract}
            chooseFiles={chooseFiles}
            onChooseFiles={onChooseFiles}
            onSelectFiles={onSelectFiles}
            isFetchingFiles={isFetchingFiles}
            isDirect={isDirect}
            useDebrid={useDebrid}
            onUseDebrid={onUseDebrid}
            debridAvailable={debridAvailable}
            cacheStatus={cacheStatus}
          />
        </DetailSection>
      </div>

      {/* Plugin-provided file list */}
      {fileList.length > 0 && (
        <DetailSection
          title={t("downloadModal.detailFiles")}
          meta={t("downloadModal.fileCount", { count: fileList.length })}
        >
          <div className="dl-file-list">
            {fileList.map((file, idx) => (
              <div className="dl-file-row" key={`${file.name}-${idx}`}>
                <span className="dl-file-name" title={file.name}>
                  {file.name}
                </span>
                <span className="dl-file-size">{formatByteSize(file.size)}</span>
              </div>
            ))}
          </div>
        </DetailSection>
      )}

      {/* Technical details: checksums and raw identifiers, collapsed by default. */}
      {hasTechnical && (
        <div className="dl-dossier-technical">
          <DetailDisclosure
            title={t("downloadModal.detailTechnical")}
            expandLabel={t("common.expand")}
            collapseLabel={t("common.collapse")}
            hint={
              checksums.length > 0
                ? t("downloadModal.checksumCount", { count: checksums.length })
                : null
            }
          >
            {checksums.length > 0 && (
              <section
                className="dl-dossier-subsection"
                aria-labelledby={checksumHeadingId}
              >
                <h4
                  id={checksumHeadingId}
                  className="dl-dossier-subsection-title"
                >
                  {t("downloadModal.detailChecksums")}
                </h4>
                <DetailChecksumList
                  checksums={checksums}
                  copiedKey={copiedKey}
                  onCopy={(value, key) => void copyText(value, key)}
                  copyLabel={t("downloadModal.copyChecksum")}
                  copiedLabel={t("downloadModal.copied")}
                />
              </section>
            )}

            {rawFacts.length > 0 && (
              <section
                className="dl-dossier-subsection"
                aria-labelledby={rawHeadingId}
              >
                <h4 id={rawHeadingId} className="dl-dossier-subsection-title">
                  {t("downloadModal.detailRawMetadata")}
                </h4>
                <DetailFactGrid
                  facts={rawFacts}
                  className="dl-dossier-facts--raw"
                />
              </section>
            )}

            {detailUrl && !webUrl && (
              <button
                type="button"
                className="dl-dossier-link-btn"
                onClick={() => onOpenPage(detailUrl)}
                title={detailUrl}
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
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
                <span>{t("downloadModal.openPage")}</span>
              </button>
            )}
          </DetailDisclosure>
        </div>
      )}
    </aside>
  );
}
