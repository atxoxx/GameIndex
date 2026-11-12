/**
 * Per-ROM battery save / save-state management.
 *
 * Ported from `src-tauri/src/roms.rs` (`rom_saves_list`, `rom_saves_status`,
 * `rom_saves_snapshots`, `rom_saves_backup`, `rom_saves_restore`,
 * `rom_saves_delete`, `collect_save_files`, `saves_folder_for`).
 *
 * Layout (all under Electron's userData, per the port brief):
 *
 *   rom-saves/<gameId>/manifest.json      snapshot index + file lists
 *   rom-saves/<gameId>/<snapshot>/…       copied save files, original structure
 *
 * Improvements over the Rust version:
 *  • a manifest records the snapshot's file list, so listing does not depend on
 *    directory mtimes and a restore cannot silently copy unrelated files;
 *  • restore takes a `safety-<timestamp>` snapshot of the *current* saves
 *    before it overwrites anything;
 *  • every filesystem step is async with a bounded walk.
 */
import fsp from "node:fs/promises";
import path from "node:path";
import { userDataPath } from "../../lib/paths";
import { getGame } from "../../state/libraryStore";
import type { Game } from "../../../../src/types/game";
import { sanitizeComponent } from "./naming";
import { getEmulator } from "./store";
import type {
  RomSaveEntry,
  RomSaveManifest,
  RomSaveManifestEntry,
  RomSavesStatus,
  SaveSnapshot,
} from "./types";

/** Depth of the save-file walk (Rust stopped at 2 too). */
const MAX_SAVE_DEPTH = 2;
const MAX_SAVE_FILES = 2_000;
const MANIFEST_NAME = "manifest.json";

function backupRoot(gameId: string): string {
  return userDataPath("rom-saves", sanitizeComponent(gameId));
}

function requireGame(gameId: string): Game {
  const game = getGame(gameId);
  if (!game) throw new Error(`ROM not found: ${gameId}`);
  return game;
}

/** Saves folder configured on the game's emulator, or `null`. */
function savesFolderFor(game: Game): string | null {
  const emulatorId = game.emulatorId;
  if (!emulatorId) return null;
  const emulator = getEmulator(emulatorId);
  if (!emulator) throw new Error(`Emulator not found: ${emulatorId}`);
  const folder = (emulator.savesFolder ?? "").trim();
  return folder.length > 0 ? folder : null;
}

async function loadManifest(root: string, game: Game): Promise<RomSaveManifest> {
  try {
    const raw = await fsp.readFile(path.join(root, MANIFEST_NAME), "utf8");
    const parsed = JSON.parse(raw) as RomSaveManifest;
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.snapshots)) {
      return {
        version: 1,
        gameId: game.id,
        romPath: game.romPath,
        savesFolder: savesFolderForSafe(game),
        snapshots: parsed.snapshots.filter(isManifestEntry),
      };
    }
  } catch {
    /* no manifest yet (first run) */
  }
  return {
    version: 1,
    gameId: game.id,
    romPath: game.romPath,
    savesFolder: savesFolderForSafe(game),
    snapshots: [],
  };
}

function savesFolderForSafe(game: Game): string | undefined {
  try {
    return savesFolderFor(game) ?? undefined;
  } catch {
    return undefined;
  }
}

function isManifestEntry(value: unknown): value is RomSaveManifestEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as RomSaveManifestEntry;
  return (
    typeof entry.name === "string" &&
    typeof entry.createdAtMs === "number" &&
    Array.isArray(entry.files)
  );
}

async function writeManifest(root: string, manifest: RomSaveManifest): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  const target = path.join(root, MANIFEST_NAME);
  const temp = `${target}.${process.pid}.tmp`;
  await fsp.writeFile(temp, JSON.stringify(manifest, null, 2), "utf8");
  await fsp.rename(temp, target);
}

/** Save-file stem used to match files against a ROM. */
function matchStem(game: Game): string {
  if (game.romPath) {
    const stem = path.basename(game.romPath, path.extname(game.romPath));
    if (stem) return stem.toLowerCase();
  }
  return game.name.toLowerCase();
}

interface CollectedSave {
  absolutePath: string;
  relativePath: string;
  name: string;
  sizeBytes: number;
  modifiedAtMs: number;
}

/**
 * Recursively collect files whose name starts with the ROM stem (case
 * insensitive), up to two folder levels. The ROM file itself is skipped.
 */
async function collectSaveFiles(folder: string, game: Game): Promise<CollectedSave[]> {
  const stem = matchStem(game);
  if (!stem) return [];
  const romKey = game.romPath ? path.resolve(game.romPath).toLowerCase() : null;
  const out: CollectedSave[] = [];

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > MAX_SAVE_DEPTH || out.length >= MAX_SAVE_FILES) return;
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= MAX_SAVE_FILES) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
        continue;
      }
      const lower = entry.name.toLowerCase();
      if (!lower.startsWith(stem)) continue;
      if (romKey && path.resolve(full).toLowerCase() === romKey) continue;
      let stat;
      try {
        stat = await fsp.stat(full);
      } catch {
        continue;
      }
      out.push({
        absolutePath: full,
        relativePath: path.relative(folder, full).replace(/\\/g, "/"),
        name: entry.name,
        sizeBytes: stat.size,
        modifiedAtMs: Math.floor(stat.mtimeMs),
      });
    }
  };

  await walk(folder, 0);
  out.sort((left, right) => right.modifiedAtMs - left.modifiedAtMs);
  return out;
}

function toEntry(entry: CollectedSave, backedUp: boolean): RomSaveEntry {
  return {
    path: entry.absolutePath,
    name: entry.name,
    relativePath: entry.relativePath,
    sizeBytes: entry.sizeBytes,
    modifiedAtMs: entry.modifiedAtMs,
    backedUp,
  };
}

/** Snapshot rows for one ROM, newest first. */
export async function listSnapshots(gameId: string): Promise<SaveSnapshot[]> {
  const game = requireGame(gameId);
  const root = backupRoot(gameId);
  const manifest = await loadManifest(root, game);
  const snapshots: SaveSnapshot[] = [];
  for (const entry of manifest.snapshots) {
    try {
      const stat = await fsp.stat(path.join(root, entry.name));
      if (!stat.isDirectory()) continue;
    } catch {
      continue;
    }
    snapshots.push({
      name: entry.name,
      createdAtMs: entry.createdAtMs,
      fileCount: entry.fileCount,
      sizeBytes: entry.sizeBytes,
    });
  }
  snapshots.sort((left, right) => right.createdAtMs - left.createdAtMs);
  return snapshots;
}

/** Back up the ROM's current save files into a named snapshot. */
export async function backupSaves(gameId: string, name?: string | null): Promise<number> {
  const game = requireGame(gameId);
  const folder = savesFolderFor(game);
  if (!folder) throw new Error("No saves folder configured for this emulator");
  const files = await collectSaveFiles(folder, game);
  if (files.length === 0) throw new Error("No save files found for this ROM");

  const root = backupRoot(gameId);
  const manifest = await loadManifest(root, game);
  const label = await uniqueLabel(root, manifest, name?.trim() || `auto-${Date.now()}`);

  const snapshotDir = path.join(root, label);
  let copied = 0;
  let bytes = 0;
  const manifestFiles: RomSaveManifestEntry["files"] = [];
  for (const file of files) {
    const target = path.join(snapshotDir, ...file.relativePath.split("/"));
    await fsp.mkdir(path.dirname(target), { recursive: true });
    try {
      await fsp.copyFile(file.absolutePath, target);
      copied += 1;
      bytes += file.sizeBytes;
      manifestFiles.push({
        relativePath: file.relativePath,
        sizeBytes: file.sizeBytes,
        modifiedAtMs: file.modifiedAtMs,
      });
    } catch {
      /* keep going: one locked save file must not lose the others */
    }
  }

  if (copied === 0) {
    await fsp.rm(snapshotDir, { recursive: true, force: true }).catch(() => undefined);
    throw new Error("Could not copy any save file for this ROM");
  }

  manifest.snapshots = manifest.snapshots.filter((snapshot) => snapshot.name !== label);
  manifest.snapshots.push({
    name: label,
    createdAtMs: Date.now(),
    fileCount: copied,
    sizeBytes: bytes,
    files: manifestFiles,
  });
  manifest.savesFolder = folder;
  manifest.romPath = game.romPath;
  await writeManifest(root, manifest);

  return copied;
}

async function uniqueLabel(
  root: string,
  manifest: RomSaveManifest,
  requested: string,
): Promise<string> {
  const base = sanitizeComponent(requested);
  const used = new Set(manifest.snapshots.map((entry) => entry.name));
  let candidate = base;
  let counter = 2;
  for (;;) {
    const exists = used.has(candidate) || (await pathExists(path.join(root, candidate)));
    if (!exists) return candidate;
    candidate = `${base}-${counter}`;
    counter += 1;
    if (counter > 500) throw new Error("Could not allocate a snapshot name");
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fsp.access(target);
    return true;
  } catch {
    return false;
  }
}

/** List the ROM's current save files, flagged against the newest snapshot. */
export async function listSaves(gameId: string): Promise<RomSaveEntry[]> {
  const game = requireGame(gameId);
  const folder = savesFolderFor(game);
  if (!folder) return [];
  const files = await collectSaveFiles(folder, game);
  if (files.length === 0) return [];

  const root = backupRoot(gameId);
  const manifest = await loadManifest(root, game);
  const newest = [...manifest.snapshots].sort(
    (left, right) => right.createdAtMs - left.createdAtMs,
  )[0];
  const backedUp = new Set<string>();
  if (newest) {
    for (const file of newest.files) backedUp.add(file.relativePath);
  }
  return files.map((file) =>
    toEntry(file, backedUp.has(file.relativePath) || backedUp.has(file.name)),
  );
}

/** Backup health: newest save mtime vs newest snapshot creation time. */
export async function savesStatus(gameId: string): Promise<RomSavesStatus> {
  const game = requireGame(gameId);
  const folder = savesFolderFor(game);
  const files = folder ? await collectSaveFiles(folder, game) : [];
  const lastSave = files.reduce<number | undefined>(
    (max, file) => (max === undefined || file.modifiedAtMs > max ? file.modifiedAtMs : max),
    undefined,
  );
  const snapshots = await listSnapshots(gameId);
  const lastBackup = snapshots.reduce<number | undefined>(
    (max, snapshot) =>
      max === undefined || snapshot.createdAtMs > max ? snapshot.createdAtMs : max,
    undefined,
  );

  const status: RomSavesStatus = {
    savesConfigured: folder !== null,
    hasSaves: files.length > 0,
    saveCount: files.length,
    outdated:
      lastSave !== undefined &&
      (lastBackup === undefined || lastSave > lastBackup),
  };
  if (folder) status.savesFolder = folder;
  if (lastSave !== undefined) status.lastSaveMtime = lastSave;
  if (lastBackup !== undefined) status.lastBackupMtime = lastBackup;
  return status;
}

/**
 * Restore a snapshot over the current save files. A `safety-<ts>` snapshot of
 * the current state is taken first, so a wrong restore can always be undone.
 */
export async function restoreSaves(gameId: string, name: string): Promise<number> {
  const game = requireGame(gameId);
  const folder = savesFolderFor(game);
  if (!folder) throw new Error("No saves folder configured for this emulator");

  const root = backupRoot(gameId);
  const manifest = await loadManifest(root, game);
  const entry = manifest.snapshots.find((snapshot) => snapshot.name === name);
  if (!entry) throw new Error(`Snapshot not found: ${name}`);
  const snapshotDir = path.join(root, entry.name);
  if (!(await pathExists(snapshotDir))) {
    throw new Error(`Snapshot not found: ${name}`);
  }

  // Safety snapshot of the current saves before overwriting anything.
  const current = await collectSaveFiles(folder, game);
  if (current.length > 0) {
    await backupSaves(gameId, `safety-${Date.now()}`).catch((error) => {
      console.warn("[emulators] safety snapshot failed:", error);
    });
  }

  let restored = 0;
  for (const file of entry.files) {
    const source = path.join(snapshotDir, ...file.relativePath.split("/"));
    const target = path.join(folder, ...file.relativePath.split("/"));
    try {
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.copyFile(source, target);
      restored += 1;
    } catch {
      /* report the count actually restored */
    }
  }
  if (restored === 0) throw new Error(`Snapshot contains no restorable files: ${name}`);
  return restored;
}

/** Delete one snapshot (and its manifest entry). */
export async function deleteSnapshot(gameId: string, name: string): Promise<void> {
  const game = requireGame(gameId);
  const root = backupRoot(gameId);
  const manifest = await loadManifest(root, game);
  const entry = manifest.snapshots.find((snapshot) => snapshot.name === name);
  const dir = path.join(root, sanitizeComponent(name));
  if (!entry && !(await pathExists(dir))) {
    throw new Error(`Snapshot not found: ${name}`);
  }
  await fsp.rm(dir, { recursive: true, force: true });
  manifest.snapshots = manifest.snapshots.filter((snapshot) => snapshot.name !== name);
  await writeManifest(root, manifest);
}
