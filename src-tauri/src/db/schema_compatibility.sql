-- Compatibility domain, v1: isolated Linux/Proton/Wine database.
CREATE TABLE IF NOT EXISTS compatibility_settings (
    id TEXT PRIMARY KEY,
    settings_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS game_compatibility (
    game_id TEXT PRIMARY KEY,
    config_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS compatibility_runners (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    kind TEXT NOT NULL,
    version TEXT,
    is_proton INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
