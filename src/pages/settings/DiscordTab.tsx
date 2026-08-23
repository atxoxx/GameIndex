import { useSettings } from "../../context/SettingsContext";
import { useLanguage } from "../../context/LanguageContext";
import SettingsSection from "./SettingsSection";
import SettingsToggleCard from "./SettingsToggleCard";
import { DiscordIcon } from "./settingsIcons";

/**
 * DiscordTab — the dedicated Discord Rich Presence settings surface.
 * Replaces the single toggle that used to live in the Launcher tab with
 * a master switch plus per-option checkboxes so users can pick exactly
 * what gets broadcast to their Discord profile:
 *
 *  - General: the master enable toggle + Discord connection status
 *  - While playing: cover art, playtime, "View Website" button
 *  - While browsing: the page-activity presence
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
    discordShowBrowsing,
    setDiscordShowBrowsing,
  } = useSettings();

  return (
    <SettingsSection
      id="discord"
      icon={<DiscordIcon />}
      title={t("settings.tab.discord")}
      desc={t("settings.discord.tabDesc")}
    >
      <div className="settings-launcher-grid">
        {/* ── General ──────────────────────────────────────────── */}
        <p
          className="settings-toggles-title settings-launcher-group-title"
          id="discord-general"
        >
          {t("settings.discord.groupGeneral")}
        </p>

        {/* Master enable toggle */}
        <SettingsToggleCard
          title={t("settings.discord.title")}
          desc={t("settings.discord.desc")}
          checked={discordRichPresence}
          onChange={(v) => setDiscordRichPresence(v)}
        />
        {discordRichPresence && discordStatus === "notRunning" && (
          <p className="connect-prompt settings-launcher-group-note">
            {t("settings.discord.notRunning")}
          </p>
        )}

        {/* ── While playing ────────────────────────────────────── */}
        <p
          className="settings-toggles-title settings-launcher-group-title"
          id="discord-playing"
        >
          {t("settings.discord.groupPlaying")}
        </p>

        {/* Show game cover art (large image) */}
        <SettingsToggleCard
          title={t("settings.discord.showArtTitle")}
          desc={t("settings.discord.showArtDesc")}
          checked={discordShowArt}
          disabled={!discordRichPresence}
          onChange={(v) => setDiscordShowArt(v)}
        />

        {/* Show playtime (total + live session timer) */}
        <SettingsToggleCard
          title={t("settings.discord.showPlaytimeTitle")}
          desc={t("settings.discord.showPlaytimeDesc")}
          checked={discordShowPlaytime}
          disabled={!discordRichPresence}
          onChange={(v) => setDiscordShowPlaytime(v)}
        />

        {/* Show "View Website" button */}
        <SettingsToggleCard
          title={t("settings.discord.showButtonTitle")}
          desc={t("settings.discord.showButtonDesc")}
          checked={discordShowWebsiteButton}
          disabled={!discordRichPresence}
          onChange={(v) => setDiscordShowWebsiteButton(v)}
        />

        {/* ── While browsing ───────────────────────────────────── */}
        <p
          className="settings-toggles-title settings-launcher-group-title"
          id="discord-browsing"
        >
          {t("settings.discord.groupBrowsing")}
        </p>

        {/* Show browsing activity (which page you're on) */}
        <SettingsToggleCard
          title={t("settings.discord.showBrowsingTitle")}
          desc={t("settings.discord.showBrowsingDesc")}
          checked={discordShowBrowsing}
          disabled={!discordRichPresence}
          onChange={(v) => setDiscordShowBrowsing(v)}
        />
      </div>
    </SettingsSection>
  );
}
