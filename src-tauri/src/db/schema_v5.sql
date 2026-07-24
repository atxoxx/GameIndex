-- =====================================================================
-- Gamelib persistent storage — v5 schema.
-- =====================================================================
-- Adds launch-orchestration columns to `games`:
--   * pre_launch_script  — script run synchronously before launch
--   * pre_launch_admin   — run that script elevated (UAC)
--   * post_exit_script   — script run after the game process exits
--   * post_exit_admin    — run that script elevated (UAC)
--   * companion_apps_json— JSON array of extra executables launched
--                           alongside the game (each with its own delay)
--
-- `ALTER TABLE … ADD COLUMN` is idempotent at the data level for a
-- fresh install that already went through v1–v4 (the columns simply
-- land last); the migration runner applies this exactly once per
-- install because `schema_version` advances to `v5` after it commits.

ALTER TABLE games ADD COLUMN pre_launch_script TEXT;
ALTER TABLE games ADD COLUMN pre_launch_admin INTEGER;
ALTER TABLE games ADD COLUMN post_exit_script TEXT;
ALTER TABLE games ADD COLUMN post_exit_admin INTEGER;
ALTER TABLE games ADD COLUMN companion_apps_json TEXT;
