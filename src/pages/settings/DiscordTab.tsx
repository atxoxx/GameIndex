import {
  useSettings,
  type DiscordStatusDisplay,
} from "../../context/SettingsContext";
import { useLanguage } from "../../context/LanguageContext";
import SettingsRow from "./SettingsRow";
import SettingsSection from "./SettingsSection";
import SettingsSwitch from "./SettingsSwitch";
import { DiscordIcon, GamepadIcon, GlobeIcon } from "./settingsIcons";

/**
 * DiscordTab — the dedicated Discord Rich Presence settings surface.
 * Replaces the single toggle that used to live in the Launcher tab with
 * a master switch plus per-option switches so users can pick exactly
 * what gets broadcast to their Discord profile:
 *
 *  - General: the master enable switch and which line Discord shows in
 *    the member list
 *  - While playing: cover art, playtime, website + store buttons,
 *    achievement progress and extra details
 *  - While browsing: page-activity presence and download status
 *
 * The per-option flags are read at emit time by the presence emitters
 * (useSessions / useDiscordPresence), so changes apply to the next game
 * launch or route change without a restart.
 */
export default function DiscordTab() {
  const { t } = useLanguage();
  const {
    discordRichPresence,
    setDiscordRichPresence,
    discordStatus,
    discordShowArt,
    setDiscordShowArt,
    discordShowPlaytime,
    setDiscordShowPlaytime,
    discordShowWebsiteButton,
    setDiscordShowWebsiteButton,
    discordShowStoreButton,
    setDiscordShowStoreButton,
    discordShowAchievements,
    setDiscordShowAchievements,
    discordShowExtraDetails,
    setDiscordShowExtraDetails,
    discordShowBrowsing,
    setDiscordShowBrowsing,
    discordShowDownloads,
    setDiscordShowDownloads,
    discordStatusDisplay,
    setDiscordStatusDisplay,
  } = useSettings();

  const notRunning = discordRichPresence && discordStatus === "notRunning";
  const dependentHint = discordRichPresence
    ? undefined
    : t("settings.discord.title");

  return (
    <>
      <SettingsSection
        id="discord-general"
        icon={<DiscordIcon />}
        title={t("settings.discord.groupGeneral")}
        desc={t("settings.discord.tabDesc")}
      >
        <SettingsRow
          id="setting-discord-enabled"
          title={t("settings.discord.title")}
          desc={
            notRunning ? (
              <>
                {t("settings.discord.desc")}
                <br />
                {t("settings.discord.notRunning")}
              </>
            ) : (
              t("settings.discord.desc")
            )
          }
          control={
            <SettingsSwitch
              label={t("settings.discord.title")}
              checked={discordRichPresence}
              onChange={(v) => setDiscordRichPresence(v)}
            />
          }
        />

        <SettingsRow
          id="setting-discord-status-display"
          title={t("settings.discord.statusDisplayTitle")}
          desc={t("settings.discord.statusDisplayDesc")}
          disabledHint={dependentHint}
          control={
            <select
              id="discord-status-display"
              className="settings-select"
              value={discordStatusDisplay}
              disabled={!discordRichPresence}
              aria-label={t("settings.discord.statusDisplayTitle")}
              onChange={(e) =>
                setDiscordStatusDisplay(e.target.value as DiscordStatusDisplay)
              }
            >
              <option value="name">{t("settings.discord.statusDisplayName")}</option>
              <option value="state">{t("settings.discord.statusDisplayState")}</option>
              <option value="details">
                {t("settings.discord.statusDisplayDetails")}
              </option>
            </select>
          }
        />
      </SettingsSection>

      <SettingsSection
        id="discord-playing"
        icon={<GamepadIcon />}
        title={t("settings.discord.groupPlaying")}
        advanced
      >
        <SettingsRow
          title={t("settings.discord.showArtTitle")}
          desc={t("settings.discord.showArtDesc")}
          disabledHint={dependentHint}
          control={
            <SettingsSwitch
              label={t("settings.discord.showArtTitle")}
              checked={discordShowArt}
              disabled={!discordRichPresence}
              onChange={(v) => setDiscordShowArt(v)}
            />
          }
        />

        <SettingsRow
          title={t("settings.discord.showPlaytimeTitle")}
          desc={t("settings.discord.showPlaytimeDesc")}
          disabledHint={dependentHint}
          control={
            <SettingsSwitch
              label={t("settings.discord.showPlaytimeTitle")}
              checked={discordShowPlaytime}
              disabled={!discordRichPresence}
              onChange={(v) => setDiscordShowPlaytime(v)}
            />
          }
        />

        <SettingsRow
          title={t("settings.discord.showButtonTitle")}
          desc={t("settings.discord.showButtonDesc")}
          disabledHint={dependentHint}
          control={
            <SettingsSwitch
              label={t("settings.discord.showButtonTitle")}
              checked={discordShowWebsiteButton}
              disabled={!discordRichPresence}
              onChange={(v) => setDiscordShowWebsiteButton(v)}
            />
          }
        />

        <SettingsRow
          title={t("settings.discord.showStoreButtonTitle")}
          desc={t("settings.discord.showStoreButtonDesc")}
          disabledHint={dependentHint}
          control={
            <SettingsSwitch
              label={t("settings.discord.showStoreButtonTitle")}
              checked={discordShowStoreButton}
              disabled={!discordRichPresence}
              onChange={(v) => setDiscordShowStoreButton(v)}
            />
          }
        />

        <SettingsRow
          title={t("settings.discord.showAchievementsTitle")}
          desc={t("settings.discord.showAchievementsDesc")}
          disabledHint={dependentHint}
          control={
            <SettingsSwitch
              label={t("settings.discord.showAchievementsTitle")}
              checked={discordShowAchievements}
              disabled={!discordRichPresence}
              onChange={(v) => setDiscordShowAchievements(v)}
            />
          }
        />

        <SettingsRow
          title={t("settings.discord.showExtraDetailsTitle")}
          desc={t("settings.discord.showExtraDetailsDesc")}
          disabledHint={dependentHint}
          control={
            <SettingsSwitch
              label={t("settings.discord.showExtraDetailsTitle")}
              checked={discordShowExtraDetails}
              disabled={!discordRichPresence}
              onChange={(v) => setDiscordShowExtraDetails(v)}
            />
          }
        />
      </SettingsSection>

      <SettingsSection
        id="discord-browsing"
        icon={<GlobeIcon />}
        title={t("settings.discord.groupBrowsing")}
        advanced
      >
        <SettingsRow
          title={t("settings.discord.showBrowsingTitle")}
          desc={t("settings.discord.showBrowsingDesc")}
          disabledHint={dependentHint}
          control={
            <SettingsSwitch
              label={t("settings.discord.showBrowsingTitle")}
              checked={discordShowBrowsing}
              disabled={!discordRichPresence}
              onChange={(v) => setDiscordShowBrowsing(v)}
            />
          }
        />

        <SettingsRow
          title={t("settings.discord.showDownloadsTitle")}
          desc={t("settings.discord.showDownloadsDesc")}
          disabledHint={dependentHint}
          control={
            <SettingsSwitch
              label={t("settings.discord.showDownloadsTitle")}
              checked={discordShowDownloads}
              disabled={!discordRichPresence}
              onChange={(v) => setDiscordShowDownloads(v)}
            />
          }
        />
      </SettingsSection>
    </>
  );
}
