import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { useSaves } from "../../context/SavesContext";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { Button, Badge } from "../../components/ui";
import SettingsSection from "./SettingsSection";
import SettingsToggleCard from "./SettingsToggleCard";
import { BackupIcon, FolderIcon, ListIcon, RefreshIcon, ShieldIcon } from "./settingsIcons";
import type { SaveBackup } from "../../types/saves";

/**
 * SavesTab — Settings → Saves.
 *
 * The single place the Save Backups suite is switched on and configured.
 * Its master toggle gates the top-nav "Saves" tab and the per-game
 * "Saves" detail tab, so this tab stays reachable even while the feature
 * is off.
 */
export default function SavesTab() {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { settings, summary, updateSettings, pickBackupDir, scanAll, refresh } = useSaves();
  const { formatBytes } = useSizeUnit();
  const [busy, setBusy] = useState<null | "scan" | "backupAll">(null);

  if (!settings) {
    return (
      <SettingsSection
        id="saves-feature"
        icon={<BackupIcon />}
        title={t("saves.settings.title")}
        desc={t("saves.settings.loading")}
      >
        <div />
      </SettingsSection>
    );
  }

  const handleBackupAll = async () => {
    setBusy("backupAll");
    try {
      const done = await invoke<SaveBackup[]>("saves_backup_all");
      await refresh();
      showToast(t("saves.toast.backupAll", { count: done.length }), "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <SettingsSection
        id="saves-feature"
        icon={<BackupIcon />}
        title={t("saves.settings.title")}
        desc={t("saves.settings.desc")}
        actions={
          <Badge variant={settings.enabled ? "success" : "default"} dot>
            {settings.enabled ? t("saves.settings.on") : t("saves.settings.off")}
          </Badge>
        }
      >
        <div className="interface-defaults-grid">
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
      </SettingsSection>

      <SettingsSection
        id="saves-storage"
        icon={<FolderIcon />}
        title={t("saves.settings.storageTitle")}
        desc={t("saves.settings.storageDesc")}
      >
        <div className="saves-setting-row">
          <div className="saves-setting-row__text">
            <span className="saves-setting-row__label">{t("saves.settings.backupDir")}</span>
            <span className="saves-setting-row__path" title={settings.backupDir}>
              {settings.backupDir}
            </span>
          </div>
          <div className="saves-setting-row__actions">
            <Button variant="secondary" size="sm" onClick={() => void pickBackupDir()}>
              {t("saves.action.change")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void invoke("saves_open_path", { path: settings.backupDir })}
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
              value={settings.retention}
              onChange={(e) => {
                const value = Math.max(0, Math.min(1000, Number(e.target.value) || 0));
                void updateSettings({ retention: value });
              }}
              aria-label={t("saves.settings.retention")}
            />
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
              value={settings.ignorePatterns.join(", ")}
              placeholder="*.tmp, *.log"
              onChange={(e) => {
                const patterns = e.target.value
                  .split(",")
                  .map((p) => p.trim())
                  .filter(Boolean);
                void updateSettings({ ignorePatterns: patterns });
              }}
              aria-label={t("saves.settings.ignore")}
            />
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        id="saves-maintenance"
        icon={<RefreshIcon />}
        title={t("saves.settings.maintenanceTitle")}
        desc={t("saves.settings.maintenanceDesc")}
      >
        <div className="saves-setting-stats">
          <span className="saves-setting-stat">
            <ListIcon />
            {t("saves.kpi.games")}: <strong>{summary?.gamesWithLocations ?? 0}</strong>
          </span>
          <span className="saves-setting-stat">
            <ListIcon />
            {t("saves.kpi.locations")}: <strong>{summary?.totalLocations ?? 0}</strong>
          </span>
          <span className="saves-setting-stat">
            <ShieldIcon />
            {t("saves.kpi.backups")}: <strong>{summary?.totalBackups ?? 0}</strong>
          </span>
          <span className="saves-setting-stat">
            <BackupIcon />
            {formatBytes(summary?.totalBackupBytes ?? 0)}
          </span>
        </div>
        <div className="saves-setting-actions">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setBusy("scan");
              void scanAll().finally(() => setBusy(null));
            }}
            isLoading={busy === "scan"}
            disabled={busy !== null}
          >
            {t("saves.action.scanLibrary")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleBackupAll}
            isLoading={busy === "backupAll"}
            disabled={busy !== null || (summary?.gamesWithLocations ?? 0) === 0}
          >
            {t("saves.action.backupAll")}
          </Button>
        </div>
      </SettingsSection>
    </>
  );
}
