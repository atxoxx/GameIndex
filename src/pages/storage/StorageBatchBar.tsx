import { useMemo } from "react";
import type { Game } from "../../types/game";
import { formatSize } from "../../types/game";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { useLanguage } from "../../context/LanguageContext";
import { Button } from "../../components/ui";
import { gameTotalBytes } from "./utils";

interface Props {
  selectedGames: Game[];
  onSelectAll: () => void;
  onInvertSelection: () => void;
  onSelectStale: () => void;
  onSelectMissing: () => void;
  onClearSelection: () => void;
  onExitSelectMode: () => void;
  onMove: (games: Game[]) => void;
  onUninstall: (games: Game[]) => void;
  onRemeasure: () => void;
  isRemeasuring?: boolean;
}

export function StorageBatchBar({
  selectedGames,
  onSelectAll,
  onInvertSelection,
  onSelectStale,
  onSelectMissing,
  onClearSelection,
  onExitSelectMode,
  onMove,
  onUninstall,
  onRemeasure,
  isRemeasuring = false,
}: Props) {
  const { t } = useLanguage();
  const { unit } = useSizeUnit();

  const selectedBytes = useMemo(() => {
    return selectedGames.reduce((sum, g) => sum + gameTotalBytes(g), 0);
  }, [selectedGames]);

  const hasSelection = selectedGames.length > 0;

  return (
    <div className="storage-floating-batch-bar" role="toolbar" aria-label={t("storage.batchActions")}>
      <div className="storage-batch-summary">
        <span className="storage-batch-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 11 12 14 22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
        </span>
        <span className="storage-batch-count">
          {t("storage.selected", { count: selectedGames.length })}
        </span>
        {selectedBytes > 0 && (
          <span className="storage-batch-size">
            {`(${formatSize(selectedBytes, unit)})`}
          </span>
        )}
      </div>

      {/* Select helper buttons */}
      <div className="storage-batch-selectors">
        <Button variant="ghost" size="sm" onClick={onSelectAll}>
          {t("storage.selectAll")}
        </Button>
        <Button variant="ghost" size="sm" onClick={onInvertSelection}>
          {t("storage.batch.invert")}
        </Button>
        <Button variant="ghost" size="sm" onClick={onSelectMissing}>
          {t("storage.batch.selectMissing")}
        </Button>
        <Button variant="ghost" size="sm" onClick={onSelectStale}>
          {t("storage.batch.selectStale")}
        </Button>
        <Button variant="ghost" size="sm" onClick={onClearSelection} disabled={!hasSelection}>
          {t("common.clear")}
        </Button>
      </div>

      {/* Action buttons */}
      <div className="storage-batch-actions">
        <Button
          variant="primary"
          size="sm"
          onClick={() => onMove(selectedGames)}
          disabled={!hasSelection}
          leftIcon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7h13l-3-3" />
              <path d="M21 17H8l3 3" />
            </svg>
          }
        >
          {t("storage.move")}
        </Button>

        <Button
          variant="danger"
          size="sm"
          onClick={() => onUninstall(selectedGames)}
          disabled={!hasSelection}
          leftIcon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          }
        >
          {t("storage.uninstall")}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={onRemeasure}
          disabled={!hasSelection || isRemeasuring}
          isLoading={isRemeasuring}
        >
          {t("storage.remeasure")}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={onExitSelectMode}
          title={t("store.bulk.exit")}
        >
          {t("common.close")}
        </Button>
      </div>
    </div>
  );
}
