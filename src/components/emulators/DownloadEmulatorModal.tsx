import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { useDownloads } from "../../context/DownloadContext";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { useSpeedUnit } from "../../hooks/useSpeedUnit";
import {
  type Emulator,
  type EmulatorDownload,
  type KnownEmulator,
  KNOWN_EMULATORS,
} from "../../types/emulator";
import {
  formatBytesPerSecond,
  formatBytesShort,
  formatProgress,
  type TorrentDownload,
} from "../../types/download";
import { Button } from "../ui";

interface Props {
  onClose: () => void;
  onInstalled: (emulator: Emulator) => void;
}

type Step = "pick" | "folder" | "progress" | "done" | "error";

const ICON = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

const IconCheck = () => (
  <svg {...ICON}>
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const IconAlert = () => (
  <svg {...ICON}>
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

const IconFolder = () => (
  <svg {...ICON}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);

const IconChevronLeft = () => (
  <svg {...ICON}>
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

const IconGamepad = () => (
  <svg {...ICON}>
    <line x1="6" y1="11" x2="10" y2="11" />
    <line x1="8" y1="9" x2="8" y2="13" />
    <line x1="15" y1="12" x2="15.01" y2="12" />
    <line x1="18" y1="10" x2="18.01" y2="10" />
    <path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z" />
  </svg>
);

/** Download-status label keys, mirroring `download.status.*` in i18n. */
const STATUS_KEYS: Record<string, string> = {
  queued: "download.status.queued",
  fetchingMetadata: "download.status.fetchingMetadata",
  downloading: "download.status.downloading",
  paused: "download.status.paused",
  completed: "download.status.completed",
};

/** Last path segment of a download URL, used as the archive file name. */
function archiveNameFromUrl(url: string): string {
  try {
    const path = url.split(/[?#]/)[0];
    const seg = path.split("/").filter(Boolean).pop() ?? "";
    return decodeURIComponent(seg) || "archive";
  } catch {
    return "archive";
  }
}

interface CatalogRow {
  download: EmulatorDownload;
  known?: KnownEmulator;
  installed: boolean;
}

/**
 * "Download Emulator" wizard. Steps: pick a catalog entry → choose an
 * install folder → watch the backend download + auto-extract → finish
 * (backend finds the exe, creates the ROM folder and persists) → done.
 * The download record is polled from DownloadContext; the `extracted`
 * flag can arrive a tick after `completed`, so the finish call is
 * triggered from an effect (guarded to run exactly once).
 */
export default function DownloadEmulatorModal({ onClose, onInstalled }: Props) {
  const { t } = useLanguage();
  const { unit: sizeUnit } = useSizeUnit();
  const { unit: speedUnit } = useSpeedUnit();
  const { showToast } = useToast();
  const { downloads, removeDownload } = useDownloads();

  const [step, setStep] = useState<Step>("pick");
  const [catalog, setCatalog] = useState<EmulatorDownload[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [installedEmulators, setInstalledEmulators] = useState<Emulator[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [installDir, setInstallDir] = useState("");
  const [downloadId, setDownloadId] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [result, setResult] = useState<Emulator | null>(null);
  const finishTriggeredRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await invoke<EmulatorDownload[]>("list_emulator_downloads");
        if (!cancelled) setCatalog(Array.isArray(list) ? list : []);
      } catch (err) {
        if (!cancelled) setCatalogError(String(err));
      }
    })();
    void (async () => {
      try {
        const list = await invoke<Emulator[]>("list_emulators");
        if (!cancelled) setInstalledEmulators(Array.isArray(list) ? list : []);
      } catch {
        // Non-fatal: the "Installed" badges are simply skipped.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedEntry = useMemo(
    () => catalog.find((d) => d.key === selectedKey) ?? null,
    [catalog, selectedKey],
  );

  const selectedKnown = useMemo(
    () => KNOWN_EMULATORS.find((k) => k.key === selectedKey) ?? null,
    [selectedKey],
  );

  const rows = useMemo<CatalogRow[]>(() => {
    return catalog.map((d) => {
      const known = KNOWN_EMULATORS.find((k) => k.key === d.key);
      const installed = known
        ? installedEmulators.some(
            (e) => e.name === known.name && e.platform === known.platform,
          )
        : false;
      return { download: d, known, installed };
    });
  }, [catalog, installedEmulators]);

  const archiveName = useMemo(
    () => (selectedEntry ? archiveNameFromUrl(selectedEntry.url) : ""),
    [selectedEntry],
  );

  const download = useMemo(
    () => (downloadId ? downloads.find((d) => d.id === downloadId) : undefined),
    [downloads, downloadId],
  );

  // While the progress step hasn't reached a terminal status the modal is
  // locked shut (close button, backdrop and Escape all disabled).
  const lockClose =
    step === "progress" &&
    (finishing ||
      !download ||
      (download.status.kind !== "completed" && download.status.kind !== "error"));

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !lockClose) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, lockClose]);

  const runFinish = useCallback(async () => {
    if (!selectedKnown || !downloadId || !installDir) return;
    setFinishing(true);
    try {
      const now = Date.now();
      const payload: Emulator = {
        id: `emu-${selectedKnown.key}-${now}`,
        name: selectedKnown.name,
        platform: selectedKnown.platform,
        executablePath: "",
        argumentsTemplate: selectedKnown.argumentsTemplate,
        romFolder: `${installDir.replace(/\\/g, "/")}/roms`,
        createdAt: now,
        updatedAt: now,
      };
      const final = await invoke<Emulator>("finish_emulator_install", {
        downloadId,
        emulator: payload,
      });
      setResult(final);
      setStep("done");
    } catch (err) {
      setFinishError(t("emulators.download.finishError", { error: String(err) }));
      setStep("error");
    } finally {
      setFinishing(false);
    }
  }, [selectedKnown, downloadId, installDir, t]);

  // Watch the download record: terminal statuses drive the step machine
  // and a completed+extracted download triggers the finish call once.
  useEffect(() => {
    if (step !== "progress" || !download) return;
    if (download.status.kind === "error") {
      setFinishError(download.status.message);
      setStep("error");
      return;
    }
    if (
      download.status.kind === "completed" &&
      download.extracted === true &&
      !finishTriggeredRef.current
    ) {
      finishTriggeredRef.current = true;
      void runFinish();
    }
  }, [download, step, runFinish]);

  async function pickInstallDir() {
    try {
      const p = await open({
        multiple: false,
        directory: true,
        title: t("emulators.download.chooseFolder"),
      });
      if (typeof p === "string") setInstallDir(p);
    } catch (err) {
      console.error(err);
    }
  }

  async function handleInstall() {
    if (!selectedEntry || !installDir.trim()) return;
    try {
      const dl = await invoke<TorrentDownload>("start_emulator_install", {
        emulatorKey: selectedEntry.key,
        installDir: installDir.trim(),
      });
      finishTriggeredRef.current = false;
      setFinishError(null);
      setDownloadId(dl.id);
      setStep("progress");
    } catch (err) {
      setFinishError(String(err));
      setStep("error");
    }
  }

  async function handleCancel() {
    try {
      if (downloadId) await removeDownload(downloadId, true);
    } catch {
      // Best-effort: the download may already be gone.
    }
    onClose();
  }

  async function handleOpenFolder() {
    try {
      await openPath(installDir);
    } catch (err) {
      showToast(String(err), "error");
    }
  }

  function goToFolder() {
    setFinishError(null);
    setStep("folder");
  }

  function renderGlyph(known: KnownEmulator | undefined) {
    if (known?.logo) {
      return (
        <img
          className="download-emulator-row-glyph-img"
          src={known.logo}
          alt=""
          draggable={false}
        />
      );
    }
    return <span className="download-emulator-row-glyph">{known ? known.glyph : <IconGamepad />}</span>;
  }

  function renderSummary() {
    if (!selectedEntry) return null;
    return (
      <div className="download-emulator-summary">
        {renderGlyph(selectedKnown ?? undefined)}
        <span className="download-emulator-summary-info">
          <span className="download-emulator-summary-name">
            {selectedKnown?.name ?? selectedEntry.key}
          </span>
          <span className="download-emulator-summary-platform">
            {selectedKnown?.platform ?? selectedEntry.exeName}
          </span>
        </span>
      </div>
    );
  }

  const determinate =
    !!download &&
    download.progress !== null &&
    download.status.kind !== "completed" &&
    download.status.kind !== "error";

  let statusLabel = "";
  let statusMeta = "";
  if (!download) {
    statusLabel = t("emulators.download.starting");
  } else if (download.status.kind === "completed" && download.extracted !== true) {
    statusLabel = t("emulators.download.extracting");
  } else if (download.status.kind === "completed") {
    statusLabel = t("emulators.download.finishing");
  } else {
    statusLabel = t(STATUS_KEYS[download.status.kind] ?? "common.loading");
    const bytes =
      download.totalSize != null
        ? `${formatBytesShort(download.downloaded, sizeUnit)} / ${formatBytesShort(download.totalSize, sizeUnit)}`
        : formatBytesShort(download.downloaded, sizeUnit);
    const speed = download.downloadSpeed > 0 ? formatBytesPerSecond(download.downloadSpeed, speedUnit) : "";
    statusMeta = [
      determinate && download ? formatProgress(download.progress) : "",
      bytes,
      speed,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  return createPortal(
    <div
      className="modal-overlay emulators-modal-overlay"
      onMouseDown={lockClose ? undefined : onClose}
    >
      <div
        className="modal emulators-modal download-emulator-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("emulators.download.title")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-header-text">
            <h2 className="modal-title">{t("emulators.download.title")}</h2>
            <p className="modal-subtitle">{t("emulators.download.subtitle")}</p>
          </div>
          <button
            className="modal-close"
            aria-label={t("common.close")}
            onClick={onClose}
            disabled={lockClose}
          >
            ×
          </button>
        </div>

        <div className="modal-body download-emulator-body">
          {step === "pick" && (
            <>
              <div className="download-emulator-step">
                <span>{t("emulators.download.pickStep")}</span>
              </div>
              {catalogError ? (
                <div className="download-emulator-empty">{catalogError}</div>
              ) : rows.length === 0 ? (
                <div className="download-emulator-empty">
                  {t("emulators.download.emptyCatalog")}
                </div>
              ) : (
                <>
                  <div
                    className="download-emulator-list"
                    role="listbox"
                    aria-label={t("emulators.download.pickStep")}
                  >
                    {rows.map((row) => {
                      const active = row.download.key === selectedKey;
                      return (
                        <button
                          key={row.download.key}
                          type="button"
                          role="option"
                          aria-selected={active}
                          className={`download-emulator-row${active ? " is-selected" : ""}`}
                          style={
                            row.known
                              ? { ["--emu-accent" as string]: row.known.accent }
                              : undefined
                          }
                          onClick={() => setSelectedKey(row.download.key)}
                        >
                          {renderGlyph(row.known)}
                          <span className="download-emulator-row-main">
                            <span className="download-emulator-row-name">
                              {row.known?.name ?? row.download.key}
                            </span>
                            <span className="download-emulator-row-platform">
                              {row.known?.platform ?? ""}
                            </span>
                            {row.download.notes && (
                              <small className="download-emulator-notes">
                                {t("emulators.download.notesLabel")}: {row.download.notes}
                              </small>
                            )}
                          </span>
                          <span className="download-emulator-row-meta">
                            {row.download.sizeHint && (
                              <span
                                className="download-emulator-size"
                                title={t("emulators.download.sizeLabel")}
                              >
                                {row.download.sizeHint}
                              </span>
                            )}
                            {row.installed && (
                              <span className="download-emulator-installed">
                                <IconCheck />
                                {t("emulators.download.alreadyInstalled")}
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {!selectedEntry && (
                    <p className="download-emulator-hint">
                      {t("emulators.download.notSelected")}
                    </p>
                  )}
                </>
              )}
            </>
          )}

          {step === "folder" && selectedEntry && (
            <>
              <div className="download-emulator-step">
                <button
                  type="button"
                  className="download-emulator-back"
                  onClick={() => setStep("pick")}
                >
                  <IconChevronLeft />
                  {t("common.back")}
                </button>
                <span>{t("emulators.download.folderStep")}</span>
              </div>
              {renderSummary()}
              <div className="download-emulator-folder-row">
                <input
                  className="download-emulator-folder-input"
                  readOnly
                  value={installDir}
                  placeholder={t("emulators.download.chooseFolder")}
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  leftIcon={<IconFolder />}
                  onClick={pickInstallDir}
                >
                  {t("emulators.download.chooseFolder")}
                </Button>
              </div>
              {installDir && (
                <div className="download-emulator-layout">
                  <div className="download-emulator-layout-line">
                    <span>{t("emulators.download.plannedLayout")}</span>
                    <code>
                      {installDir}\{archiveName}
                    </code>
                  </div>
                  <div className="download-emulator-layout-line">
                    <span>{t("emulators.download.romFolderLabel")}</span>
                    <code>{installDir}\roms</code>
                  </div>
                </div>
              )}
            </>
          )}

          {step === "progress" && (
            <>
              <div className="download-emulator-step">
                <span>{t("emulators.download.folderStep")}</span>
              </div>
              {renderSummary()}
              <div className="download-emulator-progress">
                <div className="download-emulator-progress-bar">
                  <div
                    className={`download-emulator-progress-fill${
                      determinate ? "" : " is-indeterminate"
                    }`}
                    style={
                      determinate && download
                        ? { width: `${Math.round((download.progress ?? 0) * 100)}%` }
                        : undefined
                    }
                  />
                </div>
                <div className="download-emulator-progress-status">
                  <strong>{statusLabel}</strong>
                  <span>{statusMeta}</span>
                </div>
              </div>
            </>
          )}

          {step === "done" && result && (
            <div className="download-emulator-result">
              <span className="download-emulator-result-icon">
                <IconCheck />
              </span>
              <span className="download-emulator-result-name">{result.name}</span>
              <span className="download-emulator-result-path">{installDir}</span>
            </div>
          )}

          {step === "error" && (
            <div className="download-emulator-result">
              <span className="download-emulator-result-icon is-error">
                <IconAlert />
              </span>
              <span className="download-emulator-result-name">
                {t("emulators.download.error")}
              </span>
              <span className="download-emulator-result-path">{finishError}</span>
            </div>
          )}
        </div>

        <div className="download-emulator-actions">
          {step === "pick" && (
            <>
              <Button variant="ghost" onClick={onClose}>
                {t("common.cancel")}
              </Button>
              <Button
                variant="primary"
                disabled={!selectedEntry}
                onClick={() => setStep("folder")}
              >
                {t("common.next")}
              </Button>
            </>
          )}
          {step === "folder" && (
            <>
              <Button variant="ghost" onClick={onClose}>
                {t("common.cancel")}
              </Button>
              <Button
                variant="primary"
                disabled={!installDir.trim()}
                onClick={handleInstall}
              >
                {t("emulators.download.install")}
              </Button>
            </>
          )}
          {step === "progress" && (
            <Button variant="danger" onClick={handleCancel}>
              {t("emulators.download.cancelDownload")}
            </Button>
          )}
          {step === "done" && result && (
            <>
              <Button variant="secondary" onClick={handleOpenFolder}>
                {t("emulators.download.openFolder")}
              </Button>
              <Button variant="primary" onClick={() => onInstalled(result)}>
                {t("common.done")}
              </Button>
            </>
          )}
          {step === "error" && (
            <>
              <Button variant="ghost" onClick={onClose}>
                {t("common.close")}
              </Button>
              <Button variant="primary" onClick={goToFolder}>
                {t("emulators.download.retry")}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
