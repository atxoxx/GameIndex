/**
 * Bounded-concurrency directory walking.
 *
 * Replaces `src-tauri/src/scan.rs`'s rayon walker with an async equivalent:
 * one directory level is read at a time with a fixed worker pool, so a huge
 * install tree cannot open thousands of handles or starve the main process.
 * Symlinks/junctions are skipped entirely (a reparse point can neither
 * double-count a tree nor escape the root), matching the Rust walker.
 */
import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";

export interface WalkOptions {
  /** Maximum directory depth below the root (the root itself is 0). */
  maxDepth: number;
  /** Return false to prune a subdirectory. */
  shouldDescend?: (name: string, depth: number) => boolean;
  /** Called for every non-symlink file entry. */
  onFile?: (filePath: string, size: number, mtimeMs: number, depth: number, executable: boolean) => void | Promise<void>;
  /** Polled between entries; return true to stop the walk. */
  isCancelled?: () => boolean;
  /** Directories read concurrently (default 8). */
  concurrency?: number;
}

export interface WalkResult {
  cancelled: boolean;
  /** Directories successfully read. */
  foldersScanned: number;
  /** File entries handed to `onFile`. */
  filesExamined: number;
}

/** Kinds of real program headers we recognize without requiring an extension. */
export type ProgramSignature = "elf" | "script" | "macho" | "pe" | null;

/**
 * Read the first bytes of `filePath` and classify the executable format.
 *
 * The execute bit alone is not trustworthy: NTFS/exFAT/SMB mounts commonly
 * report 0755 for every file, so a folder scan that trusts `stat.mode` treats
 * textures, DLLs and `.txt` files as launchable. Real programs carry a format
 * signature (ELF, a shebang, Mach-O, or a PE `MZ` header).
 */
export async function programSignature(filePath: string): Promise<ProgramSignature> {
  let handle: FileHandle | null = null;
  try {
    handle = await fs.open(filePath, "r");
    const buffer = Buffer.alloc(128);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead < 4) return null;
    if (buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46) {
      return "elf";
    }
    if (buffer[0] === 0x23 && buffer[1] === 0x21) return "script"; // "#!"
    if (buffer[0] === 0x4d && buffer[1] === 0x5a) return "pe"; // "MZ"
    const magic = buffer.readUInt32BE(0);
    if (
      magic === 0xfeedface ||
      magic === 0xfeedfacf ||
      magic === 0xcefaedfe ||
      magic === 0xcffaedfe ||
      magic === 0xcafebabe ||
      magic === 0xcafebabf
    ) {
      return "macho";
    }
    return null;
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function mapLimit<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      await worker(items[index]);
    }
  });
  await Promise.all(runners);
}

/**
 * Walk `root` breadth-first. Unreadable directories are skipped (one bad
 * folder must not abort a scan).
 */
export async function walkDirectory(root: string, options: WalkOptions): Promise<WalkResult> {
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 8, 32));
  const maxDepth = Math.max(0, options.maxDepth);
  const result: WalkResult = { cancelled: false, foldersScanned: 0, filesExamined: 0 };

  const readDir = async (dir: string): Promise<Dirent[]> => {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      return entries;
    } catch {
      return [];
    }
  };

  let level: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  while (level.length > 0) {
    if (options.isCancelled?.()) {
      result.cancelled = true;
      return result;
    }

    const nextLevel: Array<{ dir: string; depth: number }> = [];
    await mapLimit(level, concurrency, async ({ dir, depth }) => {
      if (options.isCancelled?.()) return;
      const entries = await readDir(dir);
      result.foldersScanned += 1;
      for (const entry of entries) {
        if (options.isCancelled?.()) return;
        if (entry.isSymbolicLink()) continue;
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (depth + 1 > maxDepth) continue;
          if (options.shouldDescend && !options.shouldDescend(entry.name, depth)) continue;
          nextLevel.push({ dir: entryPath, depth: depth + 1 });
          continue;
        }
        if (!entry.isFile()) continue;
        let size = 0;
        let mtimeMs = 0;
        let executable = false;
        try {
          const stat = await fs.stat(entryPath);
          size = stat.size;
          mtimeMs = stat.mtimeMs;
          // POSIX games are extension-less ELF binaries; the execute bit is
          // the only reliable signal that a file is launchable.
          executable = process.platform !== "win32" && (stat.mode & 0o111) !== 0;
        } catch {
          continue;
        }
        result.filesExamined += 1;
        await options.onFile?.(entryPath, size, mtimeMs, depth, executable);
      }
      // Yield between directories so IPC and timers keep running.
      await new Promise((resolve) => setImmediate(resolve));
    });

    level = nextLevel;
  }
  return result;
}

/** Recursive byte size of a folder (symlinks skipped, partial sums kept). */
export async function sumFolderSize(
  root: string,
  options: { isCancelled?: () => boolean; maxDepth?: number } = {},
): Promise<number> {
  let total = 0;
  await walkDirectory(root, {
    maxDepth: options.maxDepth ?? 64,
    isCancelled: options.isCancelled,
    onFile: (_filePath, size) => {
      total += size;
    },  });
  return total;
}
