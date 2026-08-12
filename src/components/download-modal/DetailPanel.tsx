import { useLanguage } from "../../context/LanguageContext";
import { classifyUri, formatUploadDate, resolveSourceUri } from "./helpers";
import type { DisplayMatch } from "./types";
import { MirrorPicker } from "./MirrorPicker";
import { OptionsSection } from "./OptionsSection";
import { SavePathPicker } from "./SavePathPicker";

/**
 * Persistent detail panel shown to the right of the results list.
 * It always describes the CURRENTLY SELECTED match, so the controls
 * the user is about to commit to (mirrors, options, save path) are
 * visually attached to the exact result they picked — no more
 * hunting for them below a long list of sources.
 *
 * Sections, top to bottom:
 *   1. Selected source — title, NEW/Downloaded badges
 *   2. Meta grid — source, size, upload date, download type, and the
 *      match-confidence tier as a colored indicator + percentage
 *   3. Mirrors — host chips (only when the match has >1 mirror)
 *   4. Options — auto-extract + choose-files toggles
 *   5. Save location — folder picker + nested-game-folder hint
 */
export function DetailPanel({
  match,
  isDownloaded,
  savePath,
  gameName,
  onPickPath,
  selectedMirrorIdx,
  onMirrorChange,
  autoExtract,
  onAutoExtract,
  chooseFiles,
  onChooseFiles,
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
}) {
  const { t, language } = useLanguage();

  if (!match) {
    return (
      <aside className="dl-detail-pane" aria-label={t("downloadModal.detailSelected")}>
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

  const score = match.matchScore;
  const tier = score >= 0.8 ? "high" : score >= 0.4 ? "partial" : "low";
  const tierLabel =
    score >= 0.8
      ? t("downloadModal.matchHigh")
      : score >= 0.4
        ? t("downloadModal.matchPartial")
        : t("downloadModal.matchPossible");

  // The download type derives from the resolved URI for the currently
  // selected mirror — switching mirrors can change it (e.g. a magnet
  // mirror vs a direct-host mirror), so it must reflect the live state.
  const sourceUri = resolveSourceUri(match, selectedMirrorIdx);
  const { isMagnet, isTorrentFile, isDirect } = classifyUri(sourceUri);
  const typeLabel = isMagnet
    ? t("downloadModal.typeMagnet")
    : isTorrentFile
      ? t("downloadModal.typeTorrent")
      : isDirect
        ? t("downloadModal.typeDirect")
        : t("downloadModal.typeUnknown");

  return (
    <aside
      className="dl-detail-pane"
      aria-label={t("downloadModal.detailSelected")}
    >
      <div className="dl-detail-head">
        <span className="dl-detail-kicker">{t("downloadModal.detailSelected")}</span>
        <h3 className="dl-detail-title">
          <span className="dl-detail-title-text">{match.title}</span>
          <span className="dl-detail-badges">
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
        </h3>
      </div>

      <div className="dl-detail-meta">
        <div className="dl-detail-meta-item">
          <span className="dl-detail-meta-label">{t("downloadModal.detailSource")}</span>
          <span className="dl-detail-meta-value">{match.sourceName}</span>
        </div>
        {match.provenance && (
          <div className="dl-detail-meta-item">
            <span className="dl-detail-meta-label">{t("downloadModal.detailOrigin")}</span>
            <span className="dl-detail-meta-value">{match.provenance}</span>
          </div>
        )}
        <div className="dl-detail-meta-item">
          <span className="dl-detail-meta-label">{t("downloadModal.detailSize")}</span>
          <span className="dl-detail-meta-value">
            {match.fileSize || t("downloadModal.unknownSize")}
          </span>
        </div>
        <div className="dl-detail-meta-item">
          <span className="dl-detail-meta-label">{t("downloadModal.detailUploaded")}</span>
          <span className="dl-detail-meta-value">
            {formatUploadDate(match.uploadDate, language)}
          </span>
        </div>
        <div className="dl-detail-meta-item">
          <span className="dl-detail-meta-label">{t("downloadModal.detailType")}</span>
          <span className="dl-type-chip">{typeLabel}</span>
        </div>
        <div className="dl-detail-meta-item dl-detail-meta-item--full">
          <span className="dl-detail-meta-label">{t("downloadModal.detailConfidence")}</span>
          <span className={`dl-tier dl-tier--${tier}`}>
            <span className="dl-tier-dot" aria-hidden />
            {tierLabel} · {(score * 100).toFixed(0)}%
          </span>
        </div>
      </div>

      {match.uris.length > 1 && (
        <div className="dl-detail-section">
          <span className="dl-detail-section-title">{t("downloadModal.sectionMirrors")}</span>
          <MirrorPicker
            uris={match.uris}
            selectedMirrorIdx={selectedMirrorIdx}
            onChange={onMirrorChange}
          />
        </div>
      )}

      <div className="dl-detail-section">
        <span className="dl-detail-section-title">{t("downloadModal.options")}</span>
        <OptionsSection
          autoExtract={autoExtract}
          onAutoExtract={onAutoExtract}
          chooseFiles={chooseFiles}
          onChooseFiles={onChooseFiles}
          isDirect={isDirect}
        />
      </div>

      <div className="dl-detail-section">
        <span className="dl-detail-section-title">{t("downloadModal.sectionSave")}</span>
        <SavePathPicker savePath={savePath} gameName={gameName} onPickPath={onPickPath} />
      </div>
    </aside>
  );
}
