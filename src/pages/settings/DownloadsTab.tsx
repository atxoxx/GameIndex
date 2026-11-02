import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { useDownloads } from "../../context/DownloadContext";
import { useSettings } from "../../context/SettingsContext";
import { useSpeedUnit } from "../../hooks/useSpeedUnit";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { Button } from "../../components/ui";
import type { SpeedUnit } from "../../types/game";
import { MAX_SEGMENT_COUNT } from "../../types/download";
import PostActionEditor from "../../components/downloads/PostActionEditor";
import SettingsSection from "./SettingsSection";
import SettingsRow from "./SettingsRow";
import SettingsSwitch from "./SettingsSwitch";
import { BellIcon, CloudIcon, DownloadIcon, FolderIcon, GaugeIcon, ShieldIcon } from "./settingsIcons";

/**
 * DownloadsTab — download preferences: default save location,
 * completion notifications, bandwidth limits + seeding, blocked
 * domains, and debrid integration.
 *
 * Every row states one decision with its consequence; expert-only
 * sections (engine, blocked domains, debrid) are marked `advanced` so the
 * Essentials filter can keep first-run setup down to the location and
 * notification choices.
 */
export default function DownloadsTab() {
  const { showToast } = useToast();
  const {
    selectSavePath,
    setSeedConfig,
    seedAfterComplete,
    seedLimits,
    setSeedLimits,
    speedLimits,
    setSpeedLimits,
    defaultDownloadPath,
    setDefaultDownloadPath,
    alwaysAskPath,
    setAlwaysAskPath,
    notifyComplete,
    setNotifyComplete,
    notifyOs,
    setNotifyOs,
    debridProvider,
    setDebridProvider,
    debridApiKey,
    setDebridApiKey,
    downloadSettings,
    setDownloadSettings,
  } = useDownloads();
  const { blockedSourceDomains, setBlockedSourceDomains } = useSettings();
  const { unit: speedUnit, setUnit: setSpeedUnit } = useSpeedUnit();
  const { t } = useLanguage();

  const [testingDebrid, setTestingDebrid] = useState(false);
  const [cleaningProbes, setCleaningProbes] = useState(false);

  const updateSettings = (partial: Partial<typeof downloadSettings>) => {
    void setDownloadSettings({ ...downloadSettings, ...partial });
  };

  const handlePickDefaultPath = async () => {
    try {
      const path = await selectSavePath();
      if (path) {
        setDefaultDownloadPath(path);
        setAlwaysAskPath(false);
      }
    } catch (e) {
      showToast(t("settings.couldNotOpenFolder", { error: e }), "error");
    }
  };

  const handleTestDebrid = async () => {
    if (!debridApiKey) return;
    setTestingDebrid(true);
    try {
      const res = await invoke<{ username: string; premium_until: number | null }>("test_debrid_key", {
        provider: debridProvider,
        apikey: debridApiKey,
      });
      showToast(t("settings.loginSuccess", { username: res.username }), "success");
    } catch (e) {
      showToast(t("settings.connectionFailed", { error: e }), "error");
    } finally {
      setTestingDebrid(false);
    }
  };

  const handleCleanupProbes = async () => {
    if (!debridApiKey || debridProvider !== "alldebrid") return;
    setCleaningProbes(true);
    try {
      const count = await invoke<number>("debrid_cleanup_probes", {
        provider: debridProvider,
        apikey: debridApiKey,
      });
      showToast(t("settings.debrid.cleanupProbesDone", { count }), "success");
    } catch (e) {
      showToast(t("settings.connectionFailed", { error: e }), "error");
    } finally {
      setCleaningProbes(false);
    }
  };

  return (
    <>
      <SettingsSection
        id="downloads-location"
        icon={<FolderIcon />}
        title={t("settings.section.downloadLocation")}
        desc={
          <>
            {t("settingsPage.downloadLocation")}{" "}
            {t("settings.downloads.alwaysAskEnabledNote")}
          </>
        }
      >
        <SettingsRow
          id="setting-download-path"
          title={
            <span
              className={`dl-save-path-text${defaultDownloadPath ? "" : " placeholder"}`}
              title={defaultDownloadPath}
            >
              {defaultDownloadPath || t("settings.downloads.noFolderPrompt")}
            </span>
          }
          control={
            <div className="dl-save-path-actions">
              <Button variant="secondary" size="sm" onClick={handlePickDefaultPath}>
                {defaultDownloadPath ? t("common.change") : t("settings.downloads.choose")}
              </Button>
              {defaultDownloadPath && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDefaultDownloadPath("");
                    setAlwaysAskPath(true);
                  }}
                >
                  {t("common.clear")}
                </Button>
              )}
            </div>
          }
        />

        <SettingsRow
          id="setting-always-ask-path"
          title={t("settings.downloads.askSaveLocation")}
          disabledHint={
            !defaultDownloadPath ? t("settings.downloads.noFolderPrompt") : undefined
          }
          control={
            <SettingsSwitch
              checked={alwaysAskPath}
              disabled={!defaultDownloadPath}
              onChange={setAlwaysAskPath}
              label={t("settings.downloads.askSaveLocation")}
            />
          }
        />
      </SettingsSection>

      <SettingsSection
        id="downloads-notifications"
        className="settings-section--bell"
        icon={<BellIcon />}
        title={t("settings.section.notifications")}
        desc={t("settings.downloads.notifyDesc")}
      >
        <SettingsRow
          id="setting-notify-complete"
          title={t("settings.downloads.showToast")}
          control={
            <SettingsSwitch
              checked={notifyComplete}
              onChange={setNotifyComplete}
              label={t("settings.downloads.showToast")}
            />
          }
        />

        <SettingsRow
          title={t("settings.downloads.desktopNotification")}
          disabledHint={!notifyComplete ? t("settings.downloads.notifyDesc") : undefined}
          control={
            <SettingsSwitch
              checked={notifyOs}
              disabled={!notifyComplete}
              onChange={(on) => {
                setNotifyOs(on);
                if (on && typeof Notification !== "undefined" && Notification.permission === "default") {
                  void Notification.requestPermission();
                }
              }}
              label={t("settings.downloads.desktopNotification")}
            />
          }
        />
      </SettingsSection>

      <SettingsSection
        id="downloads-bandwidth"
        className="settings-section--gauge"
        icon={<GaugeIcon />}
        title={t("settings.section.bandwidth")}
        desc={t("settings.downloads.bandwidthDesc")}
      >
        <SettingsRow
          title={t("settings.label.speedUnit")}
          control={
            <select
              className="settings-select"
              value={speedUnit}
              onChange={(e) => {
                const next = e.target.value as SpeedUnit;
                setSpeedUnit(next);
                showToast(
                  next === "bytes"
                    ? t("settings.downloads.speedNowBytes")
                    : next === "bits"
                    ? t("settings.downloads.speedNowBits")
                    : t("settings.downloads.speedNowBinary"),
                  "success",
                );
              }}
              aria-label={t("settings.label.speedUnit")}
            >
              <option value="bytes">{t("settingsPage.speedBytesDecimal")}</option>
              <option value="bits">{t("settingsPage.speedBits")}</option>
              <option value="binary">{t("settingsPage.speedBytesBinary")}</option>
            </select>
          }
        />

        <SettingsRow
          id="setting-download-limit"
          title={t("settings.downloads.limitDownload")}
          control={
            <SettingsSwitch
              checked={speedLimits.downloadEnabled}
              onChange={(checked) => {
                void setSpeedLimits({ ...speedLimits, downloadEnabled: checked });
              }}
              label={t("settings.downloads.limitDownload")}
            />
          }
        >
          {speedLimits.downloadEnabled && (
            <div className="settings-limit-value">
              <input
                type="number"
                className="settings-limit-input"
                min="1"
                value={speedLimits.downloadValue || ""}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10) || 0;
                  void setSpeedLimits({ ...speedLimits, downloadValue: val });
                }}
                placeholder={t("settings.downloads.speedPlaceholder")}
              />
              <span className="settings-limit-unit">{t("settings.downloads.kbps")}</span>
            </div>
          )}
        </SettingsRow>

        <SettingsRow
          id="setting-upload-limit"
          title={t("settings.downloads.limitUpload")}
          disabledHint={speedLimits.disableUpload ? t("settings.downloads.disableUpload") : undefined}
          control={
            <SettingsSwitch
              checked={speedLimits.uploadEnabled}
              disabled={speedLimits.disableUpload}
              onChange={(checked) => {
                void setSpeedLimits({ ...speedLimits, uploadEnabled: checked });
              }}
              label={t("settings.downloads.limitUpload")}
            />
          }
        >
          {speedLimits.uploadEnabled && !speedLimits.disableUpload && (
            <div className="settings-limit-value">
              <input
                type="number"
                className="settings-limit-input"
                min="1"
                value={speedLimits.uploadValue || ""}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10) || 0;
                  void setSpeedLimits({ ...speedLimits, uploadValue: val });
                }}
                placeholder={t("settings.downloads.speedPlaceholder")}
              />
              <span className="settings-limit-unit">{t("settings.downloads.kbps")}</span>
            </div>
          )}
        </SettingsRow>

        <SettingsRow
          title={t("settings.downloads.disableUpload")}
          desc={t("settings.downloads.disableUploadHint")}
          control={
            <SettingsSwitch
              checked={speedLimits.disableUpload}
              onChange={(checked) => {
                void setSpeedLimits({ ...speedLimits, disableUpload: checked });
              }}
              label={t("settings.downloads.disableUpload")}
            />
          }
        >
          {speedLimits.disableUpload && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                const cap = speedLimits.uploadValue > 0 ? speedLimits.uploadValue : 1024;
                void setSpeedLimits({
                  ...speedLimits,
                  uploadEnabled: true,
                  uploadValue: cap,
                  disableUpload: false,
                });
                showToast(
                  t("settings.downloads.disableUploadCapApplied", { v: cap }),
                  "success",
                );
              }}
            >
              {t("settings.downloads.disableUploadUseCap", {
                v: speedLimits.uploadValue > 0 ? speedLimits.uploadValue : 1024,
              })}
            </Button>
          )}
        </SettingsRow>

        <SettingsRow
          title={t("settings.downloads.seedAfterComplete")}
          desc={t("settings.downloads.seedAfterCompleteDesc")}
          control={
            <SettingsSwitch
              checked={seedAfterComplete}
              onChange={(checked) => {
                void setSeedConfig(checked);
              }}
              label={t("settings.downloads.seedAfterComplete")}
            />
          }
        >
          <div className="settings-limit-row">
            <label className="settings-checkbox-label settings-checkbox-label--fixed">
              <span>{t("settings.downloads.seedRatioLimit")}</span>
            </label>
            <div className="settings-limit-value">
              <input
                type="number"
                className="settings-limit-input"
                min="0"
                step="0.1"
                value={seedLimits.ratio || ""}
                disabled={!seedAfterComplete}
                onChange={(e) =>
                  void setSeedLimits({
                    ...seedLimits,
                    ratio: Math.max(0, Number(e.target.value) || 0),
                  })
                }
                placeholder={t("settings.downloads.seedUnlimited")}
              />
              <span className="settings-limit-unit">×</span>
            </div>
          </div>

          <div className="settings-limit-row">
            <label className="settings-checkbox-label settings-checkbox-label--fixed">
              <span>{t("settings.downloads.seedTimeLimit")}</span>
            </label>
            <div className="settings-limit-value">
              <input
                type="number"
                className="settings-limit-input"
                min="0"
                value={seedLimits.minutes || ""}
                disabled={!seedAfterComplete}
                onChange={(e) =>
                  void setSeedLimits({
                    ...seedLimits,
                    minutes: Math.max(0, Number(e.target.value) || 0),
                  })
                }
                placeholder={t("settings.downloads.seedUnlimited")}
              />
              <span className="settings-limit-unit">{t("settings.downloads.minutes")}</span>
            </div>
          </div>
          <p className="settings-helper-text">{t("settings.downloads.seedLimitsHint")}</p>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        id="downloads-engine"
        icon={<DownloadIcon />}
        title={t("settings.section.downloadEngine")}
        desc={t("settings.downloads.engineDesc")}
        advanced
      >
        <SettingsRow
          id="setting-multi-connection"
          title={t("settings.downloads.multiConnection")}
          desc={t("settings.downloads.multiConnectionDesc")}
          control={
            <SettingsSwitch
              checked={downloadSettings.multiConnection}
              onChange={(checked) => updateSettings({ multiConnection: checked })}
              label={t("settings.downloads.multiConnection")}
            />
          }
        >
          <div className="settings-limit-row">
            <label className="settings-checkbox-label settings-checkbox-label--fixed">
              <span>{t("settings.downloads.segmentCount")}</span>
            </label>
            <div className="settings-limit-value">
              <input
                type="number"
                className="settings-limit-input"
                min="1"
                max={MAX_SEGMENT_COUNT}
                value={downloadSettings.segmentCount}
                disabled={!downloadSettings.multiConnection}
                onChange={(e) => {
                  const val = Math.min(
                    MAX_SEGMENT_COUNT,
                    Math.max(1, parseInt(e.target.value, 10) || 1),
                  );
                  updateSettings({ segmentCount: val });
                }}
              />
              <span className="settings-limit-unit">
                {t("settings.downloads.connections")}
              </span>
            </div>
          </div>
        </SettingsRow>

        <SettingsRow
          title={t("settings.downloads.allowInstallers")}
          desc={t("settings.downloads.allowInstallersDesc")}
          control={
            <SettingsSwitch
              checked={downloadSettings.installerOptIn}
              onChange={(checked) => updateSettings({ installerOptIn: checked })}
              label={t("settings.downloads.allowInstallers")}
            />
          }
        />

        <SettingsRow
          layout="stacked"
          title={t("settings.downloads.postActions")}
          desc={t("settings.downloads.postActionsDesc")}
        >
          <PostActionEditor
            actions={downloadSettings.postActions}
            onChange={(next) => updateSettings({ postActions: next })}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        id="downloads-blocked"
        className="settings-section--shield"
        icon={<ShieldIcon />}
        title={t("settings.section.blockedDomains")}
        desc={t("settings.downloads.blockedDesc")}
        advanced
      >
        <SettingsRow
          layout="stacked"
          title={
            blockedSourceDomains.length === 0
              ? t("settings.downloads.blockedNone")
              : t("settings.downloads.blockedCount", {
                  count: blockedSourceDomains.length,
                  s: blockedSourceDomains.length === 1 ? "" : "s",
                })
          }
          desc={t("settingsPage.blockedDomains")}
        >
          <div className="settings-control settings-control--narrow">
            <textarea
              className="settings-input settings-textarea-mono"
              rows={5}
              placeholder={t("settings.blockedDomainsPlaceholder")}
              value={blockedSourceDomains.join("\n")}
              onChange={(e) => {
                setBlockedSourceDomains(
                  e.target.value.split(/\r?\n/).map((line) => line.trim()),
                );
              }}
              spellCheck={false}
            />
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        id="downloads-debrid"
        icon={<CloudIcon />}
        title={t("settings.section.debrid")}
        desc={t("settings.downloads.debridDesc")}
        advanced
      >
        <SettingsRow
          title={t("settings.debrid.provider")}
          control={
            <select
              value={debridProvider}
              onChange={(e) => {
                setDebridProvider(e.target.value);
              }}
              className="settings-select settings-select--debrid"
              aria-label={t("settings.debrid.provider")}
            >
              <option value="none">{t("settings.debrid.disabled")}</option>
              <option value="alldebrid">{t("settings.debrid.allDebrid")}</option>
              <option value="realdebrid">{t("settings.debrid.realDebrid")}</option>
              <option value="torbox">{t("settings.debrid.torBox")}</option>
            </select>
          }
        />

        {debridProvider !== "none" && (
          <>
            <SettingsRow layout="stacked" title={t("settings.debrid.apiKeyToken")}>
              <div className="settings-debrid-row">
                <input
                  type="password"
                  value={debridApiKey}
                  onChange={(e) => {
                    setDebridApiKey(e.target.value);
                  }}
                  placeholder={t("settings.debrid.apiKeyPlaceholder")}
                  className="settings-input"
                  aria-label={t("settings.debrid.apiKeyToken")}
                />
                <Button
                  variant="primary"
                  onClick={handleTestDebrid}
                  disabled={testingDebrid || !debridApiKey}
                >
                  {testingDebrid ? t("settings.debrid.testing") : t("settings.debrid.testConnection")}
                </Button>
              </div>
            </SettingsRow>

            {debridProvider === "alldebrid" && (
              <div className="settings-limit-row settings-limit-row--stack">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleCleanupProbes}
                  disabled={cleaningProbes || !debridApiKey}
                >
                  {cleaningProbes
                    ? t("settings.debrid.testing")
                    : t("settings.debrid.cleanupProbes")}
                </Button>
              </div>
            )}

            <p className="settings-helper-text settings-helper-text--debrid">
              {t("settingsPage.debridUsage")}
            </p>
          </>
        )}
      </SettingsSection>
    </>
  );
}
