import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  Clock,
  Database,
  Download,
  FileArchive,
  FolderOpen,
  HardDrive,
  Layers,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Upload,
  Zap,
} from "lucide-react";
import { Badge, Button, ConfirmModal, KpiTile } from "../../components/ui";
import { useLanguage } from "../../context/LanguageContext";
import { useSettings } from "../../context/SettingsContext";
import { useToast } from "../../context/ToastContext";
import SettingsSection from "./SettingsSection";
import SettingsToggleCard from "./SettingsToggleCard";
import BackupProgressModal from "./BackupProgressModal";
import {
  formatBackupBytes,
  formatBackupDate,
  formatBackupRelative,
  getDomainColor,
} from "./backupUtils";
import type {
  BackupArchiveSummary,
  BackupConfig,
  BackupInspect,
  BackupOutcome,
  BackupPreset,
  BackupStatus,
  BackupSubtab,
} from "../../types/backup";

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
  compatibility: "settings.backup.domain.compatibility",
  saves: "settings.backup.domain.saves",
};

/** Essential domains for the quick preset. */
const ESSENTIAL_DOMAINS = ["games", "sessions", "wishlist", "achievements", "kv", "saves"];
/** Minimal metadata domains for the minimal preset. */
const MINIMAL_DOMAINS = ["games", "wishlist", "kv"];

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export default function BackupTab() {
  const { t } = useLanguage();
  const { showFullLinuxUi } = useSettings();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  // Active subtab: synced with deep link ?section=
  const initialSection = searchParams.get("section");
  const [subtab, setSubtab] = useState<BackupSubtab>(() => {
    if (initialSection === "backup-create") return "create";
    if (initialSection === "backup-restore") return "restore";
    if (initialSection === "backup-settings") return "settings";
    return "overview";
  });

  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [config, setConfig] = useState<BackupConfig | null>(null);
  const [archives, setArchives] = useState<BackupArchiveSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [quickBusy, setQuickBusy] = useState(false);

  // ─── Create subtab state ──────────────────────────────────────────────
  const [preset, setPreset] = useState<BackupPreset>("full");
  const [selectedCreate, setSelectedCreate] = useState<Record<string, boolean>>({});
  const [createFilter, setCreateFilter] = useState("");
  const [destinationType, setDestinationType] = useState<"default" | "custom">("default");
  const [backupNote, setBackupNote] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createTargetPath, setCreateTargetPath] = useState("");
  const [createDomains, setCreateDomains] = useState<string[]>([]);

  // ─── Restore subtab state ─────────────────────────────────────────────
  const [archive, setArchive] = useState<(BackupInspect & { path: string }) | null>(null);
  const [selectedRestore, setSelectedRestore] = useState<Record<string, boolean>>({});
  const [restoreMode, setRestoreMode] = useState<"merge" | "replace">("merge");
  const [safetySnapshot, setSafetySnapshot] = useState(true);
  const [inspecting, setInspecting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [restartOpen, setRestartOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // ─── Archive management & deletion ───────────────────────────────────
  const [archiveToDelete, setArchiveToDelete] = useState<BackupArchiveSummary | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // ─── Settings subtab state ────────────────────────────────────────────
  const [savingConfig, setSavingConfig] = useState(false);

  // Synchronize section parameter with active subtab
  useEffect(() => {
    const section = searchParams.get("section");
    if (section === "backup-create" && subtab !== "create") setSubtab("create");
    else if (section === "backup-restore" && subtab !== "restore") setSubtab("restore");
    else if (section === "backup-settings" && subtab !== "settings") setSubtab("settings");
    else if (section === "backup-overview" && subtab !== "overview") setSubtab("overview");
  }, [searchParams, subtab]);

  const handleSelectSubtab = (tab: BackupSubtab) => {
    setSubtab(tab);
    const sectionId =
      tab === "overview"
        ? "backup-overview"
        : tab === "create"
          ? "backup-create"
          : tab === "restore"
            ? "backup-restore"
            : "backup-settings";
    setSearchParams({ section: sectionId }, { replace: true });
  };

  const isDomainVisible = useCallback(
    (name: string) => showFullLinuxUi || name !== "compatibility",
    [showFullLinuxUi],
  );

  const refreshAll = useCallback(async () => {
    try {
      const [newStatus, newConfig, newArchives] = await Promise.all([
        invoke<BackupStatus>("backup_get_status"),
        invoke<BackupConfig>("backup_get_config").catch(() => null),
        invoke<BackupArchiveSummary[]>("backup_list_archives").catch(() => []),
      ]);
      setStatus(newStatus);
      if (newConfig) {
        setConfig(newConfig);
        setSafetySnapshot(newConfig.safetyBackupBeforeRestore);
      }
      setArchives(newArchives);
    } catch (err) {
      showToast(String(err), "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const existingDomains = useMemo(() => {
    return status?.domains.filter((d) => isDomainVisible(d.name)) ?? [];
  }, [status, isDomainVisible]);

  const domainsWithData = useMemo(() => {
    return existingDomains.filter((d) => d.sizeBytes > 0);
  }, [existingDomains]);

  const totalBytes = useMemo(() => {
    return domainsWithData.reduce((acc, d) => acc + d.sizeBytes, 0);
  }, [domainsWithData]);

  const totalRecords = useMemo(() => {
    return existingDomains.reduce((acc, d) => acc + (d.itemCount ?? 0), 0);
  }, [existingDomains]);

  // ─── Preset selection handler ─────────────────────────────────────────
  const applyPreset = useCallback(
    (newPreset: BackupPreset) => {
      setPreset(newPreset);
      if (newPreset === "full") {
        setSelectedCreate(Object.fromEntries(existingDomains.map((d) => [d.name, true])));
      } else if (newPreset === "essential") {
        setSelectedCreate(
          Object.fromEntries(
            existingDomains.map((d) => [d.name, ESSENTIAL_DOMAINS.includes(d.name)]),
          ),
        );
      } else if (newPreset === "minimal") {
        setSelectedCreate(
          Object.fromEntries(
            existingDomains.map((d) => [d.name, MINIMAL_DOMAINS.includes(d.name)]),
          ),
        );
      }
    },
    [existingDomains],
  );

  // Initialize create selections once domains load
  useEffect(() => {
    if (existingDomains.length > 0 && Object.keys(selectedCreate).length === 0) {
      applyPreset("full");
    }
  }, [existingDomains, selectedCreate, applyPreset]);

  const isCreateChecked = (name: string) => selectedCreate[name] !== false;

  const filteredCreateDomains = useMemo(() => {
    const q = createFilter.trim().toLowerCase();
    if (!q) return existingDomains;
    return existingDomains.filter((d) => {
      const label = t(BACKUP_DOMAIN_LABEL_KEYS[d.name] ?? d.name).toLowerCase();
      return label.includes(q) || d.name.toLowerCase().includes(q);
    });
  }, [existingDomains, createFilter, t]);

  const createChoices = useMemo(() => {
    return existingDomains.filter((d) => isCreateChecked(d.name));
  }, [existingDomains, selectedCreate]);

  const toggleCreate = (name: string, checked: boolean) => {
    setPreset("custom");
    setSelectedCreate((prev) => ({ ...prev, [name]: checked }));
  };

  const setAllCreate = (checked: boolean) => {
    setPreset("custom");
    setSelectedCreate(Object.fromEntries(existingDomains.map((d) => [d.name, checked])));
  };

  // ─── 1-Click Quick Backup ─────────────────────────────────────────────
  const handleQuickBackup = async () => {
    setQuickBusy(true);
    try {
      const outcome = await invoke<BackupOutcome>("backup_quick_create", {
        note: backupNote.trim() || null,
      });
      showToast(t("settings.backup.quickBackupSuccess"), "success");
      setBackupNote("");
      await refreshAll();
      return outcome;
    } catch (err) {
      showToast(t("settings.backup.createFailed", { error: String(err) }), "error");
    } finally {
      setQuickBusy(false);
    }
  };

  // ─── Custom Create Backup ─────────────────────────────────────────────
  const handleStartCreate = async () => {
    const chosen = createChoices.map((d) => d.name);
    if (chosen.length === 0) return;

    if (destinationType === "default") {
      // Quick execute into default directory with progress modal
      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10);
      const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, "");
      const noteSuffix = backupNote.trim() ? `-${backupNote.trim().replace(/[^a-zA-Z0-9_-]/g, "-")}` : "";
      const baseDir = config?.backupDir || "backups";
      const target = `${baseDir}/gameindex-backup-${dateStr}-${timeStr}${noteSuffix}.gibak`;
      setCreateTargetPath(target);
      setCreateDomains(chosen);
      setShowCreateModal(true);
    } else {
      // Custom Save As file picker
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
    }
  };

  // ─── Inspect an archive from path ─────────────────────────────────────
  const inspectPath = async (filePath: string) => {
    setReadError(null);
    setInspecting(true);
    try {
      const info = await invoke<BackupInspect>("backup_inspect", {
        sourcePath: filePath,
      });
      setArchive({
        path: filePath,
        createdAt: info.createdAt,
        appVersion: info.appVersion,
        domains: info.domains,
        isRaw: info.isRaw,
        counts: info.counts,
      });
      setSelectedRestore({});
      setSubtab("restore");
      setSearchParams({ section: "backup-restore" }, { replace: true });
    } catch (err) {
      setReadError(t("settings.backup.readFailed", { error: String(err) }));
      showToast(t("settings.backup.readFailed", { error: String(err) }), "error");
    } finally {
      setInspecting(false);
    }
  };

  // ─── Pick archive file dialog ─────────────────────────────────────────
  const pickRestore = async () => {
    try {
      const picked = await open({
        multiple: false,
        title: t("settings.backup.restoreBtn"),
        filters: [{ name: "GameIndex Backup (.gibak)", extensions: ["gibak", "zip"] }],
      });
      if (!picked || typeof picked !== "string") return;
      await inspectPath(picked);
    } catch (err) {
      showToast(String(err), "error");
    }
  };

  // ─── Drag & Drop handling ─────────────────────────────────────────────
  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      // File.path is available in Tauri webview
      const path = (file as unknown as { path?: string }).path;
      if (path && (path.endsWith(".gibak") || path.endsWith(".zip"))) {
        void inspectPath(path);
      } else {
        showToast("Please drop a valid .gibak or .zip backup archive.", "warning");
      }
    }
  };

  // ─── Restore choices ──────────────────────────────────────────────────
  const isRestoreChecked = (name: string) => selectedRestore[name] !== false;
  const archiveDomains = useMemo(() => {
    return archive?.domains.filter(isDomainVisible) ?? [];
  }, [archive, isDomainVisible]);

  const restoreChoices = useMemo(() => {
    return archiveDomains.filter((name) => isRestoreChecked(name));
  }, [archiveDomains, selectedRestore]);

  const restoreAllSelected =
    archive !== null &&
    archiveDomains.length > 0 &&
    archiveDomains.every((name) => isRestoreChecked(name));

  const toggleRestore = (name: string, checked: boolean) =>
    setSelectedRestore((prev) => ({ ...prev, [name]: checked }));

  const setAllRestore = (checked: boolean) => {
    if (!archive) return;
    setSelectedRestore(Object.fromEntries(archiveDomains.map((name) => [name, checked])));
  };

  const doRestore = async () => {
    if (!archive || restoreChoices.length === 0) return;
    try {
      setRestoring(true);
      await invoke<BackupOutcome>("backup_restore", {
        sourcePath: archive.path,
        domains: restoreChoices,
        mode: restoreMode,
        createSafetySnapshot: safetySnapshot,
      });
      showToast(t("settings.backup.restoredToast"), "success");
      setArchive(null);
      setRestartOpen(true);
      await refreshAll();
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

  // ─── Archive deletion ─────────────────────────────────────────────────
  const handleDeleteArchive = async () => {
    if (!archiveToDelete) return;
    setDeleteBusy(true);
    try {
      await invoke("backup_delete_archive", { filePath: archiveToDelete.filePath });
      showToast(t("settings.backup.archiveDeleted"), "success");
      setArchiveToDelete(null);
      await refreshAll();
    } catch (err) {
      showToast(t("settings.backup.archiveDeleteFailed", { error: String(err) }), "error");
    } finally {
      setDeleteBusy(false);
    }
  };

  // ─── Open folder ──────────────────────────────────────────────────────
  const handleOpenFolder = async (folderPath?: string) => {
    const target = folderPath || config?.backupDir;
    if (!target) return;
    try {
      await invoke("open_folder", { path: target });
    } catch (err) {
      showToast(String(err), "error");
    }
  };

  // ─── Change backup directory ──────────────────────────────────────────
  const handleChangeFolder = async () => {
    try {
      const picked = await open({
        directory: true,
        multiple: false,
        title: t("settings.backup.folderTitle"),
        defaultPath: config?.backupDir,
      });
      if (picked && typeof picked === "string" && config) {
        setSavingConfig(true);
        const updated = await invoke<BackupConfig>("backup_save_config", {
          config: { ...config, backupDir: picked },
        });
        setConfig(updated);
        showToast(t("settings.backup.settingsSaved"), "success");
        await refreshAll();
      }
    } catch (err) {
      showToast(String(err), "error");
    } finally {
      setSavingConfig(false);
    }
  };

  // ─── Update config helper ─────────────────────────────────────────────
  const updateConfig = async (patch: Partial<BackupConfig>) => {
    if (!config) return;
    setSavingConfig(true);
    try {
      const updated = await invoke<BackupConfig>("backup_save_config", {
        config: { ...config, ...patch },
      });
      setConfig(updated);
      showToast(t("settings.backup.settingsSaved"), "success");
    } catch (err) {
      showToast(String(err), "error");
    } finally {
      setSavingConfig(false);
    }
  };

  // Health calculation
  const backupHealth = useMemo(() => {
    if (!status?.lastBackupAt) return { status: "never", label: t("settings.backup.health.never"), intent: "default" as const };
    const ageDays = (Date.now() / 1000 - status.lastBackupAt) / 86400;
    if (ageDays <= 7) return { status: "recent", label: t("settings.backup.health.recent"), intent: "accent" as const };
    return { status: "stale", label: t("settings.backup.health.stale"), intent: "warning" as const };
  }, [status, t]);

  const canCreate =
    existingDomains.length === 0 ||
    createChoices.length === 0 ||
    showCreateModal ||
    loading ||
    quickBusy;

  return (
    <div className="backup-suite">
      {/* ─── Top Subtabs Strip ───────────────────────────────────────── */}
      <nav className="backup-subtabs-bar" aria-label="Backup views">
        <button
          type="button"
          className={`backup-subtab-pill ${subtab === "overview" ? "active" : ""}`}
          onClick={() => handleSelectSubtab("overview")}
        >
          <Database className="backup-subtab-icon" size={16} />
          <span>{t("settings.backup.subtab.overview")}</span>
          {archives.length > 0 && <span className="backup-subtab-badge">{archives.length}</span>}
        </button>

        <button
          type="button"
          className={`backup-subtab-pill ${subtab === "create" ? "active" : ""}`}
          onClick={() => handleSelectSubtab("create")}
        >
          <Download className="backup-subtab-icon" size={16} />
          <span>{t("settings.backup.subtab.create")}</span>
        </button>

        <button
          type="button"
          className={`backup-subtab-pill ${subtab === "restore" ? "active" : ""}`}
          onClick={() => handleSelectSubtab("restore")}
        >
          <Upload className="backup-subtab-icon" size={16} />
          <span>{t("settings.backup.subtab.restore")}</span>
          {archive && <span className="backup-subtab-badge backup-subtab-badge--highlight">1</span>}
        </button>

        <button
          type="button"
          className={`backup-subtab-pill ${subtab === "settings" ? "active" : ""}`}
          onClick={() => handleSelectSubtab("settings")}
        >
          <SlidersHorizontal className="backup-subtab-icon" size={16} />
          <span>{t("settings.backup.subtab.settings")}</span>
        </button>
      </nav>

      {/* ═══════════════════════════════════════════════════════════════
          SUBTAB 1: OVERVIEW & SNAPSHOTS
          ═══════════════════════════════════════════════════════════════ */}
      {subtab === "overview" && (
        <SettingsSection
          id="backup-overview"
          icon={<Database size={18} />}
          title={t("settings.section.backupOverview")}
          desc={t("settings.backup.overviewDesc")}
        >
          {/* Quick Action Toolbar Hero */}
          <div className="backup-overview-hero-bar">
            <div className="backup-overview-hero-text">
              <span className="backup-hero-title">{t("settings.backup.quickBackup")}</span>
              <span className="backup-hero-desc">{t("settings.backup.quickBackupDesc")}</span>
            </div>
            <div className="backup-overview-hero-actions">
              <Button
                variant="primary"
                size="sm"
                onClick={() => void handleQuickBackup()}
                isLoading={quickBusy}
                disabled={loading || domainsWithData.length === 0}
              >
                <Zap size={14} />
                {t("settings.backup.quickBackup")}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handleOpenFolder()}
                disabled={!config?.backupDir}
              >
                <FolderOpen size={14} />
                {t("settings.backup.openFolder")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void refreshAll()}
                disabled={loading}
              >
                <RefreshCw size={14} />
                {t("common.refresh")}
              </Button>
            </div>
          </div>

          {/* KPI Summary Tiles */}
          <div className="backup-kpi-grid">
            <KpiTile
              label={t("settings.backup.kpi.totalStorage")}
              value={formatBackupBytes(totalBytes)}
              icon={<HardDrive size={16} />}
              size="sm"
              intent="accent"
            />
            <KpiTile
              label={t("settings.backup.kpi.totalRecords")}
              value={totalRecords.toLocaleString()}
              icon={<Layers size={16} />}
              size="sm"
              intent="info"
            />
            <KpiTile
              label={t("settings.backup.kpi.domainsActive")}
              value={`${domainsWithData.length} / ${existingDomains.length}`}
              icon={<Database size={16} />}
              size="sm"
            />
            <KpiTile
              label={t("settings.backup.kpi.backupHealth")}
              value={backupHealth.label}
              subtext={
                status?.lastBackupAt ? formatBackupRelative(status.lastBackupAt) : undefined
              }
              icon={<ShieldCheck size={16} />}
              size="sm"
              intent={backupHealth.intent}
            />
          </div>

          {/* Proportional Storage Breakdown Meter */}
          {domainsWithData.length > 0 && totalBytes > 0 && (
            <div className="backup-storage-meter-card">
              <div className="backup-meter-header">
                <span className="backup-meter-title">
                  {t("settings.backup.storageBreakdown")}
                </span>
                <span className="backup-meter-total">{formatBackupBytes(totalBytes)}</span>
              </div>

              {/* Progress-style segmented meter */}
              <div className="backup-meter-bar" role="progressbar" aria-valuenow={100}>
                {domainsWithData.map((d) => {
                  const pct = Math.max(1.5, (d.sizeBytes / totalBytes) * 100);
                  const color = getDomainColor(d.name);
                  return (
                    <div
                      key={d.name}
                      className="backup-meter-segment"
                      style={{ width: `${pct}%`, backgroundColor: color }}
                      title={`${t(BACKUP_DOMAIN_LABEL_KEYS[d.name] ?? d.name)}: ${formatBackupBytes(d.sizeBytes)} (${((d.sizeBytes / totalBytes) * 100).toFixed(1)}%)`}
                    />
                  );
                })}
              </div>

              {/* Interactive Legend */}
              <div className="backup-meter-legend">
                {domainsWithData.map((d) => {
                  const color = getDomainColor(d.name);
                  const pct = ((d.sizeBytes / totalBytes) * 100).toFixed(1);
                  return (
                    <div key={d.name} className="backup-legend-chip">
                      <span className="backup-legend-dot" style={{ backgroundColor: color }} />
                      <span className="backup-legend-name">
                        {t(BACKUP_DOMAIN_LABEL_KEYS[d.name] ?? d.name)}
                      </span>
                      <span className="backup-legend-size">{formatBackupBytes(d.sizeBytes)}</span>
                      <span className="backup-legend-pct">{pct}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Discovered Snapshots / Archives Manager */}
          <div className="backup-archives-section">
            <div className="backup-section-header-row">
              <div className="backup-section-title-wrap">
                <h3 className="backup-card-title">{t("settings.backup.archivesTitle")}</h3>
                <span className="backup-card-count">{archives.length}</span>
              </div>
              <span className="backup-section-subtitle">{t("settings.backup.archivesDesc")}</span>
            </div>

            {archives.length === 0 ? (
              <div className="backup-empty-card">
                <FileArchive size={32} className="backup-empty-icon" />
                <p className="backup-empty-title">{t("settings.backup.noArchives")}</p>
                <p className="backup-empty-desc">{t("settings.backup.noArchivesHint")}</p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleSelectSubtab("create")}
                >
                  <Download size={14} />
                  {t("settings.backup.subtab.create")}
                </Button>
              </div>
            ) : (
              <div className="backup-archives-list">
                {archives.map((arc) => (
                  <article key={arc.filePath} className="backup-archive-card">
                    <div className="backup-archive-icon-wrap">
                      <FileArchive size={20} className="backup-archive-icon" />
                    </div>
                    <div className="backup-archive-main">
                      <div className="backup-archive-header">
                        <span className="backup-archive-name" title={arc.filePath}>
                          {arc.fileName}
                        </span>
                        <Badge variant={arc.isRaw ? "accent" : "default"} size="sm">
                          {arc.isRaw ? t("settings.backup.rawFormat") : t("settings.backup.legacyFormat")}
                        </Badge>
                      </div>
                      <div className="backup-archive-meta">
                        <span className="backup-archive-time" title={formatBackupDate(arc.createdAt)}>
                          <Clock size={12} />
                          {formatBackupRelative(arc.createdAt)}
                        </span>
                        <span>·</span>
                        <span>{formatBackupBytes(arc.sizeBytes)}</span>
                        <span>·</span>
                        <span>{t("settings.backup.domainCount", { count: arc.domainCount })}</span>
                        <span>·</span>
                        <span>{t("settings.backup.recordsCount", { count: arc.totalRecords.toLocaleString() })}</span>
                        {arc.appVersion && (
                          <>
                            <span>·</span>
                            <span>{t("settings.backup.version", { version: arc.appVersion })}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="backup-archive-actions">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void inspectPath(arc.filePath)}
                      >
                        <Upload size={14} />
                        {t("settings.backup.quickRestoreBtn")}
                      </Button>
                      <button
                        type="button"
                        className="backup-action-icon-btn"
                        onClick={() => void handleOpenFolder(arc.filePath.replace(/[\\/][^\\/]*$/, ""))}
                        title={t("settings.backup.openFolder")}
                        aria-label={t("settings.backup.openFolder")}
                      >
                        <FolderOpen size={16} />
                      </button>
                      <button
                        type="button"
                        className="backup-action-icon-btn backup-action-icon-btn--danger"
                        onClick={() => setArchiveToDelete(arc)}
                        title={t("settings.backup.deleteBtn")}
                        aria-label={t("settings.backup.deleteBtn")}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>

          {/* Database Registry List */}
          <div className="backup-database-registry-card">
            <h3 className="backup-card-title">{t("settings.backup.databaseHealth")}</h3>
            <ul className="settings-backup-list">
              {existingDomains.map((d) => (
                <li key={d.name} className="settings-backup-row">
                  <div className="backup-row-name-wrap">
                    <span
                      className="backup-row-color-dot"
                      style={{ backgroundColor: getDomainColor(d.name) }}
                    />
                    <span className="settings-backup-row-name">
                      {t(BACKUP_DOMAIN_LABEL_KEYS[d.name] ?? d.name)}
                    </span>
                  </div>
                  <div className="settings-backup-row-meta">
                    {d.itemCount !== undefined && d.itemCount > 0 && (
                      <span className="settings-backup-row-count">
                        {t("settings.backup.itemCount", { count: d.itemCount })}
                      </span>
                    )}
                    <span className="settings-backup-row-size">
                      {formatBackupBytes(d.sizeBytes)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </SettingsSection>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          SUBTAB 2: CREATE BACKUP
          ═══════════════════════════════════════════════════════════════ */}
      {subtab === "create" && (
        <SettingsSection
          id="backup-create"
          icon={<Download size={18} />}
          title={t("settings.section.backupCreate")}
          desc={t("settings.backup.createDesc")}
        >
          {/* Preset Selector */}
          <div className="backup-preset-container">
            <span className="backup-control-label">{t("settings.backup.preset.full")} presets</span>
            <div className="backup-presets-grid">
              <button
                type="button"
                className={`backup-preset-card ${preset === "full" ? "active" : ""}`}
                onClick={() => applyPreset("full")}
              >
                <div className="backup-preset-card-title">
                  {t("settings.backup.preset.full")}
                </div>
                <div className="backup-preset-card-desc">
                  {t("settings.backup.preset.fullDesc")}
                </div>
              </button>

              <button
                type="button"
                className={`backup-preset-card ${preset === "essential" ? "active" : ""}`}
                onClick={() => applyPreset("essential")}
              >
                <div className="backup-preset-card-title">
                  {t("settings.backup.preset.essential")}
                </div>
                <div className="backup-preset-card-desc">
                  {t("settings.backup.preset.essentialDesc")}
                </div>
              </button>

              <button
                type="button"
                className={`backup-preset-card ${preset === "minimal" ? "active" : ""}`}
                onClick={() => applyPreset("minimal")}
              >
                <div className="backup-preset-card-title">
                  {t("settings.backup.preset.minimal")}
                </div>
                <div className="backup-preset-card-desc">
                  {t("settings.backup.preset.minimalDesc")}
                </div>
              </button>

              <button
                type="button"
                className={`backup-preset-card ${preset === "custom" ? "active" : ""}`}
                onClick={() => setPreset("custom")}
              >
                <div className="backup-preset-card-title">
                  {t("settings.backup.preset.custom")}
                </div>
                <div className="backup-preset-card-desc">
                  {t("settings.backup.preset.customDesc")}
                </div>
              </button>
            </div>
          </div>

          {/* Search & Selection Controls */}
          <div className="backup-selection-header-bar">
            <div className="backup-search-wrap">
              <Search size={14} className="backup-search-icon" />
              <input
                type="search"
                className="backup-search-input"
                placeholder={t("settings.backup.searchPlaceholder")}
                value={createFilter}
                onChange={(e) => setCreateFilter(e.target.value)}
              />
            </div>
            <div className="backup-selection-actions">
              <Button variant="ghost" size="sm" onClick={() => setAllCreate(true)}>
                {t("settings.backup.selectAll")}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setAllCreate(false)}>
                {t("settings.backup.deselectAll")}
              </Button>
              <span className="backup-selected-badge">
                {t("settings.backup.selectedCount", {
                  count: createChoices.length,
                  total: existingDomains.length,
                })}
              </span>
            </div>
          </div>

          {/* Checkbox Grid */}
          <div className="settings-backup-picker">
            {filteredCreateDomains.map((d) => (
              <label
                key={d.name}
                className="settings-checkbox-label settings-backup-check-row"
              >
                <input
                  type="checkbox"
                  checked={isCreateChecked(d.name)}
                  onChange={(e) => toggleCreate(d.name, e.target.checked)}
                />
                <span
                  className="backup-row-color-dot"
                  style={{ backgroundColor: getDomainColor(d.name) }}
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

          {/* Destination & Custom Note Option */}
          <div className="backup-options-card">
            <div className="backup-options-row">
              <span className="backup-control-label">{t("settings.backup.targetOption")}</span>
              <div className="backup-destination-radios">
                <label className="backup-radio-label">
                  <input
                    type="radio"
                    name="destinationType"
                    value="default"
                    checked={destinationType === "default"}
                    onChange={() => setDestinationType("default")}
                  />
                  <span>
                    {t("settings.backup.targetDefault")}
                    {config?.backupDir && (
                      <span className="backup-destination-path" title={config.backupDir}>
                        ({config.backupDir})
                      </span>
                    )}
                  </span>
                </label>
                <label className="backup-radio-label">
                  <input
                    type="radio"
                    name="destinationType"
                    value="custom"
                    checked={destinationType === "custom"}
                    onChange={() => setDestinationType("custom")}
                  />
                  <span>{t("settings.backup.targetCustom")}</span>
                </label>
              </div>
            </div>

            <div className="backup-options-row">
              <span className="backup-control-label">{t("settings.backup.noteLabel")}</span>
              <input
                type="text"
                className="backup-note-input"
                placeholder={t("settings.backup.notePlaceholder")}
                value={backupNote}
                onChange={(e) => setBackupNote(e.target.value)}
                maxLength={40}
              />
            </div>
          </div>

          {/* Action Footer & Summary */}
          <div className="backup-action-footer">
            <div className="backup-footer-stats">
              <span className="backup-stat-item">
                {t("settings.backup.selectedCount", {
                  count: createChoices.length,
                  total: existingDomains.length,
                })}
              </span>
              <span>·</span>
              <span className="backup-stat-item">
                {t("settings.backup.totalSize", {
                  size: formatBackupBytes(
                    createChoices.reduce((acc, d) => acc + d.sizeBytes, 0),
                  ),
                })}
              </span>
              <span>·</span>
              <span className="backup-stat-item">
                {t("settings.backup.estimatedSize", {
                  size: formatBackupBytes(
                    Math.round(
                      createChoices.reduce((acc, d) => acc + d.sizeBytes, 0) * 0.35,
                    ),
                  ),
                })}
              </span>
            </div>

            <Button
              variant="primary"
              onClick={() => void handleStartCreate()}
              disabled={canCreate}
            >
              <Download size={16} />
              {showCreateModal
                ? t("settings.backup.creating")
                : t("settings.backup.startBackupBtn")}
            </Button>
          </div>

          <p className="settings-backup-note">
            <strong>{t("settings.backup.notIncluded")}:</strong>{" "}
            {t("settings.backup.notIncludedDesc")}
          </p>
        </SettingsSection>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          SUBTAB 3: RESTORE & INSPECT
          ═══════════════════════════════════════════════════════════════ */}
      {subtab === "restore" && (
        <SettingsSection
          id="backup-restore"
          icon={<Upload size={18} />}
          title={t("settings.section.backupRestore")}
          desc={t("settings.backup.restoreDesc")}
        >
          {/* Drag & Drop Zone */}
          <div
            className={`backup-dropzone ${dragOver ? "backup-dropzone--active" : ""}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={pickRestore}
          >
            <div className="backup-dropzone-content">
              <div className="backup-dropzone-icon-wrap">
                <Upload size={28} />
              </div>
              <p className="backup-dropzone-title">{t("settings.backup.dropzoneTitle")}</p>
              <p className="backup-dropzone-hint">{t("settings.backup.dropzoneHint")}</p>
              <Button
                variant="secondary"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  void pickRestore();
                }}
                disabled={restoring || inspecting}
              >
                {inspecting ? t("settings.backup.inspecting") : t("settings.backup.restoreBtn")}
              </Button>
            </div>
          </div>

          {/* Quick Select from recent snapshots */}
          {archives.length > 0 && !archive && (
            <div className="backup-recent-picker-card">
              <span className="backup-control-label">{t("settings.backup.archivesTitle")}</span>
              <div className="backup-recent-chips">
                {archives.slice(0, 4).map((arc) => (
                  <button
                    key={arc.filePath}
                    type="button"
                    className="backup-recent-chip"
                    onClick={() => void inspectPath(arc.filePath)}
                  >
                    <FileArchive size={14} />
                    <span className="backup-chip-name">{arc.fileName}</span>
                    <span className="backup-chip-time">{formatBackupRelative(arc.createdAt)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {readError && <div className="settings-backup-error">{readError}</div>}

          {/* Archive Inspector Gate */}
          {archive && (
            <div className="settings-backup-gate">
              <div className="backup-gate-top">
                <div className="settings-backup-gate-file">
                  <div className="backup-gate-title-row">
                    <span className="settings-backup-gate-name">{fileName(archive.path)}</span>
                    <Badge variant={archive.isRaw ? "accent" : "default"} size="sm">
                      {archive.isRaw ? t("settings.backup.rawFormat") : t("settings.backup.legacyFormat")}
                    </Badge>
                  </div>
                  {archive.createdAt > 0 && (
                    <span className="settings-backup-gate-date">
                      {t("settings.backup.restoreFrom", {
                        date: formatBackupDate(archive.createdAt),
                      })}
                      {archive.appVersion && ` · GameIndex v${archive.appVersion}`}
                    </span>
                  )}
                </div>
                <Button variant="ghost" size="sm" onClick={() => void pickRestore()}>
                  {t("settings.backup.changeFile")}
                </Button>
              </div>

              {/* Side-by-side contents & comparison table */}
              <div className="backup-archive-comparison-card">
                <h4 className="backup-comparison-title">
                  {t("settings.backup.archiveComparison")}
                </h4>
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
                        total: archiveDomains.length,
                      })}
                    </span>
                  </div>

                  {archiveDomains.map((name) => {
                    const count = archive.counts?.[name];
                    const liveDomain = existingDomains.find((d) => d.name === name);
                    const liveCount = liveDomain?.itemCount ?? 0;

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
                        <span
                          className="backup-row-color-dot"
                          style={{ backgroundColor: getDomainColor(name) }}
                        />
                        <span className="settings-backup-row-name">
                          {t(BACKUP_DOMAIN_LABEL_KEYS[name] ?? name)}
                        </span>
                        <span className="settings-backup-row-meta">
                          {count !== undefined && count > 0 && (
                            <span
                              className="settings-backup-row-count"
                              title={t("settings.backup.archiveRecords")}
                            >
                              {t("settings.backup.itemCount", { count })}
                            </span>
                          )}
                          <span
                            className="backup-live-count"
                            title={t("settings.backup.liveRecords")}
                          >
                            Live: {liveCount}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Mode Selection */}
              {archive.isRaw && (
                <div className="settings-backup-mode-box">
                  <span className="settings-backup-mode-title">
                    {t("settings.backup.modeTitle")}
                  </span>
                  <div className="settings-backup-mode-options">
                    <label
                      className={`settings-backup-mode-card ${restoreMode === "merge" ? "active" : ""}`}
                    >
                      <input
                        type="radio"
                        name="restoreMode"
                        value="merge"
                        checked={restoreMode === "merge"}
                        onChange={() => setRestoreMode("merge")}
                      />
                      <div className="settings-backup-mode-card-content">
                        <span className="settings-backup-mode-card-title">
                          {t("settings.backup.modeMergeTitle")}
                        </span>
                        <span className="settings-backup-mode-card-desc">
                          {t("settings.backup.modeMergeDesc")}
                        </span>
                      </div>
                    </label>

                    <label
                      className={`settings-backup-mode-card ${restoreMode === "replace" ? "active" : ""}`}
                    >
                      <input
                        type="radio"
                        name="restoreMode"
                        value="replace"
                        checked={restoreMode === "replace"}
                        onChange={() => setRestoreMode("replace")}
                      />
                      <div className="settings-backup-mode-card-content">
                        <span className="settings-backup-mode-card-title">
                          {t("settings.backup.modeReplaceTitle")}
                        </span>
                        <span className="settings-backup-mode-card-desc">
                          {t("settings.backup.modeReplaceDesc")}
                        </span>
                      </div>
                    </label>
                  </div>
                </div>
              )}

              {/* Safety snapshot toggle */}
              <SettingsToggleCard
                title={t("settings.backup.safetySnapshot")}
                desc={t("settings.backup.safetySnapshotDesc")}
                checked={safetySnapshot}
                onChange={setSafetySnapshot}
              />

              <p className="settings-backup-gate-warning">
                {archive.isRaw && restoreMode === "merge"
                  ? t("settings.backup.restoreConfirmBodyMerge")
                  : t("settings.backup.restoreConfirmBody")}
              </p>

              <div className="settings-backup-gate-actions">
                <Button
                  variant="ghost"
                  onClick={() => setArchive(null)}
                  disabled={restoring}
                >
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
      )}

      {/* ═══════════════════════════════════════════════════════════════
          SUBTAB 4: STORAGE & AUTOMATION
          ═══════════════════════════════════════════════════════════════ */}
      {subtab === "settings" && (
        <SettingsSection
          id="backup-settings"
          icon={<SlidersHorizontal size={18} />}
          title={t("settings.backup.settingsTitle")}
          desc={t("settings.backup.settingsDesc")}
        >
          {/* Default Backup Directory */}
          <div className="backup-folder-card">
            <div className="backup-folder-info">
              <FolderOpen size={20} className="backup-folder-icon" />
              <div className="backup-folder-text">
                <span className="backup-folder-title">{t("settings.backup.folderTitle")}</span>
                <span className="backup-folder-path" title={config?.backupDir}>
                  {config?.backupDir || "—"}
                </span>
                <span className="backup-folder-hint">{t("settings.backup.folderDesc")}</span>
              </div>
            </div>
            <div className="backup-folder-actions">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handleChangeFolder()}
                disabled={savingConfig}
              >
                {t("settings.backup.changeFolder")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleOpenFolder()}
                disabled={!config?.backupDir}
              >
                <FolderOpen size={14} />
                {t("settings.backup.openFolder")}
              </Button>
            </div>
          </div>

          {/* Automation Toggles */}
          <div className="backup-toggles-grid">
            <SettingsToggleCard
              title={t("settings.backup.autoExitTitle")}
              desc={t("settings.backup.autoExitDesc")}
              checked={config?.autoBackupOnExit ?? false}
              onChange={(checked) => void updateConfig({ autoBackupOnExit: checked })}
            />

            <SettingsToggleCard
              title={t("settings.backup.safetyTitle")}
              desc={t("settings.backup.safetyDesc")}
              checked={config?.safetyBackupBeforeRestore ?? true}
              onChange={(checked) => void updateConfig({ safetyBackupBeforeRestore: checked })}
            />
          </div>

          {/* Retention Policy */}
          <div className="backup-retention-card">
            <div className="backup-retention-header">
              <div className="backup-retention-text">
                <span className="backup-retention-title">
                  {t("settings.backup.retentionTitle")}
                </span>
                <span className="backup-retention-desc">
                  {t("settings.backup.retentionDesc")}
                </span>
              </div>
              <div className="backup-retention-input-wrap">
                <input
                  type="number"
                  min={0}
                  max={100}
                  className="backup-number-input"
                  value={config?.retentionCount ?? 5}
                  onChange={(e) => {
                    const val = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                    void updateConfig({ retentionCount: val });
                  }}
                  aria-label={t("settings.backup.retentionTitle")}
                />
                <span className="backup-input-unit">
                  {t("settings.backup.retentionUnit")}
                </span>
              </div>
            </div>
          </div>
        </SettingsSection>
      )}

      {/* Restart modal on successful restore */}
      <ConfirmModal
        open={restartOpen}
        title={t("settings.backup.restartTitle")}
        message={t("settings.backup.restartBody")}
        confirmLabel={t("settings.backup.restartBtn")}
        cancelLabel={t("common.cancel")}
        onConfirm={handleRestart}
        onCancel={() => setRestartOpen(false)}
      />

      {/* Archive deletion confirmation modal */}
      <ConfirmModal
        open={archiveToDelete !== null}
        busy={deleteBusy}
        title={t("settings.backup.deleteArchiveTitle")}
        message={t("settings.backup.deleteArchiveConfirm", {
          name: archiveToDelete?.fileName ?? "",
        })}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => void handleDeleteArchive()}
        onCancel={() => setArchiveToDelete(null)}
      />

      {/* Create Progress Modal */}
      {showCreateModal && (
        <BackupProgressModal
          open={showCreateModal}
          targetPath={createTargetPath}
          domains={createDomains}
          onComplete={() => {
            showToast(t("settings.backup.createdToast"), "success");
            void refreshAll();
          }}
          onClose={() => {
            setShowCreateModal(false);
            void refreshAll();
          }}
        />
      )}
    </div>
  );
}
