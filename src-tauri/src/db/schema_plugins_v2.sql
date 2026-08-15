-- =====================================================================
-- Gamelib persistent storage — plugins domain, v2 migration.
-- =====================================================================
-- Adds a broad platform class to each installed plugin so the download
-- modal can filter results between PC games and console ROMs. Values:
--   'pc'      — PC games / repacks
--   'console' — console ROMs / emulator titles
--   'hybrid'  — meta-search engines covering both
-- Declared by the plugin manifest's `platformCategory` field; the
-- plugin manager normalises the stored value on install/backfill.
-- Legacy rows default to '' and are treated as 'pc' at read time.

ALTER TABLE plugins ADD COLUMN platform_category TEXT NOT NULL DEFAULT '';
