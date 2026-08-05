-- =====================================================================
-- Gamelib persistent storage — games domain, v4 migration.
-- =====================================================================
-- Adds the original public cover URL so Discord Rich Presence can show
-- the game poster. Discord fetches images server-side; the base64
-- `cover_art_url` data URI stored for offline library display cannot be
-- fetched, so we keep the source URL the cover was downloaded from.
-- Populated by metadata enrichment alongside `cover_art_url`.

ALTER TABLE games ADD COLUMN cover_source_url TEXT;
