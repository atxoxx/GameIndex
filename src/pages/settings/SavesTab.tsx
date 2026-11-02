import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { useSaves } from "../../context/SavesContext";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { Button } from "../../components/ui";
import SettingsSection from "./SettingsSection";
import SettingsRow from "./SettingsRow";
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
 * surfaces can never drift apart. Maintenance is expert-only: it acts on the
 * whole library at once, so it hides while the Essentials filter is on.
 */
export default function SavesTab() {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { settings, summary, scanAll, refresh, ready } = useSaves();
  const { formatBytes } = useSizeUnit();
  const [busy, setBusy] = useState<null | "scan" | "backupAll">(null);
  const [retrying, setRetrying] = useState(false);

  if (!settings) {
    return (
      <SettingsSection
        id="saves-feature"
        icon={<BackupIcon />}
        title={t("saves.settings.title")}
        desc={ready ? t("saves.settings.unavailable") : t("saves.settings.loading")}
      >
        {ready && (
          <div className="settings-field">
            <Button
              variant="secondary"
              isLoading={retrying}
              onClick={() => {
                setRetrying(true);
                void refresh().finally(() => setRetrying(false));
              }}
            >
              {t("common.retry")}
            </Button>
          </div>
        )}
      </SettingsSection>
    );
  }

  const gamesWithLocations = summary?.gamesWithLocations ?? 0;
  const backupAllBlocked = gamesWithLocations === 0;

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
        advanced
      >
        <div className="saves-setting-stats">
          <span className="saves-setting-stat">
            <ListIcon />
            {t("saves.kpi.games")}: <strong>{gamesWithLocations}</strong>
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

        <SettingsRow
          layout="stacked"
          title={t("saves.action.backupAll")}
          desc={t("saves.confirm.backupAllMessage")}
          disabledHint={
            backupAllBlocked && busy === null ? t("saves.page.noGamesText") : undefined
          }
          control={
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
                disabled={busy !== null || backupAllBlocked}
              >
                {t("saves.action.backupAll")}
              </Button>
            </div>
          }
        />
      </SettingsSection>
    </>
  );
}
