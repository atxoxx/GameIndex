-- =====================================================================
-- Gamelib persistent storage — smart shelves domain (shelves.db).
-- =====================================================================
-- One row per user-defined Smart Shelf: a named, auto-updating query
-- over the library. `rules_json` is a compact JSON object of shelf
-- rules (the same facets the Library filter uses plus numeric / date
-- and mode rules). The membership is always recomputed on the
-- frontend, so only the definition is persisted here.
--
-- `sort` is the shelf's own sort order, applied to the Library when
-- the shelf is activated. `pinned` surfaces the shelf as a Home rail
-- and `position` is the user's drag order in the sidebar.

CREATE TABLE IF NOT EXISTS shelves (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    icon        TEXT NOT NULL DEFAULT 'layers',
    color       TEXT NOT NULL DEFAULT 'accent',
    rules_json  TEXT NOT NULL DEFAULT '{}',
    sort        TEXT NOT NULL DEFAULT 'alphabetical',
    pinned      INTEGER NOT NULL DEFAULT 0,
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_shelves_position ON shelves(position);

-- Completion timestamps, keyed by game id. Kept in this domain rather
-- than on `games` so the games INSERT/REPLACE write path stays untouched;
-- recorded when a game's play status flips to `completed` and read back
-- for the "Completed" shelf rules and sorting.
CREATE TABLE IF NOT EXISTS game_completions (
    game_id      TEXT PRIMARY KEY,
    completed_at INTEGER NOT NULL
);
