/**
 * Filesystem / storage helpers.
 *
 * These are direct Node ports of the dependency-free parts of
 * `src-tauri/src/size.rs`, `storage_scan.rs`, `storage_history.rs` and
 * `game_versions.rs`. Everything that needs WMI, Steam manifests or the store
 * integrations stays stubbed (see PORTING.md).
 */
import { app } from "electron";
import fs from "node:fs";
import type { Dirent } from "node:fs";
import path from "node:path";
import type { CommandHandler } from "../ipc";
import { createJsonStore } from "../state/jsonStore";

// ── Small argument helpers ────────────────────────────────────────────
function stringArg(args: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string") return value;
  }
  return "";
}

function numberArg(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

// ── Size measurement ─────────────────────────────────────────────────
interface SizeDetectionResult {
  rootPath: string;
  sizeBytes: number;
}

async function sumFolder(root: string): Promise<SizeDetectionResult> {
  let stats: fs.Stats;
  try {
    stats = await fs.promises.stat(root);
  } catch {
    throw new Error(`Folder does not exist: ${root}`);
  }
  if (!stats.isDirectory()) throw new Error(`Not a directory: ${root}`);

  let total = 0;
  const stack: string[] = [root];
  const visited = new Set<string>();

  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let real: string;
    try {
      real = await fs.promises.realpath(dir);
    } catch {
      continue;
    }
    if (visited.has(real)) continue;
    visited.add(real);

    let entries: Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(child);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        total += (await fs.promises.lstat(child)).size;
      } catch {
        // Unreadable file: keep the partial sum, matching the Rust walker.
      }
    }
  }

  return { rootPath: root, sizeBytes: total };
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Climb up to 8 parents looking for a folder named after the game. */
function walkUpFindRoot(exePath: string, gameName: string): string | null {
  const target = normalizeName(gameName);
  if (!target) return null;
  let current = path.dirname(exePath);
  for (let hop = 0; hop <= 8; hop += 1) {
    const name = path.basename(current);
    if (normalizeName(name) === target) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

// ── Disk usage ───────────────────────────────────────────────────────
async function usageFor(target: string): Promise<{ total: number; free: number; available: number }> {
  const stats = await fs.promises.statfs(target);
  const blockSize = Number(stats.bsize);
  return {
    total: blockSize * Number(stats.blocks),
    free: blockSize * Number(stats.bfree),
    available: blockSize * Number(stats.bavail),
  };
}

// ── Leftover-folder scan ─────────────────────────────────────────────
const RESERVED_FOLDER_NAMES = new Set([
  "$recycle.bin",
  "system volume information",
  "$windows.~bt",
  "$windows.~ws",
  "config.msi",
  "recovery",
  "windows",
  "steamapps",
  "steam library",
  ".temp_downloads",
]);

const MAX_MEASURED_LEFTOVERS = 60;

function normalizePathForCompare(value: string): string {
  let out = value.replace(/\\/g, "/");
  while (out.length > 1 && out.endsWith("/")) out = out.slice(0, -1);
  return out.toLowerCase();
}

function isClaimed(candidate: string, known: string[]): boolean {
  const normalizedCandidate = normalizePathForCompare(candidate);
  return known.some((entry) => {
    if (!entry || !normalizedCandidate) return false;
    if (entry === normalizedCandidate) return true;
    const nested = (outer: string, inner: string): boolean =>
      inner.startsWith(outer) && inner.charAt(outer.length) === "/";
    return (
      nested(normalizedCandidate, entry) || nested(entry, normalizedCandidate)
    );
  });
}

function isReservedFolder(name: string): boolean {
  return name.startsWith(".") || RESERVED_FOLDER_NAMES.has(name.toLowerCase());
}

// ── PE version resource reader ───────────────────────────────────────
function readRange(fd: number, position: number, length: number): Buffer {
  if (length <= 0) return Buffer.alloc(0);
  const buffer = Buffer.alloc(length);
  const read = fs.readSync(fd, buffer, 0, length, position);
  return read === length ? buffer : buffer.subarray(0, Math.max(0, read));
}

function normalizeVersion(raw: string): string | null {
  let trimmed = raw.trim();
  if (!trimmed || /[\u0000-\u001f]/.test(trimmed)) return null;

  const lower = trimmed.toLowerCase();
  for (const prefix of ["release", "version", "ver.", "ver", "build", "v."]) {
    if (lower.startsWith(prefix)) {
      const rest = trimmed.slice(prefix.length).trimStart();
      if (rest && /^[0-9v]/i.test(rest)) {
        trimmed = rest;
        break;
      }
    }
  }

  if (/^[vV]/.test(trimmed) && trimmed.length > 1) {
    const after = trimmed.slice(1).trimStart();
    if (/^[0-9]/.test(after)) trimmed = after;
  }

  const commaCleaned = trimmed.includes(",")
    ? trimmed
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .join(".")
    : trimmed;

  let cut = commaCleaned.trim();
  const stop = cut.search(/[\s([\]]/);
  if (stop >= 0) cut = cut.slice(0, stop).trim();

  const plus = cut.indexOf("+");
  if (plus > 0) {
    const hash = cut.slice(plus + 1);
    if (hash.length >= 6 && /^[0-9a-f]+$/i.test(hash)) cut = cut.slice(0, plus).trim();
  }

  return cut.length > 0 ? cut : null;
}

function readVersionString(block: Buffer, key: string): string | null {
  const pattern = Buffer.from(`${key}\u0000`, "utf16le");
  const keyIndex = block.indexOf(pattern);
  if (keyIndex < 6) return null;

  const structStart = keyIndex - 6;
  const declaredWords = block.readUInt16LE(structStart + 2);
  let valueStart = keyIndex + (key.length + 1) * 2;
  while (valueStart % 4 !== 0) valueStart += 1;
  if (valueStart >= block.length) return null;

  const words =
    declaredWords > 0 && declaredWords <= 512 ? declaredWords : 256;
  let end = Math.min(block.length, valueStart + words * 2);
  let cursor = valueStart;
  while (cursor + 1 < end) {
    if (block.readUInt16LE(cursor) === 0) {
      end = cursor;
      break;
    }
    cursor += 2;
  }
  if (end <= valueStart) return null;

  return normalizeVersion(block.toString("utf16le", valueStart, end));
}

function versionFromBlock(block: Buffer): string | null {
  const product = readVersionString(block, "ProductVersion");
  if (product) return product;

  const file = readVersionString(block, "FileVersion");
  if (file) return file;

  const scanLimit = Math.min(block.length - 16, 160);
  for (let offset = 0; offset <= scanLimit; offset += 4) {
    if (block.readUInt32LE(offset) !== 0xfeef04bd) continue;
    const ms = block.readUInt32LE(offset + 8);
    const ls = block.readUInt32LE(offset + 12);
    const major = (ms >>> 16) & 0xffff;
    const minor = ms & 0xffff;
    const build = (ls >>> 16) & 0xffff;
    const revision = ls & 0xffff;
    if (major === 0 && minor === 0 && build === 0 && revision === 0) return null;
    if (revision !== 0) return `${major}.${minor}.${build}.${revision}`;
    if (build !== 0) return `${major}.${minor}.${build}`;
    return `${major}.${minor}`;
  }
  return null;
}

/** Read the Windows file/ProductVersion resource of a PE executable. */
function readExeVersion(exePath: string): string | null {
  let fd: number | null = null;
  try {
    if (!fs.statSync(exePath).isFile()) return null;
    fd = fs.openSync(exePath, "r");

    const dos = readRange(fd, 0, 64);
    if (dos.length < 64 || dos.readUInt16LE(0) !== 0x5a4d) return null;
    const peOffset = dos.readUInt32LE(0x3c);
    if (peOffset < 0x40 || peOffset > 0x10000000) return null;

    const coff = readRange(fd, peOffset, 24);
    if (coff.length < 24 || coff.readUInt32LE(0) !== 0x00004550) return null;
    const sectionCount = coff.readUInt16LE(6);
    const optionalSize = coff.readUInt16LE(20);
    if (sectionCount === 0 || sectionCount > 512) return null;

    const optional = readRange(fd, peOffset + 24, optionalSize);
    if (optional.length < 96) return null;
    const magic = optional.readUInt16LE(0);

    let dataDirOffset: number;
    let rvaCountOffset: number;
    if (magic === 0x20b) {
      dataDirOffset = 112;
      rvaCountOffset = 108;
    } else if (magic === 0x10b) {
      dataDirOffset = 96;
      rvaCountOffset = 92;
    } else {
      return null;
    }
    if (optional.length < dataDirOffset + 24) return null;
    const rvaCount = optional.readUInt32LE(rvaCountOffset);
    if (rvaCount < 3) return null;
    const resourceRva = optional.readUInt32LE(dataDirOffset + 2 * 8);
    if (resourceRva === 0) return null;

    const sectionTable = readRange(fd, peOffset + 24 + optionalSize, sectionCount * 40);
    const sections: { va: number; size: number; rawPtr: number; rawSize: number }[] = [];
    for (let i = 0; i < sectionCount; i += 1) {
      const base = i * 40;
      if (base + 40 > sectionTable.length) break;
      sections.push({
        va: sectionTable.readUInt32LE(base + 12),
        size: sectionTable.readUInt32LE(base + 8),
        rawPtr: sectionTable.readUInt32LE(base + 20),
        rawSize: sectionTable.readUInt32LE(base + 16),
      });
    }

    const rvaToOffset = (rva: number): number | null => {
      for (const section of sections) {
        const span = Math.max(section.size, section.rawSize);
        if (rva >= section.va && rva < section.va + span) {
          return section.rawPtr + (rva - section.va);
        }
      }
      return null;
    };

    const resourceRoot = rvaToOffset(resourceRva);
    if (resourceRoot === null) return null;

    interface ResourceEntry {
      id: number;
      isNamed: boolean;
      isDirectory: boolean;
      target: number;
    }

    const readResourceDirectory = (offset: number): ResourceEntry[] | null => {
      const header = readRange(fd as number, offset, 16);
      if (header.length < 16) return null;
      const named = header.readUInt16LE(12);
      const ids = header.readUInt16LE(14);
      const count = named + ids;
      if (count === 0 || count > 4096) return null;
      const body = readRange(fd as number, offset + 16, count * 8);
      const out: ResourceEntry[] = [];
      for (let i = 0; i < count; i += 1) {
        const base = i * 8;
        if (base + 8 > body.length) break;
        const nameField = body.readUInt32LE(base);
        const targetField = body.readUInt32LE(base + 4);
        const isNamed = (nameField & 0x80000000) !== 0;
        const isDirectory = (targetField & 0x80000000) !== 0;
        out.push({
          id: isNamed ? -1 : nameField,
          isNamed,
          isDirectory,
          target: resourceRoot + (targetField & 0x7fffffff),
        });
      }
      return out;
    };

    // RT_VERSION is resource type 16. Named entries precede id entries, so
    // match on the id bit rather than assuming the first slot.
    const rootEntries = readResourceDirectory(resourceRoot);
    if (!rootEntries) return null;
    const versionType = rootEntries.find((entry) => !entry.isNamed && entry.id === 16);
    if (!versionType) return null;

    let directory = versionType.isDirectory ? versionType.target : null;
    let dataEntryOffset: number | null = versionType.isDirectory ? null : versionType.target;
    for (let depth = 0; depth < 3 && directory !== null; depth += 1) {
      const entries = readResourceDirectory(directory);
      if (!entries || entries.length === 0) break;
      const first = entries[0];
      if (first.isDirectory) {
        directory = first.target;
      } else {
        dataEntryOffset = first.target;
        directory = null;
      }
    }
    if (dataEntryOffset === null) return null;

    const dataEntry = readRange(fd, dataEntryOffset, 16);
    if (dataEntry.length < 16) return null;
    const dataRva = dataEntry.readUInt32LE(0);
    const dataSize = dataEntry.readUInt32LE(4);
    if (dataRva === 0 || dataSize === 0) return null;

    const versionOffset = rvaToOffset(dataRva);
    if (versionOffset === null) return null;
    const block = readRange(fd, versionOffset, Math.min(dataSize, 256 * 1024));
    return versionFromBlock(block);
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore
      }
    }
  }
}

// ── Installed-version detection ──────────────────────────────────────
function isLauncherOrHelper(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.includes("launcher") ||
    lower.includes("crashreport") ||
    lower.includes("crashhandler") ||
    lower.startsWith("unins") ||
    lower.startsWith("uninstall") ||
    lower.includes("easyanticheat") ||
    lower.includes("beservice") ||
    lower.includes("start_protected_game") ||
    lower.includes("installer") ||
    lower.includes("downloader") ||
    lower.includes("setup") ||
    lower.endsWith("prelauncher.exe")
  );
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await fs.promises.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(target: string): Promise<boolean> {
  try {
    return (await fs.promises.stat(target)).isFile();
  } catch {
    return false;
  }
}

function addUnique(list: string[], value: string): void {
  if (value && !list.includes(value)) list.push(value);
}

async function checkGogManifest(dirs: string[]): Promise<string | null> {
  for (const dir of dirs) {
    let entries: Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const lower = entry.name.toLowerCase();
      if (!entry.isFile() || !lower.startsWith("goggame-") || !lower.endsWith(".info")) {
        continue;
      }
      try {
        const parsed = JSON.parse(
          await fs.promises.readFile(path.join(dir, entry.name), "utf8"),
        ) as { version?: unknown };
        if (typeof parsed.version === "string") {
          const normalized = normalizeVersion(parsed.version);
          if (normalized && normalized !== "0.0.0.0") return normalized;
        }
      } catch {
        // ignore malformed manifest
      }
    }
  }
  return null;
}

async function checkFolderManifests(dirs: string[]): Promise<string | null> {
  for (const dir of dirs) {
    for (const file of ["version.txt", "build.info"]) {
      try {
        const content = await fs.promises.readFile(path.join(dir, file), "utf8");
        const normalized = normalizeVersion(content.split(/\r?\n/, 1)[0] ?? "");
        if (normalized) return normalized;
      } catch {
        // absent
      }
    }
    for (const file of ["version.json", "build.json"]) {
      try {
        const parsed = JSON.parse(
          await fs.promises.readFile(path.join(dir, file), "utf8"),
        ) as Record<string, unknown>;
        for (const key of ["version", "build_version", "app_version"]) {
          const value = parsed[key];
          if (typeof value === "string") {
            const normalized = normalizeVersion(value);
            if (normalized) return normalized;
          }
        }
      } catch {
        // absent or malformed
      }
    }
    try {
      const parsed = JSON.parse(
        await fs.promises.readFile(path.join(dir, "package.json"), "utf8"),
      ) as { version?: unknown };
      if (typeof parsed.version === "string") {
        const normalized = normalizeVersion(parsed.version);
        if (normalized) return normalized;
      }
    } catch {
      // absent
    }
  }
  return null;
}

async function findCandidateExes(root: string): Promise<string[]> {
  const dirs = [root];
  for (const sub of [
    "bin",
    "binaries",
    "bin/x64",
    "bin/win64",
    "x64",
    "x86_64",
    "bin/x86_64",
    "game",
  ]) {
    const dir = path.join(root, sub);
    if (await isDirectory(dir)) dirs.push(dir);
  }

  const candidates: { path: string; size: number }[] = [];
  for (const dir of dirs) {
    let entries: Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".exe")) continue;
      if (isLauncherOrHelper(entry.name)) continue;
      const target = path.join(dir, entry.name);
      try {
        const stats = await fs.promises.stat(target);
        candidates.push({ path: target, size: stats.size });
      } catch {
        // unreadable exe
      }
    }
  }
  candidates.sort((a, b) => b.size - a.size);
  return candidates.slice(0, 12).map((candidate) => candidate.path);
}

async function detectInstalledVersion(query: Record<string, unknown>): Promise<
  { version: string; source: string } | null
> {
  const candidateDirs: string[] = [];
  const installDir = stringArg(query, "installDir", "install_dir");
  const detectedExe = stringArg(query, "detectedExe", "detected_exe");
  const gamePath = stringArg(query, "path", "exePath", "exe_path");

  if (installDir && (await isDirectory(installDir))) addUnique(candidateDirs, installDir);
  for (const exe of [detectedExe, gamePath]) {
    if (!exe) continue;
    const parent = path.dirname(exe);
    addUnique(candidateDirs, parent);
    addUnique(candidateDirs, path.dirname(parent));
  }
  if (gamePath && (await isDirectory(gamePath))) addUnique(candidateDirs, gamePath);

  const gog = await checkGogManifest(candidateDirs);
  if (gog) return { version: gog, source: "gog_manifest" };

  for (const exe of [detectedExe, gamePath]) {
    if (!exe || isLauncherOrHelper(path.basename(exe)) || !(await isFile(exe))) continue;
    const version = readExeVersion(exe);
    if (version && version !== "0.0.0.0") return { version, source: "exe" };
  }

  const manifest = await checkFolderManifests(candidateDirs);
  if (manifest) return { version: manifest, source: "folder_manifest" };

  const exes: string[] = [];
  for (const exe of [detectedExe, gamePath]) {
    if (exe && (await isFile(exe))) addUnique(exes, exe);
  }
  if (exes.length === 0) {
    for (const dir of candidateDirs) {
      for (const candidate of await findCandidateExes(dir)) addUnique(exes, candidate);
    }
  }
  for (const exe of exes) {
    const version = readExeVersion(exe);
    if (version && version !== "0.0.0.0") return { version, source: "exe" };
  }
  return null;
}

// ── Storage history (kv document) ─────────────────────────────────────
interface ReclaimEvent {
  id: string;
  at: string;
  kind: string;
  bytes: number;
  count: number;
  label?: string | null;
}

interface SizeSnapshot {
  at: string;
  bytes: number;
  games: number;
}

interface StorageHistory {
  events: ReclaimEvent[];
  snapshots: SizeSnapshot[];
}

const storageHistoryStore = createJsonStore<StorageHistory>(
  "storage-history.json",
  () => ({
    events: [],
    snapshots: [],
  }),
  (doc) => {
    if (!Array.isArray(doc.events)) doc.events = [];
    if (!Array.isArray(doc.snapshots)) doc.snapshots = [];
    return doc;
  },
);

function trimStart<T>(items: T[], limit: number): T[] {
  return items.length > limit ? items.slice(items.length - limit) : items;
}

function dayOf(value: string): string {
  return value.slice(0, 10);
}

function normalizeReclaimEvent(raw: unknown): ReclaimEvent {
  if (!raw || typeof raw !== "object") throw new Error("storage_history_record expects an `event`");
  const input = raw as Partial<ReclaimEvent>;
  return {
    id: typeof input.id === "string" && input.id ? input.id : `${Date.now()}-${Math.random()}`,
    at: typeof input.at === "string" ? input.at : new Date().toISOString(),
    kind: typeof input.kind === "string" ? input.kind : "uninstall",
    bytes: Math.max(0, Math.round(numberArg(input.bytes, 0))),
    count: Math.max(1, Math.round(numberArg(input.count, 1))),
    label: typeof input.label === "string" ? input.label : null,
  };
}

function normalizeSnapshot(raw: unknown): SizeSnapshot {
  if (!raw || typeof raw !== "object") {
    throw new Error("storage_history_snapshot expects a `snapshot`");
  }
  const input = raw as Partial<SizeSnapshot>;
  return {
    at: typeof input.at === "string" ? input.at : new Date().toISOString(),
    bytes: Math.max(0, Math.round(numberArg(input.bytes, 0))),
    games: Math.max(0, Math.round(numberArg(input.games, 0))),
  };
}

// ── Command table ────────────────────────────────────────────────────
export const fileCommands: Record<string, CommandHandler> = {
  /** Parallel staleness probe: `true` means the path still exists. */
  check_paths_exist: async (args) => {
    const paths = stringArray(args.paths);
    return Promise.all(
      paths.map((target) =>
        fs.promises.access(target).then(
          () => true,
          () => false,
        ),
      ),
    );
  },

  disk_usage: async (args) => {
    const target = stringArg(args, "path") || app.getPath("userData");
    return usageFor(target);
  },

  resolve_mounts: async (args) => {
    const paths = stringArray(args.paths).filter((value) => value.trim() !== "");
    const rows: Array<{
      path: string;
      mountPoint: string;
      device: string;
      fileSystem: string;
      total: number;
      free: number;
      available: number;
    }> = [];

    for (const target of paths) {
      const resolved = path.resolve(target);
      const mountPoint = path.parse(resolved).root || resolved;
      try {
        const usage = await usageFor(mountPoint);
        rows.push({
          path: target,
          mountPoint,
          device: "",
          fileSystem: "",
          ...usage,
        });
      } catch {
        // Unreadable volume: omit it, mirroring the Rust `filter_map`.
      }
    }
    return rows;
  },

  measure_path_size: async (args) => {
    const target = stringArg(args, "path");
    if (!target.trim()) throw new Error("measure_path_size: empty path");

    let stats: fs.Stats;
    try {
      stats = await fs.promises.stat(target);
    } catch {
      throw new Error(`Path does not exist: ${target}`);
    }
    if (stats.isFile()) return { rootPath: target, sizeBytes: stats.size } satisfies SizeDetectionResult;
    return sumFolder(target);
  },

  detect_game_size: async (args) => {
    const rootOverride = stringArg(args, "rootOverride", "root_override");
    if (rootOverride) {
      if (!rootOverride.trim()) throw new Error("rootOverride was empty");
      return sumFolder(rootOverride);
    }

    const exePath = stringArg(args, "exePath", "exe_path", "path");
    const gameName = stringArg(args, "gameName", "game_name");
    if (!exePath) throw new Error("detect_game_size expects an `exePath`");

    const root =
      walkUpFindRoot(exePath, gameName) ?? path.dirname(exePath) ?? ".";
    return sumFolder(root);
  },

  scan_leftover_folders: async (args) => {
    const roots = stringArray(args.roots);
    const knownPaths = stringArray(args.knownPaths ?? args.known_paths).map(
      normalizePathForCompare,
    );

    const uniqueRoots = new Map<string, string>();
    for (const root of roots) {
      const key = normalizePathForCompare(root);
      if (key && !uniqueRoots.has(key)) uniqueRoots.set(key, root);
    }

    const found: Array<{
      path: string;
      name: string;
      bytes: number;
      modifiedAt: string | null;
    }> = [];
    let measured = 0;

    for (const root of uniqueRoots.values()) {
      if (!(await isDirectory(root))) continue;
      let entries: Dirent[];
      try {
        entries = await fs.promises.readdir(root, { withFileTypes: true });
      } catch {
        continue;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));

      for (const entry of entries) {
        if (!entry.isDirectory() || isReservedFolder(entry.name)) continue;
        const child = path.join(root, entry.name);
        if (isClaimed(child, knownPaths)) continue;

        let bytes = 0;
        if (measured < MAX_MEASURED_LEFTOVERS) {
          measured += 1;
          try {
            bytes = (await sumFolder(child)).sizeBytes;
          } catch {
            bytes = 0;
          }
        }

        let modifiedAt: string | null = null;
        try {
          modifiedAt = (await fs.promises.stat(child)).mtime.toISOString();
        } catch {
          modifiedAt = null;
        }

        found.push({ path: child, name: entry.name, bytes, modifiedAt });
      }
    }

    found.sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));
    return found.slice(0, 100);
  },

  get_exe_file_version: (args) => {
    const target = stringArg(args, "path", "exePath", "exe_path");
    return target ? readExeVersion(target) : null;
  },

  detect_game_version: async (args) => {
    const query =
      args.query && typeof args.query === "object"
        ? (args.query as Record<string, unknown>)
        : args;
    return detectInstalledVersion(query);
  },

  // ── Storage maintenance history ─────────────────────────────────
  storage_history_load: () => storageHistoryStore.read(),

  storage_history_record: (args) => {
    const event = normalizeReclaimEvent(args.event);
    return storageHistoryStore.update((doc) => {
      doc.events = doc.events.filter((existing) => existing.id !== event.id);
      doc.events.push(event);
      doc.events = trimStart(doc.events, 500);
      return doc;
    });
  },

  storage_history_snapshot: (args) => {
    const snapshot = normalizeSnapshot(args.snapshot);
    return storageHistoryStore.update((doc) => {
      const day = dayOf(snapshot.at);
      doc.snapshots = doc.snapshots.filter((existing) => dayOf(existing.at) !== day);
      doc.snapshots.push(snapshot);
      doc.snapshots = trimStart(doc.snapshots, 260);
      return doc;
    });
  },

  storage_history_clear: () =>
    storageHistoryStore.write({ events: [], snapshots: [] }),
};
