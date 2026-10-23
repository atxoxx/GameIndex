import { useLanguage } from "../../context/LanguageContext";

export interface StatusChip {
  label: string;
  tone: "muted" | "success" | "accent" | "danger";
}

/**
 * Modal identity bar: what is being downloaded, how the search is going, and
 * the close control. Deliberately three lines of text at most — the old header
 * split the same information between a flow tag and a detached status pill.
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
          <img src={gameCover} alt="" className="dl-modal-game-thumb" />
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
          <span className="dl-modal-eyebrow">{t("downloadButton.download")}</span>
          <h2 className="dl-modal-game-name" title={gameName}>
            {gameName}
          </h2>
          <p className="dl-modal-flow-tag">
            <span
              className={`dl-modal-status-dot dl-modal-status-dot--${statusChip.tone}`}
              aria-hidden
            />
            <span className="dl-modal-flow-state">{statusChip.label}</span>
            {resultCount > 0 && (
              <>
                <span className="dl-modal-flow-sep" aria-hidden>·</span>
                <span>
                  {t("downloadModal.sourceResults", {
                    count: resultCount,
                    s: resultCount !== 1 ? "s" : "",
                  })}
                </span>
              </>
            )}
          </p>
        </div>
      </div>

      <div className="dl-modal-header-right">
        <button
          type="button"
          className="dl-modal-close"
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
