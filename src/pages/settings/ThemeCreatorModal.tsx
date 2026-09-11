import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download } from "lucide-react";
import { useTheme, type ThemeConfig } from "../../context/ThemeContext";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { Button, ConfirmModal } from "../../components/ui";
import ThemeColorField from "./ThemeColorField";
import ThemePreviewPanel from "./ThemePreviewPanel";
import { PaletteIcon, TrashIcon } from "./settingsIcons";
import {
  DEFAULT_DARK_COLORS,
  THEME_COLOR_FIELDS,
  THEME_COLOR_GROUPS,
  createCustomThemeId,
  detectMode,
  downloadThemeExport,
  readThemeSeedColors,
  seedContrastRatio,
  validateThemeName,
  type CustomThemeColors,
  type CustomThemeMode,
} from "../../utils/customTheme";

type SchemePreference = "auto" | CustomThemeMode;

interface ThemeCreatorModalProps {
  open: boolean;
  /** Non-null opens the editor in edit mode for that custom theme. */
  editing: ThemeConfig | null;
  onClose: () => void;
}

export default function ThemeCreatorModal({ open, editing, onClose }: ThemeCreatorModalProps) {
  const { themes, currentTheme, addCustomTheme, removeCustomTheme, setTheme } = useTheme();
  const { t } = useLanguage();
  const { showToast } = useToast();

  const [name, setName] = useState("");
  const [colors, setColors] = useState<CustomThemeColors>(DEFAULT_DARK_COLORS);
  const [schemePref, setSchemePref] = useState<SchemePreference>("auto");
  const [baseId, setBaseId] = useState("dark");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const nameInputRef = useRef<HTMLInputElement>(null);

  // The open/reset effect intentionally reads the latest context values from
  // refs: keying it on `themes` would wipe in-progress edits after every save.
  const themesRef = useRef(themes);
  themesRef.current = themes;
  const currentThemeRef = useRef(currentTheme);
  currentThemeRef.current = currentTheme;

  useEffect(() => {
    if (!open) return;
    setConfirmingDelete(false);
    if (editing?.colors) {
      setName(editing.meta.name);
      setColors(editing.colors);
      setSchemePref(editing.mode ?? detectMode(editing.colors));
      setBaseId(editing.id);
    } else {
      const active = currentThemeRef.current;
      const isBuiltIn = themesRef.current.some((th) => !th.meta.isCustom && th.id === active);
      const seedId = isBuiltIn ? active : "dark";
      setName("");
      setColors(readThemeSeedColors(seedId) ?? DEFAULT_DARK_COLORS);
      setSchemePref("auto");
      setBaseId(seedId);
    }
    const focusTimer = window.setTimeout(() => nameInputRef.current?.focus(), 60);
    return () => window.clearTimeout(focusTimer);
  }, [open, editing]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !confirmingDelete) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, confirmingDelete, onClose]);

  const builtInThemes = useMemo(() => themes.filter((th) => !th.meta.isCustom), [themes]);
  const mode: CustomThemeMode = schemePref === "auto" ? detectMode(colors) : schemePref;
  const nameError = validateThemeName(name, themes, editing?.id ?? null);
  const canExport = name.trim().length > 0;
  const contrast = seedContrastRatio(colors);
  const lowContrast = contrast < 4.5;

  const schemeOptions: { value: SchemePreference; label: string }[] = [
    { value: "auto", label: t("settings.themeCreator.scheme.auto") },
    { value: "dark", label: t("settings.themeCreator.scheme.dark") },
    { value: "light", label: t("settings.themeCreator.scheme.light") },
  ];

  function updateColor(key: keyof CustomThemeColors, hex: string) {
    setColors((prev) => ({ ...prev, [key]: hex }));
  }

  function handleBaseChange(id: string) {
    const seeded = readThemeSeedColors(id);
    if (seeded) setColors(seeded);
    setBaseId(id);
  }

  function handleSave() {
    if (nameError) return;
    const trimmed = name.trim();
    const id = editing?.id ?? createCustomThemeId(trimmed, themes.map((th) => th.id));
    addCustomTheme({
      id,
      meta: {
        name: trimmed,
        descriptor: editing?.meta.descriptor ?? "minimal",
        isCustom: true,
        createdAt: editing?.meta.createdAt ?? new Date().toISOString(),
      },
      colors,
      mode,
    });
    if (!editing) setTheme(id);
    showToast(
      t(
        editing ? "settings.themeCreator.updated" : "settings.themeCreator.created",
        { name: trimmed }
      ),
      "success"
    );
    onClose();
  }

  function handleExport() {
    if (!canExport) return;
    const trimmed = name.trim();
    downloadThemeExport({ name: trimmed, colors, mode });
    showToast(t("settings.themeCreator.exported", { name: trimmed }), "success");
  }

  function handleDelete() {
    if (!editing) return;
    const removedName = editing.meta.name;
    removeCustomTheme(editing.id);
    showToast(t("settings.themeCreator.deleted", { name: removedName }), "success");
    setConfirmingDelete(false);
    onClose();
  }

  if (!open) return null;

  return createPortal(
    <>
      <div className="modal-backdrop" onMouseDown={onClose} role="presentation">
        <div
          className="modal theme-creator-modal"
          onMouseDown={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="theme-creator-title"
        >
          <div className="modal-header">
            <div className="modal-header-icon">
              <PaletteIcon />
            </div>
            <div className="modal-header-text">
              <h2 className="modal-title" id="theme-creator-title">
                {t(editing ? "settings.themeCreator.editTitle" : "settings.themeCreator.createTitle")}
              </h2>
              <p className="modal-subtitle">
                {t(editing ? "settings.themeCreator.editSubtitle" : "settings.themeCreator.createSubtitle")}
              </p>
            </div>
            <button
              type="button"
              className="theme-creator-close"
              onClick={onClose}
              aria-label={t("common.close")}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div className="modal-body theme-creator-body">
            <div className="theme-creator-editor">
              <div className="theme-creator-field">
                <label className="theme-creator-label" htmlFor="theme-creator-name">
                  {t("settings.themeCreator.name")}
                </label>
                <input
                  id="theme-creator-name"
                  ref={nameInputRef}
                  className="theme-creator-input"
                  value={name}
                  maxLength={40}
                  spellCheck={false}
                  placeholder={t("settings.themeCreator.namePlaceholder")}
                  onChange={(e) => setName(e.target.value)}
                />
                {nameError && (
                  <p className="theme-creator-error">
                    {nameError === "required" && t("settings.themeCreator.error.required")}
                    {nameError === "duplicate" && t("settings.themeCreator.error.duplicate")}
                    {nameError === "tooLong" && t("settings.themeCreator.error.tooLong")}
                  </p>
                )}
              </div>

              {!editing && (
                <div className="theme-creator-field">
                  <label className="theme-creator-label" htmlFor="theme-creator-base">
                    {t("settings.themeCreator.base")}
                  </label>
                  <select
                    id="theme-creator-base"
                    className="theme-creator-input"
                    value={baseId}
                    onChange={(e) => handleBaseChange(e.target.value)}
                  >
                    {builtInThemes.map((th) => (
                      <option key={th.id} value={th.id}>
                        {th.meta.name}
                      </option>
                    ))}
                  </select>
                  <p className="theme-creator-hint">{t("settings.themeCreator.baseHint")}</p>
                </div>
              )}

              <div className="theme-creator-field">
                <span className="theme-creator-label">{t("settings.themeCreator.scheme")}</span>
                <div className="theme-creator-scheme" role="group" aria-label={t("settings.themeCreator.scheme")}>
                  {schemeOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`theme-creator-scheme__btn${
                        schemePref === option.value ? " is-active" : ""
                      }`}
                      aria-pressed={schemePref === option.value}
                      onClick={() => setSchemePref(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              {lowContrast && (
                <p className="theme-creator-warning" role="note">
                  {t("settings.themeCreator.lowContrast", { ratio: contrast.toFixed(1) })}
                </p>
              )}

              {THEME_COLOR_GROUPS.map((group) => (
                <div className="theme-creator-group" key={group.key}>
                  <h3 className="theme-creator-group__title">{t(group.titleKey)}</h3>
                  <div className="theme-creator-group__grid">
                    {THEME_COLOR_FIELDS.filter((field) => field.group === group.key).map((field) => (
                      <ThemeColorField
                        key={field.key}
                        label={t(field.labelKey)}
                        value={colors[field.key]}
                        onChange={(hex) => updateColor(field.key, hex)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="theme-creator-preview-col">
              <span className="theme-creator-preview-label">
                {t("settings.themeCreator.livePreview")}
              </span>
              <ThemePreviewPanel colors={colors} mode={mode} name={name} />
            </div>
          </div>

          <div className="modal-footer">
            <div className="modal-footer-left">
              {canExport && (
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<Download size={14} />}
                  onClick={handleExport}
                >
                  {t("settings.themeCreator.export")}
                </Button>
              )}
              {editing && (
                <Button
                  variant="danger"
                  size="sm"
                  leftIcon={<TrashIcon />}
                  onClick={() => setConfirmingDelete(true)}
                >
                  {t("settings.themeCreator.delete")}
                </Button>
              )}
            </div>
            <div className="modal-footer-actions">
              <Button variant="ghost" onClick={onClose}>
                {t("common.cancel")}
              </Button>
              <Button variant="primary" onClick={handleSave} disabled={nameError !== null}>
                {t(editing ? "common.save" : "settings.themeCreator.create")}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <ConfirmModal
        open={confirmingDelete}
        title={t("settings.themeCreator.deleteTitle", { name: editing?.meta.name ?? "" })}
        message={t("settings.themeCreator.deleteMessage")}
        confirmLabel={t("settings.themeCreator.delete")}
        onConfirm={handleDelete}
        onCancel={() => setConfirmingDelete(false)}
      />
    </>,
    document.body
  );
}
