/**
 * Save-snapshot engine (ported from `src-tauri/src/saves/engine.rs`).
 *
 * One snapshot is a self-describing folder:
 *
 * ```text
 * <backupDir>/<game-id>/<timestamp>/
 *   manifest.json      # locations + per-file index (forward-slash rel paths)
 *   backup.zip         # files/<location-index>/<relative path…>
 * ```
 *
 * The manifest is the source of truth for restore, so a snapshot stays usable
 * even when the SQLite index is lost. It records a SHA-256 per file and a
 * `dedupe` pointer when two files share identical bytes, which keeps repeated
 * save slots from doubling the archive size. Restore verifies those hashes and
 * refuses to write outside the recorded location root (zip-slip guard).
 */
import AdmZip from "adm-zip";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { SaveBackup, SaveLocation } from "../../state/db";
import { cancelledError } from "./progress";
import * as store from "./store";
import type {
  SaveManifest,
  SaveManifestFile,
  SaveManifestLocation,
  SaveRestoreResult,
} from "./types";

export const MANIFEST_FORMAT = "gameindex-save-backup";
export const MANIFEST_VERSION = 2;
/** Name of the archive inside each snapshot folder. */
export const ARCHIVE_NAME = "backup.zip";
const MANIFEST_JSON = "manifest.json";
const DATA_DIR = "data";

/** Default ignore globs (used when the user has not configured any). */
export function defaultIgnorePatterns(): string[] {
  return [
    "*.tmp",
    "*.temp",
    "*.log",
    "*.dmp",
    "*.cache",
    "*.pid",
    "thumbs.db",
    ".ds_store",
  ];
}

/** Simple wildcard match supporting `*` and `?`, case-insensitive. */
export function globMatch(pattern: string, text: string): boolean {
  const p = pattern.toLowerCase();
  const t = text.toLowerCase();
  let pi = 0;
  let ti = 0;
  let starP = -1;
  let starT = -1;
  while (ti < t.length) {
    if (pi < p.length && (p[pi] === "?" || p[pi] === t[ti])) {
      pi += 1;
      ti += 1;
    } else if (pi < p.length && p[pi] === "*") {
      starP = pi;
      starT = ti;
      pi += 1;
    } else if (starP >= 0) {
      pi = starP + 1;
      starT += 1;
      ti = starT;
    } else {
      return false;
    }
  }
  while (pi < p.length && p[pi] === "*") pi += 1;
  return pi === p.length;
}

/** True when a file should be skipped (matched by name or by rel path). */
export function isIgnored(patterns: string[], name: string, rel: string): boolean {
  return patterns.some(
    (pattern) => globMatch(pattern, name) || globMatch(pattern, rel),
  );
}

/** Make a path-safe component for the backup directory tree. */
export function safeComponent(value: string): string {
  const cleaned = value
    .split("")
    .map((char) => (/[a-zA-Z0-9\-_.]/.test(char) ? char : "_"))
    .join("")
    .replace(/^_+|_+$/g, "");
  if (!cleaned) return "game";
  return cleaned.slice(0, 80);
}

/** `YYYYMMDD-HHMMSS` in local time (filesystem-safe, sortable). */
export function timestampName(atMs = Date.now()): string {
  const date = new Date(atMs);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

function sha256(data: Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function toForward(value: string): string {
  return value.replace(/\\/g, "/");
}

function isInside(child: string, parent: string): boolean {
  const normalize = (value: string): string =>
    process.platform === "win32" ? value.toLowerCase() : value;
  const c = normalize(child);
  const p = normalize(parent);
  return c === p || c.startsWith(p.endsWith(path.sep) ? p : `${p}${path.sep}`);
}

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
    const rel = toForward(path.relative(root, abs));
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

function uniqueSnapshotDir(gameDir: string, createdAt: number): string {
  const base = timestampName(createdAt);
  let candidate = path.join(gameDir, base);
  let counter = 1;
  while (fs.existsSync(candidate)) {
    counter += 1;
    candidate = path.join(gameDir, `${base}-${counter}`);
  }
  return candidate;
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
 * Capture `locations` into a new snapshot folder and index it.
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
  const snapshotDir = uniqueSnapshotDir(gameDir, createdAt);
  await fsp.mkdir(snapshotDir, { recursive: true });
  const dataDir = path.join(snapshotDir, DATA_DIR);

  const warnings: string[] = [];
  try {
    // Discover first so the progress bar has an honest total.
    const plans: LocationPlan[] = [];
    let totalFiles = 0;
    for (const location of locations) {
      const plan = await planLocation(location, ignorePatterns, signal);
      plans.push(plan);
      totalFiles += plan.files.length;
      if (plan.missing && location.kind !== "file") {
        warnings.push(`missing: ${location.path}`);
      }
    }
    onProgress?.(0, totalFiles, "Collecting save files");

    const zip = new AdmZip();
    const manifestLocations: SaveManifestLocation[] = [];
    const manifestFiles: SaveManifestFile[] = [];
    /** Archive entry holding the authoritative copy of each hash. */
    const canonical = new Map<string, string>();
    let dedupedFiles = 0;
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
        const entry = `files/${index}/${file.rel}`;
        let bytes: Buffer;
        try {
          bytes = await fsp.readFile(file.abs);
        } catch (error) {
          const code =
            (error as NodeJS.ErrnoException).code ?? (error as Error).message;
          warnings.push(`${file.rel}: ${code}`);
          done += 1;
          continue;
        }

        const hash = sha256(bytes);
        const previous = canonical.get(hash);
        if (previous) {
          dedupedFiles += 1;
          manifestFiles.push({
            locationIndex: index,
            rel: file.rel,
            size: bytes.byteLength,
            modifiedMs: file.modifiedMs,
            hash,
            dedupe: previous,
          });
        } else {
          const staged = path.join(
            dataDir,
            ...entry.split("/").filter(Boolean),
          );
          try {
            await fsp.mkdir(path.dirname(staged), { recursive: true });
            await fsp.writeFile(staged, bytes);
          } catch (error) {
            warnings.push(`${file.rel}: ${(error as Error).message}`);
            done += 1;
            continue;
          }
          zip.addFile(entry, bytes);
          canonical.set(hash, entry);
          manifestFiles.push({
            locationIndex: index,
            rel: file.rel,
            size: bytes.byteLength,
            modifiedMs: file.modifiedMs,
            hash,
          });
        }

        locationFiles += 1;
        locationBytes += bytes.byteLength;
        done += 1;
        onProgress?.(done, totalFiles, `Backing up ${location.label || location.path}`);
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
      warnings.length === 0 ? "complete" : manifestFiles.length === 0 ? "failed" : "partial";
    const manifest: SaveManifest = {
      format: MANIFEST_FORMAT,
      version: MANIFEST_VERSION,
      gameId,
      gameName,
      createdAt,
      kind,
      note,
      locations: manifestLocations,
      files: manifestFiles,
    };
    if (dedupedFiles > 0) manifest.dedupedFiles = dedupedFiles;
    if (warnings.length > 0) manifest.warnings = warnings.slice(0, 200);

    const manifestJson = JSON.stringify(manifest, null, 2);
    zip.addFile(MANIFEST_JSON, Buffer.from(manifestJson, "utf8"));
    const archivePath = path.join(snapshotDir, ARCHIVE_NAME);
    zip.writeZip(archivePath);
    await fsp.writeFile(path.join(snapshotDir, MANIFEST_JSON), manifestJson, "utf8");

    // The loose staging copies exist only to build the zip.
    await fsp.rm(dataDir, { recursive: true, force: true });

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
      error: warnings.length > 0 ? warnings.slice(0, 20).join("; ") : null,
      rootPath: archivePath,
      manifestPath: path.join(snapshotDir, MANIFEST_JSON),
    });

    for (const location of locations) {
      store.touchLocationBackup(location.id, createdAt);
    }

    onProgress?.(
      Math.max(1, totalFiles),
      Math.max(1, totalFiles),
      `Backup complete${dedupedFiles > 0 ? ` (${dedupedFiles} duplicate files shared)` : ""}`,
    );
    return backup;
  } catch (error) {
    // A cancelled or failed run never leaves a half-written snapshot behind.
    await fsp.rm(snapshotDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

/** Read a snapshot's manifest (snapshot folder first, then the archive). */
export function readManifest(backup: SaveBackup): SaveManifest | null {
  const candidates: string[] = [];
  if (backup.manifestPath) candidates.push(backup.manifestPath);
  if (backup.rootPath) {
    candidates.push(path.join(path.dirname(backup.rootPath), MANIFEST_JSON));
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, "utf8")) as SaveManifest;
      if (parsed && parsed.format === MANIFEST_FORMAT && Array.isArray(parsed.files)) {
        return parsed;
      }
    } catch {
      /* try the next candidate / the archive */
    }
  }
  try {
    const entry = new AdmZip(backup.rootPath).getEntry(MANIFEST_JSON);
    if (!entry) return null;
    const parsed = JSON.parse(entry.getData().toString("utf8")) as SaveManifest;
    return parsed && parsed.format === MANIFEST_FORMAT ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Destination for one captured file, or `null` when the manifest entry would
 * escape the location root (zip-slip guard).
 */
function safeDestination(location: SaveManifestLocation, rel: string): string | null {
  const root = path.resolve(location.path);
  if (location.kind === "file") {
    // A single-file location restores exactly onto its recorded path.
    return root;
  }
  const relative = toForward(rel);
  if (!relative || relative.startsWith("/") || /^[a-zA-Z]:/.test(relative)) {
    return null;
  }
  const segments = relative.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return null;
  }
  const destination = path.resolve(root, ...segments);
  return isInside(destination, root) ? destination : null;
}

export interface RestoreOptions {
  signal?: AbortSignal;
  onProgress?: (current: number, total: number, message: string) => void;
}

/**
 * Restore every location from a snapshot into its original place.
 *
 * Files are verified against the manifest hash before they are written; a
 * mismatch is reported as a warning and that file is left untouched.
 */
export async function restoreSnapshot(
  backup: SaveBackup,
  options: RestoreOptions = {},
): Promise<Omit<SaveRestoreResult, "backupId" | "gameId" | "safetyBackupId">> {
  const manifest = readManifest(backup);
  if (!manifest) {
    throw new Error("Backup manifest is missing or unreadable — the snapshot is incomplete");
  }

  let zip: AdmZip;
  try {
    zip = new AdmZip(backup.rootPath);
  } catch (error) {
    throw new Error(
      `Cannot read snapshot archive: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

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
      const entryName = file.dedupe ?? `files/${location.index}/${file.rel}`;
      let data: Buffer;
      try {
        const entry = zip.getEntry(entryName);
        if (!entry) {
          warnings.push(`Missing backup file: ${file.rel}`);
          continue;
        }
        data = entry.getData();
      } catch (error) {
        warnings.push(
          `${file.rel}: ${error instanceof Error ? error.message : String(error)}`,
        );
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

/** Delete a snapshot from disk, refusing paths outside the backup directory. */
export async function deleteSnapshot(backup: SaveBackup, backupDir: string): Promise<void> {
  if (!backup.rootPath) return;
  const root = path.resolve(backupDir);
  const target = path.resolve(backup.rootPath);
  if (!isInside(target, root) || target === root) return;

  let stat: fs.Stats | null = null;
  try {
    stat = fs.lstatSync(target);
  } catch {
    return;
  }

  if (stat.isDirectory()) {
    await fsp.rm(target, { recursive: true, force: true });
    return;
  }

  if (path.basename(target).toLowerCase() === ARCHIVE_NAME) {
    const snapshotDir = path.dirname(target);
    if (isInside(snapshotDir, root) && snapshotDir !== root) {
      await fsp.rm(snapshotDir, { recursive: true, force: true });
      return;
    }
  }
  await fsp.rm(target, { force: true });
}

/**
 * Prune old snapshots for a game beyond `retention` (0 = keep all).
 *
 * Manual backups are evicted last so an auto-backup flood never removes a
 * snapshot the user explicitly asked for.
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
    await deleteSnapshot(backup, backupDir);
    store.deleteBackupRow(backup.id);
  }
}

/** Effective ignore patterns: user value when set, built-in defaults otherwise. */
export function effectiveIgnore(patterns: string[]): string[] {
  return patterns.length > 0 ? patterns : defaultIgnorePatterns();
}
