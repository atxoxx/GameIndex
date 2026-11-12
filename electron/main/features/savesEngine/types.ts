/**
 * Shared shapes for the save-backup engine.
 *
 * The persisted rows (`SaveLocation` / `SaveBackup`) are owned by
 * `state/db/saves.ts`; everything in this folder works with those objects and
 * adds the on-disk manifest format the engine writes.
 */

/** Phase carried by a `saves-progress` event (see `src/types/saves.ts`). */
export type SaveProgressPhase = "scan" | "backup" | "restore";

/** Exact payload shape the renderer's `SavesContext` listens for. */
export interface SaveProgressPayload {
  phase: SaveProgressPhase;
  gameId: string;
  gameName: string;
  current: number;
  total: number;
  percent: number;
  message: string;
}

/** One candidate location found by detection, before it is persisted. */
export interface DetectedLocation {
  /** Absolute path with forward slashes (the shape stored in SQLite). */
  path: string;
  label: string;
  /** `"dir"` or `"file"`. */
  kind: string;
  /** `curated | heuristic | steam | emulator`. */
  source: string;
}

/** One location recorded in a snapshot manifest. */
export interface SaveManifestLocation {
  index: number;
  /** Original absolute path this location was captured from. */
  path: string;
  kind: string;
  label: string;
  source: string;
  fileCount: number;
  totalBytes: number;
}

/** One captured file within a location. */
export interface SaveManifestFile {
  locationIndex: number;
  /** Path relative to the location root, forward-slash separated. */
  rel: string;
  size: number;
  modifiedMs: number;
  /** Lowercase hex SHA-256 of the captured bytes. */
  hash: string;
  /**
   * Archive entry holding the bytes when this file duplicates another one
   * (content dedupe). Absent when the file's own entry is authoritative.
   */
  dedupe?: string;
}

/** A snapshot manifest (also returned by `saves_get_backup_manifest`). */
export interface SaveManifest {
  format: "gameindex-save-backup";
  /** 2 adds per-file hashes + dedupe pointers; 1 was the hash-less layout. */
  version: number;
  gameId: string;
  gameName: string;
  createdAt: number;
  kind: string;
  note: string;
  locations: SaveManifestLocation[];
  files: SaveManifestFile[];
  /** Number of files whose bytes were not stored again (content dedupe). */
  dedupedFiles?: number;
  /** Non-fatal capture problems (locked files, vanished folders, …). */
  warnings?: string[];
}

/** Outcome of a restore, surfaced to the UI. */
export interface SaveRestoreResult {
  backupId: string;
  gameId: string;
  restoredFiles: number;
  totalBytes: number;
  safetyBackupId?: string | null;
  warnings: string[];
}

/** Normalized save-suite settings (mirrors `SavesSettings`). */
export interface SaveEngineSettings {
  enabled: boolean;
  backupDir: string;
  autoBackupOnExit: boolean;
  includeEmulatorSaves: boolean;
  includePcgw: boolean;
  retention: number;
  restoreSafetySnapshot: boolean;
  ignorePatterns: string[];
  lastScanAt: number;
}
