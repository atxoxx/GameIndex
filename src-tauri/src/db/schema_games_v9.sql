-- Games domain, v9 migration: per-game compatibility & runner profile (JSON).
ALTER TABLE games ADD COLUMN compatibility_json TEXT;
