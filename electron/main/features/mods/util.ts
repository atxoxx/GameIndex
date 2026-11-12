/**
 * Shared mod-manager helpers: stable ids, filesystem probes, the undo journal
 * and the on-disk backup layout.
 *
 * Ported from `src-tauri/src/mods/operations.rs` (journal + undo + atomic
 * write) and `mods/detect.rs` (`hash_str`, `mod_id_for`).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { userDataPath } from "../../lib/paths";

export function nowSecs(): number {
  return Math.floor(Date.now() / 1000);
}

/** FNV-1a 64-bit, hex. Deterministic across re-scans (not cryptographic). */
export function hashStr(value: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= BigInt(value.charCodeAt(i));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16);
}

/** Canonical mod id: game + lowercased path with `.disabled` stripped. */
export function modIdFor(gameId: string, filePath: string): string {
  const lower = filePath.toLowerCase();
  const stem = lower.endsWith(".disabled") ? lower.slice(0, -".disabled".length) : lower;
  return `gm-${hashStr(`${gameId}|${stem}`)}`;
}

export function stripDisabled(name: string): { visible: string; disabled: boolean } {
  return name.toLowerCase().endsWith(".disabled")
    ? { visible: name.slice(0, -".disabled".length), disabled: true }
    : { visible: name, disabled: false };
}

export function isDir(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

export function isFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

export interface DirStats {
  bytes: number;
  files: number;
}

/** Recursive size/file count with a hard entry cap and await points. */
export async function dirStats(root: string, cap = 20_000): Promise<DirStats> {
  const budget = { remaining: cap };
  let bytes = 0;
  let files = 0;

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 12 || budget.remaining <= 0) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (budget.remaining <= 0) return;
      budget.remaining -= 1;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else {
        try {
          const stat = await fsp.stat(full);
          bytes += stat.size;
          files += 1;
        } catch {
          /* vanished file */
        }
      }
      if (budget.remaining % 500 === 0) await new Promise((resolve) => setImmediate(resolve));
    }
  }

  await walk(root, 0);
  return { bytes, files };
}

/** Every file under `root` as a `/`-separated relative path (capped). */
export async function walkRelative(root: string, cap = 5_000): Promise<string[]> {
  const out: string[] = [];
  let budget = cap;

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 20 || budget <= 0) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (budget <= 0) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else {
        budget -= 1;
        out.push(path.relative(root, full).replace(/\\/g, "/"));
      }
      if (budget % 400 === 0) await new Promise((resolve) => setImmediate(resolve));
    }
  }

  await walk(root, 0);
  return out;
}

export function backupDirFor(gameId: string): string {
  const stamp = Math.floor(Date.now() / 1000);
  return userDataPath("mod-backups", gameId, `${stamp}-${process.pid}`);
}

/** Copy a file into a per-operation backup folder (best effort). */
export function backupFile(source: string, destinationDir: string): string | null {
  try {
    fs.mkdirSync(destinationDir, { recursive: true });
    const target = path.join(destinationDir, path.basename(source));
    fs.copyFileSync(source, target);
    return target;
  } catch {
    return null;
  }
}

/** Copy a whole mod folder into a backup folder (best effort, capped). */
export function backupFolder(source: string, destinationDir: string, cap = 5_000): string | null {
  try {
    fs.mkdirSync(destinationDir, { recursive: true });
    const target = path.join(destinationDir, path.basename(source));
    let copied = 0;
    const copyDir = (from: string, to: string): void => {
      if (copied >= cap) return;
      fs.mkdirSync(to, { recursive: true });
      for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        if (copied >= cap) return;
        const src = path.join(from, entry.name);
        const dest = path.join(to, entry.name);
        if (entry.isDirectory()) copyDir(src, dest);
        else if (entry.isFile()) {
          fs.copyFileSync(src, dest);
          copied += 1;
        }
      }
    };
    copyDir(source, target);
    return target;
  } catch {
    return null;
  }
}

export function journalDir(): string {
  return userDataPath("mod-journal");
}

export interface UndoRecord {
  gameId: string;
  operation: string;
  originalPath: string;
  backupPath?: string;
  currentPath?: string;
  timestamp: number;
}

function journalFile(): string {
  return path.join(journalDir(), "operations.jsonl");
}

function undoFile(): string {
  return path.join(journalDir(), "last-undo.json");
}

export function journalEntry(gameId: string, operation: string, details: string): void {
  const line = `${JSON.stringify({
    timestamp: nowSecs(),
    gameId,
    operation,
    details,
  })}\n`;
  try {
    fs.mkdirSync(journalDir(), { recursive: true });
    fs.appendFileSync(journalFile(), line, "utf8");
  } catch (error) {
    console.error("[mods] could not append the operation journal:", error);
  }
}

export function writeUndo(record: UndoRecord): void {
  try {
    fs.mkdirSync(journalDir(), { recursive: true });
    fs.writeFileSync(undoFile(), JSON.stringify(record, null, 2), "utf8");
  } catch (error) {
    console.error("[mods] could not write the undo record:", error);
  }
}

export function readUndo(): UndoRecord | null {
  try {
    const raw = fs.readFileSync(undoFile(), "utf8");
    const parsed = JSON.parse(raw) as UndoRecord;
    return parsed && typeof parsed.originalPath === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export function clearUndo(): void {
  try {
    fs.rmSync(undoFile(), { force: true });
  } catch {
    /* best effort */
  }
}

/** Streaming MD5 (files above 256 MiB are skipped — not worth the IO). */
export async function fileMd5(file: string, maxBytes = 256 * 1024 * 1024): Promise<string | null> {
  let stat: fs.Stats;
  try {
    stat = await fsp.stat(file);
  } catch {
    return null;
  }
  if (!stat.isFile() || stat.size > maxBytes) return null;
  return new Promise((resolve) => {
    const hash = crypto.createHash("md5");
    const stream = fs.createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", () => resolve(null));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/** `writeTextWithBackup` over an already-read file (modlist/plugins). */
export function atomicWrite(file: string, content: string): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.tmp-${process.pid}`);
  fs.writeFileSync(tmp, content, "utf8");
  try {
    fs.renameSync(tmp, file);
  } catch (error) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* best effort */
    }
    throw error;
  }
}
