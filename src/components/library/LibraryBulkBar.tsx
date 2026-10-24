import { createPortal } from "react-dom";
import { Trash2, X } from "lucide-react";
import ContextMenu, { type ContextMenuItem } from "../ui/ContextMenu";
import { useContextMenu } from "../../hooks/useContextMenu";
import { useLanguage } from "../../context/LanguageContext";
import { PLAY_STATUS_DETAILS, type PlayStatus } from "../../types/game";

interface LibraryBulkBarProps {
  selectedCount: number;
  totalCount: number;
  onSelectAll: () => void;
  onClear: () => void;
  onSetPlayStatus: (status: PlayStatus) => void;
  onRemoveSelected: () => void;
  onExit: () => void;
}

const STATUS_ORDER: PlayStatus[] = ["playing", "completed", "backlog", "on_hold", "abandoned"];

/**
 * LibraryBulkBar — the floating action bar for a multi-game selection.
 *
 * One status menu instead of five buttons keeps the bar to three clusters:
 * selection on the left, actions in the middle, dismiss on the right.
 */
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
  const statusMenu = useContextMenu();
  const allSelected = selectedCount > 0 && selectedCount === totalCount;
  const disabled = selectedCount === 0;

  const statusItems: ContextMenuItem[] = STATUS_ORDER.map((status) => ({
    id: status,
    label: t(PLAY_STATUS_DETAILS[status].labelKey),
    swatch: PLAY_STATUS_DETAILS[status].color,
    onSelect: () => {
      statusMenu.close();
      onSetPlayStatus(status);
    },
  }));

  return createPortal(
    <div className="library-bulk" role="toolbar" aria-label={t("library.bulk.selectedCount", { count: selectedCount })}>
      <div className="library-bulk-left">
        <span className="library-bulk-badge">
          {t("library.bulk.selectedCount", { count: selectedCount })}
        </span>
        <button type="button" className="library-bulk-ghost" onClick={allSelected ? onClear : onSelectAll}>
          {allSelected ? t("library.bulk.clearSelection") : t("library.bulk.selectAll")}
        </button>
      </div>

      <div className="library-bulk-center">
        <button
          type="button"
          className="library-bulk-btn"
          disabled={disabled}
          onClick={(event) => statusMenu.open(event)}
          aria-haspopup="menu"
          aria-expanded={statusMenu.state !== null}
        >
          {t("library.context.markStatus")}
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        <button
          type="button"
          className="library-bulk-btn library-bulk-btn--danger"
          disabled={disabled}
          onClick={onRemoveSelected}
        >
          <Trash2 size={13} aria-hidden="true" />
          <span>{t("game.remove")}</span>
        </button>
      </div>

      <div className="library-bulk-right">
        <button
          type="button"
          className="library-bulk-close"
          onClick={onExit}
          aria-label={t("common.close")}
          title={t("common.close")}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      {statusMenu.state && (
        <ContextMenu
          x={statusMenu.state.x}
          y={statusMenu.state.y}
          items={statusItems}
          onClose={statusMenu.close}
          ariaLabel={t("library.context.markStatus")}
        />
      )}
    </div>,
    document.body
  );
}
