-- =====================================================================
-- Gamelib persistent storage - mods domain (mods.db).
-- =====================================================================
-- One row per detected/managed mod, linked to a game in games.db via
-- `game_id` (cross-file, so no FK - reconciliation happens in the
-- mods scanner). `game_mod_settings` carries per-game modding config
-- (engine override, Nexus Mods domain, resolved plugins.txt path).

CREATE TABLE IF NOT EXISTS mods (
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

CREATE TABLE IF NOT EXISTS game_mod_settings (
    game_id       TEXT PRIMARY KEY,
    mods_root     TEXT,
    custom_root   TEXT,              -- user-picked folder, survives re-scans
    engine        TEXT,
    plugins_txt   TEXT,
    nexus_domain  TEXT,
    updated_at    INTEGER NOT NULL
);
