/**
 * Whole-app backup & restore engine (ported from `src-tauri/src/backup.rs` and
 * `backup_raw.rs`).
 *
 * A `.gibak` archive is a plain Deflated zip:
 *
 * ```text
 * manifest.json            # magic, version, app version, created at, domains
 * domains/<name>.db        # consistent snapshot of each SQLite domain
 * json/app-settings.json   # app-level settings (Electron-only extension)
 * files/artwork/…          # only when `includeArtwork` is on (size caps apply)
 * files/logs/…             # only when `includeLogs` is on
 * ```
 *
 * The manifest keeps the Rust `gameindex-backup` v1 fields
 * (`format`/`version`/`appVersion`/`createdAt`/`domains`) and adds `counts`,
 * `entries`, `note` and `skipped`; the retired build ignores unknown fields.
 *
 * Databases are snapshotted through SQLite itself
 * (`wal_checkpoint(TRUNCATE)` + a synchronous file copy, so no write can
 * interleave), and restored through `ATTACH` + validated table copies rather
 * than by swapping files under live connections.
 *
 * Archives written by the retired app are accepted too:
 *  • v1 binary (`domains/<name>.db`), and
 *  • v2 raw NDJSON (`data/<table>.ndjson`, see `legacyArchive.ts`);
 * `.zip` remains a legacy alias for list/verify/diff/restore/delete, but new
 * archives are always written with the `.gibak` extension.
 */
import AdmZip from "adm-zip";
import { app } from "electron";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { legacyAppDataDir, userDataPath } from "../../lib/paths";
import {
  DB_FILES,
  ensureStorage,
  kvGet,
  kvSet,
  openDb,
  prepare,
  type DbDomain,
} from "../../state/db";
import {
  DEFAULT_ARTWORK_CAP_BYTES,
  MAX_ARTWORK_FILE_BYTES,
  type BackupConfig,
} from "./config";
import {
  hasRawEntries,
  isLegacyPluginAsset,
  RAW_MAGIC,
  RAW_VERSION,
  restoreLegacyArtwork,
  restoreRawDomain,
  verifyRawDomain,
} from "./legacyArchive";
import type {
  ArchiveManifest,
  BackupArchiveSummary,
  BackupDiffReport,
  BackupInspect,
  BackupOutcome,
  BackupProgressPayload,
  BackupStatus,
  BackupVerifyReport,
  CloudPathOption,
  DomainDiffDetail,
  DomainKind,
  DomainStatus,
  DomainVerifyDetail,
} from "./types";

export const BACKUP_MAGIC = "gameindex-backup";
export const BACKUP_FORMAT_VERSION = 1;
/** Extension every newly written archive uses. */
export const GIBACK_EXT = "gibak";
/** Legacy alias accepted by list/verify/diff/restore/delete. */
export const LEGACY_ARCHIVE_EXT = "zip";

const KV_LAST_AT = "backup.last_at";
const KV_LAST_BYTES = "backup.last_bytes";
const MANIFEST_JSON = "manifest.json";
const SQLITE_HEADER = "SQLite format 3\0";
const ARCHIVE_EXTS = [GIBACK_EXT, LEGACY_ARCHIVE_EXT];

/**
 * Domain names the retired app used that this build stores under another
 * `DbDomain` today (`download_history.db` → `downloads.db`).
 */
const LEGACY_DOMAIN_ALIASES: Record<string, DbDomain> = {
  download_history: "downloads",
};

/** Domain order in the overview and the manifest (runtime — the data
 * workstream adds domains without this module changing). */
const DB_DOMAINS: DbDomain[] = Object.keys(DB_FILES) as DbDomain[];

/** Non-database settings document. */
const JSON_DOMAINS: { name: string; file: string }[] = [
  { name: "settings", file: "app-settings.json" },
];

const DIR_DOMAINS: { name: string; dir: string; capBytes: number }[] = [
  { name: "artwork", dir: "artwork", capBytes: DEFAULT_ARTWORK_CAP_BYTES },
  { name: "logs", dir: "crashlog", capBytes: 20 * 1024 * 1024 },
];

/**
 * Primary-record count per SQLite domain. `Partial` on purpose: the data
 * workstream owns the domain set, and an unknown domain falls back to counting
 * its generic `documents` table (or reports 0).
 */
const SQLITE_COUNT_SQL: Partial<Record<DbDomain, string>> = {
  games: "SELECT count(*) AS n FROM games",
  sessions: "SELECT count(*) AS n FROM sessions",
  game_notes: "SELECT count(*) AS n FROM game_notes",
  shelves:
    "SELECT (SELECT count(*) FROM shelves) + (SELECT count(*) FROM game_completions) AS n",
  wishlist: "SELECT count(*) AS n FROM wishlist",
  saves:
    "SELECT (SELECT count(*) FROM save_locations) + (SELECT count(*) FROM save_backups) AS n",
  kv: "SELECT count(*) AS n FROM kv_store",
  achievements:
    "SELECT (SELECT count(*) FROM achievement_links) + (SELECT count(*) FROM achievements_cache) AS n",
  plugins: "SELECT count(*) AS n FROM plugins",
  clips: "SELECT count(*) AS n FROM clips",
  mods: "SELECT count(*) AS n FROM mods",
  emulators: "SELECT count(*) AS n FROM emulators",
  sources: "SELECT count(*) AS n FROM sources",
  store_cache: "SELECT count(*) AS n FROM store_cache",
  compatibility:
    "SELECT (SELECT count(*) FROM compatibility_settings) " +
    "+ (SELECT count(*) FROM game_compatibility) " +
    "+ (SELECT count(*) FROM compatibility_runners) AS n",
  downloads: "SELECT count(*) AS n FROM download_history",
};

interface DomainSpec {
  name: string;
  kind: DomainKind;
  /** Absolute source path (db file, json file, or directory). */
  source: string;
  /** Base archive entry path. */
  entry: string;
  /** When false, the domain is not offered as a selectable item. */
  available: boolean;
}

function dbSource(domain: DbDomain): string {
  return path.join(userDataPath("db"), DB_FILES[domain]);
}

/** Every domain this build can back up right now. */
export function availableDomains(config: BackupConfig): DomainSpec[] {
  const specs: DomainSpec[] = [];
  for (const domain of DB_DOMAINS) {
    specs.push({
      name: domain,
      kind: "db",
      source: dbSource(domain),
      entry: `domains/${DB_FILES[domain]}`,
      available: true,
    });
  }
  for (const doc of JSON_DOMAINS) {
    specs.push({
      name: doc.name,
      kind: "json",
      source: userDataPath(doc.file),
      entry: `json/${doc.file}`,
      available: true,
    });
  }
  for (const dir of DIR_DOMAINS) {
    const source = userDataPath(dir.dir);
    const enabled =
      dir.name === "logs" ? config.includeLogs : config.includeArtwork;
    specs.push({
      name: dir.name,
      kind: "dir",
      source,
      entry: `files/${dir.name}`,
      available: enabled && fs.existsSync(source),
    });
  }
  return specs;
}

function findDomain(name: string, config: BackupConfig): DomainSpec | null {
  return availableDomains(config).find((spec) => spec.name === name) ?? null;
}

// ── Live data inspection ────────────────────────────────────────────────────

function countFilesSync(dir: string): number {
  let count = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) count += countFilesSync(path.join(dir, entry.name));
    else if (entry.isFile()) count += 1;
  }
  return count;
}

function sizeOfDirSync(dir: string): number {
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += sizeOfDirSync(target);
      continue;
    }
    try {
      total += fs.statSync(target).size;
    } catch {
      /* unreadable file: skip its size */
    }
  }
  return total;
}

/** Number of primary records in a domain (0 when the file is absent). */
export function countDomain(name: string): number {
  const domain = DB_DOMAINS.find((candidate) => candidate === name);
  if (domain) {
    try {
      ensureStorage(domain);
      const sql =
        SQLITE_COUNT_SQL[domain] ?? "SELECT count(*) AS n FROM documents";
      const row = prepare(domain, sql).get() as { n?: number | bigint } | undefined;
      return Number(row?.n ?? 0);
    } catch {
      return 0;
    }
  }
  const doc = JSON_DOMAINS.find((candidate) => candidate.name === name);
  if (doc) {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(userDataPath(doc.file), "utf8"));
      if (Array.isArray(parsed)) return parsed.length;
      if (parsed && typeof parsed === "object") return Object.keys(parsed).length;
    } catch {
      /* missing or corrupt document */
    }
    return 0;
  }
  const dir = DIR_DOMAINS.find((candidate) => candidate.name === name);
  if (dir) return countFilesSync(userDataPath(dir.dir));
  return 0;
}

function sizeOfDomain(spec: DomainSpec): number {
  if (spec.kind === "dir") return sizeOfDirSync(spec.source);
  try {
    return fs.statSync(spec.source).size;
  } catch {
    return 0;
  }
}

// ── Status / config-facing helpers ──────────────────────────────────────────

export function getStatus(config: BackupConfig): BackupStatus {
  const lastAtRaw = kvGet(KV_LAST_AT);
  const lastBytesRaw = kvGet(KV_LAST_BYTES);
  const lastAt = lastAtRaw ? Number.parseInt(lastAtRaw, 10) : Number.NaN;
  const lastBytes = lastBytesRaw ? Number.parseInt(lastBytesRaw, 10) : Number.NaN;
  const domains: DomainStatus[] = availableDomains(config)
    .filter((spec) => spec.available)
    .map((spec) => ({
      name: spec.name,
      sizeBytes: sizeOfDomain(spec),
      itemCount: countDomain(spec.name),
    }));
  return {
    lastBackupAt: Number.isFinite(lastAt) && lastAt > 0 ? lastAt : null,
    lastBackupBytes: Number.isFinite(lastBytes) && lastBytes > 0 ? lastBytes : null,
    domains,
  };
}

// ── Manifest helpers ────────────────────────────────────────────────────────

function openArchive(filePath: string): AdmZip {
  try {
    return new AdmZip(filePath);
  } catch (error) {
    throw new Error(
      `Invalid zip archive: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Read and validate the manifest of an archive (throws with a clear reason).
 * Supports both retried formats:
 *  • `gameindex-backup` v1 (binary domain snapshots, and what this build writes)
 *  • `gameindex-raw-backup` v2 (the old app's NDJSON writer)
 */
export function readManifest(filePath: string): ArchiveManifest {
  const zip = openArchive(filePath);
  const entry = zip.getEntry(MANIFEST_JSON);
  if (!entry) {
    throw new Error("Not a GameIndex backup file (missing manifest.json)");
  }
  let parsed: ArchiveManifest;
  try {
    parsed = JSON.parse(entry.getData().toString("utf8")) as ArchiveManifest;
  } catch (error) {
    throw new Error(
      `Parse manifest: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!parsed || typeof parsed !== "object" || !parsed.format) {
    throw new Error("Archive manifest is not a GameIndex backup");
  }
  if (parsed.format !== BACKUP_MAGIC && parsed.format !== RAW_MAGIC) {
    throw new Error(`Unsupported backup format: ${parsed.format}`);
  }
  const version = Number(parsed.version ?? 0);
  if (parsed.format === BACKUP_MAGIC && version !== BACKUP_FORMAT_VERSION) {
    throw new Error(`Unsupported backup version: ${version}`);
  }
  if (parsed.format === RAW_MAGIC && version !== RAW_VERSION) {
    throw new Error(`Unsupported backup version: ${version}`);
  }
  if (!Array.isArray(parsed.domains)) {
    throw new Error("Archive manifest is incomplete — regenerate the backup");
  }
  parsed.domains = parsed.domains.filter(
    (name): name is string => typeof name === "string" && name.length > 0,
  );
  parsed.counts = Object.fromEntries(
    Object.entries(asRecord(parsed.counts)).filter(
      (entryPair): entryPair is [string, number] => typeof entryPair[1] === "number",
    ),
  );
  parsed.entries = Object.fromEntries(
    Object.entries(asRecord(parsed.entries)).filter(
      (entryPair): entryPair is [string, string] => typeof entryPair[1] === "string",
    ),
  );
  return parsed;
}

function isRawManifest(manifest: ArchiveManifest): boolean {
  return manifest.format === RAW_MAGIC;
}

export function inspectArchive(filePath: string): BackupInspect {
  const manifest = readManifest(filePath);
  return {
    createdAt: Number(manifest.createdAt ?? 0),
    appVersion: String(manifest.appVersion ?? ""),
    domains: manifest.domains,
    isRaw: isRawManifest(manifest),
    counts: manifest.counts ?? {},
  };
}

// ── Listing / management ────────────────────────────────────────────────────

function archiveExtension(filePath: string): string {
  return path.extname(filePath).replace(/^\./, "").toLowerCase();
}

function isArchiveFile(filePath: string): boolean {
  return ARCHIVE_EXTS.includes(archiveExtension(filePath));
}

/** Retired profiles that may hold `.gibak` archives (`<profile>/backups`). */
function legacyBackupDirs(): string[] {
  const appData = app.getPath("appData");
  const profiles = [
    path.join(appData, "com.gameindex.app"),
    path.join(appData, "GameIndex"),
    path.join(appData, "gameindex"),
  ];
  const detected = legacyAppDataDir();
  if (detected) profiles.push(detected);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const profile of profiles) {
    const dir = path.resolve(path.join(profile, "backups"));
    const key = dir.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      if (fs.statSync(dir).isDirectory()) out.push(dir);
    } catch {
      /* profile not present */
    }
  }
  return out;
}

/**
 * Every discovered `.gibak`/`.zip` archive. By default the configured folder is
 * scanned together with each retired profile's `backups/` directory, so
 * archives made by the old app show up without copying them first.
 */
export function listArchives(dir: string, includeLegacy = true): BackupArchiveSummary[] {
  const dirs: string[] = [];
  const seenDirs = new Set<string>();
  const candidates = [path.resolve(dir), ...(includeLegacy ? legacyBackupDirs() : [])];
  for (const candidate of candidates) {
    const key = candidate.toLowerCase();
    if (seenDirs.has(key)) continue;
    seenDirs.add(key);
    dirs.push(candidate);
  }

  const summaries: BackupArchiveSummary[] = [];
  const seenFiles = new Set<string>();
  for (const folder of dirs) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(folder, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const filePath = path.join(folder, entry.name);
      if (!isArchiveFile(filePath)) continue;
      const fileKey = filePath.toLowerCase();
      if (seenFiles.has(fileKey)) continue;
      seenFiles.add(fileKey);
      try {
        const manifest = readManifest(filePath);
        const counts = manifest.counts ?? {};
        const totalRecords = Object.values(counts).reduce(
          (sum, value) => sum + (Number.isFinite(value) ? value : 0),
          0,
        );
        summaries.push({
          filePath,
          fileName: entry.name,
          sizeBytes: fs.statSync(filePath).size,
          createdAt: Number(manifest.createdAt ?? 0),
          appVersion: String(manifest.appVersion ?? ""),
          domains: manifest.domains,
          domainCount: manifest.domains.length,
          totalRecords,
          isRaw: isRawManifest(manifest),
          counts,
        });
      } catch {
        // A random zip (or a truncated archive) is simply not listed.
      }
    }
  }
  summaries.sort((a, b) => b.createdAt - a.createdAt);
  return summaries;
}

export function deleteArchive(filePath: string): boolean {
  const target = path.resolve(filePath);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(target);
  } catch {
    throw new Error("File not found");
  }
  if (!stat.isFile()) throw new Error("File not found");
  if (!isArchiveFile(target)) {
    throw new Error("Only .gibak or .zip backup files can be deleted");
  }
  try {
    fs.rmSync(target, { force: true });
  } catch (error) {
    throw new Error(
      `Delete backup file ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return true;
}

export function exportArchive(sourcePath: string, targetDir: string): string {
  const source = path.resolve(sourcePath);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
    throw new Error("Source archive not found");
  }
  const target = path.resolve(targetDir);
  try {
    fs.mkdirSync(target, { recursive: true });
  } catch (error) {
    throw new Error(
      `Failed to create destination folder: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const destination = path.join(target, path.basename(source));
  try {
    fs.copyFileSync(source, destination);
  } catch (error) {
    throw new Error(
      `Failed to export archive to ${destination}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return destination;
}

/** Keep the newest `maxCount` archives in a directory (0 = keep all). */
export function pruneDir(dir: string, maxCount: number): void {
  if (maxCount <= 0) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const files: { path: string; mtime: number }[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const filePath = path.join(dir, entry.name);
    if (!isArchiveFile(filePath)) continue;
    try {
      files.push({ path: filePath, mtime: fs.statSync(filePath).mtimeMs });
    } catch {
      /* vanished between readdir and stat */
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  for (const doomed of files.slice(maxCount)) {
    try {
      fs.rmSync(doomed.path, { force: true });
    } catch {
      /* best effort */
    }
  }
}

/** `gameindex-backup-YYYY-MM-DD-HHMMSS[-note].gibak` in the default folder. */
export function quickBackupPath(backupDir: string, note?: string | null): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, "0");
  const timestamp =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const suffix = note?.trim()
    ? `-${note
        .trim()
        .split("")
        .map((char) => (/[a-zA-Z0-9_-]/.test(char) ? char : "-"))
        .join("")}`
    : "";
  return path.join(backupDir, `gameindex-backup-${timestamp}${suffix}.${GIBACK_EXT}`);
}

/**
 * Force the `.gibak` extension on a user-chosen target. `.zip` is only ever a
 * legacy alias for reading; new archives must be written as `.gibak`.
 */
export function ensureGibakPath(target: string): string {
  const ext = path.extname(target).toLowerCase();
  if (ext === `.${GIBACK_EXT}`) return target;
  if (ext === `.${LEGACY_ARCHIVE_EXT}`) {
    return `${target.slice(0, -ext.length)}.${GIBACK_EXT}`;
  }
  return `${target}.${GIBACK_EXT}`;
}

// ── Progress ────────────────────────────────────────────────────────────────

/** Throttled `backup-progress` payload builder. */
export class BackupProgressReporter {
  private lastAt = 0;
  private bytesWritten = 0;

  constructor(
    private readonly emitEvent: (payload: BackupProgressPayload) => void,
  ) {}

  private send(
    payload: Omit<BackupProgressPayload, "bytesWritten">,
    force: boolean,
  ): void {
    const now = Date.now();
    if (!force && now - this.lastAt < 100) return;
    this.lastAt = now;
    this.emitEvent({ ...payload, bytesWritten: this.bytesWritten });
  }

  phase(
    phase: string,
    message: string,
    options: {
      currentDomain?: string | null;
      domainIndex?: number;
      totalDomains?: number;
      percent?: number;
      force?: boolean;
    } = {},
  ): void {
    this.send(
      {
        phase,
        currentDomain: options.currentDomain ?? null,
        domainIndex: options.domainIndex ?? 0,
        totalDomains: options.totalDomains ?? 0,
        percent: Math.min(100, Math.max(0, options.percent ?? 0)),
        message,
      },
      options.force ?? false,
    );
  }

  addBytes(bytes: number): void {
    this.bytesWritten += Math.max(0, bytes);
  }

  fail(message: string): void {
    this.send(
      {
        phase: "error",
        currentDomain: null,
        domainIndex: 0,
        totalDomains: 0,
        percent: 0,
        message,
      },
      true,
    );
  }

  complete(message: string): void {
    this.send(
      {
        phase: "complete",
        currentDomain: null,
        domainIndex: 0,
        totalDomains: 0,
        percent: 100,
        message,
      },
      true,
    );
  }
}

// ── Creation ────────────────────────────────────────────────────────────────

export interface CreateArchiveOptions {
  targetPath: string;
  /** Domain names to include; `undefined` = every available domain. */
  domains?: string[] | null;
  note?: string | null;
  config: BackupConfig;
  /** Safety snapshots must not overwrite the "last backup" header values. */
  recordStatus?: boolean;
  onProgress?: (payload: BackupProgressPayload) => void;
}

interface StagedDomain {
  spec: DomainSpec;
  stagedPath: string;
  bytes: number;
}

/** Copy one directory into staging, enforcing byte caps. */
async function stageDirectory(
  spec: DomainSpec,
  stagingDir: string,
  capBytes: number,
): Promise<{ bytes: number; skipped: boolean }> {
  const target = path.join(stagingDir, ...spec.entry.split("/"));
  let total = 0;
  let skipped = false;

  const walk = async (dir: string, rel: string): Promise<void> => {
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const abs = path.join(dir, entry.name);
      const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(abs, nextRel);
        continue;
      }
      if (!entry.isFile()) continue;
      let size = 0;
      try {
        size = (await fsp.stat(abs)).size;
      } catch {
        continue;
      }
      if (size > MAX_ARTWORK_FILE_BYTES || total + size > capBytes) {
        skipped = true;
        continue;
      }
      const destination = path.join(target, ...nextRel.split("/"));
      await fsp.mkdir(path.dirname(destination), { recursive: true });
      await fsp.copyFile(abs, destination);
      total += size;
    }
  };

  await walk(spec.source, "");
  return { bytes: total, skipped };
}

/** Snapshot one SQLite domain into `destination`. */
function snapshotDatabase(domain: DbDomain, destination: string): number {
  ensureStorage(domain);
  const db = openDb(domain);
  // Fold the WAL back into the main file, then copy synchronously so no other
  // command can interleave a write between the checkpoint and the copy.
  db.pragma("wal_checkpoint(TRUNCATE)");
  const source = dbSource(domain);
  fs.copyFileSync(source, destination);
  return fs.statSync(destination).size;
}

export async function createArchive(options: CreateArchiveOptions): Promise<BackupOutcome> {
  const { config } = options;
  const target = path.resolve(ensureGibakPath(options.targetPath));
  const reporter = new BackupProgressReporter(
    options.onProgress ?? (() => undefined),
  );
  reporter.phase("preparing", "Preparing backup snapshot...", { percent: 5, force: true });

  const all = availableDomains(config).filter((spec) => spec.available);
  // Only domains the retired app knew are valid archive items; `settings`,
  // `artwork` and `logs` are Electron extensions that are also selectable.
  const requested = options.domains?.filter((name) => typeof name === "string") ?? null;
  if (requested) {
    for (const name of requested) {
      if (!all.some((spec) => spec.name === name)) {
        throw new Error(`Unknown backup item: ${name}`);
      }
    }
  }

  const chosenNames = requested && requested.length > 0 ? requested : all.map((spec) => spec.name);
  const chosen = chosenNames
    .map((name) => all.find((spec) => spec.name === name))
    .filter((spec): spec is DomainSpec => Boolean(spec));

  const existing = chosen.filter((spec) => fs.existsSync(spec.source));
  if (existing.length === 0) throw new Error("Nothing to back up yet");

  await fsp.mkdir(path.dirname(target), { recursive: true });
  const staging = await fsp.mkdtemp(path.join(os.tmpdir(), "gameindex-backup-"));
  const staged: StagedDomain[] = [];
  const counts: Record<string, number> = {};
  const entries: Record<string, string> = {};
  const skippedDomains: string[] = [];

  try {
    const totalDomains = existing.length;
    for (let index = 0; index < existing.length; index += 1) {
      const spec = existing[index];
      const percent = 10 + Math.round((index / Math.max(1, totalDomains)) * 70);
      reporter.phase("snapshotting", `Exporting ${spec.name}...`, {
        currentDomain: spec.name,
        domainIndex: index + 1,
        totalDomains,
        percent,
        force: true,
      });

      if (spec.kind === "db") {
        const destination = path.join(staging, ...spec.entry.split("/"));
        await fsp.mkdir(path.dirname(destination), { recursive: true });
        const bytes = snapshotDatabase(spec.name as DbDomain, destination);
        reporter.addBytes(bytes);
        staged.push({ spec, stagedPath: destination, bytes });
      } else if (spec.kind === "json") {
        const destination = path.join(staging, ...spec.entry.split("/"));
        await fsp.mkdir(path.dirname(destination), { recursive: true });
        await fsp.copyFile(spec.source, destination);
        const bytes = (await fsp.stat(destination)).size;
        reporter.addBytes(bytes);
        staged.push({ spec, stagedPath: destination, bytes });
      } else {
        const dirCap = spec.name === "artwork" ? config.artworkCapBytes : 20 * 1024 * 1024;
        const result = await stageDirectory(spec, staging, dirCap);
        if (result.skipped && result.bytes === 0) {
          skippedDomains.push(spec.name);
          continue;
        }
        reporter.addBytes(result.bytes);
        staged.push({
          spec,
          stagedPath: path.join(staging, ...spec.entry.split("/")),
          bytes: result.bytes,
        });
        if (result.skipped) skippedDomains.push(spec.name);
      }

      counts[spec.name] = countDomain(spec.name);
      entries[spec.name] = spec.entry;
    }

    if (staged.length === 0) throw new Error("Nothing to back up yet");

    const manifest: ArchiveManifest = {
      format: BACKUP_MAGIC,
      version: BACKUP_FORMAT_VERSION,
      appVersion: app.getVersion(),
      createdAt: Math.floor(Date.now() / 1000),
      domains: staged.map((entry) => entry.spec.name),
      counts,
      entries,
    };
    if (options.note?.trim()) manifest.note = options.note.trim();
    if (skippedDomains.length > 0) manifest.skipped = skippedDomains;
    const manifestJson = JSON.stringify(manifest, null, 2);
    await fsp.writeFile(path.join(staging, MANIFEST_JSON), manifestJson, "utf8");

    reporter.phase("compressing", "Compressing archive...", { percent: 90, force: true });
    const zip = new AdmZip();
    const addStaged = async (dir: string, rel: string): Promise<void> => {
      const items = await fsp.readdir(dir, { withFileTypes: true });
      for (const item of items) {
        const abs = path.join(dir, item.name);
        const nextRel = rel ? `${rel}/${item.name}` : item.name;
        if (item.isDirectory()) {
          await addStaged(abs, nextRel);
        } else if (item.isFile()) {
          zip.addFile(nextRel, await fsp.readFile(abs));
        }
      }
    };
    await addStaged(staging, "");

    // Write to a sibling temp file first: a failed run must never leave a
    // truncated archive where the UI expects a valid backup.
    const temp = `${target}.${process.pid}.tmp`;
    try {
      zip.writeZip(temp);
      fs.rmSync(target, { force: true });
      await fsp.rename(temp, target);
    } catch (error) {
      fs.rmSync(temp, { force: true });
      throw error;
    }

    const sizeBytes = fs.statSync(target).size;
    if (options.recordStatus !== false) {
      kvSet(KV_LAST_AT, String(manifest.createdAt));
      kvSet(KV_LAST_BYTES, String(sizeBytes));
    }
    reporter.complete(`Backup complete — ${staged.length} item(s), ${sizeBytes} bytes`);

    const outcome: BackupOutcome = {
      filePath: target,
      sizeBytes,
      createdAt: manifest.createdAt,
      domains: manifest.domains,
      restartRequired: false,
    };
    if (skippedDomains.length > 0) outcome.skippedDomains = skippedDomains;
    return outcome;
  } finally {
    await fsp.rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
}

// ── Verification / diff ─────────────────────────────────────────────────────

/** Archive entry holding a domain's payload (legacy manifests have no map). */
function domainEntry(
  manifest: ArchiveManifest,
  name: string,
  zip: AdmZip,
): string | null {
  const mapped = manifest.entries?.[name];
  if (mapped) return mapped;
  const dbEntry = `domains/${name}.db`;
  if (zip.getEntry(dbEntry)) return dbEntry;
  const jsonDoc = JSON_DOMAINS.find((doc) => doc.name === name);
  if (jsonDoc) {
    const entryName = `json/${jsonDoc.file}`;
    if (zip.getEntry(entryName)) return entryName;
  }
  const dir = DIR_DOMAINS.find((candidate) => candidate.name === name);
  if (dir) return `files/${dir.name}`;
  if (zip.getEntry(`data/${name}.ndjson`)) return `data/${name}.ndjson`;
  return null;
}

function domainKind(name: string): DomainKind | "unknown" {
  if (DB_DOMAINS.includes(name as DbDomain)) return "db";
  const alias = LEGACY_DOMAIN_ALIASES[name];
  if (alias && DB_DOMAINS.includes(alias)) return "db";
  if (JSON_DOMAINS.some((doc) => doc.name === name)) return "json";
  if (DIR_DOMAINS.some((dir) => dir.name === name)) return "dir";
  return "unknown";
}

function looksLikeDbEntry(entryName: string): boolean {
  return entryName.toLowerCase().endsWith(".db");
}

/** Live domain that receives an archived domain's database. */
function restoreDomainName(name: string): DbDomain {
  return (LEGACY_DOMAIN_ALIASES[name] ?? name) as DbDomain;
}

/** `YYYYMMDD-HHMMSS` in local time (the Rust safety-snapshot naming). */
function localStamp(date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

export function verifyArchive(filePath: string): BackupVerifyReport {
  const manifest = readManifest(filePath);
  const zip = openArchive(filePath);
  const raw = isRawManifest(manifest);
  const details: DomainVerifyDetail[] = [];
  const corrupted: string[] = [];
  let totalRecords = 0;

  for (const domain of manifest.domains) {
    const count = manifest.counts?.[domain] ?? 0;
    let valid = false;
    let records = 0;
    let error: string | null = null;

    try {
      if (raw) {
        const result = verifyRawDomain(zip, domain, count);
        valid = result.valid;
        records = result.records;
        error = result.error;
      } else {
        const entryName = domainEntry(manifest, domain, zip);
        if (!entryName) {
          error = `Missing ${domain} in archive`;
        } else if (domainKind(domain) === "dir") {
          const prefix = `${entryName.replace(/\/+$/, "")}/`;
          valid = zip
            .getEntries()
            .some((candidate) => !candidate.isDirectory && candidate.entryName.startsWith(prefix));
          if (!valid) error = `No files captured under ${entryName}`;
        } else {
          const entry = zip.getEntry(entryName);
          if (!entry) {
            error = `Missing ${entryName} in archive`;
          } else {
            const data = entry.getData();
            const kind = domainKind(domain);
            if (kind === "json" || entryName.toLowerCase().endsWith(".json")) {
              JSON.parse(data.toString("utf8"));
              valid = true;
            } else if (kind === "db" || looksLikeDbEntry(entryName)) {
              valid =
                data.byteLength >= 16 &&
                data.subarray(0, 16).toString("latin1") === SQLITE_HEADER;
              if (!valid) error = "Invalid SQLite database header";
            } else {
              valid = true;
            }
          }
        }
        if (valid) records = count;
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
      valid = false;
    }

    if (!valid) corrupted.push(domain);
    else totalRecords += records;
    details.push({ domain, valid, recordsFound: valid ? records : 0, error });
  }

  const totalDomains = manifest.domains.length;
  const healthyDomains = totalDomains - corrupted.length;
  const valid = corrupted.length === 0;
  return {
    filePath,
    valid,
    isRaw: raw,
    formatVersion: Number(manifest.version ?? 1),
    totalDomains,
    healthyDomains,
    corruptedDomains: corrupted,
    totalRecords,
    details,
    message: valid
      ? `All ${totalDomains} databases verified intact.`
      : `${healthyDomains}/${totalDomains} databases healthy. Issues in: ${corrupted.join(", ")}`,
  };
}

export function diffArchive(filePath: string): BackupDiffReport {
  const manifest = readManifest(filePath);
  const domains: DomainDiffDetail[] = [];
  let archiveTotal = 0;
  let liveTotal = 0;
  const names = new Set<string>([
    ...manifest.domains,
    ...DB_DOMAINS,
    ...JSON_DOMAINS.map((doc) => doc.name),
    ...DIR_DOMAINS.map((dir) => dir.name),
  ]);
  for (const name of names) {
    const archiveCount = manifest.counts?.[name] ?? 0;
    const alias = LEGACY_DOMAIN_ALIASES[name];
    const liveCount = countDomain(alias ?? name);
    archiveTotal += archiveCount;
    liveTotal += liveCount;
    domains.push({
      domain: name,
      archiveCount,
      liveCount,
      delta: liveCount - archiveCount,
    });
  }
  return {
    filePath,
    archiveCreatedAt: Number(manifest.createdAt ?? 0),
    archiveTotalRecords: archiveTotal,
    liveTotalRecords: liveTotal,
    recordDelta: liveTotal - archiveTotal,
    domains,
  };
}

// ── Restore ─────────────────────────────────────────────────────────────────

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function tableColumnsOf(
  db: ReturnType<typeof openDb>,
  schema: string,
  table: string,
): string[] {
  const rows = db
    .prepare(`PRAGMA ${schema}.table_info(${quoteIdent(table)})`)
    .all() as { name?: string }[];
  return rows.map((row) => String(row.name ?? ""));
}

function isInside(child: string, parent: string): boolean {
  const normalize = (value: string): string =>
    process.platform === "win32" ? value.toLowerCase() : value;
  const c = normalize(path.resolve(child));
  const p = normalize(path.resolve(parent));
  return c === p || c.startsWith(p.endsWith(path.sep) ? p : `${p}${path.sep}`);
}

/**
 * Replace/merge a domain's tables from an archived database.
 *
 * Column compatibility is checked before anything is deleted: every archived
 * column must exist in the live table (live-only columns keep their defaults).
 * A schema mismatch therefore aborts the whole domain rather than leaving a
 * half-emptied table behind.
 */
function restoreDatabase(domain: DbDomain, data: Buffer, mode: string): void {
  if (data.byteLength < 16 || data.subarray(0, 16).toString("latin1") !== SQLITE_HEADER) {
    throw new Error(`Invalid SQLite database header for ${domain}`);
  }
  const temp = path.join(
    os.tmpdir(),
    `gameindex-restore-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`,
  );
  fs.writeFileSync(temp, data);
  try {
    const db = openDb(domain);
    db.exec(`ATTACH DATABASE '${temp.replace(/'/g, "''")}' AS restore_src`);
    try {
      const tables = (db
        .prepare(
          "SELECT name FROM restore_src.sqlite_master WHERE type = 'table' " +
            "AND name NOT LIKE 'sqlite_%' AND name <> 'migrations'",
        )
        .all() as { name?: string }[]).map((row) => String(row.name ?? ""));

      const plans: { table: string; columns: string[] }[] = [];
      for (const table of tables) {
        const source = tableColumnsOf(db, "restore_src", table);
        const live = new Set(tableColumnsOf(db, "main", table));
        if (live.size === 0) {
          throw new Error(
            `Cannot restore ${domain}.${table}: this build has no such table`,
          );
        }
        const missing = source.filter((column) => !live.has(column));
        if (missing.length > 0) {
          throw new Error(
            `Cannot restore ${domain}.${table}: the archive has unknown column(s) ${missing.join(", ")}`,
          );
        }
        plans.push({ table, columns: source });
      }

      const replace = mode === "replace";
      const run = db.transaction(() => {
        for (const plan of plans) {
          const quotedTable = quoteIdent(plan.table);
          const columns = plan.columns.map(quoteIdent).join(", ");
          if (replace) db.exec(`DELETE FROM main.${quotedTable}`);
          db.exec(
            `INSERT OR REPLACE INTO main.${quotedTable} (${columns}) ` +
              `SELECT ${columns} FROM restore_src.${quotedTable}`,
          );
        }
      });
      run();
    } finally {
      db.exec("DETACH DATABASE restore_src");
    }
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

async function restoreDirectory(
  spec: DomainSpec,
  zip: AdmZip,
  mode: string,
): Promise<number> {
  const prefix = `${spec.entry.replace(/\/+$/, "")}/`;
  const entries = zip
    .getEntries()
    .filter((entry) => !entry.isDirectory && entry.entryName.startsWith(prefix));
  if (entries.length === 0) return 0;
  if (mode === "replace") {
    await fsp.rm(spec.source, { recursive: true, force: true });
  }
  await fsp.mkdir(spec.source, { recursive: true });
  const root = path.resolve(spec.source);
  let restored = 0;
  for (const entry of entries) {
    const relative = entry.entryName.slice(prefix.length).replace(/\\/g, "/");
    const segments = relative.split("/");
    if (
      !relative ||
      relative.startsWith("/") ||
      segments.some((segment) => !segment || segment === "." || segment === "..")
    ) {
      continue;
    }
    const destination = path.resolve(root, ...segments);
    if (!isInside(destination, root)) continue;
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    await fsp.writeFile(destination, entry.getData());
    restored += 1;
  }
  return restored;
}

/** Resolve a domain descriptor for restore, even when the item is not live. */
function resolveDomainSpec(
  name: string,
  config: BackupConfig,
  manifest: ArchiveManifest,
): DomainSpec {
  const known = findDomain(name, config);
  if (known) return known;
  const alias = LEGACY_DOMAIN_ALIASES[name];
  if (alias && DB_DOMAINS.includes(alias)) {
    // Rust domain name → today's file (e.g. download_history → downloads.db),
    // while the archive entry keeps the retired name.
    return {
      name,
      kind: "db",
      source: dbSource(alias),
      entry: manifest.entries[name] ?? `domains/${name}.db`,
      available: true,
    };
  }
  if (DB_DOMAINS.includes(name as DbDomain)) {
    return {
      name,
      kind: "db",
      source: dbSource(name as DbDomain),
      entry: manifest.entries[name] ?? `domains/${DB_FILES[name as DbDomain]}`,
      available: true,
    };
  }
  const doc = JSON_DOMAINS.find((candidate) => candidate.name === name);
  if (doc) {
    return {
      name,
      kind: "json",
      source: userDataPath(doc.file),
      entry: manifest.entries[name] ?? `json/${doc.file}`,
      available: true,
    };
  }
  const dir = DIR_DOMAINS.find((candidate) => candidate.name === name);
  if (dir) {
    return {
      name,
      kind: "dir",
      source: userDataPath(dir.dir),
      entry: manifest.entries[name] ?? `files/${name}`,
      available: true,
    };
  }
  // Legacy Electron archives also carried plain JSON caches such as
  // `storage-history.json`; restore them beside the settings document.
  const mapped = manifest.entries[name];
  if (mapped && mapped.toLowerCase().endsWith(".json")) {
    return {
      name,
      kind: "json",
      source: userDataPath(path.posix.basename(mapped)),
      entry: mapped,
      available: true,
    };
  }
  return {
    name,
    kind: "dir",
    source: userDataPath(name),
    entry: mapped ?? `files/${name}`,
    available: true,
  };
}

export interface RestoreArchiveOptions {
  sourcePath: string;
  domains?: string[] | null;
  mode?: string | null;
  createSafetySnapshot?: boolean;
  config: BackupConfig;
  onProgress?: (payload: BackupProgressPayload) => void;
}

export async function restoreArchive(options: RestoreArchiveOptions): Promise<BackupOutcome> {
  const { sourcePath, config } = options;
  const reporter = new BackupProgressReporter(options.onProgress ?? (() => undefined));
  // Validate before touching anything (including the safety snapshot).
  const manifest = readManifest(sourcePath);
  const zip = openArchive(sourcePath);
  const raw = isRawManifest(manifest);
  const mode = options.mode === "merge" ? "merge" : "replace";

  const requested =
    options.domains && options.domains.length > 0
      ? options.domains
      : manifest.domains.slice();
  for (const name of requested) {
    if (!manifest.domains.includes(name)) {
      throw new Error(`Backup does not contain "${name}"`);
    }
  }
  if (requested.length === 0) throw new Error("Nothing selected to restore");

  reporter.phase("preparing", "Preparing restore...", { percent: 2, force: true });

  if (options.createSafetySnapshot) {
    const safetyPath = path.join(
      config.backupDir,
      `safety-pre-restore-${localStamp()}.gibak`,
    );
    try {
      reporter.phase("snapshotting", "Saving a safety snapshot...", { percent: 6, force: true });
      await createArchive({
        targetPath: safetyPath,
        config,
        note: "Automatic snapshot before restore",
        recordStatus: false,
      });
    } catch (error) {
      console.error("[backup] safety snapshot failed:", error);
    }
  }

  const restored: string[] = [];
  const warnings: string[] = [];
  const totalDomains = requested.length;

  for (let index = 0; index < requested.length; index += 1) {
    const name = requested[index];
    const percent = 10 + Math.round((index / Math.max(1, totalDomains)) * 80);
    reporter.phase("restoring", `Restoring ${name}...`, {
      currentDomain: name,
      domainIndex: index + 1,
      totalDomains,
      percent,
      force: true,
    });

    try {
      if (raw) {
        const warningCount = warnings.length;
        const records = restoreRawDomain(zip, name, mode, warnings);
        if (!hasRawEntries(zip, name)) {
          const count = manifest.counts?.[name] ?? 0;
          if (count > 0) {
            warnings.push(`Missing ${name} records in archive`);
            continue;
          }
        }
        if (records === 0 && warnings.length > warningCount) continue;
        restored.push(name);
        continue;
      }

      const spec = resolveDomainSpec(name, config, manifest);
      const entryName = domainEntry(manifest, name, zip) ?? spec.entry;

      if (spec.kind === "dir" && domainKind(name) === "unknown" && looksLikeDbEntry(entryName)) {
        warnings.push(`${name}: database not supported by this build`);
        continue;
      }

      if (spec.kind === "dir") {
        const count = await restoreDirectory(spec, zip, mode);
        if (count === 0) {
          warnings.push(`No files restored for ${name}`);
          continue;
        }
        restored.push(name);
        continue;
      }

      const entry = zip.getEntry(entryName);
      if (!entry) {
        warnings.push(`Missing ${name} in archive`);
        continue;
      }

      if (spec.kind === "db") {
        restoreDatabase(restoreDomainName(name), entry.getData(), mode);
      } else {
        const destination = spec.source;
        await fsp.mkdir(path.dirname(destination), { recursive: true });
        const temp = `${destination}.${process.pid}.restore`;
        await fsp.writeFile(temp, entry.getData());
        await fsp.rename(temp, destination);
      }
      restored.push(name);
    } catch (error) {
      warnings.push(
        `${name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // The raw writer also bundled custom artwork beside the records.
  if (raw && config.includeArtwork) {
    try {
      const artwork = await restoreLegacyArtwork(zip, warnings);
      if (artwork > 0) restored.push("artwork");
    } catch (error) {
      warnings.push(
        `artwork: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const pluginAsset = zip
      .getEntries()
      .some((entry) => !entry.isDirectory && isLegacyPluginAsset(entry.entryName));
    if (pluginAsset) {
      warnings.push("Plugin files in this archive were not restored");
    }
  }

  reporter.complete(`Restore complete — ${restored.length}/${totalDomains} item(s)`);
  const outcome: BackupOutcome = {
    filePath: path.resolve(sourcePath),
    sizeBytes: fs.statSync(sourcePath).size,
    createdAt: Number(manifest.createdAt ?? 0),
    domains: restored,
    restartRequired: true,
  };
  if (warnings.length > 0) outcome.skippedDomains = warnings;
  return outcome;
}

// ── Cloud sync folders ──────────────────────────────────────────────────────

export function detectCloudPaths(): CloudPathOption[] {
  const home = process.env.USERPROFILE || process.env.HOME || "";
  if (!home) return [];
  const candidates: { provider: string; path: string }[] = [
    {
      provider: "OneDrive",
      path: process.env.OneDrive?.trim() || path.join(home, "OneDrive"),
    },
    {
      provider: "OneDrive",
      path: process.env.OneDriveConsumer?.trim() ?? "",
    },
    {
      provider: "OneDrive",
      path: process.env.OneDriveCommercial?.trim() ?? "",
    },
    { provider: "Dropbox", path: process.env.DROPBOX?.trim() || path.join(home, "Dropbox") },
    { provider: "Google Drive", path: path.join(home, "Google Drive") },
    { provider: "Google Drive", path: path.join(home, "My Drive") },
    { provider: "Google Drive", path: path.join(home, "GoogleDrive") },
    { provider: "Nextcloud", path: path.join(home, "Nextcloud") },
    { provider: "iCloud Drive", path: path.join(home, "iCloudDrive") },
    { provider: "Documents", path: path.join(home, "Documents") },
  ];

  const seen = new Set<string>();
  const out: CloudPathOption[] = [];
  for (const candidate of candidates) {
    if (!candidate.path) continue;
    const resolved = path.resolve(candidate.path);
    const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      if (!fs.statSync(resolved).isDirectory()) continue;
    } catch {
      continue;
    }
    out.push({ provider: candidate.provider, path: resolved, exists: true });
  }
  return out;
}
