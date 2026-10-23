import { Cpu, Languages, LayoutGrid, Palette } from "lucide-react";
import { useActivity } from "../../../context/ActivityContext";
import { useLanguage } from "../../../context/LanguageContext";
import { useLayoutSettings } from "../../../context/SettingsContext";
import { useTheme } from "../../../context/ThemeContext";
import { NAV_TAB_ITEMS } from "../../../pages/settings/interfaceItems";

/** Final step: a plain-language recap of the choices just made. */
export default function FinishStep() {
  const { t, language, languages } = useLanguage();
  const { interfaceVisibility } = useLayoutSettings();
  const { currentTheme, themes } = useTheme();
  const { selectedGpu } = useActivity();

  const visibleTabs = NAV_TAB_ITEMS.filter(
    (item) => interfaceVisibility[item.key] !== false,
  ).length;
  const languageLabel =
    languages.find((l) => l.code === language)?.label ?? language.toUpperCase();
  const themeLabel =
    themes.find((theme) => theme.id === currentTheme)?.meta.name ?? currentTheme;

  const rows = [
    { icon: Languages, label: t("setup.finish.language"), value: languageLabel },
    { icon: Palette, label: t("setup.finish.theme"), value: themeLabel },
    {
      icon: LayoutGrid,
      label: t("setup.finish.tabs"),
      value: t("setup.finish.tabsValue", {
        count: visibleTabs,
        total: NAV_TAB_ITEMS.length,
      }),
    },
    {
      icon: Cpu,
      label: t("setup.finish.gpu"),
      value: selectedGpu?.name ?? t("setup.finish.none"),
    },
  ];

  return (
    <div className="setup-step">
      <h3 className="setup-step__lead">{t("setup.finish.heading")}</h3>
      <p className="setup-step__intro">{t("setup.finish.body")}</p>

      <ul className="setup-summary">
        {rows.map((row) => {
          const Icon = row.icon;
          return (
            <li key={row.label} className="setup-summary__row">
              <span className="setup-summary__label">
                <Icon size={15} aria-hidden="true" />
                {row.label}
              </span>
              <span className="setup-summary__value">{row.value}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
