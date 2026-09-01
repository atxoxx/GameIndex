-- =====================================================================
-- Gamelib persistent storage — games domain, v7 migration.
-- =====================================================================
-- ROM management columns. These back the emulator-library features:
-- duplicate detection (rom_hash), No-Intro-style region/language tags
-- and multi-disc grouping parsed from filenames, archive support
-- (rom_archived), favorites, per-ROM compatibility notes, and the
-- per-ROM launch profile (JSON, see RomProfile in emulation.rs).
-- All columns are nullable/defaulted so pre-v7 rows stay valid.

ALTER TABLE games ADD COLUMN rom_hash TEXT;
ALTER TABLE games ADD COLUMN rom_region TEXT;
ALTER TABLE games ADD COLUMN rom_language TEXT;
ALTER TABLE games ADD COLUMN rom_group TEXT;
ALTER TABLE games ADD COLUMN rom_disc INTEGER;
ALTER TABLE games ADD COLUMN rom_archived INTEGER;
ALTER TABLE games ADD COLUMN favorite INTEGER;
ALTER TABLE games ADD COLUMN compat_notes TEXT;
ALTER TABLE games ADD COLUMN rom_profile TEXT;
CREATE INDEX IF NOT EXISTS ix_games_rom_hash ON games(rom_hash);
CREATE INDEX IF NOT EXISTS ix_games_favorite ON games(favorite);
