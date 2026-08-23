import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { useDownloads } from "../../context/DownloadContext";
import { useSettings } from "../../context/SettingsContext";
import { useSpeedUnit } from "../../hooks/useSpeedUnit";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { Button } from "../../components/ui";
import type { SpeedUnit } from "../../types/game";
import SettingsSection from "./SettingsSection";
import { BellIcon, CloudIcon, FolderIcon, GaugeIcon, ShieldIcon } from "./settingsIcons";

/**
 * DownloadsTab — download preferences: default save location,
 * completion notifications, bandwidth limits + seeding, blocked
 * domains, and debrid integration.
 */
export default function DownloadsTab() {
  const { showToast } = useToast();
  const {
    selectSavePath,
    setSeedConfig,
    seedAfterComplete,
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
  } = useDownloads();
  const { blockedSourceDomains, setBlockedSourceDomains } = useSettings();
  const { unit: speedUnit, setUnit: setSpeedUnit } = useSpeedUnit();
  const { t } = useLanguage();

  const [testingDebrid, setTestingDebrid] = useState(false);

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
        <div className="settings-card">
          <div className="dl-save-path">
            <svg
              className="dl-save-path-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            <span
              className={`dl-save-path-text${defaultDownloadPath ? "" : " placeholder"}`}
              title={defaultDownloadPath}
            >
              {defaultDownloadPath || t("settings.downloads.noFolderPrompt")}
            </span>
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
          </div>

          <label className="settings-checkbox-label settings-checkbox-label--inline">
            <input
              type="checkbox"
              checked={alwaysAskPath}
              disabled={!defaultDownloadPath}
              onChange={(e) => {
                setAlwaysAskPath(e.target.checked);
              }}
            />
            <span>{t("settings.downloads.askSaveLocation")}</span>
          </label>
        </div>
      </SettingsSection>

      <SettingsSection
        id="downloads-notifications"
        className="settings-section--bell"
        icon={<BellIcon />}
        title={t("settings.section.notifications")}
        desc={t("settings.downloads.notifyDesc")}
      >
        <div className="settings-card">
          <label className="settings-checkbox-label settings-checkbox-label--inline">
            <input
              type="checkbox"
              checked={notifyComplete}
              onChange={(e) => {
                setNotifyComplete(e.target.checked);
              }}
            />
            <span>{t("settings.downloads.showToast")}</span>
          </label>

          <label className="settings-checkbox-label settings-checkbox-label--inline">
            <input
              type="checkbox"
              checked={notifyOs}
              disabled={!notifyComplete}
              onChange={(e) => {
                const on = e.target.checked;
                setNotifyOs(on);
                if (on && typeof Notification !== "undefined" && Notification.permission === "default") {
                  void Notification.requestPermission();
                }
              }}
            />
            <span>{t("settings.downloads.desktopNotification")}</span>
          </label>
        </div>
      </SettingsSection>

      <SettingsSection
        id="downloads-bandwidth"
        className="settings-section--gauge"
        icon={<GaugeIcon />}
        title={t("settings.section.bandwidth")}
        desc={t("settings.downloads.bandwidthDesc")}
      >
        <div className="settings-bandwidth-limits">
          <div className="settings-limit-row settings-limit-row--unit">
            <label className="settings-checkbox-label settings-checkbox-label--fixed">
              <span>{t("settings.label.speedUnit")}</span>
            </label>
            <div className="settings-limit-value" style={{ minWidth: "220px" }}>
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
            </div>
          </div>

          <div className="settings-limit-row">
            <label className="settings-checkbox-label settings-checkbox-label--fixed">
              <input
                type="checkbox"
                checked={speedLimits.downloadEnabled}
                onChange={(e) => {
                  void setSpeedLimits({
                    downloadEnabled: e.target.checked,
                    downloadValue: speedLimits.downloadValue,
                    uploadEnabled: speedLimits.uploadEnabled,
                    uploadValue: speedLimits.uploadValue,
                    disableUpload: speedLimits.disableUpload,
                  });
                }}
              />
              <span>{t("settings.downloads.limitDownload")}</span>
            </label>
            {speedLimits.downloadEnabled && (
              <div className="settings-limit-value">
                <input
                  type="number"
                  className="settings-limit-input"
                  min="1"
                  value={speedLimits.downloadValue || ""}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10) || 0;
                    void setSpeedLimits({
                      downloadEnabled: speedLimits.downloadEnabled,
                      downloadValue: val,
                      uploadEnabled: speedLimits.uploadEnabled,
                      uploadValue: speedLimits.uploadValue,
                      disableUpload: speedLimits.disableUpload,
                    });
                  }}
                  placeholder={t("settings.downloads.speedPlaceholder")}
                />
                <span className="settings-limit-unit">{t("settings.downloads.kbps")}</span>
              </div>
            )}
          </div>

          <div className="settings-limit-row">
            <label className="settings-checkbox-label settings-checkbox-label--fixed">
              <input
                type="checkbox"
                checked={speedLimits.uploadEnabled}
                disabled={speedLimits.disableUpload}
                onChange={(e) => {
                  void setSpeedLimits({
                    downloadEnabled: speedLimits.downloadEnabled,
                    downloadValue: speedLimits.downloadValue,
                    uploadEnabled: e.target.checked,
                    uploadValue: speedLimits.uploadValue,
                    disableUpload: speedLimits.disableUpload,
                  });
                }}
              />
              <span>{t("settings.downloads.limitUpload")}</span>
            </label>
            {speedLimits.uploadEnabled && !speedLimits.disableUpload && (
              <div className="settings-limit-value">
                <input
                  type="number"
                  className="settings-limit-input"
                  min="1"
                  value={speedLimits.uploadValue || ""}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10) || 0;
                    void setSpeedLimits({
                      downloadEnabled: speedLimits.downloadEnabled,
                      downloadValue: speedLimits.downloadValue,
                      uploadEnabled: speedLimits.uploadEnabled,
                      uploadValue: val,
                      disableUpload: speedLimits.disableUpload,
                    });
                  }}
                  placeholder={t("settings.downloads.speedPlaceholder")}
                />
                <span className="settings-limit-unit">{t("settings.downloads.kbps")}</span>
              </div>
            )}
          </div>

          <div className="settings-limit-row">
            <label className="settings-checkbox-label settings-checkbox-label--inline">
              <input
                type="checkbox"
                checked={speedLimits.disableUpload}
                onChange={(e) => {
                  void setSpeedLimits({
                    downloadEnabled: speedLimits.downloadEnabled,
                    downloadValue: speedLimits.downloadValue,
                    uploadEnabled: speedLimits.uploadEnabled,
                    uploadValue: speedLimits.uploadValue,
                    disableUpload: e.target.checked,
                  });
                }}
              />
              <span>{t("settings.downloads.disableUpload")}</span>
            </label>
          </div>

          <div className="settings-limit-row settings-limit-row--seed">
            <label className="settings-checkbox-label settings-checkbox-label--inline">
              <input
                type="checkbox"
                checked={seedAfterComplete}
                onChange={(e) => {
                  void setSeedConfig(e.target.checked);
                }}
              />
              <span>{t("settings.downloads.seedAfterComplete")}</span>
            </label>
            <p className="settings-helper-text">{t("settings.downloads.seedAfterCompleteDesc")}</p>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        id="downloads-blocked"
        className="settings-section--shield"
        icon={<ShieldIcon />}
        title={t("settings.section.blockedDomains")}
        desc={t("settings.downloads.blockedDesc")}
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
          <p className="settings-helper-text">
            {blockedSourceDomains.length === 0
              ? t("settings.downloads.blockedNone")
              : t("settings.downloads.blockedCount", {
                  count: blockedSourceDomains.length,
                  s: blockedSourceDomains.length === 1 ? "" : "s",
                })}
          </p>
        </div>
      </SettingsSection>


      <SettingsSection
        id="downloads-debrid"
        icon={<CloudIcon />}
        title={t("settings.section.debrid")}
        desc={t("settings.downloads.debridDesc")}
      >
        <div className="settings-card">
          <div className="settings-limit-row settings-limit-row--stack">
            <label className="settings-label settings-label--sm">
              {t("settings.debrid.provider")}
            </label>
            <select
              value={debridProvider}
              onChange={(e) => {
                setDebridProvider(e.target.value);
              }}
              className="settings-select settings-select--debrid"
            >
              <option value="none">{t("settings.debrid.disabled")}</option>
              <option value="alldebrid">{t("settings.debrid.allDebrid")}</option>
              <option value="realdebrid">{t("settings.debrid.realDebrid")}</option>
              <option value="torbox">{t("settings.debrid.torBox")}</option>
            </select>
          </div>

          {debridProvider !== "none" && (
            <>
              <div className="settings-limit-row settings-limit-row--stack">
                <label className="settings-label settings-label--sm">
                  {t("settings.debrid.apiKeyToken")}
                </label>
                <div className="settings-debrid-row">
                  <input
                    type="password"
                    value={debridApiKey}
                    onChange={(e) => {
                      setDebridApiKey(e.target.value);
                    }}
                    placeholder={t("settings.debrid.apiKeyPlaceholder")}
                    className="settings-input"
                  />
                  <Button
                    variant="primary"
                    onClick={handleTestDebrid}
                    disabled={testingDebrid || !debridApiKey}
                  >
                    {testingDebrid ? t("settings.debrid.testing") : t("settings.debrid.testConnection")}
                  </Button>
                </div>
              </div>

              <p className="settings-helper-text settings-helper-text--debrid">
                {t("settingsPage.debridUsage")}
              </p>
            </>
          )}
        </div>
      </SettingsSection>
    </>
  );
}
