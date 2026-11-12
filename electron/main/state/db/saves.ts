/**
 * `saves` domain repository (mirrors `src-tauri/src/db/saves.rs`).
 *
 * Two tables (`save_locations`, `save_backups`) plus the user settings, which
 * the Rust build kept in `kv_store` under `saves.settings`. Only the metadata
 * the UI lists is here — a snapshot's files live in the configured backup
 * folder.
 */
import { kvGetJson, kvSetJson, prepare } from "./sqlite";

export interface SaveLocation {
  id: string;
  gameId: string;
  path: string;
  label: string;
  kind: string;
  source: string;
  include: boolean;
  createdAt: number;
  updatedAt: number;
  lastBackupAt?: number | null;
  lastRestoreAt?: number | null;
}

export interface SaveBackup {
  id: string;
  gameId: string;
  gameName: string;
  createdAt: number;
  kind: string;
  note: string;
  locationCount: number;
  fileCount: number;
  totalBytes: number;
  status: string;
  error?: string | null;
  rootPath: string;
  manifestPath: string;
}

/** Stored settings blob; the command layer normalizes it into `SavesSettings`. */
export type SavesSettingsBlob = Record<string, unknown>;

const LOCATION_SELECT =
  "SELECT id, game_id, path, label, kind, source, include, created_at, updated_at, " +
  "last_backup_at, last_restore_at FROM save_locations";

const BACKUP_SELECT =
  "SELECT id, game_id, game_name, created_at, kind, note, location_count, file_count, " +
  "total_bytes, status, error, root_path, manifest_path FROM save_backups";

const KV_SETTINGS_KEY = "saves.settings";

function num(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : fallback;
}

function nullableNum(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return num(value);
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function decodeLocation(row: Record<string, unknown>): SaveLocation {
  return {
    id: str(row.id),
    gameId: str(row.game_id),
    path: str(row.path),
    label: str(row.label),
    kind: str(row.kind, "dir"),
    source: str(row.source, "manual"),
    include: num(row.include, 1) !== 0,
    createdAt: num(row.created_at),
    updatedAt: num(row.updated_at),
    lastBackupAt: nullableNum(row.last_backup_at),
    lastRestoreAt: nullableNum(row.last_restore_at),
  };
}

function decodeBackup(row: Record<string, unknown>): SaveBackup {
  const backup: SaveBackup = {
    id: str(row.id),
    gameId: str(row.game_id),
    gameName: str(row.game_name),
    createdAt: num(row.created_at),
    kind: str(row.kind, "manual"),
    note: str(row.note),
    locationCount: num(row.location_count),
    fileCount: num(row.file_count),
    totalBytes: num(row.total_bytes),
    status: str(row.status, "complete"),
    rootPath: str(row.root_path),
    manifestPath: str(row.manifest_path),
  };
  if (typeof row.error === "string" && row.error.length > 0) backup.error = row.error;
  return backup;
}

/** Settings blob (`null` on first run, mirroring the empty JSON document). */
export function getSavesSettings(): SavesSettingsBlob | null {
  return kvGetJson<SavesSettingsBlob>(KV_SETTINGS_KEY);
}

export function setSavesSettings(settings: SavesSettingsBlob): void {
  kvSetJson(KV_SETTINGS_KEY, settings);
}

export function listSaveLocations(): SaveLocation[] {
  const rows = prepare(
    "saves",
    `${LOCATION_SELECT} ORDER BY rowid ASC`,
  ).all() as Record<string, unknown>[];
  return rows.map(decodeLocation);
}

export function listSaveBackups(): SaveBackup[] {
  const rows = prepare(
    "saves",
    `${BACKUP_SELECT} ORDER BY rowid ASC`,
  ).all() as Record<string, unknown>[];
  return rows.map(decodeBackup);
}

export function upsertSaveLocation(location: SaveLocation): void {
  prepare(
    "saves",
    `INSERT INTO save_locations(id, game_id, path, label, kind, source, include, created_at, updated_at, last_backup_at, last_restore_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
         game_id        = excluded.game_id,
         path           = excluded.path,
         label          = excluded.label,
         kind           = excluded.kind,
         source         = excluded.source,
         include        = excluded.include,
         updated_at     = excluded.updated_at,
         last_backup_at = excluded.last_backup_at,
         last_restore_at= excluded.last_restore_at`,
  ).run(
    location.id,
    location.gameId,
    location.path,
    location.label,
    location.kind,
    location.source,
    location.include ? 1 : 0,
    location.createdAt,
    location.updatedAt,
    location.lastBackupAt ?? null,
    location.lastRestoreAt ?? null,
  );
}

export function deleteSaveLocation(id: string): number {
  return prepare("saves", "DELETE FROM save_locations WHERE id = ?").run(id).changes;
}

/** Import helpers: keep rows that already exist (by id). */
export function insertMissingSaveLocations(locations: SaveLocation[]): number {
  const insert = prepare(
    "saves",
    `INSERT OR IGNORE INTO save_locations(id, game_id, path, label, kind, source, include, created_at, updated_at, last_backup_at, last_restore_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  let written = 0;
  for (const location of locations) {
    written += insert.run(
      location.id,
      location.gameId,
      location.path,
      location.label,
      location.kind,
      location.source,
      location.include ? 1 : 0,
      location.createdAt,
      location.updatedAt,
      location.lastBackupAt ?? null,
      location.lastRestoreAt ?? null,
    ).changes;
  }
  return written;
}

export function insertMissingSaveBackups(backups: SaveBackup[]): number {
  const insert = prepare(
    "saves",
    `INSERT OR IGNORE INTO save_backups(id, game_id, game_name, created_at, kind, note, location_count, file_count, total_bytes, status, error, root_path, manifest_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  let written = 0;
  for (const backup of backups) {
    written += insert.run(
      backup.id,
      backup.gameId,
      backup.gameName,
      backup.createdAt,
      backup.kind,
      backup.note,
      backup.locationCount,
      backup.fileCount,
      backup.totalBytes,
      backup.status,
      backup.error ?? null,
      backup.rootPath,
      backup.manifestPath,
    ).changes;
  }
  return written;
}
