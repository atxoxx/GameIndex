/**
 * One-time import of existing user data into the SQLite domains.
 *
 * Two sources, in priority order:
 *
 *  1. the Electron JSON documents written by the previous storage pass, in
 *     `app.getPath('userData')`: `library.json`, `sessions-db.json`,
 *     `game-notes.json`, `shelves.json`, `wishlist_cache.json`, `saves.json`;
 *  2. the retired Tauri app-data directory (`com.gameindex.app`, `GameIndex`,
 *     `gameindex` under `app.getPath('appData')`): the per-domain SQLite files
 *     (`games.db`, `sessions.db`, `game_notes.db`, `shelves.db`, `wishlist.db`,
 *     `saves.db`, `kv.db`), the single-file `gamelib.db`, and the JSON files
 *     Rust itself used to import (`games.json`, `wishlist_cache.json`).
 *
 * Every writer is "insert if missing", so running twice is harmless; the kv
 * flag `migration:<domain>-v1` normally prevents a second run entirely.
 *
 * Legacy SQLite files are copied to a temp dir before opening, so a still
 * installed Tauri build keeps its WAL state intact. Missing files, missing
 * tables and missing columns are all tolerated — `PRAGMA table_info` decides
 * what can be read — so any historical schema version imports what it has.
 *
 * A JSON document that cannot be parsed is renamed to
 * `<file>.corrupt-<timestamp>` (bytes preserved, never deleted) and the import
 * continues. Nothing here is allowed to abort startup: failures are logged and
 * recorded under `migration:<domain>-error` in `kv.db`, and the domain simply
 * starts empty.
 */
import { app } from "electron";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Game } from "../../../../src/types/game";
import { userDataPath } from "../../lib/paths";
import { GAME_COLUMNS, decodeGame } from "./gameRows";
import { insertMissingGames } from "./games";
import { insertMissingNotes, type GameNote } from "./notes";
import {
  insertMissingCompletions,
  insertMissingShelves,
  type Shelf,
} from "./shelves";
import {
  insertMissingSaveBackups,
  insertMissingSaveLocations,
  setSavesSettings,
  type SaveBackup,
  type SaveLocation,
} from "./saves";
import {
  insertSessionRecords,
  mergeSessionRecords,
  type SessionRecord,
} from "./sessions";
import {
  hasTable,
  kvGet,
  kvSetJson,
  prepare,
  tableColumns,
  type SqliteDatabase,
} from "./sqlite";
import { insertMissingWishlist, insertMissingWishlistRows } from "./wishlist";
import type { DbDomain } from "./schema";

const attempted = new Set<DbDomain>();
const running = new Set<DbDomain>();

type JsonStatus = "missing" | "ok" | "corrupt";

interface JsonDocument {
  status: JsonStatus;
  value: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Read a JSON document, quarantining (renaming) unparseable bytes instead of
 * deleting them. `quarantine` is false for files outside our own userData.
 */
function readJsonDocument(file: string, quarantine = true): JsonDocument {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { status: "missing", value: null };
    }
    console.error(`[db-import] cannot read ${file}:`, error);
    return { status: "corrupt", value: null };
  }

  try {
    return { status: "ok", value: JSON.parse(raw) as unknown };
  } catch (error) {
    console.error(`[db-import] ${file} is not valid JSON; keeping a copy:`, error);
    if (quarantine) {
      try {
        fs.renameSync(file, `${file}.corrupt-${Date.now()}`);
      } catch (renameError) {
        console.error(`[db-import] could not move ${file} aside:`, renameError);
      }
    }
    return { status: "corrupt", value: null };
  }
}

/** Existing legacy app-data directories, de-duplicated by resolved path. */
function legacyDirs(): string[] {
  const candidates = [
    path.join(app.getPath("appData"), "com.gameindex.app"),
    path.join(app.getPath("appData"), "GameIndex"),
    path.join(app.getPath("appData"), "gameindex"),
  ];
  const seen = new Set<string>();
  const dirs: string[] = [];
  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const resolved = path.resolve(candidate);
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      dirs.push(candidate);
    } catch {
      /* unreadable candidate: skip */
    }
  }
  return dirs;
}

/**
 * Copy a legacy SQLite file (and its WAL sidecars) to a temp directory and open
 * the copy. Never opens the original read-write, so a running Tauri build's
 * database is untouched.
 */
function openLegacyCopy(file: string): SqliteDatabase | null {
  if (!fs.existsSync(file)) return null;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gameindex-import-"));
  const copy = path.join(tempDir, path.basename(file));
  try {
    fs.copyFileSync(file, copy);
    for (const suffix of ["-wal", "-shm"]) {
      const sidecar = `${file}${suffix}`;
      if (fs.existsSync(sidecar)) fs.copyFileSync(sidecar, `${copy}${suffix}`);
    }
    return new Database(copy);
  } catch (error) {
    console.error(`[db-import] cannot open legacy ${file}:`, error);
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
    return null;
  }
}

function closeLegacy(db: SqliteDatabase): void {
  const file = db.name;
  try {
    db.close();
  } catch (error) {
    console.error("[db-import] closing a legacy database failed:", error);
  }
  try {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

/** Rows of `table` restricted to columns that actually exist. */
function readLegacyRows(
  db: SqliteDatabase,
  table: string,
  wanted: readonly string[],
): Record<string, unknown>[] {
  if (!hasTable(db, table)) return [];
  const available = tableColumns(db, table);
  const columns = wanted.filter((column) => available.has(column));
  if (columns.length === 0) return [];
  return db.prepare(`SELECT ${columns.join(", ")} FROM ${table}`).all() as Record<
    string,
    unknown
  >[];
}

// ── games ───────────────────────────────────────────────────────────────────

function gamesFromJson(value: unknown): Game[] {
  const rows = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.games)
      ? value.games
      : [];
  const games: Game[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = row.id;
    if (typeof id !== "string" || id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    games.push(row as unknown as Game);
  }
  return games;
}

function gamesFromLegacyDb(file: string): Game[] {
  const db = openLegacyCopy(file);
  if (!db) return [];
  try {
    const rows = readLegacyRows(
      db,
      "games",
      [...GAME_COLUMNS.map((column) => column.column), "extra_json"],
    );
    const games: Game[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const game = decodeGame(row);
      if (!game.id || seen.has(game.id)) continue;
      seen.add(game.id);
      games.push(game);
    }
    return games;
  } catch (error) {
    console.error(`[db-import] reading legacy games from ${file} failed:`, error);
    return [];
  } finally {
    closeLegacy(db);
  }
}

function importGames(): string[] {
  const sources: string[] = [];
  const read = new Set<string>();

  const jsonFile = userDataPath("library.json");
  read.add(path.resolve(jsonFile));
  const document = readJsonDocument(jsonFile);
  if (document.status === "ok") {
    const games = gamesFromJson(document.value);
    const written = insertMissingGames(games);
    sources.push(`library.json (${games.length} rows, ${written} inserted)`);
  }

  for (const dir of legacyDirs()) {
    for (const name of ["games.db", "gamelib.db"]) {
      const file = path.join(dir, name);
      const games = gamesFromLegacyDb(file);
      if (games.length === 0) continue;
      const written = insertMissingGames(games);
      sources.push(`${file} (${games.length} rows, ${written} inserted)`);
    }

    const legacyJson = path.join(dir, "games.json");
    if (read.has(path.resolve(legacyJson))) continue;
    read.add(path.resolve(legacyJson));
    const document2 = readJsonDocument(legacyJson, false);
    if (document2.status === "ok") {
      const games = gamesFromJson(document2.value);
      const written = insertMissingGames(games);
      sources.push(`${legacyJson} (${games.length} rows, ${written} inserted)`);
    }
  }

  return sources;
}

// ── sessions ────────────────────────────────────────────────────────────────

function sessionFromRecord(row: Record<string, unknown>): SessionRecord | null {
  const id = Number(row.id);
  const gameId = typeof row.gameId === "string" ? row.gameId : row.game_id;
  const startedAtMs = Number(row.startedAtMs ?? row.started_at);
  if (!Number.isFinite(id) || typeof gameId !== "string" || !Number.isFinite(startedAtMs)) {
    return null;
  }
  const endedAt = row.endedAtMs ?? row.ended_at;
  return {
    id: Math.trunc(id),
    gameId,
    gameName: (row.gameName ?? row.game_name ?? null) as string | null,
    startedAtMs,
    endedAtMs: endedAt === null || endedAt === undefined ? null : Number(endedAt),
    elapsedSeconds:
      row.elapsedSeconds === null || row.elapsedSeconds === undefined
        ? row.elapsed_seconds === null || row.elapsed_seconds === undefined
          ? null
          : Number(row.elapsed_seconds)
        : Number(row.elapsedSeconds),
    avgFps: row.avgFps === undefined ? (row.avg_fps as number | null) : (row.avgFps as number | null),
    avgCpu: row.avgCpu === undefined ? (row.avg_cpu as number | null) : (row.avgCpu as number | null),
    avgGpu: row.avgGpu === undefined ? (row.avg_gpu as number | null) : (row.avgGpu as number | null),
    avgRam: row.avgRam === undefined ? (row.avg_ram as number | null) : (row.avgRam as number | null),
    metricsJson: (row.metricsJson ?? row.metrics_json ?? null) as string | null,
  };
}

function sessionsFromLegacyDb(file: string): SessionRecord[] {
  const db = openLegacyCopy(file);
  if (!db) return [];
  try {
    const rows = readLegacyRows(db, "sessions", [
      "id",
      "game_id",
      "game_name",
      "started_at",
      "ended_at",
      "elapsed_seconds",
      "avg_fps",
      "avg_cpu",
      "avg_gpu",
      "avg_ram",
      "metrics_json",
    ]);
    const out: SessionRecord[] = [];
    for (const row of rows) {
      const record = sessionFromRecord(row);
      if (record) out.push(record);
    }
    return out;
  } catch (error) {
    console.error(`[db-import] reading legacy sessions from ${file} failed:`, error);
    return [];
  } finally {
    closeLegacy(db);
  }
}

function importSessions(): string[] {
  const sources: string[] = [];

  const jsonFile = userDataPath("sessions-db.json");
  const document = readJsonDocument(jsonFile);
  if (document.status === "ok" && isRecord(document.value) && Array.isArray(document.value.sessions)) {
    const records: SessionRecord[] = [];
    for (const row of document.value.sessions) {
      if (!isRecord(row)) continue;
      const record = sessionFromRecord(row);
      if (record) records.push(record);
    }
    const written = insertSessionRecords(records);
    sources.push(`sessions-db.json (${records.length} rows, ${written} written)`);
  }

  for (const dir of legacyDirs()) {
    const file = path.join(dir, "sessions.db");
    const records = sessionsFromLegacyDb(file);
    if (records.length === 0) continue;
    const written = mergeSessionRecords(records);
    sources.push(`${file} (${records.length} rows, ${written} merged)`);
  }

  return sources;
}

// ── notes ───────────────────────────────────────────────────────────────────

function noteFromRow(row: Record<string, unknown>): GameNote | null {
  const id = row.id;
  const gameId = row.gameId ?? row.game_id;
  if (typeof id !== "string" || id.length === 0 || typeof gameId !== "string") return null;

  let tags: string[] = [];
  if (Array.isArray(row.tags)) {
    tags = row.tags.filter((tag): tag is string => typeof tag === "string");
  } else if (typeof row.tags_json === "string") {
    try {
      const parsed = JSON.parse(row.tags_json) as unknown;
      if (Array.isArray(parsed)) {
        tags = parsed.filter((tag): tag is string => typeof tag === "string");
      }
    } catch {
      tags = [];
    }
  }

  return {
    id,
    gameId,
    title: typeof row.title === "string" ? row.title : "",
    content: typeof row.content === "string" ? row.content : "",
    tags,
    pinned: Boolean(row.pinned),
    createdAt: Math.max(0, Number(row.createdAt ?? row.created_at ?? 0)),
    updatedAt: Math.max(0, Number(row.updatedAt ?? row.updated_at ?? 0)),
  };
}

function notesFromLegacyDb(file: string): GameNote[] {
  const db = openLegacyCopy(file);
  if (!db) return [];
  try {
    const rows = readLegacyRows(db, "game_notes", [
      "id",
      "game_id",
      "title",
      "content",
      "tags_json",
      "pinned",
      "created_at",
      "updated_at",
    ]);
    const out: GameNote[] = [];
    for (const row of rows) {
      const note = noteFromRow(row);
      if (note) out.push(note);
    }
    return out;
  } catch (error) {
    console.error(`[db-import] reading legacy notes from ${file} failed:`, error);
    return [];
  } finally {
    closeLegacy(db);
  }
}

function importNotes(): string[] {
  const sources: string[] = [];

  const jsonFile = userDataPath("game-notes.json");
  const document = readJsonDocument(jsonFile);
  if (document.status === "ok" && isRecord(document.value) && Array.isArray(document.value.notes)) {
    const notes: GameNote[] = [];
    for (const row of document.value.notes) {
      if (!isRecord(row)) continue;
      const note = noteFromRow(row);
      if (note) notes.push(note);
    }
    const written = insertMissingNotes(notes);
    sources.push(`game-notes.json (${notes.length} rows, ${written} inserted)`);
  }

  for (const dir of legacyDirs()) {
    const file = path.join(dir, "game_notes.db");
    const notes = notesFromLegacyDb(file);
    if (notes.length === 0) continue;
    const written = insertMissingNotes(notes);
    sources.push(`${file} (${notes.length} rows, ${written} inserted)`);
  }

  return sources;
}

// ── shelves ─────────────────────────────────────────────────────────────────

function shelfFromRow(row: Record<string, unknown>): Shelf | null {
  const id = row.id;
  if (typeof id !== "string" || id.length === 0) return null;
  let rules: Record<string, unknown> = {};
  if (isRecord(row.rules)) {
    rules = row.rules;
  } else if (typeof row.rules_json === "string") {
    try {
      const parsed = JSON.parse(row.rules_json) as unknown;
      if (isRecord(parsed)) rules = parsed;
    } catch {
      rules = {};
    }
  }
  return {
    id,
    name: typeof row.name === "string" ? row.name : "",
    icon: typeof row.icon === "string" && row.icon ? row.icon : "layers",
    color: typeof row.color === "string" && row.color ? row.color : "accent",
    rules,
    sort: typeof row.sort === "string" && row.sort ? row.sort : "alphabetical",
    pinned: Boolean(row.pinned),
    position: Math.trunc(Number(row.position ?? 0)) || 0,
    createdAt: Math.max(0, Number(row.createdAt ?? row.created_at ?? 0)),
    updatedAt: Math.max(0, Number(row.updatedAt ?? row.updated_at ?? 0)),
  };
}

function shelvesFromLegacyDb(file: string): { shelves: Shelf[]; completions: [string, number][] } {
  const db = openLegacyCopy(file);
  if (!db) return { shelves: [], completions: [] };
  try {
    const shelves: Shelf[] = [];
    for (const row of readLegacyRows(db, "shelves", [
      "id",
      "name",
      "icon",
      "color",
      "rules_json",
      "sort",
      "pinned",
      "position",
      "created_at",
      "updated_at",
    ])) {
      const shelf = shelfFromRow(row);
      if (shelf) shelves.push(shelf);
    }

    const completions: [string, number][] = [];
    for (const row of readLegacyRows(db, "game_completions", ["game_id", "completed_at"])) {
      if (typeof row.game_id !== "string") continue;
      completions.push([row.game_id, Math.max(0, Number(row.completed_at ?? 0))]);
    }
    return { shelves, completions };
  } catch (error) {
    console.error(`[db-import] reading legacy shelves from ${file} failed:`, error);
    return { shelves: [], completions: [] };
  } finally {
    closeLegacy(db);
  }
}

function importShelves(): string[] {
  const sources: string[] = [];

  const jsonFile = userDataPath("shelves.json");
  const document = readJsonDocument(jsonFile);
  if (document.status === "ok" && isRecord(document.value)) {
    const shelves: Shelf[] = [];
    for (const row of Array.isArray(document.value.shelves) ? document.value.shelves : []) {
      if (!isRecord(row)) continue;
      const shelf = shelfFromRow(row);
      if (shelf) shelves.push(shelf);
    }
    const completions: [string, number][] = [];
    if (isRecord(document.value.completions)) {
      for (const [gameId, value] of Object.entries(document.value.completions)) {
        completions.push([gameId, Math.max(0, Number(value ?? 0))]);
      }
    }
    const writtenShelves = insertMissingShelves(shelves);
    const writtenCompletions = insertMissingCompletions(completions);
    sources.push(
      `shelves.json (${writtenShelves} shelves, ${writtenCompletions} completions)`,
    );
  }

  for (const dir of legacyDirs()) {
    const file = path.join(dir, "shelves.db");
    const { shelves, completions } = shelvesFromLegacyDb(file);
    if (shelves.length === 0 && completions.length === 0) continue;
    const writtenShelves = insertMissingShelves(shelves);
    const writtenCompletions = insertMissingCompletions(completions);
    sources.push(`${file} (${writtenShelves} shelves, ${writtenCompletions} completions)`);
  }

  return sources;
}

// ── wishlist ────────────────────────────────────────────────────────────────

function wishlistFromJson(value: unknown): Record<string, unknown> {
  if (!isRecord(value) || !isRecord(value.entries)) return {};
  return value.entries;
}

function wishlistFromLegacyDb(file: string): { slug: string; payloadJson: string; addedAt: number }[] {
  const db = openLegacyCopy(file);
  if (!db) return [];
  try {
    const rows = readLegacyRows(db, "wishlist", ["slug", "payload_json", "added_at"]);
    const out: { slug: string; payloadJson: string; addedAt: number }[] = [];
    for (const row of rows) {
      if (typeof row.slug !== "string" || typeof row.payload_json !== "string") continue;
      out.push({
        slug: row.slug,
        payloadJson: row.payload_json,
        addedAt: Math.max(0, Number(row.added_at ?? 0)),
      });
    }
    return out;
  } catch (error) {
    console.error(`[db-import] reading legacy wishlist from ${file} failed:`, error);
    return [];
  } finally {
    closeLegacy(db);
  }
}

function importWishlist(): string[] {
  const sources: string[] = [];
  const read = new Set<string>();

  const jsonFile = userDataPath("wishlist_cache.json");
  read.add(path.resolve(jsonFile));
  const document = readJsonDocument(jsonFile);
  if (document.status === "ok") {
    const entries = wishlistFromJson(document.value);
    const written = insertMissingWishlist(entries);
    sources.push(`wishlist_cache.json (${written} inserted)`);
  }

  for (const dir of legacyDirs()) {
    const legacyJson = path.join(dir, "wishlist_cache.json");
    if (!read.has(path.resolve(legacyJson))) {
      read.add(path.resolve(legacyJson));
      const legacyDocument = readJsonDocument(legacyJson, false);
      if (legacyDocument.status === "ok") {
        const entries = wishlistFromJson(legacyDocument.value);
        const written = insertMissingWishlist(entries);
        if (written > 0) sources.push(`${legacyJson} (${written} inserted)`);
      }
    }

    const file = path.join(dir, "wishlist.db");
    const rows = wishlistFromLegacyDb(file);
    if (rows.length > 0) {
      const written = insertMissingWishlistRows(rows);
      sources.push(`${file} (${rows.length} rows, ${written} inserted)`);
    }
  }

  return sources;
}

// ── saves ───────────────────────────────────────────────────────────────────

function nullableTimestamp(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : null;
}

function locationFromRow(row: Record<string, unknown>): SaveLocation | null {
  const id = row.id;
  const gameId = row.gameId ?? row.game_id;
  if (typeof id !== "string" || id.length === 0 || typeof gameId !== "string") return null;
  return {
    id,
    gameId,
    path: typeof row.path === "string" ? row.path : "",
    label: typeof row.label === "string" ? row.label : "",
    kind: typeof row.kind === "string" && row.kind ? row.kind : "dir",
    source: typeof row.source === "string" && row.source ? row.source : "manual",
    include: row.include === undefined ? true : Boolean(row.include),
    createdAt: Math.max(0, Number(row.createdAt ?? row.created_at ?? 0)),
    updatedAt: Math.max(0, Number(row.updatedAt ?? row.updated_at ?? 0)),
    lastBackupAt: nullableTimestamp(row.lastBackupAt ?? row.last_backup_at),
    lastRestoreAt: nullableTimestamp(row.lastRestoreAt ?? row.last_restore_at),
  };
}

function backupFromRow(row: Record<string, unknown>): SaveBackup | null {
  const id = row.id;
  const gameId = row.gameId ?? row.game_id;
  if (typeof id !== "string" || id.length === 0 || typeof gameId !== "string") return null;
  return {
    id,
    gameId,
    gameName: typeof row.gameName === "string" ? row.gameName : typeof row.game_name === "string" ? row.game_name : "",
    createdAt: Math.max(0, Number(row.createdAt ?? row.created_at ?? 0)),
    kind: typeof row.kind === "string" && row.kind ? row.kind : "manual",
    note: typeof row.note === "string" ? row.note : "",
    locationCount: Math.max(0, Number(row.locationCount ?? row.location_count ?? 0)),
    fileCount: Math.max(0, Number(row.fileCount ?? row.file_count ?? 0)),
    totalBytes: Math.max(0, Number(row.totalBytes ?? row.total_bytes ?? 0)),
    status: typeof row.status === "string" && row.status ? row.status : "complete",
    error: (row.error ?? null) as string | null,
    rootPath: typeof row.rootPath === "string" ? row.rootPath : typeof row.root_path === "string" ? row.root_path : "",
    manifestPath:
      typeof row.manifestPath === "string"
        ? row.manifestPath
        : typeof row.manifest_path === "string"
          ? row.manifest_path
          : "",
  };
}

function savesFromLegacyDb(file: string): {
  locations: SaveLocation[];
  backups: SaveBackup[];
} {
  const db = openLegacyCopy(file);
  if (!db) return { locations: [], backups: [] };
  try {
    const locations: SaveLocation[] = [];
    for (const row of readLegacyRows(db, "save_locations", [
      "id",
      "game_id",
      "path",
      "label",
      "kind",
      "source",
      "include",
      "created_at",
      "updated_at",
      "last_backup_at",
      "last_restore_at",
    ])) {
      const location = locationFromRow(row);
      if (location) locations.push(location);
    }

    const backups: SaveBackup[] = [];
    for (const row of readLegacyRows(db, "save_backups", [
      "id",
      "game_id",
      "game_name",
      "created_at",
      "kind",
      "note",
      "location_count",
      "file_count",
      "total_bytes",
      "status",
      "error",
      "root_path",
      "manifest_path",
    ])) {
      const backup = backupFromRow(row);
      if (backup) backups.push(backup);
    }
    return { locations, backups };
  } catch (error) {
    console.error(`[db-import] reading legacy saves from ${file} failed:`, error);
    return { locations: [], backups: [] };
  } finally {
    closeLegacy(db);
  }
}

function readLegacyKvValue(kvFile: string, key: string): string | null {
  const db = openLegacyCopy(kvFile);
  if (!db) return null;
  try {
    if (!hasTable(db, "kv_store")) return null;
    const row = db.prepare("SELECT v FROM kv_store WHERE k = ?").get(key) as
      | { v?: string }
      | undefined;
    return typeof row?.v === "string" ? row.v : null;
  } catch (error) {
    console.error(`[db-import] reading legacy kv ${key} from ${kvFile} failed:`, error);
    return null;
  } finally {
    closeLegacy(db);
  }
}

function importSaves(): string[] {
  const sources: string[] = [];

  const jsonFile = userDataPath("saves.json");
  const document = readJsonDocument(jsonFile);
  const jsonSettings =
    document.status === "ok" && isRecord(document.value) && isRecord(document.value.settings)
      ? document.value.settings
      : null;

  if (document.status === "ok" && isRecord(document.value)) {
    if (jsonSettings) setSavesSettings(jsonSettings);

    const locations: SaveLocation[] = [];
    for (const row of Array.isArray(document.value.locations) ? document.value.locations : []) {
      if (!isRecord(row)) continue;
      const location = locationFromRow(row);
      if (location) locations.push(location);
    }
    const backups: SaveBackup[] = [];
    for (const row of Array.isArray(document.value.backups) ? document.value.backups : []) {
      if (!isRecord(row)) continue;
      const backup = backupFromRow(row);
      if (backup) backups.push(backup);
    }
    const writtenLocations = insertMissingSaveLocations(locations);
    const writtenBackups = insertMissingSaveBackups(backups);
    sources.push(`saves.json (${writtenLocations} locations, ${writtenBackups} backups)`);
  }

  // The JSON pass always seeded `{ settings: {} }`, so an empty object must not
  // shadow the real settings the Tauri build left in kv.db.
  const jsonSettingsEmpty = !jsonSettings || Object.keys(jsonSettings).length === 0;

  for (const dir of legacyDirs()) {
    const file = path.join(dir, "saves.db");
    const { locations, backups } = savesFromLegacyDb(file);
    if (locations.length > 0 || backups.length > 0) {
      const writtenLocations = insertMissingSaveLocations(locations);
      const writtenBackups = insertMissingSaveBackups(backups);
      sources.push(`${file} (${writtenLocations} locations, ${writtenBackups} backups)`);
    }

    const kvFile = path.join(dir, "kv.db");
    const settingsJson = readLegacyKvValue(kvFile, "saves.settings");
    if (settingsJson && jsonSettingsEmpty) {
      try {
        const parsed = JSON.parse(settingsJson) as unknown;
        if (isRecord(parsed)) {
          setSavesSettings(parsed);
          sources.push(`${kvFile} (saves.settings)`);
        }
      } catch {
        console.error("[db-import] legacy saves.settings is not valid JSON");
      }
    }
  }

  return sources;
}

// ── kv ──────────────────────────────────────────────────────────────────────

function importKv(): string[] {
  const sources: string[] = [];
  for (const dir of legacyDirs()) {
    const file = path.join(dir, "kv.db");
    const db = openLegacyCopy(file);
    if (!db) continue;
    try {
      const rows = readLegacyRows(db, "kv_store", ["k", "v", "updated_at"]);
      const insert = prepare(
        "kv",
        "INSERT OR IGNORE INTO kv_store(k, v, updated_at) VALUES (?, ?, ?)",
      );
      let written = 0;
      for (const row of rows) {
        if (typeof row.k !== "string" || typeof row.v !== "string") continue;
        written += insert.run(row.k, row.v, Number(row.updated_at ?? 0)).changes;
      }
      if (written > 0) sources.push(`${file} (${written} keys)`);
    } catch (error) {
      console.error(`[db-import] reading legacy kv from ${file} failed:`, error);
    } finally {
      closeLegacy(db);
    }
  }
  return sources;
}

// ── driver ──────────────────────────────────────────────────────────────────

function runImport(domain: DbDomain): string[] {
  switch (domain) {
    case "games":
      return importGames();
    case "sessions":
      return importSessions();
    case "game_notes":
      return importNotes();
    case "shelves":
      return importShelves();
    case "wishlist":
      return importWishlist();
    case "saves":
      return importSaves();
    case "kv":
      return importKv();
    default:
      // Feature domains own no legacy Tauri tables; their JSON is parked before
      // this runs (`state/legacyJson.ts`), so there is nothing to import.
      return [];
  }
}

const KEY_PREFIX = "migration:";

export function migrationKey(domain: DbDomain): string {
  return `${KEY_PREFIX}${domain}-v1`;
}

/**
 * Import a domain exactly once. Cheap on every later call: the in-process memo
 * and the kv flag both short-circuit.
 */
export function importDomainIfNeeded(domain: DbDomain): void {
  if (attempted.has(domain) || running.has(domain)) return;
  attempted.add(domain);

  const key = migrationKey(domain);
  try {
    if (kvGet(key)) return;
  } catch (error) {
    console.error(`[db-import] cannot read the import flag for ${domain}:`, error);
    return;
  }

  running.add(domain);
  try {
    const sources = runImport(domain);
    kvSetJson(key, { ok: true, at: Date.now(), sources });
    if (domain === "games") {
      kvSetJson("migration:library-v1", { ok: true, at: Date.now(), sources });
    }
  } catch (error) {
    // Never abort startup: the domain stays usable (empty) and the next launch
    // retries, which is safe because every writer is insert-if-missing.
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[db-import] ${domain} import failed: ${message}`);
    try {
      kvSetJson(`migration:${domain}-error`, { at: Date.now(), error: message });
    } catch {
      /* the kv database itself is unusable */
    }
  } finally {
    running.delete(domain);
  }
}
