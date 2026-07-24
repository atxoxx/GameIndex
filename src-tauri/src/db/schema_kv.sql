-- =====================================================================
-- Gamelib persistent storage — key/value domain (kv.db).
-- =====================================================================
-- Generic key/value store for non-sensitive metadata (Steam
-- library-sync timestamps, last Epic login time, launcher settings,
-- etc.). Values are compact JSON or plain strings — opaque to the
-- schema. Sensitive credentials live in the OS keychain, not here.

CREATE TABLE IF NOT EXISTS kv_store (
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
