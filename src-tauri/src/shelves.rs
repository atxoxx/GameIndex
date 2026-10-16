//! Smart Shelves commands.
//!
//! Shelves are persisted in the `shelves` domain DB (see
//! [`crate::db::shelves`]). The frontend evaluates the rules against the
//! in-memory library, so these commands only manage the shelf
//! definitions themselves.

use tauri::Manager;

use crate::db;
use crate::db::shelves::Shelf;

/// Return every shelf in the user's drag order.
#[tauri::command]
pub fn shelves_list(app: tauri::AppHandle) -> Result<Vec<Shelf>, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    db::shelves::list(db_state.inner())
}

/// Insert a new shelf or update an existing one. Returns the normalized
/// row (generated id / created-at, refreshed updated-at) so the frontend
/// can replace its optimistic copy with the saved record.
#[tauri::command]
pub fn shelves_save(app: tauri::AppHandle, shelf: Shelf) -> Result<Shelf, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    db::shelves::upsert(db_state.inner(), shelf)
}

/// Delete one shelf by id. Returns the number of rows removed.
#[tauri::command]
pub fn shelves_delete(app: tauri::AppHandle, id: String) -> Result<u64, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    db::shelves::delete(db_state.inner(), &id)
}

/// Persist a new sidebar drag order (`ids` in display order).
#[tauri::command]
pub fn shelves_reorder(app: tauri::AppHandle, ids: Vec<String>) -> Result<(), String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    db::shelves::reorder(db_state.inner(), &ids)
}

/// Every game id → completion timestamp (unix ms). The frontend uses this
/// to satisfy "Completed" shelf rules and the "Recently completed" sort.
#[tauri::command]
pub fn shelves_completions(app: tauri::AppHandle) -> Result<Vec<(String, u64)>, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    db::shelves::completions(db_state.inner())
}

/// Mark a game completed at `completed_at` (unix ms), or clear it when
/// `completed_at` is 0.
#[tauri::command]
pub fn shelves_set_completion(
    app: tauri::AppHandle,
    game_id: String,
    completed_at: u64,
) -> Result<(), String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    if completed_at == 0 {
        db::shelves::clear_completed_at(db_state.inner(), &game_id)
    } else {
        db::shelves::set_completed_at(db_state.inner(), &game_id, completed_at)
    }
}
