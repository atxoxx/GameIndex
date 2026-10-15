import { useLanguage } from "../../../context/LanguageContext";
import { useSettings } from "../../../context/SettingsContext";
import { SetupSection, SetupToggle } from "../SetupControls";

/** Eighth step: startup and window behaviour. */
export default function StartupStep() {
  const { t } = useLanguage();
  const {
    startupSplashEnabled,
    setStartupSplashEnabled,
    closeToTray,
    setCloseToTray,
    minimizeOnLaunch,
    setMinimizeOnLaunch,
    restoreOnExit,
    setRestoreOnExit,
    autoStartEnabled,
    setAutoStartEnabled,
  } = useSettings();

  return (
    <div className="setup-step">
      <SetupSection title={t("setup.startup.heading")} desc={t("setup.startup.body")}>
        <div className="setup-toggle-list">
          <SetupToggle
            title={t("setup.startup.splash")}
            tip={t("setup.startup.splashTip")}
            checked={startupSplashEnabled}
            onChange={(value) => void setStartupSplashEnabled(value)}
          />
          <SetupToggle
            title={t("setup.startup.closeToTray")}
            tip={t("setup.startup.closeToTrayTip")}
            checked={closeToTray}
            onChange={(value) => void setCloseToTray(value)}
          />
          <SetupToggle
            title={t("setup.startup.minimize")}
            tip={t("setup.startup.minimizeTip")}
            checked={minimizeOnLaunch}
            onChange={(value) => void setMinimizeOnLaunch(value)}
          />
          <SetupToggle
            title={t("setup.startup.restore")}
            tip={t("setup.startup.restoreTip")}
            checked={restoreOnExit}
            onChange={(value) => void setRestoreOnExit(value)}
          />
          <SetupToggle
            title={t("setup.startup.autostart")}
            tip={t("setup.startup.autostartTip")}
            checked={autoStartEnabled}
            onChange={(value) => void setAutoStartEnabled(value)}
          />
        </div>
      </SetupSection>
    </div>
  );
}
