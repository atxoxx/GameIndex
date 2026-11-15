import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { Copy, Download, FileText, Trash2, X } from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { useToast } from "../../../context/ToastContext";
import { useGameById, useGames } from "../../../context/GameContext";
import { useVisibleInterval } from "../../../hooks/useVisibleInterval";
import { Button } from "../../ui";
import type { WineLogResult } from "../../../types/game";
import { copyTextToClipboard } from "../../../utils/clipboard";
import type { EditGameTab } from "../editGameTabs";
import {
  countMatches,
  countSeverities,
  filterLines,
  formatCount,
  formatLogSize,
  formatRelativeTime,
  relativeTimeLabel,
  rowForMatch,
  splitLogLines,
  type SeverityFilter,
} from "./logAnalysis";
import { WineLogsEmptyState } from "./WineLogsEmptyState";
import { WineLogsRail } from "./WineLogsRail";
import { WineLogsSkeleton } from "./WineLogsSkeleton";
import { WineLogsTerminal, type WineLogsTerminalHandle } from "./WineLogsTerminal";
import { WineLogsToolbar } from "./WineLogsToolbar";
import "./WineLogsModal.css";

interface WineLogsModalProps {
  gameId: string;
  gameName: string;
  onClose: () => void;
  /** Jumps into the edit modal on the given tab (the caller closes the logs). */
  onOpenEditTab?: (tab: EditGameTab) => void;
  /** Launch the game with its configured Wine/Proton runner. */
  onLaunch?: () => void;
}

/** Poll interval for live log tailing (ms). */
const LIVE_POLL_MS = 1500;

/**
 * Wine / Proton compatibility-log workbench.
 *
 * Two panes: a rail with the file facts, severity filter, display switches and
 * runner shortcuts; and a searchable terminal with virtualised rows. The
 * container owns IPC, polling and the clipboard/export/clear flows — the
 * children stay presentational so each piece can be tested on its own.
 */
export function WineLogsModal({
  gameId,
  gameName,
  onClose,
  onOpenEditTab,
  onLaunch,
}: WineLogsModalProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { updateGame } = useGames();
  const game = useGameById(gameId);
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const terminalRef = useRef<WineLogsTerminalHandle | null>(null);
  const lastSigRef = useRef<string>("");

  const [loading, setLoading] = useState(true);
  const [logData, setLogData] = useState<WineLogResult | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [wrap, setWrap] = useState(false);
  const [filter, setFilter] = useState<SeverityFilter>("all");
  const [matchCursor, setMatchCursor] = useState(0);
  const [clearing, setClearing] = useState(false);
  const [live, setLive] = useState(true);

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
          showToast(
            t("wineLogs.fetchError", { error: String(err) }) ||
              `Failed to read logs: ${err}`,
            "error"
          );
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [gameId, showToast, t]
  );

  // Initial load + live tailing. Polling stops while paused, unmounted, or
  // while the window is hidden.
  useEffect(() => {
    lastSigRef.current = "";
    void fetchLogs();
  }, [gameId, fetchLogs]);
  useVisibleInterval(() => void fetchLogs(true), LIVE_POLL_MS, live);

  // Focus the dialog on open (not the search field, so Escape closes right
  // away) and hand focus back to whatever opened the viewer on close.
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => {
      previous?.focus?.();
    };
  }, []);

  // Escape closes unless the search field consumed it (see its key handler).
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Ctrl/Cmd+F focuses the log search, matching the terminal convention.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const lines = useMemo(
    () => splitLogLines(logData?.logContent ?? ""),
    [logData?.logContent]
  );
  const counts = useMemo(() => countSeverities(lines), [lines]);
  const rows = useMemo(
    () => filterLines(lines, filter, searchQuery),
    [lines, filter, searchQuery]
  );
  const visibleTexts = useMemo(() => rows.map((row) => row.text), [rows]);
  const matchTotal = useMemo(
    () => countMatches(visibleTexts, searchQuery),
    [visibleTexts, searchQuery]
  );
  const activePosition = useMemo(
    () => rowForMatch(visibleTexts, searchQuery, matchCursor),
    [visibleTexts, searchQuery, matchCursor]
  );
  const activeRowIndex =
    activePosition !== null ? rows[activePosition]?.index ?? null : null;
  const firstErrorPosition = useMemo(
    () => rows.findIndex((row) => row.severity === "error"),
    [rows]
  );

  // A new query or severity always starts at the first match.
  useEffect(() => {
    setMatchCursor(0);
  }, [searchQuery, filter]);

  // Match navigation scrolls only when the focused match actually changes.
  useEffect(() => {
    if (activePosition === null) return;
    terminalRef.current?.jumpToPosition(activePosition);
  }, [activePosition, matchCursor]);

  const stepMatch = useCallback(
    (direction: 1 | -1) => {
      if (matchTotal === 0) return;
      setMatchCursor((cursor) => (cursor + direction + matchTotal) % matchTotal);
    },
    [matchTotal]
  );

  const handleSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      // Clear/blur first; a second Escape reaches the window listener.
      event.stopPropagation();
      if (searchQuery) setSearchQuery("");
      else searchRef.current?.blur();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      stepMatch(event.shiftKey ? -1 : 1);
    }
  };

  const handleAutoScrollToggle = (checked: boolean) => {
    setAutoScroll(checked);
  };

  const handleVerboseChange = (value: string) => {
    updateGame(gameId, {
      compatibility: {
        ...(game?.compatibility ?? {}),
        wineDebug: value || undefined,
      },
    });
    showToast(
      t("wineLogs.verboseSaved") || "Verbose level saved — applies on next launch",
      "success"
    );
  };

  const handleCopyLogs = async () => {
    if (!logData?.logContent) return;
    const copied = await copyTextToClipboard(logData.logContent);
    showToast(
      copied
        ? t("wineLogs.copiedToast") || "Logs copied to clipboard"
        : t("common.copyFailed") || "Failed to copy to clipboard",
      copied ? "success" : "error"
    );
  };

  /** Resolves true when the path reached the clipboard (chip shows state). */
  const handleCopyPath = async (): Promise<boolean> => {
    if (!logData?.logPath) return false;
    const copied = await copyTextToClipboard(logData.logPath);
    showToast(
      copied
        ? t("wineLogs.pathCopiedToast") || "Log file path copied"
        : t("common.copyFailed") || "Failed to copy to clipboard",
      copied ? "success" : "error"
    );
    return copied;
  };

  const handleCopyLineResult = (copied: boolean) => {
    showToast(
      copied
        ? t("wineLogs.lineCopiedToast") || "Line copied to clipboard"
        : t("wineLogs.copyLineFailedToast") || "Failed to copy line",
      copied ? "success" : "error"
    );
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
      } catch {
        showToast(
          t("wineLogs.exportError", { error: String(err) }) ||
            `Failed to export: ${err}`,
          "error"
        );
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
      showToast(
        t("wineLogs.clearError", { error: String(err) }) ||
          `Failed to clear logs: ${err}`,
        "error"
      );
    } finally {
      setClearing(false);
    }
  };

  const resetFilters = () => {
    setSearchQuery("");
    setFilter("all");
  };

  const currentVerbose = game?.compatibility?.wineDebug ?? "";
  const hasLog = counts.all > 0;
  const sizeLabel = logData?.exists ? formatLogSize(logData.sizeBytes) : null;
  const updatedRelative = logData?.lastModified
    ? relativeTimeLabel(formatRelativeTime(logData.lastModified, Date.now()))
    : null;
  const updatedText = updatedRelative
    ? t(updatedRelative.key, updatedRelative.vars) || updatedRelative.key
    : null;

  return createPortal(
    <div className="modal-backdrop" onMouseDown={onClose} role="presentation">
      <div
        ref={dialogRef}
        className="modal wine-logs-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header wine-logs-header">
          <span className="modal-header-icon" aria-hidden>
            <FileText size={16} />
          </span>
          <div className="wine-logs-header-text">
            <h2 id={titleId} className="wine-logs-title">
              {t("wineLogs.title")}
            </h2>
            <p className="wine-logs-subtitle">
              <span className="wine-logs-subtitle-name" title={gameName}>
                {gameName}
              </span>
              <span className="wine-logs-meta-sep" aria-hidden>
                ·
              </span>
              <span>{sizeLabel ?? t("wineLogs.noLogsYet")}</span>
            </p>
          </div>
          <div className="wine-logs-header-actions">
            <button
              type="button"
              className={`wine-logs-status${live ? " is-live" : ""}`}
              onClick={() => setLive((value) => !value)}
              aria-pressed={live}
              title={live ? t("wineLogs.pauseLive") : t("wineLogs.resumeLive")}
            >
              <span className="wine-logs-status-dot" aria-hidden />
              <span>{live ? t("wineLogs.live") : t("wineLogs.paused")}</span>
            </button>
            <button
              type="button"
              className="wine-logs-close"
              onClick={onClose}
              aria-label={t("common.close")}
              title={t("common.close")}
            >
              <X size={16} />
            </button>
          </div>
        </header>

        <div className="wine-logs-body">
          <WineLogsRail
            logPath={logData?.logPath}
            sizeBytes={logData?.sizeBytes ?? 0}
            lineCount={counts.all}
            lastModified={logData?.lastModified}
            counts={counts}
            filter={filter}
            onFilterChange={setFilter}
            wrap={wrap}
            onWrapChange={setWrap}
            autoScroll={autoScroll}
            onAutoScrollChange={handleAutoScrollToggle}
            verboseValue={currentVerbose}
            onVerboseChange={handleVerboseChange}
            onCopyPath={handleCopyPath}
            onOpenEditTab={onOpenEditTab}
          />

          <div className="wine-logs-main">
            <WineLogsToolbar
              query={searchQuery}
              onQueryChange={setSearchQuery}
              searchRef={searchRef}
              onSearchKeyDown={handleSearchKeyDown}
              matchCount={matchTotal}
              activeMatch={activePosition !== null ? matchCursor + 1 : 0}
              onPreviousMatch={() => stepMatch(-1)}
              onNextMatch={() => stepMatch(1)}
              hasError={firstErrorPosition >= 0}
              onJumpToError={() => {
                if (firstErrorPosition >= 0) {
                  terminalRef.current?.jumpToPosition(firstErrorPosition);
                }
              }}
              wrap={wrap}
              onToggleWrap={() => setWrap((value) => !value)}
              onRefresh={() => void fetchLogs()}
              loading={loading}
              visibleCount={rows.length}
              totalCount={counts.all}
            />

            {loading ? (
              <WineLogsSkeleton />
            ) : !hasLog ? (
              <WineLogsEmptyState
                logPath={logData?.logPath}
                onLaunch={onLaunch}
                onOpenCompatSettings={
                  onOpenEditTab ? () => onOpenEditTab("compatibility") : undefined
                }
                onCopyPath={handleCopyPath}
              />
            ) : rows.length === 0 ? (
              <div className="wine-logs-no-matches">
                <span>{t("wineLogs.noMatches")}</span>
                <button
                  type="button"
                  className="wine-logs-reset"
                  onClick={resetFilters}
                >
                  {t("wineLogs.resetFilters")}
                </button>
              </div>
            ) : (
              <WineLogsTerminal
                ref={terminalRef}
                rows={rows}
                query={searchQuery}
                wrap={wrap}
                autoScroll={autoScroll}
                activeIndex={activeRowIndex}
                ariaLabel={t("wineLogs.title")}
                onCopyLineResult={handleCopyLineResult}
              />
            )}
          </div>
        </div>

        <footer className="modal-footer wine-logs-footer">
          <div className="wine-logs-footer-status">
            <span>
              {formatCount(counts.all)} {t("wineLogs.lines")}
            </span>
            {updatedText ? (
              <>
                <span className="wine-logs-meta-sep" aria-hidden>
                  ·
                </span>
                <span>
                  {t("wineLogs.updated")} {updatedText}
                </span>
              </>
            ) : null}
          </div>

          <div className="wine-logs-footer-actions">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handleCopyLogs()}
              disabled={!logData?.logContent}
              leftIcon={<Copy size={13} />}
            >
              {t("common.copy")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handleExportLogs()}
              disabled={!logData?.logContent}
              leftIcon={<Download size={13} />}
            >
              {t("wineLogs.export")}
            </Button>
            <span className="wine-logs-footer-sep" aria-hidden />
            <button
              type="button"
              className="wine-logs-clear"
              onClick={() => void handleClearLogs()}
              disabled={!logData?.exists || clearing}
            >
              <Trash2 size={13} aria-hidden />
              <span>
                {clearing ? t("wineLogs.clearing") : t("wineLogs.clear")}
              </span>
            </button>
            <Button variant="secondary" size="sm" onClick={onClose}>
              {t("common.close")}
            </Button>
          </div>
        </footer>
      </div>
    </div>,
    document.body
  );
}
