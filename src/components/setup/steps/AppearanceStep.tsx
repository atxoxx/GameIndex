import { useLanguage } from "../../../context/LanguageContext";
import { useSettings } from "../../../context/SettingsContext";
import { UI_STYLES, useTheme } from "../../../context/ThemeContext";
import { SetupOptionCard, SetupSection } from "../SetupControls";

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
                  data-theme={theme.id}
                  aria-hidden="true"
                >
                  <span className="setup-theme__bar setup-theme__bar--bg" />
                  <span className="setup-theme__bar setup-theme__bar--surface" />
                  <span className="setup-theme__bar setup-theme__bar--accent" />
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
          {UI_STYLES.map((style) => (
            <SetupOptionCard
              key={style.id}
              title={t(`settings.uiStyle.${style.id}.name`)}
              badge={t(`settings.uiStyle.${style.id}.badge`)}
              desc={t(`settings.uiStyle.${style.id}.desc`)}
              selected={uiStyle === style.id}
              onSelect={() => setUiStyle(style.id)}
            />
          ))}
        </div>
      </SetupSection>

      <SetupSection
        title={t("setup.appearance.density")}
        tip={t("setup.appearance.densityTip")}
      >
        <div className="setup-option-grid setup-option-grid--two">
          <SetupOptionCard
            title={t("setup.appearance.simple")}
            desc={t("setup.appearance.simpleDesc")}
            selected={uiDensityMode === "simple"}
            onSelect={() => setUiDensityMode("simple")}
          />
          <SetupOptionCard
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
