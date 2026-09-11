import type { CSSProperties } from "react";
import { useLanguage } from "../../context/LanguageContext";
import {
  buildThemeTokens,
  type CustomThemeColors,
  type CustomThemeMode,
} from "../../utils/customTheme";

interface ThemePreviewPanelProps {
  colors: CustomThemeColors;
  mode: CustomThemeMode;
  name: string;
}

export default function ThemePreviewPanel({ colors, mode, name }: ThemePreviewPanelProps) {
  const { t } = useLanguage();
  const { ["color-scheme"]: colorScheme, ...customProps } = buildThemeTokens(colors, mode);
  const previewStyle = { ...customProps, colorScheme } as unknown as CSSProperties;

  return (
    <div className="theme-preview" style={previewStyle} aria-hidden="true">
      <div className="theme-preview__topbar">
        <span className="theme-preview__logo">G</span>
        <span className="theme-preview__brand">
          {name.trim() || t("settings.themeCreator.preview.defaultName")}
        </span>
        <span className="theme-preview__search">{t("settings.themeCreator.preview.search")}</span>
        <span className="theme-preview__avatar" />
      </div>

      <div className="theme-preview__shell">
        <nav className="theme-preview__nav">
          {[
            { key: "library", label: t("settings.themeCreator.preview.nav.library") },
            { key: "store", label: t("settings.themeCreator.preview.nav.store") },
            { key: "downloads", label: t("settings.themeCreator.preview.nav.downloads") },
            { key: "activity", label: t("settings.themeCreator.preview.nav.activity") },
            { key: "settings", label: t("settings.themeCreator.preview.nav.settings") },
          ].map((item, index) => (
            <span
              key={item.key}
              className={`theme-preview__nav-item${index === 0 ? " is-active" : ""}`}
            >
              <span className="theme-preview__nav-dot" />
              {item.label}
            </span>
          ))}
        </nav>

        <div className="theme-preview__main">
          <div className="theme-preview__hero">
            <span className="theme-preview__hero-eyebrow">
              {t("settings.themeCreator.preview.heroEyebrow")}
            </span>
            <span className="theme-preview__hero-title" />
            <span className="theme-preview__hero-sub" />
            <div className="theme-preview__hero-actions">
              <span className="ui-btn ui-btn--primary ui-btn--sm">
                <span className="ui-btn__label">{t("settings.themeCreator.preview.play")}</span>
              </span>
              <span className="ui-btn ui-btn--secondary ui-btn--sm">
                <span className="ui-btn__label">{t("settings.themeCreator.preview.details")}</span>
              </span>
            </div>
          </div>

          <div className="theme-preview__cards">
            {[0, 1, 2].map((card) => (
              <div className="theme-preview__card" key={card}>
                <span className="theme-preview__card-art" />
                <span className="theme-preview__card-line" />
                <span className="theme-preview__card-line theme-preview__card-line--short" />
              </div>
            ))}
          </div>

          <div className="theme-preview__row">
            <span className="ui-badge ui-badge--success">
              <span className="ui-badge__dot" />
              {t("settings.themeCreator.preview.badgeInstalled")}
            </span>
            <span className="ui-badge ui-badge--accent">
              {t("settings.themeCreator.preview.badgeUpdate")}
            </span>
            <span className="ui-badge ui-badge--default">
              {t("settings.themeCreator.preview.badgeNew")}
            </span>
          </div>

          <div className="theme-preview__controls">
            <span className="theme-preview__toggle">
              <span />
            </span>
            <span className="theme-preview__progress">
              <span />
            </span>
            <span className="theme-preview__input">{t("settings.themeCreator.preview.input")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
