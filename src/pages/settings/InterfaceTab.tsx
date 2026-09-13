import { Info } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { useSettings } from "../../context/SettingsContext";
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

  return (
    <>
      <div className="interface-tab-shell">
        {/* Only worth showing while Simple UI strips every marked element: it
         *  explains the dimmed preview and where to turn the mode off. */}
        {isSimpleUi && (
          <div
            className="settings-behavior-card"
            style={{
              display: "flex",
              gap: "var(--space-md)",
              alignItems: "flex-start",
              padding: "var(--space-md) var(--space-lg)",
              borderLeft: "3px solid var(--color-accent)",
            }}
          >
            <Info
              size={16}
              className="settings-section-icon"
              style={{ marginTop: 2, flexShrink: 0 }}
            />
            <span className="settings-checkbox-desc" style={{ margin: 0 }}>
              {t("settings.interface.masterNoteSimple")}
            </span>
          </div>
        )}

        <LayoutStudio />
      </div>

      {/* App-wide display modes and the overview detail sections — the only
       *  settings the live preview cannot change by itself. */}
      <InterfaceDefaults />
    </>
  );
}
