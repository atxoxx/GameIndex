import { useState } from "react";
import { useDownloads } from "../../context/DownloadContext";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
import { Button } from "../ui";

interface DownloadsToolbarProps {
  activeCount: number;
  historyCount: number;
  selectedCount?: number;
  totalVisibleCount?: number;
  onSelectAll?: () => void;
  onDeselectAll?: () => void;
  onPauseSelected?: () => void;
  onResumeSelected?: () => void;
  onRemoveSelected?: () => void;
  onDeleteSelected?: () => void;
  onOpenStats?: () => void;
}

export default function DownloadsToolbar({
  activeCount,
  historyCount,
  selectedCount = 0,
  totalVisibleCount = 0,
  onSelectAll,
  onDeselectAll,
  onPauseSelected,
  onResumeSelected,
  onRemoveSelected,
  onDeleteSelected,
  onOpenStats,
}: DownloadsToolbarProps) {

  const { pauseAll, resumeAll, removeDownload, completedDownloads } = useDownloads();
  const { showToast } = useToast();
  const { t } = useLanguage();
  const [busy, setBusy] = useState<"pause" | "resume" | "clear" | null>(null);

  async function handlePauseAll() {
    if (busy) return;
    setBusy("pause");
    try {
      const n = await pauseAll();
      showToast(n > 0 ? t("downloadsToolbar.paused", { count: n, s: n !== 1 ? "s" : "" }) : t("downloadsToolbar.nothingToPause"), "info");
    } catch (err) {
      showToast(t("downloadsToolbar.pauseAllFailed", { error: String(err) }), "error");
    } finally {
      setBusy(null);
    }
  }

  async function handleResumeAll() {
    if (busy) return;
    setBusy("resume");
    try {
      const n = await resumeAll();
      showToast(n > 0 ? t("downloadsToolbar.resumed", { count: n, s: n !== 1 ? "s" : "" }) : t("downloadsToolbar.nothingToResume"), "info");
    } catch (err) {
      showToast(t("downloadsToolbar.resumeAllFailed", { error: String(err) }), "error");
    } finally {
      setBusy(null);
    }
  }

  async function handleClearHistory() {
    if (busy) return;
    setBusy("clear");
    const ids = completedDownloads.map((d) => d.id);
    if (ids.length === 0) {
      setBusy(null);
      return;
    }
    let success = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        await removeDownload(id, false);
        success++;
      } catch {
        failed++;
      }
    }
    if (failed === 0) {
      showToast(t("downloadsToolbar.clearedFromHistory", { count: success }), "info");
    } else {
      showToast(t("downloadsToolbar.clearedFailed", { success, failed }), "error");
    }
    setBusy(null);
  }

  const isSelectionActive = selectedCount > 0;

  return (
    <div className={`dl-toolbar${isSelectionActive ? " dl-toolbar--selected" : ""}`} role="toolbar" aria-label={t("downloadsToolbar.bulkActions")}>
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
          <Button
            variant="secondary"
            size="sm"
            onClick={handlePauseAll}
            disabled={busy !== null || activeCount === 0}
            isLoading={busy === "pause"}
            leftIcon={
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden style={{ width: 12, height: 12 }}>
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
            }
            title={t("downloadsToolbar.pauseAll")}
          >
            {t("downloadsToolbar.pauseAllBtn")}
          </Button>

          <Button
            variant="secondary"
            size="sm"
            onClick={handleResumeAll}
            disabled={busy !== null || activeCount === 0}
            isLoading={busy === "resume"}
            leftIcon={
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden style={{ width: 12, height: 12 }}>
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            }
            title={t("downloadsToolbar.resumeAll")}
          >
            {t("downloadsToolbar.resumeAllBtn")}
          </Button>

          {onSelectAll && totalVisibleCount > 0 && (
            <Button variant="ghost" size="sm" onClick={onSelectAll}>
              {t("downloadFiles.selectAll") || "Select All"}
            </Button>
          )}
        </div>
      )}

      <div className="dl-toolbar-spacer" />

      {onOpenStats && (
        <Button
          variant="secondary"
          size="sm"
          onClick={onOpenStats}
          leftIcon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ width: 13, height: 13 }}>
              <line x1="18" y1="20" x2="18" y2="10" />
              <line x1="12" y1="20" x2="12" y2="4" />
              <line x1="6" y1="20" x2="6" y2="14" />
            </svg>
          }
          title={t("downloadStats.title")}
        >
          {t("downloadStats.buttonLabel")}
        </Button>
      )}

      <Button
        variant="ghost"
        size="sm"
        onClick={handleClearHistory}
        disabled={busy !== null || historyCount === 0}
        isLoading={busy === "clear"}
        leftIcon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ width: 13, height: 13 }}>
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
          </svg>
        }
        title={t("downloadsToolbar.clearHint")}
      >
        {t("downloadsToolbar.clearHistory")}
        {historyCount > 0 && (
          <span className="dl-toolbar-count">{historyCount}</span>
        )}
      </Button>
    </div>
  );
}

