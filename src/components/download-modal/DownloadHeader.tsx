import { useState } from "react";
import { useLanguage } from "../../context/LanguageContext";
import "../../styles/download-modal-states.css";

export interface StatusChip {
  label: string;
  tone: "muted" | "success" | "accent" | "danger";
}

export interface DownloadHeaderProps {
  gameName: string;
  gameCover?: string | null;
  statusChip: StatusChip;
  resultCount: number;
  searchProgress: { completed: number; total: number } | null;
  onClose: () => void;
  /** Number of enabled search sources. Optional so existing callers keep working. */
  sourceCount?: number;
  /** Overrides the default "Available downloads" identity line. */
  subtitle?: string;
}

type Translate = ReturnType<typeof useLanguage>["t"];

/**
 * Resolve a key that may not exist in the current dictionary yet, falling back
 * to an existing translated key instead of rendering the raw dotted key.
 */
function tOr(t: Translate, key: string, fallbackKey: string, vars?: Record<string, unknown>) {
  const value = t(key, vars);
  return value === key ? t(fallbackKey, vars) : value;
}

/**
 * Modal identity bar: what is being downloaded, how the search is going, and
 * the close control. Compact by design: artwork, a three-line identity block
 * (kicker + game name + availability), and a quiet stats cluster on the right.
 */
export function DownloadHeader({
  gameName,
  gameCover,
  statusChip,
  resultCount,
  searchProgress,
  onClose,
  sourceCount,
  subtitle,
}: DownloadHeaderProps) {
  const { t } = useLanguage();
  const [failedCover, setFailedCover] = useState<string | null>(null);

  const showCover = Boolean(gameCover) && failedCover !== gameCover;
  const effectiveSourceCount = sourceCount ?? searchProgress?.total ?? 0;

  const subtitleText =
    subtitle ?? tOr(t, "downloadModal.availableDownloads", "addDownloadModal.availableFiles");

  const sourceCountKey = "downloadModal.sourceCount";
  const translatedSourceCount =
    effectiveSourceCount > 0
      ? t(sourceCountKey, {
          count: effectiveSourceCount,
          s: effectiveSourceCount !== 1 ? "s" : "",
        })
      : "";
  const sourceCountText =
    effectiveSourceCount > 0 && translatedSourceCount === sourceCountKey
      ? `${effectiveSourceCount} ${t("downloads.sources")}`
      : translatedSourceCount;

  return (
    <div className="dl-modal-header dlm-header">
      <div className="dl-modal-header-game dlm-header-identity">
        {showCover ? (
          <img
            src={gameCover ?? ""}
            alt=""
            className="dl-modal-game-thumb dlm-header-cover"
            draggable={false}
            onError={() => setFailedCover(gameCover ?? null)}
          />
        ) : (
          <div
            className="dl-modal-header-icon-box dlm-header-cover dlm-header-cover--fallback"
            aria-hidden
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </div>
        )}

        <div className="dl-modal-header-titles dlm-header-titles">
          <div className="dlm-header-kicker">
            <span className="dl-modal-eyebrow">{t("downloadButton.download")}</span>
            <span className={`dlm-header-chip dlm-header-chip--${statusChip.tone}`}>
              <span
                className={`dl-modal-status-dot dl-modal-status-dot--${statusChip.tone}`}
                aria-hidden
              />
              <span className="dlm-header-chip-label">{statusChip.label}</span>
            </span>
          </div>

          <h2 className="dl-modal-game-name dlm-header-title" title={gameName}>
            {gameName}
          </h2>

          <p className="dlm-header-subtitle" title={subtitleText}>
            {subtitleText}
          </p>
        </div>
      </div>

      <div className="dlm-header-side">
        <div className="dlm-header-stats">
          {resultCount > 0 && (
            <span className="dlm-header-stat dlm-header-stat--results">
              {t("downloadModal.sourceResults", {
                count: resultCount,
                s: resultCount !== 1 ? "s" : "",
              })}
            </span>
          )}
          {sourceCountText && (
            <span className="dlm-header-stat dlm-header-stat--sources">{sourceCountText}</span>
          )}
        </div>

        <button
          type="button"
          className="dl-modal-close dlm-header-close"
          onClick={onClose}
          aria-label={t("common.close")}
          title={`${t("common.close")} (Esc)`}
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
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {searchProgress && searchProgress.total > 1 && (
        <div
          className="dl-header-progress-line"
          role="progressbar"
          aria-valuenow={searchProgress.completed}
          aria-valuemin={0}
          aria-valuemax={searchProgress.total}
        >
          <div
            className="dl-header-progress-fill"
            style={{
              width: `${Math.max(
                4,
                (searchProgress.completed / searchProgress.total) * 100,
              )}%`,
            }}
          />
        </div>
      )}
    </div>
  );
}
