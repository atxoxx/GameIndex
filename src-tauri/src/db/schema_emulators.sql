-- =====================================================================
-- Gamelib persistent storage — emulators domain (emulators.db).
-- =====================================================================
-- One row per configured emulator instance. Each emulator is linked to
-- exactly one ROM folder; scanning that folder produces `Game` rows
-- (in games.db) tagged with `emulator_id` so they can be cleaned up
-- when the emulator is removed.

CREATE TABLE IF NOT EXISTS emulators (
    id                  TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    platform            TEXT NOT NULL,
    executable_path     TEXT NOT NULL DEFAULT '',
    arguments_template  TEXT NOT NULL DEFAULT '%ROM%',
    rom_folder          TEXT NOT NULL DEFAULT '',
    notes               TEXT,
    icon_url            TEXT,
    created_at          INTEGER NOT NULL,
    updated_at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_emulators_platform ON emulators(platform);
