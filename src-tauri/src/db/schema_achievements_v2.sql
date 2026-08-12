-- =====================================================================
-- Gamelib persistent storage — achievements domain, v2 migration.
-- =====================================================================
-- Multi-source support. The cache row now carries a `source` tag
-- ('steam'|'retro'|'manual'|'gog'|'epic', default 'steam') plus an
-- optional `provider_id` identifying the game on the provider's side.
-- A new `achievement_links` table records per-game source identity +
-- manual unlock state, one row per (game_id, source); a game may hold
-- several links at once, but the cache row's `source` is the active one.

ALTER TABLE achievements_cache ADD COLUMN source      TEXT NOT NULL DEFAULT 'steam';
ALTER TABLE achievements_cache ADD COLUMN provider_id TEXT;

CREATE TABLE IF NOT EXISTS achievement_links (
    game_id            TEXT NOT NULL,
    source             TEXT NOT NULL,
    provider_id        TEXT,
    display_name       TEXT,
    source_url         TEXT,
    manual_unlocks_json TEXT,
    created_at         INTEGER,
    updated_at         INTEGER,
    PRIMARY KEY (game_id, source)
);
CREATE INDEX IF NOT EXISTS ix_achievement_links_game ON achievement_links(game_id);
