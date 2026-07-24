-- =====================================================================
-- Gamelib persistent storage — wishlist domain (wishlist.db).
-- =====================================================================
-- One row per wishlisted Steam / IGDB-keyed game, keyed by its `slug`
-- (unique per IGDB title).

CREATE TABLE IF NOT EXISTS wishlist (
    slug        TEXT PRIMARY KEY,            -- IGDB slug, naturally unique
    payload_json TEXT NOT NULL,             -- compact StoreGameSummary
    added_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_wishlist_added ON wishlist(added_at DESC);
