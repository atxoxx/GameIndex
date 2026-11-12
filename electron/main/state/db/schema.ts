/**
 * SQLite schema for the core library domains.
 *
 * One physical database file per domain, mirroring the retired Rust backend
 * (`src-tauri/src/db/mod.rs`): `games.db`, `sessions.db`, `game_notes.db`,
 * `shelves.db`, `wishlist.db`, `saves.db`, `kv.db`, plus the feature domains
 * that used to be `<userData>/*.json` (`achievements.db`, `news.db`,
 * `plugins.db`, `clips.db`, `mods.db`, `emulators.db`, `sources.db`,
 * `store_cache.db`, `compatibility.db`, `downloads.db`). Files live under
 * `<userData>/db/` so they can never be confused with a legacy Tauri-era
 * `*.db` sitting at the root of the app-data folder. `state/STORAGE.md` is the
 * file → database → table mapping.
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
  | "kv"
  // Feature domains that used to be one `*.json` document each. Every one of
  // them keeps a `documents` table as a fallback for shapes that do not map to
  // the retired Rust tables; where the Rust schema fits, the real tables are
  // created here and used by the matching codec (see `STORAGE.md`).
  | "achievements"
  | "news"
  | "plugins"
  | "clips"
  | "mods"
  | "emulators"
  | "sources"
  | "store_cache"
  | "compatibility"
  | "downloads";

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
  achievements: "achievements.db",
  news: "news.db",
  plugins: "plugins.db",
  clips: "clips.db",
  mods: "mods.db",
  emulators: "emulators.db",
  sources: "sources.db",
  store_cache: "store_cache.db",
  compatibility: "compatibility.db",
  downloads: "downloads.db",
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

// ── Feature domains (the retired JSON documents) ─────────────────────────────
//
// Every feature domain starts with the generic `documents` table, which is the
// exact replacement for the old `<userData>/<name>.json` file: one row per
// document, the payload as JSON. Domains whose shape maps cleanly onto the
// retired Rust schema additionally get the real tables and use them through a
// codec (`state/db/<domain>.ts`); the `documents` row is then unused, but the
// table stays so a future shape can fall back to it without a migration.
//
// Later SQL additions to the retired Rust files (`schema_*_v2.sql`,
// `schema_*_v3.sql`) are folded into the `v1` block below: these databases are
// created by this build only, and the retired profile is imported through
// `importLegacy.ts` rather than opened in place.

/** The JSON-document fallback shared by every feature domain. */
const DOCUMENTS_V1 = `
CREATE TABLE IF NOT EXISTS documents (
    name       TEXT PRIMARY KEY,
    json       TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
`;

/** `db/schema_achievements.sql` + v2 (source/provider_id, achievement_links). */
const ACHIEVEMENTS_V1 = `
CREATE TABLE IF NOT EXISTS achievements_cache (
    game_id      TEXT PRIMARY KEY,
    steam_app_id INTEGER NOT NULL DEFAULT 0,
    payload_json TEXT NOT NULL,
    last_synced  INTEGER,
    source       TEXT NOT NULL DEFAULT 'steam',
    provider_id  TEXT
);
CREATE TABLE IF NOT EXISTS achievement_links (
    game_id             TEXT NOT NULL,
    source              TEXT NOT NULL,
    provider_id         TEXT,
    display_name        TEXT,
    source_url          TEXT,
    manual_unlocks_json TEXT,
    created_at          INTEGER,
    updated_at          INTEGER,
    PRIMARY KEY (game_id, source)
);
CREATE INDEX IF NOT EXISTS ix_achievement_links_game ON achievement_links(game_id);
`;

/** `db/schema_news.sql` + v2 (feeds/articles/read/saved/history/prefs) + v3. */
const NEWS_V1 = `
CREATE TABLE IF NOT EXISTS news_cache (
    source_url   TEXT PRIMARY KEY,
    payload_json TEXT NOT NULL,
    fetched_at   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS news_feeds (
    url        TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    category   TEXT NOT NULL DEFAULT 'general',
    region     TEXT,
    is_default INTEGER NOT NULL DEFAULT 0,
    enabled    INTEGER NOT NULL DEFAULT 1,
    position   INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS news_articles (
    link        TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    content     TEXT NOT NULL DEFAULT '',
    pub_date    TEXT NOT NULL DEFAULT '',
    source_name TEXT NOT NULL,
    source_url  TEXT NOT NULL DEFAULT '',
    image_url   TEXT,
    first_seen  INTEGER NOT NULL,
    fetched_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_news_articles_fetched ON news_articles(fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_articles_source  ON news_articles(source_name);
CREATE TABLE IF NOT EXISTS news_read (
    link    TEXT PRIMARY KEY,
    read_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_news_read_at ON news_read(read_at DESC);
CREATE TABLE IF NOT EXISTS news_saved (
    link        TEXT PRIMARY KEY,
    saved_at    INTEGER NOT NULL,
    title       TEXT NOT NULL,
    source_name TEXT NOT NULL,
    pub_date    TEXT NOT NULL DEFAULT '',
    image_url   TEXT,
    description TEXT NOT NULL DEFAULT '',
    source_url  TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_news_saved_at ON news_saved(saved_at DESC);
CREATE TABLE IF NOT EXISTS news_history (
    link        TEXT PRIMARY KEY,
    read_at     INTEGER NOT NULL,
    title       TEXT NOT NULL,
    source_name TEXT NOT NULL,
    pub_date    TEXT NOT NULL DEFAULT '',
    image_url   TEXT,
    description TEXT NOT NULL DEFAULT '',
    source_url  TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_news_history_at ON news_history(read_at DESC);
CREATE TABLE IF NOT EXISTS news_prefs (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
`;

/** `db/schema_plugins.sql` + v2 (`platform_category`) + v3 (`manifest_json`). */
const PLUGINS_V1 = `
CREATE TABLE IF NOT EXISTS plugins (
    id                TEXT PRIMARY KEY,
    name              TEXT NOT NULL,
    version           TEXT NOT NULL DEFAULT '',
    author            TEXT NOT NULL DEFAULT '',
    description       TEXT NOT NULL DEFAULT '',
    source_url        TEXT NOT NULL DEFAULT '',
    file_hash         TEXT NOT NULL DEFAULT '',
    file_path         TEXT NOT NULL DEFAULT '',
    enabled           INTEGER NOT NULL DEFAULT 0,
    imported_at       INTEGER NOT NULL DEFAULT 0,
    last_error        TEXT,
    platform_category TEXT NOT NULL DEFAULT '',
    manifest_json     TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS plugin_config (
    plugin_id  TEXT NOT NULL,
    key        TEXT NOT NULL,
    value      TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (plugin_id, key)
);
`;

/** `db/schema_clips.sql` — clip registry + reels + ordered reel items. */
const CLIPS_V1 = `
CREATE TABLE IF NOT EXISTS clips (
    id          TEXT PRIMARY KEY,
    path        TEXT NOT NULL UNIQUE,
    game_id     TEXT,
    game_name   TEXT,
    title       TEXT NOT NULL,
    kind        TEXT,
    duration_ms INTEGER,
    size_bytes  INTEGER,
    favorite    INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    added_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_clips_game    ON clips(game_id);
CREATE INDEX IF NOT EXISTS ix_clips_created ON clips(created_at DESC);
CREATE TABLE IF NOT EXISTS reels (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reel_items (
    reel_id  TEXT NOT NULL,
    clip_id  TEXT NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (reel_id, clip_id)
);
CREATE INDEX IF NOT EXISTS ix_reel_items_order ON reel_items(reel_id, position);
`;

/** `db/schema_mods.sql` at v3 (`mods`, settings, profiles, sources, installs). */
const MODS_V1 = `
CREATE TABLE IF NOT EXISTS mods (
    id                TEXT PRIMARY KEY,
    game_id           TEXT NOT NULL,
    name              TEXT NOT NULL,
    version           TEXT,
    author            TEXT,
    engine            TEXT NOT NULL,
    kind              TEXT NOT NULL DEFAULT '',
    path              TEXT NOT NULL,
    enabled           INTEGER NOT NULL DEFAULT 1,
    load_order        INTEGER NOT NULL DEFAULT 0,
    size_bytes        INTEGER,
    file_count        INTEGER,
    md5               TEXT,
    nexus_mod_id      INTEGER,
    nexus_domain      TEXT,
    latest_version    TEXT,
    update_available  INTEGER NOT NULL DEFAULT 0,
    notes             TEXT,
    detected_at       INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL,
    source            TEXT,
    source_mod_id     TEXT,
    source_file_id    TEXT,
    remote_url        TEXT
);
CREATE INDEX IF NOT EXISTS ix_mods_game ON mods(game_id);
CREATE TABLE IF NOT EXISTS game_mod_settings (
    game_id      TEXT PRIMARY KEY,
    mods_root    TEXT,
    custom_root  TEXT,
    engine       TEXT,
    plugins_txt  TEXT,
    nexus_domain TEXT,
    updated_at   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS mod_profiles (
    id         TEXT PRIMARY KEY,
    game_id    TEXT NOT NULL,
    name       TEXT NOT NULL,
    mod_states TEXT NOT NULL,
    load_order TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_mod_profiles_game ON mod_profiles(game_id);
CREATE TABLE IF NOT EXISTS mod_source_links (
    game_id     TEXT NOT NULL,
    source      TEXT NOT NULL,
    external_id TEXT NOT NULL,
    display_name TEXT,
    updated_at  INTEGER NOT NULL,
    PRIMARY KEY (game_id, source)
);
CREATE TABLE IF NOT EXISTS mod_remote_installs (
    id             TEXT PRIMARY KEY,
    game_id        TEXT NOT NULL,
    source         TEXT NOT NULL,
    source_mod_id  TEXT NOT NULL,
    source_file_id TEXT,
    name           TEXT NOT NULL,
    author         TEXT,
    version        TEXT,
    remote_url     TEXT,
    installed_path TEXT,
    installed_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_mod_remote_installs_game ON mod_remote_installs(game_id);
`;

/** `db/schema_emulators.sql` + v2, plus `extra_json` for unknown fields. */
const EMULATORS_V1 = `
CREATE TABLE IF NOT EXISTS emulators (
    id                 TEXT PRIMARY KEY,
    name               TEXT NOT NULL,
    platform           TEXT NOT NULL DEFAULT 'Unknown',
    executable_path    TEXT NOT NULL DEFAULT '',
    arguments_template TEXT NOT NULL DEFAULT '%ROM%',
    rom_folder         TEXT NOT NULL DEFAULT '',
    notes              TEXT,
    icon_url           TEXT,
    created_at         INTEGER NOT NULL,
    updated_at         INTEGER NOT NULL,
    bios_folder        TEXT NOT NULL DEFAULT '',
    saves_folder       TEXT NOT NULL DEFAULT '',
    auto_scan          INTEGER NOT NULL DEFAULT 0,
    extra_json         TEXT
);
CREATE INDEX IF NOT EXISTS ix_emulators_platform ON emulators(platform);
`;

/**
 * `db/schema_sources.sql`, minus `downloads` / `downloads_fts`: this build keeps
 * a fetched catalogue as one `sources_cache.payload_json` blob and searches it
 * in memory, so it never inserts per-download rows.
 */
const SOURCES_V1 = `
CREATE TABLE IF NOT EXISTS sources (
    id           TEXT PRIMARY KEY,
    url          TEXT NOT NULL,
    name         TEXT NOT NULL,
    enabled      INTEGER NOT NULL DEFAULT 1,
    last_fetched INTEGER,
    game_count   INTEGER NOT NULL DEFAULT 0,
    added_at     INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_sources_url ON sources(url);
CREATE TABLE IF NOT EXISTS sources_cache (
    source_id    TEXT PRIMARY KEY,
    fetched_at   INTEGER NOT NULL,
    payload_json TEXT NOT NULL
);
`;

/** `db/schema_store_cache.sql`. */
const STORE_CACHE_V1 = `
CREATE TABLE IF NOT EXISTS store_cache (
    category     TEXT NOT NULL,
    page         INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    fetched_at   INTEGER NOT NULL,
    PRIMARY KEY (category, page)
);
CREATE TABLE IF NOT EXISTS store_detail (
    slug         TEXT PRIMARY KEY,
    payload_json TEXT NOT NULL,
    fetched_at   INTEGER NOT NULL
);
`;

/** `db/schema_compatibility.sql` — only the settings row this build uses. */
const COMPATIBILITY_V1 = `
CREATE TABLE IF NOT EXISTS compatibility_settings (
    id            TEXT PRIMARY KEY,
    settings_json TEXT NOT NULL,
    updated_at    INTEGER NOT NULL
);
`;

/** `db/schema_download_history.sql`, colocated with the queue/state documents. */
const DOWNLOADS_V1 = `
CREATE TABLE IF NOT EXISTS download_history (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    download_id  TEXT NOT NULL UNIQUE,
    kind         TEXT NOT NULL,
    name         TEXT NOT NULL,
    source_name  TEXT NOT NULL DEFAULT '',
    save_path    TEXT NOT NULL DEFAULT '',
    downloaded   INTEGER NOT NULL DEFAULT 0,
    total_size   INTEGER,
    status       TEXT NOT NULL,
    debrid_cached INTEGER,
    auto_extract INTEGER,
    extracted    INTEGER,
    added_at     INTEGER NOT NULL,
    completed_at INTEGER,
    peak_speed   INTEGER NOT NULL DEFAULT 0
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
  kv: [
    { version: 1, statements: [KV_V1] },
    // Small feature documents that used to be their own `*.json` file live
    // here (see `state/STORAGE.md`); v2 gives them the shared document table.
    { version: 2, statements: [DOCUMENTS_V1] },
  ],
  achievements: [
    { version: 1, statements: [DOCUMENTS_V1, ACHIEVEMENTS_V1] },
  ],
  news: [{ version: 1, statements: [DOCUMENTS_V1, NEWS_V1] }],
  plugins: [{ version: 1, statements: [DOCUMENTS_V1, PLUGINS_V1] }],
  clips: [{ version: 1, statements: [DOCUMENTS_V1, CLIPS_V1] }],
  mods: [{ version: 1, statements: [DOCUMENTS_V1, MODS_V1] }],
  emulators: [{ version: 1, statements: [DOCUMENTS_V1, EMULATORS_V1] }],
  sources: [{ version: 1, statements: [DOCUMENTS_V1, SOURCES_V1] }],
  store_cache: [
    { version: 1, statements: [DOCUMENTS_V1, STORE_CACHE_V1] },
  ],
  compatibility: [
    { version: 1, statements: [DOCUMENTS_V1, COMPATIBILITY_V1] },
  ],
  downloads: [{ version: 1, statements: [DOCUMENTS_V1, DOWNLOADS_V1] }],
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
