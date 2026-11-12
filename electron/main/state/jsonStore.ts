/**
 * Tiny JSON-document store used by the ported domain backends.
 *
 * The Rust build kept each domain (sessions, notes, shelves, saves, …) in its
 * own SQLite database. The Electron pass deliberately keeps this first wave
 * dependency-free: every domain is a single JSON document under
 * `app.getPath('userData')`, read once into memory and written back atomically.
 *
 * Writes are synchronous on purpose. The documents here are small (a few
 * hundred KB at most) and only change on explicit user actions, so the simpler
 * durability model — temp file then rename, throwing on failure — is preferable
 * to a debounce that could lose the last edit on quit. The game library, which
 * *is* large and written on every enrichment tick, has its own coalescing store
 * in `libraryStore.ts`.
 */
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

export interface JsonStore<T> {
  /** File name under `userData` (no directory separators). */
  readonly fileName: string;
  /** Absolute path of the backing document. */
  filePath(): string;
  /** Current document, parsed on first use. */
  read(): T;
  /** Replace the document and persist it atomically. */
  write(value: T): T;
  /** Read, transform and persist in one step. */
  update(mutate: (current: T) => T): T;
  /** Throw away the cached copy; the next read hits disk. */
  invalidate(): void;
}

function resolveFile(fileName: string): string {
  return path.join(app.getPath("userData"), fileName);
}

/**
 * Move a document aside when it cannot be parsed, so the bad bytes are kept
 * for diagnosis while the app continues with a clean default.
 */
function quarantine(file: string): void {
  try {
    fs.renameSync(file, `${file}.corrupt-${Date.now()}`);
  } catch (error) {
    console.error(`[json-store] could not quarantine ${file}:`, error);
  }
}

export function createJsonStore<T>(
  fileName: string,
  createDefault: () => T,
  normalize?: (value: T) => T,
): JsonStore<T> {
  let cache: T | null = null;

  const filePath = (): string => resolveFile(fileName);

  const read = (): T => {
    if (cache !== null) return cache;
    const file = filePath();
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as T;
      if (parsed === null || typeof parsed !== "object") {
        throw new Error(`${fileName} does not contain a JSON object`);
      }
      cache = normalize ? normalize(parsed) : parsed;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        console.error(`[json-store] failed to read ${fileName}; starting fresh:`, error);
        quarantine(file);
      }
      cache = createDefault();
    }
    return cache as T;
  };

  const write = (value: T): T => {
    const file = filePath();
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
      fs.renameSync(tmp, file);
      cache = value;
      return value;
    } catch (error) {
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        /* best effort */
      }
      throw new Error(
        `[json-store] failed to write ${fileName}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  };

  const update = (mutate: (current: T) => T): T => write(mutate(read()));

  return {
    fileName,
    filePath,
    read,
    write,
    update,
    invalidate: () => {
      cache = null;
    },
  };
}

/** Read a plain text file under `userData`, returning `fallback` when absent. */
export function readUserDataText(fileName: string, fallback: string): string {
  try {
    return fs.readFileSync(resolveFile(fileName), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    console.error(`[json-store] failed to read ${fileName}:`, error);
    return fallback;
  }
}

/** Atomically replace a plain text file under `userData`. */
export function writeUserDataText(fileName: string, content: string): void {
  const file = resolveFile(fileName);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, content, "utf8");
    fs.renameSync(tmp, file);
  } catch (error) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* best effort */
    }
    throw new Error(
      `[json-store] failed to write ${fileName}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
