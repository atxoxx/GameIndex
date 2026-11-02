import { Info } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { useSettings } from "../../context/SettingsContext";
import { useSettingsUi } from "./SettingsUiContext";
import LayoutStudio from "./LayoutStudio";
import InterfaceDefaults from "./InterfaceDefaults";
import "./InterfaceTab.css";

/**
 * InterfaceTab
 * ────────────
 * The Interface tab leads with the Layout Studio: a single editable map of the
 * app shell whose live preview is the one place for every navigational and
 * visual element — navbar tabs and buttons, sidebar side and sections, page
 * widgets (per page and app-wide masters), card badges, the now-playing
 * indicator, hero elements and detail tabs.
 *
 * Below it, InterfaceDefaults hosts the two groups the preview cannot express:
 * the app-wide display modes (scale, Simple UI, compact navbar, simple command
 * palette, art backdrop) and the overview detail sections.
 */
export default function InterfaceTab() {
  const { t } = useLanguage();
  const { isSimpleUi } = useSettings();
  const { showAdvanced } = useSettingsUi();

  return (
    <>
      <div className="interface-tab-shell">
        {/* Only worth showing while Simple UI strips every marked element: it
         *  explains the dimmed preview and where to turn the mode off. */}
        {isSimpleUi && (
          <div className="settings-behavior-card interface-tab-note">
            <Info size={16} aria-hidden />
            <span>{t("settings.interface.masterNoteSimple")}</span>
          </div>
        )}

        {showAdvanced ? (
          <LayoutStudio />
        ) : (
          <p className="interface-tab-note-hint">
            {t("settings.interface.studioHiddenHint")}
          </p>
        )}
      </div>

      {/* App-wide display modes and the overview detail sections — the only
       *  settings the live preview cannot change by itself. */}
      <InterfaceDefaults />
    </>
  );
}
