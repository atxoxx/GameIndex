import { useSettings, type LandingPage } from "../../context/SettingsContext";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import SettingsSection from "./SettingsSection";
import SettingsToggleCard from "./SettingsToggleCard";
import { RocketIcon } from "./settingsIcons";

/**
 * LauncherTab — startup, window and launch behaviour, grouped into
 * labelled sub-sections so the options read as a small hierarchy
 * instead of a flat wall of cards:
 *
 *  - Startup: default landing page + auto-start on boot
 *  - Window behaviour: close-to-tray, minimize-on-launch, restore-on-exit
 *  - System access: UAC elevation bypass (warning variant)
 *
 *  Discord Rich Presence has its own dedicated tab (DiscordTab) since it
 *  grew per-option toggles; the master switch moved there too.
 */
export default function LauncherTab() {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const {
    closeToTray,
    setCloseToTray,
    minimizeOnLaunch,
    setMinimizeOnLaunch,
    restoreOnExit,
    setRestoreOnExit,
    disableElevationPrompts,
    setDisableElevationPrompts,
    autoStartEnabled,
    setAutoStartEnabled,
    landingPage,
    setLandingPage,
    ready,
  } = useSettings();

  return (
    <SettingsSection
      id="launcher"
      icon={<RocketIcon />}
      title={t("settings.tab.launcher")}
      desc={t("settings.launcher.desc")}
    >
      <div className="settings-launcher-grid">
        {/* ── Startup ─────────────────────────────────────────── */}
        <p className="settings-toggles-title settings-launcher-group-title" id="launcher-startup">
          {t("settings.launcher.groupStartup")}
        </p>

        {/* Landing page — where the app routes on open */}
        <div className="settings-behavior-card">
          <div className="settings-control">
            <label className="settings-label" htmlFor="settings-landing-page">
              {t("settings.launcher.landingTitle")}
            </label>
            <p className="settings-helper-lead">
              {t("settings.launcher.landingDesc")}
            </p>
            <div className="settings-input-group">
              <select
                id="settings-landing-page"
                className="settings-select"
                value={landingPage}
                onChange={(e) => {
                  const next = e.target.value as LandingPage;
                  setLandingPage(next);
                  showToast(
                    t("settingsPage.defaultPageSet", { page: t(`nav.${next}`) }),
                    "success",
                  );
                }}
              >
                <option value="home">{t("nav.home")}</option>
                <option value="library">{t("nav.library")}</option>
                <option value="store">{t("nav.store")}</option>
                <option value="wishlist">{t("nav.wishlist")}</option>
                <option value="deals">{t("nav.deals")}</option>
                <option value="activity">{t("nav.activity")}</option>
                <option value="achievements">{t("nav.achievements")}</option>
                <option value="downloads">{t("nav.downloads")}</option>
                <option value="storage">{t("nav.storage")}</option>
                <option value="news">{t("nav.news")}</option>
                <option value="community">{t("nav.community")}</option>
              </select>
            </div>
          </div>
        </div>

        {/* Auto-start on boot */}
        <SettingsToggleCard
          title={t("settings.launcher.autostartTitle")}
          desc={t("settings.launcher.autostartDesc")}
          checked={autoStartEnabled}
          disabled={!ready}
          onChange={(v) => {
            showToast(
              v
                ? t("settings.launcher.enablingAutoLaunch")
                : t("settings.launcher.disablingAutoLaunch"),
              "info",
            );
            setAutoStartEnabled(v).catch((err) => {
              showToast(t("settings.launcher.autostartFailed", { error: err }), "error");
            });
          }}
        />

        {/* ── Window behaviour ────────────────────────────────── */}
        <p className="settings-toggles-title settings-launcher-group-title" id="launcher-window">
          {t("settings.launcher.groupWindow")}
        </p>

        {/* Close-to-tray */}
        <SettingsToggleCard
          title={t("settings.launcher.trayTitle")}
          desc={t("settings.launcher.trayDesc")}
          checked={closeToTray}
          disabled={!ready}
          onChange={(v) => {
            void setCloseToTray(v);
            showToast(
              v
                ? t("settings.launcher.closeMinimize")
                : t("settings.launcher.closeExit"),
              "info",
            );
          }}
        />

        {/* Minimize on game launch */}
        <SettingsToggleCard
          title={t("settings.launcher.minimizeTitle")}
          desc={t("settings.launcher.minimizeDesc")}
          checked={minimizeOnLaunch}
          disabled={!ready}
          onChange={(v) => {
            void setMinimizeOnLaunch(v);
            showToast(
              v
                ? t("settings.launcher.minimizeOnLaunch")
                : t("settings.launcher.stayOpenOnLaunch"),
              "info",
            );
          }}
        />

        {/* Restore window when a game quits */}
        <SettingsToggleCard
          title={t("settings.launcher.restoreTitle")}
          desc={t("settings.launcher.restoreDesc")}
          checked={restoreOnExit}
          disabled={!ready || !minimizeOnLaunch}
          onChange={(v) => {
            void setRestoreOnExit(v);
            showToast(
              v
                ? t("settings.launcher.restoreOnExit")
                : t("settings.launcher.stayHiddenOnExit"),
              "info",
            );
          }}
        />

        {/* ── System access ───────────────────────────────────── */}
        <p className="settings-toggles-title settings-launcher-group-title" id="launcher-elevation">
          {t("settings.launcher.groupSystem")}
        </p>

        {/* Disable UAC elevation prompts */}
        <SettingsToggleCard
          title={t("settings.launcher.uacTitle")}
          desc={t("settings.launcher.uacDesc")}
          checked={disableElevationPrompts}
          disabled={!ready}
          warn
          onChange={(v) => {
            void setDisableElevationPrompts(v);
            showToast(
              v
                ? t("settings.launcher.uacDisabled")
                : t("settings.launcher.uacEnabled"),
              "info",
            );
          }}
        />

      </div>
    </SettingsSection>
  );
}
