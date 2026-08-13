import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { useDownloads } from "../../context/DownloadContext";
import { useSettings } from "../../context/SettingsContext";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { Button } from "../../components/ui";
import SettingsSection from "./SettingsSection";
import SourceManager from "../../components/SourceManager";
import { BellIcon, CloudIcon, FolderIcon, GaugeIcon, ListIcon, ShieldIcon } from "./settingsIcons";

/**
 * DownloadsTab — every download-related setting: default save location,
 * completion notifications, bandwidth limits + seeding, blocked source
 * domains, the Hydra download-source manager, and debrid integration.
 */
export default function DownloadsTab() {
  const { showToast } = useToast();
  const { updateSpeedLimits, selectSavePath, setSeedConfig, seedAfterComplete } = useDownloads();
  const { blockedSourceDomains, setBlockedSourceDomains } = useSettings();
  const { t } = useLanguage();

  // Speed-limit settings state
  const [dlLimitEnabled, setDlLimitEnabled] = useState(false);
  const [dlLimitValue, setDlLimitValue] = useState(0);
  const [ulLimitEnabled, setUlLimitEnabled] = useState(false);
  const [ulLimitValue, setUlLimitValue] = useState(0);
  const [disableUpload, setDisableUpload] = useState(false);

  // Default download path + "always ask" toggle
  const [defaultDownloadPath, setDefaultDownloadPath] = useState("");
  const [alwaysAskPath, setAlwaysAskPath] = useState(true);

  // Completion notification toggles
  const [notifyComplete, setNotifyComplete] = useState(true);
  const [notifyOs, setNotifyOs] = useState(false);

  // Debrid settings state
  const [debridProvider, setDebridProvider] = useState("none");
  const [debridApiKey, setDebridApiKey] = useState("");
  const [testingDebrid, setTestingDebrid] = useState(false);

  useEffect(() => {
    try {
      setDlLimitEnabled(localStorage.getItem("gamelib-dl-limit-download-enabled") === "true");
      setDlLimitValue(parseInt(localStorage.getItem("gamelib-dl-limit-download-value") || "0", 10));
      setUlLimitEnabled(localStorage.getItem("gamelib-dl-limit-upload-enabled") === "true");
      setUlLimitValue(parseInt(localStorage.getItem("gamelib-dl-limit-upload-value") || "0", 10));
      setDisableUpload(localStorage.getItem("gamelib-dl-limit-disable-upload") === "true");
      setDefaultDownloadPath(localStorage.getItem("gamelib-default-download-path") || "");
      setAlwaysAskPath(localStorage.getItem("gamelib-download-always-ask-path") !== "false");
      setNotifyComplete(localStorage.getItem("gamelib-download-notify-complete") !== "false");
      setNotifyOs(localStorage.getItem("gamelib-download-notify-os") === "true");
    } catch (e) {
      console.error("Failed to load speed limit settings:", e);
    }
  }, []);

  useEffect(() => {
    setDebridProvider(localStorage.getItem("gamelib-debrid-provider") || "none");
    setDebridApiKey(localStorage.getItem("gamelib-debrid-apikey") || "");
  }, []);

  const handlePickDefaultPath = async () => {
    try {
      const path = await selectSavePath();
      if (path) {
        setDefaultDownloadPath(path);
        localStorage.setItem("gamelib-default-download-path", path);
        setAlwaysAskPath(false);
        localStorage.setItem("gamelib-download-always-ask-path", "false");
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

  const saveAndApplyLimits = async (
    dlEnabled: boolean,
    dlVal: number,
    ulEnabled: boolean,
    ulVal: number,
    noUpload: boolean
  ) => {
    try {
      localStorage.setItem("gamelib-dl-limit-download-enabled", String(dlEnabled));
      localStorage.setItem("gamelib-dl-limit-download-value", String(dlVal));
      localStorage.setItem("gamelib-dl-limit-upload-enabled", String(ulEnabled));
      localStorage.setItem("gamelib-dl-limit-upload-value", String(ulVal));
      localStorage.setItem("gamelib-dl-limit-disable-upload", String(noUpload));

      await updateSpeedLimits(
        dlEnabled && dlVal > 0 ? dlVal : null,
        ulEnabled && ulVal > 0 ? ulVal : null,
        noUpload
      );
    } catch (e) {
      console.error("Failed to update speed limits:", e);
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
                    localStorage.removeItem("gamelib-default-download-path");
                    setAlwaysAskPath(true);
                    localStorage.setItem("gamelib-download-always-ask-path", "true");
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
                localStorage.setItem("gamelib-download-always-ask-path", String(e.target.checked));
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
                localStorage.setItem("gamelib-download-notify-complete", String(e.target.checked));
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
                localStorage.setItem("gamelib-download-notify-os", String(on));
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
          <div className="settings-limit-row">
            <label className="settings-checkbox-label settings-checkbox-label--fixed">
              <input
                type="checkbox"
                checked={dlLimitEnabled}
                onChange={(e) => {
                  setDlLimitEnabled(e.target.checked);
                  void saveAndApplyLimits(e.target.checked, dlLimitValue, ulLimitEnabled, ulLimitValue, disableUpload);
                }}
              />
              <span>{t("settings.downloads.limitDownload")}</span>
            </label>
            {dlLimitEnabled && (
              <div className="settings-limit-value">
                <input
                  type="number"
                  className="settings-limit-input"
                  min="1"
                  value={dlLimitValue || ""}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10) || 0;
                    setDlLimitValue(val);
                    void saveAndApplyLimits(dlLimitEnabled, val, ulLimitEnabled, ulLimitValue, disableUpload);
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
                checked={ulLimitEnabled}
                disabled={disableUpload}
                onChange={(e) => {
                  setUlLimitEnabled(e.target.checked);
                  void saveAndApplyLimits(dlLimitEnabled, dlLimitValue, e.target.checked, ulLimitValue, disableUpload);
                }}
              />
              <span>{t("settings.downloads.limitUpload")}</span>
            </label>
            {ulLimitEnabled && !disableUpload && (
              <div className="settings-limit-value">
                <input
                  type="number"
                  className="settings-limit-input"
                  min="1"
                  value={ulLimitValue || ""}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10) || 0;
                    setUlLimitValue(val);
                    void saveAndApplyLimits(dlLimitEnabled, dlLimitValue, ulLimitEnabled, val, disableUpload);
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
                checked={disableUpload}
                onChange={(e) => {
                  setDisableUpload(e.target.checked);
                  void saveAndApplyLimits(dlLimitEnabled, dlLimitValue, ulLimitEnabled, ulLimitValue, e.target.checked);
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
        id="downloads-sources"
        className="settings-section--list"
        icon={<ListIcon />}
        title={t("settings.section.downloadSources")}
        desc={
          <>
            {t("settings.downloads.sourcesDescStart")} <code>name</code> {t("common.and")}{" "}
            <code>downloads</code> {t("settings.downloads.sourcesDescEnd")}
          </>
        }
      >
        <div className="settings-card">
          <SourceManager />
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
                localStorage.setItem("gamelib-debrid-provider", e.target.value);
              }}
              className="settings-select settings-select--debrid"
            >
              <option value="none">{t("settings.debrid.disabled")}</option>
              <option value="alldebrid">{t("settings.debrid.allDebrid")}</option>
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
                      localStorage.setItem("gamelib-debrid-apikey", e.target.value);
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
