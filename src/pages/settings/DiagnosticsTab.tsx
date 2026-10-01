import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { save } from "@tauri-apps/plugin-dialog";

import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { Button, ConfirmModal } from "../../components/ui";
import type { GpuInfo } from "../../types/game";
import {
  DiagnosticsIcon,
  FolderIcon,
  HardwareIcon,
  RefreshIcon,
} from "./settingsIcons";
import SettingsSection from "./SettingsSection";

interface CrashReportInfo {
  name: string;
  path: string;
  sizeBytes: number;
  modifiedAt: number;
}

interface CrashLogStatus {
  dir: string;
  logPath: string;
  logSizeBytes: number;
  logModifiedAt: number;
  hasLog: boolean;
  reports: CrashReportInfo[];
}

interface SystemInfo {
  cpuName: string;
  ramGb: number;
  gpus: GpuInfo[];
}

/** Display cap so a multi-megabyte rolling log can't stall the render. */
const PREVIEW_LIMIT = 200_000;

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatWhen(seconds: number): string {
  if (!seconds) return "—";
  return new Date(seconds * 1000).toLocaleString();
}

/**
 * DiagnosticsTab — user-facing crash log + system report surface.
 *
 * A crash is persisted twice: to the rolling `crash.log` and to a dated
 * `crash-<date>.txt` report next to the database. This tab lists those
 * reports, previews the selected one, and gives the user Copy / Export /
 * Open-folder / Clear actions so a bug report can include the whole thing.
 * The system report below is copyable even when nothing has crashed.
 */
export default function DiagnosticsTab() {
  const { t } = useLanguage();
  const { showToast } = useToast();

  const [status, setStatus] = useState<CrashLogStatus | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [appVersion, setAppVersion] = useState("");

  // `selected` read inside async refreshes without re-creating them.
  const selectedRef = useRef<string | null>(null);

  const loadContent = useCallback(
    async (which: string | null) => {
      try {
        const text = await invoke<string>("crashlog_read", { name: which });
        setContent(text ?? "");
      } catch (err) {
        setContent("");
        showToast(
          t("settings.diagnostics.readFailed", { error: String(err) }),
          "error",
        );
      }
    },
    [showToast, t],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await invoke<CrashLogStatus>("crashlog_status");
      setStatus(next);
      const prev = selectedRef.current;
      const stillThere = prev
        ? next.reports.some((r) => r.name === prev)
        : true;
      const target = stillThere ? prev : (next.reports[0]?.name ?? null);
      selectedRef.current = target;
      setSelected(target);
      await loadContent(target);
    } catch (err) {
      showToast(
        t("settings.diagnostics.statusFailed", { error: String(err) }),
        "error",
      );
    } finally {
      setLoading(false);
    }
  }, [loadContent, showToast, t]);

  useEffect(() => {
    void refresh();
    invoke<SystemInfo>("get_system_info")
      .then(setSystemInfo)
      .catch(() => {
        /* hardware probe is best-effort */
      });
    getVersion()
      .then(setAppVersion)
      .catch(() => {
        /* version is best-effort */
      });
  }, [refresh]);

  const select = useCallback(
    (name: string | null) => {
      selectedRef.current = name;
      setSelected(name);
      void loadContent(name);
    },
    [loadContent],
  );

  const handleCopy = useCallback(async () => {
    if (!content.trim()) {
      showToast(t("settings.diagnostics.empty"), "error");
      return;
    }
    try {
      await navigator.clipboard.writeText(content);
      showToast(
        t("common.copiedToClipboard", {
          label: t("settings.diagnostics.crashTitle"),
        }),
        "success",
      );
    } catch {
      showToast(t("common.copyFailed"), "error");
    }
  }, [content, showToast, t]);

  const handleExport = useCallback(async () => {
    const defaultName = selected ?? "crash.log";
    try {
      const picked = await save({
        defaultPath: defaultName,
        filters: [
          {
            name: t("settings.diagnostics.exportFilter"),
            extensions: ["txt", "log"],
          },
        ],
      });
      if (!picked || typeof picked !== "string") return;
      await invoke("save_text_file", { filePath: picked, contents: content });
      showToast(t("settings.diagnostics.exported"), "success");
    } catch (err) {
      showToast(
        t("settings.diagnostics.exportFailed", { error: String(err) }),
        "error",
      );
    }
  }, [content, selected, showToast, t]);

  const handleOpenFolder = useCallback(async () => {
    if (!status) return;
    try {
      await invoke("open_folder", { path: status.dir });
    } catch (err) {
      showToast(
        t("settings.diagnostics.openFailed", { error: String(err) }),
        "error",
      );
    }
  }, [status, showToast, t]);

  const handleClear = useCallback(async () => {
    setBusy(true);
    try {
      await invoke("crashlog_clear");
      setConfirmClear(false);
      await refresh();
      showToast(t("settings.diagnostics.cleared"), "success");
    } catch (err) {
      showToast(
        t("settings.diagnostics.clearFailed", { error: String(err) }),
        "error",
      );
    } finally {
      setBusy(false);
    }
  }, [refresh, showToast, t]);

  const handleDeleteReport = useCallback(
    async (name: string) => {
      try {
        await invoke("crashlog_delete_report", { name });
        if (selectedRef.current === name) selectedRef.current = null;
        await refresh();
      } catch (err) {
        showToast(
          t("settings.diagnostics.deleteFailed", { error: String(err) }),
          "error",
        );
      }
    },
    [refresh, showToast, t],
  );

  const systemReport = useMemo(
    () => buildSystemReport(t, appVersion, status, systemInfo),
    [t, appVersion, status, systemInfo],
  );

  const handleCopySystem = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(systemReport);
      showToast(t("settings.diagnostics.systemCopied"), "success");
    } catch {
      showToast(t("common.copyFailed"), "error");
    }
  }, [showToast, systemReport, t]);

  const hasAnything =
    !!status && (status.hasLog || status.reports.length > 0);
  const previewText =
    content.length > PREVIEW_LIMIT ? content.slice(-PREVIEW_LIMIT) : content;

  return (
    <>
      <SettingsSection
        id="diagnostics-crash"
        icon={<DiagnosticsIcon />}
        title={t("settings.diagnostics.crashTitle")}
        desc={t("settings.diagnostics.crashDesc")}
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void refresh()}
            leftIcon={<RefreshIcon />}
            isLoading={loading}
          >
            {t("settings.diagnostics.refresh")}
          </Button>
        }
      >
        <div className="diag-meta">
          <div className="diag-meta-row">
            <span className="diag-meta-label">
              {t("settings.diagnostics.path")}
            </span>
            <code className="diag-meta-value">{status?.dir ?? "—"}</code>
          </div>
          <div className="diag-meta-row">
            <span className="diag-meta-label">
              {t("settings.diagnostics.size")}
            </span>
            <span className="diag-meta-value">
              {formatBytes(status?.logSizeBytes ?? 0)}
            </span>
          </div>
          <div className="diag-meta-row">
            <span className="diag-meta-label">
              {t("settings.diagnostics.lastCrash")}
            </span>
            <span className="diag-meta-value">
              {formatWhen(status?.logModifiedAt ?? 0)}
            </span>
          </div>
        </div>

        <div className="diag-actions">
          <Button variant="secondary" size="sm" onClick={() => void handleCopy()}>
            {t("settings.diagnostics.copy")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void handleExport()}
          >
            {t("settings.diagnostics.export")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void handleOpenFolder()}
            leftIcon={<FolderIcon />}
          >
            {t("settings.diagnostics.openFolder")}
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => setConfirmClear(true)}
            disabled={!hasAnything}
          >
            {t("settings.diagnostics.clear")}
          </Button>
        </div>

        {status && status.reports.length > 0 && (
          <div className="diag-reports">
            <span className="diag-reports-title">
              {t("settings.diagnostics.reports", {
                count: status.reports.length,
              })}
            </span>
            <div className="diag-report-list">
              <button
                type="button"
                className={
                  "diag-report-chip" + (selected === null ? " active" : "")
                }
                onClick={() => select(null)}
              >
                {t("settings.diagnostics.rollingLog")}
              </button>
              {status.reports.map((report) => (
                <span key={report.name} className="diag-report-item">
                  <button
                    type="button"
                    className={
                      "diag-report-chip" +
                      (selected === report.name ? " active" : "")
                    }
                    title={`${formatBytes(report.sizeBytes)} · ${formatWhen(
                      report.modifiedAt,
                    )}`}
                    onClick={() => select(report.name)}
                  >
                    {report.name}
                  </button>
                  <button
                    type="button"
                    className="diag-report-delete"
                    aria-label={t("settings.diagnostics.deleteReport")}
                    title={t("settings.diagnostics.deleteReport")}
                    onClick={() => void handleDeleteReport(report.name)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        {!hasAnything && !loading && (
          <p className="diag-empty">{t("settings.diagnostics.empty")}</p>
        )}

        {hasAnything && (
          <pre className="diag-preview" aria-label={t("settings.diagnostics.preview")}>
            {previewText.trim()
              ? previewText
              : t("settings.diagnostics.emptyReport")}
          </pre>
        )}
      </SettingsSection>

      <SettingsSection
        id="diagnostics-system"
        icon={<HardwareIcon />}
        title={t("settings.diagnostics.systemTitle")}
        desc={t("settings.diagnostics.systemDesc")}
        actions={
          <Button variant="secondary" size="sm" onClick={() => void handleCopySystem()}>
            {t("settings.diagnostics.copySystem")}
          </Button>
        }
      >
        <pre className="diag-preview diag-preview--system">{systemReport}</pre>
      </SettingsSection>

      <ConfirmModal
        open={confirmClear}
        title={t("settings.diagnostics.clearTitle")}
        message={t("settings.diagnostics.clearMessage")}
        confirmLabel={t("settings.diagnostics.clear")}
        busy={busy}
        onConfirm={() => void handleClear()}
        onCancel={() => setConfirmClear(false)}
      />
    </>
  );
}

function buildSystemReport(
  t: (key: string, vars?: Record<string, unknown>) => string,
  appVersion: string,
  status: CrashLogStatus | null,
  info: SystemInfo | null,
): string {
  const lines: string[] = [];
  lines.push("GameIndex — system report");
  lines.push(`${t("settings.diagnostics.generatedAt")}: ${new Date().toISOString()}`);
  lines.push(`${t("settings.diagnostics.version")}: ${appVersion || "—"}`);
  lines.push(`${t("settings.diagnostics.cpu")}: ${info?.cpuName ?? "—"}`);
  lines.push(`${t("settings.diagnostics.ram")}: ${info ? `${info.ramGb} GB` : "—"}`);
  if (info?.gpus.length) {
    info.gpus.forEach((gpu) => {
      const vram =
        gpu.vramMb >= 1024
          ? `${(gpu.vramMb / 1024).toFixed(0)} GB`
          : `${gpu.vramMb} MB`;
      lines.push(`${t("settings.diagnostics.gpu")}: ${gpu.name} (${vram})`);
    });
  } else {
    lines.push(`${t("settings.diagnostics.gpu")}: —`);
  }
  lines.push(`${t("settings.diagnostics.logDir")}: ${status?.dir ?? "—"}`);
  lines.push(`userAgent: ${typeof navigator !== "undefined" ? navigator.userAgent : "—"}`);
  return lines.join("\n");
}
