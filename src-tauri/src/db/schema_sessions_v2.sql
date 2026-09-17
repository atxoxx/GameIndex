-- =====================================================================
-- Gamelib persistent storage — sessions domain, v2 migration.
-- =====================================================================
-- `list_all` scans ended sessions ordered by `started_at DESC` and
-- `count_all` filters on `ended_at IS NOT NULL`, but the v1 indexes only
-- cover per-game ordering (`ix_sessions_game`) and the active-row lookup
-- (`ix_sessions_active`), so both fall back to a table scan + sort. This
-- partial index serves ended-row ordering directly.

CREATE INDEX IF NOT EXISTS ix_sessions_started ON sessions(started_at DESC) WHERE ended_at IS NOT NULL;
