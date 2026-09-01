-- =====================================================================
-- Gamelib persistent storage — emulators domain, v2 migration.
-- =====================================================================
-- ROM-management extensions: an optional BIOS folder used by
-- `check_bios_status` to validate required firmware, an optional saves
-- folder scanned for per-ROM save files / backups, and an auto-scan
-- flag so configured ROM folders are re-scanned automatically when the
-- watcher detects changes (no manual rescan needed).

ALTER TABLE emulators ADD COLUMN bios_folder TEXT NOT NULL DEFAULT '';
ALTER TABLE emulators ADD COLUMN saves_folder TEXT NOT NULL DEFAULT '';
ALTER TABLE emulators ADD COLUMN auto_scan INTEGER NOT NULL DEFAULT 0;
