// SettingsView — System hub sub-view with the couch-relevant quick
// preferences: cycle the active theme and the app landing page.
// Deliberately kept to two rows — everything else belongs to the
// desktop Settings page reachable from this row set.

import { useCallback } from "react";
import { useLanguage } from "../../../context/LanguageContext";
import { useSettings } from "../../../context/SettingsContext";
import { useTheme } from "../../../context/ThemeContext";
import { useFocusable } from "../../../hooks/useFocusable";

export default function SettingsView() {
  const { t } = useLanguage();
  const { currentTheme, setTheme, themes } = useTheme();
  const { landingPage, setLandingPage } = useSettings();

  const handleCycleTheme = useCallback(() => {
    const ids = themes.map((t) => t.id);
    const idx = ids.indexOf(currentTheme);
    const nextIdx = (idx + 1) % ids.length;
    setTheme(ids[nextIdx]);
  }, [currentTheme, setTheme, themes]);

  const handleCycleLanding = useCallback(() => {
    const pages: ("library" | "store" | "activity" | "settings")[] = [
      "library",
      "store",
      "activity",
      "settings",
    ];
    const curPage = landingPage === "deals" || landingPage === "wishlist" || landingPage === "news" || landingPage === "community" || landingPage === "downloads" || landingPage === "storage" || landingPage === "achievements" ? "library" : landingPage;
    const idx = pages.indexOf(curPage as any);
    const nextIdx = (idx + 1) % pages.length;
    setLandingPage(pages[nextIdx] as any);
  }, [landingPage, setLandingPage]);

  const themeBtnProps = useFocusable(handleCycleTheme);
  const landingBtnProps = useFocusable(handleCycleLanding);

  return (
    <div className="bigscreen-system-section-view">
      <h3>{t("bigscreen.system.preferencesTitle")}</h3>
      <div className="system-settings-list">
        <div className="system-setting-row">
          <div className="setting-info">
            <span className="setting-label">{t("bigscreen.system.appearance")}</span>
            <span className="setting-desc">{t("bigscreen.system.appearanceDesc")}</span>
          </div>
          <button type="button" className="setting-cycle-btn" {...themeBtnProps}>
            {currentTheme.toUpperCase()}
          </button>
        </div>

        <div className="system-setting-row">
          <div className="setting-info">
            <span className="setting-label">{t("bigscreen.system.defaultPage")}</span>
            <span className="setting-desc">{t("bigscreen.system.defaultPageDesc")}</span>
          </div>
          <button type="button" className="setting-cycle-btn" {...landingBtnProps}>
            {landingPage.toUpperCase()}
          </button>
        </div>
      </div>
    </div>
  );
}
