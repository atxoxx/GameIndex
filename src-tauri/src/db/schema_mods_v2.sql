-- =====================================================================
-- Gamelib persistent storage - mods domain, v2 rebuild.
-- =====================================================================
-- Rebuilds both tables from scratch. Two reasons:
--   1. Early dev builds could leave a mods.db behind with a different
--      column set; v1's CREATE TABLE IF NOT EXISTS silently kept it,
--      breaking every SELECT ("no such column: engine").
--   2. Adds `custom_root` (user-picked mods folder).
-- Dropping is safe: every mod row is fully re-derivable from a scan,
-- and the feature is brand new (no user data worth preserving).

DROP TABLE IF EXISTS mods;
DROP TABLE IF EXISTS game_mod_settings;

CREATE TABLE mods (
    id                TEXT PRIMARY KEY,
    game_id           TEXT NOT NULL,
    name              TEXT NOT NULL,
    version           TEXT,
    author            TEXT,
    engine            TEXT NOT NULL,             -- bethesda|bepinex|melonloader|unreal|workshop|generic
    kind              TEXT NOT NULL DEFAULT '',  -- plugin|dll|pak|folder|file
    path              TEXT NOT NULL,             -- absolute path to the mod file/folder
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
    updated_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_mods_game ON mods(game_id);

CREATE TABLE game_mod_settings (
    game_id       TEXT PRIMARY KEY,
    mods_root     TEXT,
    custom_root   TEXT,              -- user-picked folder, survives re-scans
    engine        TEXT,
    plugins_txt   TEXT,
    nexus_domain  TEXT,
    updated_at    INTEGER NOT NULL
);

CREATE TABLE mod_profiles (
    id            TEXT PRIMARY KEY,
    game_id       TEXT NOT NULL,
    name          TEXT NOT NULL,
    mod_states    TEXT NOT NULL,
    load_order    TEXT,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
);
CREATE INDEX ix_mod_profiles_game ON mod_profiles(game_id);
