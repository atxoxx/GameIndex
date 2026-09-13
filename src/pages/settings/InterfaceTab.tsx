import { Info } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { useSettings } from "../../context/SettingsContext";
import LayoutStudio from "./LayoutStudio";
import "./InterfaceTab.css";

/**
 * InterfaceTab
 * ────────────
 * The Interface tab *is* the Layout Studio: an editable map of the app shell
 * with a live preview, rendered directly in the page rather than behind a
 * modal. Everything that used to be listed here as flat toggles — navbar tabs
 * and buttons, card badges, page widgets, the game/store detail sections and
 * the layout modes — is arranged in one place, so there is no second source of
 * truth and no dead anchor for the settings catalog to jump to.
 */
export default function InterfaceTab() {
  const { t } = useLanguage();
  const { isSimpleUi } = useSettings();

  return (
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
  );
}
