/**
 * On-disk save-snapshot format (`.gisave`), ported from
 * `src-tauri/src/saves/engine.rs`.
 *
 * A snapshot is a **single Deflated zip** at
 * `<backupDir>/<game-id>/<created-at>-<kind>.gisave`:
 *
 * ```text
 * manifest.json          # locations + per-file index (forward-slash rel paths)
 * files/<location-index>/<relative path…>
 * ```
 *
 * `manifest.json` uses the Rust `BackupManifest` schema exactly
 * (`format`/`version`/`gameId`/`gameName`/`createdAt`/`kind`/`note`,
 * `locations[]` with `index/path/kind/label/source/fileCount/totalBytes`,
 * `files[]` with `locationIndex/rel/size/modifiedMs`). Nothing else is added
 * so archives stay readable by the retired Tauri build.
 *
 * The reader additionally understands the two shapes older builds left on
 * disk:
 *
 *  - legacy directory snapshots (`<snapshot>/manifest.json` + `files/…`);
 *  - the first Electron port's `<snapshot>/manifest.json` + `backup.zip`
 *    (manifest version 2, optional `hash`/`dedupe` per file).
 *
 * This module is deliberately free of Electron and SQLite imports so the
 * archive logic can be exercised by a plain Node harness.
 */
import AdmZip from "adm-zip";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { SaveManifest, SaveManifestLocation } from "./types";

export const MANIFEST_FORMAT = "gameindex-save-backup";
/** Version written by this build and by the Rust engine. */
export const MANIFEST_VERSION = 1;
/** Extension of the single-file snapshot archive (a Deflated zip). */
export const ARCHIVE_EXT = "gisave";
/** Manifest entry name inside the archive / legacy snapshot directory. */
export const MANIFEST_JSON = "manifest.json";
/** Directory inside the archive that holds captured files. */
export const FILES_DIR = "files";
/** Archive name used by the first Electron port's directory snapshots. */
export const LEGACY_ARCHIVE_NAME = "backup.zip";

// ── Ignore globs ────────────────────────────────────────────────────────────

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

// ── Path helpers ────────────────────────────────────────────────────────────

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

/** True when a path is a `.gisave` archive (as opposed to a directory). */
export function isArchivePath(target: string): boolean {
  return path.extname(target).replace(/^\./, "").toLowerCase() === ARCHIVE_EXT;
}

export function toForward(value: string): string {
  return value.replace(/\\/g, "/");
}

function normalizeCase(value: string): string {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

/** True when `child` is `parent` or lives below it. */
export function isInside(child: string, parent: string): boolean {
  const c = normalizeCase(path.resolve(child));
  const p = normalizeCase(path.resolve(parent));
  return c === p || c.startsWith(p.endsWith(path.sep) ? p : `${p}${path.sep}`);
}

/** True when `target` lives inside any of `roots`. */
export function isInsideAny(target: string, roots: string[]): boolean {
  return roots.some((root) => isInside(target, root));
}

/** SHA-256 of a buffer, lowercase hex. */
export function sha256(data: Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/** Archive entry name for one captured file (Rust layout). */
export function entryNameFor(locationIndex: number, rel: string): string {
  return `${FILES_DIR}/${locationIndex}/${toForward(rel)}`;
}

/** Pick a non-colliding `createdAt-kind.gisave` path (Rust `unique_archive_path`). */
export function uniqueArchivePath(
  gameDir: string,
  createdAt: number,
  kind: string,
): string {
  const stem = `${createdAt}-${safeComponent(kind)}`;
  let candidate = path.join(gameDir, `${stem}.${ARCHIVE_EXT}`);
  let counter = 0;
  while (fs.existsSync(candidate)) {
    counter += 1;
    candidate = path.join(gameDir, `${stem}-${counter}.${ARCHIVE_EXT}`);
  }
  return candidate;
}

/**
 * Destination for one captured file, or `null` when the manifest entry would
 * escape the location root (zip-slip guard).
 */
export function safeDestination(
  location: SaveManifestLocation,
  rel: string,
): string | null {
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

// ── Manifest parsing ────────────────────────────────────────────────────────

/** Parse + shape-check a manifest payload. Returns `null` when invalid. */
export function parseManifest(raw: string): SaveManifest | null {
  try {
    const parsed = JSON.parse(raw) as SaveManifest;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.format !== MANIFEST_FORMAT) return null;
    if (typeof parsed.version !== "number") return null;
    if (!Array.isArray(parsed.locations) || !Array.isArray(parsed.files)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Read the manifest entry of a zip archive. */
export function readZipManifest(archivePath: string): SaveManifest | null {
  try {
    const zip = new AdmZip(archivePath);
    const entry = zip.getEntry(MANIFEST_JSON);
    if (!entry || entry.isDirectory) return null;
    return parseManifest(entry.getData().toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * Locate a snapshot manifest, whether the row points at a `.gisave`, the first
 * Electron port's `backup.zip`, or a legacy directory snapshot.
 */
export function resolveManifest(backup: {
  rootPath: string;
  manifestPath?: string;
}): SaveManifest | null {
  const root = backup.rootPath?.trim() ?? "";
  const hint = backup.manifestPath?.trim() ?? "";
  if (!root && !hint) return null;

  let stat: fs.Stats | null = null;
  if (root) {
    try {
      stat = fs.statSync(root);
    } catch {
      stat = null;
    }
  }

  if (root && stat?.isFile()) {
    const fromZip = readZipManifest(root);
    if (fromZip) return fromZip;
    // The first Electron port kept `manifest.json` beside `backup.zip`.
    try {
      return parseManifest(
        fs.readFileSync(path.join(path.dirname(root), MANIFEST_JSON), "utf8"),
      );
    } catch {
      return null;
    }
  }

  const candidates: string[] = [];
  if (hint) candidates.push(hint);
  if (root && stat?.isDirectory()) {
    candidates.push(path.join(root, MANIFEST_JSON));
  }
  for (const candidate of candidates) {
    try {
      const manifest = parseManifest(fs.readFileSync(candidate, "utf8"));
      if (manifest) return manifest;
    } catch {
      /* try the next shape */
    }
  }

  if (root && stat?.isDirectory()) {
    const legacyZip = path.join(root, LEGACY_ARCHIVE_NAME);
    try {
      if (fs.statSync(legacyZip).isFile()) return readZipManifest(legacyZip);
    } catch {
      /* no nested archive */
    }
  }
  return null;
}

// ── Writing ─────────────────────────────────────────────────────────────────

export interface PendingEntry {
  /** Forward-slash archive entry name. */
  entry: string;
  data: Buffer;
}

/**
 * Write a snapshot zip atomically: every entry, then `manifest.json` last
 * (Rust writes the manifest after the files).
 */
export function writeSnapshotArchive(
  archivePath: string,
  manifest: SaveManifest,
  entries: PendingEntry[],
): void {
  const zip = new AdmZip();
  for (const item of entries) zip.addFile(item.entry, item.data);
  zip.addFile(MANIFEST_JSON, Buffer.from(JSON.stringify(manifest, null, 2), "utf8"));

  fs.mkdirSync(path.dirname(archivePath), { recursive: true });
  const temp = `${archivePath}.${process.pid}.tmp`;
  try {
    zip.writeZip(temp);
    fs.rmSync(archivePath, { force: true });
    fs.renameSync(temp, archivePath);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

// ── Reading ─────────────────────────────────────────────────────────────────

export interface SnapshotReader {
  /** Entry bytes, or `null` when the entry is absent or unsafe. */
  get(entryName: string): Promise<Buffer | null>;
}

function zipReader(zip: AdmZip): SnapshotReader {
  return {
    async get(entryName: string): Promise<Buffer | null> {
      try {
        const entry = zip.getEntry(entryName);
        if (!entry || entry.isDirectory) return null;
        return entry.getData();
      } catch {
        return null;
      }
    },
  };
}

/**
 * Open whichever on-disk shape the backup row describes:
 * a `.gisave` (or any zip file), the first port's `backup.zip` inside a
 * directory, or a legacy directory with a loose `files/` tree.
 */
export async function openSnapshotReader(backup: {
  rootPath: string;
  manifestPath?: string;
}): Promise<SnapshotReader> {
  const hint = backup.manifestPath?.trim() ?? "";
  const root = backup.rootPath?.trim() || (hint ? path.dirname(hint) : "");
  if (!root) return { get: async () => null };

  let stat: fs.Stats | null = null;
  try {
    stat = await fsp.stat(root);
  } catch {
    stat = null;
  }
  if (!stat) return { get: async () => null };

  if (stat.isFile()) {
    try {
      return zipReader(new AdmZip(root));
    } catch {
      return { get: async () => null };
    }
  }

  const legacyZip = path.join(root, LEGACY_ARCHIVE_NAME);
  try {
    if ((await fsp.stat(legacyZip)).isFile()) {
      return zipReader(new AdmZip(legacyZip));
    }
  } catch {
    /* legacy directory snapshot */
  }

  // Legacy directory snapshot: entries are rooted at the snapshot folder
  // (`files/<index>/<rel>` lives under `<snapshot>/files/...`).
  const filesRoot = path.resolve(root);
  return {
    async get(entryName: string): Promise<Buffer | null> {
      const relative = toForward(entryName);
      if (!relative || relative.startsWith("/") || /^[a-zA-Z]:/.test(relative)) {
        return null;
      }
      const segments = relative.split("/");
      if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
        return null;
      }
      const target = path.resolve(filesRoot, ...segments);
      if (!isInside(target, filesRoot)) return null;
      try {
        return await fsp.readFile(target);
      } catch {
        return null;
      }
    },
  };
}
