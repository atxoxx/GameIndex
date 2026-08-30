//! Session history commands.

use tauri::Manager;
use crate::db;

/// Return the most recent finished session for a single game (newest
/// first, limited to 1). Used by the launch splash to show accurate
/// "Last Played" info from the canonical SQLite session history.
#[tauri::command]
pub fn get_last_session_for_game(
    app: tauri::AppHandle,
    game_id: String,
) -> Result<Vec<db::sessions::SessionRecord>, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let sessions = db::sessions::list_for_game(db_state.inner(), &game_id)?;
    Ok(sessions.into_iter().take(1).collect())
}

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

/// Return every finished session from the SQLite `sessions` table
/// (newest first). This is the canonical session history the Activity
/// dashboard reads — no JSON file, crash-safe, append-only.
#[tauri::command]
pub fn get_sessions(app: tauri::AppHandle) -> Result<Vec<db::sessions::SessionRecord>, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    db::sessions::list_all(db_state.inner())
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

