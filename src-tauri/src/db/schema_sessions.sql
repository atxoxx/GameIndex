-- =====================================================================
-- Gamelib persistent storage — sessions domain (sessions.db).
-- =====================================================================
-- One row per finished or in-progress game session. `end_ts` is NULL
-- for the active row. `metrics_json` holds the full
-- `SessionMetrics` payload as compact JSON so we don't lose any
-- fields when the watcher adds new ones.
--
-- `game_name` (v4) is denormalized so the Activity dashboard can
-- group / rank by name without a JOIN back to `games`.

CREATE TABLE IF NOT EXISTS sessions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id       TEXT NOT NULL,
    started_at    INTEGER NOT NULL,         -- unix ms — UI-friendly granularity
    ended_at      INTEGER,
    elapsed_seconds INTEGER,                -- denormalized for quick aggregates
    avg_fps       REAL,
    avg_cpu       REAL,
    avg_gpu       REAL,
    avg_ram       REAL,
    metrics_json  TEXT
);
CREATE INDEX IF NOT EXISTS ix_sessions_game   ON sessions(game_id, started_at DESC);
CREATE INDEX IF NOT EXISTS ix_sessions_active ON sessions(ended_at) WHERE ended_at IS NULL;

-- v4: human-readable game name so grouping doesn't need a JOIN to games.
ALTER TABLE sessions ADD COLUMN game_name TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS ix_sessions_game_name ON sessions(game_name);
