-- =====================================================================
-- Gamelib persistent storage — games domain, v6 migration.
-- =====================================================================
-- Numeric IGDB game id (`IgdbGame.id`) persisted per game as a stable
-- identity key. Games that are later deleted can still be identified by
-- this id (e.g. in the Activity page), so removed titles keep their
-- provenance. NULL = no IGDB match at import time.

ALTER TABLE games ADD COLUMN igdb_id INTEGER;
