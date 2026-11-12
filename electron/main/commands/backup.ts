/**
 * Whole-app backup/restore archives and the portable-update download.
 *
 * Workstream: `backup`. Ported from `src-tauri/src/backup.rs`,
 * `backup_raw.rs` and `updater.rs` (portable download half).
 *
 * Archives are managed by `features/backup/archive.ts`; this module is the thin
 * command layer that maps renderer argument names and emits the
 * `backup-progress` event the Settings → Backup modal listens for.
 */
import { emit, registerCommands, type CommandArgs, type CommandContext, type CommandHandler } from "../ipc";
import {
  BackupProgressReporter,
  createArchive,
  deleteArchive,
  detectCloudPaths,
  diffArchive,
  exportArchive,
  getStatus,
  inspectArchive,
  listArchives,
  pruneDir,
  quickBackupPath,
  restoreArchive,
  verifyArchive,
} from "../features/backup/archive";
import { getConfig, saveConfig } from "../features/backup/config";
import {
  cancelPortableUpdate,
  downloadPortableUpdate,
} from "../features/backup/portableUpdate";

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((entry): entry is string => typeof entry === "string");
}

function requirePath(value: unknown, label: string): string {
  const target = asString(value).trim();
  if (!target) throw new Error(`A ${label} is required`);
  return target;
}

/** Run an archive operation with `backup-progress` frames and a clean error. */
async function withProgress<T>(
  reporter: BackupProgressReporter,
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    reporter.fail(error instanceof Error ? error.message : String(error));
    throw error;
  }
}

export const backupCommands: Record<string, CommandHandler> = {
  /** Overview: last backup header + live size/record counts per domain. */
  backup_get_status: () => getStatus(getConfig()),

  /** Read backup configuration and preferences. */
  backup_get_config: () => getConfig(),

  /** Persist backup preferences, creating the destination folder. */
  backup_save_config: (args: CommandArgs) => saveConfig(args.config),

  /** Peek inside a `.gibak` without restoring anything. */
  backup_inspect: (args: CommandArgs) =>
    inspectArchive(requirePath(args.sourcePath ?? args.filePath, "archive path")),

  /** Snapshot the selected domains into a `.gibak` archive. */
  backup_create: async (args: CommandArgs) => {
    const targetPath = requirePath(args.targetPath ?? args.filePath, "target path");
    const reporter = new BackupProgressReporter((payload) => {
      emit("backup-progress", payload);
    });
    return withProgress(reporter, () =>
      createArchive({
        targetPath,
        domains: asStringArray(args.domains),
        note: asOptionalString(args.note),
        config: getConfig(),
        onProgress: (payload) => emit("backup-progress", payload),
      }),
    );
  },

  /** One-click backup into the configured folder, then retention pruning. */
  backup_quick_create: async (args: CommandArgs) => {
    const config = getConfig();
    const reporter = new BackupProgressReporter((payload) => {
      emit("backup-progress", payload);
    });
    const note = asOptionalString(args.note);
    const targetPath = quickBackupPath(config.backupDir, note);
    return withProgress(reporter, async () => {
      const outcome = await createArchive({
        targetPath,
        config,
        note,
        onProgress: (payload) => emit("backup-progress", payload),
      });
      pruneDir(config.backupDir, config.retentionCount);
      return outcome;
    });
  },

  /** Restore selected domains, optionally writing a pre-restore safety copy. */
  backup_restore: async (args: CommandArgs) => {
    const config = getConfig();
    const reporter = new BackupProgressReporter((payload) => {
      emit("backup-progress", payload);
    });
    const sourcePath = requirePath(args.sourcePath ?? args.filePath, "archive path");
    const createSafety =
      typeof args.createSafetySnapshot === "boolean"
        ? args.createSafetySnapshot
        : config.safetyBackupBeforeRestore;
    return withProgress(reporter, () =>
      restoreArchive({
        sourcePath,
        domains: asStringArray(args.domains),
        mode: asOptionalString(args.mode),
        createSafetySnapshot: createSafety,
        config,
        onProgress: (payload) => emit("backup-progress", payload),
      }),
    );
  },

  /** Every discovered `.gibak`/`.zip` archive in a folder. */
  backup_list_archives: (args: CommandArgs) => {
    const custom = asOptionalString(args.customDir ?? args.custom_dir);
    return listArchives(custom ?? getConfig().backupDir);
  },

  /** Delete one archive file (refuses anything but `.gibak`/`.zip`). */
  backup_delete_archive: (args: CommandArgs) =>
    deleteArchive(requirePath(args.filePath ?? args.sourcePath, "archive path")),

  /** Test zip validity, manifest, and each domain payload. */
  backup_verify_archive: (args: CommandArgs) =>
    verifyArchive(requirePath(args.filePath ?? args.sourcePath, "archive path")),

  /** Compare an archive's record counts against the live data. */
  backup_diff_archive: (args: CommandArgs) =>
    diffArchive(requirePath(args.filePath ?? args.sourcePath, "archive path")),

  /** Copy an archive into another folder (e.g. a cloud-sync directory). */
  backup_export_archive: (args: CommandArgs) =>
    exportArchive(
      requirePath(args.sourcePath ?? args.filePath, "archive path"),
      requirePath(args.targetDir, "destination folder"),
    ),

  /** OneDrive / Dropbox / Drive / Nextcloud folders that exist on this host. */
  backup_detect_cloud_paths: () => detectCloudPaths(),

  /**
   * Stream a portable update artifact to staging with progress.
   *
   * Resumable: an interrupted transfer keeps `<file>.part` and the next call
   * continues from that offset with a `Range` request. Cancellable through
   * `portable_update_cancel`.
   */
  portable_update_download: (args: CommandArgs, context: CommandContext) =>
    downloadPortableUpdate(args, context),

  /** Abort an in-flight portable download (overrides the old no-op). */
  portable_update_cancel: () => {
    cancelPortableUpdate();
    return null;
  },
};

export function registerBackupCommands(): void {
  registerCommands(backupCommands, { override: true });
}
