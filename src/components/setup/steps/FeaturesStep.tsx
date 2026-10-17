import { useAchievements } from "../../../context/AchievementContext";
import { useLanguage } from "../../../context/LanguageContext";
import { useSaves } from "../../../context/SavesContext";
import { useShelves } from "../../../context/ShelfContext";
import { useLayoutSettings, useSettings } from "../../../context/SettingsContext";
import { NAV_TAB_ITEMS } from "../../../pages/settings/interfaceItems";
import { SetupSection, SetupToggle } from "../SetupControls";
import { useOverlaySettings } from "../useOverlaySettings";

/**
 * Third step: which navigation tabs show, and the optional feature
 * masters that have a real backend switch (saves, overlay, capture,
 * Discord presence, hardware monitoring, local achievements).
 */
export default function FeaturesStep() {
  const { t } = useLanguage();
  const { interfaceVisibility, setInterfaceVisibility } = useLayoutSettings();
  const { discordRichPresence, setDiscordRichPresence, hardwareMonitoringEnabled, setHardwareMonitoringEnabled, isWindowsHost } = useSettings();
  const saves = useSaves();
  const overlay = useOverlaySettings();
  const achievements = useAchievements();
  const shelves = useShelves();

  return (
    <div className="setup-step">
      <SetupSection
        title={t("setup.features.tabs")}
        desc={t("setup.features.tabsDesc")}
        tip={t("setup.features.tabsTooltip")}
      >
        <div className="setup-toggle-list">
          {NAV_TAB_ITEMS.map((item) => {
            const label = t(item.labelKey);
            return (
              <SetupToggle
                key={item.key}
                title={label}
                tip={t("setup.features.tabTip", { tab: label })}
                checked={interfaceVisibility[item.key] !== false}
                onChange={(value) => setInterfaceVisibility(item.key, value)}
              />
            );
          })}
        </div>
      </SetupSection>

      <SetupSection
        title={t("setup.features.masters")}
        desc={t("setup.features.mastersDesc")}
        tip={t("setup.features.mastersTooltip")}
      >
        <div className="setup-toggle-list">
          <SetupToggle
            title={t("setup.features.saves")}
            desc={t("setup.features.savesDesc")}
            tip={t("setup.features.savesTip")}
            checked={saves.settings?.enabled ?? false}
            disabled={!saves.settings}
            onChange={(value) => void saves.updateSettings({ enabled: value })}
          />
          <SetupToggle
            title={t("setup.features.overlay")}
            desc={t("setup.features.overlayDesc")}
            tip={t("setup.features.overlayTip")}
            checked={overlay.settings.enabled}
            onChange={(value) => overlay.update({ enabled: value })}
          />
          <SetupToggle
            title={t("setup.features.capture")}
            desc={t("setup.features.captureDesc")}
            tip={t("setup.features.captureTip")}
            checked={overlay.settings.videoEnabled}
            disabled={!isWindowsHost}
            onChange={(value) => overlay.update({ videoEnabled: value })}
          />
          <SetupToggle
            title={t("setup.features.discord")}
            desc={t("setup.features.discordDesc")}
            tip={t("setup.features.discordTip")}
            checked={discordRichPresence}
            onChange={setDiscordRichPresence}
          />
          <SetupToggle
            title={t("setup.features.hardware")}
            desc={t("setup.features.hardwareDesc")}
            tip={t("setup.features.hardwareTip")}
            checked={hardwareMonitoringEnabled}
            onChange={setHardwareMonitoringEnabled}
          />
          <SetupToggle
            title={t("setup.features.achievements")}
            desc={t("setup.features.achievementsDesc")}
            tip={t("setup.features.achievementsTip")}
            checked={achievements.settings.localAchievementsEnabled}
            onChange={(value) =>
              achievements.updateSettings({ localAchievementsEnabled: value })
            }
          />
          <SetupToggle
            title={t("setup.features.shelves")}
            desc={t("setup.features.shelvesDesc")}
            tip={t("setup.features.shelvesTip")}
            checked={shelves.enabled}
            onChange={shelves.setEnabled}
          />
        </div>
      </SetupSection>
    </div>
  );
}
