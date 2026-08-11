-- =====================================================================
-- Gamelib persistent storage — games domain, v5 migration.
-- =====================================================================
-- Per-game opt-in for Steam's launch-action picker. When set, launching
-- the game goes through `steam://launch/<appid>/dialog` so Steam shows
-- its choose-executable/action window (games with a single launch
-- action still launch directly). NULL = default off.

ALTER TABLE games ADD COLUMN show_steam_launch_selection INTEGER;
