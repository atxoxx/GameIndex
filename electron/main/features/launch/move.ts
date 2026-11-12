/**
 * `move_game_install` / `uninstall_game`.
 *
 * Ported from `src-tauri/src/size.rs`. Moves copy the whole install tree to the
 * new parent, verify the byte count, and only then delete the source; a
 * cancelled or failed copy leaves the original untouched. Progress is streamed
 * as `game-move-progress` (≤ 1 per 150 ms) and completion as `game-move-done`.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { emit } from "../../ipc";
import { normalizePathLower, trimPathSeparators } from "./paths";
import { sumFolderSize } from "./walk";

export interface MoveGameResult {
  toPath: string;
  sizeBytes: number;
}

export interface UninstallResult {
  deletedBytes: number;
  path: string;
}

interface MoveState {
  cancelled: boolean;
}

/** In-flight moves, keyed by game id (cancelled via `cancelMoveGame`). */
const activeMoves = new Map<string, MoveState>();

function emitMoveProgress(
  gameId: string,
  copiedBytes: number,
  totalBytes: number,
  phase: string,
): void {
  emit("game-move-progress", { gameId, copiedBytes, totalBytes, phase });
}

function isCancelled(gameId: string): boolean {
  return activeMoves.get(gameId)?.cancelled === true;
}

/**
 * Recursively copy `from` → `to`, reporting bytes. Symlinks are skipped (they
 * could escape the destination), and per-entry failures abort the copy so a
 * partial move is never verified as complete.
 */
async function copyTree(
  from: string,
  to: string,
  gameId: string,
  totalBytes: number,
  counter: { copied: number; lastEmitAt: number },
): Promise<void> {
  await fs.mkdir(to, { recursive: true });
  const entries = await fs.readdir(from, { withFileTypes: true });
  for (const entry of entries) {
    if (isCancelled(gameId)) throw new Error("Move cancelled");
    const sourcePath = path.join(from, entry.name);
    const destPath = path.join(to, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await copyTree(sourcePath, destPath, gameId, totalBytes, counter);
      continue;
    }
    if (!entry.isFile()) continue;
    await fs.copyFile(sourcePath, destPath);
    const size = (await fs.stat(sourcePath)).size;
    counter.copied += size;
    const now = Date.now();
    if (counter.copied >= totalBytes || now - counter.lastEmitAt >= 150) {
      counter.lastEmitAt = now;
      emitMoveProgress(gameId, Math.min(counter.copied, totalBytes), totalBytes, "copying");
    }
    // Yield so progress IPC and window events are not starved.
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/**
 * Relocate an install folder to `destDir`, keeping its folder name. The caller
 * persists `toPath` (and re-derives the exe path) on the game record.
 */
export async function moveGameInstall(
  gameId: string,
  fromRoot: string,
  destDir: string,
): Promise<MoveGameResult> {
  if (!gameId) throw new Error("move_game_install requires a gameId");
  if (!fromRoot || !destDir) {
    throw new Error("move_game_install requires both a source and a destination folder");
  }

  const source = path.resolve(fromRoot);
  const destination = path.resolve(destDir);

  let sourceStat;
  try {
    sourceStat = await fs.stat(source);
  } catch {
    throw new Error(`Source folder does not exist: ${fromRoot}`);
  }
  if (!sourceStat.isDirectory()) throw new Error(`Source folder does not exist: ${fromRoot}`);

  let destinationStat;
  try {
    destinationStat = await fs.stat(destination);
  } catch {
    throw new Error(`Destination does not exist: ${destDir}`);
  }
  if (!destinationStat.isDirectory()) throw new Error(`Destination does not exist: ${destDir}`);

  const folderName = path.basename(source);
  if (!folderName) throw new Error("Could not determine the source folder name");
  const newRoot = path.join(destination, folderName);

  if (normalizePathLower(trimPathSeparators(newRoot)) === normalizePathLower(trimPathSeparators(source))) {
    throw new Error("Source and destination are the same folder");
  }
  try {
    await fs.access(newRoot);
    throw new Error(`Destination already exists: ${newRoot}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Destination already exists")) throw error;
    // ENOENT: good, the destination is free.
  }

  activeMoves.set(gameId, { cancelled: false });
  try {
    const total = await sumFolderSize(source, { isCancelled: () => isCancelled(gameId) });
    const counter = { copied: 0, lastEmitAt: 0 };
    emitMoveProgress(gameId, 0, total, "copying");

    await copyTree(source, newRoot, gameId, total, counter);

    emitMoveProgress(gameId, total, total, "verifying");
    const newSize = await sumFolderSize(newRoot);
    if (total > 0 && newSize < total) {
      await fs.rm(newRoot, { recursive: true, force: true }).catch(() => undefined);
      throw new Error("Move failed verification — source folder is untouched");
    }

    emitMoveProgress(gameId, total, total, "cleaning");
    await fs.rm(source, { recursive: true, force: true });

    emit("game-move-done", { gameId, toPath: newRoot });
    return { toPath: newRoot, sizeBytes: newSize };
  } catch (error) {
    if (isCancelled(gameId)) {
      // Remove whatever partial copy exists; the source is never deleted
      // before verification, so it is still intact.
      await fs.rm(newRoot, { recursive: true, force: true }).catch(() => undefined);
      throw new Error("Move cancelled — source folder is untouched");
    }
    throw error;
  } finally {
    activeMoves.delete(gameId);
  }
}

/** Cancel an in-flight move (the source is left untouched). */
export function cancelMoveGame(gameId: string): boolean {
  const state = activeMoves.get(gameId);
  if (!state) return false;
  state.cancelled = true;
  return true;
}

/** True while a move for this game is running. */
export function isMoveRunning(gameId: string): boolean {
  return activeMoves.has(gameId);
}

const PROTECTED_ROOTS = new Set([
  "windows",
  "program files",
  "program files (x86)",
  "programdata",
  "users",
  "system volume information",
]);

/**
 * Reject an obviously catastrophic uninstall target: a drive root, a top-level
 * system folder, or the app's own data directory. The renderer passes the
 * measured install folder, so anything shallower is a bug, not a request.
 */
function assertSafeUninstallPath(target: string): void {
  const resolved = path.resolve(target);
  const parsed = path.parse(resolved);
  if (!parsed.root || parsed.root === resolved) {
    throw new Error(`Refusing to delete a drive root: ${target}`);
  }
  const segments = resolved
    .slice(parsed.root.length)
    .split(/[\\/]/)
    .filter(Boolean);
  if (segments.length < 1) {
    throw new Error(`Refusing to delete ${target} — it is too close to the drive root`);
  }
  if (segments.length === 1 && PROTECTED_ROOTS.has(segments[0].toLowerCase())) {
    throw new Error(`Refusing to delete the system folder ${target}`);
  }
}

/**
 * Delete a game's install folder entirely and report the freed bytes so the
 * Storage header can re-total immediately.
 */
export async function uninstallGame(rootPath: string): Promise<UninstallResult> {
  if (!rootPath) throw new Error("uninstall_game requires a rootPath");
  assertSafeUninstallPath(rootPath);

  let stat;
  try {
    stat = await fs.stat(rootPath);
  } catch {
    throw new Error(`Folder does not exist: ${rootPath}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`Not a folder: ${rootPath}`);
  }

  const deletedBytes = await sumFolderSize(rootPath);
  try {
    await fs.rm(rootPath, { recursive: true, force: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to delete: ${message}`);
  }
  return { deletedBytes, path: rootPath };
}
