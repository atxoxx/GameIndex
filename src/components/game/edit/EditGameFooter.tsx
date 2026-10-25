import { Button } from "../../ui";
import { useEditGame } from "./EditGameContext";

export function EditGameFooter({ onRequestClose }: { onRequestClose: () => void }) {
  const { t, isDirty, dirtyCount, saveEdits } = useEditGame();

  return (
    <footer className="edit-footer modal-footer">
      <div className="edit-footer-status" aria-live="polite">
        <span className={`edit-footer-dot${isDirty ? " is-dirty" : ""}`} aria-hidden="true" />
        <span>
          {isDirty
            ? dirtyCount === 1
              ? t("edit.unsavedOne")
              : t("edit.unsavedCount", { count: dirtyCount })
            : t("edit.noChanges")}
        </span>
        {isDirty && <span className="edit-footer-hint">{t("edit.saveHint")}</span>}
      </div>
      <div className="edit-footer-actions">
        <Button variant="secondary" onClick={onRequestClose}>
          {isDirty ? t("common.cancel") : t("common.close")}
        </Button>
        <Button
          variant="primary"
          onClick={saveEdits}
          disabled={!isDirty}
          title={!isDirty ? t("edit.noChangesToSave") : undefined}
        >
          {t("edit.saveChanges")}
        </Button>
      </div>
    </footer>
  );
}
