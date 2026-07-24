-- =====================================================================
-- Gamelib persistent storage — achievements domain (achievements.db).
-- =====================================================================
-- Cached per-game `GameAchievementData` blob. One row per `game_id`
-- (the local library id, not the IGDB or Steam id).

CREATE TABLE IF NOT EXISTS achievements_cache (
    game_id      TEXT PRIMARY KEY,
    steam_app_id INTEGER NOT NULL,
    payload_json TEXT NOT NULL,             -- compact GameAchievementData
    last_synced  INTEGER
);
