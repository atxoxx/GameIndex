/**
 * SQLite-backed replacement for `state/jsonStore.ts`.
 *
 * The previous pass kept every feature domain in one `*.json` file under
 * `userData`. This store keeps the exact same `JsonStore<T>` contract —
 * synchronous `read` / `write` / `update`, throwing on failure — but the bytes
 * live in the domain database under `<userData>/db/<domain>.db`:
 *
 *  • small documents go into the domain's `documents (name, json)` table;
 *  • domains whose shape maps onto the retired Rust tables pass a `codec`
 *    (see `state/db/codecs.ts`) and are stored as real rows.
 *
 * `fileName` still reports the legacy JSON file name (so diagnostics and the
 * backup workstream can name the document it replaced) while `filePath()`
 * returns the database that now backs it. `STORAGE.md` is the authoritative
 * file → database table.
 */
import { databasePath, ensureStorage } from "./db";
import { readDocumentJson, writeDocumentJson } from "./db/documents";
import type { DbDomain } from "./db/schema";
import type { JsonStore } from "./jsonStore";

/**
 * A domain-specific translator between the feature document and real tables.
 * Implementations must replace the domain's rows atomically and reconstruct
 * the exact document shape the feature code already reads/writes.
 */
export interface SqliteDocumentCodec {
  /** Current document value (never `null` for an empty domain). */
  load(name: string): unknown;
  /** Persist the whole document, replacing prior rows. */
  save(name: string, value: unknown): void;
}

export interface SqliteStoreOptions<T> {
  /** Domain database under `<userData>/db/`. */
  domain: DbDomain;
  /** Document name inside the domain (usually the legacy file stem). */
  document: string;
  /** Legacy JSON file name; defaults to `<document>.json`. */
  fileName?: string;
  createDefault: () => T;
  normalize?: (value: T) => T;
  /** Optional real-table mapping; omitted means the `documents` table. */
  codec?: SqliteDocumentCodec;
}

export interface SqliteStore<T> extends JsonStore<T> {
  readonly domain: DbDomain;
  readonly document: string;
  /** Absolute path of the database file that holds the document. */
  databasePath(): string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function createSqliteStore<T>(options: SqliteStoreOptions<T>): SqliteStore<T> {
  const { domain, document, codec, createDefault, normalize } = options;
  const fileName = options.fileName ?? `${document}.json`;
  let cache: T | null = null;

  const read = (): T => {
    if (cache !== null) return cache;
    ensureStorage(domain);

    let loaded: unknown = null;
    try {
      loaded = codec ? codec.load(document) : readDocumentJson(domain, document);
    } catch (error) {
      console.error(`[sqlite-store] failed to read ${domain}/${document}:`, error);
      loaded = null;
    }

    if (!isObject(loaded)) {
      if (loaded !== null) {
        console.error(
          `[sqlite-store] ${domain}/${document} is not a JSON object; starting fresh`,
        );
      }
      cache = createDefault();
      return cache;
    }

    const value = loaded as T;
    cache = normalize ? normalize(value) : value;
    return cache;
  };

  const write = (value: T): T => {
    ensureStorage(domain);
    try {
      if (codec) codec.save(document, value);
      else writeDocumentJson(domain, document, value);
    } catch (error) {
      throw new Error(
        `[sqlite-store] failed to write ${domain}/${document} (${fileName}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    cache = value;
    return value;
  };

  const update = (mutate: (current: T) => T): T => write(mutate(read()));

  return {
    domain,
    document,
    fileName,
    filePath: () => databasePath(domain),
    databasePath: () => databasePath(domain),
    read,
    write,
    update,
    invalidate: () => {
      cache = null;
    },
  };
}
