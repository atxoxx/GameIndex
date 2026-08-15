// upcoming `ActivityPage` history drill-down invocation paths.
#![allow(dead_code)]

//! Sessions DAO.
//!
//! One row per game-session. Today the React frontend keeps the
//! canonical copy of the session history in `localStorage`
//! (`gamelib-sessions`). With Phase 3 the backend writes one row per
//! `game-exited` event. Phase 5 (deferred) will switch the
//! frontend to read from this table instead.
//!
//! Why write the row even though the frontend keeps its own copy?
//! - Single source of truth for the backend integrations (Settings
//!   page activity stats, future history exports).
//! - Crash-safe (atomic SQL inserts; no half-written JSON).

use rusqlite::params;

use super::pool::Db;

// DAO helpers (`list_for_game`, `count_all`) are part of the
// future Phase-5 frontend migration off localStorage session
// history. Module-level allow preserves the API surface for the
/// Insert one finished-session row.
///
/// `metrics_json` carries the serialised `SessionMetrics` payload
/// (`None` ⇒ the row's NULL-safe columns stay 0 — older snapshots
/// may not have a metrics blob yet). All averages default to 0 if
/// the watcher reports `None` for the field.
pub fn insert(
    db: &Db,
    game_id: &str,
    game_name: &str,
    started_at_ms: u64,
    ended_at_ms: u64,
    elapsed_seconds: u64,
    avg_fps: Option<f32>,
    avg_cpu: Option<f32>,
    avg_gpu: Option<f32>,
    avg_ram: Option<f32>,
    metrics_json: Option<&str>,
) -> Result<i64, String> {
    let conn = db.sessions().map_err(|e| format!("sessions conn: {e}"))?;
    conn.execute(
        "INSERT INTO sessions(
            game_id, game_name, started_at, ended_at, elapsed_seconds,
            avg_fps, avg_cpu, avg_gpu, avg_ram, metrics_json
         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        params![
            game_id,
            game_name,
            started_at_ms as i64,
            ended_at_ms as i64,
            elapsed_seconds as i64,
            avg_fps.map(|n| n as f64),
            avg_cpu.map(|n| n as f64),
            avg_gpu.map(|n| n as f64),
            avg_ram.map(|n| n as f64),
            metrics_json,
        ],
    )
    .map_err(|e| format!("sessions insert: {e}"))?;
    Ok(conn.last_insert_rowid())
}

/// Insert or refresh the durable in-progress row (`ended_at IS NULL`) for
/// a running session. Created on the first heartbeat and refreshed with
/// the latest elapsed seconds on each subsequent one, so a crash (of the
/// game or of GameIndex itself) loses at most one heartbeat's worth of
/// playtime instead of the whole session.
///
/// One in-progress row per game — the watcher already guarantees a single
/// active session per `game_id`, so the `ended_at IS NULL` row is
/// unambiguous.
pub fn upsert_running(
    db: &Db,
    game_id: &str,
    game_name: &str,
    started_at_ms: u64,
    elapsed_seconds: u64,
) -> Result<(), String> {
    let conn = db.sessions().map_err(|e| format!("sessions conn: {e}"))?;
    let updated = conn
        .execute(
            "UPDATE sessions
                SET started_at = ?1, game_name = ?2, elapsed_seconds = ?3
              WHERE game_id = ?4 AND ended_at IS NULL",
            params![
                started_at_ms as i64,
                game_name,
                elapsed_seconds as i64,
                game_id,
            ],
        )
        .map_err(|e| format!("sessions upsert_running: {e}"))?;
    if updated == 0 {
        conn.execute(
            "INSERT INTO sessions(game_id, game_name, started_at, ended_at, elapsed_seconds)
             VALUES (?1, ?2, ?3, NULL, ?4)",
            params![game_id, game_name, started_at_ms as i64, elapsed_seconds as i64],
        )
        .map_err(|e| format!("sessions upsert_running insert: {e}"))?;
    }
    Ok(())
}

/// Finalize a session: turn the durable in-progress row (if the heartbeat
/// ever created one) into the finished row, otherwise insert a fresh
/// finished row. Keeps exactly one row per session whether or not the
/// heartbeat ran (short sessions end before the first 30 s heartbeat).
#[allow(clippy::too_many_arguments)]
pub fn finalize(
    db: &Db,
    game_id: &str,
    game_name: &str,
    started_at_ms: u64,
    ended_at_ms: u64,
    elapsed_seconds: u64,
    avg_fps: Option<f32>,
    avg_cpu: Option<f32>,
    avg_gpu: Option<f32>,
    avg_ram: Option<f32>,
    metrics_json: Option<&str>,
) -> Result<(), String> {
    let conn = db.sessions().map_err(|e| format!("sessions conn: {e}"))?;
    let updated = conn
        .execute(
            "UPDATE sessions
                SET started_at = ?1, game_name = ?2, ended_at = ?3, elapsed_seconds = ?4,
                    avg_fps = ?5, avg_cpu = ?6, avg_gpu = ?7, avg_ram = ?8, metrics_json = ?9
              WHERE game_id = ?10 AND ended_at IS NULL",
            params![
                started_at_ms as i64,
                game_name,
                ended_at_ms as i64,
                elapsed_seconds as i64,
                avg_fps.map(|n| n as f64),
                avg_cpu.map(|n| n as f64),
                avg_gpu.map(|n| n as f64),
                avg_ram.map(|n| n as f64),
                metrics_json,
                game_id,
            ],
        )
        .map_err(|e| format!("sessions finalize: {e}"))?;
    if updated == 0 {
        insert(
            db,
            game_id,
            game_name,
            started_at_ms,
            ended_at_ms,
            elapsed_seconds,
            avg_fps,
            avg_cpu,
            avg_gpu,
            avg_ram,
            metrics_json,
        )?;
    }
    Ok(())
}

/// Close orphaned in-progress rows left behind by a crash on a previous
/// run. Their `elapsed_seconds` holds the last heartbeat value, so credit
/// that partial playtime by back-dating `ended_at` from `started_at`.
/// Zero-elapsed rows (crashed before the first heartbeat) are deleted
/// instead of becoming phantom zero-second sessions. Returns the number
/// of rows finalized.
pub fn finalize_orphaned_running(db: &Db) -> Result<u64, String> {
    let conn = db.sessions().map_err(|e| format!("sessions conn: {e}"))?;
    conn.execute(
        "DELETE FROM sessions
          WHERE ended_at IS NULL AND (elapsed_seconds IS NULL OR elapsed_seconds <= 0)",
        [],
    )
    .map_err(|e| format!("sessions orphan delete: {e}"))?;
    conn.execute(
        "UPDATE sessions
            SET ended_at = started_at + elapsed_seconds * 1000
          WHERE ended_at IS NULL",
        [],
    )
    .map(|n| n as u64)
    .map_err(|e| format!("sessions orphan finalize: {e}"))
}

/// Return the most-recent N sessions across all games (newest
/// first).
pub fn list_recent(db: &Db, limit: u32) -> Result<Vec<SessionRecord>, String> {
    let conn = db.sessions().map_err(|e| format!("sessions conn: {e}"))?;
    let mut stmt = conn
        .prepare(
            "SELECT id, game_id, started_at, ended_at, elapsed_seconds,
                    avg_fps, avg_cpu, avg_gpu, avg_ram, metrics_json, game_name
                FROM sessions
               WHERE ended_at IS NOT NULL
               ORDER BY started_at DESC
               LIMIT ?1",
        )
        .map_err(|e| format!("sessions list prepare: {e}"))?;
    let rows = stmt
        .query_map(params![limit as i64], |r| {
            Ok(SessionRecord {
                id: r.get::<_, i64>(0)?,
                game_id: r.get(1)?,
                started_at_ms: r.get::<_, i64>(2)? as u64,
                ended_at_ms: r.get::<_, Option<i64>>(3)?.map(|n| n as u64),
                elapsed_seconds: r.get::<_, Option<i64>>(4)?.map(|n| n as u64),
                avg_fps: r.get::<_, Option<f64>>(5)?.map(|f| f as f32),
                avg_cpu: r.get::<_, Option<f64>>(6)?.map(|f| f as f32),
                avg_gpu: r.get::<_, Option<f64>>(7)?.map(|f| f as f32),
                avg_ram: r.get::<_, Option<f64>>(8)?.map(|f| f as f32),
                metrics_json: r.get(9)?,
                game_name: r.get(10)?,
            })
        })
        .map_err(|e| format!("sessions list query: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("sessions row: {e}"))?);
    }
    Ok(out)
}

/// Return every session for a single game.
pub fn list_for_game(db: &Db, game_id: &str) -> Result<Vec<SessionRecord>, String> {
    let conn = db.sessions().map_err(|e| format!("sessions conn: {e}"))?;
    let mut stmt = conn
        .prepare(
            "SELECT id, game_id, started_at, ended_at, elapsed_seconds,
                    avg_fps, avg_cpu, avg_gpu, avg_ram, metrics_json, game_name
                FROM sessions
               WHERE game_id = ?1 AND ended_at IS NOT NULL
               ORDER BY started_at DESC",
        )
        .map_err(|e| format!("sessions list_for_game prepare: {e}"))?;
    let rows = stmt
        .query_map(params![game_id], |r| {
            Ok(SessionRecord {
                id: r.get::<_, i64>(0)?,
                game_id: r.get(1)?,
                started_at_ms: r.get::<_, i64>(2)? as u64,
                ended_at_ms: r.get::<_, Option<i64>>(3)?.map(|n| n as u64),
                elapsed_seconds: r.get::<_, Option<i64>>(4)?.map(|n| n as u64),
                avg_fps: r.get::<_, Option<f64>>(5)?.map(|f| f as f32),
                avg_cpu: r.get::<_, Option<f64>>(6)?.map(|f| f as f32),
                avg_gpu: r.get::<_, Option<f64>>(7)?.map(|f| f as f32),
                avg_ram: r.get::<_, Option<f64>>(8)?.map(|f| f as f32),
                metrics_json: r.get(9)?,
                game_name: r.get(10)?,
            })
        })
        .map_err(|e| format!("sessions list_for_game query: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("sessions row: {e}"))?);
    }
    Ok(out)
}

/// Library-wide session count (for the home dashboard).
pub fn count_all(db: &Db) -> Result<u64, String> {
    let conn = db.sessions().map_err(|e| format!("sessions conn: {e}"))?;
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sessions WHERE ended_at IS NOT NULL",
            [],
            |r| r.get(0),
        )
        .map_err(|e| format!("sessions count: {e}"))?;
    Ok(n.max(0) as u64)
}

/// Return every session across all games (newest first). Used by the
/// frontend Activity dashboard, which keeps the full history in memory
/// for aggregation. Pagination is unnecessary here — the dataset is
/// bounded by real playtime and SQLite returns it in well under a ms.
pub fn list_all(db: &Db) -> Result<Vec<SessionRecord>, String> {
    let conn = db.sessions().map_err(|e| format!("sessions conn: {e}"))?;
    let mut stmt = conn
        .prepare(
            "SELECT id, game_id, started_at, ended_at, elapsed_seconds,
                    avg_fps, avg_cpu, avg_gpu, avg_ram, metrics_json, game_name
                FROM sessions
               WHERE ended_at IS NOT NULL
               ORDER BY started_at DESC",
        )
        .map_err(|e| format!("sessions list_all prepare: {e}"))?;
    let rows = stmt
        .query_map([], |r| {
            Ok(SessionRecord {
                id: r.get::<_, i64>(0)?,
                game_id: r.get(1)?,
                started_at_ms: r.get::<_, i64>(2)? as u64,
                ended_at_ms: r.get::<_, Option<i64>>(3)?.map(|n| n as u64),
                elapsed_seconds: r.get::<_, Option<i64>>(4)?.map(|n| n as u64),
                avg_fps: r.get::<_, Option<f64>>(5)?.map(|f| f as f32),
                avg_cpu: r.get::<_, Option<f64>>(6)?.map(|f| f as f32),
                avg_gpu: r.get::<_, Option<f64>>(7)?.map(|f| f as f32),
                avg_ram: r.get::<_, Option<f64>>(8)?.map(|f| f as f32),
                metrics_json: r.get(9)?,
                game_name: r.get(10)?,
            })
        })
        .map_err(|e| format!("sessions list_all query: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("sessions row: {e}"))?);
    }
    Ok(out)
}

/// Delete a single session row by its primary key. Returns the number
/// of rows removed (0 if the id didn't exist).
pub fn delete(db: &Db, id: i64) -> Result<u64, String> {
    let conn = db.sessions().map_err(|e| format!("sessions conn: {e}"))?;
    let n = conn
        .execute("DELETE FROM sessions WHERE id = ?1", params![id])
        .map_err(|e| format!("sessions delete: {e}"))?;
    Ok(n as u64)
}

/// Delete every session row for a game (the Activity dashboard
/// "delete entry" action). Returns the number of rows removed (0 if
/// the game had no sessions).
pub fn delete_for_game(db: &Db, game_id: &str) -> Result<u64, String> {
    let conn = db.sessions().map_err(|e| format!("sessions conn: {e}"))?;
    let n = conn
        .execute("DELETE FROM sessions WHERE game_id = ?1", params![game_id])
        .map_err(|e| format!("sessions delete_for_game: {e}"))?;
    Ok(n as u64)
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SessionRecord {
    pub id: i64,
    #[serde(rename = "gameId")]
    pub game_id: String,
    #[serde(rename = "gameName", skip_serializing_if = "Option::is_none")]
    pub game_name: Option<String>,
    #[serde(rename = "startedAt")]
    pub started_at_ms: u64,
    #[serde(rename = "endedAt", skip_serializing_if = "Option::is_none")]
    pub ended_at_ms: Option<u64>,
    #[serde(rename = "elapsedSeconds", skip_serializing_if = "Option::is_none")]
    pub elapsed_seconds: Option<u64>,
    #[serde(rename = "avgFps", skip_serializing_if = "Option::is_none")]
    pub avg_fps: Option<f32>,
    #[serde(rename = "avgCpu", skip_serializing_if = "Option::is_none")]
    pub avg_cpu: Option<f32>,
    #[serde(rename = "avgGpu", skip_serializing_if = "Option::is_none")]
    pub avg_gpu: Option<f32>,
    #[serde(rename = "avgRam", skip_serializing_if = "Option::is_none")]
    pub avg_ram: Option<f32>,
    #[serde(rename = "metricsJson", skip_serializing_if = "Option::is_none")]
    pub metrics_json: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn delete_for_game_removes_only_that_games_sessions() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        super::super::migrate::run_migrations(&db).unwrap();

        // Two sessions for game "a", one for game "b".
        insert(&db, "a", "Game A", 1000, 2000, 10, None, None, None, None, None).unwrap();
        insert(&db, "a", "Game A", 3000, 4000, 10, None, None, None, None, None).unwrap();
        insert(&db, "b", "Game B", 5000, 6000, 10, None, None, None, None, None).unwrap();

        let n = delete_for_game(&db, "a").unwrap();
        assert_eq!(n, 2);
        assert_eq!(list_for_game(&db, "a").unwrap().len(), 0);
        assert_eq!(list_for_game(&db, "b").unwrap().len(), 1);
        assert_eq!(count_all(&db).unwrap(), 1);

        // Idempotent: no rows left for "a".
        assert_eq!(delete_for_game(&db, "a").unwrap(), 0);
    }

    #[test]
    fn upsert_running_then_finalize_produces_one_row() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        super::super::migrate::run_migrations(&db).unwrap();

        // First heartbeat creates the in-progress row.
        upsert_running(&db, "g", "Game", 1000, 30).unwrap();
        // Second heartbeat updates it in place — still one row.
        upsert_running(&db, "g", "Game", 1000, 60).unwrap();

        // In-progress rows must not surface in the finished-session lists.
        assert_eq!(list_for_game(&db, "g").unwrap().len(), 0);

        // Finalize converts the running row into the finished row.
        finalize(&db, "g", "Game", 1000, 106_000, 60, None, None, None, None, None).unwrap();

        let rows = list_for_game(&db, "g").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].elapsed_seconds, Some(60));
        assert_eq!(rows[0].ended_at_ms, Some(106_000));
        assert_eq!(count_all(&db).unwrap(), 1);
    }

    #[test]
    fn finalize_without_running_row_inserts() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        super::super::migrate::run_migrations(&db).unwrap();

        // Short session that ended before the first heartbeat — no running row.
        finalize(&db, "g", "Game", 1000, 3000, 2, None, None, None, None, None).unwrap();
        assert_eq!(list_for_game(&db, "g").unwrap().len(), 1);
    }

    #[test]
    fn finalize_orphaned_running_credits_partial_playtime() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        super::super::migrate::run_migrations(&db).unwrap();

        // Two orphans: one with real elapsed, one zero-elapsed
        // (crashed before the first heartbeat).
        upsert_running(&db, "a", "Game A", 1000, 90).unwrap();
        upsert_running(&db, "b", "Game B", 2000, 0).unwrap();

        let finalized = finalize_orphaned_running(&db).unwrap();
        assert_eq!(finalized, 1, "only the non-zero orphan is back-dated");

        let rows = list_all(&db).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].game_id, "a");
        assert_eq!(rows[0].ended_at_ms, Some(1000 + 90 * 1000));
    }
}
