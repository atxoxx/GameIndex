/**
 * ROM library: scanning, adding, renaming, size recalculation and duplicate
 * detection.
 *
 * Ported from `src-tauri/src/emulation.rs` (`scan_emulator_roms`, `add_rom_file`,
 * `rename_rom_file`, `recalc_rom_sizes`, `build_rom_game`, `apply_existing_rom`)
 * and `src-tauri/src/roms.rs` (`find_duplicate_roms`, `ensure_rom_hash`).
 *
 * Every ROM is an ordinary library `Game` row tagged with `emulatorId` +
 * `romPath`, written through `state/libraryStore.ts` (never a second database).
 *
 * Differences from the Rust scan, all deliberate:
 *  • async directory walk with yield points and a bounded file cap, so a huge
 *    folder (or a network share) cannot freeze the main process;
 *  • the walk can be cancelled — a second scan of the same emulator supersedes
 *    the first;
 *  • hashes are content hashes with an explicit scheme prefix. Large files are
 *    sampled (size + three 64 KiB blocks) because hashing a 40 GB disc image on
 *    every duplicate pass is not acceptable; files up to 4 MiB are hashed in
 *    full.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import fsp, { type FileHandle } from "node:fs/promises";
import path from "node:path";
import {
  deleteGames,
  getGame,
  listGames,
  upsertGames,
} from "../../state/libraryStore";
import type { Game } from "../../../../src/types/game";
import {
  cleanRomName,
  parseRomFilename,
  platformForRom,
  platformReadsArchivesDirectly,
  romExtensionsForPlatform,
  romGameId,
} from "./naming";
import { getEmulator } from "./store";
import type { DuplicateGroup, EmulatorRow } from "./types";

/** Upper bound for one folder scan (Rust scanned everything; a cap keeps IPC sane). */
const MAX_SCAN_FILES = 20_000;
/** Files between event-loop yields. */
const YIELD_EVERY = 24;
/** Files up to this size are hashed in full for duplicate detection. */
const FULL_HASH_LIMIT = 4 * 1024 * 1024;
const SAMPLE_BLOCK = 64 * 1024;

interface ScanToken {
  cancelled: boolean;
}

const scanTokens = new Map<string, ScanToken>();

async function yieldToLoop(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function extensionOf(file: string): string {
  return path.extname(file).slice(1).toLowerCase();
}

function nowMs(): number {
  return Date.now();
}

/** Optional fields that survive a rescan (playtime, metadata, user state). */
const PRESERVED_KEYS: Array<keyof Game> = [
  "playTime",
  "addedAt",
  "lastPlayed",
  "coverArtUrl",
  "coverSourceUrl",
  "iconUrl",
  "bannerUrl",
  "logoUrl",
  "logoSourceUrl",
  "description",
  "developer",
  "publisher",
  "releaseDate",
  "genres",
  "metadataSource",
  "metadataUrl",
  "screenshots",
  "videos",
  "igdbRating",
  "criticRating",
  "igdbId",
  "playStatus",
  "notes",
  "sizeBytes",
  "sizeDetectedAt",
  "sizeRootPath",
  "steamAppId",
  "romHash",
  "favorite",
  "compatNotes",
  "romProfile",
  "displayName",
];

/** Copy progress/metadata from a previously scanned row onto a fresh one. */
function applyExistingRom(previous: Game, next: Game): void {
  for (const key of PRESERVED_KEYS) {
    if (previous[key] !== undefined) {
      // The keys are copied verbatim; the pair is shape-compatible by design.
      (next as unknown as Record<string, unknown>)[key] = previous[key];
    }
  }
  // Manual corrections win over a re-parse until the user edits them again.
  if (previous.metadataSource === "manual") {
    next.name = previous.name;
    next.romRegion = previous.romRegion;
    next.romLanguage = previous.romLanguage;
    next.romGroup = previous.romGroup;
    next.romDisc = previous.romDisc;
  }
}

/**
 * Build the library row for one ROM file. `sizeBytes` is measured by the caller
 * (async), so this stays pure and cheap.
 */
export function buildRomGame(
  emulator: EmulatorRow,
  romPath: string,
  sizeBytes: number | undefined,
  timestamp: number,
): Game {
  const stem = path.basename(romPath, path.extname(romPath));
  const parsed = parseRomFilename(stem);
  const extension = extensionOf(romPath);
  const platform = platformForRomPath(emulator, romPath);

  const game: Game = {
    id: romGameId(emulator.id, romPath),
    name: parsed.cleanTitle || stem || path.basename(romPath),
    path: emulator.executablePath,
    platform,
    installed: true,
    playTime: "0h",
    addedAt: timestamp,
    launchArguments: emulator.argumentsTemplate.replace(/%ROM%/g, romPath),
    emulatorId: emulator.id,
    romPath,
  };
  if (sizeBytes !== undefined) {
    game.sizeBytes = sizeBytes;
    game.sizeDetectedAt = String(timestamp);
    game.sizeRootPath = romPath;
  }
  if (parsed.region) game.romRegion = parsed.region;
  if (parsed.language) game.romLanguage = parsed.language;
  if (parsed.group) game.romGroup = parsed.group;
  if (parsed.disc) game.romDisc = parsed.disc;
  if (
    (extension === "zip" || extension === "7z") &&
    !platformReadsArchivesDirectly(platform)
  ) {
    game.romArchived = true;
  }
  return game;
}

/** Platform for one file (delegates to the naming table, kept local for clarity). */
function platformForRomPath(emulator: EmulatorRow, romPath: string): string {
  const extension = extensionOf(romPath);
  const configured = emulator.platform.trim();
  const lower = configured.toLowerCase();
  // A specific emulator platform is authoritative; a multi-system emulator
  // still resolves through the extension table.
  if (
    configured &&
    lower !== "unknown" &&
    !["multi-system", "retroarch", "arcade"].includes(lower)
  ) {
    return configured;
  }
  return platformForRom(configured, extension, romPath);
}

function recognisedExtensions(platform: string): Set<string> {
  return new Set(romExtensionsForPlatform(platform).map((ext) => ext.toLowerCase()));
}

/** Cancel an in-flight scan of one emulator (no-op when none is running). */
export function cancelRomScan(emulatorId: string): void {
  const token = scanTokens.get(emulatorId);
  if (token) token.cancelled = true;
}

/**
 * Scan an emulator's ROM folder (flat, like Rust) and upsert one row per
 * recognised ROM. Existing rows keep playtime/metadata/user state.
 */
export async function scanEmulatorRoms(emulatorId: string): Promise<Game[]> {
  const emulator = getEmulator(emulatorId);
  if (!emulator) throw new Error(`Emulator not found: ${emulatorId}`);

  const folder = emulator.romFolder.trim();
  if (!folder) throw new Error("Emulator has no ROM folder configured");

  let directoryEntries: fs.Dirent[];
  try {
    const stat = await fsp.stat(folder);
    if (!stat.isDirectory()) throw new Error("not a directory");
    directoryEntries = await fsp.readdir(folder, { withFileTypes: true });
  } catch {
    throw new Error(`ROM folder does not exist: ${folder}`);
  }

  const extensions = recognisedExtensions(emulator.platform);
  const existing = new Map<string, Game>();
  for (const game of listGames()) {
    if (game.emulatorId === emulatorId) existing.set(game.id, game);
  }

  const candidates = directoryEntries
    .filter((entry) => entry.isFile() && extensions.has(extensionOf(entry.name)))
    .slice(0, MAX_SCAN_FILES);

  const previousToken = scanTokens.get(emulatorId);
  if (previousToken) previousToken.cancelled = true;
  const token: ScanToken = { cancelled: false };
  scanTokens.set(emulatorId, token);

  const timestamp = nowMs();
  const scanned: Game[] = [];
  try {
    for (let index = 0; index < candidates.length; index += 1) {
      if (token.cancelled) break;
      const romPath = path.join(folder, candidates[index].name);
      let size: number | undefined;
      try {
        size = (await fsp.stat(romPath)).size;
      } catch {
        size = undefined;
      }
      const game = buildRomGame(emulator, romPath, size, timestamp);
      const previous = existing.get(game.id);
      if (previous) applyExistingRom(previous, game);
      scanned.push(game);
      if (index % YIELD_EVERY === YIELD_EVERY - 1) await yieldToLoop();
    }
  } finally {
    if (scanTokens.get(emulatorId) === token) scanTokens.delete(emulatorId);
  }

  if (scanned.length > 0) upsertGames(scanned);
  return scanned;
}

/** Register one ROM file under an emulator (the "Add ROM" action). */
export function addRomFile(emulatorId: string, filePath: string): Game {
  const emulator = getEmulator(emulatorId);
  if (!emulator) throw new Error(`Emulator not found: ${emulatorId}`);

  const target = filePath.trim();
  let stat: fs.Stats;
  try {
    stat = fs.statSync(target);
  } catch {
    throw new Error(`File does not exist: ${target}`);
  }
  if (!stat.isFile()) throw new Error(`Not a file: ${target}`);

  const extension = extensionOf(target);
  if (!extension) throw new Error("File has no extension");
  const accepted = recognisedExtensions(emulator.platform);
  if (!accepted.has(extension)) {
    throw new Error(
      `File type .${extension} is not a recognised ROM for ${emulator.platform}`,
    );
  }

  const timestamp = nowMs();
  const game = buildRomGame(emulator, target, stat.size, timestamp);
  const previous = getGame(game.id);
  if (previous) applyExistingRom(previous, game);
  upsertGames([game]);
  return game;
}

const INVALID_FILE_NAME = /[<>:"|?*\u0000-\u001f]/;

/**
 * Rename a ROM's file on disk and update its library row. `newName` is a base
 * name; the file's existing extension is preserved. The row id is regenerated
 * from the new path so a future rescan stays idempotent.
 */
export function renameRomFile(gameId: string, newName: string): Game {
  const existing = getGame(gameId);
  if (!existing) throw new Error(`ROM not found: ${gameId}`);
  const romPath = existing.romPath;
  if (!romPath) throw new Error("ROM has no file path");

  let stat: fs.Stats;
  try {
    stat = fs.statSync(romPath);
    if (!stat.isFile()) throw new Error("not a file");
  } catch {
    throw new Error(`ROM file does not exist: ${romPath}`);
  }

  const trimmed = newName.trim();
  if (
    !trimmed ||
    trimmed === "." ||
    trimmed === ".." ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    INVALID_FILE_NAME.test(trimmed)
  ) {
    throw new Error("New name contains invalid characters");
  }

  const extension = path.extname(romPath);
  // Accept a value that already carries the extension instead of doubling it.
  const base =
    extension && trimmed.toLowerCase().endsWith(extension.toLowerCase())
      ? trimmed.slice(0, -extension.length).trim()
      : trimmed;
  if (!base) throw new Error("New name contains invalid characters");
  const fileName = `${base}${extension}`;
  const newPath = path.join(path.dirname(romPath), fileName);
  if (fs.existsSync(newPath)) {
    throw new Error(`A file named ${fileName} already exists`);
  }

  try {
    fs.renameSync(romPath, newPath);
  } catch (error) {
    throw new Error(
      `Rename failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const emulatorId = existing.emulatorId ?? "";
  const next: Game = {
    ...existing,
    id: romGameId(emulatorId, newPath),
    name: base,
    romPath: newPath,
  };
  if (existing.launchArguments) {
    next.launchArguments = existing.launchArguments.split(romPath).join(newPath);
  }
  if (existing.sizeRootPath === romPath) next.sizeRootPath = newPath;

  upsertGames([next]);
  if (next.id !== gameId) deleteGames([gameId]);
  return next;
}

/** Re-measure every ROM of one emulator and persist the sizes. */
export async function recalcRomSizes(emulatorId: string): Promise<Game[]> {
  if (!getEmulator(emulatorId)) throw new Error(`Emulator not found: ${emulatorId}`);
  const rows = listGames().filter(
    (game) => game.emulatorId === emulatorId && game.romPath,
  );
  const timestamp = nowMs();
  const updated: Game[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const game = rows[index];
    const romPath = game.romPath as string;
    let size: number | undefined;
    try {
      size = (await fsp.stat(romPath)).size;
    } catch {
      size = undefined;
    }
    const next: Game = {
      ...game,
      sizeBytes: size,
      sizeDetectedAt: size !== undefined ? String(timestamp) : undefined,
      sizeRootPath: romPath,
    };
    updated.push(next);
    if (index % YIELD_EVERY === YIELD_EVERY - 1) await yieldToLoop();
  }
  if (updated.length > 0) upsertGames(updated);
  return updated;
}

// ── Hashing / duplicates ─────────────────────────────────────────────

async function readBlock(
  handle: FileHandle,
  position: number,
  length: number,
): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  return buffer.subarray(0, bytesRead);
}

/**
 * Content hash for duplicate detection:
 *  • `sha1.<hex>` for files up to 4 MiB (full read);
 *  • `sample.<size>.<hex>` for larger files — length plus three 64 KiB blocks
 *    (start / middle / end), which is enough to catch real duplicate dumps
 *    without reading a whole disc image.
 * The prefix makes it obvious that a sampled digest is not a No-Intro hash.
 */
export async function hashRomFile(file: string, sizeHint?: number): Promise<string> {
  const stat = await fsp.stat(file);
  const size = sizeHint ?? stat.size;
  const handle = await fsp.open(file, "r");
  try {
    if (size <= FULL_HASH_LIMIT) {
      const hash = crypto.createHash("sha1");
      let position = 0;
      const chunk = 1024 * 1024;
      while (position < size) {
        const buffer = await readBlock(handle, position, Math.min(chunk, size - position));
        if (buffer.length === 0) break;
        hash.update(buffer);
        position += buffer.length;
      }
      return `sha1.${hash.digest("hex")}`;
    }
    const middle = Math.max(0, Math.floor(size / 2 - SAMPLE_BLOCK / 2));
    const end = Math.max(0, size - SAMPLE_BLOCK);
    const hash = crypto.createHash("sha1");
    const offsets = [...new Set([0, middle, end])];
    for (const offset of offsets) {
      hash.update(await readBlock(handle, offset, SAMPLE_BLOCK));
    }
    return `sample.${size}.${hash.digest("hex")}`;
  } finally {
    await handle.close();
  }
}

/**
 * Find duplicate ROMs by content hash. Hashes are computed on demand and
 * persisted back onto the library rows, so a second call is instant.
 */
export async function findDuplicateRoms(emulatorId?: string): Promise<DuplicateGroup[]> {
  const rows = listGames().filter((game) => {
    if (!game.romPath) return false;
    return emulatorId ? game.emulatorId === emulatorId : Boolean(game.emulatorId);
  });

  const updated: Game[] = [];
  const byHash = new Map<string, Game[]>();

  for (let index = 0; index < rows.length; index += 1) {
    const game = rows[index];
    let hash = game.romHash;
    if (!hash) {
      try {
        hash = await hashRomFile(game.romPath as string, game.sizeBytes);
        updated.push({ ...game, romHash: hash });
      } catch {
        hash = undefined;
      }
    }
    if (hash) {
      const list = byHash.get(hash) ?? [];
      list.push({ ...game, romHash: hash });
      byHash.set(hash, list);
    }
    if (index % YIELD_EVERY === YIELD_EVERY - 1) await yieldToLoop();
  }

  if (updated.length > 0) upsertGames(updated);

  const groups: DuplicateGroup[] = [];
  for (const [hash, games] of byHash) {
    if (games.length < 2) continue;
    groups.push({
      hash,
      sizeBytes: games.reduce((max, game) => Math.max(max, game.sizeBytes ?? 0), 0),
      games,
    });
  }
  groups.sort((left, right) => right.games.length - left.games.length);
  return groups;
}

/** Cleaned title for a ROM row (filename first, display name as fallback). */
export function romCleanTitle(game: Game): string {
  const stem = game.romPath
    ? path.basename(game.romPath, path.extname(game.romPath))
    : "";
  return cleanRomName(stem) || cleanRomName(game.name) || game.name;
}
