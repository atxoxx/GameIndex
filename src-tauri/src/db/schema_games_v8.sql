-- Games domain, v8 migration: user-editable/detected game version string.
ALTER TABLE games ADD COLUMN version TEXT;
