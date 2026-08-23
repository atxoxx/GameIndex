import { useMemo, useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import type { TorrentDownload, DownloadHistory } from "../../types/download";
import { formatBytesShort, formatBytesPerSecond, formatProgress } from "../../types/download";
import { Button, ConfirmModal } from "../ui";

interface DownloadStatsModalProps {
  open: boolean;
  onClose: () => void;
  downloads: TorrentDownload[];
  /** Persistent history of completed/removed downloads (newest first). */
  history: DownloadHistory[];
  /** Called after the persistent history ledger has been cleared. */
  onResetStats: () => void;
}

type StatsTab = "overview" | "sources" | "records" | "diagnostics";
type ExportFormat = "json" | "csv" | "markdown";

/**
 * A download as shown inside this modal. Live rows come straight from
 * `TorrentDownload`; history rows are mapped via `historyToDownload` and
 * flagged with `isHistory: true` so the diagnostics table can render them
 * display-only (no per-row actions).
 */
type MergedDownload = TorrentDownload & { isHistory?: boolean };

/**
 * Map one persistent-history row onto a `TorrentDownload`-shaped object
 * so the stats pipeline can iterate a single merged list. Live-only fields
 * (speeds, peers, files, ...) get empty defaults — the backend no longer
 * has them for finished/removed downloads.
 */
function historyToDownload(h: DownloadHistory): MergedDownload {
  return {
    id: h.downloadId,
    kind: h.kind,
    name: h.name,
    sourceName: h.sourceName,
    savePath: h.savePath,
    downloaded: h.downloaded,
    totalSize: h.totalSize,
    status: h.status,
    debridCached: h.debridCached ?? undefined,
    autoExtract: h.autoExtract ?? undefined,
    extracted: h.extracted ?? undefined,
    addedAt: h.addedAt,
    completedAt: h.completedAt ?? undefined,
    peakSpeed: h.peakSpeed,
    downloadSpeed: 0,
    uploadSpeed: 0,
    peers: 0,
    seeds: 0,
    files: [],
    sourceUri: "",
    progress: null,
    gameId: null,
    isHistory: true,
  };
}

// ── Icons ──────────────────────────────────────────────────────────────────
const StatsIcon = ({ className = "" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ width: 18, height: 18 }}>
    <line x1="18" y1="20" x2="18" y2="10" />
    <line x1="12" y1="20" x2="12" y2="4" />
    <line x1="6" y1="20" x2="6" y2="14" />
  </svg>
);

const ExportIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ width: 14, height: 14 }}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const CopyIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ width: 14, height: 14 }}>
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ width: 14, height: 14 }}>
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const TorrentIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ width: 14, height: 14 }}>
    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
);

const DirectIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ width: 14, height: 14 }}>
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

const PROTOCOL_LABEL_KEY: Record<string, string> = {
  torrent: "downloadStats.protocolTorrent",
  direct: "downloadStats.protocolDirect",
  debrid: "downloadStats.protocolDebrid",
};

const STATUS_KIND_LABEL_KEY: Record<string, string> = {
  queued: "download.status.queued",
  fetchingMetadata: "download.status.fetchingMetadata",
  downloading: "downloadsFilter.statusActive",
  paused: "downloadsFilter.statusPaused",
  seeding: "downloadRow.badgeSeeding",
  completed: "downloadsFilter.statusCompleted",
  removed: "downloadStats.removedPartial",
  error: "downloadsFilter.statusErrored",
};

const DebridIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ width: 14, height: 14 }}>
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

export default function DownloadStatsModal({ open, onClose, downloads, history, onResetStats }: DownloadStatsModalProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { unit } = useSizeUnit();

  const [activeTab, setActiveTab] = useState<StatsTab>("overview");
  const [exportFormat, setExportFormat] = useState<ExportFormat>("json");
  const [exporting, setExporting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [diagSearch, setDiagSearch] = useState("");
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      // Don't close the stats modal while the reset confirmation is up —
      // the ConfirmModal handles Escape itself.
      if (e.key === "Escape" && !resetConfirmOpen) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, resetConfirmOpen]);

  /**
   * Wipe the persistent download-history ledger. Runs after the user
   * confirms the destructive reset; the backend returns the number of
   * rows removed (unused here — the caller refreshes via `onResetStats`).
   */
  const handleResetStats = async () => {
    setResetting(true);
    try {
      await invoke<number>("download_history_clear");
      showToast(t("downloadStats.resetStatsDone"), "success");
      onResetStats();
    } catch (err) {
      showToast(t("downloadStats.resetStatsFailed", { error: String(err) }), "error");
    } finally {
      setResetting(false);
      setResetConfirmOpen(false);
    }
  };

  // ── Merged dataset (live downloads + persistent history) ─────────────────
  // History rows are mapped to `TorrentDownload`-shaped objects and take
  // precedence over any live row with the same id, so a download that was
  // deleted keeps its recorded stats instead of silently dropping out.
  const mergedDownloads = useMemo<MergedDownload[]>(() => {
    const historyIds = new Set(history.map((h) => h.downloadId));
    const historyRows = history.map(historyToDownload);
    const liveRows = downloads.filter((d) => !historyIds.has(d.id));
    return [...historyRows, ...liveRows];
  }, [downloads, history]);

  // ── Metrics Calculation ──────────────────────────────────────────────────
  const stats = useMemo(() => {
    const total = mergedDownloads.length;
    let completedCount = 0;
    let downloadingCount = 0;
    let seedingCount = 0;
    let queuedCount = 0;
    let pausedCount = 0;
    let removedCount = 0;
    let errorCount = 0;

    let torrentCount = 0;
    let directCount = 0;
    let debridCount = 0;
    let debridCachedCount = 0;

    let totalDownloadedBytes = 0;
    let totalPayloadBytes = 0;
    let totalCurrentDownSpeed = 0;
    let totalCurrentUpSpeed = 0;
    let totalConnectedPeers = 0;
    let totalKnownSeeds = 0;

    let autoExtractCount = 0;
    let extractedCount = 0;

    const sourceMap = new Map<string, { count: number; bytes: number }>();
    const driveMap = new Map<string, { count: number; bytes: number }>();

    // Size buckets
    let tierUnder1GB = 0;
    let tier1to10GB = 0;
    let tier10to40GB = 0;
    let tier40to80GB = 0;
    let tierOver80GB = 0;

    // Time buckets
    const nowSec = Date.now() / 1000;
    let addedLast24h = 0;
    let addedLast7d = 0;
    let addedLast30d = 0;

    let largestItem: TorrentDownload | null = null;
    let fastestItem: TorrentDownload | null = null;

    for (const d of mergedDownloads) {
      const kind = d.status.kind;
      if (kind === "completed") completedCount++;
      else if (kind === "downloading" || kind === "fetchingMetadata") downloadingCount++;
      else if (kind === "seeding") seedingCount++;
      else if (kind === "queued") queuedCount++;
      else if (kind === "paused") pausedCount++;
      else if (kind === "removed") removedCount++;
      else if (kind === "error") errorCount++;

      if (d.kind === "torrent") torrentCount++;
      else if (d.kind === "direct") directCount++;
      else if (d.kind === "debrid") {
        debridCount++;
        if (d.debridCached) debridCachedCount++;
      }

      totalDownloadedBytes += d.downloaded || 0;
      const effectiveSize = d.totalSize ?? d.downloaded ?? 0;
      totalPayloadBytes += effectiveSize;

      totalCurrentDownSpeed += d.downloadSpeed || 0;
      totalCurrentUpSpeed += d.uploadSpeed || 0;
      totalConnectedPeers += d.peers || 0;
      totalKnownSeeds += d.seeds || 0;

      if (d.autoExtract) autoExtractCount++;
      if (d.extracted) extractedCount++;

      // Source tally
      const src = d.sourceName || t("downloadStats.manualLink");
      const srcEntry = sourceMap.get(src) || { count: 0, bytes: 0 };
      srcEntry.count++;
      srcEntry.bytes += effectiveSize;
      sourceMap.set(src, srcEntry);

      // Drive / Path tally (root detection: C:, D:, /home, etc.)
      const pathRoot = d.savePath ? (d.savePath.match(/^([A-Za-z]:|[\\/][^\\/]+)/)?.[0] || d.savePath) : t("downloadStats.defaultPath");
      const driveEntry = driveMap.get(pathRoot) || { count: 0, bytes: 0 };
      driveEntry.count++;
      driveEntry.bytes += effectiveSize;
      driveMap.set(pathRoot, driveEntry);

      // Size tiers
      const bytes = effectiveSize;
      if (bytes < 1024 ** 3) tierUnder1GB++;
      else if (bytes < 10 * 1024 ** 3) tier1to10GB++;
      else if (bytes < 40 * 1024 ** 3) tier10to40GB++;
      else if (bytes < 80 * 1024 ** 3) tier40to80GB++;
      else tierOver80GB++;

      // Added time
      if (d.addedAt) {
        const diffSec = nowSec - d.addedAt;
        if (diffSec <= 86400) addedLast24h++;
        if (diffSec <= 7 * 86400) addedLast7d++;
        if (diffSec <= 30 * 86400) addedLast30d++;
      }

      // Extremes
      if (!largestItem || effectiveSize > (largestItem.totalSize ?? largestItem.downloaded ?? 0)) {
        largestItem = d;
      }
      const dSpeed = d.peakSpeed ?? d.downloadSpeed;
      const fastestSpeed = (fastestItem?.peakSpeed ?? fastestItem?.downloadSpeed) || 0;
      if (!fastestItem || dSpeed > fastestSpeed) {
        fastestItem = d;
      }
    }

    const completionRate = total > 0 ? (completedCount / total) * 100 : 0;
    const avgSize = total > 0 ? totalPayloadBytes / total : 0;
    const activeTorrents = mergedDownloads.filter((d) => d.kind === "torrent" && (d.status.kind === "downloading" || d.status.kind === "seeding"));
    const avgPeers = activeTorrents.length > 0 ? totalConnectedPeers / activeTorrents.length : 0;
    const debridCacheRate = debridCount > 0 ? (debridCachedCount / debridCount) * 100 : 0;

    const sourcesList = Array.from(sourceMap.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.bytes - a.bytes);

    const drivesList = Array.from(driveMap.entries())
      .map(([drive, data]) => ({ drive, ...data }))
      .sort((a, b) => b.bytes - a.bytes);

    // Recent completions
    const recentCompleted = mergedDownloads
      .filter((d) => d.status.kind === "completed")
      .sort((a, b) => (b.completedAt ?? (b.addedAt || 0)) - (a.completedAt ?? (a.addedAt || 0)))
      .slice(0, 5);

    // Largest downloads
    const largestList = [...mergedDownloads]
      .sort((a, b) => (b.totalSize ?? b.downloaded ?? 0) - (a.totalSize ?? a.downloaded ?? 0))
      .slice(0, 5);

    return {
      total,
      completedCount,
      downloadingCount,
      seedingCount,
      queuedCount,
      pausedCount,
      removedCount,
      errorCount,
      torrentCount,
      directCount,
      debridCount,
      debridCachedCount,
      debridCacheRate,
      totalDownloadedBytes,
      totalPayloadBytes,
      totalCurrentDownSpeed,
      totalCurrentUpSpeed,
      totalConnectedPeers,
      totalKnownSeeds,
      autoExtractCount,
      extractedCount,
      completionRate,
      avgSize,
      avgPeers,
      sourcesList,
      drivesList,
      sizeTiers: [
        { label: "< 1 GB", count: tierUnder1GB, color: "var(--color-info)" },
        { label: "1 – 10 GB", count: tier1to10GB, color: "var(--color-success)" },
        { label: "10 – 40 GB", count: tier10to40GB, color: "var(--color-accent)" },
        { label: "40 – 80 GB", count: tier40to80GB, color: "var(--color-warning)" },
        { label: "> 80 GB", count: tierOver80GB, color: "var(--color-danger)" },
      ],
      timeStats: {
        addedLast24h,
        addedLast7d,
        addedLast30d,
      },
      largestItem,
      fastestItem,
      recentCompleted,
      largestList,
    };
  }, [mergedDownloads, t]);

  // ── Search in Diagnostics ────────────────────────────────────────────────
  const filteredDiagnostics = useMemo(() => {
    if (!diagSearch.trim()) return mergedDownloads;
    const q = diagSearch.toLowerCase().trim();
    return mergedDownloads.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        d.sourceName.toLowerCase().includes(q) ||
        d.kind.toLowerCase().includes(q) ||
        d.status.kind.toLowerCase().includes(q),
    );
  }, [mergedDownloads, diagSearch]);

  // ── Build Export Payloads ────────────────────────────────────────────────
  const generateExportContent = (format: ExportFormat): { content: string; filename: string; mime: string } => {
    const timestamp = new Date().toISOString().slice(0, 10);

    if (format === "json") {
      const payload = {
        exportedAt: new Date().toISOString(),
        summary: {
          totalDownloads: stats.total,
          completedCount: stats.completedCount,
          activeCount: stats.downloadingCount,
          seedingCount: stats.seedingCount,
          pausedCount: stats.pausedCount,
          queuedCount: stats.queuedCount,
          errorCount: stats.errorCount,
          completionRatePercent: Number(stats.completionRate.toFixed(1)),
          totalDownloadedBytes: stats.totalDownloadedBytes,
          totalPayloadBytes: stats.totalPayloadBytes,
          currentDownloadSpeedBytesSec: stats.totalCurrentDownSpeed,
          currentUploadSpeedBytesSec: stats.totalCurrentUpSpeed,
          protocols: {
            torrent: stats.torrentCount,
            direct: stats.directCount,
            debrid: stats.debridCount,
            debridCached: stats.debridCachedCount,
            debridCacheRatePercent: Number(stats.debridCacheRate.toFixed(1)),
          },
          sources: stats.sourcesList,
          drives: stats.drivesList,
        },
        downloads: mergedDownloads.map((d) => ({
          id: d.id,
          name: d.name,
          kind: d.kind,
          status: d.status.kind,
          errorMessage: d.status.kind === "error" ? d.status.message : null,
          sourceName: d.sourceName,
          sourceUri: d.sourceUri,
          savePath: d.savePath,
          downloadedBytes: d.downloaded,
          totalSizeBytes: d.totalSize,
          progress: d.progress,
          downloadSpeedBytesSec: d.downloadSpeed,
          uploadSpeedBytesSec: d.uploadSpeed,
          peers: d.peers,
          seeds: d.seeds,
          autoExtract: d.autoExtract ?? false,
          extracted: d.extracted ?? false,
          debridCached: d.debridCached ?? null,
          fromHistory: d.isHistory ?? false,
          addedAt: d.addedAt ? new Date(d.addedAt * 1000).toISOString() : null,
        })),
      };
      return {
        content: JSON.stringify(payload, null, 2),
        filename: `gamelib_download_stats_${timestamp}.json`,
        mime: "application/json",
      };
    }

    if (format === "csv") {
      const headers = [
        "ID",
        "Name",
        "Protocol",
        "Status",
        "Source",
        "Total Size (Bytes)",
        "Downloaded (Bytes)",
        "Progress (%)",
        "Download Speed (B/s)",
        "Upload Speed (B/s)",
        "Peers",
        "Seeds",
        "AutoExtract",
        "Save Path",
        "Date Added",
        "From History",
      ];
      const rows = mergedDownloads.map((d) => {
        const escapeCsv = (str: string | number | null | undefined) => {
          if (str === null || str === undefined) return '""';
          const s = String(str).replace(/"/g, '""');
          return `"${s}"`;
        };
        return [
          escapeCsv(d.id),
          escapeCsv(d.name),
          escapeCsv(d.kind),
          escapeCsv(d.status.kind),
          escapeCsv(d.sourceName),
          escapeCsv(d.totalSize ?? ""),
          escapeCsv(d.downloaded),
          escapeCsv(d.progress !== null && d.progress !== undefined ? `${(d.progress * 100).toFixed(1)}%` : ""),
          escapeCsv(d.downloadSpeed),
          escapeCsv(d.uploadSpeed),
          escapeCsv(d.peers),
          escapeCsv(d.seeds),
          escapeCsv(d.autoExtract ? "Yes" : "No"),
          escapeCsv(d.savePath),
          escapeCsv(d.addedAt ? new Date(d.addedAt * 1000).toISOString() : ""),
          escapeCsv(d.isHistory ? "Yes" : "No"),
        ].join(",");
      });
      return {
        content: [headers.join(","), ...rows].join("\r\n"),
        filename: `gamelib_download_stats_${timestamp}.csv`,
        mime: "text/csv",
      };
    }

    // Markdown summary
    const md = [
      `# 📊 GameIndex Download Statistics Report`,
      `*Generated on ${new Date().toLocaleString()}*`,
      "",
      `## 🚀 Key Performance Indicators`,
      `- **Total Downloads**: ${stats.total}`,
      `- **Total Data Downloaded**: ${formatBytesShort(stats.totalDownloadedBytes, unit)}`,
      `- **Total Catalog Volume**: ${formatBytesShort(stats.totalPayloadBytes, unit)}`,
      `- **Completion Success Rate**: ${stats.completionRate.toFixed(1)}%`,
      `- **Active Downloads**: ${stats.downloadingCount} (${formatBytesPerSecond(stats.totalCurrentDownSpeed, unit)})`,
      `- **Active Seeding**: ${stats.seedingCount} (${formatBytesPerSecond(stats.totalCurrentUpSpeed, unit)})`,
      `- **Swarm Connectivity**: ${stats.totalConnectedPeers} connected peers · ${stats.totalKnownSeeds} known seeds`,
      "",
      `## 🌐 Protocols & Pipelines`,
      `- **BitTorrent**: ${stats.torrentCount} downloads (${((stats.torrentCount / (stats.total || 1)) * 100).toFixed(0)}%)`,
      `- **Direct HTTP**: ${stats.directCount} downloads (${((stats.directCount / (stats.total || 1)) * 100).toFixed(0)}%)`,
      `- **Real-Debrid**: ${stats.debridCount} downloads (Cache Hit Rate: ${stats.debridCacheRate.toFixed(0)}%)`,
      "",
      `## 💾 Top Sources by Volume`,
      ...stats.sourcesList.slice(0, 8).map((s, idx) => `${idx + 1}. **${s.name}**: ${s.count} items (${formatBytesShort(s.bytes, unit)})`),
      "",
      `## 📦 Download Items (${mergedDownloads.length})`,
      "| Name | Protocol | Status | Size | Downloaded | Progress |",
      "| :--- | :--- | :--- | :--- | :--- | :--- |",
      ...mergedDownloads.map(
        (d) =>
          `| ${d.name.replace(/\|/g, "/")} | ${d.kind} | ${d.status.kind} | ${formatBytesShort(d.totalSize ?? 0, unit)} | ${formatBytesShort(d.downloaded, unit)} | ${formatProgress(d.progress)} |`,
      ),
      "",
      `*Report created via GameIndex Engine*`,
    ].join("\n");

    return {
      content: md,
      filename: `gamelib_download_report_${timestamp}.md`,
      mime: "text/markdown",
    };
  };

  // ── Actions: Save File & Copy Clipboard ───────────────────────────────────
  const handleSaveExport = async () => {
    const { content, filename } = generateExportContent(exportFormat);
    setExporting(true);
    try {
      const ext = exportFormat === "json" ? "json" : exportFormat === "csv" ? "csv" : "md";
      const filePath = await save({
        title: t("downloadStats.exportSaveTitle"),
        defaultPath: filename,
        filters: [{ name: `${exportFormat.toUpperCase()} File`, extensions: [ext] }],
      });

      if (filePath) {
        await invoke("save_text_file", { filePath, contents: content });
        showToast(t("downloadStats.exportedSuccess", { format: exportFormat.toUpperCase() }), "success");
      }
    } catch {
      // Browser environment fallback
      try {
        const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        showToast(t("downloadStats.exportedSuccess", { format: exportFormat.toUpperCase() }), "success");
      } catch (e) {
        showToast(t("downloadStats.exportFailed", { error: String(e) }), "error");
      }
    } finally {
      setExporting(false);
    }
  };

  const handleCopyClipboard = async () => {
    const { content } = generateExportContent(exportFormat);
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      showToast(t("downloadStats.copiedToClipboard"), "success");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast(t("common.copyFailed"), "error");
    }
  };

  if (!open) return null;

  return (
    <div className="modal-backdrop dl-stats-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal dl-stats-modal" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="modal-header dl-stats-header">
          <div className="modal-header-icon dl-stats-header-icon">
            <StatsIcon />
          </div>
          <div className="modal-header-text">
            <div className="dl-stats-title-row">
              <h2 className="modal-title">{t("downloadStats.title")}</h2>
              <span className="dl-stats-badge">{t("downloadStats.totalCount", { count: stats.total })}</span>
            </div>
            <p className="modal-subtitle">{t("downloadStats.subtitle")}</p>
          </div>

          <div className="dl-stats-header-actions">
            <Button
              variant="secondary"
              size="sm"
              disabled={history.length === 0 || resetting}
              onClick={() => setResetConfirmOpen(true)}
              title={t("downloadStats.resetStats")}
            >
              {t("downloadStats.resetStats")}
            </Button>
            <button
              type="button"
              className="modal-close"
              onClick={onClose}
              aria-label={t("common.close")}
            >
              ×
            </button>
          </div>
        </div>

        {/* Modal Navigation Tabs */}
        <div className="dl-stats-nav-bar" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "overview"}
            className={`dl-stats-tab-btn${activeTab === "overview" ? " active" : ""}`}
            onClick={() => setActiveTab("overview")}
          >
            <StatsIcon />
            <span>{t("downloadStats.tabOverview")}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "sources"}
            className={`dl-stats-tab-btn${activeTab === "sources" ? " active" : ""}`}
            onClick={() => setActiveTab("sources")}
          >
            <DirectIcon />
            <span>{t("downloadStats.tabSources")}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "records"}
            className={`dl-stats-tab-btn${activeTab === "records" ? " active" : ""}`}
            onClick={() => setActiveTab("records")}
          >
            <DebridIcon />
            <span>{t("downloadStats.tabRecords")}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "diagnostics"}
            className={`dl-stats-tab-btn${activeTab === "diagnostics" ? " active" : ""}`}
            onClick={() => setActiveTab("diagnostics")}
          >
            <TorrentIcon />
            <span>{t("downloadStats.tabDiagnostics")}</span>
            <span className="dl-stats-tab-count">{downloads.length}</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="modal-body dl-stats-body">
          {/* TAB 1: OVERVIEW */}
          {activeTab === "overview" && (
            <div className="dl-stats-tab-content fade-in">
              {history.length > 0 && (
                <p className="dl-stats-history-note">{t("downloadStats.includesDeleted")}</p>
              )}
              {/* 4 Core KPI Tiles */}
              <div className="dl-stats-kpi-grid">
                <div className="dl-stats-kpi-card">
                  <span className="dl-stats-kpi-label">{t("downloadStats.totalDownloaded")}</span>
                  <span className="dl-stats-kpi-value dl-stats-kpi-value--accent">
                    {formatBytesShort(stats.totalDownloadedBytes, unit)}
                  </span>
                  <span className="dl-stats-kpi-sub">
                    {t("downloadStats.totalCatalogSize", { size: formatBytesShort(stats.totalPayloadBytes, unit) })}
                  </span>
                </div>

                <div className="dl-stats-kpi-card">
                  <span className="dl-stats-kpi-label">{t("downloadStats.completionRate")}</span>
                  <span className="dl-stats-kpi-value dl-stats-kpi-value--success">
                    {stats.completionRate.toFixed(0)}%
                  </span>
                  <span className="dl-stats-kpi-sub">
                    {t("downloadStats.completedRatio", { completed: stats.completedCount, total: stats.total })}
                  </span>
                </div>

                <div className="dl-stats-kpi-card">
                  <span className="dl-stats-kpi-label">{t("downloadStats.liveTransfer")}</span>
                  <span className="dl-stats-kpi-value dl-stats-kpi-value--info">
                    {formatBytesPerSecond(stats.totalCurrentDownSpeed, unit)}
                  </span>
                  <span className="dl-stats-kpi-sub">
                    ↑ {formatBytesPerSecond(stats.totalCurrentUpSpeed, unit)} {t("downloadStats.uploadActive")}
                  </span>
                </div>

                <div className="dl-stats-kpi-card">
                  <span className="dl-stats-kpi-label">{t("downloadStats.swarmConnectivity")}</span>
                  <span className="dl-stats-kpi-value">
                    {stats.totalConnectedPeers} <small style={{ fontSize: 13, color: "var(--color-text-muted)" }}>{t("downloadStats.peers")}</small>
                  </span>
                  <span className="dl-stats-kpi-sub">
                    {stats.totalKnownSeeds} {t("downloadStats.knownSeeds")} · {stats.avgPeers.toFixed(1)} {t("downloadStats.avgPerTorrent")}
                  </span>
                </div>
              </div>

              {/* Protocol Breakdown Section */}
              <div className="dl-stats-card">
                <div className="dl-stats-card-header">
                  <h3 className="dl-stats-card-title">{t("downloadStats.protocolBreakdown")}</h3>
                </div>
                <div className="dl-stats-protocol-grid">
                  <div className="dl-stats-protocol-pill">
                    <div className="dl-stats-protocol-icon dl-stats-protocol-icon--torrent">
                      <TorrentIcon />
                    </div>
                    <div className="dl-stats-protocol-info">
                      <span className="dl-stats-protocol-title">BitTorrent</span>
                      <span className="dl-stats-protocol-count">
                        {stats.torrentCount} {t("downloadStats.items")} (
                        {((stats.torrentCount / (stats.total || 1)) * 100).toFixed(0)}%)
                      </span>
                    </div>
                  </div>

                  <div className="dl-stats-protocol-pill">
                    <div className="dl-stats-protocol-icon dl-stats-protocol-icon--direct">
                      <DirectIcon />
                    </div>
                    <div className="dl-stats-protocol-info">
                      <span className="dl-stats-protocol-title">Direct HTTP</span>
                      <span className="dl-stats-protocol-count">
                        {stats.directCount} {t("downloadStats.items")} (
                        {((stats.directCount / (stats.total || 1)) * 100).toFixed(0)}%)
                      </span>
                    </div>
                  </div>

                  <div className="dl-stats-protocol-pill">
                    <div className="dl-stats-protocol-icon dl-stats-protocol-icon--debrid">
                      <DebridIcon />
                    </div>
                    <div className="dl-stats-protocol-info">
                      <span className="dl-stats-protocol-title">Real-Debrid</span>
                      <span className="dl-stats-protocol-count">
                        {stats.debridCount} {t("downloadStats.items")} · {stats.debridCacheRate.toFixed(0)}% {t("downloadStats.cached")}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Status Breakdown Horizontal Stacked Bar */}
              <div className="dl-stats-card">
                <div className="dl-stats-card-header">
                  <h3 className="dl-stats-card-title">{t("downloadStats.statusDistribution")}</h3>
                </div>

                <div className="dl-stats-status-bar">
                  {stats.completedCount > 0 && (
                    <div
                      className="dl-stats-status-seg dl-stats-status-seg--completed"
                      style={{ flex: stats.completedCount }}
                      title={`${t("downloadsFilter.statusCompleted")}: ${stats.completedCount}`}
                    />
                  )}
                  {stats.downloadingCount > 0 && (
                    <div
                      className="dl-stats-status-seg dl-stats-status-seg--downloading"
                      style={{ flex: stats.downloadingCount }}
                      title={`${t("downloadsFilter.statusActive")}: ${stats.downloadingCount}`}
                    />
                  )}
                  {stats.seedingCount > 0 && (
                    <div
                      className="dl-stats-status-seg dl-stats-status-seg--seeding"
                      style={{ flex: stats.seedingCount }}
                      title={`${t("downloadRow.badgeSeeding")}: ${stats.seedingCount}`}
                    />
                  )}
                  {stats.pausedCount > 0 && (
                    <div
                      className="dl-stats-status-seg dl-stats-status-seg--paused"
                      style={{ flex: stats.pausedCount }}
                      title={`${t("downloadsFilter.statusPaused")}: ${stats.pausedCount}`}
                    />
                  )}
                  {stats.queuedCount > 0 && (
                    <div
                      className="dl-stats-status-seg dl-stats-status-seg--queued"
                      style={{ flex: stats.queuedCount }}
                      title={`${t("download.status.queued")}: ${stats.queuedCount}`}
                    />
                  )}
                  {stats.removedCount > 0 && (
                    <div
                      className="dl-stats-status-seg dl-stats-status-seg--removed"
                      style={{ flex: stats.removedCount }}
                      title={`${t("downloadStats.removedPartial")}: ${stats.removedCount}`}
                    />
                  )}
                  {stats.errorCount > 0 && (
                    <div
                      className="dl-stats-status-seg dl-stats-status-seg--error"
                      style={{ flex: stats.errorCount }}
                      title={`${t("downloadsFilter.statusErrored")}: ${stats.errorCount}`}
                    />
                  )}
                </div>

                <div className="dl-stats-legend-wrap">
                  <div className="dl-stats-legend-chip">
                    <span className="dl-stats-dot dl-stats-dot--completed" />
                    <span>{t("downloadsFilter.statusCompleted")}: {stats.completedCount}</span>
                  </div>
                  <div className="dl-stats-legend-chip">
                    <span className="dl-stats-dot dl-stats-dot--downloading" />
                    <span>{t("downloadsFilter.statusActive")}: {stats.downloadingCount}</span>
                  </div>
                  <div className="dl-stats-legend-chip">
                    <span className="dl-stats-dot dl-stats-dot--seeding" />
                    <span>{t("downloadRow.badgeSeeding")}: {stats.seedingCount}</span>
                  </div>
                  <div className="dl-stats-legend-chip">
                    <span className="dl-stats-dot dl-stats-dot--paused" />
                    <span>{t("downloadsFilter.statusPaused")}: {stats.pausedCount}</span>
                  </div>
                  <div className="dl-stats-legend-chip">
                    <span className="dl-stats-dot dl-stats-dot--queued" />
                    <span>{t("download.status.queued")}: {stats.queuedCount}</span>
                  </div>
                  {stats.removedCount > 0 && (
                    <div className="dl-stats-legend-chip">
                      <span className="dl-stats-dot dl-stats-dot--removed" />
                      <span>{t("downloadStats.removedPartial")}: {stats.removedCount}</span>
                    </div>
                  )}
                  {stats.errorCount > 0 && (
                    <div className="dl-stats-legend-chip">
                      <span className="dl-stats-dot dl-stats-dot--error" />
                      <span>{t("downloadsFilter.statusErrored")}: {stats.errorCount}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: SOURCES & STORAGE */}
          {activeTab === "sources" && (
            <div className="dl-stats-tab-content fade-in">
              <div className="dl-stats-two-col">
                {/* Sources Distribution */}
                <div className="dl-stats-card">
                  <div className="dl-stats-card-header">
                    <h3 className="dl-stats-card-title">{t("downloadStats.sourcesDistribution")}</h3>
                    <span className="dl-stats-card-badge">{t("downloadStats.sourcesCount", { count: stats.sourcesList.length })}</span>
                  </div>

                  <div className="dl-stats-bars-list">
                    {stats.sourcesList.length === 0 ? (
                      <p className="dl-stats-empty-text">{t("downloadStats.noSourcesYet")}</p>
                    ) : (
                      stats.sourcesList.slice(0, 7).map((src) => {
                        const pct = stats.totalPayloadBytes > 0 ? (src.bytes / stats.totalPayloadBytes) * 100 : 0;
                        return (
                          <div key={src.name} className="dl-stats-bar-item">
                            <div className="dl-stats-bar-meta">
                              <span className="dl-stats-bar-title" title={src.name}>{src.name}</span>
                              <span className="dl-stats-bar-val">
                                {formatBytesShort(src.bytes, unit)} ({src.count})
                              </span>
                            </div>
                            <div className="dl-stats-bar-track">
                              <div className="dl-stats-bar-fill" style={{ width: `${Math.max(pct, 4)}%` }} />
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Size Distribution Tiers */}
                <div className="dl-stats-card">
                  <div className="dl-stats-card-header">
                    <h3 className="dl-stats-card-title">{t("downloadStats.sizeTiers")}</h3>
                    <span className="dl-stats-card-badge">{t("downloadStats.avgLabel", { size: formatBytesShort(stats.avgSize, unit) })}</span>
                  </div>

                  <div className="dl-stats-bars-list">
                    {stats.sizeTiers.map((tier) => {
                      const pct = stats.total > 0 ? (tier.count / stats.total) * 100 : 0;
                      return (
                        <div key={tier.label} className="dl-stats-bar-item">
                          <div className="dl-stats-bar-meta">
                            <span className="dl-stats-bar-title">{tier.label}</span>
                            <span className="dl-stats-bar-val">
                              {tier.count} {t("downloadStats.items")} ({pct.toFixed(0)}%)
                            </span>
                          </div>
                          <div className="dl-stats-bar-track">
                            <div
                              className="dl-stats-bar-fill"
                              style={{ width: `${Math.max(pct, tier.count > 0 ? 4 : 0)}%`, background: tier.color }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Drives & Extraction Efficiency */}
              <div className="dl-stats-two-col" style={{ marginTop: "var(--space-md)" }}>
                <div className="dl-stats-card">
                  <div className="dl-stats-card-header">
                    <h3 className="dl-stats-card-title">{t("downloadStats.storageLocations")}</h3>
                  </div>
                  <div className="dl-stats-bars-list">
                    {stats.drivesList.map((d) => (
                      <div key={d.drive} className="dl-stats-bar-item">
                        <div className="dl-stats-bar-meta">
                          <span className="dl-stats-bar-title">{d.drive}</span>
                          <span className="dl-stats-bar-val">
                            {formatBytesShort(d.bytes, unit)} ({d.count} {t("downloadStats.items")})
                          </span>
                        </div>
                        <div className="dl-stats-bar-track">
                          <div
                            className="dl-stats-bar-fill"
                            style={{
                              width: `${Math.max((d.bytes / (stats.totalPayloadBytes || 1)) * 100, 4)}%`,
                              background: "var(--color-accent)",
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="dl-stats-card">
                  <div className="dl-stats-card-header">
                    <h3 className="dl-stats-card-title">{t("downloadStats.archiveExtraction")}</h3>
                  </div>
                  <div className="dl-stats-extraction-stats">
                    <div className="dl-stats-extraction-tile">
                      <span className="dl-stats-extraction-num">{stats.autoExtractCount}</span>
                      <span className="dl-stats-extraction-desc">{t("downloadStats.autoExtractEnabled")}</span>
                    </div>
                    <div className="dl-stats-extraction-tile">
                      <span className="dl-stats-extraction-num">{stats.extractedCount}</span>
                      <span className="dl-stats-extraction-desc">{t("downloadStats.extractedSuccess")}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: RECORDS & HALL OF FAME */}
          {activeTab === "records" && (
            <div className="dl-stats-tab-content fade-in">
              {/* Activity Timeline Badges */}
              <div className="dl-stats-card">
                <div className="dl-stats-card-header">
                  <h3 className="dl-stats-card-title">{t("downloadStats.activityTimeline")}</h3>
                </div>
                <div className="dl-stats-timeline-row">
                  <div className="dl-stats-timeline-stat">
                    <span className="dl-stats-timeline-count">{stats.timeStats.addedLast24h}</span>
                    <span className="dl-stats-timeline-label">{t("downloadStats.last24h")}</span>
                  </div>
                  <div className="dl-stats-timeline-stat">
                    <span className="dl-stats-timeline-count">{stats.timeStats.addedLast7d}</span>
                    <span className="dl-stats-timeline-label">{t("downloadStats.last7Days")}</span>
                  </div>
                  <div className="dl-stats-timeline-stat">
                    <span className="dl-stats-timeline-count">{stats.timeStats.addedLast30d}</span>
                    <span className="dl-stats-timeline-label">{t("downloadStats.last30Days")}</span>
                  </div>
                </div>
              </div>

              <div className="dl-stats-two-col" style={{ marginTop: "var(--space-md)" }}>
                {/* Largest Downloads */}
                <div className="dl-stats-card">
                  <div className="dl-stats-card-header">
                    <h3 className="dl-stats-card-title">{t("downloadStats.largestDownloads")}</h3>
                  </div>
                  <div className="dl-stats-mini-table">
                    {stats.largestList.map((item, idx) => (
                      <div key={item.id} className="dl-stats-mini-row">
                        <span className="dl-stats-rank-badge">#{idx + 1}</span>
                        <div className="dl-stats-mini-meta">
                          <span className="dl-stats-mini-name" title={item.name}>{item.name}</span>
                          <span className="dl-stats-mini-sub">{item.sourceName}</span>
                        </div>
                        <span className="dl-stats-mini-value">
                          {formatBytesShort(item.totalSize ?? item.downloaded, unit)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Recent Completed */}
                <div className="dl-stats-card">
                  <div className="dl-stats-card-header">
                    <h3 className="dl-stats-card-title">{t("downloadStats.recentCompletions")}</h3>
                  </div>
                  <div className="dl-stats-mini-table">
                    {stats.recentCompleted.length === 0 ? (
                      <p className="dl-stats-empty-text">{t("downloadStats.noCompletedYet")}</p>
                    ) : (
                      stats.recentCompleted.map((item) => (
                        <div key={item.id} className="dl-stats-mini-row">
                          <span className="dl-stats-status-tag dl-stats-status-tag--completed">
                            {t("downloadsFilter.statusCompleted")}
                          </span>
                          <div className="dl-stats-mini-meta">
                            <span className="dl-stats-mini-name" title={item.name}>{item.name}</span>
                            <span className="dl-stats-mini-sub">{item.sourceName}</span>
                          </div>
                          <span className="dl-stats-mini-value">
                            {formatBytesShort(item.totalSize ?? item.downloaded, unit)}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: DIAGNOSTICS */}
          {activeTab === "diagnostics" && (
            <div className="dl-stats-tab-content fade-in">
              <div className="dl-stats-diag-header">
                <div className="dl-stats-search-wrap">
                  <input
                    type="text"
                    className="dl-stats-search-input"
                    placeholder={t("downloadStats.searchDiagnostics")}
                    value={diagSearch}
                    onChange={(e) => setDiagSearch(e.target.value)}
                  />
                  {diagSearch && (
                    <button
                      type="button"
                      className="dl-stats-search-clear"
                      onClick={() => setDiagSearch("")}
                    >
                      ×
                    </button>
                  )}
                </div>
                <span className="dl-stats-diag-count">
                  {filteredDiagnostics.length} / {downloads.length} {t("downloadStats.items")}
                </span>
              </div>

              <div className="dl-stats-table-wrapper">
                <table className="dl-stats-table">
                  <thead>
                    <tr>
                      <th>{t("downloadStats.colName")}</th>
                      <th>{t("downloadStats.colProtocol")}</th>
                      <th>{t("downloadStats.colStatus")}</th>
                      <th>{t("downloadStats.colSize")}</th>
                      <th>{t("downloadStats.colProgress")}</th>
                      <th>{t("downloadStats.colSpeed")}</th>
                      <th>{t("downloadStats.colPeers")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDiagnostics.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="dl-stats-table-empty">
                          {t("downloadStats.noMatches")}
                        </td>
                      </tr>
                    ) : (
                      filteredDiagnostics.map((d) => (
                        <tr key={d.id} className={d.isHistory ? "dl-stats-table-row--history" : undefined}>
                          <td className="dl-stats-cell-name" title={d.name}>
                            <span className="dl-stats-tbl-name-row">
                              <span className="dl-stats-tbl-name">{d.name}</span>
                              {d.isHistory && (
                                <span className="dl-stats-tbl-history-tag">{t("downloadStats.historyTag")}</span>
                              )}
                            </span>
                            <span className="dl-stats-tbl-source">{d.sourceName}</span>
                          </td>
                          <td>
                            <span className={`dl-stats-chip dl-stats-chip--${d.kind}`}>
                              {t(PROTOCOL_LABEL_KEY[d.kind] ?? d.kind)}
                            </span>
                          </td>
                          <td>
                            <span className={`dl-stats-status-pill dl-stats-status-pill--${d.status.kind}`}>
                              {t(STATUS_KIND_LABEL_KEY[d.status.kind] ?? d.status.kind)}
                            </span>
                          </td>
                          <td>{formatBytesShort(d.totalSize ?? d.downloaded, unit)}</td>
                          <td>{formatProgress(d.progress)}</td>
                          <td>{formatBytesPerSecond(d.downloadSpeed, unit)}</td>
                          <td>{d.kind === "torrent" ? `${d.peers} / ${d.seeds}` : "—"}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer & Export Bar */}
        <div className="modal-footer dl-stats-footer">
          <div className="dl-stats-export-controls">
            <span className="dl-stats-export-label">{t("downloadStats.exportAs")}:</span>
            <div className="dl-stats-format-seg">
              <button
                type="button"
                className={`dl-stats-format-btn${exportFormat === "json" ? " active" : ""}`}
                onClick={() => setExportFormat("json")}
              >
                JSON
              </button>
              <button
                type="button"
                className={`dl-stats-format-btn${exportFormat === "csv" ? " active" : ""}`}
                onClick={() => setExportFormat("csv")}
              >
                CSV
              </button>
              <button
                type="button"
                className={`dl-stats-format-btn${exportFormat === "markdown" ? " active" : ""}`}
                onClick={() => setExportFormat("markdown")}
              >
                Markdown
              </button>
            </div>

            <Button
              variant="secondary"
              size="sm"
              onClick={handleCopyClipboard}
              leftIcon={copied ? <CheckIcon /> : <CopyIcon />}
              title={t("downloadStats.copyTooltip")}
            >
              {copied ? t("common.copiedToClipboard", { label: exportFormat.toUpperCase() }) : t("downloadStats.copySummary")}
            </Button>

            <Button
              variant="primary"
              size="sm"
              onClick={handleSaveExport}
              isLoading={exporting}
              leftIcon={<ExportIcon />}
              title={t("downloadStats.saveTooltip")}
            >
              {t("downloadStats.exportButton")}
            </Button>
          </div>

          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("common.close")}
          </Button>
        </div>
      </div>

      {/* Reset stats confirmation (destructive) */}
      <ConfirmModal
        open={resetConfirmOpen}
        title={t("downloadStats.resetStatsConfirmTitle")}
        message={t("downloadStats.resetStatsConfirmBody")}
        confirmLabel={t("common.reset")}
        busy={resetting}
        onConfirm={handleResetStats}
        onCancel={() => {
          if (!resetting) {
            setResetConfirmOpen(false);
          }
        }}
      />
    </div>
  );
}
