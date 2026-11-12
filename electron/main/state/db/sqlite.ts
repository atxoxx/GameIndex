/**
 * Thin SQLite layer shared by every library domain.
 *
 * Responsibilities, and nothing else:
 *  • one cached `better-sqlite3` connection per domain file, opened with WAL,
 *    `synchronous = NORMAL` and a busy timeout so a reader never blocks a write;
 *  • an idempotent, per-domain version runner backed by a `migrations` table;
 *  • prepared-statement caching (`prepare()`), because the row writes here run
 *    in tight loops over thousands of games;
 *  • the generic `kv_store` helpers other features use for small state.
 *
 * The databases live under `<userData>/db/` (see `lib/paths.ts`), which keeps
 * them apart from any legacy Tauri-era `*.db` at the root of the app-data dir.
 */
import { app } from "electron";
import Database from "better-sqlite3";
import { dbPath } from "../../lib/paths";
import {
  DB_FILES,
  pendingMigrations,
  type DbDomain,
} from "./schema";

export type SqliteDatabase = Database.Database;
export type SqliteStatement = Database.Statement;
export type SqlRow = Record<string, unknown>;

const connections = new Map<DbDomain, SqliteDatabase>();
const statements = new WeakMap<SqliteDatabase, Map<string, SqliteStatement>>();

/** Absolute path of a domain's database file (creates `<userData>/db/`). */
export function databasePath(domain: DbDomain): string {
  return dbPath(DB_FILES[domain]);
}

function applyMigrations(domain: DbDomain, db: SqliteDatabase): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)",
  );
  const row = db.prepare("SELECT MAX(version) AS version FROM migrations").get() as
    | { version: number | bigint | null }
    | undefined;
  const current = Number(row?.version ?? 0);
  const pending = pendingMigrations(domain, Number.isFinite(current) ? current : 0);
  if (pending.length === 0) return;

  // One transaction for the whole batch: a half-applied domain file is worse
  // than a startup error, and SQLite DDL is transactional.
  const run = db.transaction(() => {
    const record = db.prepare(
      "INSERT INTO migrations(version, applied_at) VALUES (?, ?)",
    );
    for (const migration of pending) {
      for (const statement of migration.statements) db.exec(statement);
      record.run(migration.version, Date.now());
    }
  });
  run();
}

/**
 * Open (or reuse) the connection for a domain and bring its schema up to date.
 * Throws only when the file itself cannot be created/opened — callers that must
 * not fail boot wrap this in a try/catch (the import path does).
 */
export function openDb(domain: DbDomain): SqliteDatabase {
  const cached = connections.get(domain);
  if (cached) return cached;

  const file = databasePath(domain);
  let db: SqliteDatabase;
  try {
    db = new Database(file);
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.pragma("busy_timeout = 5000");
    db.pragma("foreign_keys = ON");
    applyMigrations(domain, db);
  } catch (error) {
    throw new Error(
      `cannot open the ${domain} database at ${file} — check that the folder is writable and the file is not locked by another program (${
        error instanceof Error ? error.message : String(error)
      })`,
    );
  }

  connections.set(domain, db);
  return db;
}

/** Cached prepared statement for a domain connection. */
export function prepare(domain: DbDomain, sql: string): SqliteStatement {
  const db = openDb(domain);
  let cache = statements.get(db);
  if (!cache) {
    cache = new Map();
    statements.set(db, cache);
  }
  const cached = cache.get(sql);
  if (cached) return cached;
  const statement = db.prepare(sql);
  cache.set(sql, statement);
  return statement;
}

/** Run a mutation in a transaction on an already-open connection. */
export function withTransaction<T>(db: SqliteDatabase, run: () => T): T {
  return db.transaction(run)();
}

/** True when a table exists in an arbitrary (including legacy) connection. */
export function hasTable(db: SqliteDatabase, table: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { name?: string } | undefined;
  return Boolean(row?.name);
}

/** Column names of a table, read through `PRAGMA table_info`. */
export function tableColumns(db: SqliteDatabase, table: string): Set<string> {
  if (!hasTable(db, table)) return new Set();
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as {
    name?: string;
  }[];
  return new Set(
    rows
      .map((row) => (typeof row.name === "string" ? row.name : ""))
      .filter((name) => name.length > 0),
  );
}

/** Apply WAL checkpoint + close every open domain connection (used on quit). */
export function closeAllDatabases(): void {
  for (const [domain, db] of connections) {
    try {
      db.pragma("wal_checkpoint(TRUNCATE)");
    } catch (error) {
      console.error(`[db] checkpoint ${domain} failed:`, error);
    }
    try {
      db.close();
    } catch (error) {
      console.error(`[db] close ${domain} failed:`, error);
    }
    statements.delete(db);
  }
  connections.clear();
}

// ── Generic key/value store (kv.db) ─────────────────────────────────────────

/** Unset keys read back as `null`. Values are opaque strings (JSON by convention). */
export function kvGet(key: string): string | null {
  const row = prepare("kv", "SELECT v FROM kv_store WHERE k = ?").get(key) as
    | { v?: string }
    | undefined;
  return typeof row?.v === "string" ? row.v : null;
}

export function kvSet(key: string, value: string): void {
  prepare(
    "kv",
    `INSERT INTO kv_store(k, v, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at`,
  ).run(key, value, Math.floor(Date.now() / 1000));
}

export function kvDelete(key: string): void {
  prepare("kv", "DELETE FROM kv_store WHERE k = ?").run(key);
}

/** Convenience for stored objects: corrupt JSON reads back as `null`. */
export function kvGetJson<T>(key: string): T | null {
  const raw = kvGet(key);
  if (raw === null || raw.length === 0) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function kvSetJson(key: string, value: unknown): void {
  kvSet(key, JSON.stringify(value));
}

/**
 * Flush/close everything when the app quits. Registered once at module load so
 * no caller has to remember it; `flushLibrarySync`/`flushSessionsSync` also
 * call it explicitly (idempotent).
 */
app.on("before-quit", () => {
  closeAllDatabases();
});
