import {
  useSettings,
  type DiscordStatusDisplay,
} from "../../context/SettingsContext";
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
 *  - General: the master enable toggle, connection status, and which line
 *    Discord shows in the member list
 *  - While playing: cover art, playtime, website + store buttons
 *  - While browsing / idle: page-activity presence and download status
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
    discordShowBrowsing,
    setDiscordShowBrowsing,
    discordShowDownloads,
    setDiscordShowDownloads,
    discordStatusDisplay,
    setDiscordStatusDisplay,
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

        {/* Member-list line: which field Discord shows next to your name */}
        <div className="settings-limit-row">
          <label
            className="settings-checkbox-label settings-checkbox-label--fixed"
            htmlFor="discord-status-display"
          >
            <span>{t("settings.discord.statusDisplayTitle")}</span>
          </label>
          <div className="settings-limit-value" style={{ minWidth: "220px" }}>
            <select
              id="discord-status-display"
              className="settings-select"
              value={discordStatusDisplay}
              disabled={!discordRichPresence}
              onChange={(e) =>
                setDiscordStatusDisplay(e.target.value as DiscordStatusDisplay)
              }
              aria-label={t("settings.discord.statusDisplayTitle")}
            >
              <option value="name">{t("settings.discord.statusDisplayName")}</option>
              <option value="state">{t("settings.discord.statusDisplayState")}</option>
              <option value="details">
                {t("settings.discord.statusDisplayDetails")}
              </option>
            </select>
          </div>
        </div>
        <p className="settings-launcher-group-note">
          {t("settings.discord.statusDisplayDesc")}
        </p>

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

        {/* Show store button (second button, e.g. Steam) */}
        <SettingsToggleCard
          title={t("settings.discord.showStoreButtonTitle")}
          desc={t("settings.discord.showStoreButtonDesc")}
          checked={discordShowStoreButton}
          disabled={!discordRichPresence}
          onChange={(v) => setDiscordShowStoreButton(v)}
        />

        {/* ── While browsing / idle ────────────────────────────── */}
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

        {/* Show active downloads when not playing */}
        <SettingsToggleCard
          title={t("settings.discord.showDownloadsTitle")}
          desc={t("settings.discord.showDownloadsDesc")}
          checked={discordShowDownloads}
          disabled={!discordRichPresence}
          onChange={(v) => setDiscordShowDownloads(v)}
        />
      </div>
    </SettingsSection>
  );
}
