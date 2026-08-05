import { useState } from "react";

import { useSettings, type SyncIntervalMinutes } from "../../context/SettingsContext";
import { useAchievements } from "../../context/AchievementContext";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { Button, ConfirmModal } from "../../components/ui";
import SettingsSection from "./SettingsSection";
import IntegrationTile from "./IntegrationTile";
import type { useIntegrations } from "./useIntegrations";
import { HumbleToggle, UplayToggle } from "./IntegrationToggles";
import { EpicIcon, GogIcon, HumbleIcon, IntegrationsIcon, RockstarIcon, SteamIcon, UplayIcon } from "./settingsIcons";

type Integrations = ReturnType<typeof useIntegrations>;

interface ConfirmRequest {
  title: string;
  message: string;
  onConfirm: () => void;
}

/** Modal-based replacement for the old `window.confirm()` disconnect /
 *  remove-games flows — consistent with the rest of the app. */
function useConfirm() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  return {
    request,
    confirm: (req: ConfirmRequest) => setRequest(req),
    dismiss: () => setRequest(null),
  };
}

export default function IntegrationsTab({ integrations }: { integrations: Integrations }) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { syncIntervalMinutes, setSyncIntervalMinutes, historyCapDays, setHistoryCapDays, hideAchievementProgress, setHideAchievementProgress, discordRichPresence, setDiscordRichPresence, discordStatus, steamAutoDetect, setSteamAutoDetect } = useSettings();
  const { settings: achievementSettings, updateSettings: updateAchievementSettings } = useAchievements();

  const confirm = useConfirm();

  const {
    steam,
    epic,
    gog,
    humble,
    rockstar,
    uplay,
    platformGameCount,
    removeIntegrationGames,
  } = integrations;

  /** Open the confirm modal for wiping every game imported from a store. */
  const confirmRemoveGames = (platform: string) => {
    confirm.confirm({
      title: t("settings.integrations.removeGames"),
      message: t("settings.integrations.confirmRemoveGames", {
        count: platformGameCount(platform),
        platform,
      }),
      onConfirm: () => removeIntegrationGames(platform),
    });
  };

  /** Open the confirm modal for disconnecting a store account. */
  const confirmDisconnect = (
    platformKey: string,
    onConfirm: () => void,
  ) => {
    confirm.confirm({
      title: t("settings.integrations.removeConnection"),
      message: t(platformKey),
      onConfirm,
    });
  };

  return (
    <>
      <SettingsSection
        icon={<IntegrationsIcon />}
        title={t("settings.tab.integrations")}
        desc={t("settings.integrations.desc")}
      >
        {/* ── Steam ── */}
        <IntegrationTile
          brand="steam"
          id="integration-steam"
          icon={<SteamIcon />}
          name={t("settings.integration.steam")}
          description={t("settingsPage.steamIntegration")}
          connected={steam.steamAuth.isAuthenticated}
          badgeLabel={t("settingsPage.connected")}
          status={
            steam.steamAuth.isAuthenticated ? (
              <div className="auth-status">
                {t("settingsPage.connected")}
                {steam.steamAuth.session?.displayName ? ` as ${steam.steamAuth.session.displayName}` : ""}
                {steam.steamAuth.session?.steamId ? ` (ID: ${steam.steamAuth.session.steamId.slice(0, 8)}…)` : ""}
              </div>
            ) : (
              <p className="connect-prompt">{t("settingsPage.steamConnectPrompt")}</p>
            )
          }
          note={t("settingsPage.steamAuthNote")}
          actions={
            <>
              {steam.steamAuth.isAuthenticated ? (
                <Button variant="primary" onClick={() => steam.handleSyncNow()} isLoading={steam.isSyncing}>
                  {t("settings.integrations.syncLibrary")}
                </Button>
              ) : (
                <Button
                  variant="primary"
                  onClick={() => { void steam.handleSteamLogin(); }}
                  isLoading={steam.isSteamLoggingIn}
                  disabled={!steam.steamAuthReady}
                >
                  {t("settings.integrations.connectSteam")}
                </Button>
              )}
              <Button variant="danger"                  onClick={() => confirmRemoveGames("Steam")}>
                {t("settings.integrations.removeGames")}
              </Button>
            </>
          }
          result={
            steam.syncResult && (
              <div className={`sync-result ${steam.syncResult.success ? "success" : "error"}`}>
                {steam.syncResult.success
                  ? `✓ ${t("settings.sync.steamOk", {
                      games: steam.syncResult.gamesSynced ?? 0,
                      playtime: steam.syncResult.playtimeUpdated ?? 0,
                      ach: steam.steamSettings.syncAchievements && steam.syncResult.achievementsSynced
                        ? t("settings.sync.achSynced", { count: steam.syncResult.achievementsSynced })
                        : "",
                    })}`
                  : `✗ ${steam.syncResult.error || t("settings.sync.failed")}`}
              </div>
            )
          }
          dangerZone={
            steam.steamAuth.isAuthenticated && (
              <div className="danger-zone">
                <p className="danger-zone-text">{t("settingsPage.disconnectSteam")}</p>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() =>
                    confirmDisconnect("settings.integrations.confirmRemove.steam", () => {
                      void steam.disconnectSteam();
                    })
                  }
                >
                  {t("settings.disconnect")}
                </Button>
              </div>
            )
          }
        >
          {/* API-key + SteamID64 paste-in flow (only when disconnected) */}
          {!steam.steamAuth.isAuthenticated && steam.steamAuthReady && (
            <div className="integration-tile-form">
              <label className="settings-control">
                <div className="settings-label-row">
                  <span className="settings-label">{t("settings.label.steamApiKey")}</span>
                  <a
                    href="https://steamcommunity.com/dev/apikey"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="settings-link"
                  >
                    {t("settingsPage.getApiKey")}
                  </a>
                </div>
                <input
                  type="password"
                  className="settings-input"
                  value={steam.steamApiKey}
                  onChange={(e) => {
                    steam.setSteamApiKey(e.target.value);
                    localStorage.setItem("gamelib-steam-apikey", e.target.value);
                  }}
                  autoComplete="off"
                  placeholder={t("settingsPage.steamApiKey")}
                  disabled={steam.isSteamLoggingIn}
                />
              </label>
              <label className="settings-control">
                <div className="settings-label-row">
                  <span className="settings-label">{t("settings.label.steamId")}</span>
                  <a
                    href="https://steamid.pro/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="settings-link"
                  >
                    {t("settingsPage.findSteamId")}
                  </a>
                </div>
                <input
                  type="text"
                  className="settings-input"
                  value={steam.steamId}
                  onChange={(e) => {
                    steam.setSteamId(e.target.value);
                    localStorage.setItem("gamelib-steam-steamid", e.target.value);
                  }}
                  autoComplete="off"
                  inputMode="numeric"
                  pattern="[0-9]{17}"
                  placeholder={t("settingsPage.steamIdHint")}
                  disabled={steam.isSteamLoggingIn}
                />
              </label>
            </div>
          )}

          {steam.steamAuth.isAuthenticated && (
            <div className="settings-toggles-group">
              <p className="settings-toggles-group-title">{t("settingsPage.syncBehaviour")}</p>
              {(
                [
                  ["autoSyncOnLaunch", t("settingsPage.autoSyncLaunch")],
                  ["syncPlaytime", t("settingsPage.syncPlaytime")],
                  ["syncAchievements", t("settingsPage.syncAchievements")],
                ] as const
              ).map(([key, label]) => (
                <label className="settings-checkbox-label" key={key}>
                  <input
                    type="checkbox"
                    checked={steam.steamSettings[key]}
                    onChange={(e) => {
                      const u = { ...steam.steamSettings, [key]: e.target.checked };
                      steam.setSteamSettings(u);
                      localStorage.setItem("gamelib-steam-settings", JSON.stringify(u));
                    }}
                  />
                  <span>{label}</span>
                </label>
              ))}
              <label className="settings-checkbox-label settings-checkbox-label--disabled">
                <input type="checkbox" checked disabled />
                <span>{t("settingsPage.igdbAutoLoad")}</span>
              </label>
              <label className="settings-checkbox-label">
                <input
                  type="checkbox"
                  checked={steamAutoDetect}
                  onChange={(e) => {
                    setSteamAutoDetect(e.target.checked);
                  }}
                />
                <span>{t("settingsPage.detectNewSteam")}</span>
              </label>
            </div>
          )}
        </IntegrationTile>

        {/* ── Epic Games ── */}
        <IntegrationTile
          brand="epic"
          id="integration-epic"
          icon={<EpicIcon />}
          name={t("settings.integration.epicGames")}
          description={t("settingsPage.epicIntegration")}
          connected={epic.epicAuth.isAuthenticated}
          badgeLabel={t("settingsPage.connected")}
          status={
            epic.epicAuth.isAuthenticated ? (
              <div className="auth-status">
                {t("settingsPage.connected")}
                {epic.epicAuth.displayName ? ` as ${epic.epicAuth.displayName}` : ""}
                {epic.epicAuth.accountId ? ` (ID: ${epic.epicAuth.accountId.slice(0, 8)}…)` : ""}
              </div>
            ) : (
              <p className="connect-prompt">{t("settingsPage.epicConnectPrompt")}</p>
            )
          }
          actions={
            <>
              {epic.epicAuth.isAuthenticated ? (
                <Button variant="primary" onClick={epic.handleEpicSync} isLoading={epic.isEpicSyncing}>
                  {t("settings.integrations.syncLibrary")}
                </Button>
              ) : (
                <Button variant="primary" onClick={epic.handleEpicLogin} isLoading={epic.isEpicLoggingIn}>
                  {t("settings.integrations.connectEpic")}
                </Button>
              )}
              <Button variant="danger"                  onClick={() => confirmRemoveGames("Epic")}>
                {t("settings.integrations.removeGames")}
              </Button>
            </>
          }
          result={
            epic.epicSyncResult && (
              <div className={`sync-result ${epic.epicSyncResult.success ? "success" : "error"}`}>
                {epic.epicSyncResult.success
                  ? `✓ ${t("settings.sync.importedOk", {
                      games: epic.epicSyncResult.gamesImported,
                      extra: epic.epicSyncResult.gamesSkipped > 0
                        ? t("settings.sync.skipped", { count: epic.epicSyncResult.gamesSkipped })
                        : "",
                    })}`
                  : `✗ ${epic.epicSyncResult.errors?.[0] || t("settings.sync.failed")}`}
              </div>
            )
          }
          lastSync={
            epic.epicAuth.lastSync ? (
              <p className="sync-result-time">
                {t("settingsPage.lastSync", { time: new Date(epic.epicAuth.lastSync * 1000).toLocaleString() })}
              </p>
            ) : undefined
          }
          dangerZone={
            epic.epicAuth.isAuthenticated && (
              <div className="danger-zone">
                <p className="danger-zone-text">{t("settingsPage.disconnectEpic")}</p>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() =>
                    confirmDisconnect("settings.integrations.confirmRemove.epic", () => {
                      void epic.disconnectEpic();
                    })
                  }
                >
                  {t("settings.disconnect")}
                </Button>
              </div>
            )
          }
        >
          {epic.epicStaleSession && (
            <div className="epic-stale-banner">
              <p className="epic-stale-banner-text">{t("settingsPage.epicStaleBanner")}</p>
              <Button size="sm" variant="primary" onClick={epic.handleEpicRecover} isLoading={epic.isEpicRecovering}>
                {t("settings.integrations.reconnectToken")}
              </Button>
            </div>
          )}
        </IntegrationTile>

        {/* ── GOG Galaxy ── */}
        <IntegrationTile
          brand="gog"
          id="integration-gog"
          icon={<GogIcon />}
          name={t("settings.integration.gogGalaxy")}
          description={t("settingsPage.gogIntegration")}
          connected={gog.gogAuth.isAuthenticated}
          badgeLabel={t("settingsPage.connected")}
          status={
            gog.gogAuth.isAuthenticated ? (
              <div className="auth-status">
                {t("settingsPage.connected")}
                {gog.gogAuth.username ? ` as ${gog.gogAuth.username}` : ""}
                {gog.gogAuth.userId ? ` (ID: ${gog.gogAuth.userId})` : ""}
              </div>
            ) : (
              <p className="connect-prompt">{t("settingsPage.gogConnectPrompt")}</p>
            )
          }
          note={t("settingsPage.gogAuthNote")}
          actions={
            <>
              {gog.gogAuth.isAuthenticated ? (
                <Button variant="primary" onClick={gog.handleGogSync} isLoading={gog.isGogSyncing}>
                  {t("settings.integrations.syncLibrary")}
                </Button>
              ) : (
                <Button variant="primary" onClick={gog.handleGogLogin} isLoading={gog.isGogLoggingIn}>
                  {t("settings.integrations.connectGog")}
                </Button>
              )}
              <Button variant="danger"                  onClick={() => confirmRemoveGames("GOG")}>
                {t("settings.integrations.removeGames")}
              </Button>
            </>
          }
          result={
            gog.gogSyncResult && (
              <div className={`sync-result ${gog.gogSyncResult.success ? "success" : "error"}`}>
                {gog.gogSyncResult.success
                  ? `✓ ${t("settings.sync.importedOk", {
                      games: gog.gogSyncResult.gamesImported,
                      extra: gog.gogSyncResult.errors.length > 0
                        ? t("settings.sync.warnings", { count: gog.gogSyncResult.errors.length })
                        : "",
                    })}`
                  : `✗ ${gog.gogSyncResult.errors?.[0] || t("settings.sync.failed")}`}
              </div>
            )
          }
          lastSync={
            gog.gogAuth.lastSync ? (
              <p className="sync-result-time">
                {t("settingsPage.lastSync", { time: new Date(gog.gogAuth.lastSync * 1000).toLocaleString() })}
              </p>
            ) : undefined
          }
          dangerZone={
            gog.gogAuth.isAuthenticated && (
              <div className="danger-zone">
                <p className="danger-zone-text">{t("settingsPage.disconnectGog")}</p>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() =>
                    confirmDisconnect("settings.integrations.confirmRemove.gog", () => {
                      void gog.disconnectGog();
                    })
                  }
                >
                  {t("settings.disconnect")}
                </Button>
              </div>
            )
          }
        />

        {/* ── Humble Bundle ── */}
        <IntegrationTile
          brand="humble"
          id="integration-humble"
          icon={<HumbleIcon />}
          name={t("settings.integration.humbleBundle")}
          description={t("settingsPage.humbleIntegration")}
          connected={humble.humbleAuth.isAuthenticated}
          badgeLabel={t("settingsPage.connected")}
          status={
            humble.humbleAuth.isAuthenticated ? (
              <div className="auth-status">
                {t("settingsPage.connected")}
                {humble.humbleAuth.username ? ` as ${humble.humbleAuth.username}` : ""}
              </div>
            ) : (
              <p className="connect-prompt">{t("settingsPage.humbleConnectPrompt")}</p>
            )
          }
          note={t("settingsPage.humbleAuthNote")}
          actions={
            <>
              {humble.humbleAuth.isAuthenticated ? (
                <Button variant="primary" onClick={humble.handleHumbleSync} isLoading={humble.isHumbleSyncing}>
                  {t("settings.integrations.syncLibrary")}
                </Button>
              ) : (
                <Button variant="primary" onClick={humble.handleHumbleLogin} isLoading={humble.isHumbleLoggingIn}>
                  {t("settings.integrations.connectHumble")}
                </Button>
              )}
              <Button variant="danger"                  onClick={() => confirmRemoveGames("Humble")}>
                {t("settings.integrations.removeGames")}
              </Button>
            </>
          }
          result={
            humble.humbleSyncResult && (
              <div className={`sync-result ${humble.humbleSyncResult.success ? "success" : "error"}`}>
                {humble.humbleSyncResult.success
                  ? `✓ ${t("settings.sync.importedOk", {
                      games: humble.humbleSyncResult.gamesImported,
                      extra: humble.humbleSyncResult.errors.length > 0
                        ? t("settings.sync.warnings", { count: humble.humbleSyncResult.errors.length })
                        : "",
                    })}`
                  : `✗ ${humble.humbleSyncResult.errors?.[0] || t("settings.sync.failed")}`}
              </div>
            )
          }
          lastSync={
            humble.humbleAuth.lastSync ? (
              <p className="sync-result-time">
                {t("settingsPage.lastSync", { time: new Date(humble.humbleAuth.lastSync * 1000).toLocaleString() })}
              </p>
            ) : undefined
          }
          dangerZone={
            humble.humbleAuth.isAuthenticated && (
              <div className="danger-zone">
                <p className="danger-zone-text">{t("settingsPage.disconnectHumble")}</p>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() =>
                    confirmDisconnect("settings.integrations.confirmRemove.humble", () => {
                      void humble.disconnectHumble();
                    })
                  }
                >
                  {t("settings.disconnect")}
                </Button>
              </div>
            )
          }
        >
          <div className="humble-settings-grid">
            <HumbleToggle
              label={t("settingsPage.humbleToggleGeneralLib")}
              hint={t("settingsPage.humbleToggleGeneralLibHint")}
              checked={humble.humbleSettings.importGeneralLibrary}
              disabled={!humble.humbleAuth.isAuthenticated}
              onChange={(v) => humble.updateHumbleSetting("importGeneralLibrary", v)}
            />
            <HumbleToggle
              label={t("settingsPage.humbleToggleGameExtras")}
              hint={t("settingsPage.humbleToggleGameExtrasHint")}
              checked={humble.humbleSettings.importGameExtras}
              disabled={!humble.humbleAuth.isAuthenticated}
              onChange={(v) => humble.updateHumbleSetting("importGameExtras", v)}
            />
            <HumbleToggle
              label={t("settingsPage.humbleToggleTrove")}
              hint={t("settingsPage.humbleToggleTroveHint")}
              checked={humble.humbleSettings.importTroveGames}
              disabled={!humble.humbleAuth.isAuthenticated}
              onChange={(v) => humble.updateHumbleSetting("importTroveGames", v)}
            />
            <HumbleToggle
              label={t("settingsPage.humbleToggleIgnoreThirdParty")}
              hint={t("settingsPage.humbleToggleIgnoreThirdPartyHint")}
              checked={humble.humbleSettings.ignoreThirdPartyStoreGames}
              disabled={!humble.humbleAuth.isAuthenticated}
              onChange={(v) => humble.updateHumbleSetting("ignoreThirdPartyStoreGames", v)}
            />
            <HumbleToggle
              label={t("settingsPage.humbleToggleThirdPartyDrmFree")}
              hint={t("settingsPage.humbleToggleThirdPartyDrmFreeHint")}
              checked={humble.humbleSettings.importThirdPartyDrmFree}
              disabled={!humble.humbleAuth.isAuthenticated}
              onChange={(v) => humble.updateHumbleSetting("importThirdPartyDrmFree", v)}
            />
            <HumbleToggle
              label={t("settingsPage.humbleToggleLaunchApp")}
              hint={t("settingsPage.humbleToggleLaunchAppHint")}
              checked={humble.humbleSettings.launchViaHumbleApp}
              disabled={!humble.humbleAuth.isAuthenticated}
              onChange={(v) => humble.updateHumbleSetting("launchViaHumbleApp", v)}
            />
          </div>
        </IntegrationTile>

        {/* ── Rockstar Games Launcher ── */}
        <IntegrationTile
          brand="rockstar"
          id="integration-rockstar"
          icon={<RockstarIcon />}
          name={t("settings.integration.rockstarGamesLauncher")}
          description={t("settings.rockstar.desc")}
          connected={!!rockstar.rockstarSyncResult?.clientInstalled}
          badgeLabel={t("settings.integration.detected")}
          status={
            rockstar.rockstarSyncResult?.clientInstalled ? (
              <div className="auth-status">
                {t("settings.rockstar.detected")}
                {rockstar.rockstarSyncResult.clientPath
                  ? ` at ${rockstar.rockstarSyncResult.clientPath}`
                  : ""}
              </div>
            ) : (
              <p className="connect-prompt">{t("settings.rockstar.notInstalled")}</p>
            )
          }
          note={t("settings.rockstar.localNote")}
          actions={
            <>
              <Button variant="primary" onClick={rockstar.handleRockstarSync} isLoading={rockstar.isRockstarSyncing}>
                {t("settings.rockstar.scanBtn")}
              </Button>
              <Button variant="danger"                  onClick={() => confirmRemoveGames("Rockstar")}>
                {t("settings.integrations.removeGames")}
              </Button>
            </>
          }
          result={
            rockstar.rockstarSyncResult && (
              <div className={`sync-result ${rockstar.rockstarSyncResult.success ? "success" : "error"}`}>
                {rockstar.rockstarSyncResult.success
                  ? `✓ ${t("settings.sync.scannedOk", {
                      games: rockstar.rockstarSyncResult.gamesImported,
                      extra: rockstar.rockstarSyncResult.errors.length > 0
                        ? t("settings.sync.warnings", { count: rockstar.rockstarSyncResult.errors.length })
                        : "",
                    })}`
                  : `✗ ${rockstar.rockstarSyncResult.errors?.[0] || t("settings.scan.failed")}`}
              </div>
            )
          }
          lastSync={
            rockstar.rockstarSyncResult?.lastSync ? (
              <p className="sync-result-time">
                {t("settingsPage.lastScan", { time: new Date(rockstar.rockstarSyncResult.lastSync * 1000).toLocaleString() })}
              </p>
            ) : undefined
          }
        />

        {/* ── Ubisoft Connect (Uplay) ── */}
        <IntegrationTile
          brand="uplay"
          id="integration-uplay"
          icon={<UplayIcon />}
          name={t("settings.integration.ubisoftConnect")}
          description={t("settings.ubisoft.desc")}
          connected={!!uplay.uplaySyncResult?.clientInstalled}
          badgeLabel={t("settings.integration.detected")}
          status={
            uplay.uplaySyncResult?.clientInstalled ? (
              <div className="auth-status">
                {t("settings.ubisoft.detected")}
                {uplay.uplaySyncResult.clientPath
                  ? ` at ${uplay.uplaySyncResult.clientPath}`
                  : ""}
              </div>
            ) : (
              <p className="connect-prompt">{t("settings.ubisoft.notInstalled")}</p>
            )
          }
          note={t("settings.ubisoft.localNote")}
          actions={
            <>
              <Button variant="primary" onClick={uplay.handleUplaySync} isLoading={uplay.isUplaySyncing}>
                {t("settings.ubisoft.syncBtn")}
              </Button>
              <Button variant="danger"                  onClick={() => confirmRemoveGames("Ubisoft")}>
                {t("settings.integrations.removeGames")}
              </Button>
            </>
          }
          result={
            uplay.uplaySyncResult && (
              <div className={`sync-result ${uplay.uplaySyncResult.success ? "success" : "error"}`}>
                {uplay.uplaySyncResult.success
                  ? `✓ ${t("settings.sync.scannedOk", {
                      games: uplay.uplaySyncResult.gamesImported,
                      extra: uplay.uplaySyncResult.errors.length > 0
                        ? t("settings.sync.warnings", { count: uplay.uplaySyncResult.errors.length })
                        : "",
                    })}`
                  : `✗ ${uplay.uplaySyncResult.errors?.[0] || t("settings.sync.failed")}`}
              </div>
            )
          }
          lastSync={
            uplay.uplaySyncResult?.lastSync ? (
              <p className="sync-result-time">
                {t("settingsPage.lastSync", { time: new Date(uplay.uplaySyncResult.lastSync * 1000).toLocaleString() })}
              </p>
            ) : undefined
          }
        >
          <div className="humble-settings-grid">
            <UplayToggle
              label={t("settings.integrations.uplay.importInstalled")}
              hint={t("settings.integrations.uplay.importInstalledHint")}
              checked={uplay.uplaySettings.importInstalledGames}
              onChange={(v) => uplay.updateUplaySetting("importInstalledGames", v)}
            />
            <UplayToggle
              label={t("settings.integrations.uplay.importUninstalled")}
              hint={t("settings.integrations.uplay.importUninstalledHint")}
              checked={uplay.uplaySettings.importUninstalledGames}
              onChange={(v) => uplay.updateUplaySetting("importUninstalledGames", v)}
            />
          </div>
        </IntegrationTile>

        <p className="integration-footer">{t("settings.integrations.footerNotice")}</p>
      </SettingsSection>

      {/* ── Data & sync preferences (across vendors) ── */}
      <SettingsSection
        id="section-datasync"
        icon={<IntegrationsIcon />}
        title={t("settings.section.dataSync")}
        desc={t("settings.dataSync.desc")}
      >
        <div className="settings-data-grid">
          <div className="settings-launcher-card">
            <div className="settings-control">
              <label className="settings-label">{t("settings.label.autoSync")}</label>
              <p className="settings-helper-lead">{t("settingsPage.autoSyncInterval")}</p>
              <div className="settings-input-group">
                <select
                  className="settings-select"
                  value={syncIntervalMinutes}
                  onChange={(e) => {
                    const raw = parseInt(e.target.value, 10);
                    const next = raw as SyncIntervalMinutes;
                    setSyncIntervalMinutes(next);
                    showToast(
                      next === 0
                        ? t("settings.sync.autoDisabled")
                        : t("settings.sync.updated", {
                            interval: t(AUTOSYNC_TOAST_KEY[next]),
                          }),
                      "success",
                    );
                  }}
                >
                  <option value={0}>{t("settings.autosync.off")}</option>
                  <option value={15}>{t("settings.autosync.15m")}</option>
                  <option value={30}>{t("settings.autosync.30m")}</option>
                  <option value={60}>{t("settings.autosync.1h")}</option>
                  <option value={360}>{t("settings.autosync.6h")}</option>
                  <option value={720}>{t("settings.autosync.12h")}</option>
                  <option value={1440}>{t("settings.autosync.24h")}</option>
                </select>
              </div>
            </div>
          </div>

          <div className="settings-launcher-card">
            <div className="settings-control">
              <label className="settings-label">{t("settings.label.historyRetention")}</label>
              <p className="settings-helper-lead">{t("settings.historyRetention.desc")}</p>
              <div className="settings-input-group">
                <select
                  className="settings-select"
                  value={historyCapDays}
                  onChange={(e) => {
                    const raw = parseInt(e.target.value, 10);
                    const next = (raw === 7 || raw === 30 ? raw : 1) as 1 | 7 | 30;
                    setHistoryCapDays(next);
                    showToast(
                      next === 1
                        ? t("settings.history.rollsOffOneDay")
                        : next === 7
                        ? t("settings.history.rollsOffOneWeek")
                        : t("settings.history.rollsOffOneMonth"),
                      "info",
                    );
                  }}
                >
                  <option value={1}>{t("settingsPage.retention1Day")}</option>
                  <option value={7}>{t("settingsPage.retention1Week")}</option>
                  <option value={30}>{t("settingsPage.retention1Month")}</option>
                </select>
              </div>
            </div>
          </div>

          <div className="settings-launcher-card">
            <label className="settings-checkbox-label">
              <input
                type="checkbox"
                checked={hideAchievementProgress}
                onChange={(e) => setHideAchievementProgress(e.target.checked)}
              />
              <div className="settings-checkbox-text">
                <span className="settings-checkbox-title">{t("settings.achievements.noSpoilersTitle")}</span>
                <span className="settings-checkbox-desc">{t("settings.achievements.noSpoilersDesc")}</span>
              </div>
            </label>
          </div>

          <div className="settings-launcher-card">
            <label className="settings-checkbox-label">
              <input
                type="checkbox"
                checked={achievementSettings.localAchievementsEnabled}
                onChange={(e) =>
                  updateAchievementSettings({ localAchievementsEnabled: e.target.checked })
                }
              />
              <div className="settings-checkbox-text">
                <span className="settings-checkbox-title">{t("settings.achievements.localTitle")}</span>
                <span className="settings-checkbox-desc">{t("settings.achievements.localDesc")}</span>
              </div>
            </label>
          </div>

          <div className="settings-launcher-card">
            <label className="settings-checkbox-label">
              <input
                type="checkbox"
                checked={discordRichPresence}
                onChange={(e) => setDiscordRichPresence(e.target.checked)}
              />
              <div className="settings-checkbox-text">
                <span className="settings-checkbox-title">{t("settings.discord.title")}</span>
                <span className="settings-checkbox-desc">{t("settings.discord.desc")}</span>
              </div>
            </label>
            {discordRichPresence && discordStatus === "notRunning" && (
              <p className="connect-prompt">{t("settings.discord.notRunning")}</p>
            )}
          </div>
        </div>
      </SettingsSection>

      <ConfirmModal
        open={confirm.request !== null}
        title={confirm.request?.title ?? ""}
        message={confirm.request?.message ?? ""}
        confirmLabel={t("common.confirm")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => {
          confirm.request?.onConfirm();
          confirm.dismiss();
        }}
        onCancel={confirm.dismiss}
      />
    </>
  );
}

/** Maps auto-sync interval minutes to their i18n key for the toast. */
const AUTOSYNC_TOAST_KEY: Record<number, string> = {
  15: "settings.autosync.15m",
  30: "settings.autosync.30m",
  60: "settings.autosync.1h",
  360: "settings.autosync.6h",
  720: "settings.autosync.12h",
  1440: "settings.autosync.24h",
};


