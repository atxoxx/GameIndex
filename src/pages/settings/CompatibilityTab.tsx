import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import SettingsSection from "./SettingsSection";
import SettingsToggleCard from "./SettingsToggleCard";
import { Card, Button, Badge } from "../../components/ui";
import { CompatibilityIcon } from "./settingsIcons";

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

interface CompatibilitySettings {
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
};

export default function CompatibilityTab() {
  const { t } = useLanguage();
  const { showToast } = useToast();

  const [settings, setSettings] = useState<CompatibilitySettings>(DEFAULT_SETTINGS);
  const [runners, setRunners] = useState<CompatibilityRunner[]>([]);
  const [systemStatus, setSystemStatus] = useState<LinuxSystemStatus | null>(null);
  const [loadingRunners, setLoadingRunners] = useState(false);
  const [killingProcesses, setKillingProcesses] = useState(false);

  // New env var inputs
  const [newEnvKey, setNewEnvKey] = useState("");
  const [newEnvVal, setNewEnvVal] = useState("");

  // New DLL override inputs
  const [newDllName, setNewDllName] = useState("");
  const [newDllMode, setNewDllMode] = useState("n,b");

  // Load initial settings and data
  useEffect(() => {
    invoke<CompatibilitySettings>("get_compatibility_settings")
      .then((s) => setSettings(s))
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
    async (updater: (prev: CompatibilitySettings) => CompatibilitySettings) => {
      setSettings((prev) => {
        const next = updater(prev);
        invoke("set_compatibility_settings", { settings: next }).catch((err) => {
          showToast(t("compatibility.saveFailed", { error: String(err) }), "error");
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

  const handleKillWine = async () => {
    setKillingProcesses(true);
    try {
      await invoke("run_wine_tool", {
        runnerPath: settings.defaultRunnerPath || null,
        prefixPath: null,
        gameId: null,
        tool: "kill",
        args: null,
      });
      showToast(t("compatibility.wineProcessesKilled"), "success");
    } catch (err) {
      showToast(t("compatibility.killWineFailed", { error: String(err) }), "error");
    } finally {
      setKillingProcesses(false);
    }
  };

  return (
    <div className="settings-compatibility-tab">
      {/* ── Section 1: Runners & Prefix ────────────────────────────────────── */}
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
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "var(--space-sm) var(--space-md)",
                      background: "var(--color-surface-hover)",
                      borderRadius: "var(--radius-md)",
                      fontSize: "0.85rem",
                    }}
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

      {/* ── Section 2: Graphics & Direct3D ─────────────────────────────────── */}
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
            title={t("compatibility.enableEsync")}
            desc={t("compatibility.enableEsyncDesc")}
            checked={settings.enableEsync}
            onChange={(v) => updateSettings((prev) => ({ ...prev, enableEsync: v }))}
          />

          <SettingsToggleCard
            title={t("compatibility.enableFsync")}
            desc={t("compatibility.enableFsyncDesc")}
            checked={settings.enableFsync}
            onChange={(v) => updateSettings((prev) => ({ ...prev, enableFsync: v }))}
          />

          <SettingsToggleCard
            title={t("compatibility.enableDxvkNvapi")}
            desc={t("compatibility.enableDxvkNvapiDesc")}
            checked={settings.enableDxvkNvapi}
            onChange={(v) => updateSettings((prev) => ({ ...prev, enableDxvkNvapi: v }))}
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
        </div>
      </SettingsSection>

      {/* ── Section 3: Gaming Tools & Overlays ─────────────────────────────── */}
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
            title={t("compatibility.enableGamescope")}
            desc={t("compatibility.enableGamescopeDesc")}
            checked={settings.enableGamescope}
            onChange={(v) => updateSettings((prev) => ({ ...prev, enableGamescope: v }))}
          />

          <SettingsToggleCard
            title={t("compatibility.primeRenderOffload")}
            desc={t("compatibility.primeRenderOffloadDesc")}
            checked={settings.primeRenderOffload}
            onChange={(v) => updateSettings((prev) => ({ ...prev, primeRenderOffload: v }))}
          />

          {/* Gamescope Arguments */}
          <div className="settings-behavior-card" style={{ gridColumn: "1 / -1" }}>
            <div className="settings-control">
              <label className="settings-label" htmlFor="compat-gamescope-args">
                {t("compatibility.gamescopeArgs")}
              </label>
              <p className="settings-helper-lead">{t("compatibility.gamescopeArgsDesc")}</p>
              <input
                id="compat-gamescope-args"
                type="text"
                className="settings-input"
                style={{ marginTop: "var(--space-xs)" }}
                placeholder="-w 1920 -h 1080 -F fsr -f"
                value={settings.gamescopeArgs || ""}
                onChange={(e) => {
                  const val = e.target.value || null;
                  updateSettings((prev) => ({ ...prev, gamescopeArgs: val }));
                }}
              />
            </div>
          </div>
        </div>
      </SettingsSection>

      {/* ── Section 4: Environment & DLL Overrides ─────────────────────────── */}
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

            {/* List */}
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)", marginTop: "var(--space-md)" }}>
              {Object.entries(settings.customEnvironmentVariables).map(([k, v]) => (
                <div
                  key={k}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "var(--space-xs) var(--space-md)",
                    background: "var(--color-surface-hover)",
                    borderRadius: "var(--radius-sm)",
                    fontSize: "0.85rem",
                  }}
                >
                  <div>
                    <code>{k}</code> = <code>{v}</code>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => handleRemoveEnvVar(k)}>
                    {t("common.delete")}
                  </Button>
                </div>
              ))}
            </div>

            {/* Add row */}
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

            {/* List */}
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)", marginTop: "var(--space-md)" }}>
              {Object.entries(settings.customDllOverrides).map(([name, mode]) => (
                <div
                  key={name}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "var(--space-xs) var(--space-md)",
                    background: "var(--color-surface-hover)",
                    borderRadius: "var(--radius-sm)",
                    fontSize: "0.85rem",
                  }}
                >
                  <div>
                    <code>{name}.dll</code> ({mode})
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => handleRemoveDllOverride(name)}>
                    {t("common.delete")}
                  </Button>
                </div>
              ))}
            </div>

            {/* Add row */}
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

      {/* ── Section 5: System Diagnostics & Maintenance ───────────────────── */}
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

        {/* Maintenance Actions */}
        <div className="settings-behavior-card" style={{ marginTop: "var(--space-md)" }}>
          <div className="settings-control">
            <label className="settings-label">{t("compatibility.maintenance")}</label>
            <p className="settings-helper-lead">{t("compatibility.maintenanceDesc")}</p>
            <div style={{ display: "flex", gap: "var(--space-md)", marginTop: "var(--space-sm)" }}>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleKillWine}
                disabled={killingProcesses}
              >
                {killingProcesses ? t("common.working") : t("compatibility.killAllWineProcesses")}
              </Button>
            </div>
          </div>
        </div>
      </SettingsSection>
    </div>
  );
}
