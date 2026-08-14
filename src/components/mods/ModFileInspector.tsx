import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import type { GameMod } from "../../types/mods";

interface ModFileInspectorProps {
  mod: GameMod;
}

function getFileExtension(filename: string): string {
  const parts = filename.split(".");
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
}

export default function ModFileInspector({ mod }: ModFileInspectorProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState<string[] | null>(null);
  const [search, setSearch] = useState("");

  const handleToggle = async () => {
    if (isOpen) {
      setIsOpen(false);
      return;
    }
    setIsOpen(true);
    if (files === null) {
      setLoading(true);
      try {
        const list = await invoke<string[]>("mods_list_files", { modId: mod.id });
        setFiles(list);
      } catch {
        setFiles([]);
      } finally {
        setLoading(false);
      }
    }
  };

  const filteredFiles = useMemo(() => {
    if (!files) return [];
    const q = search.trim().toLowerCase();
    if (!q) return files;
    return files.filter((f) => f.toLowerCase().includes(q));
  }, [files, search]);

  const handleCopyFile = (path: string) => {
    navigator.clipboard
      .writeText(path)
      .then(() => showToast(t("mods.pathCopied"), "info"))
      .catch(() => showToast(t("mods.installFailed", { error: "Clipboard" }), "error"));
  };

  return (
    <div className="mods-detail-section">
      <div className="mods-detail-section-title">
        <span>{t("mods.files")}</span>
        <button
          type="button"
          className={`mods-files-toggle ${isOpen ? "active" : ""}`}
          onClick={handleToggle}
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {isOpen ? (
              <>
                <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2z" />
                <line x1="18" y1="13" x2="6" y2="13" />
              </>
            ) : (
              <>
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                <line x1="12" y1="11" x2="12" y2="17" />
                <line x1="9" y1="14" x2="15" y2="14" />
              </>
            )}
          </svg>
          {isOpen ? t("mods.hideFiles") : t("mods.showFiles")}
        </button>
      </div>

      {isOpen && (
        <div className="mods-file-explorer">
          <input
            type="text"
            className="mods-file-search"
            placeholder={t("mods.searchFiles")}
            aria-label={t("mods.searchFiles")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <ul className="mods-file-list">
            {loading ? (
              <li className="mods-file-item">{t("common.loading")}</li>
            ) : files === null || filteredFiles.length === 0 ? (
              <li className="mods-file-item" style={{ color: "var(--color-text-muted)" }}>
                {t("mods.noFilesMatch")}
              </li>
            ) : (
              filteredFiles.map((f) => {
                const ext = getFileExtension(f);
                return (
                  <li
                    key={f}
                    className="mods-file-item"
                    onClick={() => handleCopyFile(f)}
                    title={t("mods.pathCopied")}
                  >
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--color-text-muted)", flexShrink: 0 }}>
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    <code>{f}</code>
                    {ext && <span className="mods-file-ext-badge">{ext}</span>}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
