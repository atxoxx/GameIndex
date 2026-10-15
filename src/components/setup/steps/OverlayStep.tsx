import { useLanguage } from "../../../context/LanguageContext";
import { useSettings } from "../../../context/SettingsContext";
import { SetupSection, SetupToggle } from "../SetupControls";
import { useOverlaySettings } from "../useOverlaySettings";

/** Seventh step: the in-game HUD and the recorder. Both start off. */
export default function OverlayStep() {
  const { t } = useLanguage();
  const { isWindowsHost } = useSettings();
  const overlay = useOverlaySettings();

  return (
    <div className="setup-step">
      <SetupSection title={t("setup.overlay.heading")} desc={t("setup.overlay.body")}>
        <div className="setup-toggle-list">
          <SetupToggle
            title={t("setup.features.overlay")}
            tip={t("setup.overlay.hudTip")}
            checked={overlay.settings.enabled}
            onChange={(value) => overlay.update({ enabled: value })}
          />
          <SetupToggle
            title={t("setup.features.capture")}
            tip={t("setup.overlay.captureTip")}
            checked={overlay.settings.videoEnabled}
            disabled={!isWindowsHost}
            onChange={(value) => overlay.update({ videoEnabled: value })}
          />
        </div>
        {overlay.settings.enabled && (
          <p className="setup-section__note">{t("setup.overlay.hotkeyNote")}</p>
        )}
        {!isWindowsHost && (
          <p className="setup-section__note">{t("setup.overlay.unsupported")}</p>
        )}
      </SetupSection>
    </div>
  );
}
