import { Check, FolderOpen, Trash2 } from "lucide-react";
import { Button } from "../../components/ui";
import { useLanguage } from "../../context/LanguageContext";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import type { Game } from "../../types/game";
import type { SaveBackup } from "../../types/saves";
import { formatClockTime, formatRelative } from "../../utils/savesTime";
import { SnapshotKindBadge, SnapshotStatusBadge } from "./SavesBadges";
import SavesCover from "./SavesCover";

interface SnapshotRowProps {
  backup: SaveBackup;
  game?: Game | null;
  /** Shows the game column (library-wide timeline) instead of just the snapshot. */
  showGame?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  onOpenDetails: () => void;
  onRestore: () => void;
  onOpenFolder: () => void;
  onDelete: () => void;
}

/**
 * One snapshot line. The body is a button that opens the manifest drawer;
 * destructive and OS actions sit beside it so they never nest inside it.
 */
export default function SnapshotRow({
  backup,
  game,
  showGame = false,
  selectable = false,
  selected = false,
  onToggleSelect,
  onOpenDetails,
  onRestore,
  onOpenFolder,
  onDelete,
}: SnapshotRowProps) {
  const { t, language } = useLanguage();
  const { formatBytes } = useSizeUnit();

  return (
    <li className={["saves-snap", selected ? "is-selected" : ""].filter(Boolean).join(" ")}>
      {selectable && (
        <label className="saves-snap__select" title={t("saves.snapshots.selectOne")}>
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            aria-label={t("saves.snapshots.selectOne", { name: backup.gameName })}
          />
          <span className="saves-snap__check" aria-hidden="true">
            <Check size={11} />
          </span>
        </label>
      )}

      {showGame && <SavesCover game={game} name={backup.gameName} size="sm" />}

      <button type="button" className="saves-snap__main" onClick={onOpenDetails}>
        <span className="saves-snap__top">
          {showGame && <span className="saves-snap__game">{backup.gameName}</span>}
          <SnapshotKindBadge kind={backup.kind} />
          <SnapshotStatusBadge status={backup.status} />
        </span>
        <span className="saves-snap__meta">
          <span className="saves-snap__when">
            {formatRelative(backup.createdAt, language)}
            <span className="saves-snap__clock">
              {formatClockTime(backup.createdAt, language)}
            </span>
          </span>
          <span className="saves-snap__sep" aria-hidden="true">·</span>
          <span>
            {t("saves.backups.meta", {
              files: backup.fileCount,
              size: formatBytes(backup.totalBytes),
            })}
          </span>
        </span>
        {backup.note && <span className="saves-snap__note">“{backup.note}”</span>}
      </button>

      <div className="saves-snap__actions">
        <Button variant="tertiary" size="sm" onClick={onRestore}>
          {t("saves.action.restore")}
        </Button>
        <button
          type="button"
          className="saves-icon-btn"
          onClick={onOpenFolder}
          title={t("saves.action.openBackup")}
          aria-label={t("saves.action.openBackup")}
        >
          <FolderOpen size={15} />
        </button>
        <button
          type="button"
          className="saves-icon-btn saves-icon-btn--danger"
          onClick={onDelete}
          title={t("saves.action.deleteBackup")}
          aria-label={t("saves.action.deleteBackup")}
        >
          <Trash2 size={15} />
        </button>
      </div>
    </li>
  );
}
