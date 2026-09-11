//! Game-notes commands.
//!
//! Notes are persisted per game in the `game_notes` domain DB (see
//! [`crate::db::game_notes`]). The frontend Notes tab is the only
//! writer; the legacy single-string `games.notes` column is migrated
//! into a real note by the frontend on first load (it clears the old
//! field afterwards so the migration runs once).

use tauri::Manager;

use crate::db;
use crate::db::game_notes::GameNote;

/// Return every note for a game (pinned first, newest-updated next).
#[tauri::command]
pub fn load_game_notes(app: tauri::AppHandle, game_id: String) -> Result<Vec<GameNote>, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    db::game_notes::list_for_game(db_state.inner(), &game_id)
}

/// Insert a new note or update an existing one. Returns the normalized
/// row (generated id / created-at, refreshed updated-at) so the
/// frontend can replace its optimistic draft with the saved record.
#[tauri::command]
pub fn save_game_note(app: tauri::AppHandle, note: GameNote) -> Result<GameNote, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    db::game_notes::upsert(db_state.inner(), note)
}

/// Delete one note by id. Returns the number of rows removed.
#[tauri::command]
pub fn delete_game_note(app: tauri::AppHandle, id: String) -> Result<u64, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    db::game_notes::delete(db_state.inner(), &id)
}

/// Delete every note for a game (used when a game is removed from the
/// library). Returns the number of rows removed.
#[tauri::command]
pub fn delete_game_notes_for_game(
    app: tauri::AppHandle,
    game_id: String,
) -> Result<u64, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    db::game_notes::delete_for_game(db_state.inner(), &game_id)
}
