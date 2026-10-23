import { useLanguage } from "../../context/LanguageContext";
import { Button } from "../ui";

interface DownloadsToolbarProps {
  selectedCount?: number;
  totalVisibleCount?: number;
  onSelectAll?: () => void;
  onDeselectAll?: () => void;
  onPauseSelected?: () => void;
  onResumeSelected?: () => void;
  onRemoveSelected?: () => void;
  onDeleteSelected?: () => void;
}

/**
 * The list's action strip: a quiet "select all" at rest, and the bulk actions
 * once a selection exists. Transfer-wide controls (pause/resume/retry all)
 * live in the band above, so this stays scoped to what is selected.
 */
export default function DownloadsToolbar({
  selectedCount = 0,
  totalVisibleCount = 0,
  onSelectAll,
  onDeselectAll,
  onPauseSelected,
  onResumeSelected,
  onRemoveSelected,
  onDeleteSelected,
}: DownloadsToolbarProps) {
  const { t } = useLanguage();
  const isSelectionActive = selectedCount > 0;

  if (!isSelectionActive && totalVisibleCount === 0) return null;

  return (
    <div
      className={`dl-toolbar${isSelectionActive ? " dl-toolbar--selected" : ""}`}
      role="toolbar"
      aria-label={t("downloadsToolbar.bulkActions")}
    >
      {isSelectionActive ? (
        <div className="dl-toolbar-selection-group">
          <span className="dl-toolbar-selection-label">
            {t("downloads.itemsSelected", { count: selectedCount }) || `${selectedCount} selected`}
          </span>

          {onDeselectAll && (
            <Button variant="ghost" size="sm" onClick={onDeselectAll}>
              {t("common.clear") || "Clear"}
            </Button>
          )}

          {onPauseSelected && (
            <Button variant="secondary" size="sm" onClick={onPauseSelected}>
              {t("downloadRow.pause")}
            </Button>
          )}

          {onResumeSelected && (
            <Button variant="secondary" size="sm" onClick={onResumeSelected}>
              {t("downloadRow.resume")}
            </Button>
          )}

          {onRemoveSelected && (
            <Button variant="secondary" size="sm" onClick={onRemoveSelected}>
              {t("common.remove")}
            </Button>
          )}

          {onDeleteSelected && (
            <Button variant="danger" size="sm" onClick={onDeleteSelected}>
              {t("downloadRow.deleteFromDisk")}
            </Button>
          )}
        </div>
      ) : (
        <div className="dl-toolbar-group">
          {onSelectAll && totalVisibleCount > 0 && (
            <Button variant="ghost" size="sm" onClick={onSelectAll}>
              {t("downloadFiles.selectAll") || "Select All"}
            </Button>
          )}
        </div>
      )}

      <div className="dl-toolbar-spacer" />
    </div>
  );
}
