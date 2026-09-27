-- schema_games_v12.sql
-- Append-only migration for the games domain:
-- Adds a user-chosen display name shown across the UI in place of the
-- real `name`. Purely presentational — the stored `name` keeps driving
-- metadata matching, sync identity and launch resolution.
ALTER TABLE games ADD COLUMN display_name TEXT;
