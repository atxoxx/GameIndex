import { useMemo, useState, useEffect, useCallback } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, Copy, FolderOpen, Info, Trash2 } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { Button } from "../ui";
import { ENGINE_LABELS, type GameMod, type ModConflict, type ModEngine } from "../../types/mods";
import ModConflictVisualizer from "./ModConflictVisualizer";
import ModFileInspector from "./ModFileInspector";
import { sourceLabel } from "./discover/format";

function formatModSize(bytes?: number): string {
  if (bytes == null || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

interface ModDetailPaneProps {
  selected: GameMod | null;
  mods: GameMod[];
  conflicts: ModConflict[];
  nexusDomain?: string;
  onToggleEnabled: (mod: GameMod) => void;
  onDeleteRequest: (mod: GameMod) => void;
  onOpenFolder: (path: string) => void;
}

export default function ModDetailPane({
  selected,
  mods,
  conflicts,
  nexusDomain,
  onToggleEnabled,
  onDeleteRequest,
  onOpenFolder,
}: ModDetailPaneProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [copiedPath, setCopiedPath] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");
  const [notesEditing, setNotesEditing] = useState(false);

  const getCleanUserNotes = useCallback((mod: GameMod | null): string => {
    if (!mod) return "";
    try {
      const customSaved = localStorage.getItem(`gamelib_mod_note_${mod.id}`);
      if (customSaved !== null) return customSaved;
    } catch {
      // ignore
    }
    const raw = mod.notes ?? "";
    return raw
      .replace(/workshop:\d+/gi, "")
      .replace(/preview:https?:\/\/[^\s|]+/gi, "")
      .replace(/\|+/g, " ")
      .trim();
  }, []);

  useEffect(() => {
    setNotesDraft(getCleanUserNotes(selected));
    setNotesEditing(false);
    setCopiedPath(false);
  }, [selected?.id, selected, getCleanUserNotes]);

  const workshopItemId = useMemo(() => {
    if (!selected || selected.engine !== "workshop") return null;
    if (selected.notes) {
      const match = selected.notes.match(/workshop:(\d+)/);
      if (match) return match[1];
    }
    const match = selected.path.match(/(\d+)(?:\.disabled)?$/);
    return match ? match[1] : null;
  }, [selected]);

  const workshopPreviewUrl = useMemo(() => {
    if (!selected?.notes) return null;
    const match = selected.notes.match(/preview:(https?:\/\/[^\s|]+)/);
    return match ? match[1] : null;
  }, [selected]);

  const nexusUrl = useMemo(() => {
    if (!selected) return null;
    const domain = selected.nexusDomain ?? nexusDomain;
    if (!selected.nexusModId || !domain) return null;
    return `https://www.nexusmods.com/${domain}/mods/${selected.nexusModId}`;
  }, [selected, nexusDomain]);

  if (!selected) {
    return (
      <div className="mods-detail-pane">
        <div className="mods-detail-empty">{t("mods.selectMod")}</div>
      </div>
    );
  }

  const selectedConflicts = conflicts.filter((c) => c.modIds.includes(selected.id));
  const engineLabel = ENGINE_LABELS[selected.engine as ModEngine] ?? selected.engine;

  const handleCopyPath = (path: string) => {
    navigator.clipboard
      .writeText(path)
      .then(() => {
        setCopiedPath(true);
        showToast(t("mods.pathCopied"), "info");
        setTimeout(() => setCopiedPath(false), 2500);
      })
      .catch(() => {
        showToast(t("mods.copyFailed"), "error");
      });
  };

  const handleSaveNotes = () => {
    try {
      localStorage.setItem(`gamelib_mod_note_${selected.id}`, notesDraft);
      showToast(t("mods.notesSaved"), "success");
      setNotesEditing(false);
    } catch {
      // ignore
    }
  };

  const facts: { label: string; value: React.ReactNode }[] = [
    { label: t("mods.version"), value: selected.version ?? "—" },
    {
      label: t("mods.latestVersion"),
      value: (
        <span className={selected.updateAvailable ? "mods-text-update" : undefined}>
          {selected.latestVersion ?? "—"}
        </span>
      ),
    },
    { label: t("mods.author"), value: selected.author ?? "—" },
    { label: t("mods.engine"), value: engineLabel },
    { label: t("mods.kind"), value: selected.kind },
    { label: t("mods.order"), value: `#${mods.indexOf(selected) + 1}` },
    { label: t("mods.size"), value: formatModSize(selected.sizeBytes) },
    { label: t("mods.files"), value: selected.fileCount ?? "—" },
  ];

  return (
    <div className="mods-detail-pane" role="region" aria-label={selected.name}>
      <div className="mods-detail-header">
        <div className="mods-detail-title">
          <h3>{selected.name}</h3>
          <span className={`mods-state-pill ${selected.enabled ? "on" : "off"}`}>
            <span className="mods-state-dot" />
            {selected.enabled ? t("mods.enabled") : t("mods.disabled")}
          </span>
        </div>

        <div className="mods-detail-actions">
          <Button
            variant={selected.enabled ? "secondary" : "primary"}
            size="sm"
            onClick={() => onToggleEnabled(selected)}
          >
            {selected.enabled ? t("mods.disable") : t("mods.enable")}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              onOpenFolder(
                selected.kind === "folder"
                  ? selected.path
                  : selected.path.replace(/[\\/][^\\/]+$/, "")
              )
            }
            leftIcon={<FolderOpen size={13} />}
          >
            {t("mods.openLocation")}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="mods-detail-delete"
            onClick={() => onDeleteRequest(selected)}
            leftIcon={<Trash2 size={13} />}
          >
            {t("mods.delete")}
          </Button>
        </div>
      </div>

      {workshopPreviewUrl && (
        <div className="mods-workshop-preview">
          <img src={workshopPreviewUrl} alt={selected.name} />
        </div>
      )}

      {selected.engine === "workshop" && (
        <div className="mods-workshop-hint">
          <Info size={13} /> {t("mods.workshopManaged")}
        </div>
      )}

      {selected.source && (
        <div className="mods-source-provenance">
          <span className="mods-source-provenance-chip">
            {t("mods.source.installedFrom", { source: sourceLabel(selected.source) })}
          </span>
          {selected.remoteUrl && (
            <button
              type="button"
              className="mods-nexus-link"
              onClick={() => void openUrl(selected.remoteUrl!)}
            >
              {t("mods.source.viewSource")}
            </button>
          )}
        </div>
      )}

      <dl className="mods-detail-facts">
        {facts.map((fact) => (
          <div className="mods-detail-fact" key={fact.label}>
            <dt>{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl>

      <div className="mods-detail-path-box">
        <div className="mods-detail-path-info">
          <span className="mods-detail-stat-label">{t("mods.path")}</span>
          <code title={selected.path}>{selected.path}</code>
        </div>
        <button
          type="button"
          className={`mods-copy-btn ${copiedPath ? "copied" : ""}`}
          onClick={() => handleCopyPath(selected.path)}
          title={t("mods.copyPath")}
        >
          {copiedPath ? <Check size={13} /> : <Copy size={13} />}
          {copiedPath ? t("mods.pathCopied") : t("mods.copyPath")}
        </button>
      </div>

      {workshopItemId && (
        <button
          type="button"
          className="mods-nexus-link mods-nexus-link--workshop"
          onClick={() =>
            void openUrl(
              `https://steamcommunity.com/sharedfiles/filedetails/?id=${workshopItemId}`
            )
          }
        >
          {t("mods.viewOnWorkshop")} ({t("mods.workshopItem", { id: workshopItemId })})
        </button>
      )}

      {nexusUrl && (
        <button type="button" className="mods-nexus-link" onClick={() => void openUrl(nexusUrl)}>
          {t("mods.viewOnNexus")}
          {selected.updateAvailable ? ` · ${t("mods.updateAvailable")}` : ""}
        </button>
      )}

      <div className="mods-detail-section">
        <div className="mods-detail-section-title">
          <span>{t("mods.notes")}</span>
          {!notesEditing ? (
            <button
              type="button"
              className="mods-notes-edit-btn"
              onClick={() => setNotesEditing(true)}
            >
              {notesDraft ? t("common.edit") : t("common.add")}
            </button>
          ) : (
            <button type="button" className="mods-notes-edit-btn active" onClick={handleSaveNotes}>
              {t("mods.saveNotes")}
            </button>
          )}
        </div>
        {notesEditing ? (
          <div className="mods-notes-editor">
            <textarea
              className="mods-notes-textarea"
              placeholder={t("mods.notesPlaceholder")}
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              rows={3}
            />
          </div>
        ) : notesDraft ? (
          <p className="mods-notes-display">{notesDraft}</p>
        ) : (
          <p className="mods-nexus-hint">{t("mods.notesPlaceholder")}</p>
        )}
      </div>

      <div className="mods-detail-section">
        <div className="mods-detail-section-title">
          <span>{t("mods.filter.conflicts")}</span>
          {selectedConflicts.length > 0 && (
            <span className="mods-badge mods-badge-conflict">{selectedConflicts.length}</span>
          )}
        </div>
        <ModConflictVisualizer selectedMod={selected} conflicts={selectedConflicts} mods={mods} />
      </div>

      <ModFileInspector mod={selected} />
    </div>
  );
}
