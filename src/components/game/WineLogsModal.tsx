import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { useGames, useGameById } from "../../context/GameContext";
import { Button, Badge } from "../ui";
import { formatSize, type WineLogResult } from "../../types/game";
import "./WineLogsModal.css";

interface WineLogsModalProps {
  gameId: string;
  gameName: string;
  onClose: () => void;
}

/** Poll interval for live log tailing (ms). */
const LIVE_POLL_MS = 1500;

const VERBOSE_OPTIONS: { value: string; labelKey: string }[] = [
  { value: "-all", labelKey: "compatibility.debugDisabled" },
  { value: "warn+all", labelKey: "compatibility.debugWarnOnly" },
  { value: "fixme-all", labelKey: "compatibility.debugFixmeOnly" },
  { value: "+loaddll", labelKey: "compatibility.debugDllLoads" },
  { value: "all", labelKey: "compatibility.debugAllVerbose" },
];

export function WineLogsModal({ gameId, gameName, onClose }: WineLogsModalProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { updateGame } = useGames();
  const game = useGameById(gameId);

  const [loading, setLoading] = useState(true);
  const [logData, setLogData] = useState<WineLogResult | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [live, setLive] = useState(true);

  const logBodyRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const lastSigRef = useRef<string>("");

  const fetchLogs = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const res = await invoke<WineLogResult>("get_game_wine_logs", { gameId });
        // Only swap state when the file actually changed so the live poll
        // doesn't re-render the whole log body every tick.
        const sig = `${res.sizeBytes}:${res.lastModified ?? 0}`;
        if (sig !== lastSigRef.current) {
          lastSigRef.current = sig;
          setLogData(res);
        }
      } catch (err) {
        if (!silent) {
          showToast(t("wineLogs.fetchError", { error: String(err) }) || `Failed to read logs: ${err}`, "error");
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [gameId, showToast, t]
  );

  // Initial load + live tailing. Polling stops while paused or unmounted.
  useEffect(() => {
    lastSigRef.current = "";
    fetchLogs();
    if (!live) return;
    const id = setInterval(() => fetchLogs(true), LIVE_POLL_MS);
    return () => clearInterval(id);
  }, [gameId, live, fetchLogs]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Split lines and filter
  const lines = useMemo(() => {
    if (!logData?.logContent) return [];
    return logData.logContent.split("\n");
  }, [logData?.logContent]);

  const filteredLines = useMemo(() => {
    if (!searchQuery.trim()) return lines;
    const q = searchQuery.toLowerCase();
    return lines.filter((l) => l.toLowerCase().includes(q));
  }, [lines, searchQuery]);

  // Auto-scroll to bottom only when the user is already at/near the bottom,
  // so live updates never yank the viewport away while they're reading up.
  const handleBodyScroll = () => {
    const el = logBodyRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    stickToBottomRef.current = nearBottom;
  };

  useEffect(() => {
    if (autoScroll && stickToBottomRef.current && logBodyRef.current) {
      logBodyRef.current.scrollTop = logBodyRef.current.scrollHeight;
    }
  }, [filteredLines, autoScroll]);

  const handleAutoScrollToggle = (checked: boolean) => {
    setAutoScroll(checked);
    if (checked) {
      stickToBottomRef.current = true;
      requestAnimationFrame(() => {
        if (logBodyRef.current) {
          logBodyRef.current.scrollTop = logBodyRef.current.scrollHeight;
        }
      });
    }
  };

  const handleVerboseChange = (value: string) => {
    updateGame(gameId, {
      compatibility: {
        ...(game?.compatibility ?? {}),
        wineDebug: value || undefined,
      },
    });
    showToast(t("wineLogs.verboseSaved") || "Verbose level saved — applies on next launch", "success");
  };

  const handleCopyLogs = async () => {
    if (!logData?.logContent) return;
    try {
      await navigator.clipboard.writeText(logData.logContent);
      showToast(t("wineLogs.copiedToast") || "Logs copied to clipboard", "success");
    } catch {
      showToast(t("common.copyFailed") || "Failed to copy to clipboard", "error");
    }
  };

  const handleCopyPath = async () => {
    if (!logData?.logPath) return;
    try {
      await navigator.clipboard.writeText(logData.logPath);
      showToast(t("wineLogs.pathCopiedToast") || "Log file path copied", "success");
    } catch {
      showToast(t("common.copyFailed") || "Failed to copy to clipboard", "error");
    }
  };

  const handleExportLogs = async () => {
    if (!logData?.logContent) return;
    try {
      const sanitizedName = gameName.replace(/[^a-zA-Z0-9_-]/g, "_");
      const defaultPath = `${sanitizedName}_wine_log.txt`;
      const target = await save({
        defaultPath,
        filters: [{ name: "Log file", extensions: ["log", "txt"] }],
      });
      if (!target) return;
      await invoke("save_text_file", { filePath: target, contents: logData.logContent });
      showToast(t("wineLogs.exportedToast") || "Log exported successfully", "success");
    } catch (err) {
      // Fallback to browser blob download if tauri fs is unavailable
      try {
        const blob = new Blob([logData.logContent], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${gameName.replace(/\s+/g, "_")}_wine_log.txt`;
        a.click();
        URL.revokeObjectURL(url);
        showToast(t("wineLogs.exportedToast") || "Log downloaded", "success");
      } catch (fallbackErr) {
        showToast(t("wineLogs.exportError", { error: String(err) }) || `Failed to export: ${err}`, "error");
      }
    }
  };

  const handleClearLogs = async () => {
    setClearing(true);
    try {
      await invoke("clear_game_wine_logs", { gameId });
      showToast(t("wineLogs.clearedToast") || "Log file cleared", "success");
      lastSigRef.current = "";
      await fetchLogs();
    } catch (err) {
      showToast(t("wineLogs.clearError", { error: String(err) }) || `Failed to clear logs: ${err}`, "error");
    } finally {
      setClearing(false);
    }
  };

  const getLineClass = (line: string) => {
    const l = line.toLowerCase();
    if (l.includes("err:") || l.includes("error:") || l.includes("fatal") || l.includes("segfault") || l.includes("crash")) {
      return "wine-log-line--error";
    }
    if (l.includes("warn:") || l.includes("warning:") || l.includes("fixme:")) {
      return "wine-log-line--warning";
    }
    if (l.includes("dxvk:") || l.includes("vkd3d:") || l.includes("gamescope:") || l.includes("mangohud:")) {
      return "wine-log-line--accent";
    }
    if (l.startsWith("===") || l.includes("gameindex compatibility")) {
      return "wine-log-line--header";
    }
    return "";
  };

  const currentVerbose = game?.compatibility?.wineDebug ?? "";
  const hasCustomVerbose = currentVerbose !== "" && !VERBOSE_OPTIONS.some((o) => o.value === currentVerbose);

  return createPortal(
    <div className="modal-backdrop" onMouseDown={onClose} role="presentation">
      <div
        className="modal wine-logs-modal"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wine-logs-title"
      >
        {/* Header */}
        <div className="modal-header wine-logs-header">
          <div className="wine-logs-title-group">
            <div className="wine-logs-title-row">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
              <h2 id="wine-logs-title" className="wine-logs-title">
                {t("wineLogs.title") || "Wine / Proton Compatibility Logs"}
              </h2>
              {logData?.exists ? (
                <Badge variant="success">
                  {logData.sizeBytes > 0 ? formatSize(logData.sizeBytes) : "Empty"}
                </Badge>
              ) : (
                <Badge variant="default">
                  {t("wineLogs.noLogsYet") || "No Logs"}
                </Badge>
              )}
            </div>
            <span className="wine-logs-subtitle">{gameName}</span>
          </div>

          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label={t("common.close") || "Close"}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Toolbar & Metadata */}
        <div className="wine-logs-toolbar">
          <div className="wine-logs-search-wrapper">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              className="wine-logs-search-input"
              placeholder={t("wineLogs.searchPlaceholder") || "Filter log entries (e.g. err, dxvk, crash)..."}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                className="wine-logs-search-clear"
                onClick={() => setSearchQuery("")}
                title="Clear filter"
              >
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>

          <div className="wine-logs-toolbar-actions">
            <button
              type="button"
              className={`wine-logs-live-btn ${live ? "is-live" : ""}`}
              onClick={() => setLive((v) => !v)}
              title={live ? t("wineLogs.pauseLive") || "Pause live updates" : t("wineLogs.resumeLive") || "Resume live updates"}
            >
              <span className="wine-logs-live-dot" />
              <span>{live ? t("wineLogs.live") || "Live" : t("wineLogs.paused") || "Paused"}</span>
            </button>

            <label className="wine-logs-verbose-label">
              <span>{t("wineLogs.verbose") || "Verbose"}</span>
              <select
                className="wine-logs-verbose-select"
                value={currentVerbose}
                onChange={(e) => handleVerboseChange(e.target.value)}
                title={t("wineLogs.verboseDesc") || "Wine log verbosity (WINEDEBUG) for the next launch of this game"}
              >
                <option value="">{t("wineLogs.verboseGlobal") || "Global default (from Settings)"}</option>
                {hasCustomVerbose && <option value={currentVerbose}>{currentVerbose}</option>}
                {VERBOSE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {t(o.labelKey) || o.value}
                  </option>
                ))}
              </select>
            </label>

            <label className="wine-logs-autoscroll-label">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => handleAutoScrollToggle(e.target.checked)}
              />
              <span>{t("wineLogs.autoScroll") || "Auto-scroll"}</span>
            </label>

            <span className="wine-logs-line-count">
              {filteredLines.length} {t("wineLogs.lines") || "lines"}
            </span>
          </div>
        </div>

        {/* File Path Strip */}
        {logData?.logPath && (
          <div className="wine-logs-path-strip">
            <span className="wine-logs-path-label">{t("wineLogs.logFilePath") || "Log Path"}:</span>
            <code className="wine-logs-path-value" title={logData.logPath}>
              {logData.logPath}
            </code>
            <button
              type="button"
              className="wine-logs-copy-path-btn"
              onClick={handleCopyPath}
              title={t("wineLogs.copyPath") || "Copy log file path"}
            >
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            </button>
          </div>
        )}

        {/* Log Viewer Terminal Box */}
        <div className="wine-logs-body" ref={logBodyRef} onScroll={handleBodyScroll}>
          {loading ? (
            <div className="wine-logs-loading">
              <div className="wine-logs-spinner" />
              <span>{t("wineLogs.reading") || "Reading compatibility logs..."}</span>
            </div>
          ) : !logData?.exists || lines.length === 0 ? (
            <div className="wine-logs-empty">
              <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <circle cx="12" cy="14" r="3" />
                <line x1="12" y1="17" x2="12" y2="19" />
              </svg>
              <p className="wine-logs-empty-title">
                {t("wineLogs.noLogsTitle") || "No runner logs found"}
              </p>
              <p className="wine-logs-empty-desc">
                {t("wineLogs.noLogsDesc") || "Start this game with a Wine or Proton runner to generate real-time execution logs."}
              </p>
            </div>
          ) : filteredLines.length === 0 ? (
            <div className="wine-logs-no-matches">
              <span>{t("wineLogs.noMatches") || "No log entries matched your filter."}</span>
            </div>
          ) : (
            <div className="wine-logs-terminal">
              {filteredLines.map((line, idx) => (
                <div key={idx} className={`wine-log-line ${getLineClass(line)}`}>
                  <span className="wine-log-num">{idx + 1}</span>
                  <span className="wine-log-text">{line || " "}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer wine-logs-footer">
          <div className="wine-logs-footer-left">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => fetchLogs()}
              disabled={loading}
              leftIcon={
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
              }
            >
              {t("common.refresh") || "Refresh"}
            </Button>

            <Button
              variant="secondary"
              size="sm"
              onClick={handleCopyLogs}
              disabled={!logData?.logContent}
              leftIcon={
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              }
            >
              {t("common.copy") || "Copy Log"}
            </Button>

            <Button
              variant="secondary"
              size="sm"
              onClick={handleExportLogs}
              disabled={!logData?.logContent}
              leftIcon={
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              }
            >
              {t("wineLogs.export") || "Export..."}
            </Button>

            <Button
              variant="danger"
              size="sm"
              onClick={handleClearLogs}
              disabled={!logData?.exists || clearing}
              leftIcon={
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              }
            >
              {clearing ? (t("wineLogs.clearing") || "Clearing...") : (t("wineLogs.clear") || "Clear")}
            </Button>
          </div>

          <div className="wine-logs-footer-right">
            <Button variant="primary" size="sm" onClick={onClose}>
              {t("common.close") || "Close"}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
