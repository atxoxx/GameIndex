import { useLanguage } from "../../context/LanguageContext";
import type { PlayStatus } from "../../types/game";

interface LibraryBulkBarProps {
  selectedCount: number;
  totalCount: number;
  onSelectAll: () => void;
  onClear: () => void;
  onSetPlayStatus: (status: PlayStatus) => void;
  onRemoveSelected: () => void;
  onExit: () => void;
}

export default function LibraryBulkBar({
  selectedCount,
  totalCount,
  onSelectAll,
  onClear,
  onSetPlayStatus,
  onRemoveSelected,
  onExit,
}: LibraryBulkBarProps) {
  const { t } = useLanguage();
  const allSelected = selectedCount > 0 && selectedCount === totalCount;

  return (
    <div className="lib-bulk-bar" role="toolbar" aria-label="Library bulk actions">
      <div className="lib-bulk-bar-left">
        <span className="lib-bulk-badge">
          {t("library.bulk.selectedCount", { count: selectedCount })}
        </span>

        <button
          type="button"
          className="lib-bulk-btn ghost"
          onClick={allSelected ? onClear : onSelectAll}
        >
          {allSelected ? t("library.bulk.clearSelection") : t("library.bulk.selectAll")}
        </button>
      </div>

      <div className="lib-bulk-bar-center">
        {/* Play Status Quick Actions */}
        <button
          type="button"
          className="lib-bulk-btn"
          disabled={selectedCount === 0}
          onClick={() => onSetPlayStatus("playing")}
          title={t("library.bulk.markPlaying")}
        >
          <span className="lib-bulk-dot lib-bulk-dot--playing" />
          <span>{t("game.status.playing")}</span>
        </button>

        <button
          type="button"
          className="lib-bulk-btn"
          disabled={selectedCount === 0}
          onClick={() => onSetPlayStatus("completed")}
          title={t("library.bulk.markCompleted")}
        >
          <span className="lib-bulk-dot lib-bulk-dot--completed" />
          <span>{t("game.status.completed")}</span>
        </button>

        <button
          type="button"
          className="lib-bulk-btn"
          disabled={selectedCount === 0}
          onClick={() => onSetPlayStatus("backlog")}
          title={t("library.bulk.markBacklog")}
        >
          <span className="lib-bulk-dot lib-bulk-dot--backlog" />
          <span>{t("game.status.backlog")}</span>
        </button>

        <button
          type="button"
          className="lib-bulk-btn"
          disabled={selectedCount === 0}
          onClick={() => onSetPlayStatus("on_hold")}
          title={t("library.bulk.markOnHold")}
        >
          <span className="lib-bulk-dot lib-bulk-dot--on_hold" />
          <span>{t("game.status.onHold")}</span>
        </button>

        <button
          type="button"
          className="lib-bulk-btn danger"
          disabled={selectedCount === 0}
          onClick={onRemoveSelected}
          title={t("library.bulk.removeSelected")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
          <span>{t("game.remove")}</span>
        </button>
      </div>

      <div className="lib-bulk-bar-right">
        <button
          type="button"
          className="lib-bulk-btn close"
          onClick={onExit}
          aria-label={t("common.close")}
          title={t("common.close")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
