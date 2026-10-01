/**
 * Types mirroring the Rust models in `src-tauri/src/backup.rs`.
 */

/** One row of the backup overview. */
export interface DomainStatus {
  name: string;
  sizeBytes: number;
  itemCount?: number;
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
}

/** Payload from `backup_inspect`. */
export interface BackupInspect {
  createdAt: number;
  appVersion: string;
  domains: string[];
  isRaw?: boolean;
  counts?: Record<string, number>;
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

/** Backup configuration & automation preferences. */
export interface BackupConfig {
  backupDir: string;
  autoBackupOnExit: boolean;
  retentionCount: number;
  safetyBackupBeforeRestore: boolean;
}

/** Quick selection presets for database backup creation. */
export type BackupPreset = "full" | "essential" | "minimal" | "custom";

/** Subtabs inside the Backup page. */
export type BackupSubtab = "overview" | "create" | "restore" | "settings";

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

/** Record comparison detail for a single domain between archive and live database. */
export interface DomainDiffDetail {
  domain: string;
  archiveCount: number;
  liveCount: number;
  delta: number;
}

/** Diff comparison report between an archive and the live database. */
export interface BackupDiffReport {
  filePath: string;
  archiveCreatedAt: number;
  archiveTotalRecords: number;
  liveTotalRecords: number;
  recordDelta: number;
  domains: DomainDiffDetail[];
}

/** Detected local cloud sync provider directory option. */
export interface CloudPathOption {
  provider: string;
  path: string;
  exists: boolean;
}

