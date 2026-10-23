import { AppWindow, Check, Droplets, LayoutGrid, Minimize2, Monitor, Palette, Shapes, Terminal } from "lucide-react";
import type { CSSProperties } from "react";
import type { LucideIcon } from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { useSettings } from "../../../context/SettingsContext";
import { UI_STYLES, useTheme } from "../../../context/ThemeContext";
import { getThemePreviewColors } from "../../../utils/themePreview";
import { SetupOptionCard, SetupSection } from "../SetupControls";

const UI_STYLE_ICONS: Record<string, LucideIcon> = {
  classic: LayoutGrid,
  materialyou: Shapes,
  steam: Monitor,
  epic: Terminal,
  modern: AppWindow,
  liquidglass: Droplets,
};

/**
 * Second step: theme, interface style and layout density. Everything
 * applies immediately, so the wizard itself is the live preview.
 */
export default function AppearanceStep() {
  const { t } = useLanguage();
  const { currentTheme, setTheme, themes, uiStyle, setUiStyle } = useTheme();
  const { uiDensityMode, setUiDensityMode } = useSettings();

  return (
    <div className="setup-step">
      <SetupSection
        title={t("setup.appearance.theme")}
        desc={t("setup.appearance.themeDesc")}
        tip={t("setup.appearance.themeTip")}
      >
        <div className="setup-theme-grid">
          {themes.map((theme) => {
            const selected = theme.id === currentTheme;
            const colors = getThemePreviewColors(theme);
            return (
              <button
                key={theme.id}
                type="button"
                className={`setup-theme${selected ? " is-selected" : ""}`}
                aria-pressed={selected}
                onClick={() => setTheme(theme.id)}
              >
                <span
                  className="setup-theme__swatch"
                  style={
                    {
                      "--setup-swatch-bg": colors.bg,
                      "--setup-swatch-text": colors.text,
                      "--setup-swatch-accent": colors.accent,
                    } as CSSProperties
                  }
                  aria-hidden="true"
                >
                  <span className="setup-theme__bar setup-theme__bar--bg" />
                  <span className="setup-theme__bar setup-theme__bar--surface" />
                  <span className="setup-theme__bar setup-theme__bar--accent" />
                  {selected && (
                    <span className="setup-theme__check">
                      <Check size={11} />
                    </span>
                  )}
                </span>
                <span className="setup-theme__name">{theme.meta.name}</span>
              </button>
            );
          })}
        </div>
      </SetupSection>

      <SetupSection
        title={t("setup.appearance.style")}
        desc={t("setup.appearance.styleDesc")}
        tip={t("setup.appearance.styleTip")}
      >
        <div className="setup-option-grid">
          {UI_STYLES.map((style) => {
            const StyleIcon = UI_STYLE_ICONS[style.id] ?? Palette;
            return (
              <SetupOptionCard
                key={style.id}
                icon={<StyleIcon size={16} />}
                title={t(`settings.uiStyle.${style.id}.name`)}
                badge={t(`settings.uiStyle.${style.id}.badge`)}
                desc={t(`settings.uiStyle.${style.id}.desc`)}
                selected={uiStyle === style.id}
                onSelect={() => setUiStyle(style.id)}
              />
            );
          })}
        </div>
      </SetupSection>

      <SetupSection
        title={t("setup.appearance.density")}
        tip={t("setup.appearance.densityTip")}
      >
        <div className="setup-option-grid setup-option-grid--two">
          <SetupOptionCard
            icon={<Minimize2 size={16} />}
            title={t("setup.appearance.simple")}
            desc={t("setup.appearance.simpleDesc")}
            selected={uiDensityMode === "simple"}
            onSelect={() => setUiDensityMode("simple")}
          />
          <SetupOptionCard
            icon={<LayoutGrid size={16} />}
            title={t("setup.appearance.complete")}
            desc={t("setup.appearance.completeDesc")}
            selected={uiDensityMode === "complete"}
            onSelect={() => setUiDensityMode("complete")}
          />
        </div>
      </SetupSection>
    </div>
  );
}
