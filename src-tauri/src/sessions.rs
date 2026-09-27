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

/// Strip the `samples` array from a serialised `SessionMetrics` blob so the
/// history list stays compact. Returns the input untouched when it isn't
/// valid JSON (better a larger payload than a dropped row).
fn strip_metrics_samples(metrics_json: Option<String>) -> Option<String> {
    let raw = metrics_json?;
    let Ok(mut value) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return Some(raw);
    };
    if let Some(obj) = value.as_object_mut() {
        obj.remove("samples");
    }
    Some(serde_json::to_string(&value).unwrap_or(raw))
}

/// Return every finished session from the SQLite `sessions` table
/// (newest first). This is the canonical session history the Activity
/// dashboard reads — no JSON file, crash-safe, append-only.
///
/// The per-sample telemetry is stripped from `metrics_json` (summary
/// averages, min/max, resolution are kept) so the resident history is small;
/// charts pull samples on demand via `get_session_samples`.
#[tauri::command]
pub fn get_sessions(app: tauri::AppHandle) -> Result<Vec<db::sessions::SessionRecord>, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let mut rows = db::sessions::list_all(db_state.inner())?;
    for row in rows.iter_mut() {
        row.metrics_json = strip_metrics_samples(row.metrics_json.take());
    }
    Ok(rows)
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
    let db = db_state.inner();
    let mut out = Vec::new();
    for id in ids {
        let Some(json) = db::sessions::metrics_json_for(db, id)? else {
            continue;
        };
        if let Ok(metrics) = serde_json::from_str::<SessionMetrics>(&json) {
            if !metrics.samples.is_empty() {
                out.push(SessionSamples {
                    id,
                    samples: metrics.samples,
                });
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
    use super::strip_metrics_samples;

    #[test]
    fn strip_metrics_samples_removes_the_series_only() {
        let json =
            r#"{"avgFps":60,"avgCpuUsage":12,"samples":[{"t":0.0,"cpu":12.0}]}"#.to_string();
        let out = strip_metrics_samples(Some(json)).unwrap();
        let value: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert!(value.get("samples").is_none());
        assert_eq!(value.get("avgFps").and_then(|v| v.as_f64()), Some(60.0));
    }

    #[test]
    fn strip_metrics_samples_passes_through_none_and_invalid_json() {
        assert!(strip_metrics_samples(None).is_none());
        let bad = "not json".to_string();
        assert_eq!(strip_metrics_samples(Some(bad.clone())), Some(bad));
    }
}

