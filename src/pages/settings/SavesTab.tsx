import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { useSaves } from "../../context/SavesContext";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { Button, Badge } from "../../components/ui";
import SettingsSection from "./SettingsSection";
import { BackupIcon, FolderIcon, ListIcon, RefreshIcon, ShieldIcon } from "./settingsIcons";
import {
  SavesAutomationControls,
  SavesStorageControls,
} from "../saves/SavesSettingsControls";
import type { SaveBackup } from "../../types/saves";

/**
 * SavesTab — Settings → Saves.
 *
 * The single place the Save Backups suite is switched on and configured. Its
 * master toggle gates the top-nav "Saves" tab and the per-game "Saves" detail
 * tab, so this tab stays reachable even while the feature is off.
 *
 * The controls are the same components the Saves hub renders, so the two
 * surfaces can never drift apart.
 */
export default function SavesTab() {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { settings, summary, scanAll, refresh } = useSaves();
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
        <SavesAutomationControls />
      </SettingsSection>

      <SettingsSection
        id="saves-storage"
        icon={<FolderIcon />}
        title={t("saves.settings.storageTitle")}
        desc={t("saves.settings.storageDesc")}
      >
        <SavesStorageControls />
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
