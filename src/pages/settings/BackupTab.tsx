import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Button, ConfirmModal } from "../../components/ui";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import SettingsSection from "./SettingsSection";
import { BackupIcon, CloudIcon, DownloadIcon, RefreshIcon } from "./settingsIcons";
import { formatBackupBytes } from "./backupUtils";
import BackupProgressModal from "./BackupProgressModal";

/** One row of the backup overview (mirrors Rust `DomainStatus`). */
interface DomainStatus {
  name: string;
  sizeBytes: number;
  itemCount?: number;
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

/** Payload from `backup_inspect` (mirrors Rust `BackupInspect`). */
interface BackupInspect {
  createdAt: number;
  appVersion: string;
  domains: string[];
  isRaw?: boolean;
  counts?: Record<string, number>;
}

/** A picked .gibak file whose contents are shown in the restore gate. */
interface PickedBackup {
  path: string;
  createdAt: number;
  domains: string[];
  isRaw?: boolean;
  counts?: Record<string, number>;
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

/** Last path segment of a file dialog result. */
function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/**
 * BackupTab — create .gibak backups of the local domain databases (games,
 * playtime, activity, achievements, …) and restore from one. Both flows
 * let the user pick which domains are included: the create section is a
 * checklist over the databases that have data, and picking a file to
 * restore first inspects the archive (via `backup_inspect`) so its
 * contents can be reviewed and selected before anything is replaced.
 */
export default function BackupTab() {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createTargetPath, setCreateTargetPath] = useState("");
  const [createDomains, setCreateDomains] = useState<string[]>([]);
  const [restoring, setRestoring] = useState(false);
  const [restartOpen, setRestartOpen] = useState(false);

  // Create: which domains (by stem) to include. Absent entries = checked,
  // so every domain starts selected and new domains default to included.
  const [selectedCreate, setSelectedCreate] = useState<Record<string, boolean>>({});
  // Restore: the picked archive being reviewed + its selection.
  const [archive, setArchive] = useState<PickedBackup | null>(null);
  const [selectedRestore, setSelectedRestore] = useState<Record<string, boolean>>({});
  const [restoreMode, setRestoreMode] = useState<"merge" | "replace">("merge");
  const [inspecting, setInspecting] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);

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
      setRestartOpen(false);
    };
  }, [refresh]);

  const existingDomains = status?.domains.filter((d) => d.sizeBytes > 0) ?? [];
  const totalBytes = existingDomains.reduce((acc, d) => acc + d.sizeBytes, 0);

  // ─── Create selection helpers ──────────────────────────────────────────
  const isCreateChecked = (name: string) => selectedCreate[name] !== false;
  const createChoices = existingDomains.filter((d) => isCreateChecked(d.name));
  const createAllSelected =
    existingDomains.length > 0 && existingDomains.every((d) => isCreateChecked(d.name));

  const toggleCreate = (name: string, checked: boolean) =>
    setSelectedCreate((prev) => ({ ...prev, [name]: checked }));

  const setAllCreate = (checked: boolean) =>
    setSelectedCreate(
      Object.fromEntries(existingDomains.map((d) => [d.name, checked])),
    );

  const handleCreate = async () => {
    const chosen = createChoices.map((d) => d.name);
    if (chosen.length === 0) return;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const target = await save({
        title: t("settings.backup.createBtn"),
        defaultPath: `gameindex-backup-${today}.gibak`,
        filters: [{ name: "GameIndex Backup (.gibak)", extensions: ["gibak", "zip"] }],
      });
      if (!target) return;
      setCreateTargetPath(target);
      setCreateDomains(chosen);
      setShowCreateModal(true);
    } catch (err) {
      showToast(t("settings.backup.createFailed", { error: String(err) }), "error");
    }
  };

  // ─── Restore pick + review ─────────────────────────────────────────────
  const pickRestore = async () => {
    try {
      const picked = await open({
        multiple: false,
        title: t("settings.backup.restoreBtn"),
        filters: [{ name: "GameIndex Backup (.gibak)", extensions: ["gibak", "zip"] }],
      });
      if (!picked || typeof picked !== "string") return;
      setArchive(null);
      setReadError(null);
      setInspecting(true);
      try {
        const info = await invoke<BackupInspect>("backup_inspect", {
          sourcePath: picked,
        });
        setArchive({
          path: picked,
          createdAt: info.createdAt,
          domains: info.domains,
          isRaw: info.isRaw,
          counts: info.counts,
        });
        setSelectedRestore({});
      } catch (err) {
        setReadError(t("settings.backup.readFailed", { error: String(err) }));
      } finally {
        setInspecting(false);
      }
    } catch (err) {
      showToast(String(err), "error");
    }
  };

  const isRestoreChecked = (name: string) => selectedRestore[name] !== false;
  const restoreChoices = archive?.domains.filter((name) => isRestoreChecked(name)) ?? [];
  const restoreAllSelected =
    archive !== null && archive.domains.every((name) => isRestoreChecked(name));

  const toggleRestore = (name: string, checked: boolean) =>
    setSelectedRestore((prev) => ({ ...prev, [name]: checked }));

  const setAllRestore = (checked: boolean) => {
    if (!archive) return;
    setSelectedRestore(Object.fromEntries(archive.domains.map((name) => [name, checked])));
  };

  const doRestore = async () => {
    if (!archive) return;
    const chosen = archive.domains.filter((name) => isRestoreChecked(name));
    if (chosen.length === 0) return;
    try {
      setRestoring(true);
      await invoke<BackupOutcome>("backup_restore", {
        sourcePath: archive.path,
        domains: chosen,
        mode: restoreMode,
      });
      showToast(t("settings.backup.restoredToast"), "success");
      setArchive(null);
      setRestartOpen(true);
      await refresh();
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

  const canCreate =
    existingDomains.length === 0 ||
    createChoices.length === 0 ||
    showCreateModal ||
    loading;
  const createDisabledHint = existingDomains.length === 0
    ? t("settings.backup.empty")
    : createChoices.length === 0
      ? t("settings.backup.requireSelection")
      : undefined;

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
                <span className="settings-backup-row-meta">
                  {d.itemCount !== undefined && d.itemCount > 0 && (
                    <span className="settings-backup-row-count">
                      {t("settings.backup.itemCount", { count: d.itemCount })}
                    </span>
                  )}
                  <span className="settings-backup-row-size">
                    {formatBackupBytes(d.sizeBytes)}
                  </span>
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
            disabled={canCreate}
            title={createDisabledHint}
          >
            {showCreateModal ? t("settings.backup.creating") : t("settings.backup.createBtn")}
          </Button>
        </div>
        {existingDomains.length > 0 && (
          <div className="settings-backup-picker">
            <div className="settings-backup-picker-bar">
              <label className="settings-checkbox-label">
                <input
                  type="checkbox"
                  checked={createAllSelected}
                  onChange={(e) => setAllCreate(e.target.checked)}
                />
                {t("settings.backup.selectAll")}
              </label>
              <span className="settings-backup-picker-count">
                {t("settings.backup.selectedCount", {
                  count: createChoices.length,
                  total: existingDomains.length,
                })}
              </span>
            </div>
            {existingDomains.map((d) => (
              <label
                key={d.name}
                className="settings-checkbox-label settings-backup-check-row"
              >
                <input
                  type="checkbox"
                  checked={isCreateChecked(d.name)}
                  onChange={(e) => toggleCreate(d.name, e.target.checked)}
                />
                <span className="settings-backup-row-name">
                  {t(BACKUP_DOMAIN_LABEL_KEYS[d.name] ?? d.name)}
                </span>
                <span className="settings-backup-row-meta">
                  {d.itemCount !== undefined && d.itemCount > 0 && (
                    <span className="settings-backup-row-count">
                      {t("settings.backup.itemCount", { count: d.itemCount })}
                    </span>
                  )}
                  <span className="settings-backup-row-size">
                    {formatBackupBytes(d.sizeBytes)}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}
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
          <Button
            variant="secondary"
            onClick={pickRestore}
            disabled={restoring || inspecting}
          >
            {restoring ? t("settings.backup.restoring") : t("settings.backup.restoreBtn")}
          </Button>
          {inspecting && <span className="settings-backup-note">{t("settings.backup.inspecting")}</span>}
        </div>

        {readError && <div className="settings-backup-error">{readError}</div>}

        {archive && (
          <div className="settings-backup-gate">
            <div className="settings-backup-gate-file">
              <span className="settings-backup-gate-name">{fileName(archive.path)}</span>
              {archive.createdAt > 0 && (
                <span className="settings-backup-gate-date">
                  {t("settings.backup.restoreFrom", {
                    date: new Date(archive.createdAt * 1000).toLocaleString(),
                  })}
                </span>
              )}
            </div>
            <div className="settings-backup-picker">
              <div className="settings-backup-picker-bar">
                <label className="settings-checkbox-label">
                  <input
                    type="checkbox"
                    checked={restoreAllSelected}
                    onChange={(e) => setAllRestore(e.target.checked)}
                  />
                  {t("settings.backup.selectAll")}
                </label>
                <span className="settings-backup-picker-count">
                  {t("settings.backup.selectedCount", {
                    count: restoreChoices.length,
                    total: archive.domains.length,
                  })}
                </span>
              </div>
              {archive.domains.map((name) => {
                const count = archive.counts?.[name];
                return (
                  <label
                    key={name}
                    className="settings-checkbox-label settings-backup-check-row"
                  >
                    <input
                      type="checkbox"
                      checked={isRestoreChecked(name)}
                      onChange={(e) => toggleRestore(name, e.target.checked)}
                    />
                    <span className="settings-backup-row-name">
                      {t(BACKUP_DOMAIN_LABEL_KEYS[name] ?? name)}
                    </span>
                    {count !== undefined && count > 0 && (
                      <span className="settings-backup-row-count">
                        {t("settings.backup.itemCount", { count })}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>

            {archive.isRaw && (
              <div className="settings-backup-mode-box">
                <span className="settings-backup-mode-title">{t("settings.backup.modeTitle")}</span>
                <div className="settings-backup-mode-options">
                  <label className={`settings-backup-mode-card ${restoreMode === "merge" ? "active" : ""}`}>
                    <input
                      type="radio"
                      name="restoreMode"
                      value="merge"
                      checked={restoreMode === "merge"}
                      onChange={() => setRestoreMode("merge")}
                    />
                    <div className="settings-backup-mode-card-content">
                      <span className="settings-backup-mode-card-title">{t("settings.backup.modeMergeTitle")}</span>
                      <span className="settings-backup-mode-card-desc">{t("settings.backup.modeMergeDesc")}</span>
                    </div>
                  </label>
                  <label className={`settings-backup-mode-card ${restoreMode === "replace" ? "active" : ""}`}>
                    <input
                      type="radio"
                      name="restoreMode"
                      value="replace"
                      checked={restoreMode === "replace"}
                      onChange={() => setRestoreMode("replace")}
                    />
                    <div className="settings-backup-mode-card-content">
                      <span className="settings-backup-mode-card-title">{t("settings.backup.modeReplaceTitle")}</span>
                      <span className="settings-backup-mode-card-desc">{t("settings.backup.modeReplaceDesc")}</span>
                    </div>
                  </label>
                </div>
              </div>
            )}

            <p className="settings-backup-gate-warning">
              {archive.isRaw && restoreMode === "merge"
                ? t("settings.backup.restoreConfirmBodyMerge")
                : t("settings.backup.restoreConfirmBody")}
            </p>
            <div className="settings-backup-gate-actions">
              <Button variant="ghost" onClick={() => setArchive(null)} disabled={restoring}>
                {t("common.cancel")}
              </Button>
              <Button
                variant={archive.isRaw && restoreMode === "merge" ? "primary" : "danger"}
                onClick={() => void doRestore()}
                isLoading={restoring}
                disabled={restoreChoices.length === 0}
                title={
                  restoreChoices.length === 0
                    ? t("settings.backup.requireSelection")
                    : undefined
                }
              >
                {t("settings.backup.restoreConfirmBtn")}
              </Button>
            </div>
          </div>
        )}
      </SettingsSection>

      <ConfirmModal
        open={restartOpen}
        title={t("settings.backup.restartTitle")}
        message={t("settings.backup.restartBody")}
        confirmLabel={t("settings.backup.restartBtn")}
        cancelLabel={t("common.cancel")}
        onConfirm={handleRestart}
        onCancel={() => setRestartOpen(false)}
      />

      {showCreateModal && (
        <BackupProgressModal
          open={showCreateModal}
          targetPath={createTargetPath}
          domains={createDomains}
          onComplete={() => {
            showToast(t("settings.backup.createdToast"), "success");
            void refresh();
          }}
          onClose={() => {
            setShowCreateModal(false);
            void refresh();
          }}
        />
      )}
    </>
  );
}
