import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  Download,
  Trash2,
  FolderOpen,
  RefreshCw,
  Check,
  ExternalLink,
  HardDrive,
  Layers,
  Search,
  Sliders,
  CheckCircle2,
  Loader2,
  FileArchive,
  X,
} from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import SettingsSection from "./SettingsSection";
import SettingsToggleCard from "./SettingsToggleCard";
import { Card, Button, Badge, ConfirmModal } from "../../components/ui";
import { CompatibilityIcon } from "./settingsIcons";
import "./CompatibilityTab.css";

interface CompatibilityRunner {
  id: string;
  name: string;
  path: string;
  kind: string;
  version: string | null;
  isProton: boolean;
  sizeBytes?: number | null;
  isDeletable?: boolean;
  installDir?: string | null;
}

interface RemoteRunnerRelease {
  id?: string;
  source: string;
  tag: string;
  name: string;
  publishedAt?: string;
  releaseDate?: string;
  downloadUrl: string;
  filename: string;
  sizeBytes: number | null;
  targetType?: "proton" | "wine" | string;
  isInstalled: boolean;
  body: string | null;
  htmlUrl?: string;
}

interface RunnerInstallProgress {
  runnerName: string;
  phase?: "downloading" | "extracting" | "completed" | "error" | "failed" | "cancelled" | string;
  status?: string;
  percent: number;
  downloadedBytes: number;
  totalBytes: number | null;
  speedBytesPerSec: number;
  errorMessage?: string | null;
  error?: string | null;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}


interface LinuxSystemStatus {
  osName: string;
  kernelVersion: string;
  displayServer: string;
  vulkanSupport: boolean;
  gamemodeAvailable: boolean;
  mangohudAvailable: boolean;
  gamescopeAvailable: boolean;
  winetricksAvailable: boolean;
  umuAvailable: boolean;
}

export interface CompatibilitySettings {
  defaultRunnerPath: string | null;
  defaultPrefixBaseDir: string | null;
  enableDxvk: boolean;
  enableVkd3d: boolean;
  enableEsync: boolean;
  enableFsync: boolean;
  enableDxvkNvapi: boolean;
  enableMangoHud: boolean;
  enableGameMode: boolean;
  enableGamescope: boolean;
  gamescopeArgs: string | null;
  primeRenderOffload: boolean;
  customEnvironmentVariables: Record<string, string>;
  customDllOverrides: Record<string, string>;
  winetricksPath: string | null;

  // New features
  enableNtsync: boolean;
  enableDxvkAsync: boolean;
  enableWayland: boolean;
  enableWow64: boolean;
  enableLargeAddressAware: boolean;
  wineDebug: string | null;
  audioDriver: string | null;
  virtualDesktop: boolean;
  virtualDesktopRes: string | null;
  enableUmuLauncher: boolean;
  mangohudHidden: boolean;

  // Gamescope full options
  gamescopeMode: string | null;
  gamescopeGameWidth: number | null;
  gamescopeGameHeight: number | null;
  gamescopeWindowWidth: number | null;
  gamescopeWindowHeight: number | null;
  gamescopeFilter: string | null;
  gamescopeFsrSharpness: number | null;
  gamescopeFpsLimit: number | null;
  gamescopeRefreshRate: number | null;
  gamescopeAdaptiveSync: boolean;
  gamescopeHdr: boolean;
  gamescopeStretch: boolean;
  gamescopeForceWindowsFullscreen: boolean;
}

const DEFAULT_SETTINGS: CompatibilitySettings = {
  defaultRunnerPath: null,
  defaultPrefixBaseDir: null,
  enableDxvk: true,
  enableVkd3d: true,
  enableEsync: true,
  enableFsync: true,
  enableDxvkNvapi: false,
  enableMangoHud: false,
  enableGameMode: false,
  enableGamescope: false,
  gamescopeArgs: "-w 1920 -h 1080 -F fsr -f",
  primeRenderOffload: false,
  customEnvironmentVariables: {},
  customDllOverrides: {},
  winetricksPath: null,

  enableNtsync: false,
  enableDxvkAsync: false,
  enableWayland: false,
  enableWow64: false,
  enableLargeAddressAware: false,
  wineDebug: "-all",
  audioDriver: null,
  virtualDesktop: false,
  virtualDesktopRes: "1920x1080",
  enableUmuLauncher: false,
  mangohudHidden: false,

  gamescopeMode: "fullscreen",
  gamescopeGameWidth: 1920,
  gamescopeGameHeight: 1080,
  gamescopeWindowWidth: null,
  gamescopeWindowHeight: null,
  gamescopeFilter: "fsr",
  gamescopeFsrSharpness: 5,
  gamescopeFpsLimit: null,
  gamescopeRefreshRate: null,
  gamescopeAdaptiveSync: false,
  gamescopeHdr: false,
  gamescopeStretch: false,
  gamescopeForceWindowsFullscreen: false,
};

type CompatSettingsSubtab =
  | "runners"
  | "graphics"
  | "sync_engine"
  | "gamescope"
  | "tools"
  | "env_dll"
  | "maintenance";

export default function CompatibilityTab() {
  const { t } = useLanguage();
  const { showToast } = useToast();

  const [searchParams] = useSearchParams();
  const sectionParam = searchParams.get("section");

  const [activeSubtab, setActiveSubtab] = useState<CompatSettingsSubtab>("runners");
  const [settings, setSettings] = useState<CompatibilitySettings>(DEFAULT_SETTINGS);
  const [runners, setRunners] = useState<CompatibilityRunner[]>([]);
  const [systemStatus, setSystemStatus] = useState<LinuxSystemStatus | null>(null);
  const [loadingRunners, setLoadingRunners] = useState(false);
  const [runningMaintenance, setRunningMaintenance] = useState(false);

  // Sync active subtab when deep-linked or searched from the command palette
  useEffect(() => {
    if (sectionParam === "compat-runners") setActiveSubtab("runners");
    else if (sectionParam === "compat-graphics") setActiveSubtab("graphics");
    else if (sectionParam === "compat-sync-engine") setActiveSubtab("sync_engine");
    else if (sectionParam === "compat-gamescope") setActiveSubtab("gamescope");
    else if (sectionParam === "compat-tools") setActiveSubtab("tools");
    else if (sectionParam === "compat-env") setActiveSubtab("env_dll");
    else if (sectionParam === "compat-system") setActiveSubtab("maintenance");
  }, [sectionParam]);

  // New env var inputs
  const [newEnvKey, setNewEnvKey] = useState("");
  const [newEnvVal, setNewEnvVal] = useState("");

  // New DLL override inputs
  const [newDllName, setNewDllName] = useState("");
  const [newDllMode, setNewDllMode] = useState("n,b");

  // Load initial settings and data
  useEffect(() => {
    invoke<CompatibilitySettings>("get_compatibility_settings")
      .then((s) => setSettings({ ...DEFAULT_SETTINGS, ...s }))
      .catch((e) => console.error("Failed to fetch compatibility settings", e));

    fetchRunners();

    invoke<LinuxSystemStatus>("get_compatibility_system_status")
      .then((status) => setSystemStatus(status))
      .catch((e) => console.error("Failed to fetch system status", e));
  }, []);

  const fetchRunners = useCallback(async () => {
    setLoadingRunners(true);
    try {
      const list = await invoke<CompatibilityRunner[]>("list_compatibility_runners");
      setRunners(list);
    } catch (err) {
      console.error("Failed to detect compatibility runners", err);
    } finally {
      setLoadingRunners(false);
    }
  }, []);

  const updateSettings = useCallback(
    (updater: (prev: CompatibilitySettings) => CompatibilitySettings) => {
      setSettings((prev) => {
        const next = updater(prev);
        queueMicrotask(() => {
          invoke("set_compatibility_settings", { settings: next }).catch((err) => {
            showToast(t("compatibility.saveFailed", { error: String(err) }), "error");
          });
        });
        return next;
      });
    },
    [showToast, t],
  );

  const handleBrowsePrefixDir = async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: t("compatibility.selectPrefixDir"),
      });
      if (selected && typeof selected === "string") {
        updateSettings((prev) => ({ ...prev, defaultPrefixBaseDir: selected }));
        showToast(t("compatibility.prefixDirUpdated"), "success");
      }
    } catch (err) {
      showToast(String(err), "error");
    }
  };

  const handleBrowseRunner = async () => {
    try {
      const selected = await openDialog({
        directory: false,
        multiple: false,
        title: t("compatibility.selectRunnerExecutable"),
      });
      if (selected && typeof selected === "string") {
        updateSettings((prev) => ({ ...prev, defaultRunnerPath: selected }));
        showToast(t("compatibility.runnerSelected"), "success");
      }
    } catch (err) {
      showToast(String(err), "error");
    }
  };

  // Runner Manager state
  const [runnerViewMode, setRunnerViewMode] = useState<"installed" | "download" | "settings">("installed");
  const [runnerSearch, setRunnerSearch] = useState("");
  const [runnerFilter, setRunnerFilter] = useState<"all" | "proton" | "wine">("all");
  const [activeSource, setActiveSource] = useState<"ge-proton" | "wine-ge" | "kron4ek" | "lutris" | "custom">("ge-proton");
  const [releases, setReleases] = useState<RemoteRunnerRelease[]>([]);
  const [loadingReleases, setLoadingReleases] = useState(false);
  const [customUrl, setCustomUrl] = useState("");
  const [customRunnerName, setCustomRunnerName] = useState("");
  const [customTargetType, setCustomTargetType] = useState<"proton" | "wine">("proton");
  const [activeProgress, setActiveProgress] = useState<RunnerInstallProgress | null>(null);
  const [runnerToDelete, setRunnerToDelete] = useState<CompatibilityRunner | null>(null);
  const [isDeletingRunner, setIsDeletingRunner] = useState(false);
  const [installingRunners, setInstallingRunners] = useState<Record<string, boolean>>({});

  const totalRunnerStorage = useMemo(() => {
    return runners.reduce((acc, r) => acc + (r.sizeBytes || 0), 0);
  }, [runners]);

  const activeDefaultRunner = useMemo(() => {
    if (!settings.defaultRunnerPath) return null;
    return runners.find((r) => r.path === settings.defaultRunnerPath) || null;
  }, [runners, settings.defaultRunnerPath]);

  const filteredRunners = useMemo(() => {
    const q = runnerSearch.trim().toLowerCase();
    return runners.filter((r) => {
      if (runnerFilter === "proton" && !r.isProton) return false;
      if (runnerFilter === "wine" && r.isProton) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        r.kind.toLowerCase().includes(q) ||
        r.path.toLowerCase().includes(q) ||
        (r.version && r.version.toLowerCase().includes(q))
      );
    });
  }, [runners, runnerSearch, runnerFilter]);

  useEffect(() => {
    const unlistenPromise = listen<RunnerInstallProgress>("runner-install-progress", (event) => {
      const payload = event.payload;
      const status = payload.status || payload.phase;
      const errorMsg = payload.error || payload.errorMessage;
      setActiveProgress({
        ...payload,
        phase: (status as any) || payload.phase || "downloading",
        errorMessage: errorMsg,
      });
      if (status === "completed") {
        showToast(t("compatibility.installSuccess", { name: payload.runnerName }), "success");
        fetchRunners();
        setInstallingRunners((prev) => ({ ...prev, [payload.runnerName]: false }));
        setTimeout(() => {
          setActiveProgress((curr) => (curr?.runnerName === payload.runnerName ? null : curr));
        }, 4000);
      } else if (status === "failed" || status === "error") {
        showToast(
          t("compatibility.installError", {
            error: errorMsg || payload.runnerName,
          }),
          "error"
        );
        setInstallingRunners((prev) => ({ ...prev, [payload.runnerName]: false }));
      }
    });

    return () => {
      unlistenPromise.then((fn) => fn()).catch(console.error);
    };
  }, [fetchRunners, showToast, t]);

  const fetchReleases = useCallback(
    async (source: string, forceRefresh = false) => {
      if (source === "custom") return;
      setLoadingReleases(true);
      try {
        const list = await invoke<RemoteRunnerRelease[]>("fetch_available_runners", {
          source,
          forceRefresh,
        });
        setReleases(list);
      } catch (err) {
        console.error("Failed to fetch available runners:", err);
        showToast(t("compatibility.archiveInstallError", { error: String(err) }), "error");
      } finally {
        setLoadingReleases(false);
      }
    },
    [showToast, t]
  );

  useEffect(() => {
    if (activeSubtab === "runners" && runnerViewMode === "download" && activeSource !== "custom") {
      fetchReleases(activeSource);
    }
  }, [activeSubtab, runnerViewMode, activeSource, fetchReleases]);

  const handleInstallRelease = async (rel: RemoteRunnerRelease) => {
    try {
      setInstallingRunners((prev) => ({ ...prev, [rel.name]: true }));
      const targetType = rel.targetType || (rel.source === "ge-proton" ? "proton" : "wine");
      await invoke("install_compatibility_runner", {
        downloadUrl: rel.downloadUrl,
        filename: rel.filename,
        runnerName: rel.name,
        targetType,
      });
    } catch (err) {
      showToast(t("compatibility.installError", { error: String(err) }), "error");
      setInstallingRunners((prev) => ({ ...prev, [rel.name]: false }));
    }
  };

  const handleCancelInstall = async () => {
    if (!activeProgress) return;
    try {
      await invoke("cancel_runner_install", { runnerName: activeProgress.runnerName });
      showToast(t("compatibility.cancelInstall"), "info");
      setActiveProgress(null);
    } catch (err) {
      showToast(String(err), "error");
    }
  };

  const handleInstallCustomUrl = async () => {
    const url = customUrl.trim();
    if (!url) return;
    const name = customRunnerName.trim() || url.split("/").pop()?.split("?")[0] || "custom-runner";
    const filename = url.split("/").pop()?.split("?")[0] || `${name}.tar.xz`;
    try {
      setInstallingRunners((prev) => ({ ...prev, [name]: true }));
      await invoke("install_compatibility_runner", {
        downloadUrl: url,
        filename,
        runnerName: name,
        targetType: customTargetType,
      });
      setCustomUrl("");
      setCustomRunnerName("");
    } catch (err) {
      showToast(t("compatibility.installError", { error: String(err) }), "error");
      setInstallingRunners((prev) => ({ ...prev, [name]: false }));
    }
  };

  const handleInstallFromArchive = async () => {
    try {
      const selected = await openDialog({
        multiple: false,
        directory: false,
        title: t("compatibility.selectArchiveFile"),
        filters: [
          {
            name: "Runner Archives (*.tar.gz, *.tar.xz, *.tar.zst, *.zip)",
            extensions: ["gz", "xz", "zst", "zip", "tar"],
          },
        ],
      });
      if (selected && typeof selected === "string") {
        const extractedName = await invoke<string>("install_runner_from_archive", {
          archivePath: selected,
          targetType: "proton",
        });
        showToast(t("compatibility.archiveInstallSuccess", { name: extractedName }), "success");
        fetchRunners();
      }
    } catch (err) {
      showToast(t("compatibility.archiveInstallError", { error: String(err) }), "error");
    }
  };

  const handleDeleteRunnerConfirm = async () => {
    if (!runnerToDelete) return;
    setIsDeletingRunner(true);
    try {
      await invoke("delete_compatibility_runner", {
        runnerId: runnerToDelete.id,
        path: runnerToDelete.installDir || runnerToDelete.path,
      });
      showToast(t("compatibility.uninstallSuccess", { name: runnerToDelete.name }), "success");
      setRunnerToDelete(null);
      fetchRunners();
    } catch (err) {
      showToast(t("compatibility.uninstallError", { error: String(err) }), "error");
    } finally {
      setIsDeletingRunner(false);
    }
  };

  const handleOpenRunnerFolder = async (dirPath: string) => {
    try {
      await openPath(dirPath);
    } catch (err) {
      showToast(String(err), "error");
    }
  };


  const handleAddEnvVar = () => {
    const k = newEnvKey.trim();
    if (!k) return;
    updateSettings((prev) => ({
      ...prev,
      customEnvironmentVariables: {
        ...prev.customEnvironmentVariables,
        [k]: newEnvVal.trim(),
      },
    }));
    setNewEnvKey("");
    setNewEnvVal("");
  };

  const handleRemoveEnvVar = (k: string) => {
    updateSettings((prev) => {
      const copy = { ...prev.customEnvironmentVariables };
      delete copy[k];
      return { ...prev, customEnvironmentVariables: copy };
    });
  };

  const handleAddDllOverride = () => {
    const name = newDllName.trim().toLowerCase().replace(/\.dll$/, "");
    if (!name) return;
    updateSettings((prev) => ({
      ...prev,
      customDllOverrides: {
        ...prev.customDllOverrides,
        [name]: newDllMode,
      },
    }));
    setNewDllName("");
  };

  const handleRemoveDllOverride = (name: string) => {
    updateSettings((prev) => {
      const copy = { ...prev.customDllOverrides };
      delete copy[name];
      return { ...prev, customDllOverrides: copy };
    });
  };

  const handleRunTool = async (tool: string) => {
    setRunningMaintenance(true);
    try {
      await invoke("run_wine_tool", {
        runnerPath: settings.defaultRunnerPath || null,
        prefixPath: null,
        gameId: null,
        tool,
        args: null,
      });
      showToast(t("compatibility.toolLaunched", { tool }), "success");
    } catch (err) {
      showToast(String(err), "error");
    } finally {
      setRunningMaintenance(false);
    }
  };

  const subtabs: { key: CompatSettingsSubtab; labelKey: string }[] = [
    { key: "runners", labelKey: "settings.compatibility.sectionRunners" },
    { key: "graphics", labelKey: "settings.compatibility.sectionGraphics" },
    { key: "sync_engine", labelKey: "compatibility.subtabSyncEngine" },
    { key: "gamescope", labelKey: "compatibility.subtabGamescope" },
    { key: "tools", labelKey: "settings.compatibility.sectionTools" },
    { key: "env_dll", labelKey: "settings.compatibility.sectionEnv" },
    { key: "maintenance", labelKey: "settings.compatibility.sectionSystem" },
  ];

  return (
    <div className="compat-tab-shell">
      {/* ── Subtab Pill Navigation ────────────────────────────────────────── */}
      <nav className="compat-subtab-bar" aria-label={t("compatibility.categoryNav")}>
        {subtabs.map((sub) => {
          const isActive = activeSubtab === sub.key;
          return (
            <button
              key={sub.key}
              type="button"
              className={`compat-subtab-btn ${isActive ? "active" : ""}`}
              onClick={() => setActiveSubtab(sub.key)}
              aria-selected={isActive}
              role="tab"
            >
              {t(sub.labelKey)}
            </button>
          );
        })}
      </nav>

      {/* ── Subtab 1: Runners & Prefix ────────────────────────────────────── */}
      {activeSubtab === "runners" && (
        <div className="compat-panel" role="tabpanel">
          <SettingsSection
            id="compat-runners"
            icon={<CompatibilityIcon />}
            title={t("settings.compatibility.sectionRunners")}
            desc={t("settings.compatibility.sectionRunnersDesc")}
          >
            {/* KPI Stats Grid */}
            <div className="runner-kpi-grid">
              <div className="runner-kpi-card">
                <div className="runner-kpi-icon">
                  <Layers size={18} />
                </div>
                <div className="runner-kpi-data">
                  <span className="runner-kpi-value">{runners.length}</span>
                  <span className="runner-kpi-label">{t("compatibility.detectedRunners", { count: runners.length })}</span>
                </div>
              </div>

              <div className="runner-kpi-card">
                <div className="runner-kpi-icon">
                  <HardDrive size={18} />
                </div>
                <div className="runner-kpi-data">
                  <span className="runner-kpi-value">{formatBytes(totalRunnerStorage)}</span>
                  <span className="runner-kpi-label">{t("compatibility.totalDiskUsage")}</span>
                </div>
              </div>

              <div className="runner-kpi-card">
                <div className="runner-kpi-icon">
                  <Sliders size={18} />
                </div>
                <div className="runner-kpi-data">
                  <span className="runner-kpi-value runner-kpi-value-truncate">
                    {activeDefaultRunner ? activeDefaultRunner.name : t("compatibility.autoDetectRunner")}
                  </span>
                  <span className="runner-kpi-label">{t("compatibility.activeDefault")}</span>
                </div>
              </div>
            </div>

            {/* Inner View Switcher */}
            <div className="runner-view-tabs">
              <div className="runner-view-pills" role="tablist">
                <button
                  type="button"
                  className={`runner-view-pill-btn ${runnerViewMode === "installed" ? "active" : ""}`}
                  onClick={() => setRunnerViewMode("installed")}
                  role="tab"
                  aria-selected={runnerViewMode === "installed"}
                >
                  <Layers size={14} />
                  <span>{t("compatibility.tabInstalledRunners")}</span>
                  <span className="runner-view-pill-badge">{runners.length}</span>
                </button>
                <button
                  type="button"
                  className={`runner-view-pill-btn ${runnerViewMode === "download" ? "active" : ""}`}
                  onClick={() => setRunnerViewMode("download")}
                  role="tab"
                  aria-selected={runnerViewMode === "download"}
                >
                  <Download size={14} />
                  <span>{t("compatibility.tabDownloadRunners")}</span>
                </button>
                <button
                  type="button"
                  className={`runner-view-pill-btn ${runnerViewMode === "settings" ? "active" : ""}`}
                  onClick={() => setRunnerViewMode("settings")}
                  role="tab"
                  aria-selected={runnerViewMode === "settings"}
                >
                  <Sliders size={14} />
                  <span>{t("compatibility.tabPrefixSettings")}</span>
                </button>
              </div>

              <div style={{ display: "flex", gap: "var(--space-xs)" }}>
                {runnerViewMode === "installed" && (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleInstallFromArchive}
                      title={t("compatibility.selectArchiveFile")}
                    >
                      <FileArchive size={14} />
                      {t("compatibility.installFromArchive")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={fetchRunners}
                      disabled={loadingRunners}
                      title={t("compatibility.rescanRunners")}
                    >
                      <RefreshCw size={14} className={loadingRunners ? "runner-spin" : ""} />
                      {loadingRunners ? t("common.scanning") : t("compatibility.scan")}
                    </Button>
                  </>
                )}
                {runnerViewMode === "download" && activeSource !== "custom" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => fetchReleases(activeSource, true)}
                    disabled={loadingReleases}
                    title={t("compatibility.refreshReleases")}
                  >
                    <RefreshCw size={14} className={loadingReleases ? "runner-spin" : ""} />
                    {loadingReleases ? t("common.scanning") : t("compatibility.refreshReleases")}
                  </Button>
                )}
              </div>
            </div>

            {/* Live Download / Extraction Progress Banner */}
            {activeProgress && (
              <div className="runner-progress-card">
                <div className="runner-progress-header">
                  <div className="runner-progress-title-row">
                    <Loader2 size={16} className="runner-spin" />
                    <strong>
                      {(activeProgress.status || activeProgress.phase) === "extracting"
                        ? t("compatibility.extractingRunner")
                        : `${t("compatibility.downloadingRunner")} (${Math.round(activeProgress.percent)}%)`}
                    </strong>
                  </div>
                  {(activeProgress.status || activeProgress.phase) === "downloading" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleCancelInstall}
                      style={{ height: "24px", padding: "0 6px", fontSize: "0.75rem" }}
                    >
                      {t("compatibility.cancelInstall")}
                    </Button>
                  )}
                </div>

                <div className="runner-progress-bar-track">
                  <div
                    className="runner-progress-bar-fill"
                    style={{ width: `${Math.max(0, Math.min(100, activeProgress.percent))}%` }}
                  />
                </div>

                <div className="runner-progress-meta">
                  <span>
                    {activeProgress.totalBytes && activeProgress.totalBytes > 0
                      ? `${formatBytes(activeProgress.downloadedBytes)} / ${formatBytes(activeProgress.totalBytes)}`
                      : formatBytes(activeProgress.downloadedBytes)}
                  </span>
                  {activeProgress.speedBytesPerSec > 0 && (
                    <span>
                      {`${formatBytes(activeProgress.speedBytesPerSec)}/s`}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* View 1: Installed Runners */}
            {runnerViewMode === "installed" && (
              <div className="settings-behavior-card" style={{ padding: "var(--space-md)" }}>
                {/* Search & Filter Toolbar */}
                <div className="runner-toolbar">
                  <div className="runner-search-box">
                    <Search size={14} className="runner-search-icon" />
                    <input
                      type="text"
                      className="runner-search-input"
                      placeholder={t("compatibility.searchRunners")}
                      value={runnerSearch}
                      onChange={(e) => setRunnerSearch(e.target.value)}
                    />
                    {runnerSearch && (
                      <button
                        type="button"
                        className="runner-search-clear"
                        onClick={() => setRunnerSearch("")}
                        aria-label="Clear"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>

                  <div className="runner-filter-group">
                    <button
                      type="button"
                      className={`runner-filter-pill ${runnerFilter === "all" ? "active" : ""}`}
                      onClick={() => setRunnerFilter("all")}
                    >
                      {t("compatibility.filterAll")}
                    </button>
                    <button
                      type="button"
                      className={`runner-filter-pill ${runnerFilter === "proton" ? "active" : ""}`}
                      onClick={() => setRunnerFilter("proton")}
                    >
                      {t("compatibility.filterProton")}
                    </button>
                    <button
                      type="button"
                      className={`runner-filter-pill ${runnerFilter === "wine" ? "active" : ""}`}
                      onClick={() => setRunnerFilter("wine")}
                    >
                      {t("compatibility.filterWine")}
                    </button>
                  </div>
                </div>

                {/* Runner Cards Grid / List */}
                <div className="runner-list-container">
                  {filteredRunners.length === 0 ? (
                    <div className="runner-empty-state">
                      <Layers size={32} style={{ opacity: 0.4 }} />
                      <p>{t("compatibility.noRunnersDetected")}</p>
                      {runners.length === 0 && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setRunnerViewMode("download")}
                          style={{ marginTop: "var(--space-sm)" }}
                        >
                          <Download size={14} />
                          {t("compatibility.tabDownloadRunners")}
                        </Button>
                      )}
                    </div>
                  ) : (
                    filteredRunners.map((r) => {
                      const isDefault = settings.defaultRunnerPath === r.path;
                      const sizeStr = r.sizeBytes && r.sizeBytes > 0 ? formatBytes(r.sizeBytes) : null;
                      const openTarget = r.installDir || r.path;

                      return (
                        <div key={r.path} className={`runner-card ${isDefault ? "is-default" : ""}`}>
                          <div className="runner-card-main">
                            <div className="runner-card-header">
                              <div className="runner-card-title-wrap">
                                <span className="runner-card-name">{r.name}</span>
                                <Badge variant={r.isProton ? "accent" : "default"}>
                                  {(r.kind || "runner").toUpperCase()}
                                </Badge>
                                {r.version && (
                                  <Badge variant="default">v{r.version}</Badge>
                                )}
                                {isDefault && (
                                  <Badge variant="accent">
                                    <Check size={11} style={{ marginRight: 2 }} />
                                    {t("compatibility.activeDefault")}
                                  </Badge>
                                )}
                              </div>
                            </div>

                            <div className="runner-card-meta">
                              <div className="runner-card-path" title={r.path}>
                                {r.path}
                              </div>
                              <div className="runner-card-footprint">
                                <HardDrive size={12} />
                                <span>{sizeStr ? `${t("compatibility.sizeDisk")}: ${sizeStr}` : ""}</span>
                              </div>
                            </div>
                          </div>

                          <div className="runner-card-actions">
                            {!isDefault ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  updateSettings((prev) => ({ ...prev, defaultRunnerPath: r.path }))
                                }
                                title={t("compatibility.setAsDefault")}
                              >
                                <Check size={13} />
                                <span>{t("compatibility.setAsDefault")}</span>
                              </Button>
                            ) : null}

                            {openTarget && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleOpenRunnerFolder(openTarget)}
                                title={t("compatibility.openFolder")}
                              >
                                <FolderOpen size={14} />
                              </Button>
                            )}

                            <Button
                              variant="ghost"
                              size="sm"
                              className="runner-delete-btn"
                              disabled={!r.isDeletable}
                              onClick={() => setRunnerToDelete(r)}
                              title={
                                r.isDeletable
                                  ? t("compatibility.uninstall")
                                  : t("compatibility.uninstallSystemWarning")
                              }
                            >
                              <Trash2 size={14} />
                            </Button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {/* View 2: Download from Sources */}
            {runnerViewMode === "download" && (
              <div className="settings-behavior-card" style={{ padding: "var(--space-md)" }}>
                {/* Source Selection Pills */}
                <div className="runner-source-selector" role="tablist">
                  <button
                    type="button"
                    className={`runner-source-pill ${activeSource === "ge-proton" ? "active" : ""}`}
                    onClick={() => setActiveSource("ge-proton")}
                  >
                    <strong>{t("compatibility.sourceGeProton")}</strong>
                  </button>
                  <button
                    type="button"
                    className={`runner-source-pill ${activeSource === "wine-ge" ? "active" : ""}`}
                    onClick={() => setActiveSource("wine-ge")}
                  >
                    <strong>{t("compatibility.sourceWineGe")}</strong>
                  </button>
                  <button
                    type="button"
                    className={`runner-source-pill ${activeSource === "kron4ek" ? "active" : ""}`}
                    onClick={() => setActiveSource("kron4ek")}
                  >
                    <strong>{t("compatibility.sourceKron4ek")}</strong>
                  </button>
                  <button
                    type="button"
                    className={`runner-source-pill ${activeSource === "lutris" ? "active" : ""}`}
                    onClick={() => setActiveSource("lutris")}
                  >
                    <strong>{t("compatibility.sourceLutris")}</strong>
                  </button>
                  <button
                    type="button"
                    className={`runner-source-pill ${activeSource === "custom" ? "active" : ""}`}
                    onClick={() => setActiveSource("custom")}
                  >
                    <strong>{t("compatibility.sourceCustomUrl")}</strong>
                  </button>
                </div>

                {/* Source Description */}
                <p className="runner-source-description">
                  {activeSource === "ge-proton" && t("compatibility.sourceGeProtonDesc")}
                  {activeSource === "wine-ge" && t("compatibility.sourceWineGeDesc")}
                  {activeSource === "kron4ek" && t("compatibility.sourceKron4ekDesc")}
                  {activeSource === "lutris" && t("compatibility.sourceLutrisDesc")}
                  {activeSource === "custom" && t("compatibility.sourceCustomUrlDesc")}
                </p>

                {/* Custom URL Download Form */}
                {activeSource === "custom" ? (
                  <div className="runner-custom-url-card">
                    <div className="runner-custom-field">
                      <label className="settings-label" htmlFor="custom-runner-url">
                        {t("compatibility.sourceCustomUrl")}
                      </label>
                      <input
                        id="custom-runner-url"
                        type="url"
                        className="settings-input"
                        placeholder={t("compatibility.directUrlPlaceholder")}
                        value={customUrl}
                        onChange={(e) => setCustomUrl(e.target.value)}
                      />
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-md)" }}>
                      <div className="runner-custom-field">
                        <label className="settings-label" htmlFor="custom-runner-name">
                          {t("compatibility.customRunnerBinary")}
                        </label>
                        <input
                          id="custom-runner-name"
                          type="text"
                          className="settings-input"
                          placeholder="e.g. Proton-Experimental-Custom"
                          value={customRunnerName}
                          onChange={(e) => setCustomRunnerName(e.target.value)}
                        />
                      </div>

                      <div className="runner-custom-field">
                        <label className="settings-label" htmlFor="custom-runner-target">
                          {t("compatibility.selectTargetType")}
                        </label>
                        <select
                          id="custom-runner-target"
                          className="settings-select"
                          value={customTargetType}
                          onChange={(e) => setCustomTargetType(e.target.value as "proton" | "wine")}
                        >
                          <option value="proton">{t("compatibility.targetSteamCompat")}</option>
                          <option value="wine">{t("compatibility.targetWine")}</option>
                        </select>
                      </div>
                    </div>

                    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "var(--space-sm)" }}>
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={!customUrl.trim() || !!installingRunners[customRunnerName || "custom-runner"]}
                        onClick={handleInstallCustomUrl}
                      >
                        <Download size={14} />
                        {t("compatibility.installRelease")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  /* GitHub Releases Catalog */
                  <div className="runner-release-list">
                    {loadingReleases ? (
                      <div className="runner-empty-state">
                        <Loader2 size={24} className="runner-spin" />
                        <p>{t("compatibility.fetchingReleases")}</p>
                      </div>
                    ) : releases.length === 0 ? (
                      <div className="runner-empty-state">
                        <p>{t("compatibility.noReleasesFound")}</p>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => fetchReleases(activeSource, true)}
                        >
                          {t("compatibility.refreshReleases")}
                        </Button>
                      </div>
                    ) : (
                      releases.map((rel) => {
                        const targetType =
                          rel.targetType || (rel.source === "ge-proton" ? "proton" : "wine");
                        const dateStr = rel.releaseDate || rel.publishedAt;
                        const formattedDate = dateStr
                          ? (() => {
                              const d = new Date(dateStr);
                              return isNaN(d.getTime()) ? null : d.toLocaleDateString();
                            })()
                          : null;
                        const isInstalled =
                          rel.isInstalled ||
                          runners.some(
                            (r) =>
                              r.name.toLowerCase() === rel.name.toLowerCase() ||
                              (r.version && r.version.toLowerCase() === rel.tag.toLowerCase())
                          );
                        const progressPhase = activeProgress?.status || activeProgress?.phase;
                        const isBusy =
                          !!installingRunners[rel.name] ||
                          (activeProgress?.runnerName === rel.name &&
                            (progressPhase === "downloading" || progressPhase === "extracting"));

                        return (
                          <div key={rel.downloadUrl} className="runner-release-item">
                            <div className="runner-release-main">
                              <div className="runner-release-title-row">
                                <strong>{rel.name}</strong>
                                <Badge variant="default">{rel.tag}</Badge>
                                <Badge variant={targetType === "proton" ? "accent" : "default"}>
                                  {(targetType || "runner").toUpperCase()}
                                </Badge>
                                {isInstalled && (
                                  <Badge variant="accent">
                                    <CheckCircle2 size={12} style={{ marginRight: 2 }} />
                                    {t("compatibility.installedBadge")}
                                  </Badge>
                                )}
                              </div>

                              <div className="runner-release-meta-row">
                                {rel.sizeBytes && (
                                  <span>
                                    <HardDrive size={11} style={{ marginRight: 3, verticalAlign: "-1px" }} />
                                    {formatBytes(rel.sizeBytes)}
                                  </span>
                                )}
                                {formattedDate && <span>{formattedDate}</span>}
                                {rel.downloadUrl && (
                                  <a
                                    href={rel.downloadUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="runner-notes-link"
                                    title={rel.filename}
                                  >
                                    <ExternalLink size={11} style={{ marginRight: 2 }} />
                                    {t("compatibility.viewNotes")}
                                  </a>
                                )}
                              </div>
                            </div>

                            <div className="runner-release-action">
                              <Button
                                variant={isInstalled ? "ghost" : "primary"}
                                size="sm"
                                disabled={isBusy}
                                onClick={() => handleInstallRelease(rel)}
                              >
                                {isBusy ? (
                                  <>
                                    <Loader2 size={13} className="runner-spin" />
                                    {t("compatibility.downloadingRunner")}
                                  </>
                                ) : isInstalled ? (
                                  <>
                                    <RefreshCw size={13} />
                                    {t("compatibility.reinstallRelease")}
                                  </>
                                ) : (
                                  <>
                                    <Download size={13} />
                                    {t("compatibility.installRelease")}
                                  </>
                                )}
                              </Button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            )}

            {/* View 3: Default Runner & Prefix Configuration */}
            {runnerViewMode === "settings" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
                {/* Default Runner Selector */}
                <div className="settings-behavior-card">
                  <div className="settings-control">
                    <label className="settings-label" htmlFor="compat-default-runner">
                      {t("compatibility.defaultRunner")}
                    </label>
                    <p className="settings-helper-lead">
                      {t("compatibility.defaultRunnerDesc")}
                    </p>
                    <div style={{ display: "flex", gap: "var(--space-md)", alignItems: "center", marginTop: "var(--space-sm)" }}>
                      <select
                        id="compat-default-runner"
                        className="settings-select"
                        style={{ flex: 1 }}
                        value={settings.defaultRunnerPath || ""}
                        onChange={(e) => {
                          const val = e.target.value || null;
                          updateSettings((prev) => ({ ...prev, defaultRunnerPath: val }));
                        }}
                      >
                        <option value="">{t("compatibility.autoDetectRunner")}</option>
                        {runners.map((r) => (
                          <option key={r.path} value={r.path}>
                            {r.name} ({r.kind})
                          </option>
                        ))}
                      </select>

                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleBrowseRunner}
                        title={t("compatibility.browseRunnerBinary")}
                      >
                        {t("common.browse")}
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Default Prefix Directory */}
                <div className="settings-behavior-card">
                  <div className="settings-control">
                    <label className="settings-label" htmlFor="compat-prefix-dir">
                      {t("compatibility.defaultPrefixLocation")}
                    </label>
                    <p className="settings-helper-lead">
                      {t("compatibility.defaultPrefixLocationDesc")}
                    </p>
                    <div style={{ display: "flex", gap: "var(--space-md)", alignItems: "center", marginTop: "var(--space-sm)" }}>
                      <input
                        id="compat-prefix-dir"
                        type="text"
                        className="settings-input"
                        style={{ flex: 1 }}
                        placeholder="~/.local/share/GameIndex/wineprefixes"
                        value={settings.defaultPrefixBaseDir || ""}
                        onChange={(e) => {
                          const val = e.target.value || null;
                          updateSettings((prev) => ({ ...prev, defaultPrefixBaseDir: val }));
                        }}
                      />
                      <Button variant="secondary" size="sm" onClick={handleBrowsePrefixDir}>
                        {t("common.browse")}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </SettingsSection>

          {/* Destructive Action Modal: Runner Uninstall */}
          <ConfirmModal
            open={runnerToDelete !== null}
            title={t("compatibility.uninstallConfirmTitle")}
            message={t("compatibility.uninstallConfirmDesc", {
              name: runnerToDelete?.name || "",
              size: runnerToDelete?.sizeBytes && runnerToDelete.sizeBytes > 0
                ? formatBytes(runnerToDelete.sizeBytes)
                : "",
            })}
            warning={t("compatibility.uninstallSystemWarning")}
            confirmLabel={t("compatibility.uninstall")}
            cancelLabel={t("compatibility.cancelInstall")}
            busy={isDeletingRunner}
            onConfirm={handleDeleteRunnerConfirm}
            onCancel={() => setRunnerToDelete(null)}
          />
        </div>
      )}

      {/* ── Subtab 2: Graphics & Direct3D ─────────────────────────────────── */}
      {activeSubtab === "graphics" && (
        <div className="compat-panel" role="tabpanel">
          <SettingsSection
            id="compat-graphics"
            icon={<CompatibilityIcon />}
            title={t("settings.compatibility.sectionGraphics")}
            desc={t("settings.compatibility.sectionGraphicsDesc")}
          >
            <div className="settings-launcher-grid">
              <SettingsToggleCard
                title={t("compatibility.enableDxvk")}
                desc={t("compatibility.enableDxvkDesc")}
                checked={settings.enableDxvk}
                onChange={(v) => updateSettings((prev) => ({ ...prev, enableDxvk: v }))}
              />

              <SettingsToggleCard
                title={t("compatibility.enableVkd3d")}
                desc={t("compatibility.enableVkd3dDesc")}
                checked={settings.enableVkd3d}
                onChange={(v) => updateSettings((prev) => ({ ...prev, enableVkd3d: v }))}
              />

              <SettingsToggleCard
                title={t("compatibility.enableDxvkNvapi")}
                desc={t("compatibility.enableDxvkNvapiDesc")}
                checked={settings.enableDxvkNvapi}
                onChange={(v) => updateSettings((prev) => ({ ...prev, enableDxvkNvapi: v }))}
              />

              <SettingsToggleCard
                title={t("compatibility.enableDxvkAsync")}
                desc={t("compatibility.enableDxvkAsyncDesc")}
                checked={settings.enableDxvkAsync}
                onChange={(v) => updateSettings((prev) => ({ ...prev, enableDxvkAsync: v }))}
              />

              {/* DXVK HUD Option */}
              <div className="settings-behavior-card">
                <div className="settings-control">
                  <label className="settings-label" htmlFor="compat-dxvk-hud">
                    {t("compatibility.dxvkHud")}
                  </label>
                  <p className="settings-helper-lead">{t("compatibility.dxvkHudDesc")}</p>
                  <select
                    id="compat-dxvk-hud"
                    className="settings-select"
                    style={{ marginTop: "var(--space-xs)" }}
                    value={settings.customEnvironmentVariables["DXVK_HUD"] || ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      updateSettings((prev) => {
                        const copy = { ...prev.customEnvironmentVariables };
                        if (val) copy["DXVK_HUD"] = val;
                        else delete copy["DXVK_HUD"];
                        return { ...prev, customEnvironmentVariables: copy };
                      });
                    }}
                  >
                    <option value="">{t("compatibility.hudDisabled")}</option>
                    <option value="fps">{t("compatibility.hudFpsOnly")}</option>
                    <option value="fps,devinfo,memory">{t("compatibility.hudStandard")}</option>
                    <option value="full">{t("compatibility.hudFull")}</option>
                    <option value="compiler">{t("compatibility.hudCompilerOnly")}</option>
                  </select>
                </div>
              </div>

              {/* Virtual Desktop Option */}
              <div className="settings-behavior-card">
                <div className="settings-control">
                  <label className="settings-label">{t("compatibility.virtualDesktop")}</label>
                  <p className="settings-helper-lead">{t("compatibility.virtualDesktopDesc")}</p>
                  <div style={{ display: "flex", gap: "var(--space-md)", alignItems: "center", marginTop: "var(--space-xs)" }}>
                    <input
                      type="checkbox"
                      id="compat-virtual-desktop"
                      checked={settings.virtualDesktop}
                      onChange={(e) => updateSettings((prev) => ({ ...prev, virtualDesktop: e.target.checked }))}
                    />
                    <label htmlFor="compat-virtual-desktop" style={{ fontSize: "0.85rem", cursor: "pointer" }}>
                      {t("compatibility.enableVirtualDesktop")}
                    </label>
                  </div>
                  {settings.virtualDesktop && (
                    <input
                      type="text"
                      className="settings-input"
                      style={{ marginTop: "var(--space-xs)" }}
                      placeholder="1920x1080"
                      value={settings.virtualDesktopRes || "1920x1080"}
                      onChange={(e) => updateSettings((prev) => ({ ...prev, virtualDesktopRes: e.target.value }))}
                    />
                  )}
                </div>
              </div>
            </div>
          </SettingsSection>
        </div>
      )}

      {/* ── Subtab 3: Synchronization & Engine ────────────────────────────── */}
      {activeSubtab === "sync_engine" && (
        <div className="compat-panel" role="tabpanel">
          <SettingsSection
            id="compat-sync-engine"
            icon={<CompatibilityIcon />}
            title={t("compatibility.subtabSyncEngine")}
            desc={t("compatibility.subtabSyncEngineDesc")}
          >
            <div className="settings-launcher-grid">
              <SettingsToggleCard
                title={t("compatibility.enableFsync")}
                desc={t("compatibility.enableFsyncDesc")}
                checked={settings.enableFsync}
                onChange={(v) => updateSettings((prev) => ({ ...prev, enableFsync: v }))}
              />

              <SettingsToggleCard
                title={t("compatibility.enableEsync")}
                desc={t("compatibility.enableEsyncDesc")}
                checked={settings.enableEsync}
                onChange={(v) => updateSettings((prev) => ({ ...prev, enableEsync: v }))}
              />

              <SettingsToggleCard
                title={t("compatibility.enableNtsync")}
                desc={t("compatibility.enableNtsyncDesc")}
                checked={settings.enableNtsync}
                onChange={(v) => updateSettings((prev) => ({ ...prev, enableNtsync: v }))}
              />

              <SettingsToggleCard
                title={t("compatibility.enableWayland")}
                desc={t("compatibility.enableWaylandDesc")}
                checked={settings.enableWayland}
                onChange={(v) => updateSettings((prev) => ({ ...prev, enableWayland: v }))}
              />

              <SettingsToggleCard
                title={t("compatibility.enableWow64")}
                desc={t("compatibility.enableWow64Desc")}
                checked={settings.enableWow64}
                onChange={(v) => updateSettings((prev) => ({ ...prev, enableWow64: v }))}
              />

              <SettingsToggleCard
                title={t("compatibility.enableLargeAddressAware")}
                desc={t("compatibility.enableLargeAddressAwareDesc")}
                checked={settings.enableLargeAddressAware}
                onChange={(v) => updateSettings((prev) => ({ ...prev, enableLargeAddressAware: v }))}
              />

              {/* Debug Channels */}
              <div className="settings-behavior-card">
                <div className="settings-control">
                  <label className="settings-label" htmlFor="compat-wine-debug">
                    {t("compatibility.wineDebug")}
                  </label>
                  <p className="settings-helper-lead">{t("compatibility.wineDebugDesc")}</p>
                  <select
                    id="compat-wine-debug"
                    className="settings-select"
                    style={{ marginTop: "var(--space-xs)" }}
                    value={settings.wineDebug || "-all"}
                    onChange={(e) => updateSettings((prev) => ({ ...prev, wineDebug: e.target.value }))}
                  >
                    <option value="-all">{t("compatibility.debugDisabled")}</option>
                    <option value="warn+all">{t("compatibility.debugWarnOnly")}</option>
                    <option value="fixme-all">{t("compatibility.debugFixmeOnly")}</option>
                    <option value="+loaddll">{t("compatibility.debugDllLoads")}</option>
                    <option value="all">{t("compatibility.debugAllVerbose")}</option>
                  </select>
                </div>
              </div>

              {/* Audio Driver */}
              <div className="settings-behavior-card">
                <div className="settings-control">
                  <label className="settings-label" htmlFor="compat-audio-driver">
                    {t("compatibility.audioDriver")}
                  </label>
                  <p className="settings-helper-lead">{t("compatibility.audioDriverDesc")}</p>
                  <select
                    id="compat-audio-driver"
                    className="settings-select"
                    style={{ marginTop: "var(--space-xs)" }}
                    value={settings.audioDriver || ""}
                    onChange={(e) => updateSettings((prev) => ({ ...prev, audioDriver: e.target.value || null }))}
                  >
                    <option value="">{t("compatibility.audioDriverAuto")}</option>
                    <option value="pulse">PulseAudio</option>
                    <option value="alsa">ALSA</option>
                    <option value="oss">OSS</option>
                  </select>
                </div>
              </div>
            </div>
          </SettingsSection>
        </div>
      )}

      {/* ── Subtab 4: Full Gamescope Micro-compositor ─────────────────────── */}
      {activeSubtab === "gamescope" && (
        <div className="compat-panel" role="tabpanel">
          <SettingsSection
            id="compat-gamescope"
            icon={<CompatibilityIcon />}
            title={t("compatibility.subtabGamescope")}
            desc={t("compatibility.subtabGamescopeDesc")}
          >
            <div className="settings-behavior-card">
              <SettingsToggleCard
                title={t("compatibility.enableGamescope")}
                desc={t("compatibility.enableGamescopeDesc")}
                checked={settings.enableGamescope}
                onChange={(v) => updateSettings((prev) => ({ ...prev, enableGamescope: v }))}
              />
            </div>

            {settings.enableGamescope && (
              <div className="gamescope-config-card">
                {/* Window Mode */}
                <div className="gamescope-control-row">
                  <label className="settings-label">{t("compatibility.gamescopeWindowMode")}</label>
                  <div className="gamescope-pill-group">
                    {(["fullscreen", "borderless", "windowed"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        className={`gamescope-pill-btn ${(settings.gamescopeMode || "fullscreen") === m ? "active" : ""}`}
                        onClick={() => updateSettings((prev) => ({ ...prev, gamescopeMode: m }))}
                      >
                        {t(`compatibility.mode_${m}`)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Resolution Inputs */}
                <div className="gamescope-res-grid">
                  <div className="gamescope-control-row">
                    <label className="settings-label">{t("compatibility.renderResolution")}</label>
                    <p className="settings-helper-lead">{t("compatibility.renderResolutionDesc")}</p>
                    <div style={{ display: "flex", gap: "var(--space-sm)", marginTop: "4px" }}>
                      <input
                        type="number"
                        className="settings-input"
                        placeholder="Width (1920)"
                        value={settings.gamescopeGameWidth || ""}
                        onChange={(e) => {
                          const val = e.target.value ? parseInt(e.target.value, 10) : null;
                          updateSettings((prev) => ({ ...prev, gamescopeGameWidth: val }));
                        }}
                      />
                      <input
                        type="number"
                        className="settings-input"
                        placeholder="Height (1080)"
                        value={settings.gamescopeGameHeight || ""}
                        onChange={(e) => {
                          const val = e.target.value ? parseInt(e.target.value, 10) : null;
                          updateSettings((prev) => ({ ...prev, gamescopeGameHeight: val }));
                        }}
                      />
                    </div>
                    <div className="gamescope-chips">
                      {[
                        { label: "720p", w: 1280, h: 720 },
                        { label: "1080p", w: 1920, h: 1080 },
                        { label: "1440p", w: 2560, h: 1440 },
                        { label: "4K", w: 3840, h: 2160 },
                      ].map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          className="gamescope-chip"
                          onClick={() => updateSettings((prev) => ({
                            ...prev,
                            gamescopeGameWidth: preset.w,
                            gamescopeGameHeight: preset.h,
                          }))}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="gamescope-control-row">
                    <label className="settings-label">{t("compatibility.outputResolution")}</label>
                    <p className="settings-helper-lead">{t("compatibility.outputResolutionDesc")}</p>
                    <div style={{ display: "flex", gap: "var(--space-sm)", marginTop: "4px" }}>
                      <input
                        type="number"
                        className="settings-input"
                        placeholder="Display W"
                        value={settings.gamescopeWindowWidth || ""}
                        onChange={(e) => {
                          const val = e.target.value ? parseInt(e.target.value, 10) : null;
                          updateSettings((prev) => ({ ...prev, gamescopeWindowWidth: val }));
                        }}
                      />
                      <input
                        type="number"
                        className="settings-input"
                        placeholder="Display H"
                        value={settings.gamescopeWindowHeight || ""}
                        onChange={(e) => {
                          const val = e.target.value ? parseInt(e.target.value, 10) : null;
                          updateSettings((prev) => ({ ...prev, gamescopeWindowHeight: val }));
                        }}
                      />
                    </div>
                    <div className="gamescope-chips">
                      {[
                        { label: "1080p", w: 1920, h: 1080 },
                        { label: "1440p", w: 2560, h: 1440 },
                        { label: "4K", w: 3840, h: 2160 },
                      ].map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          className="gamescope-chip"
                          onClick={() => updateSettings((prev) => ({
                            ...prev,
                            gamescopeWindowWidth: preset.w,
                            gamescopeWindowHeight: preset.h,
                          }))}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Upscaling Filter */}
                <div className="gamescope-control-row">
                  <label className="settings-label">{t("compatibility.upscalingFilter")}</label>
                  <div className="gamescope-pill-group">
                    {[
                      { key: "fsr", label: "AMD FSR" },
                      { key: "nis", label: "NVIDIA NIS" },
                      { key: "linear", label: "Linear" },
                      { key: "nearest", label: "Nearest" },
                      { key: "integer", label: "Integer Scaling" },
                    ].map((f) => (
                      <button
                        key={f.key}
                        type="button"
                        className={`gamescope-pill-btn ${(settings.gamescopeFilter || "fsr") === f.key ? "active" : ""}`}
                        onClick={() => updateSettings((prev) => ({ ...prev, gamescopeFilter: f.key }))}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* FSR Sharpness slider */}
                {settings.gamescopeFilter === "fsr" && (
                  <div className="gamescope-control-row">
                    <label className="settings-label">{t("compatibility.fsrSharpness")}</label>
                    <div className="gamescope-range-wrap">
                      <input
                        type="range"
                        min="0"
                        max="20"
                        className="gamescope-slider"
                        value={settings.gamescopeFsrSharpness ?? 5}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          updateSettings((prev) => ({ ...prev, gamescopeFsrSharpness: val }));
                        }}
                      />
                      <span className="gamescope-range-val">{settings.gamescopeFsrSharpness ?? 5}</span>
                    </div>
                  </div>
                )}

                {/* Frame rate limit & Refresh Rate */}
                <div className="gamescope-res-grid">
                  <div className="gamescope-control-row">
                    <label className="settings-label">{t("compatibility.frameRateLimit")}</label>
                    <div className="gamescope-pill-group">
                      {[null, 30, 40, 60, 120, 144].map((fps) => (
                        <button
                          key={fps === null ? "off" : fps}
                          type="button"
                          className={`gamescope-pill-btn ${settings.gamescopeFpsLimit === fps ? "active" : ""}`}
                          onClick={() => updateSettings((prev) => ({ ...prev, gamescopeFpsLimit: fps }))}
                        >
                          {fps === null ? t("common.off") : `${fps} FPS`}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="gamescope-control-row">
                    <label className="settings-label">{t("compatibility.refreshRate")}</label>
                    <div className="gamescope-pill-group">
                      {[null, 60, 120, 144, 165, 240].map((hz) => (
                        <button
                          key={hz === null ? "off" : hz}
                          type="button"
                          className={`gamescope-pill-btn ${settings.gamescopeRefreshRate === hz ? "active" : ""}`}
                          onClick={() => updateSettings((prev) => ({ ...prev, gamescopeRefreshRate: hz }))}
                        >
                          {hz === null ? t("common.off") : `${hz} Hz`}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Toggles: VRR, HDR, Stretch */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "var(--space-md)", marginTop: "var(--space-sm)" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", cursor: "pointer", fontSize: "0.85rem" }}>
                    <input
                      type="checkbox"
                      checked={settings.gamescopeAdaptiveSync}
                      onChange={(e) => updateSettings((prev) => ({ ...prev, gamescopeAdaptiveSync: e.target.checked }))}
                    />
                    <span>{t("compatibility.adaptiveSync")}</span>
                  </label>

                  <label style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", cursor: "pointer", fontSize: "0.85rem" }}>
                    <input
                      type="checkbox"
                      checked={settings.gamescopeHdr}
                      onChange={(e) => updateSettings((prev) => ({ ...prev, gamescopeHdr: e.target.checked }))}
                    />
                    <span>{t("compatibility.hdrEnabled")}</span>
                  </label>

                  <label style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", cursor: "pointer", fontSize: "0.85rem" }}>
                    <input
                      type="checkbox"
                      checked={settings.gamescopeStretch}
                      onChange={(e) => updateSettings((prev) => ({ ...prev, gamescopeStretch: e.target.checked }))}
                    />
                    <span>{t("compatibility.stretchAspect")}</span>
                  </label>
                </div>

                {/* Additional custom args */}
                <div className="gamescope-control-row" style={{ marginTop: "var(--space-sm)" }}>
                  <label className="settings-label" htmlFor="compat-gamescope-args">
                    {t("compatibility.additionalGamescopeArgs")}
                  </label>
                  <input
                    id="compat-gamescope-args"
                    type="text"
                    className="settings-input"
                    placeholder="e.g. --prefer-vk-device 1002:73bf"
                    value={settings.gamescopeArgs || ""}
                    onChange={(e) => {
                      const val = e.target.value || null;
                      updateSettings((prev) => ({ ...prev, gamescopeArgs: val }));
                    }}
                  />
                </div>
              </div>
            )}
          </SettingsSection>
        </div>
      )}

      {/* ── Subtab 5: Gaming Tools & Performance ──────────────────────────── */}
      {activeSubtab === "tools" && (
        <div className="compat-panel" role="tabpanel">
          <SettingsSection
            id="compat-tools"
            icon={<CompatibilityIcon />}
            title={t("settings.compatibility.sectionTools")}
            desc={t("settings.compatibility.sectionToolsDesc")}
          >
            <div className="settings-launcher-grid">
              <SettingsToggleCard
                title={t("compatibility.enableMangoHud")}
                desc={t("compatibility.enableMangoHudDesc")}
                checked={settings.enableMangoHud}
                onChange={(v) => updateSettings((prev) => ({ ...prev, enableMangoHud: v }))}
              />

              {settings.enableMangoHud && (
                <SettingsToggleCard
                  title={t("compatibility.mangohudHidden")}
                  desc={t("compatibility.mangohudHiddenDesc")}
                  checked={settings.mangohudHidden}
                  onChange={(v) => updateSettings((prev) => ({ ...prev, mangohudHidden: v }))}
                />
              )}

              <SettingsToggleCard
                title={t("compatibility.enableUmuLauncher")}
                desc={t("compatibility.enableUmuLauncherDesc")}
                checked={settings.enableUmuLauncher}
                onChange={(v) => updateSettings((prev) => ({ ...prev, enableUmuLauncher: v }))}
              />

              <SettingsToggleCard
                title={t("compatibility.enableGameMode")}
                desc={t("compatibility.enableGameModeDesc")}
                checked={settings.enableGameMode}
                onChange={(v) => updateSettings((prev) => ({ ...prev, enableGameMode: v }))}
              />

              <SettingsToggleCard
                title={t("compatibility.primeRenderOffload")}
                desc={t("compatibility.primeRenderOffloadDesc")}
                checked={settings.primeRenderOffload}
                onChange={(v) => updateSettings((prev) => ({ ...prev, primeRenderOffload: v }))}
              />
            </div>
          </SettingsSection>
        </div>
      )}

      {/* ── Subtab 6: Environment & DLL Overrides ─────────────────────────── */}
      {activeSubtab === "env_dll" && (
        <div className="compat-panel" role="tabpanel">
          <SettingsSection
            id="compat-env"
            icon={<CompatibilityIcon />}
            title={t("settings.compatibility.sectionEnv")}
            desc={t("settings.compatibility.sectionEnvDesc")}
          >
            {/* Environment Variables */}
            <Card className="settings-behavior-card">
              <div className="settings-control">
                <label className="settings-label">{t("compatibility.environmentVariables")}</label>
                <p className="settings-helper-lead">{t("compatibility.environmentVariablesDesc")}</p>

                <div className="compat-item-list">
                  {Object.entries(settings.customEnvironmentVariables).map(([k, v]) => (
                    <div key={k} className="compat-item-row">
                      <div>
                        <code className="compat-item-code">{k}</code> = <code>{v}</code>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => handleRemoveEnvVar(k)}>
                        {t("common.delete")}
                      </Button>
                    </div>
                  ))}
                </div>

                <div style={{ display: "flex", gap: "var(--space-md)", marginTop: "var(--space-md)" }}>
                  <input
                    type="text"
                    className="settings-input"
                    style={{ flex: 1 }}
                    placeholder="VARIABLE_NAME"
                    value={newEnvKey}
                    onChange={(e) => setNewEnvKey(e.target.value)}
                  />
                  <input
                    type="text"
                    className="settings-input"
                    style={{ flex: 1 }}
                    placeholder="value"
                    value={newEnvVal}
                    onChange={(e) => setNewEnvVal(e.target.value)}
                  />
                  <Button variant="secondary" size="sm" onClick={handleAddEnvVar}>
                    {t("common.add")}
                  </Button>
                </div>
              </div>
            </Card>

            {/* DLL Overrides */}
            <Card className="settings-behavior-card" style={{ marginTop: "var(--space-md)" }}>
              <div className="settings-control">
                <label className="settings-label">{t("compatibility.dllOverrides")}</label>
                <p className="settings-helper-lead">{t("compatibility.dllOverridesDesc")}</p>

                <div className="compat-item-list">
                  {Object.entries(settings.customDllOverrides).map(([name, mode]) => (
                    <div key={name} className="compat-item-row">
                      <div>
                        <code className="compat-item-code">{name}.dll</code> ({mode})
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => handleRemoveDllOverride(name)}>
                        {t("common.delete")}
                      </Button>
                    </div>
                  ))}
                </div>

                <div style={{ display: "flex", gap: "var(--space-md)", marginTop: "var(--space-md)" }}>
                  <input
                    type="text"
                    className="settings-input"
                    style={{ flex: 1 }}
                    placeholder="e.g. dinput8"
                    value={newDllName}
                    onChange={(e) => setNewDllName(e.target.value)}
                  />
                  <select
                    className="settings-select"
                    style={{ width: "160px" }}
                    value={newDllMode}
                    onChange={(e) => setNewDllMode(e.target.value)}
                  >
                    <option value="n,b">Native, Builtin (n,b)</option>
                    <option value="b,n">Builtin, Native (b,n)</option>
                    <option value="n">Native only (n)</option>
                    <option value="b">Builtin only (b)</option>
                    <option value="d">Disabled (d)</option>
                  </select>
                  <Button variant="secondary" size="sm" onClick={handleAddDllOverride}>
                    {t("common.add")}
                  </Button>
                </div>
              </div>
            </Card>
          </SettingsSection>
        </div>
      )}

      {/* ── Subtab 7: System Diagnostics & Maintenance ────────────────────── */}
      {activeSubtab === "maintenance" && (
        <div className="compat-panel" role="tabpanel">
          <SettingsSection
            id="compat-system"
            icon={<CompatibilityIcon />}
            title={t("settings.compatibility.sectionSystem")}
            desc={t("settings.compatibility.sectionSystemDesc")}
          >
            <div className="settings-behavior-card">
              <div className="settings-control">
                <label className="settings-label">{t("compatibility.systemStatus")}</label>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                    gap: "var(--space-md)",
                    marginTop: "var(--space-md)",
                  }}
                >
                  <div style={{ padding: "var(--space-sm)", background: "var(--color-surface-hover)", borderRadius: "var(--radius-sm)" }}>
                    <span style={{ color: "var(--color-text-muted)", fontSize: "0.75rem", display: "block" }}>
                      {t("compatibility.osKernel")}
                    </span>
                    <strong>{systemStatus?.osName || "..."} ({systemStatus?.kernelVersion || "..."})</strong>
                  </div>

                  <div style={{ padding: "var(--space-sm)", background: "var(--color-surface-hover)", borderRadius: "var(--radius-sm)" }}>
                    <span style={{ color: "var(--color-text-muted)", fontSize: "0.75rem", display: "block" }}>
                      {t("compatibility.displayServer")}
                    </span>
                    <Badge variant="accent">{systemStatus?.displayServer || "..."}</Badge>
                  </div>

                  <div style={{ padding: "var(--space-sm)", background: "var(--color-surface-hover)", borderRadius: "var(--radius-sm)" }}>
                    <span style={{ color: "var(--color-text-muted)", fontSize: "0.75rem", display: "block" }}>
                      Vulkan
                    </span>
                    <Badge variant={systemStatus?.vulkanSupport ? "success" : "default"}>
                      {systemStatus?.vulkanSupport ? t("compatibility.available") : t("compatibility.notDetected")}
                    </Badge>
                  </div>

                  <div style={{ padding: "var(--space-sm)", background: "var(--color-surface-hover)", borderRadius: "var(--radius-sm)" }}>
                    <span style={{ color: "var(--color-text-muted)", fontSize: "0.75rem", display: "block" }}>
                      GameMode
                    </span>
                    <Badge variant={systemStatus?.gamemodeAvailable ? "success" : "default"}>
                      {systemStatus?.gamemodeAvailable ? t("compatibility.available") : t("compatibility.notDetected")}
                    </Badge>
                  </div>

                  <div style={{ padding: "var(--space-sm)", background: "var(--color-surface-hover)", borderRadius: "var(--radius-sm)" }}>
                    <span style={{ color: "var(--color-text-muted)", fontSize: "0.75rem", display: "block" }}>
                      MangoHud
                    </span>
                    <Badge variant={systemStatus?.mangohudAvailable ? "success" : "default"}>
                      {systemStatus?.mangohudAvailable ? t("compatibility.available") : t("compatibility.notDetected")}
                    </Badge>
                  </div>

                  <div style={{ padding: "var(--space-sm)", background: "var(--color-surface-hover)", borderRadius: "var(--radius-sm)" }}>
                    <span style={{ color: "var(--color-text-muted)", fontSize: "0.75rem", display: "block" }}>
                      Gamescope
                    </span>
                    <Badge variant={systemStatus?.gamescopeAvailable ? "success" : "default"}>
                      {systemStatus?.gamescopeAvailable ? t("compatibility.available") : t("compatibility.notDetected")}
                    </Badge>
                  </div>

                  <div style={{ padding: "var(--space-sm)", background: "var(--color-surface-hover)", borderRadius: "var(--radius-sm)" }}>
                    <span style={{ color: "var(--color-text-muted)", fontSize: "0.75rem", display: "block" }}>
                      Winetricks
                    </span>
                    <Badge variant={systemStatus?.winetricksAvailable ? "success" : "default"}>
                      {systemStatus?.winetricksAvailable ? t("compatibility.available") : t("compatibility.notDetected")}
                    </Badge>
                  </div>

                  <div style={{ padding: "var(--space-sm)", background: "var(--color-surface-hover)", borderRadius: "var(--radius-sm)" }}>
                    <span style={{ color: "var(--color-text-muted)", fontSize: "0.75rem", display: "block" }}>
                      UMU-Launcher
                    </span>
                    <Badge variant={systemStatus?.umuAvailable ? "success" : "default"}>
                      {systemStatus?.umuAvailable ? t("compatibility.available") : t("compatibility.notDetected")}
                    </Badge>
                  </div>
                </div>
              </div>
            </div>

            {/* Prefix Maintenance Tools */}
            <div className="settings-behavior-card" style={{ marginTop: "var(--space-md)" }}>
              <div className="settings-control">
                <label className="settings-label">{t("compatibility.maintenance")}</label>
                <p className="settings-helper-lead">{t("compatibility.maintenanceDesc")}</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-sm)", marginTop: "var(--space-sm)" }}>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => handleRunTool("kill")}
                    disabled={runningMaintenance}
                  >
                    {t("compatibility.killAllWineProcesses")}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleRunTool("winecfg")}
                    disabled={runningMaintenance}
                  >
                    Winecfg
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleRunTool("winetricks")}
                    disabled={runningMaintenance}
                  >
                    Winetricks
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleRunTool("regedit")}
                    disabled={runningMaintenance}
                  >
                    Regedit
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleRunTool("taskmgr")}
                    disabled={runningMaintenance}
                  >
                    Taskmgr
                  </Button>
                </div>
              </div>
            </div>
          </SettingsSection>
        </div>
      )}
    </div>
  );
}
