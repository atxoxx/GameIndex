import { useLanguage } from "../../context/LanguageContext";
import {
  classifyUri,
  hostLabelForUri,
  hosterNeedsBrowser,
  resolveSourceUri,
  webUrlFor,
} from "./helpers";
import type { DisplayMatch, CacheCheckStatus } from "./types";
import { OptionsSection } from "./OptionsSection";
import { SavePathPicker } from "./SavePathPicker";

/**
 * Focused "Download Configuration & Inspector" panel on the right side of the modal.
 * Highlights the selected release, destination path, mirrors, and options.
 */
export function DetailPanel({
  match,
  savePath,
  gameName,
  onPickPath,
  autoExtract,
  onAutoExtract,
  chooseFiles,
  onChooseFiles,
  useDebrid,
  onUseDebrid,
  debridConfigured,
  cacheStatus,
  onOpenPage,
  onOpenBrowserResolver,
  resolverActive,
  resolverPartsCaptured,
}: {
  match: DisplayMatch | null;
  isDownloaded: (title: string) => boolean;
  savePath: string | null;
  gameName: string;
  onPickPath: () => void;
  autoExtract: boolean;
  onAutoExtract: (v: boolean) => void;
  chooseFiles: boolean;
  onChooseFiles: (v: boolean) => void;
  useDebrid: boolean;
  onUseDebrid: (v: boolean) => void;
  debridConfigured: boolean;
  cacheStatus: CacheCheckStatus;
  onOpenPage: (url?: string) => void;
  onOpenBrowserResolver?: (url?: string) => void;
  resolverActive: boolean;
  resolverPartsCaptured: number;
}) {
  const { t } = useLanguage();

  if (!match) {
    return (
      <aside className="dl-detail-inspector" aria-label={t("downloadModal.configHeader")}>
        <div className="dl-detail-empty-state">
          <div className="dl-detail-empty-icon">
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
          <p className="dl-detail-empty-text">{t("downloadModal.detailEmpty")}</p>
        </div>
      </aside>
    );
  }

  const sourceUri = resolveSourceUri(match, 0);
  const { isMagnet, isTorrentFile, isDirect } = classifyUri(sourceUri, match.torrentUrl);
  const webUrl = webUrlFor(match);
  const detailUrl = match.detailUrl && match.detailUrl.trim();
  const showOpenPage = !webUrl && !isDirect && Boolean(detailUrl);
  const debridAvailable = debridConfigured && (isMagnet || isTorrentFile || isDirect);
  const hostLabel = sourceUri ? hostLabelForUri(sourceUri, 0) : null;
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

  return (
    <aside className="dl-detail-inspector" aria-label={t("downloadModal.configHeader")}>
      {/* Panel Header */}
      <div className="dl-detail-top-bar">
        <div className="dl-detail-bar-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="dl-detail-gear-icon" aria-hidden>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <span>{t("downloadModal.configHeader")}</span>
        </div>
        <span className="dl-format-tag">{typeLabel}</span>
      </div>

      {/* Selected Release Spotlight Card */}
      <div className="dl-spotlight-card">
        <div className="dl-spotlight-header">
          <span className="dl-spotlight-source">{match.sourceName}</span>
          <span className={`dl-spotlight-match ${tier}`}>
            {(score * 100).toFixed(0)}% match
          </span>
        </div>
        <h5 className="dl-spotlight-title" title={match.title}>
          {match.title}
        </h5>
        <div className="dl-spotlight-metrics">
          <span className="dl-spotlight-metric">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {match.fileSize || t("downloadModal.unknownSize")}
          </span>
          {match.seeds != null && match.peers != null && (
            <span className="dl-spotlight-metric">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
              </svg>
              {match.seeds} seeds
            </span>
          )}
        </div>
      </div>

      {/* Save Location Section */}
      {!webUrl && (
        <div className="dl-panel-section">
          <div className="dl-panel-section-header">
            <span className="dl-panel-section-title">{t("downloadModal.destinationFolder")}</span>
          </div>
          <SavePathPicker savePath={savePath} gameName={gameName} onPickPath={onPickPath} />
        </div>
      )}

      {/* Options Section */}
      <div className="dl-panel-section">
        <div className="dl-panel-section-header">
          <span className="dl-panel-section-title">{t("downloadModal.options")}</span>
        </div>
        <OptionsSection
          autoExtract={autoExtract}
          onAutoExtract={onAutoExtract}
          chooseFiles={chooseFiles}
          onChooseFiles={onChooseFiles}
          isDirect={isDirect}
          useDebrid={useDebrid}
          onUseDebrid={onUseDebrid}
          debridAvailable={debridAvailable}
          cacheStatus={cacheStatus}
        />
      </div>

      {/* Resolver card for direct hoster links */}
      {isDirect && (
        <div className="dl-panel-section">
          <div className="dl-resolver-banner">
            <div className="dl-resolver-banner-top">
              <div className="dl-resolver-icon-box">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
              </div>
              <div className="dl-resolver-banner-info">
                <span className="dl-resolver-banner-title">{t("downloadModal.resolverTitle")}</span>
                {hostLabel && <span className="dl-resolver-banner-host">{hostLabel}</span>}
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
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
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
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
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
        </div>
      )}

      {/* Web & Browser Solver Cards */}
      {webUrl ? (
        <div className="dl-panel-section">
          <div className="dl-protected-banner">
            <div className="dl-protected-top">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="dl-protected-badge-icon">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              <span className="dl-protected-heading">{t("downloadModal.protectedSourceTitle")}</span>
            </div>
            <p className="dl-protected-desc">{t("downloadModal.protectedSourceDesc")}</p>
            <div className="dl-protected-buttons">
              <button
                type="button"
                className="dl-resolver-action-btn primary"
                onClick={() => onOpenPage(webUrl)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
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
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <circle cx="12" cy="12" r="10" />
                    <line x1="2" y1="12" x2="22" y2="12" />
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                  </svg>
                  <span>{t("downloadModal.openInBrowserResolver")}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        showOpenPage && (
          <div className="dl-panel-section">
            <div className="dl-fallback-actions-card">
              <button
                type="button"
                className="dl-resolver-action-btn secondary"
                onClick={() => onOpenPage(detailUrl ?? undefined)}
                title={detailUrl ?? undefined}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
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
                  onClick={() => onOpenBrowserResolver(detailUrl ?? undefined)}
                  title={t("downloadModal.browserResolverDesc")}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <circle cx="12" cy="12" r="10" />
                    <line x1="2" y1="12" x2="22" y2="12" />
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                  </svg>
                  <span>{t("downloadModal.openInBrowserResolver")}</span>
                </button>
              )}
            </div>
          </div>
        )
      )}
    </aside>
  );
}
