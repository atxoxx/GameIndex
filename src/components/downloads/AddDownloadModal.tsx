import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useDownloads } from "../../context/DownloadContext";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { Button } from "../ui";
import { formatBytesShort, type TorrentFile } from "../../types/download";
import { getFileCategory } from "../download-modal/helpers";

const URI_PATTERN = /^(magnet:|https?:\/\/|[a-zA-Z]:\\|\/)/i;

export interface AddDownloadModalProps {
  open: boolean;
  onClose: () => void;
}

export default function AddDownloadModal({ open, onClose }: AddDownloadModalProps) {
  const {
    addDownload,
    addDirectDownload,
    addDebridDownload,
    startSelectedDownload,
    selectSavePath,
    defaultDownloadPath,
    alwaysAskPath,
    activeDownloads,
    debridProvider,
    debridApiKey,
  } = useDownloads();
  const { showToast } = useToast();
  const { t } = useLanguage();
  const { unit } = useSizeUnit();

  // Input states
  const [inputValue, setInputValue] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Options states
  const [savePath, setSavePath] = useState<string>(() => {
    return (
      localStorage.getItem("gamelib-last-download-path") ||
      defaultDownloadPath ||
      ""
    );
  });
  const [autoExtract, setAutoExtract] = useState<boolean>(true);
  const [useDebrid, setUseDebrid] = useState<boolean>(false);

  // AllDebrid cache checking state
  const [cacheStatus, setCacheStatus] = useState<
    "idle" | "checking" | "cached" | "not_cached" | "error"
  >("idle");
  const cacheSeqRef = useRef(0);

  // Inspection states (for torrent / magnet file listing)
  const [inspecting, setInspecting] = useState(false);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [inspectedTorrentId, setInspectedTorrentId] = useState<string | null>(null);
  const [extractedMagnetUri, setExtractedMagnetUri] = useState<string | null>(null);
  const [files, setFiles] = useState<TorrentFile[]>([]);
  const [selectedFileIndices, setSelectedFileIndices] = useState<Set<number>>(new Set());
  const [fileSearchQuery, setFileSearchQuery] = useState("");

  const cancelledRef = useRef(false);
  const lastInspectedUriRef = useRef<string>("");

  // Detect URI protocol & file kind
  const trimmed = inputValue.trim();
  const isMagnet = trimmed.toLowerCase().startsWith("magnet:");
  const isTorrent =
    trimmed.toLowerCase().endsWith(".torrent") ||
    trimmed.toLowerCase().includes(".torrent?") ||
    trimmed.toLowerCase().startsWith("file://");
  const isDirect =
    !isMagnet &&
    !isTorrent &&
    (trimmed.startsWith("http://") || trimmed.startsWith("https://"));

  const debridConfigured = useMemo(() => {
    return (
      (debridProvider === "alldebrid" || debridProvider !== "none") &&
      !!debridApiKey
    );
  }, [debridProvider, debridApiKey]);

  // Clean up any temp torrent when modal is closed or unmounted
  const cleanupTempTorrent = useCallback((torrentId: string | null) => {
    if (torrentId) {
      invoke("torrent_remove", { id: torrentId, deleteFiles: true }).catch((err) => {
        console.debug("Failed to remove temp listing torrent:", err);
      });
    }
  }, []);

  const handleClose = useCallback(() => {
    if (submitting) return;
    cancelledRef.current = true;
    cleanupTempTorrent(inspectedTorrentId);
    setInspectedTorrentId(null);
    setFiles([]);
    setSelectedFileIndices(new Set());
    setInspectError(null);
    setInspecting(false);
    onClose();
  }, [submitting, cleanupTempTorrent, inspectedTorrentId, onClose]);

  // Escape key handler
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, handleClose]);

  // Check AllDebrid cache whenever magnet changes
  useEffect(() => {
    const targetMagnet = isMagnet ? trimmed : extractedMagnetUri;
    if (!targetMagnet || !targetMagnet.startsWith("magnet:")) {
      setCacheStatus("idle");
      return;
    }

    if (!debridConfigured || !debridApiKey) {
      setCacheStatus("idle");
      return;
    }

    const seq = ++cacheSeqRef.current;
    setCacheStatus("checking");

    const timer = window.setTimeout(async () => {
      try {
        const res = await invoke<{ cached: boolean }>("debrid_check_cache", {
          provider: "alldebrid",
          apikey: debridApiKey,
          magnet: targetMagnet,
        });
        if (seq === cacheSeqRef.current) {
          if (res.cached) {
            setCacheStatus("cached");
            setUseDebrid(true); // Automatically toggle on debrid for cached links
          } else {
            setCacheStatus("not_cached");
          }
        }
      } catch (err) {
        console.debug("[AddDownloadModal] cache check error:", err);
        if (seq === cacheSeqRef.current) {
          setCacheStatus("error");
        }
      }
    }, 350);

    return () => window.clearTimeout(timer);
  }, [isMagnet, trimmed, extractedMagnetUri, debridConfigured, debridApiKey]);

  // Inspect torrent or magnet files
  const inspectSource = useCallback(
    async (sourceUri: string) => {
      const clean = sourceUri.trim();
      if (!clean) return;
      if (clean === lastInspectedUriRef.current && files.length > 0) return;

      cancelledRef.current = false;
      lastInspectedUriRef.current = clean;
      setInspecting(true);
      setInspectError(null);

      // Clean up previous temp torrent if exists
      if (inspectedTorrentId) {
        cleanupTempTorrent(inspectedTorrentId);
        setInspectedTorrentId(null);
      }

      try {
        const tempFolder = savePath || defaultDownloadPath || "C:/";
        const newDl = await addDownload(
          clean,
          tempFolder,
          null,
          "Inspect",
          false,
          true, // listOnly: true
        );

        if (cancelledRef.current) {
          cleanupTempTorrent(newDl.id);
          return;
        }

        setInspectedTorrentId(newDl.id);
        if (newDl.magnetUri) {
          setExtractedMagnetUri(newDl.magnetUri);
        }

        if (newDl.files && newDl.files.length > 0) {
          setFiles(newDl.files);
          setSelectedFileIndices(new Set(newDl.files.map((_, i) => i)));
          setInspecting(false);
        }
      } catch (err) {
        if (cancelledRef.current) return;
        console.error("[AddDownloadModal] inspect failed:", err);
        setInspectError(String(err));
        setInspecting(false);
      }
    },
    [files.length, inspectedTorrentId, cleanupTempTorrent, savePath, defaultDownloadPath, addDownload],
  );

  // Poll for files arriving on list-only magnet torrent
  useEffect(() => {
    if (!inspectedTorrentId || files.length > 0 || !inspecting) return;

    const live = activeDownloads.find((d) => d.id === inspectedTorrentId);
    if (live && live.files && live.files.length > 0) {
      setFiles(live.files);
      setSelectedFileIndices(new Set(live.files.map((_, i) => i)));
      if (live.magnetUri) {
        setExtractedMagnetUri(live.magnetUri);
      }
      setInspecting(false);
    }
  }, [inspectedTorrentId, files.length, inspecting, activeDownloads]);

  // Trigger inspection when a valid torrent or magnet is entered
  useEffect(() => {
    if (!open) return;
    if (isTorrent || isMagnet) {
      const timeout = window.setTimeout(() => {
        inspectSource(trimmed);
      }, 400);
      return () => window.clearTimeout(timeout);
    } else {
      if (inspectedTorrentId) {
        cleanupTempTorrent(inspectedTorrentId);
        setInspectedTorrentId(null);
        setFiles([]);
        setSelectedFileIndices(new Set());
      }
      setInspecting(false);
      setInspectError(null);
    }
  }, [open, isTorrent, isMagnet, trimmed, inspectSource, inspectedTorrentId, cleanupTempTorrent]);

  // File browser for .torrent files
  async function handleBrowseTorrent() {
    try {
      const selected = await openDialog({
        multiple: false,
        directory: false,
        title: t("addDownloadModal.browseTorrent") || "Select Torrent File",
        filters: [{ name: "Torrent file", extensions: ["torrent"] }],
      });

      if (selected && typeof selected === "string") {
        setInputValue(selected);
      }
    } catch (err) {
      showToast(String(err), "error");
    }
  }

  // Paste from clipboard
  async function handlePaste() {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        const text = await navigator.clipboard.readText();
        if (text) {
          setInputValue(text.trim());
          showToast(t("downloads.magnetCopied") || "Pasted from clipboard", "info");
        }
      }
    } catch {
      showToast("Unable to read clipboard", "error");
    }
  }

  // Pick destination folder
  async function handleChooseSavePath() {
    try {
      const chosen = await selectSavePath();
      if (chosen) {
        setSavePath(chosen);
        localStorage.setItem("gamelib-last-download-path", chosen);
      }
    } catch (err) {
      showToast(String(err), "error");
    }
  }

  // File selection toggles
  const handleToggleFile = (idx: number) => {
    setSelectedFileIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const handleSelectAllFiles = () => {
    setSelectedFileIndices(new Set(files.map((_, i) => i)));
  };

  const handleDeselectAllFiles = () => {
    setSelectedFileIndices(new Set());
  };

  // Filtered files for search
  const filteredFiles = useMemo(() => {
    return files
      .map((file, idx) => ({ file, idx }))
      .filter(({ file }) =>
        file.name.toLowerCase().includes(fileSearchQuery.toLowerCase()),
      );
  }, [files, fileSearchQuery]);

  const selectedBytes = useMemo(() => {
    return files.reduce(
      (sum, f, i) => (selectedFileIndices.has(i) ? sum + f.size : sum),
      0,
    );
  }, [files, selectedFileIndices]);

  const totalBytes = useMemo(() => {
    return files.reduce((sum, f) => sum + f.size, 0);
  }, [files]);

  const percentage = totalBytes > 0 ? Math.round((selectedBytes / totalBytes) * 100) : 0;

  // Submit action
  async function handleSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const clean = trimmed;
    if (!clean) {
      showToast(t("addDownloadModal.invalidSource"), "error");
      return;
    }

    if ((isTorrent || isMagnet) && files.length > 0 && selectedFileIndices.size === 0) {
      showToast(t("addDownloadModal.noFilesSelected"), "error");
      return;
    }

    setSubmitting(true);
    try {
      let finalPath = savePath;
      if (!finalPath) {
        if (defaultDownloadPath && !alwaysAskPath) {
          finalPath = defaultDownloadPath;
        } else {
          const chosen = await selectSavePath();
          if (!chosen) {
            setSubmitting(false);
            return;
          }
          finalPath = chosen;
          setSavePath(chosen);
          localStorage.setItem("gamelib-last-download-path", chosen);
        }
      }

      // 1. Direct link
      if (isDirect) {
        let filename = "download.zip";
        try {
          const urlObj = new URL(clean);
          const lastSeg = urlObj.pathname.substring(urlObj.pathname.lastIndexOf("/") + 1);
          if (lastSeg && lastSeg.includes(".")) {
            filename = lastSeg;
          }
        } catch {}

        const fullPath = `${finalPath}/${filename}`.replace(/\\/g, "/");
        await addDirectDownload(clean, fullPath, null, "Manual Direct Link", autoExtract);
        showToast(t("magnetInput.downloadAdded"), "success");
      }
      // 2. Magnet or Torrent via AllDebrid
      else if (useDebrid && debridConfigured) {
        const magnetToUse = isMagnet ? clean : extractedMagnetUri;
        if (!magnetToUse) {
          throw new Error("Unable to resolve magnet link for AllDebrid download.");
        }
        // If there was an active list-only temp torrent, remove it first
        if (inspectedTorrentId) {
          cleanupTempTorrent(inspectedTorrentId);
          setInspectedTorrentId(null);
        }

        await addDebridDownload(magnetToUse, finalPath, null, "AllDebrid", autoExtract);
        showToast(t("magnetInput.downloadAdded"), "success");
      }
      // 3. Torrent / Magnet via P2P swarm
      else {
        if (inspectedTorrentId) {
          // Start the inspected list-only torrent with user's selected files
          await startSelectedDownload(
            inspectedTorrentId,
            Array.from(selectedFileIndices),
            autoExtract,
          );
          setInspectedTorrentId(null); // It is now a real active download, don't clean it up
        } else {
          // Direct add without prior inspection completion
          await addDownload(clean, finalPath, null, "Manual Download", autoExtract, false);
        }
        showToast(t("magnetInput.downloadAdded"), "success");
      }

      onClose();
    } catch (err) {
      showToast(t("magnetInput.addFailed", { error: String(err) }), "error");
    } finally {
      setSubmitting(false);
    }
  }

  // Drag & drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!submitting) setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (submitting) return;

    // Check dropped text / uri
    const uriList = e.dataTransfer.getData("text/uri-list");
    const plain = e.dataTransfer.getData("text/plain");
    const candidate = (uriList || plain || "").trim();
    if (candidate && URI_PATTERN.test(candidate)) {
      setInputValue(candidate);
      return;
    }

    // Check dropped files (e.g. .torrent file)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      const filePath = (file as unknown as { path?: string }).path;
      if (filePath) {
        setInputValue(filePath);
      } else {
        setInputValue(file.name);
      }
    }
  };

  const renderFileCategoryIcon = (category: ReturnType<typeof getFileCategory>) => {
    switch (category) {
      case "executable":
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
        );
      case "archive":
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points="21 8 21 21 3 21 3 8" />
            <rect x="1" y="3" width="22" height="5" />
            <line x1="10" y1="12" x2="14" y2="12" />
          </svg>
        );
      case "disc":
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="10" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        );
      case "media":
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polygon points="23 7 16 12 23 17 23 7" />
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
          </svg>
        );
      case "data":
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          </svg>
        );
      default:
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        );
    }
  };

  if (!open) return null;

  return createPortal(
    <div
      className="modal-backdrop dl-modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        className="modal dl-modal dl-add-modal"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={t("addDownloadModal.title")}
      >
        {/* Modal Header */}
        <div className="dl-modal-header">
          <div className="dl-modal-header-game">
            <div className="dl-modal-header-icon-box">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </div>
            <div className="dl-modal-header-titles">
              <h2 className="dl-modal-game-name">{t("addDownloadModal.title")}</h2>
              <p className="dl-modal-flow-tag">{t("addDownloadModal.subtitle")}</p>
            </div>
          </div>

          <div className="dl-modal-header-right">
            <button
              type="button"
              className="dl-modal-close-button"
              onClick={handleClose}
              aria-label={t("common.close")}
              title={`${t("common.close")} (Esc)`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="dl-modal-body dl-add-modal-body">
          {/* Source Input Zone */}
          <div
            className={`dl-add-dropzone${dragOver ? " is-drag-over" : ""}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div className="dl-add-input-bar">
              {isDirect && (
                <span className="dl-magnet-badge dl-magnet-badge--direct">
                  {t("addDownloadModal.badgeDirect")}
                </span>
              )}
              {isTorrent && (
                <span className="dl-magnet-badge dl-magnet-badge--torrent">
                  {t("addDownloadModal.badgeTorrent")}
                </span>
              )}
              {isMagnet && (
                <span className="dl-magnet-badge dl-magnet-badge--magnet">
                  {t("addDownloadModal.badgeMagnet")}
                </span>
              )}

              <input
                className="dl-add-text-input"
                type="text"
                placeholder={t("addDownloadModal.inputPlaceholder")}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !submitting) {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
                disabled={submitting}
                spellCheck={false}
                autoComplete="off"
                autoFocus
              />

              {inputValue && (
                <button
                  type="button"
                  className="dl-magnet-clear-btn"
                  onClick={() => {
                    setInputValue("");
                    setFiles([]);
                    setSelectedFileIndices(new Set());
                    setExtractedMagnetUri(null);
                    cleanupTempTorrent(inspectedTorrentId);
                    setInspectedTorrentId(null);
                  }}
                  title={t("common.clear")}
                >
                  ×
                </button>
              )}

              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handlePaste}
                title={t("downloads.pasteClipboard") || "Paste"}
              >
                {t("downloads.pasteClipboard") || "Paste"}
              </Button>

              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleBrowseTorrent}
                title={t("addDownloadModal.browseTorrent")}
              >
                {t("addDownloadModal.browseTorrent")}
              </Button>
            </div>

            {dragOver && (
              <div className="dl-add-drop-overlay">
                <span>{t("addDownloadModal.dragOverHint")}</span>
              </div>
            )}
          </div>

          {/* AllDebrid Status & Toggle Zone (for Magnets & Torrents) */}
          {(isMagnet || isTorrent) && (
            <div className="dl-add-debrid-card">
              <div className="dl-add-debrid-header">
                <div className="dl-add-debrid-info">
                  <div className="dl-add-debrid-title-row">
                    <span className="dl-add-debrid-title">{t("addDownloadModal.useAllDebrid")}</span>
                    {cacheStatus === "checking" && (
                      <span className="dl-add-cache-badge dl-add-cache-badge--checking">
                        <div className="spinner-tiny" />
                        <span>{t("addDownloadModal.alldebridChecking")}</span>
                      </span>
                    )}
                    {cacheStatus === "cached" && (
                      <span className="dl-add-cache-badge dl-add-cache-badge--cached">
                        ⚡ {t("addDownloadModal.alldebridCached")}
                      </span>
                    )}
                    {cacheStatus === "not_cached" && (
                      <span className="dl-add-cache-badge dl-add-cache-badge--uncached">
                        {t("addDownloadModal.alldebridNotCached")}
                      </span>
                    )}
                    {!debridConfigured && (
                      <span className="dl-add-cache-badge dl-add-cache-badge--unconfigured">
                        {t("addDownloadModal.alldebridNotConfigured")}
                      </span>
                    )}
                  </div>
                  <p className="dl-add-debrid-desc">{t("addDownloadModal.useAllDebridDesc")}</p>
                </div>

                <label className="dl-add-toggle-label">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={useDebrid}
                    onChange={(e) => setUseDebrid(e.target.checked)}
                    disabled={!debridConfigured}
                  />
                </label>
              </div>
            </div>
          )}

          {/* Metadata Fetching State */}
          {inspecting && (
            <div className="dl-add-inspecting-banner">
              <div className="spinner-small" />
              <span>{t("addDownloadModal.fetchingMetadata")}</span>
            </div>
          )}

          {/* Inspection Error Banner */}
          {inspectError && (
            <div className="dl-inline-error-banner">
              <div className="dl-inline-error-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <p className="dl-inline-error-msg">{inspectError}</p>
            </div>
          )}

          {/* Available Files Listing (if Torrent/Magnet has files) */}
          {files.length > 0 && (
            <div className="dl-file-selector-container dl-add-files-box">
              <div className="dl-file-selector-hero">
                <div className="dl-file-hero-info">
                  <h3 className="dl-file-hero-title">{t("addDownloadModal.availableFiles")}</h3>
                  <p className="dl-file-hero-desc">
                    {t("downloadFiles.ofFilesSelected", {
                      count: selectedFileIndices.size,
                      total: files.length,
                    })}
                  </p>
                </div>

                <div className="dl-file-weight-card">
                  <div className="dl-file-weight-top">
                    <span className="dl-file-weight-label">
                      <strong>{selectedFileIndices.size}</strong> / {files.length}
                    </span>
                    <span className="dl-file-weight-percent">{percentage}%</span>
                  </div>
                  <div className="dl-file-weight-track">
                    <div className="dl-file-weight-fill" style={{ width: `${percentage}%` }} />
                  </div>
                  <span className="dl-file-weight-bytes">
                    {t("downloadFiles.bytesOf", {
                      loaded: formatBytesShort(selectedBytes, unit),
                      total: formatBytesShort(totalBytes, unit),
                    })}
                  </span>
                </div>
              </div>

              {/* Files Toolbar */}
              <div className="dl-file-toolbar">
                <div className="dl-file-search-box">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="dl-file-search-icon">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <input
                    type="text"
                    placeholder={t("downloadFiles.filterPlaceholder")}
                    className="dl-file-search-input"
                    value={fileSearchQuery}
                    onChange={(e) => setFileSearchQuery(e.target.value)}
                  />
                  {fileSearchQuery && (
                    <button
                      type="button"
                      className="dl-file-search-clear"
                      onClick={() => setFileSearchQuery("")}
                    >
                      ×
                    </button>
                  )}
                </div>

                <div className="dl-file-toolbar-actions">
                  <Button variant="secondary" size="sm" onClick={handleSelectAllFiles}>
                    {t("downloadFiles.selectAll")}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={handleDeselectAllFiles}>
                    {t("common.clear")}
                  </Button>
                </div>
              </div>

              {/* Scrollable File Items */}
              <div className="dl-file-table-list scrollable" style={{ maxHeight: "220px" }}>
                {filteredFiles.length === 0 ? (
                  <div className="dl-file-empty">{t("downloadFiles.noMatch")}</div>
                ) : (
                  filteredFiles.map(({ file, idx }) => {
                    const isChecked = selectedFileIndices.has(idx);
                    const category = getFileCategory(file.name);
                    return (
                      <label key={idx} className={`dl-file-row${isChecked ? " is-selected" : ""}`}>
                        <input
                          type="checkbox"
                          className="dl-file-checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleFile(idx)}
                        />
                        <div className={`dl-file-type-icon dl-file-type-icon--${category}`}>
                          {renderFileCategoryIcon(category)}
                        </div>
                        <span className="dl-file-item-name" title={file.name}>
                          {file.name}
                        </span>
                        <span className="dl-file-item-size">
                          {formatBytesShort(file.size, unit)}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* Save Destination & Auto-Extract Options */}
          <div className="dl-add-options-section">
            <div className="dl-magnet-option-row">
              <label className="dl-magnet-path-label">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
                <span>{t("addDownloadModal.saveFolder")}:</span>
                <span className="dl-magnet-path-val">
                  {savePath || defaultDownloadPath || t("addDownloadModal.chooseFolder")}
                </span>
              </label>
              <Button size="sm" variant="secondary" onClick={handleChooseSavePath}>
                {t("addDownloadModal.changeFolder")}
              </Button>
            </div>

            <div className="dl-magnet-toggles-row">
              <label className="dl-magnet-checkbox-label">
                <input
                  type="checkbox"
                  checked={autoExtract}
                  onChange={(e) => setAutoExtract(e.target.checked)}
                />
                <span>{t("addDownloadModal.autoExtract")}</span>
              </label>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="dl-modal-footer">
          <div className="dl-modal-footer-info">
            {files.length > 0 && (
              <span className="dl-footer-count-text">
                {t("downloadFiles.bytesOf", {
                  loaded: formatBytesShort(selectedBytes, unit),
                  total: formatBytesShort(totalBytes, unit),
                })}
              </span>
            )}
          </div>

          <div className="dl-modal-footer-actions">
            <Button variant="ghost" onClick={handleClose} disabled={submitting}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              onClick={() => handleSubmit()}
              isLoading={submitting}
              disabled={!trimmed || submitting}
            >
              {submitting ? t("addDownloadModal.adding") : t("addDownloadModal.startDownload")}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
