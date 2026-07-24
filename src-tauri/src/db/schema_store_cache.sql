-- =====================================================================
-- Gamelib persistent storage — store cache domain (store_cache.db).
-- =====================================================================
-- Two tables:
--   * `store_cache(category, page)` — paginated catalogue snapshots.
--   * `store_detail(slug)` — full per-game detail payloads.

CREATE TABLE IF NOT EXISTS store_cache (
    category     TEXT NOT NULL,
    page         INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    fetched_at   INTEGER NOT NULL,
    PRIMARY KEY (category, page)
);

CREATE TABLE IF NOT EXISTS store_detail (
    slug         TEXT PRIMARY KEY,
    payload_json TEXT NOT NULL,
    fetched_at   INTEGER NOT NULL
);
