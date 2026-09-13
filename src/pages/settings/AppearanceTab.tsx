import { useMemo, useRef, useState } from "react";
import { useTheme, UI_STYLES, type ThemeConfig, type ThemeDescriptor, type UiStyleId } from "../../context/ThemeContext";
import { useSettings } from "../../context/SettingsContext";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { Volume2, Zap, Pencil, Plus, Download, Upload, MonitorPlay, LayoutTemplate } from "lucide-react";
import { Button, ConfirmModal } from "../../components/ui";
import SettingsSection from "./SettingsSection";
import SettingsToggleCard from "./SettingsToggleCard";
import AccentPreview from "./AccentPreview";
import ThemeCreatorModal from "./ThemeCreatorModal";
import ThemeImportModal, { type ThemeImportPreviewEntry } from "./ThemeImportModal";
import { PaletteIcon, TrashIcon } from "./settingsIcons";
import { playActionSound } from "../../utils/soundEffects";
import {
  createCustomThemeId,
  dedupeThemeName,
  detectMode,
  downloadThemeExport,
  parseThemeImport,
  type ImportedTheme,
  type ThemeImportIssue,
} from "../../utils/customTheme";

/** Maps theme ids to preview colors — kept in sync with theme stylesheets. */
const THEME_PREVIEW_COLORS: Record<string, { bg: string; text: string; accent: string }> = {
  adaptive:    { bg: "#07070d", text: "#f5f6fc", accent: "#7c66ff" },
  dark:        { bg: "#08090c", text: "#f3f5fa", accent: "#635bff" },
  materialyou: { bg: "#141218", text: "#e6e1e5", accent: "#d0bcff" },
  steam:       { bg: "#10151d", text: "#ebeef2", accent: "#66c0f4" },
  epic:        { bg: "#121212", text: "#f5f5f5", accent: "#0078f2" },
  modern:      { bg: "#09090b", text: "#fafafa", accent: "#6366f1" },
  liquidglass: { bg: "#070913", text: "#ffffff", accent: "#00f0ff" },
  light:       { bg: "#f2f5f9", text: "#0f172a", accent: "#6d28d9" },
  nord:        { bg: "#242933", text: "#eceff4", accent: "#88c0d0" },
  cyberpunk:   { bg: "#050508", text: "#f8fafd", accent: "#00f0ff" },
  emerald:     { bg: "#040a06", text: "#f0fdf4", accent: "#10b981" },
  dracula:     { bg: "#181920", text: "#f8f8f2", accent: "#bd93f9" },
  solarized:   { bg: "#001e26", text: "#fdf6e3", accent: "#268bd2" },
  tokyonight:  { bg: "#13141c", text: "#c0caf5", accent: "#7aa2f7" },
  gruvbox:     { bg: "#1d2021", text: "#fbf1c7", accent: "#fe8019" },
  catppuccin:  { bg: "#181825", text: "#cdd6f4", accent: "#cba6f7" },
  sunset:      { bg: "#140710", text: "#fff1f3", accent: "#ff6b6b" },
  oceanic:     { bg: "#030d17", text: "#f0fdfa", accent: "#00e5ff" },
  rosepine:    { bg: "#12101b", text: "#e0def4", accent: "#eb6f92" },
  synthwave:   { bg: "#0f071a", text: "#fbf5ff", accent: "#ff2a85" },
  forest:      { bg: "#060d08", text: "#f2fbf4", accent: "#84cc16" },
  desert:      { bg: "#120c06", text: "#fffbeb", accent: "#e0ab55" },
  aurora:      { bg: "#04030d", text: "#faf5ff", accent: "#9a6bff" },
  oled:        { bg: "#000000", text: "#ffffff", accent: "#3b82f6" },
  highcontrast:{ bg: "#000000", text: "#ffffff", accent: "#ffff00" },
};

/** Curated preset accent colors exposed on the Appearance tab. `key` is a
 *  stable machine identifier; localized display names come from
 *  `t("settings.accent.color" + key)`. The original 6 hardcoded swatches
 *  are preserved verbatim so existing `gamelib.accent_color` values stay
 *  detectable as a preset. */
const ACCENT_PRESETS: { key: string; value: string }[] = [
  // Cool spectrum — magenta through green
  { key: "Fuchsia", value: "#d946ef" },
  { key: "Purple",  value: "#a855f7" },
  { key: "Violet",  value: "#7c66ff" },
  { key: "Indigo",  value: "#6366f1" },
  { key: "Blue",    value: "#3b82f6" },
  { key: "Sky",     value: "#0ea5e9" },
  { key: "Cyan",    value: "#06b6d4" },
  { key: "Teal",    value: "#14b8a6" },
  { key: "Emerald", value: "#10b981" },
  { key: "Lime",    value: "#84cc16" },
  // Warm spectrum — yellow through pink
  { key: "Yellow",  value: "#eab308" },
  { key: "Amber",   value: "#f59e0b" },
  { key: "Orange",  value: "#f97316" },
  { key: "Rose",    value: "#f43f5e" },
  { key: "Crimson", value: "#ef4444" },
  { key: "Pink",    value: "#ec4899" },
];

const PRESET_VALUE_SET: Set<string> = new Set(
  ACCENT_PRESETS.map((p) => p.value.toLowerCase()),
);

function getDescriptorLabel(descriptor: ThemeDescriptor, t: (k: string) => string): string {
  switch (descriptor) {
    case "adaptive":
      return t("settings.descriptor.adaptive");
    case "vibrant":
      return t("settings.descriptor.vibrant");
    case "calm":
      return t("settings.descriptor.calm");
    case "high-contrast":
      return t("settings.descriptor.highContrast");
    case "minimal":
      return t("settings.descriptor.minimal");
  }
}

function getUiStyleInfo(
  id: UiStyleId,
  fallback: (typeof UI_STYLES)[number],
  t: (k: string) => string,
) {
  switch (id) {
    case "classic":
      return {
        name: t("settings.uiStyle.classic.name"),
        badge: t("settings.uiStyle.classic.badge"),
        desc: t("settings.uiStyle.classic.desc"),
      };
    case "materialyou":
      return {
        name: t("settings.uiStyle.materialyou.name"),
        badge: t("settings.uiStyle.materialyou.badge"),
        desc: t("settings.uiStyle.materialyou.desc"),
      };
    case "steam":
      return {
        name: t("settings.uiStyle.steam.name"),
        badge: t("settings.uiStyle.steam.badge"),
        desc: t("settings.uiStyle.steam.desc"),
      };
    case "epic":
      return {
        name: t("settings.uiStyle.epic.name"),
        badge: t("settings.uiStyle.epic.badge"),
        desc: t("settings.uiStyle.epic.desc"),
      };
    case "modern":
      return {
        name: t("settings.uiStyle.modern.name"),
        badge: t("settings.uiStyle.modern.badge"),
        desc: t("settings.uiStyle.modern.desc"),
      };
    case "liquidglass":
      return {
        name: t("settings.uiStyle.liquidglass.name"),
        badge: t("settings.uiStyle.liquidglass.badge"),
        desc: t("settings.uiStyle.liquidglass.desc"),
      };
    default:
      return {
        name: fallback.name,
        badge: fallback.badge,
        desc: fallback.desc,
      };
  }
}


export default function AppearanceTab() {
  const { currentTheme, setTheme, themes, uiStyle, setUiStyle, systemSync, setSystemSync, removeCustomTheme, addCustomTheme } = useTheme();
  const {
    accentColor,
    setAccentColor,
    autoGameAccent,
    setAutoGameAccent,
    uiSoundEnabled,
    setUiSoundEnabled,
    uiSoundVolume,
    setUiSoundVolume,
    reduceMotion,
    setReduceMotion,
    launchSplashEnabled,
    setLaunchSplashEnabled,
    startupSplashEnabled,
    setStartupSplashEnabled,
  } = useSettings();
  const { t } = useLanguage();
  const { showToast } = useToast();

  const [creatorOpen, setCreatorOpen] = useState(false);
  const [editingTheme, setEditingTheme] = useState<ThemeConfig | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ThemeConfig | null>(null);
  const [importPreview, setImportPreview] = useState<{
    entries: ThemeImportPreviewEntry[];
    errors: ThemeImportIssue[];
  } | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const colorThemes = useMemo(
    () => themes.filter((th) => !["materialyou", "steam", "epic", "modern", "liquidglass"].includes(th.id)),
    [themes]
  );

  const accentSwatches = useMemo(
    () =>
      ACCENT_PRESETS.map((p) => ({
        value: p.value,
        name: t(`settings.accent.color${p.key}`),
      })),
    [t]
  );

  function handleThemeChange(themeId: string) {
    setTheme(themeId);
    const themeMeta = themes.find((th) => th.id === themeId)?.meta;
    showToast(t("settings.themeChanged", { theme: themeMeta?.name ?? themeId }), "success");
  }

  function handleStyleSelect(styleId: UiStyleId) {
    setUiStyle(styleId);
    const styleName = UI_STYLES.find((s) => s.id === styleId)?.name ?? styleId;
    showToast(t("settings.themeChanged", { theme: styleName }), "success");
  }

  function openCreator() {
    setEditingTheme(null);
    setCreatorOpen(true);
  }

  function openEditor(theme: ThemeConfig) {
    setEditingTheme(theme);
    setCreatorOpen(true);
  }

  function handleDeleteConfirm() {
    if (!pendingDelete) return;
    removeCustomTheme(pendingDelete.id);
    showToast(t("settings.themeCreator.deleted", { name: pendingDelete.meta.name }), "success");
    setPendingDelete(null);
  }

  async function handleImportFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;

    const imported: ImportedTheme[] = [];
    const errors: ThemeImportIssue[] = [];
    for (const file of files) {
      try {
        const result = parseThemeImport(await file.text());
        imported.push(...result.themes);
        errors.push(...result.errors);
      } catch {
        errors.push({ code: "invalidTheme", detail: file.name });
      }
    }

    if (imported.length === 0) {
      const code = errors[0]?.code ?? "noThemes";
      showToast(
        code === "invalidJson"
          ? t("settings.themeImport.error.invalidJson")
          : t("settings.themeImport.error.noThemes"),
        "error"
      );
      return;
    }

    const names = themes.filter((th) => th.meta.isCustom).map((th) => th.meta.name);
    const entries: ThemeImportPreviewEntry[] = imported.map((theme) => {
      const finalName = dedupeThemeName(theme.name, names);
      names.push(finalName);
      return { theme, finalName, renamed: finalName !== theme.name };
    });
    setImportPreview({ entries, errors });
  }

  function handleImportConfirm(selected: ThemeImportPreviewEntry[]) {
    const ids = themes.map((th) => th.id);
    let added = 0;
    for (const entry of selected) {
      const id = createCustomThemeId(entry.finalName, ids);
      ids.push(id);
      addCustomTheme({
        id,
        meta: {
          name: entry.finalName,
          descriptor: "minimal",
          isCustom: true,
          createdAt: new Date().toISOString(),
        },
        colors: entry.theme.colors,
        mode: entry.theme.mode,
      });
      added += 1;
    }
    setImportPreview(null);
    if (added > 0) {
      showToast(t("settings.themeImport.imported", { count: added }), "success");
    }
  }

  function handleExportTheme(theme: ThemeConfig) {
    if (!theme.colors) return;
    downloadThemeExport({
      name: theme.meta.name,
      colors: theme.colors,
      mode: theme.mode ?? detectMode(theme.colors),
    });
    showToast(t("settings.themeCreator.exported", { name: theme.meta.name }), "success");
  }

  return (
    <>
      <SettingsSection
        id="appearance-ui-styles"
        icon={<LayoutTemplate size={18} />}
        title={t("settings.section.appearanceStyles")}
        desc={t("settings.appearance.stylesDesc")}
      >
        <div className="ui-styles-grid">
          {UI_STYLES.map((style) => {
            const isActive = uiStyle === style.id;
            const styleInfo = getUiStyleInfo(style.id, style, t);
            return (
              <div
                key={style.id}
                className={`ui-style-card${isActive ? " active" : ""}`}
                onClick={() => handleStyleSelect(style.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleStyleSelect(style.id);
                  }
                }}
                aria-pressed={isActive}
              >
                <div className={`ui-style-preview ui-style-preview--${style.id}`}>
                  <div className={`ui-style-mock ui-style-mock--${style.id}`}>
                    <span className="ui-style-mock-tag">GameIndex</span>
                    <span className={`ui-style-mock-pill ui-style-mock-pill--${style.id}`}>
                      {style.id === "epic" ? "PLAY NOW" : "Play"}
                    </span>
                  </div>
                </div>
                <div className="ui-style-card-content">
                  <div className="ui-style-card-header">
                    <span className="ui-style-card-title">{styleInfo.name}</span>
                    <span className="ui-style-badge">{styleInfo.badge}</span>
                  </div>
                  <span className="ui-style-card-desc">{styleInfo.desc}</span>
                </div>
                {isActive && <span className="ui-style-active-pill">{t("settingsPage.active")}</span>}
              </div>
            );
          })}
        </div>
      </SettingsSection>

      <SettingsSection
        id="appearance-themes"
        icon={<PaletteIcon />}
        title={t("settings.section.appearanceColors")}
        desc={t("settings.appearance.colorsDesc")}
        actions={
          <>
            <Button
              size="sm"
              variant="ghost"
              leftIcon={<Upload size={14} />}
              onClick={() => importInputRef.current?.click()}
            >
              {t("settings.themeImport.button")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<Plus size={14} />}
              onClick={openCreator}
            >
              {t("settings.themeCreator.newTheme")}
            </Button>
          </>
        }
      >
        <input
          ref={importInputRef}
          type="file"
          accept=".json,application/json"
          multiple
          className="theme-import-input"
          onChange={handleImportFiles}
        />
        <div className="theme-grid">
          {colorThemes.map((theme) => {
            const isActive = currentTheme === theme.id;
            const colors =
              theme.meta.isCustom && theme.colors
                ? {
                    bg: theme.colors.bgPrimary,
                    text: theme.colors.textPrimary,
                    accent: theme.colors.accent,
                  }
                : THEME_PREVIEW_COLORS[theme.id] ?? THEME_PREVIEW_COLORS.dark;
            const descriptorLabel = theme.meta.isCustom
              ? t("settings.themeCreator.customBadge")
              : getDescriptorLabel(theme.meta.descriptor, t);
            return (
              <div
                key={theme.id}
                className={`theme-card${isActive ? " active" : ""}`}
                onClick={() => handleThemeChange(theme.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleThemeChange(theme.id);
                  }
                }}
                aria-pressed={isActive}
              >
                <div
                  className="theme-card-preview"
                  style={
                    {
                      "--miniBg": colors.bg,
                      "--miniText": colors.text,
                      "--miniAccent": colors.accent,
                    } as React.CSSProperties
                  }
                >
                  <div className="theme-preview-bar">
                    <div className="theme-preview-color" style={{ backgroundColor: colors.bg }} />
                    <div className="theme-preview-color" style={{ backgroundColor: colors.text }} />
                    <div className="theme-preview-color" style={{ backgroundColor: colors.accent }} />
                  </div>
                  <div className="theme-preview-mini">
                    <div className="theme-preview-mini-sidebar" />
                    <div className="theme-preview-mini-main">
                      <div className="theme-preview-mini-row">
                        <span className="theme-preview-mini-dot" />
                        <span className="theme-preview-mini-bar" />
                      </div>
                      <div className="theme-preview-mini-card">
                        <span className="theme-preview-mini-accent" />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="theme-card-info">
                  <div className="theme-card-text">
                    <span className="theme-card-name">{theme.meta.name}</span>
                    {descriptorLabel && (
                      <span className="theme-card-descriptor">{descriptorLabel}</span>
                    )}
                  </div>
                  {isActive && <span className="theme-active-dot" aria-hidden />}
                </div>

                {theme.meta.isCustom && (
                  <div className="theme-card-actions">
                    <button
                      type="button"
                      className="theme-card-action"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleExportTheme(theme);
                      }}
                      aria-label={t("settings.themeCreator.exportAria", { name: theme.meta.name })}
                      title={t("settings.themeCreator.export")}
                    >
                      <Download size={14} />
                    </button>
                    <button
                      type="button"
                      className="theme-card-action"
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditor(theme);
                      }}
                      aria-label={t("settings.themeCreator.editAria", { name: theme.meta.name })}
                      title={t("common.edit")}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      className="theme-card-action theme-card-action--danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPendingDelete(theme);
                      }}
                      aria-label={t("settings.themeCreator.deleteAria", { name: theme.meta.name })}
                      title={t("common.delete")}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          <button
            type="button"
            className="theme-card theme-card--create"
            onClick={openCreator}
          >
            <span className="theme-card-preview theme-card-preview--create">
              <Plus size={22} />
            </span>
            <span className="theme-card-info">
              <span className="theme-card-name">{t("settings.themeCreator.newTheme")}</span>
            </span>
          </button>
        </div>

        {/* System theme sync */}
        <label className="settings-checkbox-label theme-sync">
          <input
            type="checkbox"
            checked={systemSync}
            onChange={(e) => setSystemSync(e.target.checked)}
          />
          <span>{t("settings.label.syncSystemTheme")}</span>
        </label>

        {/* Auto game palette accent override */}
        <label className="settings-checkbox-label auto-game-accent">
          <input
            type="checkbox"
            checked={autoGameAccent}
            onChange={(e) => setAutoGameAccent(e.target.checked)}
          />
          <span>{t("settings.label.autoGameAccent")}</span>
        </label>

        {/* Per-theme accent color override */}
        <div id="appearance-accent" className="settings-row settings-row--accent">
          <div className="settings-control">
            <label className="settings-label">{t("settings.label.accent")}</label>
            <p className="settings-helper-lead">
              {t("settings.accent.desc")}
            </p>
            {autoGameAccent && (
              <p className="settings-helper-lead accent-locked-notice" style={{ color: "var(--color-text-secondary)", marginTop: 6, display: "flex", alignItems: "center", gap: 6, fontStyle: "italic" }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" style={{ width: 14, height: 14, flexShrink: 0 }}>
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                {t("settings.accent.lockedByAuto")}
              </p>
            )}
            <div
              className={`accent-picker${autoGameAccent ? " accent-picker--locked" : ""}`}
              role="group"
              aria-label={t("settings.aria.presetAccentColors")}
              style={autoGameAccent ? { opacity: 0.5, pointerEvents: "none" } : undefined}
            >
              {accentSwatches.map((swatch) => {
                const isActive = accentColor?.toLowerCase() === swatch.value;
                return (
                  <button
                    key={swatch.value}
                    type="button"
                    className={`accent-swatch${isActive ? " active" : ""}`}
                    style={{ backgroundColor: swatch.value }}
                    disabled={autoGameAccent}
                    onClick={() => {
                      setAccentColor(isActive ? null : swatch.value);
                    }}
                    aria-label={t("settings.accent.useSwatch", { name: swatch.name })}
                    aria-pressed={isActive}
                    title={swatch.name}
                  />
                );
              })}
              <label
                className={`accent-swatch accent-swatch--custom${
                  accentColor && !PRESET_VALUE_SET.has(accentColor.toLowerCase())
                    ? " active"
                    : ""
                }`}
                style={accentColor ? { backgroundColor: accentColor } : undefined}
                title={t("settings.customColor")}
              >
                <input
                  type="color"
                  value={
                    accentColor && /^#[0-9a-fA-F]{6}$/.test(accentColor)
                      ? accentColor
                      : "#7c66ff"
                  }
                  disabled={autoGameAccent}
                  onChange={(e) => setAccentColor(e.target.value)}
                  aria-label={t("settings.aria.customAccent")}
                />
                <span aria-hidden>🎨</span>
              </label>
              {accentColor && (
                 <button
                   type="button"
                   className="accent-clear"
                   disabled={autoGameAccent}
                   onClick={() => setAccentColor(null)}
                 >
                   {t("common.reset")}
                 </button>
              )}
            </div>

            {/* Live preview of the accent family — shows the chosen preset,
                custom pick, or the active game's palette under auto mode. */}
            <AccentPreview accentColor={accentColor} autoGameAccent={autoGameAccent} />
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        id="appearance-motion"
        icon={<Zap className="settings-section-icon" />}
        title={t("settings.appearance.motionTitle")}
        desc={t("settings.appearance.motionDesc")}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
          {/* Reduce Motion */}
          <SettingsToggleCard
            title={t("settings.appearance.reduceMotionTitle")}
            desc={t("settings.appearance.reduceMotionDesc")}
            checked={reduceMotion}
            onChange={(checked) => {
              setReduceMotion(checked);
              if (uiSoundEnabled) playActionSound();
            }}
          />
        </div>
      </SettingsSection>

      <SettingsSection
        id="appearance-sound"
        icon={<Volume2 className="settings-section-icon" />}
        title={t("settings.sound.sectionTitle")}
        desc={t("settings.sound.sectionDesc")}
      >
        <div className="settings-sound-container" style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
          <SettingsToggleCard
            title={t("settings.sound.enableTitle")}
            desc={t("settings.sound.enableDesc")}
            checked={uiSoundEnabled}
            onChange={(checked) => {
              setUiSoundEnabled(checked);
              if (checked) playActionSound();
            }}
          />

          {uiSoundEnabled && (
            <div
              className="settings-behavior-card"
              style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)", padding: "var(--space-md) var(--space-lg)" }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="settings-checkbox-title" style={{ fontSize: "var(--font-size-sm)", fontWeight: 600 }}>
                  {t("settings.sound.volumeTitle")}
                </span>
                <span style={{ fontSize: "var(--font-size-xs)", color: "var(--color-accent)", fontWeight: 700 }}>
                  {uiSoundVolume}%
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={uiSoundVolume}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setUiSoundVolume(val);
                }}
                onMouseUp={() => playActionSound()}
                className="filter-slider"
                aria-label={t("settings.sound.volumeTitle")}
              />
            </div>
          )}
        </div>
      </SettingsSection>

      <SettingsSection
        id="appearance-splash"
        icon={<MonitorPlay className="settings-section-icon" />}
        title={t("settings.section.appearanceSplash")}
        desc={t("settings.splash.sectionDesc")}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
          <SettingsToggleCard
            title={t("settings.splash.launchTitle")}
            desc={t("settings.splash.launchDesc")}
            checked={launchSplashEnabled}
            onChange={(checked) => {
              setLaunchSplashEnabled(checked);
              if (uiSoundEnabled) playActionSound();
            }}
          />
          <SettingsToggleCard
            title={t("settings.splash.startupTitle")}
            desc={t("settings.splash.startupDesc")}
            checked={startupSplashEnabled}
            onChange={(checked) => {
              setStartupSplashEnabled(checked);
              if (uiSoundEnabled) playActionSound();
            }}
          />
        </div>
      </SettingsSection>

      <ThemeCreatorModal
        open={creatorOpen}
        editing={editingTheme}
        onClose={() => setCreatorOpen(false)}
      />

      <ThemeImportModal
        open={importPreview !== null}
        entries={importPreview?.entries ?? []}
        errors={importPreview?.errors ?? []}
        onConfirm={handleImportConfirm}
        onCancel={() => setImportPreview(null)}
      />

      <ConfirmModal
        open={pendingDelete !== null}
        title={t("settings.themeCreator.deleteTitle", { name: pendingDelete?.meta.name ?? "" })}
        message={t("settings.themeCreator.deleteMessage")}
        confirmLabel={t("settings.themeCreator.delete")}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  );
}