/**
 * Shapes for the whole-app backup engine.
 *
 * These mirror `src-tauri/src/backup.rs` (and `backup_raw.rs` for the manifest)
 * so the already-written Settings → Backup UI renders them unchanged.
 */

/** Progress update emitted on `backup-progress` (matches BackupProgressModal). */
export interface BackupProgressPayload {
  phase: string;
  currentDomain: string | null;
  domainIndex: number;
  totalDomains: number;
  percent: number;
  bytesWritten: number;
  message: string;
}

/** One row of the backup overview. */
export interface DomainStatus {
  name: string;
  sizeBytes: number;
  itemCount: number;
}

/** Status payload from `backup_get_status`. */
export interface BackupStatus {
  lastBackupAt: number | null;
  lastBackupBytes: number | null;
  domains: DomainStatus[];
}

/** Outcome payload from create/restore. */
export interface BackupOutcome {
  filePath: string;
  sizeBytes: number;
  createdAt: number;
  domains: string[];
  /** Electron-only hint: the renderer already shows its restart dialog. */
  restartRequired?: boolean;
  skippedDomains?: string[];
}

/** Payload from `backup_inspect`. */
export interface BackupInspect {
  createdAt: number;
  appVersion: string;
  domains: string[];
  isRaw: boolean;
  counts: Record<string, number>;
}

/** Summary of a discovered archive in the backup directory. */
export interface BackupArchiveSummary {
  filePath: string;
  fileName: string;
  sizeBytes: number;
  createdAt: number;
  appVersion: string;
  domains: string[];
  domainCount: number;
  totalRecords: number;
  isRaw: boolean;
  counts: Record<string, number>;
}

/** Verification detail for a single domain in an archive. */
export interface DomainVerifyDetail {
  domain: string;
  valid: boolean;
  recordsFound: number;
  error?: string | null;
}

/** Comprehensive archive verification report. */
export interface BackupVerifyReport {
  filePath: string;
  valid: boolean;
  isRaw: boolean;
  formatVersion: number;
  totalDomains: number;
  healthyDomains: number;
  corruptedDomains: string[];
  totalRecords: number;
  details: DomainVerifyDetail[];
  message: string;
}

/** Record comparison detail for a single domain. */
export interface DomainDiffDetail {
  domain: string;
  archiveCount: number;
  liveCount: number;
  delta: number;
}

/** Diff comparison report between an archive and the live data. */
export interface BackupDiffReport {
  filePath: string;
  archiveCreatedAt: number;
  archiveTotalRecords: number;
  liveTotalRecords: number;
  recordDelta: number;
  domains: DomainDiffDetail[];
}

/** Detected local cloud sync provider directory. */
export interface CloudPathOption {
  provider: string;
  path: string;
  exists: boolean;
}

/** Manifest written to `manifest.json` inside a `.gibak` archive. */
export interface ArchiveManifest {
  format: string;
  version: number;
  appVersion: string;
  /** Unix seconds (the Backup tab formats epoch seconds). */
  createdAt: number;
  domains: string[];
  counts: Record<string, number>;
  /** Domain → archive entry path. */
  entries: Record<string, string>;
  note?: string;
  /** Domains the user selected that could not be captured (size caps). */
  skipped?: string[];
}

/** Archive kinds a domain can have. */
export type DomainKind = "db" | "json" | "dir";
