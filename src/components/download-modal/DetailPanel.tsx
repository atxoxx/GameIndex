import { useLanguage } from "../../context/LanguageContext";
import { classifyUri, resolveSourceUri, webUrlFor } from "./helpers";
import type { DisplayMatch } from "./types";
import { MirrorPicker } from "./MirrorPicker";
import { OptionsSection } from "./OptionsSection";
import { SavePathPicker } from "./SavePathPicker";

/**
 * Focused "Download Configuration" panel on the right side of the modal.
 * Eliminates redundant repetition of metadata and focuses on actionable
 * controls: Save Location, Options, Mirrors, and Resolver actions.
 */
export function DetailPanel({
  match,
  savePath,
  gameName,
  onPickPath,
  selectedMirrorIdx,
  onMirrorChange,
  autoExtract,
  onAutoExtract,
  chooseFiles,
  onChooseFiles,
  useDebrid,
  onUseDebrid,
  debridConfigured,
  onOpenPage,
  onOpenBrowserResolver,
}: {
  match: DisplayMatch | null;
  isDownloaded: (title: string) => boolean;
  savePath: string | null;
  gameName: string;
  onPickPath: () => void;
  selectedMirrorIdx: number;
  onMirrorChange: (idx: number) => void;
  autoExtract: boolean;
  onAutoExtract: (v: boolean) => void;
  chooseFiles: boolean;
  onChooseFiles: (v: boolean) => void;
  useDebrid: boolean;
  onUseDebrid: (v: boolean) => void;
  debridConfigured: boolean;
  /** Open the result's source page in the default OS browser. */
  onOpenPage: (url?: string) => void;
  /** Open the in-app browser resolver to solve CAPTCHAs/timers & intercept download. */
  onOpenBrowserResolver?: (url?: string) => void;
}) {
  const { t } = useLanguage();

  if (!match) {
    return (
      <aside className="dl-detail-pane" aria-label={t("downloadModal.configHeader")}>
        <div className="dl-detail-empty">
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
          <p>{t("downloadModal.detailEmpty")}</p>
        </div>
      </aside>
    );
  }

  const sourceUri = resolveSourceUri(match, selectedMirrorIdx);
  const { isMagnet, isTorrentFile, isDirect } = classifyUri(sourceUri, match.torrentUrl);
  const webUrl = webUrlFor(match);
  const detailUrl = match.detailUrl && match.detailUrl.trim();
  const showOpenPage = !webUrl && Boolean(detailUrl);
  const debridAvailable = debridConfigured && (isMagnet || isTorrentFile);

  const typeLabel = webUrl
    ? t("downloadModal.typeWeb")
    : isMagnet
      ? t("downloadModal.typeMagnet")
      : isTorrentFile
        ? t("downloadModal.typeTorrent")
        : isDirect
          ? t("downloadModal.typeDirect")
          : t("downloadModal.typeUnknown");

  return (
    <aside className="dl-detail-pane" aria-label={t("downloadModal.configHeader")}>
      {/* Panel Header */}
      <div className="dl-detail-header">
        <div className="dl-detail-header-left">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="dl-detail-header-icon" aria-hidden>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <span className="dl-detail-header-title">{t("downloadModal.configHeader")}</span>
        </div>
        <div className="dl-detail-header-tags">
          <span className="dl-type-chip">{typeLabel}</span>
        </div>
      </div>

      {/* Save Location Section */}
      {!webUrl && (
        <div className="dl-detail-section">
          <div className="dl-section-label-row">
            <span className="dl-detail-section-title">{t("downloadModal.destinationFolder")}</span>
          </div>
          <SavePathPicker savePath={savePath} gameName={gameName} onPickPath={onPickPath} />
        </div>
      )}

      {/* Mirrors Section (if multiple mirrors exist) */}
      {match.uris.length > 1 && (
        <div className="dl-detail-section">
          <div className="dl-section-label-row">
            <span className="dl-detail-section-title">{t("downloadModal.sectionMirrors")}</span>
            <span className="dl-section-count-badge">{match.uris.length}</span>
          </div>
          <MirrorPicker
            uris={match.uris}
            selectedMirrorIdx={selectedMirrorIdx}
            onChange={onMirrorChange}
          />
        </div>
      )}

      {/* Options Section */}
      <div className="dl-detail-section">
        <div className="dl-section-label-row">
          <span className="dl-detail-section-title">{t("downloadModal.options")}</span>
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
        />
      </div>

      {/* Web & Browser Solver Cards */}
      {webUrl ? (
        <div className="dl-detail-section dl-detail-protected-section">
          <div className="dl-protected-card">
            <div className="dl-protected-header">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="dl-protected-icon">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              <span className="dl-protected-title">{t("downloadModal.protectedSourceTitle")}</span>
            </div>
            <p className="dl-detail-web-hint">{t("downloadModal.protectedSourceDesc")}</p>
            <div className="dl-detail-web-actions">
              <button
                type="button"
                className="dl-btn-browser-solve"
                onClick={() => onOpenPage(webUrl)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
                <span>{t("downloadModal.openInBrowser")}</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        showOpenPage && (
          <div className="dl-detail-fallback-actions">
            <button
              type="button"
              className="dl-detail-open-page"
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
                className="dl-detail-open-page dl-detail-open-page--resolver"
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
        )
      )}
    </aside>
  );
}

