import { memo } from "react";
import { useLanguage } from "../../context/LanguageContext";
import { PLAY_STATUS_DETAILS, type PlayStatus } from "../../types/game";
import type { SidebarBulkActionBarProps } from "./types";

const STATUS_OPTIONS: PlayStatus[] = ["backlog", "playing", "completed", "on_hold", "abandoned"];

/**
 * Compact play-status select button used by the bulk action bar.
 */
function PlayStatusMenuButton({
  onSelect,
  ariaLabel,
}: {
  onSelect: (s: PlayStatus) => void;
  ariaLabel: string;
}) {
  const { t } = useLanguage();

  return (
    <select
      className="sidebar-bulk-action-bar__btn"
      onChange={(e) => {
        const v = e.target.value as PlayStatus;
        if (v) onSelect(v);
        e.currentTarget.value = "";
      }}
      aria-label={ariaLabel}
      defaultValue=""
    >
      <option value="" disabled>
        {t("sidebar.statusPlaceholder")}
      </option>
      {STATUS_OPTIONS.map((s) => (
        <option key={s} value={s}>
          {t(PLAY_STATUS_DETAILS[s].labelKey)}
        </option>
      ))}
    </select>
  );
}

/**
 * SidebarBulkActionBar
 * ────────────────────
 * Floating bar docked at the bottom of the sidebar list when games are multi-selected.
 * Provides fast batch actions: Pin/Unpin, Set Status, Remove, Select All, Cancel.
 */
function SidebarBulkActionBarBase({
  count,
  totalVisible,
  allPinned,
  allSelected,
  onSelectAll,
  onPin,
  onUnpin,
  onSetStatus,
  onRemove,
  onCancel,
}: SidebarBulkActionBarProps) {
  const { t } = useLanguage();

  return (
    <div
      className="sidebar-bulk-action-bar"
      role="region"
      aria-label={t("sidebar.bulkActionsFor", { count })}
    >
      <div className="sidebar-bulk-action-bar__count" aria-live="polite">
        <span>
          {totalVisible
            ? `${count} / ${totalVisible}`
            : t("storage.selected", { count })}
        </span>
      </div>
      <div className="sidebar-bulk-action-bar__actions">
        <button
          type="button"
          className="sidebar-bulk-action-bar__btn"
          onClick={onSelectAll}
          title={allSelected ? t("sidebar.cancelSelectionShort") : t("sidebar.selectAll")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="9 11 12 14 22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
          <span>{allSelected ? t("sidebar.cancelSelectionShort") : t("sidebar.selectAll")}</span>
        </button>

        <button
          type="button"
          className="sidebar-bulk-action-bar__btn"
          onClick={allPinned ? onUnpin : onPin}
          title={allPinned ? t("sidebar.unpinSelected") : t("sidebar.pinSelected")}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2 9 9 2 9.5l5.5 4.5L5 22l7-4 7 4-2.5-8 5.5-4.5L15 9z" />
          </svg>
          <span>{allPinned ? t("sidebar.unpin") : t("sidebar.pin")}</span>
        </button>

        <PlayStatusMenuButton
          onSelect={(s) => onSetStatus(s)}
          ariaLabel={t("sidebar.setPlayStatus")}
        />

        <button
          type="button"
          className="sidebar-bulk-action-bar__btn sidebar-bulk-action-bar__btn--danger"
          onClick={onRemove}
          title={t("sidebar.removeFromLibrary")}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
          <span>{t("sidebar.remove")}</span>
        </button>

        <button
          type="button"
          className="sidebar-bulk-action-bar__btn"
          onClick={onCancel}
          title={t("sidebar.cancelSelection")}
          aria-label={t("sidebar.cancelSelectionShort")}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export const SidebarBulkActionBar = memo(SidebarBulkActionBarBase);
export default SidebarBulkActionBar;
