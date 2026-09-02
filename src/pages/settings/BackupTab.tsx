import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Button, ConfirmModal } from "../../components/ui";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import SettingsSection from "./SettingsSection";
import { BackupIcon, CloudIcon, DownloadIcon, RefreshIcon } from "./settingsIcons";
import { formatBackupBytes } from "./backupUtils";

/** One row of the backup overview (mirrors Rust `DomainStatus`). */
interface DomainStatus {
  name: string;
  sizeBytes: number;
}

/** Status payload from `backup_get_status` (mirrors Rust `BackupStatus`). */
interface BackupStatus {
  lastBackupAt: number | null;
  lastBackupBytes: number | null;
  domains: DomainStatus[];
}

/** Outcome payload from create/restore (mirrors Rust `BackupOutcome`). */
interface BackupOutcome {
  filePath: string;
  sizeBytes: number;
  createdAt: number;
  domains: string[];
}

/** Domain file stem → localized label key. Unknown stems fall back to raw. */
const BACKUP_DOMAIN_LABEL_KEYS: Record<string, string> = {
  games: "settings.backup.domain.games",
  sessions: "settings.backup.domain.sessions",
  sources: "settings.backup.domain.sources",
  download_history: "settings.backup.domain.downloadHistory",
  wishlist: "settings.backup.domain.wishlist",
  store_cache: "settings.backup.domain.storeCache",
  achievements: "settings.backup.domain.achievements",
  kv: "settings.backup.domain.settings",
  news: "settings.backup.domain.news",
  emulators: "settings.backup.domain.emulators",
  mods: "settings.backup.domain.mods",
  plugins: "settings.backup.domain.plugins",
};

/**
 * BackupTab — create full backups of the local domain databases (games,
 * playtime, activity, achievements, …) as a single .gibak file, and
 * restore from one. Restore streams the staged databases back into the
 * live pools and asks for a relaunch so every pool re-opens cleanly.
 */
export default function BackupTab() {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<string | null>(null);
  const [restartOpen, setRestartOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await invoke<BackupStatus>("backup_get_status"));
    } catch (err) {
      showToast(String(err), "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void refresh();
    return () => {
      setPendingRestore(null);
      setRestartOpen(false);
    };
  }, [refresh]);

  const existingDomains = status?.domains.filter((d) => d.sizeBytes > 0) ?? [];
  const totalBytes = existingDomains.reduce((acc, d) => acc + d.sizeBytes, 0);

  const handleCreate = async () => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const target = await save({
        title: t("settings.backup.createBtn"),
        defaultPath: `gameindex-backup-${today}.gibak`,
        filters: [{ name: "GameIndex Backup (.gibak)", extensions: ["gibak", "zip"] }],
      });
      if (!target) return;
      setCreating(true);
      await invoke<BackupOutcome>("backup_create", { targetPath: target });
      showToast(t("settings.backup.createdToast"), "success");
      await refresh();
    } catch (err) {
      showToast(t("settings.backup.createFailed", { error: String(err) }), "error");
    } finally {
      setCreating(false);
    }
  };

  const pickRestore = async () => {
    try {
      const picked = await open({
        multiple: false,
        title: t("settings.backup.restoreBtn"),
        filters: [{ name: "GameIndex Backup (.gibak)", extensions: ["gibak", "zip"] }],
      });
      if (!picked || typeof picked !== "string") return;
      setPendingRestore(picked);
    } catch (err) {
      showToast(String(err), "error");
    }
  };

  const doRestore = async () => {
    if (!pendingRestore) return;
    try {
      setRestoring(true);
      await invoke<BackupOutcome>("backup_restore", { sourcePath: pendingRestore });
      showToast(t("settings.backup.restoredToast"), "success");
      setPendingRestore(null);
      setRestartOpen(true);
    } catch (err) {
      showToast(t("settings.backup.restoreFailed", { error: String(err) }), "error");
    } finally {
      setRestoring(false);
    }
  };

  const handleRestart = async () => {
    try {
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch {
      window.location.reload();
    }
  };

  return (
    <>
      <SettingsSection
        id="backup-overview"
        icon={<BackupIcon />}
        title={t("settings.section.backupOverview")}
        desc={t("settings.backup.overviewDesc")}
      >
        <div className="settings-wipe-toolbar settings-backup-toolbar">
          <span className="settings-wipe-count">
            {status?.lastBackupAt
              ? t("settings.backup.lastBackup", {
                  date: new Date(status.lastBackupAt * 1000).toLocaleString(),
                })
              : t("settings.backup.never")}
          </span>
          {existingDomains.length > 0 && (
            <span className="settings-wipe-count">
              {t("settings.backup.totalSize", { size: formatBackupBytes(totalBytes) })}
            </span>
          )}
          <span className="settings-wipe-count">
            {t("settings.backup.domainCount", { count: existingDomains.length })}
          </span>
          <div className="settings-wipe-actions">
            <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={loading}>
              <RefreshIcon />
              {t("common.refresh")}
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="settings-backup-empty">{t("common.loading")}</div>
        ) : existingDomains.length === 0 ? (
          <div className="settings-backup-empty">{t("settings.backup.empty")}</div>
        ) : (
          <ul className="settings-backup-list">
            {existingDomains.map((d) => (
              <li key={d.name} className="settings-backup-row">
                <span className="settings-backup-row-name">
                  {t(BACKUP_DOMAIN_LABEL_KEYS[d.name] ?? d.name)}
                </span>
                <span className="settings-backup-row-size">
                  {formatBackupBytes(d.sizeBytes)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>

      <SettingsSection
        id="backup-create"
        icon={<DownloadIcon />}
        title={t("settings.section.backupCreate")}
        desc={t("settings.backup.createDesc")}
      >
        <div className="settings-backup-actions">
          <Button
            onClick={handleCreate}
            disabled={creating || loading || existingDomains.length === 0}
            title={
              existingDomains.length === 0 ? t("settings.backup.empty") : undefined
            }
          >
            {creating ? t("settings.backup.creating") : t("settings.backup.createBtn")}
          </Button>
        </div>
        <p className="settings-backup-note">
          <strong>{t("settings.backup.included")}:</strong>{" "}
          {existingDomains
            .map((d) => t(BACKUP_DOMAIN_LABEL_KEYS[d.name] ?? d.name))
            .join(" · ")}
        </p>
        <p className="settings-backup-note">
          <strong>{t("settings.backup.notIncluded")}:</strong>{" "}
          {t("settings.backup.notIncludedDesc")}
        </p>
      </SettingsSection>

      <SettingsSection
        id="backup-restore"
        icon={<CloudIcon />}
        title={t("settings.section.backupRestore")}
        desc={t("settings.backup.restoreDesc")}
      >
        <div className="settings-backup-actions">
          <Button variant="secondary" onClick={pickRestore} disabled={restoring}>
            {restoring ? t("settings.backup.restoring") : t("settings.backup.restoreBtn")}
          </Button>
        </div>
      </SettingsSection>

      <ConfirmModal
        open={pendingRestore !== null}
        title={t("settings.backup.restoreConfirmTitle")}
        message={t("settings.backup.restoreConfirmBody")}
        confirmLabel={t("settings.backup.restoreConfirmBtn")}
        cancelLabel={t("common.cancel")}
        onConfirm={doRestore}
        onCancel={() => setPendingRestore(null)}
      />

      <ConfirmModal
        open={restartOpen}
        title={t("settings.backup.restartTitle")}
        message={t("settings.backup.restartBody")}
        confirmLabel={t("settings.backup.restartBtn")}
        cancelLabel={t("common.cancel")}
        onConfirm={handleRestart}
        onCancel={() => setRestartOpen(false)}
      />
    </>
  );
}