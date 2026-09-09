-- schema_games_v10.sql
-- Append-only migration for the games domain:
-- Adds collection_id so IGDB collection IDs persist across app restarts,
-- enabling the GameRelationsCard "Other in this collection" row to work reliably.
ALTER TABLE games ADD COLUMN collection_id INTEGER;
