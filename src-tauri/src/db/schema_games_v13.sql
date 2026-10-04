-- schema_games_v13.sql
-- Append-only migration for the games domain:
-- Adds the `logo_source_url` column holding the original public https
-- URL the game logo was downloaded from (for Discord Rich Presence,
-- which fetches images server-side). Mirrors `cover_source_url` (v4).
ALTER TABLE games ADD COLUMN logo_source_url TEXT;
