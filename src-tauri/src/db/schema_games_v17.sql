-- Append-only migration for the games domain (v17):
-- Mod Organizer 2 launch settings for a single game. `mo2_launch_enabled`
-- routes the play button through MO2 instead of the raw executable,
-- `mo2_profile` names the MO2 profile to run, `mo2_executable` the
-- executable MO2 should launch, and `mo2_instance_path` the MO2 portable
-- instance root. NULL = MO2 not configured for this game.
-- Read-back lives in `game_row_from_row` and writes in the INSERT
-- statements of `upsert_batch` / `upsert_one`; keep all three in sync.
ALTER TABLE games ADD COLUMN mo2_launch_enabled INTEGER;
ALTER TABLE games ADD COLUMN mo2_profile TEXT;
ALTER TABLE games ADD COLUMN mo2_executable TEXT;
ALTER TABLE games ADD COLUMN mo2_instance_path TEXT;
