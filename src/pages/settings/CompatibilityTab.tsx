import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import SettingsSection from "./SettingsSection";
import SettingsToggleCard from "./SettingsToggleCard";
import { Card, Button, Badge } from "../../components/ui";
import { CompatibilityIcon } from "./settingsIcons";
import "./CompatibilityTab.css";

interface CompatibilityRunner {
  id: string;
  name: string;
  path: string;
  kind: string;
  version: string | null;
  isProton: boolean;
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

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={fetchRunners}
                    disabled={loadingRunners}
                    title={t("compatibility.rescanRunners")}
                  >
                    {loadingRunners ? t("common.scanning") : t("compatibility.scan")}
                  </Button>
                </div>
              </div>
            </div>

            {/* Detected Runners List */}
            <div className="settings-behavior-card" style={{ marginTop: "var(--space-md)" }}>
              <div className="settings-control">
                <label className="settings-label">
                  {t("compatibility.detectedRunners")} ({runners.length})
                </label>
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)", marginTop: "var(--space-sm)" }}>
                  {runners.length === 0 ? (
                    <p className="settings-helper-lead" style={{ fontStyle: "italic" }}>
                      {t("compatibility.noRunnersDetected")}
                    </p>
                  ) : (
                    runners.map((r) => (
                      <div
                        key={r.path}
                        className={`compat-runner-item ${settings.defaultRunnerPath === r.path ? "is-active" : ""}`}
                      >
                        <div>
                          <strong>{r.name}</strong>{" "}
                          <Badge variant={r.isProton ? "accent" : "default"}>{r.kind.toUpperCase()}</Badge>
                          <div style={{ color: "var(--color-text-muted)", fontSize: "0.75rem", wordBreak: "break-all" }}>
                            {r.path}
                          </div>
                        </div>
                        {settings.defaultRunnerPath === r.path && (
                          <Badge variant="accent">{t("compatibility.activeDefault")}</Badge>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Default Prefix Directory */}
            <div className="settings-behavior-card" style={{ marginTop: "var(--space-md)" }}>
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
          </SettingsSection>
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
