import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Button } from "../ui";
import { useLanguage } from "../../context/LanguageContext";
import type { ExeInfo } from "../ImportModal";

export interface FolderScanProgressModalProps {
  open: boolean;
  folderPaths: string[];
  existingPaths: Set<string>;
  onComplete: (exes: ExeInfo[], rootPath: string) => void;
  onCancel: () => void;
}

interface ExeScanProgressPayload {
  scanId: string;
  currentFolder: string;
  folderIndex: number;
  totalFolders: number;
  foldersScanned: number;
  filesExamined: number;
  exesFound: number;
  lastFoundExe: string | null;
  done: boolean;
  cancelled: boolean;
}

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function cleanGameName(fileName: string): string {
  return fileName.replace(/\.exe$/i, "");
}

export default function FolderScanProgressModal({
  open,
  folderPaths,
  existingPaths,
  onComplete,
  onCancel,
}: FolderScanProgressModalProps) {
  const { t } = useLanguage();
  const scanIdRef = useRef<string>(`scan-${Date.now()}`);
  const existingPathsRef = useRef(existingPaths);
  existingPathsRef.current = existingPaths;

  const [currentFolder, setCurrentFolder] = useState<string>(folderPaths[0] || "");
  const [folderIndex, setFolderIndex] = useState<number>(1);
  const [totalFolders, setTotalFolders] = useState<number>(folderPaths.length);
  const [foldersScanned, setFoldersScanned] = useState<number>(0);
  const [filesExamined, setFilesExamined] = useState<number>(0);
  const [foundExes, setFoundExes] = useState<ExeInfo[]>([]);
  const [recentFoundNames, setRecentFoundNames] = useState<string[]>([]);
  const [status, setStatus] = useState<"scanning" | "cancelling" | "cancelled" | "complete" | "error">("scanning");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleCancelScan = useCallback(async () => {
    if (status !== "scanning") return;
    setStatus("cancelling");
    try {
      await invoke("cancel_scan_exes", { scanId: scanIdRef.current });
    } catch (err) {
      console.error("Failed to cancel scan:", err);
    }
  }, [status]);

  // Keyboard accessibility: Escape to cancel or close
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (status === "scanning") {
          void handleCancelScan();
        } else {
          onCancel();
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, status, handleCancelScan, onCancel]);

  // Run the scan
  useEffect(() => {
    if (!open || folderPaths.length === 0) return;

    let cancelled = false;
    let unlisten: UnlistenFn | null = null;
    const scanId = `scan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    scanIdRef.current = scanId;

    setStatus("scanning");
    setFoundExes([]);
    setRecentFoundNames([]);
    setFoldersScanned(0);
    setFilesExamined(0);
    setFolderIndex(1);
    setTotalFolders(folderPaths.length);
    setErrorMessage(null);
    setCurrentFolder(folderPaths[0] || "");

    async function runScan() {
      try {
        const un = await listen<ExeScanProgressPayload>(
          "exe-scan-progress",
          (event) => {
            if (cancelled) return;
            const payload = event.payload;
            if (payload.scanId !== scanId) return;

            setCurrentFolder(payload.currentFolder);
            setFolderIndex(payload.folderIndex);
            setTotalFolders(payload.totalFolders);
            setFoldersScanned(payload.foldersScanned);
            setFilesExamined(payload.filesExamined);

            if (payload.lastFoundExe) {
              const name = cleanGameName(fileNameFromPath(payload.lastFoundExe));
              setRecentFoundNames((prev) => {
                if (prev.includes(name)) return prev;
                return [name, ...prev.slice(0, 9)];
              });
            }

            if (payload.cancelled) {
              setStatus("cancelled");
            }
          }
        );

        if (cancelled) {
          un();
          return;
        }
        unlisten = un;

        const allExes = await invoke<ExeInfo[]>("scan_folders_for_exes", {
          folderPaths,
          scanId,
        });

        if (cancelled) return;

        // Filter out already imported games
        const newExes = allExes.filter(
          (exe) => !existingPathsRef.current.has(exe.path.toLowerCase())
        );

        setFoundExes(newExes);
        setStatus((prev) => (prev === "cancelling" || prev === "cancelled" ? "cancelled" : "complete"));
      } catch (err) {
        if (cancelled) return;
        console.error("Scan failed:", err);
        setErrorMessage(String(err));
        setStatus("error");
      }
    }

    void runScan();

    return () => {
      cancelled = true;
      if (unlisten) {
        unlisten();
      }
      void invoke("cancel_scan_exes", { scanId }).catch(() => {});
    };
  }, [open, folderPaths]);

  if (!open) return null;

  const rootPathForImport = folderPaths.length === 1 ? folderPaths[0] : "";
  const isBusy = status === "scanning" || status === "cancelling";

  return createPortal(
    <div
      className="modal-backdrop"
      data-busy={isBusy ? "true" : undefined}
      role="dialog"
      aria-modal="true"
      aria-labelledby="folder-scan-title"
      onMouseDown={(e) => {
        if (!isBusy && e.target === e.currentTarget) {
          onCancel();
        }
      }}
    >
      <div className="modal folder-scan-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <div className="modal-header-icon folder-scan-header-icon">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="2" x2="12" y2="6" />
              <line x1="12" y1="18" x2="12" y2="22" />
              <line x1="2" y1="12" x2="6" y2="12" />
              <line x1="18" y1="12" x2="22" y2="12" />
            </svg>
          </div>
          <div className="modal-header-text">
            <h2 id="folder-scan-title" className="modal-title">
              {t("folderScan.title")}
            </h2>
            <p className="modal-subtitle">
              {folderPaths.length > 1
                ? t("folderScan.folderProgress", {
                    current: Math.min(folderIndex, totalFolders),
                    total: totalFolders,
                  })
                : folderPaths[0] || ""}
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="modal-body folder-scan-body">
          {/* Animated radar / scanning visualization */}
          <div className="folder-scan-radar-card">
            <div className="folder-scan-radar-visual" data-active={isBusy ? "true" : "false"}>
              <div className="folder-scan-radar-sweep" />
              <div className="folder-scan-radar-circle circle-1" />
              <div className="folder-scan-radar-circle circle-2" />
              <div className="folder-scan-radar-circle circle-3" />
              <div className="folder-scan-radar-core">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
              </div>
            </div>

            {/* Current path and status readout */}
            <div className="folder-scan-path-readout">
              <span className="folder-scan-status-text">
                {status === "scanning" && t("folderScan.currentFolder")}
                {status === "cancelling" && t("folderScan.cancelling")}
                {status === "cancelled" && t("folderScan.cancelled")}
                {status === "complete" &&
                  (foundExes.length > 0
                    ? t("folderScan.exesFound")
                    : t("folderScan.noExesFound"))}
                {status === "error" && errorMessage}
              </span>
              <span className="folder-scan-current-path" title={currentFolder}>
                {isBusy && (currentFolder || folderPaths[0] || "...")}
                {status === "complete" &&
                  t("folderScan.completeSummary", { count: foundExes.length })}
                {status === "cancelled" &&
                  t("folderScan.cancelledSummary", { count: foundExes.length })}
              </span>
            </div>
          </div>

          {/* KPI metrics strip */}
          <div className="folder-scan-kpi-row">
            <div className="folder-scan-kpi-tile">
              <span className="folder-scan-kpi-val">{foldersScanned.toLocaleString()}</span>
              <span className="folder-scan-kpi-label">{t("folderScan.foldersScanned")}</span>
            </div>
            <div className="folder-scan-kpi-tile">
              <span className="folder-scan-kpi-val">{filesExamined.toLocaleString()}</span>
              <span className="folder-scan-kpi-label">{t("folderScan.filesExamined")}</span>
            </div>
            <div className="folder-scan-kpi-tile folder-scan-kpi-tile--accent">
              <span className="folder-scan-kpi-val">
                {status === "complete" || status === "cancelled"
                  ? foundExes.length.toLocaleString()
                  : recentFoundNames.length.toLocaleString()}
              </span>
              <span className="folder-scan-kpi-label">{t("folderScan.exesFound")}</span>
            </div>
          </div>

          {/* Discovered executables live stream */}
          <div className="folder-scan-feed-section">
            <div className="folder-scan-feed-header">
              <span>{t("folderScan.foundList")}</span>
              {recentFoundNames.length > 0 && (
                <span className="folder-scan-feed-badge">
                  {recentFoundNames.length}
                </span>
              )}
            </div>

            {recentFoundNames.length === 0 ? (
              <div className="folder-scan-feed-empty">
                {isBusy ? t("folderScan.searching") : t("folderScan.noExesFound")}
              </div>
            ) : (
              <div className="folder-scan-feed-list">
                {recentFoundNames.map((name, idx) => (
                  <div key={`${idx}-${name}`} className="folder-scan-feed-item">
                    <span className="folder-scan-feed-dot" aria-hidden="true" />
                    <span className="folder-scan-feed-name" title={name}>
                      {name}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer actions */}
        <div className="modal-footer folder-scan-footer">
          {isBusy ? (
            <div className="folder-scan-footer-busy">
              <div className="folder-scan-mini-spinner" aria-hidden="true" />
              <span>
                {status === "cancelling"
                  ? t("folderScan.cancelling")
                  : t("folderScan.scanningHint")}
              </span>
            </div>
          ) : (
            <div />
          )}

          <div className="modal-footer-actions">
            {isBusy ? (
              <Button
                variant="secondary"
                onClick={handleCancelScan}
                disabled={status === "cancelling"}
              >
                {t("folderScan.cancel")}
              </Button>
            ) : status === "complete" && foundExes.length > 0 ? (
              <>
                <Button variant="secondary" onClick={onCancel}>
                  {t("folderScan.close")}
                </Button>
                <Button
                  variant="primary"
                  onClick={() => onComplete(foundExes, rootPathForImport)}
                >
                  {t("folderScan.reviewGames", { count: foundExes.length })}
                </Button>
              </>
            ) : status === "cancelled" && foundExes.length > 0 ? (
              <>
                <Button variant="secondary" onClick={onCancel}>
                  {t("folderScan.close")}
                </Button>
                <Button
                  variant="primary"
                  onClick={() => onComplete(foundExes, rootPathForImport)}
                >
                  {t("folderScan.reviewGames", { count: foundExes.length })}
                </Button>
              </>
            ) : (
              <Button variant="secondary" onClick={onCancel}>
                {t("folderScan.close")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
