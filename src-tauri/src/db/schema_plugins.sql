-- =====================================================================
-- Gamelib persistent storage - plugins domain (plugins.db).
-- =====================================================================
-- One row per user-installed JS search plugin. The plugin source file
-- itself lives at `<app_data_dir>/plugins/<id>.js` (mirrored in
-- `file_path`); the row carries the installed manifest plus a sha256
-- of the file so `plugins_install` can verify nothing changed between
-- import and install. `enabled` is the runtime toggle checked by
-- `search_downloads`; `last_error` surfaces sandbox/eval/network
-- failures to the frontend instead of silently skipping a broken
-- plugin.

CREATE TABLE IF NOT EXISTS plugins (
    id          TEXT PRIMARY KEY,               -- plugin descriptor id, ^[a-z0-9-]+$
    name        TEXT NOT NULL,
    version     TEXT NOT NULL,
    author      TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    source_url  TEXT NOT NULL DEFAULT '',
    file_hash   TEXT NOT NULL,                  -- sha256 hex of the installed file
    file_path   TEXT NOT NULL,                  -- absolute path of the installed copy
    enabled     INTEGER NOT NULL DEFAULT 0,
    imported_at INTEGER NOT NULL,               -- unix seconds
    last_error  TEXT                            -- most recent sandbox/search failure
);
