-- =====================================================================
-- Gamelib persistent storage — games domain, v3 migration.
-- =====================================================================
-- Adds mods-tracking columns so each game can record the on-disk
-- footprint of a linked mods folder alongside its install size. The
-- Storage tab folds `mods_size_bytes` into the game's total (game +
-- mods) so the accounting stays honest across reloads.

ALTER TABLE games ADD COLUMN mods_folder TEXT;
ALTER TABLE games ADD COLUMN mods_size_bytes INTEGER;
ALTER TABLE games ADD COLUMN mods_detected_at TEXT;
