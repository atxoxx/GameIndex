import { useSettings, type LandingPage } from "../../context/SettingsContext";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import SettingsRow from "./SettingsRow";
import SettingsSection from "./SettingsSection";
import SettingsSwitch from "./SettingsSwitch";
import { RocketIcon, SettingsGearIcon, ShieldIcon } from "./settingsIcons";

/**
 * LauncherTab — startup, window and launch behaviour, split into the same
 * three sections the catalog indexes so the jump list, search and the
 * Essentials filter all land on something real:
 *
 *  - Startup: default landing page + auto-start on boot
 *  - Window behaviour: close-to-tray, minimize-on-launch, restore-on-exit
 *  - System access: UAC elevation bypass (warning card, Windows only)
 *
 *  Discord Rich Presence has its own dedicated tab (DiscordTab) since it
 *  grew per-option toggles; the master switch lives there.
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
    isWindowsHost,
    autoStartEnabled,
    setAutoStartEnabled,
    landingPage,
    setLandingPage,
    ready,
  } = useSettings();

  const loadingHint = ready ? undefined : t("common.loading");

  return (
    <>
      <SettingsSection
        id="launcher-startup"
        icon={<RocketIcon />}
        title={t("settings.launcher.groupStartup")}
        desc={t("settingsPage.bootBehaviour")}
      >
        <SettingsRow
          id="setting-landing-page"
          title={t("settings.launcher.landingTitle")}
          desc={t("settings.launcher.landingDesc")}
          control={
            <select
              id="settings-landing-page"
              className="settings-select"
              value={landingPage}
              aria-label={t("settings.launcher.landingTitle")}
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
          }
        />

        <SettingsRow
          id="setting-autostart"
          title={t("settings.launcher.autostartTitle")}
          desc={t("settings.launcher.autostartDesc")}
          disabledHint={loadingHint}
          control={
            <SettingsSwitch
              label={t("settings.launcher.autostartTitle")}
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
                  showToast(
                    t("settings.launcher.autostartFailed", { error: err }),
                    "error",
                  );
                });
              }}
            />
          }
        />
      </SettingsSection>

      <SettingsSection
        id="launcher-window"
        icon={<SettingsGearIcon />}
        title={t("settings.launcher.groupWindow")}
      >
        <SettingsRow
          id="setting-close-to-tray"
          title={t("settings.launcher.trayTitle")}
          desc={t("settings.launcher.trayDesc")}
          disabledHint={loadingHint}
          control={
            <SettingsSwitch
              label={t("settings.launcher.trayTitle")}
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
          }
        />

        <SettingsRow
          id="setting-minimize-on-launch"
          title={t("settings.launcher.minimizeTitle")}
          desc={t("settings.launcher.minimizeDesc")}
          disabledHint={loadingHint}
          control={
            <SettingsSwitch
              label={t("settings.launcher.minimizeTitle")}
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
          }
        />

        <SettingsRow
          id="setting-restore-on-exit"
          title={t("settings.launcher.restoreTitle")}
          desc={t("settings.launcher.restoreDesc")}
          disabledHint={
            !ready
              ? t("common.loading")
              : minimizeOnLaunch
                ? undefined
                : t("settings.launcher.minimizeTitle")
          }
          control={
            <SettingsSwitch
              label={t("settings.launcher.restoreTitle")}
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
          }
        />
      </SettingsSection>

      {isWindowsHost && (
        <SettingsSection
          id="launcher-elevation"
          icon={<ShieldIcon />}
          title={t("settings.launcher.groupSystem")}
          advanced
        >
          <div
            className="settings-behavior-card settings-behavior-card--warn"
            role="note"
          >
            <SettingsRow
              id="setting-uac"
              title={t("settings.launcher.uacTitle")}
              desc={t("settings.launcher.uacDesc")}
              disabledHint={loadingHint}
              control={
                <SettingsSwitch
                  label={t("settings.launcher.uacTitle")}
                  checked={disableElevationPrompts}
                  disabled={!ready}
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
              }
            />
          </div>
        </SettingsSection>
      )}
    </>
  );
}
