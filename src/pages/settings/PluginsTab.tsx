import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { Button } from "../../components/ui";
import SettingsSection from "./SettingsSection";
import PluginsBulkImportModal, {
  type BulkSkippedFile,
} from "./PluginsBulkImportModal";
import { ListIcon, PluginIcon } from "./settingsIcons";
import type {
  PluginBulkToggleResult,
  PluginCandidate,
  PluginInfo,
} from "../../types/plugins";

/**
 * PluginsTab — manage download-search plugins.
 *
 * A plugin is a `.js` file the user imports from disk. Importing only
 * reads + validates the file (`plugins_import_file`); the result is
 * shown in a trust-gate card (metadata, source URL, SHA-256, and a
 * plain-language warning) before `plugins_install` actually writes and
 * enables it. The installed list supports enable/disable, remove, and
 * surfaces any runtime `lastError` the backend recorded.
 */
export default function PluginsTab() {
  const { t, language } = useLanguage();
  const { showToast } = useToast();

  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // Import flow
  const [scanning, setScanning] = useState(false);
  const [candidate, setCandidate] = useState<PluginCandidate | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [copiedHash, setCopiedHash] = useState(false);

  // Bulk import flow
  const [bulkScanning, setBulkScanning] = useState(false);
  const [bulkCandidates, setBulkCandidates] = useState<PluginCandidate[]>([]);
  const [bulkSkipped, setBulkSkipped] = useState<BulkSkippedFile[]>([]);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);

  // Per-row busy states so toggles/remove don't double-fire.
  const [busyId, setBusyId] = useState<string | null>(null);
  // Busy state for the bulk enable/disable-all header controls.
  const [bulkBusy, setBulkBusy] = useState(false);

  const loadPlugins = useCallback(async () => {
    setLoadingList(true);
    setListError(null);
    try {
      const list = await invoke<PluginInfo[]>("plugins_list");
      if (Array.isArray(list)) setPlugins(list);
    } catch (e) {
      console.error("[PluginsTab] plugins_list failed:", e);
      setListError(String(e));
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    void loadPlugins();
  }, [loadPlugins]);

  const handleImport = async () => {
    try {
      const picked = await open({
        multiple: false,
        directory: false,
        title: t("settings.plugins.importDialogTitle"),
        filters: [{ name: t("settings.plugins.jsFilterName"), extensions: ["js"] }],
      });
      if (!picked || typeof picked !== "string") return;
      setScanning(true);
      setImportError(null);
      const c = await invoke<PluginCandidate>("plugins_import_file", { path: picked });
      setCandidate(c);
    } catch (e) {
      console.error("[PluginsTab] plugins_import_file failed:", e);
      setImportError(String(e));
      setCandidate(null);
    } finally {
      setScanning(false);
    }
  };

  const handleBulkImport = async () => {
    let picked: string | string[] | null;
    try {
      picked = await open({
        multiple: true,
        directory: false,
        title: t("settings.plugins.bulkDialogTitle"),
        filters: [{ name: t("settings.plugins.jsFilterName"), extensions: ["js"] }],
      });
    } catch (e) {
      console.error("[PluginsTab] bulk file picker failed:", e);
      showToast(t("settings.plugins.importError", { error: String(e) }), "error");
      return;
    }
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    if (paths.length === 0) return;

    setBulkScanning(true);
    const candidates: PluginCandidate[] = [];
    const skipped: BulkSkippedFile[] = [];
    for (const path of paths) {
      try {
        const c = await invoke<PluginCandidate>("plugins_import_file", { path });
        candidates.push(c);
      } catch (e) {
        console.error(`[PluginsTab] bulk import ${path} failed:`, e);
        skipped.push({ path, error: String(e) });
      }
    }
    setBulkScanning(false);

    if (candidates.length === 0) {
      showToast(t("settings.plugins.bulkAllFailed"), "error");
      return;
    }
    setBulkCandidates(candidates);
    setBulkSkipped(skipped);
    setBulkModalOpen(true);
  };

  const handleBulkInstalled = (installed: number, failed: number) => {
    setBulkModalOpen(false);
    if (installed > 0) {
      showToast(
        failed > 0
          ? t("settings.plugins.bulkPartialToast", { installed, failed })
          : t("settings.plugins.bulkDoneToast", { count: installed }),
        failed > 0 ? "warning" : "success",
      );
      void loadPlugins();
    }
  };

  const handleCancelImport = () => {
    setCandidate(null);
    setImportError(null);
  };

  const handleInstall = async () => {
    if (!candidate) return;
    setInstalling(true);
    setImportError(null);
    try {
      await invoke("plugins_install", { candidate });
      setCandidate(null);
      setCopiedHash(false);
      showToast(t("settings.plugins.installedToast", { name: candidate.name }), "success");
      await loadPlugins();
    } catch (e) {
      console.error("[PluginsTab] plugins_install failed:", e);
      setImportError(String(e));
    } finally {
      setInstalling(false);
    }
  };

  const handleToggle = async (plugin: PluginInfo) => {
    setBusyId(plugin.id);
    try {
      await invoke("plugins_toggle", { id: plugin.id });
      setPlugins((prev) =>
        prev.map((p) => (p.id === plugin.id ? { ...p, enabled: !p.enabled } : p)),
      );
    } catch (e) {
      console.error("[PluginsTab] plugins_toggle failed:", e);
      showToast(t("settings.plugins.toggleError", { error: String(e) }), "error");
    } finally {
      setBusyId(null);
    }
  };

  const handleBulkToggle = async (enabled: boolean) => {
    setBulkBusy(true);
    try {
      const res = await invoke<PluginBulkToggleResult>("plugins_set_all_enabled", {
        enabled,
      });
      if (res.failed.length > 0) {
        showToast(
          t("settings.plugins.bulkFailedToast", {
            count: res.failed.length,
            error: res.failed.join(", "),
          }),
          "warning",
        );
      } else {
        showToast(
          enabled
            ? t("settings.plugins.enabledAllToast")
            : t("settings.plugins.disabledAllToast"),
          "success",
        );
      }
      await loadPlugins();
    } catch (e) {
      console.error("[PluginsTab] plugins_set_all_enabled failed:", e);
      showToast(t("settings.plugins.bulkToggleError", { error: String(e) }), "error");
    } finally {
      setBulkBusy(false);
    }
  };

  const handleRemove = async (plugin: PluginInfo) => {
    setBusyId(plugin.id);
    try {
      await invoke("plugins_remove", { id: plugin.id });
      setPlugins((prev) => prev.filter((p) => p.id !== plugin.id));
      showToast(t("settings.plugins.removedToast", { name: plugin.name }), "success");
    } catch (e) {
      console.error("[PluginsTab] plugins_remove failed:", e);
      showToast(t("settings.plugins.removeError", { error: String(e) }), "error");
    } finally {
      setBusyId(null);
    }
  };

  const handleCopyHash = async (hash: string) => {
    try {
      await navigator.clipboard.writeText(hash);
      setCopiedHash(true);
      window.setTimeout(() => setCopiedHash(false), 1200);
    } catch {
      // Clipboard unavailable — nothing to show, the hash stays visible.
    }
  };

  const isDuplicate = candidate != null && plugins.some((p) => p.id === candidate.id);
  const hashLabel = (hash: string) =>
    hash.length > 24 ? `${hash.slice(0, 16)}…${hash.slice(-8)}` : hash;

  const importedDate = (unixSeconds: number) => {
    try {
      return new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(
        new Date(unixSeconds * 1000),
      );
    } catch {
      return String(unixSeconds);
    }
  };

  const categoryBadge = (cat?: string) => {
    switch ((cat ?? "").toLowerCase()) {
      case "console":
        return { label: t("settings.plugins.categoryConsole"), cls: "console" };
      case "hybrid":
      case "both":
        return { label: t("settings.plugins.categoryHybrid"), cls: "hybrid" };
      default:
        return { label: t("settings.plugins.categoryPc"), cls: "pc" };
    }
  };

  return (
    <>
      {/* ── Standing download-risk disclaimer (only once a plugin exists) ── */}
      {plugins.length > 0 && (
        <div className="settings-plugins-risk" role="status">
          <span className="settings-plugins-risk-icon" aria-hidden>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </span>
          <div className="settings-plugins-risk-text">
            <h3 className="settings-plugins-risk-title">
              {t("settings.plugins.downloadRiskTitle")}
            </h3>
            <p className="settings-plugins-risk-body">
              {t("settings.plugins.downloadRiskBody")}
            </p>
          </div>
        </div>
      )}

      {/* ── Import + trust gate ─────────────────────────────────────────── */}
      <SettingsSection
        id="plugins-import"
        className="settings-section--plugins"
        icon={<PluginIcon />}
        title={t("settings.section.pluginsImport")}
        desc={t("settings.plugins.importDesc")}
      >
        <div className="settings-card">
          {!candidate ? (
            <>
              <div className="settings-plugins-import-row">
                <div className="settings-plugins-import-buttons">
                  <Button
                    variant="secondary"
                    onClick={handleImport}
                    isLoading={scanning}
                    leftIcon={
                      !scanning ? (
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden
                        >
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="17 8 12 3 7 8" />
                          <line x1="12" y1="3" x2="12" y2="15" />
                        </svg>
                      ) : undefined
                    }
                  >
                    {t("settings.plugins.import")}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={handleBulkImport}
                    isLoading={bulkScanning}
                    leftIcon={
                      !bulkScanning ? (
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden
                        >
                          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                          <circle cx="9" cy="7" r="4" />
                          <line x1="19" y1="8" x2="19" y2="14" />
                          <line x1="22" y1="11" x2="16" y2="11" />
                        </svg>
                      ) : undefined
                    }
                  >
                    {t("settings.plugins.bulkImport")}
                  </Button>
                </div>
                <p className="settings-helper-text">{t("settings.plugins.importHint")}</p>
              </div>
              {importError && (
                <p className="settings-plugins-error" role="alert">
                  {t("settings.plugins.importError", { error: importError })}
                </p>
              )}
            </>
          ) : (
            <div className="settings-plugins-gate" aria-label={candidate.name}>
              <div className="settings-plugins-gate-head">
                <span className="settings-plugins-gate-icon" aria-hidden>
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                </span>
                <div className="settings-plugins-gate-head-text">
                  <h3 className="settings-plugins-gate-title">
                    {t("settings.plugins.warningTitle")}
                  </h3>
                  <p className="settings-plugins-gate-warning">
                    {t("settings.plugins.securityWarning")}
                  </p>
                </div>
              </div>

              <dl className="settings-plugins-gate-meta">
                <div className="settings-plugins-gate-meta-item">
                  <dt>{t("settings.plugins.name")}</dt>
                  <dd>{candidate.name}</dd>
                </div>
                <div className="settings-plugins-gate-meta-item">
                  <dt>{t("settings.plugins.version")}</dt>
                  <dd>{candidate.version || "—"}</dd>
                </div>
                <div className="settings-plugins-gate-meta-item">
                  <dt>{t("settings.plugins.author")}</dt>
                  <dd>{candidate.author || "—"}</dd>
                </div>
                <div className="settings-plugins-gate-meta-item settings-plugins-gate-meta-item--full">
                  <dt>{t("settings.plugins.source")}</dt>
                  <dd className="settings-plugins-source">
                    {candidate.sourceUrl || "—"}
                  </dd>
                </div>
                {candidate.description && (
                  <div className="settings-plugins-gate-meta-item settings-plugins-gate-meta-item--full">
                    <dt>{t("settings.plugins.description")}</dt>
                    <dd>{candidate.description}</dd>
                  </div>
                )}
                <div className="settings-plugins-gate-meta-item settings-plugins-gate-meta-item--full">
                  <dt>{t("settings.plugins.hash")}</dt>
                  <dd>
                    <button
                      type="button"
                      className={`settings-plugins-hash${copiedHash ? " copied" : ""}`}
                      title={candidate.fileHash}
                      onClick={() => void handleCopyHash(candidate.fileHash)}
                    >
                      {copiedHash ? t("settings.plugins.copied") : hashLabel(candidate.fileHash)}
                    </button>
                  </dd>
                </div>
              </dl>

              {isDuplicate && (
                <p className="settings-plugins-gate-note" role="status">
                  {t("settings.plugins.duplicate")}
                </p>
              )}
              {importError && (
                <p className="settings-plugins-error" role="alert">
                  {t("settings.plugins.importError", { error: importError })}
                </p>
              )}

              <div className="settings-plugins-gate-actions">
                <Button variant="ghost" onClick={handleCancelImport} disabled={installing}>
                  {t("common.cancel")}
                </Button>
                <Button
                  variant="primary"
                  onClick={handleInstall}
                  isLoading={installing}
                  leftIcon={
                    !installing ? (
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : undefined
                  }
                >
                  {t("settings.plugins.install")}
                </Button>
              </div>
            </div>
          )}
        </div>
      </SettingsSection>

      {/* ── Installed plugins ───────────────────────────────────────────── */}
      <SettingsSection
        id="plugins-installed"
        className="settings-section--plugins"
        icon={<ListIcon />}
        title={t("settings.section.pluginsInstalled")}
        desc={t("settings.plugins.installedDesc")}
        actions={
          plugins.length > 0 ? (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handleBulkToggle(true)}
                disabled={bulkBusy || plugins.every((p) => p.enabled)}
              >
                {t("settings.plugins.enableAll")}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handleBulkToggle(false)}
                disabled={bulkBusy || plugins.every((p) => !p.enabled)}
              >
                {t("settings.plugins.disableAll")}
              </Button>
            </>
          ) : undefined
        }
      >
        {loadingList ? (
          <div className="settings-plugins-empty">
            <p>{t("settings.plugins.loading")}</p>
          </div>
        ) : listError ? (
          <div className="settings-plugins-empty">
            <p className="settings-plugins-error" role="alert">
              {t("settings.plugins.listError", { error: listError })}
            </p>
            <Button variant="secondary" size="sm" onClick={loadPlugins}>
              {t("settings.plugins.retry")}
            </Button>
          </div>
        ) : plugins.length === 0 ? (
          <div className="settings-plugins-empty">
            <span className="settings-plugins-empty-icon" aria-hidden>
              <PluginIcon />
            </span>
            <p>{t("settings.plugins.empty")}</p>
          </div>
        ) : (
          <div className="settings-plugins-list">
            {plugins.map((plugin) => (
              <div className="settings-plugins-item" key={plugin.id}>
                <div className="settings-plugins-item-info">
                  <div className="settings-plugins-item-title">
                    <span className="settings-plugins-item-name">{plugin.name}</span>
                    {plugin.version && (
                      <span className="settings-plugins-item-version">
                        v{plugin.version}
                      </span>
                    )}
                    <span
                      className={`settings-plugins-item-badge settings-plugins-item-badge--${
                        categoryBadge(plugin.platformCategory).cls
                      }`}
                    >
                      {categoryBadge(plugin.platformCategory).label}
                    </span>
                  </div>
                  <div className="settings-plugins-item-sub">
                    {plugin.author
                      ? `${t("settings.plugins.author")}: ${plugin.author}`
                      : ""}
                    {plugin.author && plugin.importedAt > 0 ? " · " : ""}
                    {plugin.importedAt > 0
                      ? t("settings.plugins.importedOn", {
                          date: importedDate(plugin.importedAt),
                        })
                      : ""}
                  </div>
                  {plugin.lastError && (
                    <p className="settings-plugins-item-error" role="status">
                      {t("settings.plugins.lastError", { error: plugin.lastError })}
                    </p>
                  )}
                </div>
                <div className="settings-plugins-item-actions">
                  <label className="settings-plugins-toggle">
                    <span className="settings-plugins-toggle-switch">
                      <input
                        type="checkbox"
                        checked={plugin.enabled}
                        disabled={busyId === plugin.id}
                        onChange={() => void handleToggle(plugin)}
                      />
                      <span className="settings-plugins-toggle-track" aria-hidden>
                        <span className="settings-plugins-toggle-thumb" />
                      </span>
                    </span>
                    <span
                      className={`settings-plugins-toggle-state${
                        plugin.enabled ? " enabled" : ""
                      }`}
                    >
                      {plugin.enabled
                        ? t("settings.plugins.enabled")
                        : t("settings.plugins.disabled")}
                    </span>
                  </label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleRemove(plugin)}
                    disabled={busyId === plugin.id}
                    leftIcon={
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                      >
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    }
                  >
                    {t("settings.plugins.remove")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>

      {/* ── Bulk import review modal ──────────────────────────────────── */}
      <PluginsBulkImportModal
        open={bulkModalOpen}
        candidates={bulkCandidates}
        skipped={bulkSkipped}
        onClose={() => setBulkModalOpen(false)}
        onInstalled={handleBulkInstalled}
      />
    </>
  );
}
