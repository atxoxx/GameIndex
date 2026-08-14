import { useMemo, useState, useEffect, useCallback } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { Button } from "../ui";
import { ENGINE_LABELS, type GameMod, type ModConflict, type ModEngine } from "../../types/mods";
import ModConflictVisualizer from "./ModConflictVisualizer";
import ModFileInspector from "./ModFileInspector";

function formatModSize(bytes?: number): string {
  if (bytes == null || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function EngineChip({ engine }: { engine: ModEngine | string }) {
  const label = ENGINE_LABELS[engine as ModEngine] ?? engine;
  return <span className={`mods-engine-chip mods-engine-${engine}`}>{label}</span>;
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

  const selectedConflicts = conflicts.filter((c) =>
    c.modIds.includes(selected.id)
  );

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
    // Save notes to localStorage
    try {
      localStorage.setItem(`gamelib_mod_note_${selected.id}`, notesDraft);
      showToast(t("mods.notesSaved"), "success");
      setNotesEditing(false);
    } catch {
      // ignore
    }
  };

  return (
    <div className="mods-detail-pane" role="region" aria-label={selected.name}>
      {/* Header & Quick Actions */}
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
            variant="danger"
            size="sm"
            onClick={() => onDeleteRequest(selected)}
            leftIcon={
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            }
          >
            {t("mods.delete")}
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
            leftIcon={
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            }
          >
            {t("mods.openLocation")}
          </Button>
        </div>
      </div>

      {/* Steam Workshop Hero preview banner */}
      {workshopPreviewUrl && (
        <div className="mods-workshop-preview">
          <img src={workshopPreviewUrl} alt={selected.name} />
        </div>
      )}

      {selected.engine === "workshop" && (
        <div className="mods-workshop-hint">ℹ {t("mods.workshopManaged")}</div>
      )}

      {/* KPI Grid */}
      <div className="mods-detail-grid">
        <div className="mods-detail-stat-card">
          <span className="mods-detail-stat-label">{t("mods.version")}</span>
          <span className="mods-detail-stat-val">{selected.version ?? "—"}</span>
        </div>

        <div className="mods-detail-stat-card">
          <span className="mods-detail-stat-label">{t("mods.latestVersion")}</span>
          <span
            className={`mods-detail-stat-val ${
              selected.updateAvailable ? "mods-text-update" : ""
            }`}
          >
            {selected.latestVersion ?? "—"}
          </span>
        </div>

        <div className="mods-detail-stat-card">
          <span className="mods-detail-stat-label">{t("mods.author")}</span>
          <span className="mods-detail-stat-val">{selected.author ?? "—"}</span>
        </div>

        <div className="mods-detail-stat-card">
          <span className="mods-detail-stat-label">{t("mods.engine")}</span>
          <EngineChip engine={selected.engine} />
        </div>

        <div className="mods-detail-stat-card">
          <span className="mods-detail-stat-label">{t("mods.kind")}</span>
          <span className="mods-detail-stat-val">{selected.kind}</span>
        </div>

        <div className="mods-detail-stat-card">
          <span className="mods-detail-stat-label">{t("mods.order")}</span>
          <span className="mods-detail-stat-val">
            #{mods.indexOf(selected) + 1}
          </span>
        </div>

        <div className="mods-detail-stat-card">
          <span className="mods-detail-stat-label">{t("mods.size")}</span>
          <span className="mods-detail-stat-val">
            {formatModSize(selected.sizeBytes)}
          </span>
        </div>

        <div className="mods-detail-stat-card">
          <span className="mods-detail-stat-label">{t("mods.files")}</span>
          <span className="mods-detail-stat-val">{selected.fileCount ?? "—"}</span>
        </div>
      </div>

      {/* Path Box with copy */}
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
          {copiedPath ? (
            <>
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              {t("mods.pathCopied")}
            </>
          ) : (
            <>
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              {t("mods.copyPath")}
            </>
          )}
        </button>
      </div>

      {/* Web Links */}
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
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
            <path d="M12 2a10 10 0 0 0-10 10c0 4.42 2.87 8.17 6.84 9.5l2.67-3.7a3.48 3.48 0 0 1-.51-1.8c0-1.93 1.57-3.5 3.5-3.5s3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5c-.32 0-.63-.04-.93-.13l-2.6 3.6a10 10 0 0 0 11.03-9.47A10 10 0 0 0 12 2z" />
          </svg>
          {t("mods.viewOnWorkshop")} ({t("mods.workshopItem", { id: workshopItemId })})
        </button>
      )}

      {nexusUrl && (
        <button
          type="button"
          className="mods-nexus-link"
          onClick={() => void openUrl(nexusUrl)}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
          {t("mods.viewOnNexus")}
          {selected.updateAvailable ? ` · ${t("mods.updateAvailable")}` : ""}
        </button>
      )}

      {/* Notes Section */}
      <div className="mods-detail-section">
        <div className="mods-detail-section-title">
          <span>{t("mods.notes")}</span>
          {!notesEditing ? (
            <button
              type="button"
              className="mods-notes-edit-btn"
              onClick={() => setNotesEditing(true)}
            >
              {notesDraft ? "Edit" : "+ Add"}
            </button>
          ) : (
            <button
              type="button"
              className="mods-notes-edit-btn active"
              onClick={handleSaveNotes}
            >
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

      {/* Conflict Visualizer */}
      <div className="mods-detail-section">
        <div className="mods-detail-section-title">
          <span>{t("mods.filter.conflicts")}</span>
          {selectedConflicts.length > 0 && (
            <span className="mods-badge mods-badge-conflict">
              {selectedConflicts.length}
            </span>
          )}
        </div>
        <ModConflictVisualizer
          selectedMod={selected}
          conflicts={selectedConflicts}
          mods={mods}
        />
      </div>

      {/* Interactive File Inspector */}
      <ModFileInspector mod={selected} />
    </div>
  );
}
