import { RefreshCw, Zap } from "lucide-react";
import { Badge, Button, Panel } from "../../components/ui";
import { useLanguage } from "../../context/LanguageContext";
import { useSaves } from "../../context/SavesContext";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { SavesAutomationControls, SavesStorageControls } from "./SavesSettingsControls";

interface SavesSettingsTabProps {
  scanning: boolean;
  backupAllDisabled: boolean;
  onScan: () => void;
  onBackupAll: () => void;
}

/** Hub tab for automation, storage and maintenance. */
export default function SavesSettingsTab({
  scanning,
  backupAllDisabled,
  onScan,
  onBackupAll,
}: SavesSettingsTabProps) {
  const { t } = useLanguage();
  const { settings, summary } = useSaves();
  const { formatBytes } = useSizeUnit();

  if (!settings) return null;

  return (
    <div className="saves-settings">
      <Panel
        heading={t("saves.settings.title")}
        eyebrow={t("nav.saves")}
        actions={
          <Badge variant={settings.enabled ? "success" : "default"} dot>
            {settings.enabled ? t("saves.settings.on") : t("saves.settings.off")}
          </Badge>
        }
      >
        <SavesAutomationControls />
      </Panel>

      <Panel heading={t("saves.settings.storageTitle")}>
        <p className="saves-settings__hint">{t("saves.settings.storageDesc")}</p>
        <SavesStorageControls />
      </Panel>

      <Panel heading={t("saves.settings.maintenanceTitle")}>
        <p className="saves-settings__hint">{t("saves.settings.maintenanceDesc")}</p>
        <div className="saves-maintenance">
          <div className="saves-maintenance__figures">
            <span>
              {t("saves.kpi.games")} <strong>{summary?.gamesWithLocations ?? 0}</strong>
            </span>
            <span>
              {t("saves.kpi.locations")} <strong>{summary?.totalLocations ?? 0}</strong>
            </span>
            <span>
              {t("saves.kpi.backups")} <strong>{summary?.totalBackups ?? 0}</strong>
            </span>
            <span>
              {t("saves.kpi.storageUsed")}{" "}
              <strong>{formatBytes(summary?.totalBackupBytes ?? 0)}</strong>
            </span>
          </div>
          <div className="saves-maintenance__actions">
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<RefreshCw size={14} />}
              onClick={onScan}
              isLoading={scanning}
              disabled={scanning}
            >
              {t("saves.action.scanLibrary")}
            </Button>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Zap size={14} />}
              onClick={onBackupAll}
              disabled={backupAllDisabled}
            >
              {t("saves.action.backupAll")}
            </Button>
          </div>
        </div>
      </Panel>
    </div>
  );
}
