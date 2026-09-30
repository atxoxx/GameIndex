import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import {
  Activity,
  AlertTriangle,
  Download as DownloadIcon,
  HardDrive,
  RefreshCw,
  RotateCcw,
  Save,
  Server,
} from "lucide-react";
import { useDownloads } from "../../context/DownloadContext";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import {
  formatBytesShort,
  getStatusClassSuffix,
  getStatusLabel,
  type DownloadDiagnostics,
} from "../../types/download";

function formatEta(seconds: number | null): string {
  if (seconds == null) return "—";
  if (seconds <= 0) return "0s";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="dl-diag-tile">
      <span className="dl-diag-tile-value">{value}</span>
      <span className="dl-diag-tile-label">{label}</span>
    </div>
  );
}

function buildMarkdown(diag: DownloadDiagnostics): string {
  const lines: string[] = [];
  lines.push("# GameIndex — Download Diagnostics");
  lines.push("");
  lines.push(`Generated: ${new Date(diag.generatedAt * 1000).toISOString()}`);
  lines.push("");
  lines.push("## Engine");
  lines.push(`- Total: ${diag.engine.total}`);
  lines.push(`- Active: ${diag.engine.active}`);
  lines.push(`- Paused: ${diag.engine.paused}`);
  lines.push(`- Seeding: ${diag.engine.seeding}`);
  lines.push(`- Completed: ${diag.engine.completed}`);
  lines.push(`- Errored: ${diag.engine.errored}`);
  lines.push(`- Max concurrent: ${diag.engine.maxConcurrent || "unlimited"}`);
  lines.push(`- Scheduler: ${diag.engine.schedulerEnabled ? "on" : "off"}`);
  lines.push(`- Start window: ${diag.engine.windowOpen ? "open" : "closed"}`);
  lines.push("");
  lines.push("## HTTP counters");
  lines.push(`- Retries: ${diag.http.retries}`);
  lines.push(`- Stalls: ${diag.http.stalls}`);
  lines.push(`- Transient errors: ${diag.http.transientErrors}`);
  lines.push(`- Mirror switches: ${diag.http.mirrorSwitches}`);
  lines.push(`- Segment reconnects: ${diag.http.segmentReconnects}`);
  lines.push("");
  lines.push("## Disk");
  for (const disk of diag.disk) {
    lines.push(
      `- ${disk.path} (${disk.mountPoint}): ${disk.free} free / ${disk.total}, temp ${disk.tempBytes}, queued ${disk.queueBytes}`,
    );
  }
  lines.push("");
  lines.push("## Transfers");
  for (const dl of diag.downloads) {
    lines.push(
      `- [${dl.status.kind}] ${dl.name} — ${dl.peers} peers, ${dl.downloadSpeed} B/s${dl.error ? ` — ${dl.error}` : ""}`,
    );
  }
  lines.push("");
  lines.push("## Errors");
  for (const err of diag.errors) {
    lines.push(`- [${err.source}] ${err.message}`);
  }
  return lines.join("\n");
}

/** DownloadsDiagnosticsTab — read-only engine health, disk, counters and log. */
export default function DownloadsDiagnosticsTab() {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { unit } = useSizeUnit();
  const { fetchDiagnostics, resetDiagnostics } = useDownloads();

  const [diag, setDiag] = useState<DownloadDiagnostics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDiag(await fetchDiagnostics());
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [fetchDiagnostics]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleReset = async () => {
    try {
      await resetDiagnostics();
      await refresh();
      showToast(t("diagnostics.countersReset"), "success");
    } catch (err) {
      showToast(t("diagnostics.resetFailed", { error: String(err) }), "error");
    }
  };

  const handleExport = async (format: "json" | "markdown") => {
    if (!diag) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const content =
      format === "json" ? JSON.stringify(diag, null, 2) : buildMarkdown(diag);
    const filename = `gamelib_diagnostics_${stamp}.${format === "json" ? "json" : "md"}`;
    try {
      const filePath = await save({
        title: t("diagnostics.exportTitle"),
        defaultPath: filename,
        filters: [
          {
            name: format === "json" ? "JSON" : "Markdown",
            extensions: [format === "json" ? "json" : "md"],
          },
        ],
      });
      if (!filePath) return;
      await invoke("save_text_file", { filePath, contents: content });
      showToast(t("diagnostics.exported"), "success");
    } catch (err) {
      // Browser fallback (frontend-only dev).
      try {
        const blob = new Blob([content], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        showToast(t("diagnostics.exported"), "success");
      } catch {
        showToast(t("diagnostics.exportFailed", { error: String(err) }), "error");
      }
    }
  };

  if (error && !diag) {
    return (
      <div className="dl-diag-empty">
        <AlertTriangle size={34} aria-hidden="true" />
        <p>{t("diagnostics.unavailable")}</p>
        <span>{error}</span>
        <button type="button" className="dl-diag-action" onClick={() => void refresh()}>
          <RefreshCw size={14} aria-hidden="true" />
          <span>{t("diagnostics.refresh")}</span>
        </button>
      </div>
    );
  }

  return (
    <section className="dl-diag" aria-label={t("diagnostics.title")}>
      <div className="dl-diag-toolbar">
        <div className="dl-diag-toolbar-title">
          <Activity size={16} aria-hidden="true" />
          <span>{t("diagnostics.title")}</span>
          {diag && (
            <span className="dl-diag-stamp">
              {new Date(diag.generatedAt * 1000).toLocaleTimeString()}
            </span>
          )}
        </div>
        <div className="dl-diag-toolbar-actions">
          <button
            type="button"
            className="dl-diag-action"
            onClick={() => void refresh()}
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? "spin" : undefined} aria-hidden="true" />
            <span>{loading ? t("diagnostics.refreshing") : t("diagnostics.refresh")}</span>
          </button>
          <button type="button" className="dl-diag-action" onClick={() => void handleReset()}>
            <RotateCcw size={14} aria-hidden="true" />
            <span>{t("diagnostics.resetCounters")}</span>
          </button>
          <button
            type="button"
            className="dl-diag-action"
            onClick={() => void handleExport("json")}
            disabled={!diag}
          >
            <Save size={14} aria-hidden="true" />
            <span>{t("diagnostics.exportJson")}</span>
          </button>
          <button
            type="button"
            className="dl-diag-action"
            onClick={() => void handleExport("markdown")}
            disabled={!diag}
          >
            <Save size={14} aria-hidden="true" />
            <span>{t("diagnostics.exportMarkdown")}</span>
          </button>
        </div>
      </div>

      {diag && (
        <>
          {/* Engine health */}
          <div className="dl-diag-card">
            <div className="dl-diag-card-head">
              <Server size={15} aria-hidden="true" />
              <span>{t("diagnostics.engineHealth")}</span>
            </div>
            <div className="dl-diag-tiles">
              <StatTile label={t("diagnostics.active")} value={diag.engine.active} />
              <StatTile label={t("diagnostics.paused")} value={diag.engine.paused} />
              <StatTile label={t("diagnostics.seeding")} value={diag.engine.seeding} />
              <StatTile label={t("diagnostics.completed")} value={diag.engine.completed} />
              <StatTile label={t("diagnostics.errored")} value={diag.engine.errored} />
              <StatTile label={t("diagnostics.total")} value={diag.engine.total} />
              <StatTile
                label={t("diagnostics.maxConcurrent")}
                value={diag.engine.maxConcurrent || t("downloads.unlimited")}
              />
              <StatTile
                label={t("diagnostics.scheduler")}
                value={
                  diag.engine.schedulerEnabled
                    ? diag.engine.windowOpen
                      ? t("diagnostics.windowOpen")
                      : t("diagnostics.windowClosed")
                    : t("diagnostics.schedulerOff")
                }
              />
            </div>
          </div>

          {/* HTTP counters */}
          <div className="dl-diag-card">
            <div className="dl-diag-card-head">
              <Activity size={15} aria-hidden="true" />
              <span>{t("diagnostics.httpCounters")}</span>
            </div>
            <div className="dl-diag-tiles">
              <StatTile label={t("diagnostics.retries")} value={diag.http.retries} />
              <StatTile label={t("diagnostics.stalls")} value={diag.http.stalls} />
              <StatTile label={t("diagnostics.transientErrors")} value={diag.http.transientErrors} />
              <StatTile label={t("diagnostics.mirrorSwitches")} value={diag.http.mirrorSwitches} />
              <StatTile label={t("diagnostics.segmentReconnects")} value={diag.http.segmentReconnects} />
            </div>
          </div>

          {/* Disk */}
          <div className="dl-diag-card">
            <div className="dl-diag-card-head">
              <HardDrive size={15} aria-hidden="true" />
              <span>{t("diagnostics.disk")}</span>
            </div>
            {diag.disk.length === 0 ? (
              <div className="dl-diag-none">{t("diagnostics.noDisk")}</div>
            ) : (
              <div className="dl-diag-disk-list">
                {diag.disk.map((disk) => {
                  const used = Math.max(0, disk.total - disk.free);
                  const pct = disk.total > 0 ? Math.min(100, (used / disk.total) * 100) : 0;
                  return (
                    <div className="dl-diag-disk" key={disk.mountPoint + disk.path}>
                      <div className="dl-diag-disk-top">
                        <span className="dl-diag-disk-path" title={disk.path}>
                          {disk.mountPoint || disk.path}
                        </span>
                        <span className="dl-diag-disk-free">
                          {formatBytesShort(disk.free, unit)} {t("diagnostics.free")}
                        </span>
                      </div>
                      <div className="dl-diag-disk-bar">
                        <div className="dl-diag-disk-fill" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="dl-diag-disk-meta">
                        <span>
                          {t("diagnostics.tempBytes")}: {formatBytesShort(disk.tempBytes, unit)}
                        </span>
                        <span>
                          {t("diagnostics.queueBytes")}: {formatBytesShort(disk.queueBytes, unit)}
                        </span>
                        <span>
                          {formatBytesShort(disk.total, unit)} {t("diagnostics.total")}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Transfers */}
          <div className="dl-diag-card">
            <div className="dl-diag-card-head">
              <DownloadIcon size={15} aria-hidden="true" />
              <span>{t("diagnostics.transfers")}</span>
            </div>
            {diag.downloads.length === 0 ? (
              <div className="dl-diag-none">{t("diagnostics.noTransfers")}</div>
            ) : (
              <div className="dl-diag-table-wrap">
                <table className="dl-diag-table">
                  <thead>
                    <tr>
                      <th>{t("downloadStats.colName")}</th>
                      <th>{t("downloadStats.colStatus")}</th>
                      <th>{t("downloadStats.colPeers")}</th>
                      <th>{t("diagnostics.eta")}</th>
                      <th>{t("downloadStats.colSpeed")}</th>
                      <th>{t("diagnostics.errorCol")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diag.downloads.map((dl) => (
                      <tr key={dl.id}>
                        <td className="dl-diag-cell-name" title={dl.name}>
                          {dl.name}
                        </td>
                        <td>
                          <span
                            className={`dl-row-status dl-row-status--${getStatusClassSuffix(dl.status)}`}
                          >
                            {getStatusLabel(dl.status, t)}
                          </span>
                        </td>
                        <td>
                          {dl.peers} / {dl.seen}
                        </td>
                        <td>{formatEta(dl.etaSecs)}</td>
                        <td>{formatBytesShort(dl.downloadSpeed, unit)}/s</td>
                        <td className="dl-diag-cell-error" title={dl.error ?? undefined}>
                          {dl.error ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Error log */}
          <div className="dl-diag-card">
            <div className="dl-diag-card-head">
              <AlertTriangle size={15} aria-hidden="true" />
              <span>{t("diagnostics.errorLog")}</span>
            </div>
            {diag.errors.length === 0 ? (
              <div className="dl-diag-none">{t("diagnostics.noErrors")}</div>
            ) : (
              <div className="dl-diag-log">
                {diag.errors.map((entry, index) => (
                  <div className="dl-diag-log-row" key={`${entry.at}-${index}`}>
                    <span className="dl-diag-log-time">
                      {new Date(entry.at * 1000).toLocaleTimeString()}
                    </span>
                    <span className="dl-diag-log-source">{entry.source}</span>
                    <span className="dl-diag-log-message">{entry.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
