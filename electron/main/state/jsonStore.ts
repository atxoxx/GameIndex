/**
 * Legacy JSON-document store — superseded by `state/sqliteStore.ts`.
 *
 * Everything that used to call `createJsonStore` now creates a SQLite store
 * instead (see `STORAGE.md`). The module is kept because `JsonStore<T>` is the
 * shared interface and because `appSettings.ts`/`surfaces/` still own plain
 * files; nothing in `electron/main` calls these writers for domain data any
 * more. Do not add new call sites.
 *
 * History: the Rust build kept each domain (sessions, notes, shelves, saves, …)
 * in its own SQLite database. The first Electron pass kept each domain as one
 * JSON document; that pass is over, and `legacyJson.ts` parks those documents on
 * first run.
 *
 * Writes are synchronous on purpose, exactly like the SQLite store, so callers
 * can keep treating a returned write as durable.
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
