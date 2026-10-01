-- =====================================================================
-- GameIndex persistent storage — save-backup domain (saves.db).
-- =====================================================================
-- Two tables back the Save Backups suite:
--
--   save_locations — one row per discovered / user-added folder or file
--     that holds a game's save data. `source` records how it was found
--     (curated registry, heuristic scan, emulator, or a manual path) so
--     the UI can explain each entry and auto-detected rows can be
--     refreshed without touching the user's own additions.
--
--   save_backups — one row per snapshot taken of a game's locations.
--     The actual files live on disk under the configured backup folder
--     (`root_path`, a versioned directory with a `manifest.json`); this
--     table is the searchable index the UI renders. `game_name` is
--     denormalized so history stays legible after a game is removed.

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
