import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { useLanguage } from "./LanguageContext";

const LS_AUTO_CHECK_UPDATES = "gamelib.auto_check_updates";

export type InstallMode = "nsis" | "portable" | "dev";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "up-to-date"
  | "downloading"
  | "ready"
  | "error"
  | "restarting";

export interface UpdateInfo {
  version: string;
  body?: string;
  date?: string;
}

export interface UpdateProgress {
  downloaded: number;
  total: number;
  percent: number;
  speedBytesPerSec: number;
  etaSeconds: number | null;
}

export interface UpdateContextValue {
  installMode: InstallMode;
  autoCheckUpdates: boolean;
  setAutoCheckUpdates: (enabled: boolean) => void;
  status: UpdateStatus;
  updateInfo: UpdateInfo | null;
  error: string | null;
  progress: UpdateProgress;
  lastCheckedAt: number | null;
  checkForUpdates: (manual?: boolean) => Promise<void>;
  installUpdate: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  applyUpdate: () => Promise<void>;
  cancelDownload: () => Promise<void>;
  skipVersion: () => void;
  snoozeUpdate: (hours?: number) => void;
  showModal: boolean;
  setShowModal: (show: boolean) => void;
}

// Tagged events the Rust `portable_update_download` command emits over a Channel.
type PortableDownloadEvent =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { downloaded: number; total?: number } }
  | { event: "Finished"; data: null };

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0s";
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

const UpdateContext = createContext<UpdateContextValue | null>(null);

export function UpdateProvider({ children }: { children: ReactNode }) {
  const { t } = useLanguage();

  const [installMode, setInstallMode] = useState<InstallMode>("nsis");
  const [autoCheckUpdates, setAutoCheckUpdatesState] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(LS_AUTO_CHECK_UPDATES);
      return raw !== null ? raw === "true" : true;
    } catch {
      return true;
    }
  });

  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<UpdateProgress>({
    downloaded: 0,
    total: 0,
    percent: 0,
    speedBytesPerSec: 0,
    etaSeconds: null,
  });
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const [showModal, setShowModal] = useState<boolean>(false);

  // Raw plugin-updater Update object; kept `any` (the plugin's TS surface is unstable).
  const [updateObj, setUpdateObj] = useState<any>(null);

  // Portable artifact details from the update manifest + staged download path.
  const [portableUrl, setPortableUrl] = useState<string | null>(null);
  const [portableSignature, setPortableSignature] = useState<string | null>(null);
  const [stagedPath, setStagedPath] = useState<string | null>(null);

  // Last progress event (ts/bytes) + smoothed speed (EMA, alpha 0.3).
  const speedRef = useRef({ lastTime: 0, lastBytes: 0, ema: 0 });

  const setAutoCheckUpdates = useCallback((enabled: boolean) => {
    setAutoCheckUpdatesState(enabled);
    try {
      localStorage.setItem(LS_AUTO_CHECK_UPDATES, String(enabled));
    } catch {
      // Ignore storage errors
    }
  }, []);

  // Resolve the real install mode on mount; dev/stub falls back to "nsis".
  useEffect(() => {
    invoke<string>("updater_install_mode")
      .then((mode) => {
        if (mode === "nsis" || mode === "portable" || mode === "dev") {
          setInstallMode(mode);
        }
      })
      .catch(() => {
        // Command unavailable (dev/stub) — keep default.
      });
  }, []);

  const clearUpdate = useCallback(() => {
    setUpdateObj(null);
    setUpdateInfo(null);
    setPortableUrl(null);
    setPortableSignature(null);
    setStagedPath(null);
  }, []);

  const checkForUpdates = useCallback(
    async (manual = false) => {
      setStatus("checking");
      setError(null);
      setLastCheckedAt(Date.now());

      // Dev builds ship no updater artifacts.
      if (installMode === "dev") {
        clearUpdate();
        setStatus("up-to-date");
        return;
      }

      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const target = installMode === "portable" ? "windows-x86_64" : "windows-x86_64-nsis";
        const update = await check({ target });

        if (update && update.available) {
          // Auto-checks respect persisted user gates; manual checks bypass them.
          if (!manual && installMode === "portable") {
            try {
              if (localStorage.getItem("gamelib.skipped_version") === update.version) {
                clearUpdate();
                setStatus("up-to-date");
                return;
              }
              const snoozedUntil = Number(
                localStorage.getItem("gamelib.update_snoozed_until") ?? 0,
              );
              if (snoozedUntil > 0 && Date.now() < snoozedUntil) {
                clearUpdate();
                setStatus("up-to-date");
                return;
              }
            } catch {
              // Ignore storage errors
            }
          }

          setUpdateObj(update);
          setUpdateInfo({
            version: update.version,
            body: update.body || undefined,
            date: update.date || undefined,
          });

          // Extract the portable artifact (url + signature) from the raw latest.json.
          if (installMode === "portable") {
            const manifest = update.rawJson as {
              platforms?: Record<string, { url?: string; signature?: string }>;
            };
            const artifact = manifest.platforms?.["windows-x86_64"];
            if (artifact?.url && artifact?.signature) {
              setPortableUrl(artifact.url);
              setPortableSignature(artifact.signature);
            } else {
              setStatus("error");
              setError(t("updater.errorNoArtifact"));
              return;
            }
          }

          setStatus("available");
          if (manual) setShowModal(true);
        } else {
          clearUpdate();
          setStatus("up-to-date");
        }
      } catch (e: any) {
        console.warn("[AutoUpdater] Check failed:", e);
        const errMsg = typeof e === "string" ? e : e?.message || "Failed to check for updates";

        // GitHub has no published release/latest.json yet (404/invalid JSON).
        if (
          errMsg.includes("Could not fetch a valid release JSON") ||
          errMsg.includes("404") ||
          errMsg.includes("NotFound")
        ) {
          clearUpdate();
          setStatus("up-to-date");
          if (manual) setError("No release published on GitHub yet.");
        } else if (
          errMsg.includes("TargetsNotFound") ||
          errMsg.includes("targets not found") ||
          errMsg.includes("no artifact")
        ) {
          // Release exists but carries no artifact for this install type.
          clearUpdate();
          setStatus("up-to-date");
        } else {
          setError(errMsg);
          setStatus("error");
        }
      }
    },
    [installMode, t, clearUpdate],
  );

  // Shared portable download: drives progress + speed/ETA, stages the file on success.
  const portableDownload = useCallback(async (): Promise<string | null> => {
    if (!portableUrl || !portableSignature) return null;
    setStatus("downloading");
    setError(null);
    setProgress({ downloaded: 0, total: 0, percent: 0, speedBytesPerSec: 0, etaSeconds: null });
    speedRef.current = { lastTime: 0, lastBytes: 0, ema: 0 };

    const channel = new Channel<PortableDownloadEvent>((event) => {
      if (event.event === "Started") {
        const total = event.data.contentLength ?? 0;
        setProgress((p) => ({ ...p, total }));
      } else if (event.event === "Progress") {
        const now = Date.now();
        const total = event.data.total ?? 0;
        const downloaded = event.data.downloaded;
        const ref = speedRef.current;

        let speed = ref.ema;
        if (ref.lastTime > 0 && now > ref.lastTime) {
          const deltaBytes = downloaded - ref.lastBytes;
          const deltaSecs = (now - ref.lastTime) / 1000;
          const instant = deltaBytes / deltaSecs;
          speed = ref.ema === 0 ? instant : ref.ema * 0.7 + instant * 0.3;
        }
        ref.lastTime = now;
        ref.lastBytes = downloaded;
        ref.ema = speed;

        const percent = total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0;
        const etaSeconds = speed > 0 && total > downloaded ? (total - downloaded) / speed : null;
        setProgress({ downloaded, total, percent, speedBytesPerSec: speed, etaSeconds });
      } else if (event.event === "Finished") {
        setProgress((p) => ({ ...p, percent: 100 }));
      }
    });

    try {
      const result = await invoke<{ path: string; sizeBytes: number }>(
        "portable_update_download",
        { url: portableUrl, signature: portableSignature, onEvent: channel },
      );
      setStagedPath(result.path);
      if (result.sizeBytes > 0) {
        setProgress((p) => ({ ...p, total: result.sizeBytes, percent: 100 }));
      }
      return result.path;
    } catch (e: any) {
      const errMsg = typeof e === "string" ? e : e?.message || "";
      if (errMsg.includes("cancelled")) {
        setStatus("up-to-date");
      } else if (errMsg.includes("verification")) {
        setStatus("error");
        setError(t("updater.errorVerification"));
      } else {
        setStatus("error");
        setError(errMsg);
      }
      return null;
    }
  }, [portableUrl, portableSignature, t]);

  const portableApply = useCallback((path: string) => {
    setStatus("restarting");
    // Fire-and-forget: the app process exits shortly after.
    void invoke("portable_update_apply", { stagedPath: path, relaunch: true }).catch(() => {});
  }, []);

  const installUpdate = useCallback(async () => {
    if (installMode === "nsis") {
      if (!updateObj) return;
      setStatus("downloading");
      setError(null);
      setProgress({ downloaded: 0, total: 0, percent: 0, speedBytesPerSec: 0, etaSeconds: null });

      try {
        let downloaded = 0;
        let total = 0;

        await updateObj.downloadAndInstall((event: any) => {
          if (event.event === "Started") {
            total = event.data?.contentLength || 0;
          } else if (event.event === "Progress") {
            downloaded += event.data?.chunkLength || 0;
            const percent =
              total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0;
            setProgress({ downloaded, total, percent, speedBytesPerSec: 0, etaSeconds: null });
          } else if (event.event === "Finished") {
            setProgress({
              downloaded: total,
              total,
              percent: 100,
              speedBytesPerSec: 0,
              etaSeconds: null,
            });
          }
        });

        setStatus("ready");
        try {
          const { relaunch } = await import("@tauri-apps/plugin-process");
          await relaunch();
        } catch {
          window.location.reload();
        }
      } catch (e: any) {
        console.error("[AutoUpdater] Download/Install failed:", e);
        const errMsg =
          typeof e === "string" ? e : e?.message || "Failed to download and install update";
        setError(errMsg);
        setStatus("error");
      }
      return;
    }

    // portable: download, then apply immediately.
    if (!updateObj || !portableUrl) return;
    const path = await portableDownload();
    if (path) portableApply(path);
  }, [installMode, updateObj, portableUrl, portableDownload, portableApply]);

  const downloadUpdate = useCallback(async () => {
    if (installMode === "nsis") {
      // The nsis updater buffers the whole artifact in memory; a background
      // download isn't supported, so fall back to install-now.
      await installUpdate();
      return;
    }
    if (!updateObj || !portableUrl) return;
    await portableDownload();
  }, [installMode, updateObj, portableUrl, installUpdate, portableDownload]);

  const applyUpdate = useCallback(async () => {
    if (installMode === "nsis") {
      // Dead-but-harmless on Windows (the installer already relaunched);
      // required on other platforms.
      try {
        const { relaunch } = await import("@tauri-apps/plugin-process");
        await relaunch();
      } catch {
        window.location.reload();
      }
      return;
    }
    if (stagedPath) portableApply(stagedPath);
  }, [installMode, stagedPath, portableApply]);

  const cancelDownload = useCallback(async () => {
    if (installMode === "portable") {
      try {
        await invoke("portable_update_cancel");
      } catch {
        // Already finished or cancelled.
      }
      setStatus("idle");
    }
    // nsis: no-op (the download is in-memory inside downloadAndInstall).
  }, [installMode]);

  const skipVersion = useCallback(() => {
    if (!updateInfo?.version) return;
    try {
      localStorage.setItem("gamelib.skipped_version", updateInfo.version);
    } catch {
      // Ignore storage errors
    }
    setShowModal(false);
    setStatus("up-to-date");
  }, [updateInfo]);

  const snoozeUpdate = useCallback((hours = 24) => {
    try {
      localStorage.setItem(
        "gamelib.update_snoozed_until",
        String(Date.now() + hours * 3600_000),
      );
    } catch {
      // Ignore storage errors
    }
    setShowModal(false);
    setStatus("up-to-date");
  }, []);

  useEffect(() => {
    if (autoCheckUpdates) {
      const timer = setTimeout(() => {
        void checkForUpdates(false);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [autoCheckUpdates, checkForUpdates]);

  return (
    <UpdateContext.Provider
      value={{
        installMode,
        autoCheckUpdates,
        setAutoCheckUpdates,
        status,
        updateInfo,
        error,
        progress,
        lastCheckedAt,
        checkForUpdates,
        installUpdate,
        downloadUpdate,
        applyUpdate,
        cancelDownload,
        skipVersion,
        snoozeUpdate,
        showModal,
        setShowModal,
      }}
    >
      {children}
    </UpdateContext.Provider>
  );
}

export function useUpdate() {
  const ctx = useContext(UpdateContext);
  if (!ctx) {
    throw new Error("useUpdate must be used within an UpdateProvider");
  }
  return ctx;
}
