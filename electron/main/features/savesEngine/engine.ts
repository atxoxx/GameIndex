/**
 * Save-snapshot engine (ported from `src-tauri/src/saves/engine.rs`).
 *
 * One snapshot is a single Deflated zip:
 *
 * ```text
 * <backupDir>/<game-id>/<created-at>-<kind>.gisave
 *   manifest.json          # locations + per-file index (forward-slash rel paths)
 *   files/<location-index>/<relative path…>
 * ```
 *
 * The manifest is the source of truth for restore, so a snapshot stays usable
 * even when the SQLite index is lost. Restore refuses to write outside the
 * recorded location root (zip-slip guard). Legacy directory snapshots — both
 * the Rust-era `files/` layout and the first Electron port's nested
 * `backup.zip` — stay readable.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { SaveBackup, SaveLocation } from "../../state/db";
import {
  defaultIgnorePatterns,
  entryNameFor,
  isArchivePath,
  isInside,
  isInsideAny,
  isIgnored,
  LEGACY_ARCHIVE_NAME,
  MANIFEST_JSON,
  openSnapshotReader,
  resolveManifest,
  safeComponent,
  safeDestination,
  sha256,
  uniqueArchivePath,
  writeSnapshotArchive,
  type PendingEntry,
} from "./format";
import { cancelledError } from "./progress";
import { saveBackupRoots } from "./legacy";
import * as store from "./store";
import type {
  SaveManifest,
  SaveManifestFile,
  SaveManifestLocation,
  SaveRestoreResult,
} from "./types";

// Re-exported so callers keep one import site for the format constants.
export { MANIFEST_FORMAT, MANIFEST_VERSION } from "./format";

interface CollectedFile {
  rel: string;
  abs: string;
  size: number;
  modifiedMs: number;
}

interface LocationPlan {
  location: SaveLocation;
  missing: boolean;
  files: CollectedFile[];
}

function modifiedMsOf(target: string): number {
  try {
    return Math.trunc(fs.statSync(target).mtimeMs);
  } catch {
    return 0;
  }
}

/** Walk a directory collecting regular files (symlinks are never followed). */
async function walkFiles(
  root: string,
  dir: string,
  patterns: string[],
  out: CollectedFile[],
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw cancelledError();
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (signal?.aborted) throw cancelledError();
    if (entry.isSymbolicLink()) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(root, abs, patterns, out, signal);
      continue;
    }
    if (!entry.isFile()) continue;
    const rel = path.relative(root, abs).replace(/\\/g, "/");
    if (isIgnored(patterns, entry.name, rel)) continue;
    let size = 0;
    try {
      size = (await fsp.stat(abs)).size;
    } catch {
      continue;
    }
    out.push({ rel, abs, size, modifiedMs: modifiedMsOf(abs) });
  }
}

/** Discover every file a location would contribute. */
async function planLocation(
  location: SaveLocation,
  patterns: string[],
  signal?: AbortSignal,
): Promise<LocationPlan> {
  const root = location.path;
  const files: CollectedFile[] = [];
  let stat: fs.Stats | null = null;
  try {
    stat = await fsp.stat(root);
  } catch {
    stat = null;
  }

  if (location.kind === "file") {
    if (!stat || !stat.isFile()) return { location, missing: true, files };
    const name = path.basename(root);
    if (isIgnored(patterns, name, name)) return { location, missing: false, files };
    files.push({
      rel: name,
      abs: root,
      size: stat.size,
      modifiedMs: Math.trunc(stat.mtimeMs),
    });
    return { location, missing: false, files };
  }

  if (!stat || !stat.isDirectory()) return { location, missing: true, files };
  await walkFiles(root, root, patterns, files, signal);
  return { location, missing: false, files };
}

export interface CreateBackupOptions {
  gameId: string;
  gameName: string;
  /** Locations the user wants included (already filtered by `include`). */
  locations: SaveLocation[];
  kind: string;
  note?: string;
  backupDir: string;
  ignorePatterns: string[];
  signal?: AbortSignal;
  onProgress?: (current: number, total: number, message: string) => void;
}

/**
 * Capture `locations` into a new `.gisave` archive and index it.
 *
 * Locked or unreadable files are recorded as warnings and skipped — one file
 * held open by a running game must not fail the whole backup.
 */
export async function createBackup(options: CreateBackupOptions): Promise<SaveBackup> {
  const {
    gameId,
    gameName,
    locations,
    kind,
    note = "",
    backupDir,
    ignorePatterns,
    signal,
    onProgress,
  } = options;

  const createdAt = Date.now();
  const gameDir = path.join(backupDir, safeComponent(gameId));
  await fsp.mkdir(gameDir, { recursive: true });
  const archivePath = uniqueArchivePath(gameDir, createdAt, kind);

  try {
    // Discover first so the progress bar has an honest total.
    const plans: LocationPlan[] = [];
    let totalFiles = 0;
    for (const location of locations) {
      const plan = await planLocation(location, ignorePatterns, signal);
      plans.push(plan);
      totalFiles += plan.files.length;
    }
    onProgress?.(0, totalFiles, "Collecting save files");

    const entries: PendingEntry[] = [];
    const manifestLocations: SaveManifestLocation[] = [];
    const manifestFiles: SaveManifestFile[] = [];
    const errors: string[] = [];
    let done = 0;
    let copiedLocations = 0;

    for (let index = 0; index < plans.length; index += 1) {
      const plan = plans[index];
      const location = plan.location;
      let locationBytes = 0;
      let locationFiles = 0;

      onProgress?.(done, totalFiles, `Backing up ${location.label || location.path}`);

      for (const file of plan.files) {
        if (signal?.aborted) throw cancelledError();
        let bytes: Buffer;
        try {
          bytes = await fsp.readFile(file.abs);
        } catch (error) {
          const code =
            (error as NodeJS.ErrnoException).code ?? (error as Error).message;
          errors.push(`${file.rel}: ${code}`);
          done += 1;
          continue;
        }

        entries.push({ entry: entryNameFor(index, file.rel), data: bytes });
        manifestFiles.push({
          locationIndex: index,
          rel: file.rel,
          size: bytes.byteLength,
          modifiedMs: file.modifiedMs,
        });
        locationFiles += 1;
        locationBytes += bytes.byteLength;
        done += 1;
        onProgress?.(done, totalFiles, `Backing up ${location.label || location.path}`);
        // Yield so a save tree with tens of thousands of files cannot starve
        // IPC or the window while the archive is assembled.
        if (done % 500 === 0) {
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      }

      // A folder location that no longer exists is recorded as an error; a
      // single-file location that vanished is simply skipped (Rust behaviour).
      if (plan.missing && location.kind !== "file") {
        errors.push(`missing: ${location.path}`);
      }
      if (locationFiles > 0 || !plan.missing) copiedLocations += 1;
      manifestLocations.push({
        index,
        path: location.path,
        kind: location.kind,
        label: location.label,
        source: location.source,
        fileCount: locationFiles,
        totalBytes: locationBytes,
      });
    }

    if (signal?.aborted) throw cancelledError();

    const status =
      errors.length === 0
        ? "complete"
        : manifestFiles.length === 0
          ? "failed"
          : "partial";
    // Exactly the Rust `BackupManifest` field set — no extra keys, so the old
    // Tauri build (and third-party tooling) can read the archive unchanged.
    const manifest: SaveManifest = {
      format: "gameindex-save-backup",
      version: 1,
      gameId,
      gameName,
      createdAt,
      kind,
      note,
      locations: manifestLocations,
      files: manifestFiles,
    };

    writeSnapshotArchive(archivePath, manifest, entries);

    const totalBytes = manifestFiles.reduce((sum, file) => sum + file.size, 0);
    const backup = store.insertBackup({
      id: `bak-${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
      gameId,
      gameName,
      createdAt,
      kind,
      note,
      locationCount: copiedLocations,
      fileCount: manifestFiles.length,
      totalBytes,
      status,
      error: errors.length > 0 ? errors.slice(0, 20).join("; ") : null,
      rootPath: archivePath,
      // The manifest lives inside the archive, not at a standalone path.
      manifestPath: "",
    });

    for (const location of locations) {
      store.touchLocationBackup(location.id, createdAt);
    }

    onProgress?.(
      Math.max(1, totalFiles),
      Math.max(1, totalFiles),
      "Backup complete",
    );
    return backup;
  } catch (error) {
    // A cancelled or failed run never leaves a half-written archive behind.
    await fsp.rm(archivePath, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Read a snapshot's manifest (archive first, then legacy directory shapes). */
export function readManifest(backup: SaveBackup): SaveManifest | null {
  return resolveManifest(backup);
}

export interface RestoreOptions {
  signal?: AbortSignal;
  onProgress?: (current: number, total: number, message: string) => void;
}

/**
 * Restore every location from a snapshot into its original place.
 *
 * Files are verified against the recorded size (and hash when the snapshot is
 * a version 2 one) before they are written; a mismatch is reported as a
 * warning and that file is left untouched.
 */
export async function restoreSnapshot(
  backup: SaveBackup,
  options: RestoreOptions = {},
): Promise<Omit<SaveRestoreResult, "backupId" | "gameId" | "safetyBackupId">> {
  const manifest = readManifest(backup);
  if (!manifest) {
    throw new Error("Backup manifest is missing or unreadable — the snapshot is incomplete");
  }

  const reader = await openSnapshotReader(backup);
  const warnings: string[] = [];
  let restoredFiles = 0;
  let totalBytes = 0;
  const total = manifest.files.length;

  for (const location of [...manifest.locations].sort((a, b) => a.index - b.index)) {
    const files = manifest.files.filter((file) => file.locationIndex === location.index);
    for (const file of files) {
      if (options.signal?.aborted) throw cancelledError();
      const destination = safeDestination(location, file.rel);
      if (!destination) {
        warnings.push(`Skipped unsafe path: ${file.rel}`);
        continue;
      }
      const entryName = file.dedupe ?? entryNameFor(location.index, file.rel);
      const data = await reader.get(entryName);
      if (!data) {
        warnings.push(`Missing backup file: ${file.rel}`);
        continue;
      }
      if (file.size >= 0 && data.byteLength !== file.size) {
        warnings.push(`Corrupt backup file (size mismatch): ${file.rel}`);
        continue;
      }
      if (file.hash && sha256(data) !== file.hash) {
        warnings.push(`Corrupt backup file (hash mismatch): ${file.rel}`);
        continue;
      }

      try {
        await fsp.mkdir(path.dirname(destination), { recursive: true });
        await fsp.writeFile(destination, data);
        restoredFiles += 1;
        totalBytes += data.byteLength;
      } catch (error) {
        warnings.push(
          `${destination}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      options.onProgress?.(restoredFiles, Math.max(1, total), `Restoring ${file.rel}`);
    }
  }

  options.onProgress?.(Math.max(1, total), Math.max(1, total), "Restore complete");
  return { restoredFiles, totalBytes, warnings };
}

function samePath(a: string, b: string): boolean {
  const normalize = (value: string): string => {
    const resolved = path.resolve(value);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalize(a) === normalize(b);
}

/** Roots a snapshot row is allowed to live under (current + retired profiles). */
function allowedSnapshotRoots(backupDir: string): string[] {
  const roots = [path.resolve(backupDir)];
  for (const candidate of saveBackupRoots()) {
    const resolved = path.resolve(candidate);
    if (!roots.some((root) => samePath(root, resolved))) roots.push(resolved);
  }
  return roots;
}

/** True when the row points inside the configured backup directory. */
export function snapshotIsManaged(backup: SaveBackup, backupDir: string): boolean {
  if (!backup.rootPath) return false;
  return isInside(backup.rootPath, backupDir);
}

/**
 * Delete a snapshot from disk, refusing anything outside the configured
 * backup directory or a retired profile's save-backup folder. Only `.gisave`
 * archives and snapshot directories (with a `manifest.json`) are removed.
 */
export async function deleteSnapshot(backup: SaveBackup, backupDir: string): Promise<void> {
  if (!backup.rootPath) return;
  const roots = allowedSnapshotRoots(backupDir);
  const target = path.resolve(backup.rootPath);
  if (!isInsideAny(target, roots) || roots.some((root) => samePath(root, target))) {
    return;
  }

  let stat: fs.Stats | null = null;
  try {
    stat = fs.lstatSync(target);
  } catch {
    return;
  }

  if (stat.isDirectory()) {
    if (!fs.existsSync(path.join(target, MANIFEST_JSON))) return;
    await fsp.rm(target, { recursive: true, force: true });
    return;
  }

  if (isArchivePath(target)) {
    await fsp.rm(target, { force: true });
    return;
  }

  // First Electron port: `<snapshot>/backup.zip`; remove its snapshot folder.
  if (path.basename(target).toLowerCase() === LEGACY_ARCHIVE_NAME) {
    const snapshotDir = path.dirname(target);
    if (
      isInsideAny(snapshotDir, roots) &&
      !roots.some((root) => samePath(root, snapshotDir)) &&
      fs.existsSync(path.join(snapshotDir, MANIFEST_JSON))
    ) {
      await fsp.rm(snapshotDir, { recursive: true, force: true });
    }
  }
}

/**
 * Prune managed snapshots for a game beyond `retention` (0 = keep all).
 *
 * Manual backups are evicted last so an auto-backup flood never removes a
 * snapshot the user explicitly asked for. Snapshots that live in a retired
 * profile folder are left alone — retention never destroys pre-migration data.
 */
export async function pruneBackups(
  gameId: string,
  retention: number,
  backupDir: string,
): Promise<void> {
  if (retention <= 0) return;
  const list = store.listBackups(gameId);
  if (list.length <= retention) return;
  const doomed = list.slice(retention);
  doomed.sort((a, b) => {
    const manualA = a.kind === "manual" ? 1 : 0;
    const manualB = b.kind === "manual" ? 1 : 0;
    return manualA - manualB || a.createdAt - b.createdAt;
  });
  for (const backup of doomed) {
    if (!snapshotIsManaged(backup, backupDir)) continue;
    await deleteSnapshot(backup, backupDir);
    store.deleteBackupRow(backup.id);
  }
}

/** Effective ignore patterns: user value when set, built-in defaults otherwise. */
export function effectiveIgnore(patterns: string[]): string[] {
  return patterns.length > 0 ? patterns : defaultIgnorePatterns();
}
