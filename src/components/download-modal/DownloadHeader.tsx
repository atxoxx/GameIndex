import { useLanguage } from "../../context/LanguageContext";

export interface StatusChip {
  label: string;
  tone: "muted" | "success" | "accent" | "danger";
}

/**
 * Modal identity bar: game artwork + name, live flow status, integrated
 * search-progress ribbon, and the close control.
 */
export function DownloadHeader({
  gameName,
  gameCover,
  statusChip,
  resultCount,
  searchProgress,
  onClose,
}: {
  gameName: string;
  gameCover?: string | null;
  statusChip: StatusChip;
  resultCount: number;
  searchProgress: { completed: number; total: number } | null;
  onClose: () => void;
}) {
  const { t } = useLanguage();

  return (
    <div className="dl-modal-header">
      <div className="dl-modal-header-game">
        {gameCover ? (
          <img src={gameCover} alt={gameName} className="dl-modal-game-thumb" />
        ) : (
          <div className="dl-modal-header-icon-box">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </div>
        )}
        <div className="dl-modal-header-titles">
          <h2 className="dl-modal-game-name" title={gameName}>
            {gameName}
          </h2>
          <p className="dl-modal-flow-tag">
            {t("downloadButton.download")}
            {resultCount > 0 &&
              ` · ${t("downloadModal.sourceResults", {
                count: resultCount,
                s: resultCount !== 1 ? "s" : "",
              })}`}
          </p>
        </div>
      </div>

      <div className="dl-modal-header-right">
        <span
          className={`dl-modal-status-badge dl-modal-status-badge--${statusChip.tone}`}
        >
          <span className="dl-modal-status-dot" aria-hidden />
          <span>{statusChip.label}</span>
        </span>

        <button
          type="button"
          className="dl-modal-close-button"
          onClick={onClose}
          aria-label={t("common.close")}
          title={`${t("common.close")} (Esc)`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
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
