import { useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "../../context/LanguageContext";
import { Button } from "../../components/ui";
import type { ImportedTheme, ThemeImportIssue } from "../../utils/customTheme";

export interface ThemeImportPreviewEntry {
  theme: ImportedTheme;
  finalName: string;
  renamed: boolean;
}

interface ThemeImportModalProps {
  open: boolean;
  entries: ThemeImportPreviewEntry[];
  errors: ThemeImportIssue[];
  onConfirm: (selected: ThemeImportPreviewEntry[]) => void;
  onCancel: () => void;
}

function swatchStyle(theme: ImportedTheme): CSSProperties {
  const { accent, accent2, bgPrimary, bgSecondary, textPrimary } = theme.colors;
  return {
    background: `linear-gradient(90deg, ${bgPrimary} 0 20%, ${bgSecondary} 20% 40%, ${textPrimary} 40% 60%, ${accent} 60% 80%, ${accent2} 80% 100%)`,
  };
}

export default function ThemeImportModal({
  open,
  entries,
  errors,
  onConfirm,
  onCancel,
}: ThemeImportModalProps) {
  const { t } = useLanguage();
  const [selected, setSelected] = useState<boolean[]>([]);

  useEffect(() => {
    if (open) setSelected(entries.map(() => true));
  }, [open, entries]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const selectedCount = selected.filter(Boolean).length;
  const allSelected = entries.length > 0 && selectedCount === entries.length;

  function toggle(index: number) {
    setSelected((prev) => prev.map((value, i) => (i === index ? !value : value)));
  }

  function errorText(issue: ThemeImportIssue): string {
    if (issue.code === "invalidJson") return t("settings.themeImport.error.invalidJson");
    if (issue.code === "noThemes") return t("settings.themeImport.error.noThemes");
    return t("settings.themeImport.error.invalidTheme", {
      detail: issue.detail ?? t("settings.themeImport.error.unknownTheme"),
    });
  }

  return createPortal(
    <div className="modal-backdrop" onMouseDown={onCancel} role="presentation">
      <div
        className="modal theme-import-modal"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="theme-import-title"
      >
        <div className="modal-header">
          <div className="modal-header-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </div>
          <div className="modal-header-text">
            <h2 className="modal-title" id="theme-import-title">
              {t("settings.themeImport.title")}
            </h2>
            <p className="modal-subtitle">{t("settings.themeImport.subtitle")}</p>
          </div>
        </div>

        <div className="modal-body theme-import-body">
          {entries.length > 0 && (
            <label className="theme-import-selectall">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() =>
                  setSelected(entries.map(() => (allSelected ? false : true)))
                }
              />
              <span>{t("settings.themeImport.selectAll")}</span>
            </label>
          )}

          <div className="theme-import-list">
            {entries.map((entry, index) => (
              <label
                key={`${entry.theme.name}-${index}`}
                className={`theme-import-item${selected[index] ? " is-selected" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={selected[index] ?? false}
                  onChange={() => toggle(index)}
                />
                <span className="theme-import-swatches" style={swatchStyle(entry.theme)} aria-hidden />
                <span className="theme-import-item__text">
                  <span className="theme-import-item__name">{entry.finalName}</span>
                  <span className="theme-import-item__meta">
                    {entry.theme.mode === "light"
                      ? t("settings.themeCreator.scheme.light")
                      : t("settings.themeCreator.scheme.dark")}
                    {entry.renamed && (
                      <span className="theme-import-item__renamed">
                        {t("settings.themeImport.renamed", { name: entry.theme.name })}
                      </span>
                    )}
                  </span>
                </span>
              </label>
            ))}
          </div>

          {errors.length > 0 && (
            <div className="theme-import-errors" role="note">
              {errors.map((issue, index) => (
                <p key={index} className="theme-import-error">
                  {errorText(issue)}
                </p>
              ))}
            </div>
          )}

          {entries.length === 0 && errors.length === 0 && (
            <p className="theme-import-empty">{t("settings.themeImport.empty")}</p>
          )}
        </div>

        <div className="modal-footer">
          <span className="theme-import-count">
            {t("settings.themeImport.selectedCount", { count: selectedCount })}
          </span>
          <div className="modal-footer-actions">
            <Button variant="ghost" onClick={onCancel}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              disabled={selectedCount === 0}
              onClick={() =>
                onConfirm(entries.filter((_entry, index) => selected[index]))
              }
            >
              {t("settings.themeImport.confirm")}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
