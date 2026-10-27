import { useCallback, useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import { open as tauriOpen } from "@tauri-apps/plugin-dialog";
import { useLanguage } from "../../../context/LanguageContext";
import { useToast } from "../../../context/ToastContext";
import { Button } from "../../../components/ui";

interface AddFolderModalProps {
  isAdding: boolean;
  onCancel: () => void;
  onConfirm: (name: string, folderPath: string) => void;
}

/** Name + pick a folder for a custom capture source. */
export function AddFolderModal({ isAdding, onCancel, onConfirm }: AddFolderModalProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [name, setName] = useState("");
  const [folderPath, setFolderPath] = useState("");
  const [picking, setPicking] = useState(false);

  const canConfirm = name.trim().length > 0 && folderPath.length > 0 && !isAdding;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const pickFolder = useCallback(async () => {
    try {
      setPicking(true);
      const chosen = await tauriOpen({
        directory: true,
        multiple: false,
        title: t("communityExtras.selectFolder"),
      });
      if (typeof chosen === "string" && chosen.length > 0) setFolderPath(chosen);
    } catch (error) {
      console.error("[Gallery] Folder pick failed:", error);
      showToast(t("community.scanFailed"), "error");
    } finally {
      setPicking(false);
    }
  }, [showToast, t]);

  return (
    <div className="gallery-modal-overlay" onClick={onCancel}>
      <div
        className="gallery-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("community.addCustomFolder")}
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="gallery-modal__title">{t("community.addCustomFolder")}</h3>

        <label className="gallery-modal__field">
          <span>{t("community.customFolderName")}</span>
          <input
            type="text"
            className="gallery-modal__input"
            value={name}
            placeholder={t("community.customFolderName")}
            autoFocus
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && canConfirm) onConfirm(name, folderPath);
            }}
          />
        </label>

        <div className="gallery-modal__path">
          <span className="gallery-modal__path-value" title={folderPath}>
            {folderPath ? folderPath.split(/[\\/]/).pop() || folderPath : t("community.noFolderSelected")}
          </span>
          <Button
            variant="secondary"
            type="button"
            onClick={pickFolder}
            disabled={picking}
            leftIcon={<FolderOpen size={14} />}
          >
            {t("community.pickCustomFolder")}
          </Button>
        </div>

        <div className="gallery-modal__actions">
          <Button variant="secondary" type="button" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            type="button"
            onClick={() => onConfirm(name, folderPath)}
            disabled={!canConfirm}
          >
            {isAdding ? t("community.scanning") : t("common.add")}
          </Button>
        </div>
      </div>
    </div>
  );
}
