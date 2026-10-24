import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { FileText, FolderOpen, Plus } from "lucide-react";
import { Button } from "../../components/ui";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import type { SaveLocation } from "../../types/saves";

interface AddLocationFormProps {
  gameId: string;
  onAdded: (location: SaveLocation) => void;
  onCancel: () => void;
}

/**
 * Inline "add a save folder or file" form, shared by the hub and the
 * per-game tab. The backend infers `kind` from the path, so the user only
 * needs to point at it.
 */
export default function AddLocationForm({ gameId, onAdded, onCancel }: AddLocationFormProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [path, setPath] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  const browse = async (directory: boolean) => {
    try {
      const picked = await open({ directory, multiple: false, title: t("saves.action.addLocation") });
      if (typeof picked === "string" && picked) setPath(picked);
    } catch {
      /* dialog cancelled or unavailable */
    }
  };

  const submit = async () => {
    const trimmed = path.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const location = await invoke<SaveLocation>("saves_add_location", {
        gameId,
        path: trimmed,
        label: label.trim() || null,
      });
      showToast(t("saves.toast.locationAdded", { name: location.label || trimmed }), "success");
      onAdded(location);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="saves-add" role="group" aria-label={t("saves.locations.addTitle")}>
      <div className="saves-add__row">
        <input
          type="text"
          className="saves-input saves-add__path"
          placeholder={t("saves.add.placeholder")}
          value={path}
          onChange={(event) => setPath(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void submit();
            if (event.key === "Escape") onCancel();
          }}
          aria-label={t("saves.add.placeholder")}
          autoFocus
        />
        <Button
          variant="tertiary"
          size="sm"
          leftIcon={<FolderOpen size={14} />}
          onClick={() => void browse(true)}
          type="button"
        >
          {t("saves.locations.kindFolder")}
        </Button>
        <Button
          variant="tertiary"
          size="sm"
          leftIcon={<FileText size={14} />}
          onClick={() => void browse(false)}
          type="button"
        >
          {t("saves.locations.kindFile")}
        </Button>
      </div>
      <div className="saves-add__row">
        <input
          type="text"
          className="saves-input saves-add__label"
          placeholder={t("saves.locations.labelPlaceholder")}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void submit();
            if (event.key === "Escape") onCancel();
          }}
          aria-label={t("saves.locations.labelPlaceholder")}
        />
        <Button
          variant="primary"
          size="sm"
          leftIcon={<Plus size={14} />}
          onClick={() => void submit()}
          isLoading={busy}
          disabled={!path.trim()}
          type="button"
        >
          {t("saves.action.add")}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel} type="button">
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}
