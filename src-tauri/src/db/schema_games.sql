-- =====================================================================
-- Gamelib persistent storage — games domain (games.db).
-- =====================================================================
-- One row per library game. Many optional `GameData` fields collapse
-- into compact-JSON columns; reads/writes marshal via `serde_json`.
--
-- Column order matters: the Rust `games` DAO reads columns by
-- position. The v2 (GOG) and v5 (launch orchestration) ALTERs are
-- appended in their historical order so the positional indices in
-- `game_row_from_row` stay correct.

CREATE TABLE IF NOT EXISTS games (
    id                    TEXT PRIMARY KEY,
    name                  TEXT NOT NULL,
    path                  TEXT NOT NULL DEFAULT '',
    platform              TEXT NOT NULL DEFAULT '',
    installed             INTEGER NOT NULL,
    play_time             TEXT NOT NULL DEFAULT '0h',
    added_at              INTEGER NOT NULL,
    -- The frontend `Game` struct has many optional fields. To keep
    -- the schema reviewable, we collapse the optional metadata into
    -- three compact-JSON columns + a handful of indexed scalars.
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
    steam_app_id          INTEGER UNIQUE,
    steam_playtime        INTEGER,
    store_source          TEXT,
    epic_namespace        TEXT,
    epic_catalog_item_id  TEXT,
    launch_arguments      TEXT,
    run_as_admin          INTEGER,
    last_played           INTEGER,
    play_status           TEXT,
    -- Compact JSON arrays / nested objects kept as compact JSON.
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
    language_supports_json        TEXT,
    collection                   TEXT,
    franchise                    TEXT,
    game_category                TEXT,
    release_status               TEXT
);
CREATE INDEX IF NOT EXISTS ix_games_last_played ON games(last_played DESC);
CREATE INDEX IF NOT EXISTS ix_games_name        ON games(name);
CREATE INDEX IF NOT EXISTS ix_games_steam_appid ON games(steam_app_id);

-- v2: GOG Galaxy integration columns.
ALTER TABLE games ADD COLUMN gog_game_id TEXT;
ALTER TABLE games ADD COLUMN gog_playtime INTEGER;

-- v5: launch-orchestration columns.
ALTER TABLE games ADD COLUMN pre_launch_script TEXT;
ALTER TABLE games ADD COLUMN pre_launch_admin INTEGER;
ALTER TABLE games ADD COLUMN post_exit_script TEXT;
ALTER TABLE games ADD COLUMN post_exit_admin INTEGER;
ALTER TABLE games ADD COLUMN companion_apps_json TEXT;
