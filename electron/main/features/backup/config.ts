/**
 * Backup configuration & automation preferences (ported from
 * `src-tauri/src/backup.rs`).
 *
 * Stored in `kv.db` under the same keys the Rust build used, so a profile
 * carried over from the Tauri era keeps its folder and retention choice. The
 * Electron build adds three optional fields (artwork cap / opt-in logs) that
 * the renderer round-trips because it spreads the config it was given.
 */
import fs from "node:fs";
import path from "node:path";
import { userDataPath } from "../../lib/paths";
import { ensureStorage, kvGet, kvSet } from "../../state/db";

const KV_CONFIG_BACKUP_DIR = "backup.config.dir";
const KV_CONFIG_AUTO_BACKUP_ON_EXIT = "backup.config.auto_on_exit";
const KV_CONFIG_RETENTION = "backup.config.retention";
const KV_CONFIG_SAFETY_BACKUP = "backup.config.safety_backup";
const KV_CONFIG_ARTWORK = "backup.config.artwork";
const KV_CONFIG_ARTWORK_CAP = "backup.config.artwork_cap";
const KV_CONFIG_LOGS = "backup.config.logs";

/** Bytes of re-downloadable artwork a full backup may carry (50 MB). */
export const DEFAULT_ARTWORK_CAP_BYTES = 50 * 1024 * 1024;
/** No single artwork file above this size is ever packed. */
export const MAX_ARTWORK_FILE_BYTES = 10 * 1024 * 1024;

export interface BackupConfig {
  backupDir: string;
  autoBackupOnExit: boolean;
  retentionCount: number;
  safetyBackupBeforeRestore: boolean;
  /** Pack custom artwork when the total stays under the cap. */
  includeArtwork: boolean;
  /** Total artwork budget; larger caches are skipped rather than truncated. */
  artworkCapBytes: number;
  /** Opt-in: `crashlog/` is never archived unless this is true. */
  includeLogs: boolean;
}

function readFlag(key: string, fallback: boolean): boolean {
  const raw = kvGet(key);
  if (raw === null) return fallback;
  return raw.trim() === "true" || raw.trim() === "1";
}

function readInt(key: string, fallback: number): number {
  const raw = kvGet(key);
  if (raw === null) return fallback;
  const value = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** `<userData>/backups`, created on first use. */
export function defaultBackupDir(): string {
  const dir = path.join(userDataPath(), "backups");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Resolve the configured or default backup directory. */
export function resolveBackupDir(): string {
  ensureStorage("kv");
  const custom = kvGet(KV_CONFIG_BACKUP_DIR)?.trim();
  if (custom) {
    try {
      fs.mkdirSync(custom, { recursive: true });
    } catch {
      /* fall back to the default below when the folder is unusable */
    }
    if (fs.existsSync(custom)) return custom;
  }
  return defaultBackupDir();
}

export function getConfig(): BackupConfig {
  ensureStorage("kv");
  return {
    backupDir: resolveBackupDir(),
    autoBackupOnExit: readFlag(KV_CONFIG_AUTO_BACKUP_ON_EXIT, false),
    retentionCount: readInt(KV_CONFIG_RETENTION, 5),
    safetyBackupBeforeRestore: readFlag(KV_CONFIG_SAFETY_BACKUP, true),
    includeArtwork: readFlag(KV_CONFIG_ARTWORK, true),
    artworkCapBytes: readInt(KV_CONFIG_ARTWORK_CAP, DEFAULT_ARTWORK_CAP_BYTES),
    includeLogs: readFlag(KV_CONFIG_LOGS, false),
  };
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asInt(value: unknown, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(0, Math.trunc(n)));
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/** Normalize and persist the config, returning the stored value. */
export function saveConfig(raw: unknown): BackupConfig {
  ensureStorage("kv");
  const current = getConfig();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return current;
  const input = raw as Partial<BackupConfig>;
  const next: BackupConfig = {
    backupDir: asString(input.backupDir, current.backupDir).trim() || current.backupDir,
    autoBackupOnExit: asBool(input.autoBackupOnExit, current.autoBackupOnExit),
    retentionCount: asInt(input.retentionCount, current.retentionCount, 999),
    safetyBackupBeforeRestore: asBool(
      input.safetyBackupBeforeRestore,
      current.safetyBackupBeforeRestore,
    ),
    includeArtwork: asBool(input.includeArtwork, current.includeArtwork),
    artworkCapBytes: asInt(
      input.artworkCapBytes,
      current.artworkCapBytes,
      2 * 1024 * 1024 * 1024,
    ),
    includeLogs: asBool(input.includeLogs, current.includeLogs),
  };

  try {
    fs.mkdirSync(next.backupDir, { recursive: true });
  } catch (error) {
    throw new Error(
      `Create backup directory failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  kvSet(KV_CONFIG_BACKUP_DIR, next.backupDir);
  kvSet(KV_CONFIG_AUTO_BACKUP_ON_EXIT, String(next.autoBackupOnExit));
  kvSet(KV_CONFIG_RETENTION, String(next.retentionCount));
  kvSet(KV_CONFIG_SAFETY_BACKUP, String(next.safetyBackupBeforeRestore));
  kvSet(KV_CONFIG_ARTWORK, String(next.includeArtwork));
  kvSet(KV_CONFIG_ARTWORK_CAP, String(next.artworkCapBytes));
  kvSet(KV_CONFIG_LOGS, String(next.includeLogs));
  return next;
}
