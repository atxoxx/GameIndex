import { useMemo } from "react";
import { useTheme, type ThemeDescriptor } from "../../context/ThemeContext";
import { useSettings } from "../../context/SettingsContext";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import SettingsSection from "./SettingsSection";
import { PaletteIcon } from "./settingsIcons";

/** Maps theme ids to preview colors — kept in sync with App.css overrides. */
const THEME_PREVIEW_COLORS: Record<string, { bg: string; text: string; accent: string }> = {
  dark:      { bg: "#0a0c10", text: "#f0f2f7", accent: "#7c66ff" },
  light:     { bg: "#f8fafc", text: "#0f172a", accent: "#7c3aed" },
  nord:      { bg: "#2e3440", text: "#eceff4", accent: "#88c0d0" },
  cyberpunk: { bg: "#050508", text: "#f0f2f5", accent: "#00f0ff" },
  emerald:   { bg: "#08110c", text: "#ecf3ee", accent: "#10b981" },
  dracula:   { bg: "#1e1f29", text: "#f8f8f2", accent: "#bd93f9" },
  solarized: { bg: "#002b36", text: "#fdf6e3", accent: "#268bd2" },
  tokyonight:{ bg: "#1a1b26", text: "#c0caf5", accent: "#7aa2f7" },
  gruvbox:   { bg: "#282828", text: "#ebdbb2", accent: "#fe8019" },
  catppuccin:{ bg: "#1e1e2e", text: "#cad3f5", accent: "#cba6f7" },
  sunset:    { bg: "#1f0f1a", text: "#fdeef2", accent: "#ff7a59" },
  oceanic:   { bg: "#071a2b", text: "#e6f6fb", accent: "#22d3ee" },
  rosepine:  { bg: "#191724", text: "#e0def4", accent: "#eb6f92" },
  synthwave: { bg: "#170d2b", text: "#f9f2ff", accent: "#ff71ce" },
  forest:    { bg: "#0c1510", text: "#eef5ea", accent: "#84cc16" },
  desert:    { bg: "#1c160f", text: "#f5ead7", accent: "#e0ab55" },
  aurora:    { bg: "#07060f", text: "#f4f2ff", accent: "#8b5cff" },
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

export default function AppearanceTab() {
  const { currentTheme, setTheme, themes, systemSync, setSystemSync } = useTheme();
  const { accentColor, setAccentColor, autoGameAccent, setAutoGameAccent } = useSettings();
  const { t } = useLanguage();
  const { showToast } = useToast();

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

  return (
    <SettingsSection
      icon={<PaletteIcon />}
      title={t("settings.section.appearanceThemes")}
      desc={t("settings.appearance.desc")}
    >
      <div className="theme-grid">
        {themes.map((theme) => {
          const isActive = currentTheme === theme.id;
          const colors = THEME_PREVIEW_COLORS[theme.id] ?? THEME_PREVIEW_COLORS.dark;
          const descriptorLabel = getDescriptorLabel(theme.meta.descriptor, t);
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
            </div>
          );
        })}
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
      <div className="settings-row settings-row--accent">
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
                value={accentColor ?? "#7c66ff"}
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
        </div>
      </div>
    </SettingsSection>
  );
}
