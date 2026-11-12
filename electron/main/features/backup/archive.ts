/**
 * Whole-app backup & restore engine (ported from `src-tauri/src/backup.rs` and
 * `backup_raw.rs`).
 *
 * A `.gibak` archive is a plain zip:
 *
 * ```text
 * manifest.json            # magic, version, app version, domain -> entry map
 * domains/<name>.db        # consistent snapshot of each SQLite domain
 * json/<file>.json         # the app's JSON documents (settings, caches)
 * files/artwork/…          # optional custom artwork, under the configured cap
 * files/crashlog/…         # only when `includeLogs` is on
 * ```
 *
 * Databases are snapshotted through SQLite itself (`wal_checkpoint(TRUNCATE)`
 * + a synchronous file copy, so no write can interleave), and restored through
 * `ATTACH` + table copies rather than by swapping files under live
 * connections. That keeps the process consistent and lets "merge" be a real
 * row-level upsert; the UI still offers a restart so JSON-backed caches reload.
 */
import AdmZip from "adm-zip";
import { app } from "electron";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { userDataPath } from "../../lib/paths";
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

const KV_LAST_AT = "backup.last_at";
const KV_LAST_BYTES = "backup.last_bytes";
const MANIFEST_JSON = "manifest.json";
const SQLITE_HEADER = "SQLite format 3\0";

/** Domain order in the overview and the manifest. */
const DB_DOMAINS: DbDomain[] = Object.keys(DB_FILES) as DbDomain[];

const JSON_DOMAINS: { name: string; file: string }[] = [
  { name: "settings", file: "app-settings.json" },
  { name: "storage_history", file: "storage-history.json" },
  { name: "plugin_cache", file: "plugin_availability_cache.json" },
];

const DIR_DOMAINS: { name: string; dir: string; capBytes: number }[] = [
  { name: "artwork", dir: "artwork", capBytes: DEFAULT_ARTWORK_CAP_BYTES },
  { name: "logs", dir: "crashlog", capBytes: 20 * 1024 * 1024 },
];

/** Primary-record count per SQLite domain, matching the Rust overview. */
const SQLITE_COUNT_SQL: Record<DbDomain, string> = {
  games: "SELECT count(*) AS n FROM games",
  sessions: "SELECT count(*) AS n FROM sessions",
  game_notes: "SELECT count(*) AS n FROM game_notes",
  shelves:
    "SELECT (SELECT count(*) FROM shelves) + (SELECT count(*) FROM game_completions) AS n",
  wishlist: "SELECT count(*) AS n FROM wishlist",
  saves:
    "SELECT (SELECT count(*) FROM save_locations) + (SELECT count(*) FROM save_backups) AS n",
  kv: "SELECT count(*) AS n FROM kv_store",
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
      const row = prepare(domain, SQLITE_COUNT_SQL[domain]).get() as
        | { n?: number | bigint }
        | undefined;
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

/** Read and validate the manifest of an archive (throws with a clear reason). */
export function readManifest(filePath: string): ArchiveManifest {
  const zip = openArchive(filePath);
  const entry = zip.getEntry(MANIFEST_JSON);
  if (!entry) throw new Error("Archive missing manifest.json");
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
  if (parsed.format !== BACKUP_MAGIC && parsed.format !== "gameindex-raw-backup") {
    throw new Error(`Unsupported backup format: ${parsed.format}`);
  }
  if (!Array.isArray(parsed.domains) || !parsed.entries) {
    throw new Error("Archive manifest is incomplete — regenerate the backup");
  }
  return parsed;
}

export function inspectArchive(filePath: string): BackupInspect {
  const manifest = readManifest(filePath);
  return {
    createdAt: Number(manifest.createdAt ?? 0),
    appVersion: String(manifest.appVersion ?? ""),
    domains: manifest.domains,
    isRaw: manifest.format === "gameindex-raw-backup",
    counts: manifest.counts ?? {},
  };
}

// ── Listing / management ────────────────────────────────────────────────────

function archiveExtension(filePath: string): string {
  return path.extname(filePath).replace(/^\./, "").toLowerCase();
}

export function listArchives(dir: string): BackupArchiveSummary[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const summaries: BackupArchiveSummary[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const filePath = path.join(dir, entry.name);
    if (!["gibak", "zip"].includes(archiveExtension(filePath))) continue;
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
        isRaw: manifest.format === "gameindex-raw-backup",
        counts,
      });
    } catch {
      // A random zip (or a truncated archive) is simply not listed.
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
  if (!["gibak", "zip"].includes(archiveExtension(target))) {
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
    if (!["gibak", "zip"].includes(archiveExtension(filePath))) continue;
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
  return path.join(backupDir, `gameindex-backup-${timestamp}${suffix}.gibak`);
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
  const { targetPath, config } = options;
  const reporter = new BackupProgressReporter(
    options.onProgress ?? (() => undefined),
  );
  reporter.phase("preparing", "Preparing backup snapshot...", { percent: 5, force: true });

  const all = availableDomains(config).filter((spec) => spec.available);
  const requested = options.domains?.filter((name) => typeof name === "string") ?? null;
  if (requested) {
    for (const name of requested) {
      if (!all.some((spec) => spec.name === name)) {
        throw new Error(`Unknown backup item: ${name}`);
      }
    }
  }

  const defaultNames = all
    .filter((spec) => spec.kind !== "dir" || spec.name !== "artwork" || config.includeArtwork)
    .map((spec) => spec.name);
  const chosenNames = requested && requested.length > 0 ? requested : defaultNames;
  const chosen = chosenNames
    .map((name) => all.find((spec) => spec.name === name))
    .filter((spec): spec is DomainSpec => Boolean(spec));

  const existing = chosen.filter((spec) => fs.existsSync(spec.source));
  if (existing.length === 0) throw new Error("Nothing to back up yet");

  const target = path.resolve(targetPath);
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
        staged.push({ spec, stagedPath: path.join(staging, ...spec.entry.split("/")), bytes: result.bytes });
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
    zip.writeZip(target);

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

export function verifyArchive(filePath: string): BackupVerifyReport {
  const manifest = readManifest(filePath);
  const zip = openArchive(filePath);
  const details: DomainVerifyDetail[] = [];
  const corrupted: string[] = [];
  let totalRecords = 0;

  for (const domain of manifest.domains) {
    const entryName = manifest.entries[domain];
    const count = manifest.counts?.[domain] ?? 0;
    let valid = false;
    let error: string | null = null;

    try {
      const entry = entryName ? zip.getEntry(entryName) : null;
      if (!entry) {
        error = `Missing ${entryName ?? domain} in archive`;
      } else {
        const data = entry.getData();
        const specKind = DB_DOMAINS.includes(domain as DbDomain)
          ? "db"
          : JSON_DOMAINS.some((doc) => doc.name === domain)
            ? "json"
            : "dir";
        if (specKind === "db") {
          valid =
            data.byteLength >= 16 && data.subarray(0, 16).toString("latin1") === SQLITE_HEADER;
          if (!valid) error = "Invalid SQLite database header";
        } else if (specKind === "json") {
          JSON.parse(data.toString("utf8"));
          valid = true;
        } else {
          const prefix = `${entryName.replace(/\/+$/, "")}/`;
          valid = zip
            .getEntries()
            .some((candidate) => !candidate.isDirectory && candidate.entryName.startsWith(prefix));
          if (!valid) error = `No files captured under ${entryName}`;
        }
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
      valid = false;
    }

    if (!valid) corrupted.push(domain);
    else totalRecords += count;
    details.push({ domain, valid, recordsFound: valid ? count : 0, error });
  }

  const totalDomains = manifest.domains.length;
  const healthyDomains = totalDomains - corrupted.length;
  const valid = corrupted.length === 0;
  return {
    filePath,
    valid,
    isRaw: manifest.format === "gameindex-raw-backup",
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
    const liveCount = countDomain(name);
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

function tableColumns(db: ReturnType<typeof openDb>, schema: string, table: string): string[] {
  const rows = db
    .prepare(`PRAGMA ${schema}.table_info(${quoteIdent(table)})`)
    .all() as { name?: string }[];
  return rows.map((row) => String(row.name ?? ""));
}

function isInside(child: string, parent: string): boolean {
  const normalize = (value: string): string =>
    process.platform === "win32" ? value.toLowerCase() : value;
  const c = normalize(child);
  const p = normalize(parent);
  return c === p || c.startsWith(p.endsWith(path.sep) ? p : `${p}${path.sep}`);
}

/**
 * Replace/merge a domain's tables from an archived database.
 *
 * Schema mismatches are detected before anything is deleted, so a failed
 * restore can never leave a half-emptied table behind.
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

      for (const table of tables) {
        const source = tableColumns(db, "restore_src", table);
        const live = tableColumns(db, "main", table);
        if (
          live.length === 0 ||
          source.length !== live.length ||
          source.some((column, index) => column !== live[index])
        ) {
          throw new Error(
            `Cannot restore ${domain}.${table}: the archive schema does not match this build`,
          );
        }
      }

      const replace = mode === "replace";
      const run = db.transaction(() => {
        for (const table of tables) {
          const quoted = quoteIdent(table);
          if (replace) db.exec(`DELETE FROM main.${quoted}`);
          db.exec(
            `INSERT ${replace ? "" : "OR REPLACE "}INTO main.${quoted} ` +
              `SELECT * FROM restore_src.${quoted}`,
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
  return {
    name,
    kind: "dir",
    source: userDataPath(dir?.dir ?? name),
    entry: manifest.entries[name] ?? `files/${name}`,
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
  const manifest = readManifest(sourcePath);
  const zip = openArchive(sourcePath);
  const mode = options.mode === "merge" ? "merge" : "replace";

  const requested =
    options.domains && options.domains.length > 0
      ? options.domains
      : manifest.domains.slice();
  for (const name of requested) {
    if (!manifest.domains.includes(name)) {
      throw new Error(`Archive does not contain: ${name}`);
    }
  }

  reporter.phase("preparing", "Preparing restore...", { percent: 2, force: true });

  if (options.createSafetySnapshot) {
    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\..+$/, "")
      .replace("T", "-");
    const safetyPath = path.join(config.backupDir, `safety-pre-restore-${stamp}.gibak`);
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

    const spec = resolveDomainSpec(name, config, manifest);
    const entryName = manifest.entries[name] ?? spec.entry;
    const entry = zip.getEntry(entryName);
    if (!entry) {
      warnings.push(`Missing ${name} in archive`);
      continue;
    }

    try {
      if (spec.kind === "db") {
        restoreDatabase(name as DbDomain, entry.getData(), mode);
      } else if (spec.kind === "json") {
        const destination = spec.source;
        await fsp.mkdir(path.dirname(destination), { recursive: true });
        const temp = `${destination}.${process.pid}.restore`;
        await fsp.writeFile(temp, entry.getData());
        await fsp.rename(temp, destination);
      } else {
        const count = await restoreDirectory(spec, zip, mode);
        if (count === 0) warnings.push(`No files restored for ${name}`);
      }
      restored.push(name);
    } catch (error) {
      warnings.push(
        `${name}: ${error instanceof Error ? error.message : String(error)}`,
      );
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
