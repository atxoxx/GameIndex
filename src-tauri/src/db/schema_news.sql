-- =====================================================================
-- Gamelib persistent storage — news cache domain (news.db).
-- =====================================================================
-- Most-recent fetch per RSS / Atom source URL.

CREATE TABLE IF NOT EXISTS news_cache (
    source_url  TEXT PRIMARY KEY,
    payload_json TEXT NOT NULL,
    fetched_at  INTEGER NOT NULL
);
