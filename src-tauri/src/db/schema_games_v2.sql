-- =====================================================================
-- Gamelib persistent storage — games domain, v2 migration.
-- =====================================================================
-- Adds emulation linkage columns. `emulator_id` ties a `Game` row back
-- to the emulator that owns it (so deleting the emulator cascades to
-- its ROMs); `rom_path` stores the absolute path to the ROM file that
-- is handed to the emulator as a launch argument.

ALTER TABLE games ADD COLUMN emulator_id TEXT;
ALTER TABLE games ADD COLUMN rom_path TEXT;
CREATE INDEX IF NOT EXISTS ix_games_emulator_id ON games(emulator_id);
