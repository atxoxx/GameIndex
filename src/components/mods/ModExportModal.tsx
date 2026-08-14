import { useState, useMemo } from "react";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { Button } from "../ui";
import type { Game } from "../../types/game";
import type { GameMod } from "../../types/mods";

interface ModExportModalProps {
  game: Game;
  mods: GameMod[];
  isOpen: boolean;
  onClose: () => void;
}

type ExportFormat = "markdown" | "text";

export default function ModExportModal({
  game,
  mods,
  isOpen,
  onClose,
}: ModExportModalProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [format, setFormat] = useState<ExportFormat>("markdown");

  const exportedText = useMemo(() => {
    if (format === "markdown") {
      const header = `### ${game.name} — Mod Load Order (${mods.length} mods)\n\n| # | Status | Mod Name | Version | Engine | Size |\n|---|---|---|---|---|---|`;
      const rows = mods.map((m, i) => {
        const status = m.enabled ? "✅ Enabled" : "❌ Disabled";
        const ver = m.version ? `v${m.version}` : "—";
        const size = m.sizeBytes
          ? `${(m.sizeBytes / 1024 / 1024).toFixed(1)} MB`
          : "—";
        return `| ${i + 1} | ${status} | ${m.name} | ${ver} | ${m.engine} | ${size} |`;
      });
      return [header, ...rows].join("\n");
    } else {
      const header = `=== ${game.name} Mod Load Order (${mods.length} mods) ===\n`;
      const rows = mods.map((m, i) => {
        const mark = m.enabled ? "[x]" : "[ ]";
        const ver = m.version ? ` v${m.version}` : "";
        return `${i + 1}. ${mark} ${m.name}${ver} (${m.engine})`;
      });
      return header + rows.join("\n");
    }
  }, [game.name, mods, format]);

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard
      .writeText(exportedText)
      .then(() => showToast(t("mods.export.copied"), "success"))
      .catch(() => showToast(t("mods.copyFailed"), "error"));
  };

  return (
    <div className="mods-modal-backdrop" onClick={onClose}>
      <div
        className="mods-modal-card mods-modal-card--lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mods-export-title"
      >
        <div className="mods-modal-header">
          <div>
            <h3 id="mods-export-title">{t("mods.export.title")}</h3>
            <p className="mods-modal-subtitle">{t("mods.export.subtitle")}</p>
          </div>
          <button
            type="button"
            className="mods-modal-close"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Format Selector Pills */}
        <div className="mods-export-format-row">
          <button
            type="button"
            className={`mods-filter-btn ${format === "markdown" ? "active" : ""}`}
            onClick={() => setFormat("markdown")}
          >
            {t("mods.export.markdown")}
          </button>
          <button
            type="button"
            className={`mods-filter-btn ${format === "text" ? "active" : ""}`}
            onClick={() => setFormat("text")}
          >
            {t("mods.export.text")}
          </button>
        </div>

        {/* Text Preview Box */}
        <pre className="mods-export-preview" tabIndex={0}>
          <code>{exportedText}</code>
        </pre>

        <div className="mods-modal-actions">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleCopy}
            leftIcon={
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            }
          >
            {t("mods.export.copy")}
          </Button>
        </div>
      </div>
    </div>
  );
}
