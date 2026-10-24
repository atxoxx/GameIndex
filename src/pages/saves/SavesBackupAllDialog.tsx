import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Zap } from "lucide-react";
import { Button } from "../../components/ui";
import { useLanguage } from "../../context/LanguageContext";
import SavesCover from "./SavesCover";
import type { TrackedSaveGame } from "./savesData";

interface SavesBackupAllDialogProps {
  open: boolean;
  entries: TrackedSaveGame[];
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Games listed by name before the count rolls up into "+N more". */
const VISIBLE_ROWS = 8;

/**
 * Non-destructive confirmation for "Back up all".
 *
 * Deliberately not the shared destructive `ConfirmModal`: this action writes
 * snapshots rather than deleting anything, so a red danger dialog would send
 * the wrong signal. It previews exactly which games are about to be captured.
 */
export default function SavesBackupAllDialog({
  open,
  entries,
  busy,
  onConfirm,
  onCancel,
}: SavesBackupAllDialogProps) {
  const { t } = useLanguage();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => cancelRef.current?.focus(), 40);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  const visible = entries.slice(0, VISIBLE_ROWS);
  const hidden = entries.length - visible.length;

  return createPortal(
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={busy ? undefined : onCancel}
    >
      <div
        className="modal saves-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="saves-backup-all-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="saves-dialog__head">
          <span className="saves-dialog__icon" aria-hidden="true">
            <Zap size={18} />
          </span>
          <div>
            <h2 className="saves-dialog__title" id="saves-backup-all-title">
              {t("saves.confirm.backupAllTitle", { count: entries.length })}
            </h2>
            <p className="saves-dialog__text">{t("saves.confirm.backupAllMessage")}</p>
          </div>
        </div>

        <ul className="saves-dialog__list">
          {visible.map((entry) => (
            <li key={entry.gameId} className="saves-dialog__row">
              <SavesCover game={entry.game} name={entry.name} size="sm" />
              <span className="saves-dialog__name">{entry.name}</span>
              <span className="saves-dialog__meta">
                {t("saves.game.locations", { count: entry.includedLocations.length })}
              </span>
            </li>
          ))}
        </ul>
        {hidden > 0 && (
          <p className="saves-dialog__more">{t("saves.confirm.backupAllMore", { count: hidden })}</p>
        )}

        <div className="saves-dialog__footer">
          <Button ref={cancelRef} variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            leftIcon={<Zap size={14} />}
            onClick={onConfirm}
            isLoading={busy}
          >
            {t("saves.action.backupAll")}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
