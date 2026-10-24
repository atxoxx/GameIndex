import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FolderOpen } from "lucide-react";
import { Button } from "../../components/ui";
import { useLanguage } from "../../context/LanguageContext";
import { useSaves } from "../../context/SavesContext";
import SettingsToggleCard from "../settings/SettingsToggleCard";

/**
 * Save Backups configuration, shared by the hub's Settings tab and
 * Settings → Saves.
 *
 * Text/number fields keep a local draft and commit on blur or Enter: the
 * previous per-keystroke writes persisted every intermediate value (typing
 * "10" stored "1" first) and re-rendered the whole suite on each character.
 */

export function SavesAutomationControls() {
  const { t } = useLanguage();
  const { settings, updateSettings } = useSaves();
  if (!settings) return null;

  return (
    <div className="saves-settings-grid">
      <SettingsToggleCard
        title={t("saves.settings.enableTitle")}
        desc={t("saves.settings.enableDesc")}
        checked={settings.enabled}
        onChange={(checked) => void updateSettings({ enabled: checked })}
      />
      <SettingsToggleCard
        title={t("saves.settings.autoExitTitle")}
        desc={t("saves.settings.autoExitDesc")}
        checked={settings.autoBackupOnExit}
        onChange={(checked) => void updateSettings({ autoBackupOnExit: checked })}
      />
      <SettingsToggleCard
        title={t("saves.settings.safetyTitle")}
        desc={t("saves.settings.safetyDesc")}
        checked={settings.restoreSafetySnapshot}
        onChange={(checked) => void updateSettings({ restoreSafetySnapshot: checked })}
      />
      <SettingsToggleCard
        title={t("saves.settings.emulatorTitle")}
        desc={t("saves.settings.emulatorDesc")}
        checked={settings.includeEmulatorSaves}
        onChange={(checked) => void updateSettings({ includeEmulatorSaves: checked })}
      />
      <SettingsToggleCard
        title={t("saves.settings.pcgwTitle")}
        desc={t("saves.settings.pcgwDesc")}
        checked={settings.includePcgw}
        onChange={(checked) => void updateSettings({ includePcgw: checked })}
      />
    </div>
  );
}

export function SavesStorageControls() {
  const { t } = useLanguage();
  const { settings, updateSettings, pickBackupDir } = useSaves();
  const [retention, setRetention] = useState("0");
  const [ignore, setIgnore] = useState("");

  const savedRetention = String(settings?.retention ?? 0);
  const savedIgnore = (settings?.ignorePatterns ?? []).join(", ");

  useEffect(() => {
    setRetention(savedRetention);
  }, [savedRetention]);

  useEffect(() => {
    setIgnore(savedIgnore);
  }, [savedIgnore]);

  if (!settings) return null;

  const commitRetention = () => {
    const parsed = Math.max(0, Math.min(1000, Number(retention) || 0));
    setRetention(String(parsed));
    if (parsed !== settings.retention) void updateSettings({ retention: parsed });
  };

  const commitIgnore = () => {
    const patterns = ignore
      .split(",")
      .map((pattern) => pattern.trim())
      .filter(Boolean);
    setIgnore(patterns.join(", "));
    if (patterns.join("|") !== settings.ignorePatterns.join("|")) {
      void updateSettings({ ignorePatterns: patterns });
    }
  };

  return (
    <>
      <div className="saves-setting-row">
        <div className="saves-setting-row__text">
          <span className="saves-setting-row__label">{t("saves.settings.backupDir")}</span>
          <span className="saves-setting-row__path" title={settings.backupDir}>
            {settings.backupDir || "—"}
          </span>
        </div>
        <div className="saves-setting-row__actions">
          <Button variant="secondary" size="sm" onClick={() => void pickBackupDir()}>
            {t("saves.action.change")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<FolderOpen size={14} />}
            onClick={() => void invoke("saves_open_path", { path: settings.backupDir })}
            disabled={!settings.backupDir}
          >
            {t("saves.action.openBackupFolder")}
          </Button>
        </div>
      </div>

      <div className="saves-setting-row">
        <div className="saves-setting-row__text">
          <span className="saves-setting-row__label">{t("saves.settings.retention")}</span>
          <span className="saves-setting-row__hint">{t("saves.settings.retentionHint")}</span>
        </div>
        <div className="saves-setting-row__actions">
          <input
            type="number"
            min={0}
            max={1000}
            className="saves-input saves-input--number"
            value={retention}
            onChange={(event) => setRetention(event.target.value)}
            onBlur={commitRetention}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") setRetention(savedRetention);
            }}
            aria-label={t("saves.settings.retention")}
          />
          <span className="saves-setting-row__value">
            {settings.retention === 0
              ? t("saves.settings.retentionUnlimited")
              : t("saves.settings.retentionPerGame", { count: settings.retention })}
          </span>
        </div>
      </div>

      <div className="saves-setting-row">
        <div className="saves-setting-row__text">
          <span className="saves-setting-row__label">{t("saves.settings.ignore")}</span>
          <span className="saves-setting-row__hint">{t("saves.settings.ignoreHint")}</span>
        </div>
        <div className="saves-setting-row__actions">
          <input
            type="text"
            className="saves-input saves-input--wide"
            value={ignore}
            placeholder={t("saves.settings.ignorePlaceholder")}
            onChange={(event) => setIgnore(event.target.value)}
            onBlur={commitIgnore}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") setIgnore(savedIgnore);
            }}
            aria-label={t("saves.settings.ignore")}
          />
        </div>
      </div>
    </>
  );
}
