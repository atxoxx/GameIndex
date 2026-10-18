//! Session history commands.

use serde::Serialize;
use tauri::Manager;
use crate::db;
use crate::metrics_collector::{MetricsSamplePoint, SessionMetrics};

/// Migration helper: read the legacy `<app_data_dir>/sessions.json`
/// blob (the pre-SQLite session store). Returns "[]" when the file does
/// not exist. The frontend imports any rows found here into the
/// `sessions` table on first launch after the migration, then stops
/// touching the file.
#[tauri::command]
pub fn load_sessions(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = dir.join("sessions.json");
    if !path.exists() {
        return Ok("[]".to_string());
    }
    std::fs::read_to_string(&path).map_err(|e| format!("load_sessions: {e}"))
}

/// The per-sample telemetry is stripped inside SQLite (`json_remove`,
/// see `db::sessions::list_all_light`) so the resident history is small;
/// charts pull samples on demand via `get_session_samples`.
///
/// Async + spawn_blocking: the resident query scans the whole table and
/// decodes per-row telemetry blobs; sync command bodies run inline on
/// the GTK main thread (see the note on `crate::games::save_games`).
#[tauri::command]
pub async fn get_sessions(app: tauri::AppHandle) -> Result<Vec<db::sessions::SessionRecord>, String> {
    let db = app.state::<db::Db>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || db::sessions::list_all_light(&db))
        .await
        .map_err(|e| format!("get_sessions task: {e}"))?
}

/// One session's per-sample telemetry, returned by `get_session_samples`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSamples {
    pub id: i64,
    pub samples: Vec<MetricsSamplePoint>,
}

/// Fetch the per-sample telemetry for a set of sessions. Sessions without
/// recorded samples (or with an unparsable blob) are simply omitted, so the
/// caller can treat a missing id as "no curves available".
#[tauri::command]
pub fn get_session_samples(
    app: tauri::AppHandle,
    ids: Vec<i64>,
) -> Result<Vec<SessionSamples>, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let mut out = Vec::new();
    for (id, json) in db::sessions::metrics_json_many(db_state.inner(), &ids)? {
        if let Ok(metrics) = serde_json::from_str::<SessionMetrics>(&json) {
            if !metrics.samples.is_empty() {
                out.push(SessionSamples { id, samples: metrics.samples });
            }
        }
    }
    Ok(out)
}

/// Delete a single session row by id (Activity dashboard "remove").
#[tauri::command]
pub fn delete_session(app: tauri::AppHandle, id: i64) -> Result<u64, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    db::sessions::delete(db_state.inner(), id)
}

/// Delete every session row for a game (Activity dashboard
/// "delete entry" — removes the game's entire play history).
/// Returns the number of rows removed.
#[tauri::command]
pub fn delete_sessions_for_game(app: tauri::AppHandle, game_id: String) -> Result<u64, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    db::sessions::delete_for_game(db_state.inner(), &game_id)
}

/// Re-link all session rows for a game to another game_id and game_name
/// (used to associate unlinked activity entries with a library game).
#[tauri::command]
pub fn relink_sessions_for_game(
    app: tauri::AppHandle,
    old_game_id: String,
    new_game_id: String,
    new_game_name: String,
) -> Result<u64, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    db::sessions::relink_game(db_state.inner(), &old_game_id, &new_game_id, &new_game_name)
}

/// Insert one session row. Used by the one-time migration that imports
/// the legacy `sessions.json` history into SQLite; not called during
/// normal play (the watcher's `finish_session` is the live writer).
#[tauri::command]
pub fn insert_session(
    app: tauri::AppHandle,
    game_id: String,
    game_name: String,
    started_at_ms: u64,
    elapsed_seconds: u64,
    avg_fps: Option<f32>,
    avg_cpu: Option<f32>,
    avg_gpu: Option<f32>,
    avg_ram: Option<f32>,
    metrics_json: Option<String>,
) -> Result<i64, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let ended_at_ms = started_at_ms.saturating_add(elapsed_seconds.saturating_mul(1000));
    db::sessions::insert(
        db_state.inner(),
        &game_id,
        &game_name,
        started_at_ms,
        ended_at_ms,
        elapsed_seconds,
        avg_fps,
        avg_cpu,
        avg_gpu,
        avg_ram,
        metrics_json.as_deref(),
    )
}

#[cfg(test)]
mod tests {
    #[test]
    fn list_all_light_strips_samples_in_sql() {
        let dir = tempfile::tempdir().unwrap();
        let db = crate::db::Db::open(dir.path()).unwrap();
        {
            let conn = db.sessions().unwrap();
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    game_id TEXT NOT NULL,
                    started_at INTEGER NOT NULL,
                    ended_at INTEGER,
                    elapsed_seconds INTEGER,
                    avg_fps REAL,
                    avg_cpu REAL,
                    avg_gpu REAL,
                    avg_ram REAL,
                    metrics_json TEXT,
                    game_name TEXT
                );",
            )
            .unwrap();
            conn.execute(
                "INSERT INTO sessions (game_id, started_at, ended_at, metrics_json, game_name)
                 VALUES (?, ?, ?, ?, ?)",
                rusqlite::params![
                    "g1",
                    1i64,
                    2i64,
                    r#"{"avgFps":60,"samples":[{"t":0.0}]}"#,
                    "Game"
                ],
            )
            .unwrap();
        }
        let rows = crate::db::sessions::list_all_light(&db).unwrap();
        assert_eq!(rows.len(), 1);
        let value: serde_json::Value =
            serde_json::from_str(rows[0].metrics_json.as_deref().unwrap_or("")).unwrap();
        assert!(value.get("samples").is_none());
        assert_eq!(value.get("avgFps").and_then(|v| v.as_f64()), Some(60.0));
    }
}

