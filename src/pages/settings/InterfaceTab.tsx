import { Info } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { useSettings } from "../../context/SettingsContext";
import LayoutStudio from "./LayoutStudio";
import InterfaceDefaults from "./InterfaceDefaults";
import "./InterfaceTab.css";

/**
 * InterfaceTab
 * ────────────
 * The Interface tab leads with the Layout Studio: an editable map of the app
 * shell with a live preview, rendered directly in the page rather than behind
 * a modal. Directly below it, InterfaceDefaults hosts the global shell
 * controls the preview cannot change by itself — interface scale, layout
 * modes, sidebar side, card-badge and widget masters, the overview detail
 * sections and the startup landing page — as ordinary settings sections.
 */
export default function InterfaceTab() {
  const { t } = useLanguage();
  const { isSimpleUi } = useSettings();

  return (
    <>
      <div className="interface-tab-shell">
        {/* Only worth showing while Simple UI strips every marked element: it
         *  explains the empty studio and where to turn the mode off. */}
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

      {/* Global controls that used to live in the studio's right-hand pane.
       *  Rendered as normal settings sections so the tab keeps the shared
       *  section rhythm and scrolls with the rest of the page. */}
      <InterfaceDefaults />
    </>
  );
}
