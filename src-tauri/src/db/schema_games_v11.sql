-- schema_games_v11.sql
-- Append-only migration for the games domain:
-- Adds a nullable content fingerprint used by the write path to skip
-- rewriting rows whose persisted content is unchanged.
-- `content_hash` is an optimisation hint, not an invariant: point-update
-- DAOs (e.g. `update_last_played`, `set_artwork_url`) deliberately leave
-- it stale, and a stale/NULL hash only means the row is rewritten once.
ALTER TABLE games ADD COLUMN content_hash TEXT;
