//! Big Screen layout preferences (SQLite-backed).
//!
//! The TV shell's layout preset and nav visibility are durable
//! preferences, so they live in the `kv` domain instead of
//! localStorage. The payload is opaque JSON validated on the frontend;
//! this module only guards against runaway writes and a missing row.

use tauri::Manager;

const KEY: &str = "bigscreen.prefs.v1";
/// Generous ceiling for a small object; protects the kv table from a
/// future client bug writing a document into it.
const MAX_BYTES: usize = 8 * 1024;

#[tauri::command]
pub fn bigscreen_prefs_get(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let db = app.state::<crate::db::Db>().inner().clone();
    crate::db::kv::get(&db, KEY)
}

#[tauri::command]
pub fn bigscreen_prefs_set(app: tauri::AppHandle, json: String) -> Result<(), String> {
    if json.len() > MAX_BYTES {
        return Err(format!(
            "bigscreen prefs payload too large ({} > {MAX_BYTES} bytes)",
            json.len()
        ));
    }
    let db = app.state::<crate::db::Db>().inner().clone();
    crate::db::kv::set(&db, KEY, &json)
}

#[tauri::command]
pub fn bigscreen_prefs_clear(app: tauri::AppHandle) -> Result<(), String> {
    let db = app.state::<crate::db::Db>().inner().clone();
    crate::db::kv::delete(&db, KEY)
}
