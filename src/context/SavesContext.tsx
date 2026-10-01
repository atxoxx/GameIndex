import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { useToast } from "./ToastContext";
import { useLanguage } from "./LanguageContext";
import type {
  SaveBackup,
  SaveProgress,
  SavesSettings,
  SavesSummary,
  RestoreResult,
} from "../types/saves";

/**
 * SavesContext — single owner of the Save Backups suite's configuration
 * and global operations.
 *
 * The suite is opt-in: `settings.enabled` gates the top-nav "Saves" tab
 * and the per-game "Saves" detail tab, so both read the flag from here.
 * Settings load once on mount and every mutation round-trips through the
 * backend, which also owns the backup directory and retention policy.
 *
 * This provider also performs the "back up on game exit" behaviour: the
 * Rust watcher already emits `game-exited` (with the game id), so no
 * launch-pipeline change is needed — a short delay gives the game time
 * to flush its writes before the snapshot runs.
 */
interface SavesContextValue {
  settings: SavesSettings | null;
  summary: SavesSummary | null;
  /** True once the initial settings load has resolved. */
  ready: boolean;
  /** Convenience: `settings?.enabled ?? false`. */
  enabled: boolean;
  /** Latest `saves-progress` payload, or null when idle. */
  progress: SaveProgress | null;
  refresh: () => Promise<void>;
  updateSettings: (patch: Partial<SavesSettings>) => Promise<void>;
  /** Open a native folder picker and store the chosen backup directory. */
  pickBackupDir: () => Promise<void>;
  /** Scan the whole library for save locations. */
  scanAll: () => Promise<void>;
  restoreBackup: (backupId: string) => Promise<RestoreResult>;
  deleteBackup: (backupId: string) => Promise<void>;
  openBackup: (backupId: string) => Promise<void>;
  openPath: (path: string) => Promise<void>;
}

const SavesContext = createContext<SavesContextValue | null>(null);

/** Delay before the post-exit auto-backup so the game can flush saves. */
const AUTO_BACKUP_DELAY_MS = 2500;

export function SavesProvider({ children }: { children: ReactNode }) {
  const { showToast } = useToast();
  const { t } = useLanguage();
  const [settings, setSettings] = useState<SavesSettings | null>(null);
  const [summary, setSummary] = useState<SavesSummary | null>(null);
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState<SaveProgress | null>(null);
  const settingsRef = useRef<SavesSettings | null>(null);

  settingsRef.current = settings;

  const refresh = useCallback(async () => {
    try {
      const [nextSettings, nextSummary] = await Promise.all([
        invoke<SavesSettings>("saves_get_settings"),
        invoke<SavesSummary>("saves_summary"),
      ]);
      setSettings(nextSettings);
      setSummary(nextSummary);
    } catch {
      // Frontend-only dev (Tauri stubbed) or a backend hiccup: leave the
      // feature disabled rather than surfacing an error on boot.
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Progress events drive the shared scan/backup progress bars.
  useEffect(() => {
    const unlistenPromise = listen<SaveProgress>("saves-progress", (event) => {
      const payload = event.payload;
      setProgress(payload.percent >= 100 ? null : payload);
      if (payload.percent >= 100) {
        void refresh();
      }
    });
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [refresh]);

  const updateSettings = useCallback(
    async (patch: Partial<SavesSettings>) => {
      const current = settingsRef.current;
      if (!current) return;
      const next = await invoke<SavesSettings>("saves_set_settings", {
        settings: { ...current, ...patch },
      });
      setSettings(next);
      settingsRef.current = next;
      void refresh();
    },
    [refresh]
  );

  const pickBackupDir = useCallback(async () => {
    try {
      const picked = await open({
        directory: true,
        multiple: false,
        title: t("saves.settings.backupDir"),
      });
      if (typeof picked === "string" && picked) {
        await updateSettings({ backupDir: picked });
      }
    } catch {
      /* dialog cancelled or unavailable */
    }
  }, [t, updateSettings]);

  const scanAll = useCallback(async () => {
    try {
      await invoke<number>("saves_detect_all");
      await refresh();
      showToast(t("saves.toast.scanDone"), "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
    }
  }, [refresh, showToast, t]);

  const restoreBackup = useCallback(
    async (backupId: string) => {
      const result = await invoke<RestoreResult>("saves_restore_backup", {
        backupId,
      });
      await refresh();
      return result;
    },
    [refresh]
  );

  const deleteBackup = useCallback(
    async (backupId: string) => {
      await invoke<number>("saves_delete_backup", { backupId });
      await refresh();
    },
    [refresh]
  );

  const openBackup = useCallback(async (backupId: string) => {
    await invoke("saves_open_backup", { backupId });
  }, []);

  const openPath = useCallback(async (path: string) => {
    await invoke("saves_open_path", { path });
  }, []);

  // ── Back up on game exit ────────────────────────────────────────────
  // Only games that already have configured locations are backed up, so
  // an exit never triggers an error toast for a game with no save data.
  useEffect(() => {
    let disposed = false;
    const unlistenPromise = listen<{ gameId: string }>("game-exited", (event) => {
      const { gameId } = event.payload;
      if (!gameId || disposed) return;
      window.setTimeout(async () => {
        const current = settingsRef.current;
        if (!current?.enabled || !current.autoBackupOnExit) return;
        try {
          const locations = await invoke<unknown[]>("saves_list_locations", {
            gameId,
          });
          if (locations.length === 0) return;
          const backup = await invoke<SaveBackup>("saves_backup_game", {
            gameId,
            note: t("saves.autoExitNote"),
          });
          await refresh();
          showToast(t("saves.toast.autoBackup", { name: backup.gameName }), "success");
        } catch {
          /* silent: an auto-backup failure must not interrupt the user */
        }
      }, AUTO_BACKUP_DELAY_MS);
    });
    return () => {
      disposed = true;
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [refresh, showToast, t]);

  const value = useMemo<SavesContextValue>(
    () => ({
      settings,
      summary,
      ready,
      enabled: settings?.enabled ?? false,
      progress,
      refresh,
      updateSettings,
      pickBackupDir,
      scanAll,
      restoreBackup,
      deleteBackup,
      openBackup,
      openPath,
    }),
    [
      settings,
      summary,
      ready,
      progress,
      refresh,
      updateSettings,
      pickBackupDir,
      scanAll,
      restoreBackup,
      deleteBackup,
      openBackup,
      openPath,
    ]
  );

  return <SavesContext.Provider value={value}>{children}</SavesContext.Provider>;
}

export function useSaves(): SavesContextValue {
  const ctx = useContext(SavesContext);
  if (!ctx) {
    throw new Error("useSaves must be used within a SavesProvider");
  }
  return ctx;
}
