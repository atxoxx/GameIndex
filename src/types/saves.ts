/**
 * Save Backups — frontend mirrors of the Rust serde models in
 * `src-tauri/src/db/saves.rs` and `src-tauri/src/saves/mod.rs`.
 * Keep camelCase field names in sync with the Rust `rename_all`.
 */

/** How a save location was found. */
export type SaveLocationSource =
  | "curated"
  | "heuristic"
  | "steam"
  | "emulator"
  | "pcgamingwiki"
  | "manual";

/** One folder or file that holds a game's save data. */
export interface SaveLocation {
  id: string;
  gameId: string;
  /** Absolute path. */
  path: string;
  label: string;
  /** `"dir"` or `"file"`. */
  kind: string;
  source: SaveLocationSource;
  /** Whether this location participates in backups. */
  include: boolean;
  createdAt: number;
  updatedAt: number;
  lastBackupAt?: number | null;
  lastRestoreAt?: number | null;
}

/** Snapshot kind, shown as a badge. */
export type SaveBackupKind = "manual" | "auto-exit" | "pre-restore";

/** One snapshot in the backup index. */
export interface SaveBackup {
  id: string;
  gameId: string;
  gameName: string;
  /** Unix ms. */
  createdAt: number;
  kind: SaveBackupKind | string;
  note: string;
  locationCount: number;
  fileCount: number;
  totalBytes: number;
  status: "complete" | "partial" | "failed" | string;
  error?: string | null;
  rootPath: string;
  manifestPath: string;
}

/** User configuration for the suite. */
export interface SavesSettings {
  /** Master switch gating the nav tab + per-game tab. */
  enabled: boolean;
  backupDir: string;
  autoBackupOnExit: boolean;
  includeEmulatorSaves: boolean;
  /** Consult PCGamingWiki for save paths local detection missed. */
  includePcgw: boolean;
  /** Keep at most this many snapshots per game (0 = unlimited). */
  retention: number;
  restoreSafetySnapshot: boolean;
  /** File globs skipped during backup (empty = built-in defaults). */
  ignorePatterns: string[];
  lastScanAt: number;
}

/** Overview payload for the Saves page header. */
export interface SavesSummary {
  enabled: boolean;
  backupDir: string;
  gamesWithLocations: number;
  totalLocations: number;
  missingLocations: number;
  totalBackups: number;
  totalBackupBytes: number;
  lastBackupAt?: number | null;
  autoBackupOnExit: boolean;
  retention: number;
}

/** `saves-progress` event payload. */
export interface SaveProgress {
  phase: "scan" | "backup" | "restore" | string;
  gameId: string;
  gameName: string;
  current: number;
  total: number;
  percent: number;
  message: string;
}

/** Outcome of a restore. */
export interface RestoreResult {
  backupId: string;
  gameId: string;
  restoredFiles: number;
  totalBytes: number;
  safetyBackupId?: string | null;
  warnings: string[];
}

/** One location as recorded in a snapshot manifest. */
export interface BackupManifestLocation {
  index: number;
  path: string;
  kind: string;
  label: string;
  source: string;
  fileCount: number;
  totalBytes: number;
}

/** One captured file in a snapshot manifest. */
export interface ManifestFile {
  locationIndex: number;
  rel: string;
  size: number;
  modifiedMs: number;
}

/** A snapshot's manifest (used by the backup browser). */
export interface BackupManifest {
  format: string;
  version: number;
  gameId: string;
  gameName: string;
  createdAt: number;
  kind: string;
  note: string;
  locations: BackupManifestLocation[];
  files: ManifestFile[];
}

/** Human label key for a location source badge. */
export const SAVE_SOURCE_LABEL_KEY: Record<string, string> = {
  curated: "saves.source.curated",
  heuristic: "saves.source.heuristic",
  steam: "saves.source.steam",
  emulator: "saves.source.emulator",
  pcgamingwiki: "saves.source.pcgamingwiki",
  manual: "saves.source.manual",
};

/** Human label key for a snapshot kind badge. */
export const SAVE_KIND_LABEL_KEY: Record<string, string> = {
  manual: "saves.kind.manual",
  "auto-exit": "saves.kind.autoExit",
  "pre-restore": "saves.kind.preRestore",
};
