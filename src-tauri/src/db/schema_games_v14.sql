-- schema_games_v14.sql
-- Append-only migration for the games domain:
-- Adds the `is_vr` flag marking a title as a virtual-reality game.
-- 1 = VR, 0 = explicitly not VR (manual override), NULL = unknown /
-- never detected. Detected from Steam VR categories & tags, IGDB VR
-- platforms and a standalone "VR" title token, or set by the user.
ALTER TABLE games ADD COLUMN is_vr INTEGER;
