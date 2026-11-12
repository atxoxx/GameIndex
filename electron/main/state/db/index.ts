/**
 * Barrel + one-time bootstrap for the SQLite library domains.
 *
 * `ensureStorage(domain)` is what every public store function calls first: it
 * opens the domain file (running any pending migration) and then performs the
 * one-time import of the pre-SQLite data. Both steps are memoized per process
 * and the import is additionally guarded by a kv flag, so calling it on every
 * read is cheap.
 */
import { importDomainIfNeeded } from "./importLegacy";
import { openDb } from "./sqlite";
import type { DbDomain } from "./schema";
import { parkLegacyJsonDocuments } from "../legacyJson";

const prepared = new Set<DbDomain>();

export function ensureStorage(domain: DbDomain): void {
  // Before anything can import from the old JSON documents, park them: this
  // build starts from SQLite and the old bytes are kept in `json-backup-*`.
  parkLegacyJsonDocuments();
  try {
    if (!prepared.has(domain)) {
      openDb(domain);
      prepared.add(domain);
    }
  } catch (error) {
    console.error(`[db] could not open the ${domain} database:`, error);
    return;
  }
  importDomainIfNeeded(domain);
  // The generic kv domain has no owning store, so its legacy import rides along
  // with whichever domain is used first (it is memoized, so this is free).
  if (domain !== "kv") importDomainIfNeeded("kv");
}

export {
  closeAllDatabases,
  databasePath,
  hasTable,
  kvDelete,
  kvGet,
  kvGetJson,
  kvSet,
  kvSetJson,
  openDb,
  prepare,
  tableColumns,
  withTransaction,
} from "./sqlite";
export type { SqlRow, SqliteDatabase, SqliteStatement } from "./sqlite";

export {
  DB_FILES,
  MIGRATIONS,
  latestVersion,
  pendingMigrations,
} from "./schema";
export type { DbDomain, Migration } from "./schema";

export {
  HEAVY_GAME_FIELDS,
  GAME_COLUMNS,
  decodeGame,
  encodeGame,
  mergeGameRecords,
  toSummaryGame,
} from "./gameRows";

export {
  countGames,
  deleteGameRows,
  getGameRow,
  insertMissingGames,
  listGameIds,
  listGameRows,
  listGameSummaries,
  patchGameRow,
  replaceLibraryRows,
  setGameLastPlayed,
  upsertGameRows,
} from "./games";

export {
  appendSessionSample,
  countSessions,
  deleteSessionRow,
  deleteSessionRowsForGame,
  finishSessionRow,
  getSessionSamples,
  insertSessionRecords,
  listFinishedSessionRows,
  listSessionRows,
  mergeSessionRecords,
  relinkSessionRows,
  startSessionRow,
} from "./sessions";
export type { SessionRecord, SessionStart } from "./sessions";

export {
  deleteNoteRow,
  deleteNoteRowsForGame,
  insertMissingNotes,
  listNotesForGame,
  searchNotes,
  upsertNote,
} from "./notes";
export type { GameNote } from "./notes";

export {
  MAX_SHELVES,
  clearCompletion,
  countShelves,
  deleteShelfRow,
  insertMissingCompletions,
  insertMissingShelves,
  listCompletions,
  listShelves,
  nextShelfPosition,
  reorderShelves,
  setCompletion,
  upsertShelf,
} from "./shelves";
export type { Shelf } from "./shelves";

export {
  insertMissingWishlist,
  insertMissingWishlistRows,
  listWishlistEntries,
  replaceWishlistEntries,
} from "./wishlist";
export type { WishlistEntries } from "./wishlist";

export {
  deleteSaveLocation,
  getSavesSettings,
  insertMissingSaveBackups,
  insertMissingSaveLocations,
  listSaveBackups,
  listSaveLocations,
  setSavesSettings,
  upsertSaveLocation,
} from "./saves";
export type { SaveBackup, SaveLocation, SavesSettingsBlob } from "./saves";

export { importDomainIfNeeded, migrationKey } from "./importLegacy";

export {
  deleteDocument,
  readDocumentJson,
  readDocumentRow,
  readDocumentText,
  writeDocumentJson,
  writeDocumentText,
} from "./documents";

export {
  achievementLinksCodec,
  achievementsCacheCodec,
  clipsCodec,
  compatibilityCodec,
  downloadHistoryCodec,
  emulatorsCodec,
  mergePluginConfigValues,
  modsCodec,
  newsCodec,
  pluginsCodec,
  readPluginConfigValues,
  sourcesCodec,
  storeCacheCodec,
  writePluginConfigValues,
} from "./codecs";
