import { useMemo } from "react";
import { useTheme, type ThemeDescriptor } from "../../context/ThemeContext";
import { useSettings, type DetailSectionKey } from "../../context/SettingsContext";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { Volume2, Layout, Zap, LayoutList } from "lucide-react";
import SettingsSection from "./SettingsSection";
import SettingsToggleCard from "./SettingsToggleCard";
import AccentPreview from "./AccentPreview";
import { PaletteIcon } from "./settingsIcons";
import { playActionSound } from "../../utils/soundEffects";

/** Maps theme ids to preview colors — kept in sync with theme stylesheets. */
const THEME_PREVIEW_COLORS: Record<string, { bg: string; text: string; accent: string }> = {
  dark:        { bg: "#08090c", text: "#f3f5fa", accent: "#635bff" },
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
  const {
    accentColor,
    setAccentColor,
    autoGameAccent,
    setAutoGameAccent,
    uiSoundEnabled,
    setUiSoundEnabled,
    uiSoundVolume,
    setUiSoundVolume,
    commandPaletteMode,
    setCommandPaletteMode,
    navbarMode,
    setNavbarMode,
    uiDensityMode,
    setUiDensityMode,
    reduceMotion,
    setReduceMotion,
    showCardBadges,
    setShowCardBadges,
    showGameArtBackdrop,
    setShowGameArtBackdrop,
    showNavbarNowPlaying,
    setShowNavbarNowPlaying,
    detailSectionVisible,
    setDetailSectionVisible,
  } = useSettings();
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

  // Game & Store detail-page sections that can be individually hidden.
  const detailSections: {
    key: DetailSectionKey;
    titleKey: string;
    descKey: string;
  }[] = [
    {
      key: "systemRequirements",
      titleKey: "settings.detailSections.systemRequirements.title",
      descKey: "settings.detailSections.systemRequirements.desc",
    },
    {
      key: "gameRelations",
      titleKey: "settings.detailSections.gameRelations.title",
      descKey: "settings.detailSections.gameRelations.desc",
    },
    {
      key: "timeToBeat",
      titleKey: "settings.detailSections.timeToBeat.title",
      descKey: "settings.detailSections.timeToBeat.desc",
    },
    {
      key: "protonDb",
      titleKey: "settings.detailSections.protonDb.title",
      descKey: "settings.detailSections.protonDb.desc",
    },
    {
      key: "releases",
      titleKey: "settings.detailSections.releases.title",
      descKey: "settings.detailSections.releases.desc",
    },
    {
      key: "reviews",
      titleKey: "settings.detailSections.reviews.title",
      descKey: "settings.detailSections.reviews.desc",
    },
    {
      key: "activity",
      titleKey: "settings.detailSections.activity.title",
      descKey: "settings.detailSections.activity.desc",
    },
    {
      key: "achievements",
      titleKey: "settings.detailSections.achievements.title",
      descKey: "settings.detailSections.achievements.desc",
    },
    {
      key: "mods",
      titleKey: "settings.detailSections.mods.title",
      descKey: "settings.detailSections.mods.desc",
    },
    {
      key: "weblinks",
      titleKey: "settings.detailSections.weblinks.title",
      descKey: "settings.detailSections.weblinks.desc",
    },
    {
      key: "news",
      titleKey: "settings.detailSections.news.title",
      descKey: "settings.detailSections.news.desc",
    },
  ];

  return (
    <>
      <SettingsSection
        id="appearance-themes"
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
      id="appearance-interface"
      icon={<Layout className="settings-section-icon" />}
      title={t("settings.appearance.interfaceTitle")}
      desc={t("settings.appearance.interfaceDesc")}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
        {/* Simple / Full Command Palette */}
        <SettingsToggleCard
          title={t("settings.appearance.cmdPaletteSimpleTitle")}
          desc={t("settings.appearance.cmdPaletteSimpleDesc")}
          checked={commandPaletteMode === "simple"}
          onChange={(checked) => {
            setCommandPaletteMode(checked ? "simple" : "full");
            if (uiSoundEnabled) playActionSound();
          }}
        />

        {/* Full or Compact Navbar */}
        <SettingsToggleCard
          title={t("settings.appearance.navbarCompactTitle")}
          desc={t("settings.appearance.navbarCompactDesc")}
          checked={navbarMode === "compact"}
          onChange={(checked) => {
            setNavbarMode(checked ? "compact" : "full");
            if (uiSoundEnabled) playActionSound();
          }}
        />

        {/* Simple / Complete UI for all pages */}
        <SettingsToggleCard
          title={t("settings.appearance.simpleUiTitle")}
          desc={t("settings.appearance.simpleUiDesc")}
          checked={uiDensityMode === "simple"}
          onChange={(checked) => {
            setUiDensityMode(checked ? "simple" : "complete");
            if (uiSoundEnabled) playActionSound();
          }}
        />

        {/* Show Card Badges */}
        <SettingsToggleCard
          title={t("settings.appearance.cardBadgesTitle")}
          desc={t("settings.appearance.cardBadgesDesc")}
          checked={showCardBadges}
          onChange={(checked) => {
            setShowCardBadges(checked);
            if (uiSoundEnabled) playActionSound();
          }}
        />

        {/* Dynamic Game Art Backdrops */}
        <SettingsToggleCard
          title={t("settings.appearance.artBackdropTitle")}
          desc={t("settings.appearance.artBackdropDesc")}
          checked={showGameArtBackdrop}
          onChange={(checked) => {
            setShowGameArtBackdrop(checked);
            if (uiSoundEnabled) playActionSound();
          }}
        />

        {/* Navbar Now Playing Indicator */}
        <SettingsToggleCard
          title={t("settings.appearance.navbarNowPlayingTitle")}
          desc={t("settings.appearance.navbarNowPlayingDesc")}
          checked={showNavbarNowPlaying}
          onChange={(checked) => {
            setShowNavbarNowPlaying(checked);
            if (uiSoundEnabled) playActionSound();
          }}
        />
      </div>
    </SettingsSection>

    <SettingsSection
      id="appearance-detail-sections"
      icon={<LayoutList className="settings-section-icon" />}
      title={t("settings.detailSections.title")}
      desc={t("settings.detailSections.desc")}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
        {detailSections.map((section) => (
          <SettingsToggleCard
            key={section.key}
            title={t(section.titleKey)}
            desc={t(section.descKey)}
            checked={detailSectionVisible[section.key]}
            onChange={(checked) => {
              setDetailSectionVisible(section.key, checked);
              if (uiSoundEnabled) playActionSound();
            }}
          />
        ))}
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
  </>
  );
}
