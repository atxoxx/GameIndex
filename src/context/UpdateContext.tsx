import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";

const LS_AUTO_CHECK_UPDATES = "gamelib.auto_check_updates";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "up-to-date"
  | "downloading"
  | "ready"
  | "error";

export interface UpdateInfo {
  version: string;
  body?: string;
  date?: string;
}

export interface UpdateProgress {
  downloaded: number;
  total: number;
  percent: number;
}

export interface UpdateContextValue {
  autoCheckUpdates: boolean;
  setAutoCheckUpdates: (enabled: boolean) => void;
  status: UpdateStatus;
  updateInfo: UpdateInfo | null;
  error: string | null;
  progress: UpdateProgress;
  checkForUpdates: (manual?: boolean) => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  showModal: boolean;
  setShowModal: (show: boolean) => void;
}

const UpdateContext = createContext<UpdateContextValue | null>(null);

export function UpdateProvider({ children }: { children: ReactNode }) {
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
  });
  const [showModal, setShowModal] = useState<boolean>(false);
  const [updateObj, setUpdateObj] = useState<any>(null);

  const setAutoCheckUpdates = useCallback((enabled: boolean) => {
    setAutoCheckUpdatesState(enabled);
    try {
      localStorage.setItem(LS_AUTO_CHECK_UPDATES, String(enabled));
    } catch {
      // Ignore storage errors
    }
  }, []);

  const checkForUpdates = useCallback(async (manual = false) => {
    setStatus("checking");
    setError(null);
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (update && update.available) {
        setUpdateObj(update);
        setUpdateInfo({
          version: update.version,
          body: update.body || undefined,
          date: update.date || undefined,
        });
        setStatus("available");
        if (manual) {
          setShowModal(true);
        }
      } else {
        setUpdateObj(null);
        setUpdateInfo(null);
        setStatus("up-to-date");
      }
    } catch (e: any) {
      console.warn("[AutoUpdater] Check failed:", e);
      const errMsg =
        typeof e === "string"
          ? e
          : e?.message || "Failed to check for updates";

      // If GitHub Releases does not have a published release/latest.json yet (404/invalid JSON)
      if (
        errMsg.includes("Could not fetch a valid release JSON") ||
        errMsg.includes("404") ||
        errMsg.includes("NotFound")
      ) {
        setUpdateObj(null);
        setUpdateInfo(null);
        setStatus("up-to-date");
        if (manual) {
          setError("No release published on GitHub yet.");
        }
      } else {
        setError(errMsg);
        setStatus("error");
      }
    }
  }, []);

  const downloadAndInstall = useCallback(async () => {
    if (!updateObj) return;
    setStatus("downloading");
    setError(null);
    setProgress({ downloaded: 0, total: 0, percent: 0 });

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
          setProgress({ downloaded, total, percent });
        } else if (event.event === "Finished") {
          setProgress({ downloaded: total, total, percent: 100 });
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
        typeof e === "string"
          ? e
          : e?.message || "Failed to download and install update";
      setError(errMsg);
      setStatus("error");
    }
  }, [updateObj]);

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
        autoCheckUpdates,
        setAutoCheckUpdates,
        status,
        updateInfo,
        error,
        progress,
        checkForUpdates,
        downloadAndInstall,
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
