import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  Check,
  Clock,
  Cloud,
  Database,
  Download,
  FileArchive,
  Filter,
  FolderOpen,
  GitCompare,
  HardDrive,
  Layers,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Tag,
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
import BackupVerifyModal from "./BackupVerifyModal";
import BackupDiffModal from "./BackupDiffModal";
import BackupHealthModal from "./BackupHealthModal";
import {
  calculateBackupHealth,
  formatBackupBytes,
  formatBackupDate,
  formatBackupRelative,
  getDomainColor,
} from "./backupUtils";
import type {
  BackupArchiveSummary,
  BackupConfig,
  BackupDiffReport,
  BackupInspect,
  BackupOutcome,
  BackupPreset,
  BackupStatus,
  BackupSubtab,
  BackupVerifyReport,
  CloudPathOption,
} from "../../types/backup";
// The backup markup (subtabs, hero, meter, modals, …) is styled here. It is a
// page-scoped sheet, and BackupTab is reused outside Settings (embedded in the
// Saves page), so the import has to travel with the component rather than only
// living on SettingsPage — otherwise the whole suite renders unstyled there.
import "../../styles/settings-tabs-b.css";

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
  const [cloudPaths, setCloudPaths] = useState<CloudPathOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [quickBusy, setQuickBusy] = useState(false);

  // ─── Modal States ─────────────────────────────────────────────────────
  const [verifyReport, setVerifyReport] = useState<BackupVerifyReport | null>(null);
  const [verifyingPath, setVerifyingPath] = useState<string | null>(null);
  const [diffReport, setDiffReport] = useState<BackupDiffReport | null>(null);
  const [diffingPath, setDiffingPath] = useState<string | null>(null);
  const [showHealthModal, setShowHealthModal] = useState(false);

  // ─── Archive List Filter & Sort ───────────────────────────────────────
  const [archiveSearch, setArchiveSearch] = useState("");
  const [archiveFormatFilter, setArchiveFormatFilter] = useState<"all" | "raw" | "legacy">("all");
  const [archiveSort, setArchiveSort] = useState<"newest" | "oldest" | "size">("newest");

  // ─── Create subtab state ──────────────────────────────────────────────
  const [preset, setPreset] = useState<BackupPreset>("full");
  const [selectedCreate, setSelectedCreate] = useState<Record<string, boolean>>({});
  const [createFilter, setCreateFilter] = useState("");
  const [destinationType, setDestinationType] = useState<"default" | "custom" | string>("default");
  const [backupNote, setBackupNote] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createTargetPath, setCreateTargetPath] = useState("");
  const [createDomains, setCreateDomains] = useState<string[]>([]);

  // ─── Restore subtab state ─────────────────────────────────────────────
  const [archive, setArchive] = useState<(BackupInspect & { path: string }) | null>(null);
  const [selectedRestore, setSelectedRestore] = useState<Record<string, boolean>>({});
  const [restoreMode, setRestoreMode] = useState<"merge" | "replace">("merge");
  const [safetySnapshot, setSafetySnapshot] = useState(true);
  const [restoring, setRestoring] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [restartOpen, setRestartOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // ─── Archive management & deletion ───────────────────────────────────
  const [archiveToDelete, setArchiveToDelete] = useState<BackupArchiveSummary | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [exportingPath, setExportingPath] = useState<string | null>(null);

  // ─── Settings subtab state ────────────────────────────────────────────
  const [savingConfig, setSavingConfig] = useState(false);

  // Synchronize section parameter with active subtab without wiping other parameters
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
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("section", sectionId);
        return next;
      },
      { replace: true }
    );
  };

  const isDomainVisible = useCallback(
    (name: string) => showFullLinuxUi || name !== "compatibility",
    [showFullLinuxUi],
  );

  const refreshAll = useCallback(async () => {
    try {
      const [newStatus, newConfig, newArchives, detectedCloud] = await Promise.all([
        invoke<BackupStatus>("backup_get_status"),
        invoke<BackupConfig>("backup_get_config").catch(() => null),
        invoke<BackupArchiveSummary[]>("backup_list_archives").catch(() => []),
        invoke<CloudPathOption[]>("backup_detect_cloud_paths").catch(() => []),
      ]);
      setStatus(newStatus);
      if (newConfig) {
        setConfig(newConfig);
        setSafetySnapshot(newConfig.safetyBackupBeforeRestore);
      }
      setArchives(newArchives);
      setCloudPaths(detectedCloud);
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

  // Overall protection health calculation
  const backupHealth = useMemo(() => {
    return calculateBackupHealth(status, archives, config);
  }, [status, archives, config]);

  // ─── Filtered and Sorted Archives ─────────────────────────────────────
  const filteredArchives = useMemo(() => {
    const q = archiveSearch.trim().toLowerCase();
    return archives
      .filter((arc) => {
        if (archiveFormatFilter === "raw" && !arc.isRaw) return false;
        if (archiveFormatFilter === "legacy" && arc.isRaw) return false;
        if (q) {
          const matchName = arc.fileName.toLowerCase().includes(q);
          const matchPath = arc.filePath.toLowerCase().includes(q);
          const matchVersion = arc.appVersion.toLowerCase().includes(q);
          if (!matchName && !matchPath && !matchVersion) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (archiveSort === "newest") return b.createdAt - a.createdAt;
        if (archiveSort === "oldest") return a.createdAt - b.createdAt;
        if (archiveSort === "size") return b.sizeBytes - a.sizeBytes;
        return 0;
      });
  }, [archives, archiveSearch, archiveFormatFilter, archiveSort]);

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
    if (createChoices.length === 0) return;
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2);
    const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const suffix = backupNote.trim()
      ? `-${backupNote.trim().replace(/[^a-zA-Z0-9_-]/g, "-")}`
      : "";
    const defaultName = `gameindex-backup-${ts}${suffix}.gibak`;

    let target = "";
    if (destinationType === "default") {
      const dir = config?.backupDir || "";
      target = `${dir}/${defaultName}`.replace(/\\/g, "/");
    } else if (destinationType === "custom") {
      try {
        const picked = await save({
          defaultPath: defaultName,
          filters: [{ name: t("settings.backup.archiveFilterName"), extensions: ["gibak", "zip"] }],
        });
        if (!picked || typeof picked !== "string") return;
        target = picked;
      } catch (err) {
        showToast(String(err), "error");
        return;
      }
    } else {
      // Cloud preset path
      target = `${destinationType}/${defaultName}`.replace(/\\/g, "/");
    }

    setCreateTargetPath(target);
    setCreateDomains(createChoices.map((d) => d.name));
    setShowCreateModal(true);
  };

  // ─── Archive Verification ─────────────────────────────────────────────
  const handleVerifyArchive = async (filePath: string) => {
    setVerifyingPath(filePath);
    try {
      const report = await invoke<BackupVerifyReport>("backup_verify_archive", { filePath });
      setVerifyReport(report);
    } catch (err) {
      showToast(t("settings.backup.verifyFailed", { error: String(err) }), "error");
    } finally {
      setVerifyingPath(null);
    }
  };

  // ─── Archive Diff ─────────────────────────────────────────────────────
  const handleDiffArchive = async (filePath: string) => {
    setDiffingPath(filePath);
    try {
      const diff = await invoke<BackupDiffReport>("backup_diff_archive", { filePath });
      setDiffReport(diff);
    } catch (err) {
      showToast(t("settings.backup.diffFailed", { error: String(err) }), "error");
    } finally {
      setDiffingPath(null);
    }
  };

  // ─── Archive Export ───────────────────────────────────────────────────
  const handleExportArchive = async (filePath: string) => {
    setExportingPath(filePath);
    try {
      const picked = await open({
        directory: true,
        multiple: false,
        title: t("settings.backup.exportSelectFolder"),
      });
      if (picked && typeof picked === "string") {
        const dest = await invoke<string>("backup_export_archive", {
          sourcePath: filePath,
          targetDir: picked,
        });
        showToast(
          t("settings.backup.exportSuccess", { path: dest }),
          "success"
        );
      }
    } catch (err) {
      showToast(t("settings.backup.exportFailed", { error: String(err) }), "error");
    } finally {
      setExportingPath(null);
    }
  };

  // ─── Inspect archive for restore ──────────────────────────────────────
  const inspectPath = async (filePath: string) => {
    
    setReadError(null);
    try {
      const res = await invoke<BackupInspect>("backup_inspect", { sourcePath: filePath });
      setArchive({ ...res, path: filePath });
      const initial: Record<string, boolean> = {};
      for (const d of res.domains) initial[d] = true;
      setSelectedRestore(initial);
      handleSelectSubtab("restore");
    } catch (err) {
      setReadError(String(err));
      showToast(t("settings.backup.inspectFailed", { error: String(err) }), "error");
    } finally {
      
    }
  };

  const handlePickFile = async () => {
    try {
      const picked = await open({
        directory: false,
        multiple: false,
        filters: [{ name: t("settings.backup.archiveFilterName"), extensions: ["gibak", "zip"] }],
        title: t("settings.backup.selectArchiveTitle"),
      });
      if (picked && typeof picked === "string") {
        await inspectPath(picked);
      }
    } catch (err) {
      showToast(String(err), "error");
    }
  };

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const files = Array.from(e.dataTransfer?.files ?? []);
    const f = files[0];
    if (f) {
      const p = (f as unknown as { path?: string }).path;
      if (p) await inspectPath(p);
      else showToast(t("settings.backup.dragDropWebError"), "warning");
    }
  };

  const isRestoreChecked = (name: string) => selectedRestore[name] !== false;

  const toggleRestore = (name: string, checked: boolean) => {
    setSelectedRestore((prev) => ({ ...prev, [name]: checked }));
  };

  const setAllRestore = (checked: boolean) => {
    if (!archive) return;
    setSelectedRestore(Object.fromEntries(archive.domains.map((d) => [d, checked])));
  };

  const restoreChoices = useMemo(() => {
    if (!archive) return [];
    return archive.domains.filter((d) => isRestoreChecked(d));
  }, [archive, selectedRestore]);

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

  const canCreate =
    existingDomains.length === 0 ||
    createChoices.length === 0 ||
    showCreateModal ||
    loading ||
    quickBusy;

  return (
    <div className="backup-suite">
      {/* ─── Top Subtabs Strip ───────────────────────────────────────── */}
      <nav className="backup-subtabs-bar" aria-label={t("settings.backup.viewsLabel")}>
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
          SUBTAB 1: OVERVIEW & ARCHIVES ("MAIN BACKUP PAGE")
          ═══════════════════════════════════════════════════════════════ */}
      {subtab === "overview" && (
        <SettingsSection
          id="backup-overview"
          icon={<Database size={18} />}
          title={t("settings.section.backupOverview")}
          desc={t("settings.backup.overviewDesc")}
        >
          {/* Hero Protection Card */}
          <div className="backup-hero-protection-card">
            <div className="backup-hero-protection-top">
              <div className="backup-hero-badge-wrap">
                <span
                  className={`backup-hero-grade-badge backup-hero-grade-badge--${backupHealth.intent}`}
                >
                  <ShieldCheck size={18} />
                  <span>{backupHealth.grade}</span>
                </span>
                <div className="backup-hero-text">
                  <h3 className="backup-hero-title">
                    {t(backupHealth.labelKey)}
                  </h3>
                  <p className="backup-hero-desc">
                    {status?.lastBackupAt
                      ? t("settings.backup.lastProtectedTime", {
                          time: formatBackupRelative(status.lastBackupAt, t),
                        })
                      : t("settings.backup.neverBackedUpDesc")}
                  </p>
                </div>
              </div>

              {/* Quick Actions Cluster */}
              <div className="backup-hero-actions">
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
                  onClick={() => setShowHealthModal(true)}
                >
                  <Sparkles size={14} />
                  {t("settings.backup.runDiagnostics", { grade: backupHealth.grade })}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleOpenFolder()}
                  disabled={!config?.backupDir}
                  title={t("settings.backup.openFolder")}
                >
                  <FolderOpen size={14} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void refreshAll()}
                  disabled={loading}
                  title={t("common.refresh")}
                >
                  <RefreshCw size={14} />
                </Button>
              </div>
            </div>

            {/* Inline tag input for quick backup */}
            <div className="backup-quick-note-strip">
              <Tag size={13} className="backup-quick-note-icon" />
              <input
                type="text"
                className="backup-quick-note-input"
                placeholder={t("settings.backup.quickNotePlaceholder")}
                value={backupNote}
                onChange={(e) => setBackupNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !quickBusy && domainsWithData.length > 0) {
                    void handleQuickBackup();
                  }
                }}
              />
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
              value={`${backupHealth.grade} (${backupHealth.score}%)`}
              subtext={t(backupHealth.labelKey)}
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
                      title={`${t(BACKUP_DOMAIN_LABEL_KEYS[d.name] ?? d.name)}: ${formatBackupBytes(
                        d.sizeBytes
                      )} (${((d.sizeBytes / totalBytes) * 100).toFixed(1)}%)`}
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
                <span className="backup-card-count">{filteredArchives.length}</span>
              </div>
              <span className="backup-section-subtitle">
                {t("settings.backup.archivesDesc")}
              </span>
            </div>

            {/* Archive Toolbar: Search, Format Filter, Sort */}
            <div className="backup-archives-toolbar">
              <div className="backup-search-wrap" style={{ flex: 1, minWidth: 200, maxWidth: 360 }}>
                <Search size={14} className="backup-search-icon" />
                <input
                  type="search"
                  className="backup-search-input"
                  placeholder={t("settings.backup.searchArchives")}
                  value={archiveSearch}
                  onChange={(e) => setArchiveSearch(e.target.value)}
                />
              </div>

              <div className="backup-filter-pills">
                <button
                  type="button"
                  className={`backup-filter-pill ${archiveFormatFilter === "all" ? "active" : ""}`}
                  onClick={() => setArchiveFormatFilter("all")}
                >
                  {t("common.all")}
                </button>
                <button
                  type="button"
                  className={`backup-filter-pill ${archiveFormatFilter === "raw" ? "active" : ""}`}
                  onClick={() => setArchiveFormatFilter("raw")}
                >
                  Raw (v2)
                </button>
                <button
                  type="button"
                  className={`backup-filter-pill ${archiveFormatFilter === "legacy" ? "active" : ""}`}
                  onClick={() => setArchiveFormatFilter("legacy")}
                >
                  Binary (v1)
                </button>
              </div>

              <div className="backup-sort-select-wrap">
                <Filter size={13} className="backup-sort-icon" />
                <select
                  className="backup-sort-select"
                  value={archiveSort}
                  onChange={(e) => setArchiveSort(e.target.value as "newest" | "oldest" | "size")}
                  aria-label={t("settings.backup.sortArchives")}
                >
                  <option value="newest">{t("settings.backup.sortNewest")}</option>
                  <option value="oldest">{t("settings.backup.sortOldest")}</option>
                  <option value="size">{t("settings.backup.sortSize")}</option>
                </select>
              </div>
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
            ) : filteredArchives.length === 0 ? (
              <div className="backup-empty-card">
                <p className="backup-empty-title">
                  {t("settings.backup.noMatchingArchives")}
                </p>
                <Button variant="ghost" size="sm" onClick={() => setArchiveSearch("")}>
                  {t("common.clear")}
                </Button>
              </div>
            ) : (
              <div className="backup-archives-list">
                {filteredArchives.map((arc) => (
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
                          {arc.isRaw
                            ? t("settings.backup.rawFormat")
                            : t("settings.backup.legacyFormat")}
                        </Badge>
                      </div>
                      <div className="backup-archive-meta">
                        <span
                          className="backup-archive-time"
                          title={formatBackupDate(arc.createdAt)}
                        >
                          <Clock size={12} />
                          {formatBackupRelative(arc.createdAt, t)}
                        </span>
                        <span>·</span>
                        <span>{formatBackupBytes(arc.sizeBytes)}</span>
                        <span>·</span>
                        <span>{t("settings.backup.domainCount", { count: arc.domainCount })}</span>
                        <span>·</span>
                        <span>
                          {t("settings.backup.recordsCount", {
                            count: arc.totalRecords.toLocaleString(),
                          })}
                        </span>
                        {arc.appVersion && (
                          <>
                            <span>·</span>
                            <span>{t("settings.backup.version", { version: arc.appVersion })}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="backup-archive-actions">
                      {/* Verify Integrity Action */}
                      <button
                        type="button"
                        className="backup-action-icon-btn"
                        onClick={() => void handleVerifyArchive(arc.filePath)}
                        title={t("settings.backup.verifyBtn")}
                        aria-label={t("settings.backup.verifyBtn")}
                        disabled={verifyingPath === arc.filePath}
                      >
                        <ShieldCheck size={16} />
                      </button>

                      {/* Compare / Diff Action */}
                      <button
                        type="button"
                        className="backup-action-icon-btn"
                        onClick={() => void handleDiffArchive(arc.filePath)}
                        title={t("settings.backup.diffBtn")}
                        aria-label={t("settings.backup.diffBtn")}
                        disabled={diffingPath === arc.filePath}
                      >
                        <GitCompare size={16} />
                      </button>

                      {/* Export Action */}
                      <button
                        type="button"
                        className="backup-action-icon-btn"
                        onClick={() => void handleExportArchive(arc.filePath)}
                        title={t("settings.backup.exportBtn")}
                        aria-label={t("settings.backup.exportBtn")}
                        disabled={exportingPath === arc.filePath}
                      >
                        <Download size={16} />
                      </button>

                      {/* Quick Restore Action */}
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
                        onClick={() =>
                          void handleOpenFolder(arc.filePath.replace(/[\\/][^\\/]*$/, ""))
                        }
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
            <div className="backup-registry-header">
              <h3 className="backup-card-title">{t("settings.backup.databaseHealth")}</h3>
              <span className="backup-card-count">{existingDomains.length}</span>
            </div>
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

          {/* Destination & Cloud Presets */}
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

                {/* Cloud sync provider shortcuts */}
                {cloudPaths.map((cp) => (
                  <label key={cp.provider} className="backup-radio-label">
                    <input
                      type="radio"
                      name="destinationType"
                      value={cp.path}
                      checked={destinationType === cp.path}
                      onChange={() => setDestinationType(cp.path)}
                    />
                    <span>
                      <Cloud size={13} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />
                      {cp.provider} ({cp.path})
                    </span>
                  </label>
                ))}

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

            {/* Custom Tag / Note */}
            <div className="backup-options-row">
              <span className="backup-control-label">{t("settings.backup.noteLabel")}</span>
              <input
                type="text"
                className="backup-text-input"
                placeholder={t("settings.backup.notePlaceholder")}
                value={backupNote}
                onChange={(e) => setBackupNote(e.target.value)}
              />
            </div>
          </div>

          {/* Action Trigger Card */}
          <div className="backup-create-action-card">
            <div className="backup-create-summary">
              <span className="backup-create-summary-main">
                {t("settings.backup.readyToSnapshot", { count: createChoices.length })}
              </span>
              <span className="backup-create-summary-sub">
                {t("settings.backup.totalRecordsLabel", {
                  records: createChoices
                    .reduce((acc, d) => acc + (d.itemCount ?? 0), 0)
                    .toLocaleString(),
                })}
              </span>
            </div>
            <Button
              variant="primary"
              size="lg"
              onClick={() => void handleStartCreate()}
              disabled={canCreate}
            >
              <Download size={16} />
              {t("settings.backup.startCreateBtn")}
            </Button>
          </div>
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
          {/* File Picker & Drag-and-Drop Dropzone */}
          <div
            className={`backup-dropzone ${dragOver ? "dragover" : ""} ${archive ? "has-file" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => void handleDrop(e)}
            onClick={() => {
              if (!archive) void handlePickFile();
            }}
            role="button"
            tabIndex={0}
            aria-label={t("settings.backup.dropzoneLabel")}
          >
            <div className="backup-dropzone-content">
              <Upload size={36} className="backup-dropzone-icon" />
              {archive ? (
                <div className="backup-dropzone-loaded">
                  <span className="backup-dropzone-filename">{fileName(archive.path)}</span>
                  <span className="backup-dropzone-path" title={archive.path}>
                    {archive.path}
                  </span>
                  <div className="backup-dropzone-actions" onClick={(e) => e.stopPropagation()}>
                    <Button variant="secondary" size="sm" onClick={() => void handlePickFile()}>
                      {t("settings.backup.chooseDifferentArchive")}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setArchive(null)}>
                      {t("common.clear")}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="backup-dropzone-prompt">
                  <span className="backup-dropzone-title">
                    {t("settings.backup.dropzoneTitle")}
                  </span>
                  <span className="backup-dropzone-sub">{t("settings.backup.dropzoneSub")}</span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handlePickFile();
                    }}
                  >
                    <FolderOpen size={14} />
                    {t("settings.backup.browseBtn")}
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Quick-pick Discovered Archives Bar */}
          {!archive && archives.length > 0 && (
            <div className="backup-quick-pick-section">
              <span className="backup-quick-pick-title">
                {t("settings.backup.quickPickTitle")}
              </span>
              <div className="backup-quick-pick-grid">
                {archives.slice(0, 4).map((arc) => (
                  <button
                    key={arc.filePath}
                    type="button"
                    className="backup-quick-pick-card"
                    onClick={() => void inspectPath(arc.filePath)}
                  >
                    <FileArchive size={16} className="backup-quick-pick-icon" />
                    <div className="backup-quick-pick-info">
                      <span className="backup-quick-pick-name">{arc.fileName}</span>
                      <span className="backup-quick-pick-meta">
                        {formatBackupRelative(arc.createdAt, t)} · {formatBackupBytes(arc.sizeBytes)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {readError && (
            <div className="backup-error-banner">
              <AlertTriangle size={18} />
              <span>{readError}</span>
            </div>
          )}

          {/* Inspected Archive Contents */}
          {archive && (
            <div className="backup-inspect-container">
              {/* Metadata Card */}
              <div className="backup-archive-meta-card">
                <div className="backup-archive-meta-grid">
                  <div className="backup-meta-cell">
                    <span className="backup-meta-label">
                      {t("settings.backup.archiveCreated")}
                    </span>
                    <span className="backup-meta-value">
                      {formatBackupDate(archive.createdAt)}
                    </span>
                  </div>
                  <div className="backup-meta-cell">
                    <span className="backup-meta-label">
                      {t("settings.backup.archiveVersion")}
                    </span>
                    <span className="backup-meta-value">{archive.appVersion || "—"}</span>
                  </div>
                  <div className="backup-meta-cell">
                    <span className="backup-meta-label">{t("settings.backup.archiveFormat")}</span>
                    <span className="backup-meta-value">
                      <Badge variant={archive.isRaw ? "accent" : "default"} size="sm">
                        {archive.isRaw
                          ? t("settings.backup.rawFormat")
                          : t("settings.backup.legacyFormat")}
                      </Badge>
                    </span>
                  </div>
                  <div className="backup-meta-cell">
                    <span className="backup-meta-label">
                      {t("settings.backup.archiveDomains")}
                    </span>
                    <span className="backup-meta-value">{archive.domains.length}</span>
                  </div>
                </div>

                <div className="backup-meta-actions-bar">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleVerifyArchive(archive.path)}
                  >
                    <ShieldCheck size={14} />
                    {t("settings.backup.verifyBtn")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleDiffArchive(archive.path)}
                  >
                    <GitCompare size={14} />
                    {t("settings.backup.diffBtn")}
                  </Button>
                </div>
              </div>

              {/* Restore Domain Selector */}
              <div className="backup-selection-header-bar">
                <span className="backup-control-label">
                  {t("settings.backup.selectDomainsToRestore")}
                </span>
                <div className="backup-selection-actions">
                  <Button variant="ghost" size="sm" onClick={() => setAllRestore(true)}>
                    {t("settings.backup.selectAll")}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setAllRestore(false)}>
                    {t("settings.backup.deselectAll")}
                  </Button>
                  <span className="backup-selected-badge">
                    {t("settings.backup.selectedCount", {
                      count: restoreChoices.length,
                      total: archive.domains.length,
                    })}
                  </span>
                </div>
              </div>

              <div className="settings-backup-picker">
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
                      <span
                        className="backup-row-color-dot"
                        style={{ backgroundColor: getDomainColor(name) }}
                      />
                      <span className="settings-backup-row-name">
                        {t(BACKUP_DOMAIN_LABEL_KEYS[name] ?? name)}
                      </span>
                      {count !== undefined && count > 0 && (
                        <span className="settings-backup-row-meta">
                          {t("settings.backup.itemCount", { count })}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>

              {/* Restore Configuration (Mode & Safety) */}
              <div className="backup-options-card">
                <div className="backup-options-row">
                  <span className="backup-control-label">
                    {t("settings.backup.restoreModeLabel")}
                  </span>
                  <div className="backup-destination-radios">
                    <label className="backup-radio-label">
                      <input
                        type="radio"
                        name="restoreMode"
                        value="merge"
                        checked={restoreMode === "merge"}
                        onChange={() => setRestoreMode("merge")}
                      />
                      <span>
                        <strong>{t("settings.backup.restoreModeMerge")}</strong>
                        <span className="backup-radio-desc">
                          {t("settings.backup.restoreModeMergeDesc")}
                        </span>
                      </span>
                    </label>

                    <label className="backup-radio-label">
                      <input
                        type="radio"
                        name="restoreMode"
                        value="replace"
                        checked={restoreMode === "replace"}
                        onChange={() => setRestoreMode("replace")}
                      />
                      <span>
                        <strong>{t("settings.backup.restoreModeReplace")}</strong>
                        <span className="backup-radio-desc">
                          {t("settings.backup.restoreModeReplaceDesc")}
                        </span>
                      </span>
                    </label>
                  </div>
                </div>

                <div className="backup-options-row">
                  <label className="settings-checkbox-label">
                    <input
                      type="checkbox"
                      checked={safetySnapshot}
                      onChange={(e) => setSafetySnapshot(e.target.checked)}
                    />
                    <span>
                      <strong>{t("settings.backup.safetySnapshotLabel")}</strong>
                      <span className="backup-radio-desc">
                        {t("settings.backup.safetySnapshotDesc")}
                      </span>
                    </span>
                  </label>
                </div>
              </div>

              {/* Restore Trigger Bar */}
              <div className="backup-restore-action-bar">
                <div className="backup-restore-summary-text">
                  <AlertTriangle size={16} className="backup-warning-icon" />
                  <span>
                    {restoreMode === "replace"
                      ? t("settings.backup.replaceWarningText")
                      : t("settings.backup.mergeWarningText")}
                  </span>
                </div>
                <Button
                  variant="primary"
                  size="lg"
                  onClick={() => void doRestore()}
                  disabled={restoreChoices.length === 0 || restoring}
                  isLoading={restoring}
                >
                  <Upload size={16} />
                  {t("settings.backup.confirmRestoreBtn", { count: restoreChoices.length })}
                </Button>
              </div>
            </div>
          )}
        </SettingsSection>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          SUBTAB 4: STORAGE & AUTOMATION
          ═══════════════════════════════════════════════════════════════ */}
      {subtab === "settings" && config && (
        <SettingsSection
          id="backup-settings"
          icon={<SlidersHorizontal size={18} />}
          title={t("settings.section.backupSettings")}
          desc={t("settings.backup.settingsDesc")}
        >
          {/* Automation Toggles */}
          <div className="interface-defaults-grid">
            <SettingsToggleCard
              title={t("settings.backup.autoOnExitTitle")}
              desc={t("settings.backup.autoOnExitDesc")}
              checked={config.autoBackupOnExit}
              onChange={(checked) => void updateConfig({ autoBackupOnExit: checked })}
            />
            <SettingsToggleCard
              title={t("settings.backup.safetyBackupTitle")}
              desc={t("settings.backup.safetyBackupDesc")}
              checked={config.safetyBackupBeforeRestore}
              onChange={(checked) => void updateConfig({ safetyBackupBeforeRestore: checked })}
            />
          </div>

          {/* Storage Directory Card */}
          <div className="backup-storage-config-card">
            <div className="backup-storage-header">
              <span className="backup-control-label">{t("settings.backup.directoryLabel")}</span>
              <span className="backup-storage-current-path" title={config.backupDir}>
                {config.backupDir}
              </span>
            </div>

            <div className="backup-storage-actions-row">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handleChangeFolder()}
                isLoading={savingConfig}
              >
                <FolderOpen size={14} />
                {t("settings.backup.changeFolderBtn")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleOpenFolder()}
                disabled={!config.backupDir}
              >
                {t("settings.backup.openFolder")}
              </Button>
            </div>

            {/* Cloud Storage Quick Switch */}
            {cloudPaths.length > 0 && (
              <div className="backup-cloud-shortcuts-wrap">
                <span className="backup-cloud-shortcuts-label">
                  {t("settings.backup.detectedCloudProviders")}
                </span>
                <div className="backup-cloud-chips">
                  {cloudPaths.map((cp) => (
                    <button
                      key={cp.provider}
                      type="button"
                      className={`backup-cloud-chip ${
                        config.backupDir === cp.path ? "active" : ""
                      }`}
                      onClick={() => void updateConfig({ backupDir: cp.path })}
                      title={cp.path}
                    >
                      <Cloud size={13} />
                      <span>{cp.provider}</span>
                      {config.backupDir === cp.path && <Check size={12} />}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Retention & Quota Rules */}
          <div className="backup-retention-card">
            <div className="backup-retention-row">
              <div className="backup-retention-text">
                <span className="backup-control-label">{t("settings.backup.retentionLabel")}</span>
                <span className="backup-retention-hint">{t("settings.backup.retentionHint")}</span>
              </div>
              <div className="backup-retention-input-wrap">
                <input
                  type="number"
                  min={1}
                  max={100}
                  className="backup-number-input"
                  value={config.retentionCount}
                  onChange={(e) => {
                    const val = Math.max(1, Math.min(100, Number(e.target.value) || 1));
                    void updateConfig({ retentionCount: val });
                  }}
                />
                <span className="backup-number-unit">
                  {t("settings.backup.retentionUnit")}
                </span>
              </div>
            </div>
          </div>
        </SettingsSection>
      )}

      {/* ─── Create Backup Progress Modal ────────────────────────────── */}
      {showCreateModal && (
        <BackupProgressModal
          open={showCreateModal}
          targetPath={createTargetPath}
          domains={createDomains}
          onComplete={() => {
            setShowCreateModal(false);
            void refreshAll();
          }}
          onClose={() => {
            setShowCreateModal(false);
            void refreshAll();
          }}
        />
      )}

      {/* ─── Archive Verification Modal ──────────────────────────────── */}
      {verifyReport && (
        <BackupVerifyModal
          report={verifyReport}
          onClose={() => setVerifyReport(null)}
        />
      )}

      {/* ─── Archive Diff Modal ──────────────────────────────────────── */}
      {diffReport && (
        <BackupDiffModal
          diff={diffReport}
          onClose={() => setDiffReport(null)}
          onRestore={() => {
            const p = diffReport.filePath;
            setDiffReport(null);
            void inspectPath(p);
          }}
        />
      )}

      {/* ─── Backup Health Diagnostics Modal ─────────────────────────── */}
      {showHealthModal && (
        <BackupHealthModal
          health={backupHealth}
          onClose={() => setShowHealthModal(false)}
          onQuickBackup={() => {
            void handleQuickBackup();
          }}
          quickBusy={quickBusy}
        />
      )}

      {/* ─── Delete Archive Confirmation Modal ───────────────────────── */}
      <ConfirmModal
        open={archiveToDelete !== null}
        title={t("settings.backup.deleteConfirmTitle")}
        message={t("settings.backup.deleteConfirmDesc", {
          name: archiveToDelete?.fileName ?? "",
        })}
        confirmLabel={t("settings.backup.deleteBtn")}
        busy={deleteBusy}
        onConfirm={() => void handleDeleteArchive()}
        onCancel={() => setArchiveToDelete(null)}
      />

      {/* ─── Relaunch Prompt after Restore ───────────────────────────── */}
      <ConfirmModal
        open={restartOpen}
        title={t("settings.backup.restartTitle")}
        message={t("settings.backup.restartDesc")}
        confirmLabel={t("settings.backup.restartBtn")}
        onConfirm={() => void handleRestart()}
        onCancel={() => setRestartOpen(false)}
      />
    </div>
  );
}
