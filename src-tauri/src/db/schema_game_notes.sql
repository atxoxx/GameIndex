-- =====================================================================
-- Gamelib persistent storage — game notes domain (game_notes.db).
-- =====================================================================
-- One row per user-authored note / guide attached to a library game.
-- `content` is Markdown (rendered client-side); `tags_json` is a
-- compact JSON array of free-form tag strings. `pinned` floats a note
-- to the top of the list. Timestamps are unix milliseconds so the
-- frontend can show relative times without a conversion table.

CREATE TABLE IF NOT EXISTS game_notes (
    id          TEXT PRIMARY KEY,
    game_id     TEXT NOT NULL,
    title       TEXT NOT NULL DEFAULT '',
    content     TEXT NOT NULL DEFAULT '',
    tags_json   TEXT NOT NULL DEFAULT '[]',
    pinned      INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_game_notes_game ON game_notes(game_id, pinned DESC, updated_at DESC);
