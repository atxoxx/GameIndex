-- =====================================================================
-- Gamelib persistent storage - clips domain (clips.db).
-- =====================================================================
-- Highlight reels v1: a registry of recorded clips (native capture,
-- replay dumps or files the user points at), plus user-built
-- playlists ("reels") over that registry. No video assembly here —
-- reels are ordered references; playback happens in the OS player.

CREATE TABLE IF NOT EXISTS clips (
    id          TEXT PRIMARY KEY,             -- stable id (uuid-ish)
    path        TEXT NOT NULL UNIQUE,         -- absolute file path on disk
    game_id     TEXT,                         -- library game, when known
    game_name   TEXT,
    title       TEXT NOT NULL,
    kind        TEXT,                         -- 'record' | 'replay' | 'import'
    duration_ms INTEGER,
    size_bytes  INTEGER,
    favorite    INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,             -- when the clip was recorded
    added_at    INTEGER NOT NULL              -- when it entered the registry
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
