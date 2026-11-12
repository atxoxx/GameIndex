/**
 * SQLite schema for the core library domains.
 *
 * One physical database file per domain, mirroring the retired Rust backend
 * (`src-tauri/src/db/mod.rs`): `games.db`, `sessions.db`, `game_notes.db`,
 * `shelves.db`, `wishlist.db`, `saves.db`, `kv.db`. Files live under
 * `<userData>/db/` so they can never be confused with a legacy Tauri-era
 * `*.db` sitting at the root of the app-data folder.
 *
 * ## Column layout
 *
 * `games` mirrors `src-tauri/src/db/schema_games.sql` plus every historical
 * `ALTER` (v2 … v17): the same column names, SQLite types and nullability, and
 * the same indices. Fields the Rust DAO collapsed into compact JSON stay JSON
 * columns here (`genres_json`, `screenshots_json`, …) so the same split between
 * "cheap scalar" and "heavy blob" survives.
 *
 * Two deliberate deviations, both documented in `gameRows.ts`:
 *
 *  • `steam_app_id` is indexed but **not** `UNIQUE`. The Rust table declared it
 *    unique, which combined with `INSERT OR REPLACE` silently deletes a row
 *    when two library entries share an AppID. The Electron JSON store allowed
 *    such rows, so keeping UNIQUE would be a data-loss regression.
 *  • v2 adds three Electron-only columns: `position` (stable display order —
 *    the JSON document was an ordered array, SQLite rowid is not preserved by
 *    an upsert), `extra_json` (every `Game` field the Rust column set does not
 *    know about, e.g. `humbleGameId`/`uplayGameId`/`untracked`, so a row still
 *    round-trips exactly like the JSON store) and `compatibility_json` (Rust
 *    moved the profile to `compatibility.db`; nothing else in this build reads
 *    that table, so keeping it inline preserves `save_games_subset` semantics).
 *
 * ## Versions
 *
 * `MIGRATIONS` is an append-only list per domain. Fresh installs apply every
 * version in order; an existing file only gets the ones above
 * `MAX(version)` from its `migrations` table. Never renumber a published entry.
 */

/** Logical database, one file each (labels match the Rust pool labels). */
export type DbDomain =
  | "games"
  | "sessions"
  | "game_notes"
  | "shelves"
  | "wishlist"
  | "saves"
  | "kv";

export interface Migration {
  /** Monotonic version, 1-based. */
  version: number;
  /** DDL statements applied in order inside one transaction. */
  statements: string[];
}

/** File name per domain, under `<userData>/db/`. */
export const DB_FILES: Record<DbDomain, string> = {
  games: "games.db",
  sessions: "sessions.db",
  game_notes: "game_notes.db",
  shelves: "shelves.db",
  wishlist: "wishlist.db",
  saves: "saves.db",
  kv: "kv.db",
};

/**
 * `games` — final Rust column set (schema_games.sql + v2 … v17), in the
 * historical order the positional Rust DAO used.
 */
const GAMES_V1 = `
CREATE TABLE IF NOT EXISTS games (
    id                    TEXT PRIMARY KEY,
    name                  TEXT NOT NULL DEFAULT '',
    path                  TEXT NOT NULL DEFAULT '',
    platform              TEXT NOT NULL DEFAULT '',
    installed             INTEGER NOT NULL DEFAULT 0,
    play_time             TEXT NOT NULL DEFAULT '0h',
    added_at              INTEGER NOT NULL DEFAULT 0,
    cover_art_url         TEXT,
    notes                 TEXT,
    size_bytes            INTEGER,
    size_detected_at      TEXT,
    size_root_path        TEXT,
    icon_url              TEXT,
    banner_url            TEXT,
    logo_url              TEXT,
    description           TEXT,
    developer             TEXT,
    publisher             TEXT,
    release_date          TEXT,
    metadata_source       TEXT,
    metadata_url          TEXT,
    storyline             TEXT,
    igdb_rating           REAL,
    critic_rating         REAL,
    steam_app_id          INTEGER,
    steam_playtime        INTEGER,
    store_source          TEXT,
    epic_namespace        TEXT,
    epic_catalog_item_id  TEXT,
    launch_arguments      TEXT,
    run_as_admin          INTEGER,
    last_played           INTEGER,
    play_status           TEXT,
    genres_json                  TEXT,
    themes_json                  TEXT,
    game_modes_json              TEXT,
    player_perspectives_json     TEXT,
    screenshots_json             TEXT,
    videos_json                  TEXT,
    websites_json                TEXT,
    time_to_beat_json            TEXT,
    similar_games_json           TEXT,
    releases_json                TEXT,
    igdb_reviews_json            TEXT,
    alternative_names_json       TEXT,
    steam_achievements_json      TEXT,
    language_supports_json       TEXT,
    collection                   TEXT,
    franchise                    TEXT,
    game_category                TEXT,
    release_status               TEXT,
    gog_game_id           TEXT,
    gog_playtime          INTEGER,
    pre_launch_script     TEXT,
    pre_launch_admin      INTEGER,
    post_exit_script      TEXT,
    post_exit_admin       INTEGER,
    companion_apps_json   TEXT,
    emulator_id           TEXT,
    rom_path              TEXT,
    mods_folder           TEXT,
    mods_size_bytes       INTEGER,
    mods_detected_at      TEXT,
    cover_source_url      TEXT,
    show_steam_launch_selection INTEGER,
    igdb_id               INTEGER,
    rom_hash              TEXT,
    rom_region            TEXT,
    rom_language          TEXT,
    rom_group             TEXT,
    rom_disc              INTEGER,
    rom_archived          INTEGER,
    favorite              INTEGER,
    compat_notes          TEXT,
    rom_profile           TEXT,
    version               TEXT,
    collection_id         INTEGER,
    display_name          TEXT,
    content_hash          TEXT,
    logo_source_url       TEXT,
    is_vr                 INTEGER,
    extra_executables_json TEXT,
    purchase_cost         REAL,
    purchase_currency     TEXT,
    mo2_launch_enabled    INTEGER,
    mo2_profile           TEXT,
    mo2_executable        TEXT,
    mo2_instance_path     TEXT
);
CREATE INDEX IF NOT EXISTS ix_games_last_played ON games(last_played DESC);
CREATE INDEX IF NOT EXISTS ix_games_name        ON games(name);
CREATE INDEX IF NOT EXISTS ix_games_steam_appid ON games(steam_app_id);
CREATE INDEX IF NOT EXISTS ix_games_emulator_id ON games(emulator_id);
CREATE INDEX IF NOT EXISTS ix_games_rom_hash    ON games(rom_hash);
CREATE INDEX IF NOT EXISTS ix_games_favorite    ON games(favorite);
`;

/** Electron-only additions: stable order, unknown-field passthrough, inline compat. */
const GAMES_V2 = `
ALTER TABLE games ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
ALTER TABLE games ADD COLUMN extra_json TEXT;
ALTER TABLE games ADD COLUMN compatibility_json TEXT;
CREATE INDEX IF NOT EXISTS ix_games_position ON games(position);
`;

const SESSIONS_V1 = `
CREATE TABLE IF NOT EXISTS sessions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id         TEXT NOT NULL,
    started_at      INTEGER NOT NULL,
    ended_at        INTEGER,
    elapsed_seconds INTEGER,
    avg_fps         REAL,
    avg_cpu         REAL,
    avg_gpu         REAL,
    avg_ram         REAL,
    metrics_json    TEXT,
    game_name       TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_sessions_game   ON sessions(game_id, started_at DESC);
CREATE INDEX IF NOT EXISTS ix_sessions_active ON sessions(ended_at) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_sessions_game_name ON sessions(game_name);
`;

/** The listing query (`ended_at IS NOT NULL ORDER BY started_at DESC`). */
const SESSIONS_V2 = `
CREATE INDEX IF NOT EXISTS ix_sessions_started ON sessions(started_at DESC) WHERE ended_at IS NOT NULL;
`;

const GAME_NOTES_V1 = `
CREATE TABLE IF NOT EXISTS game_notes (
    id          TEXT PRIMARY KEY,
    game_id     TEXT NOT NULL,
    title       TEXT NOT NULL DEFAULT '',
    content     TEXT NOT NULL DEFAULT '',
    tags_json   TEXT NOT NULL DEFAULT '[]',
    pinned      INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_game_notes_game ON game_notes(game_id, pinned DESC, updated_at DESC);
`;

const SHELVES_V1 = `
CREATE TABLE IF NOT EXISTS shelves (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    icon        TEXT NOT NULL DEFAULT 'layers',
    color       TEXT NOT NULL DEFAULT 'accent',
    rules_json  TEXT NOT NULL DEFAULT '{}',
    sort        TEXT NOT NULL DEFAULT 'alphabetical',
    pinned      INTEGER NOT NULL DEFAULT 0,
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_shelves_position ON shelves(position);
CREATE TABLE IF NOT EXISTS game_completions (
    game_id      TEXT PRIMARY KEY,
    completed_at INTEGER NOT NULL
);
`;

const WISHLIST_V1 = `
CREATE TABLE IF NOT EXISTS wishlist (
    slug         TEXT PRIMARY KEY,
    payload_json TEXT NOT NULL,
    added_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_wishlist_added ON wishlist(added_at DESC);
`;

const SAVES_V1 = `
CREATE TABLE IF NOT EXISTS save_locations (
    id              TEXT PRIMARY KEY,
    game_id         TEXT NOT NULL,
    path            TEXT NOT NULL,
    label           TEXT NOT NULL DEFAULT '',
    kind            TEXT NOT NULL DEFAULT 'dir',
    source          TEXT NOT NULL DEFAULT 'manual',
    include         INTEGER NOT NULL DEFAULT 1,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    last_backup_at  INTEGER,
    last_restore_at INTEGER
);
CREATE INDEX IF NOT EXISTS ix_save_locations_game ON save_locations(game_id, created_at);
CREATE TABLE IF NOT EXISTS save_backups (
    id              TEXT PRIMARY KEY,
    game_id         TEXT NOT NULL,
    game_name       TEXT NOT NULL DEFAULT '',
    created_at      INTEGER NOT NULL,
    kind            TEXT NOT NULL DEFAULT 'manual',
    note            TEXT NOT NULL DEFAULT '',
    location_count  INTEGER NOT NULL DEFAULT 0,
    file_count      INTEGER NOT NULL DEFAULT 0,
    total_bytes     INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'complete',
    error           TEXT,
    root_path       TEXT NOT NULL DEFAULT '',
    manifest_path   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_save_backups_game ON save_backups(game_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_save_backups_created ON save_backups(created_at DESC);
`;

const KV_V1 = `
CREATE TABLE IF NOT EXISTS kv_store (
    k          TEXT PRIMARY KEY,
    v          TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
`;

/** Ordered migrations per domain (append-only). */
export const MIGRATIONS: Record<DbDomain, Migration[]> = {
  games: [
    { version: 1, statements: [GAMES_V1] },
    { version: 2, statements: [GAMES_V2] },
  ],
  sessions: [
    { version: 1, statements: [SESSIONS_V1] },
    { version: 2, statements: [SESSIONS_V2] },
  ],
  game_notes: [{ version: 1, statements: [GAME_NOTES_V1] }],
  shelves: [{ version: 1, statements: [SHELVES_V1] }],
  wishlist: [{ version: 1, statements: [WISHLIST_V1] }],
  saves: [{ version: 1, statements: [SAVES_V1] }],
  kv: [{ version: 1, statements: [KV_V1] }],
};

/** Highest version a domain will reach after every migration is applied. */
export function latestVersion(domain: DbDomain): number {
  const list = MIGRATIONS[domain];
  return list.length === 0 ? 0 : list[list.length - 1].version;
}

/**
 * Migrations that still have to run for a domain currently recorded at
 * `currentVersion`. Pure helper so the version selection can be unit-tested
 * without opening SQLite.
 */
export function pendingMigrations(domain: DbDomain, currentVersion: number): Migration[] {
  const applied = Number.isFinite(currentVersion) ? currentVersion : 0;
  return MIGRATIONS[domain].filter((migration) => migration.version > applied);
}
