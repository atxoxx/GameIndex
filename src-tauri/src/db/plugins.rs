//! Plugins DAO.
//!
//! One row per user-installed JS search plugin. The plugin source file
//! lives at `<app_data_dir>/plugins/<id>.js`; this table is the
//! bookkeeping side (manifest, sha256, enabled flag, last sandbox
//! failure). The heavy lifting — eval, sandbox, HTTP — happens in
//! [`crate::plugins`]; this module only persists and reads rows.
//!
//! The `enabled` bit is the runtime toggle consulted by
//! `search_downloads`: a disabled plugin is not loaded into memory and
//! never runs.

use rusqlite::params;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};

use super::pool::Db;

/// One installed plugin. Snake-case fields; serialized to the frontend
/// with camelCase names (the `plugins_list` command maps rows onto
/// `PluginInfo` which carries the same field set).
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PluginRow {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub description: String,
    pub source_url: String,
    /// sha256 hex of the installed `<id>.js` file.
    pub file_hash: String,
    /// Absolute path to the installed copy under `<app_data_dir>/plugins`.
    pub file_path: String,
    pub enabled: bool,
    /// Unix seconds of install.
    pub imported_at: u64,
    pub last_error: Option<String>,
}

const SELECT_SQL: &str = "SELECT id, name, version, author, description, source_url,
                                 file_hash, file_path, enabled, imported_at, last_error
                            FROM plugins";

fn row_from_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<PluginRow> {
    Ok(PluginRow {
        id: r.get(0)?,
        name: r.get(1)?,
        version: r.get(2)?,
        author: r.get(3)?,
        description: r.get(4)?,
        source_url: r.get(5)?,
        file_hash: r.get(6)?,
        file_path: r.get(7)?,
        enabled: r.get::<_, i64>(8)? != 0,
        imported_at: r.get::<_, i64>(9)? as u64,
        last_error: r.get(10)?,
    })
}

/// Every installed plugin row.
pub fn list_plugins(db: &Db) -> Result<Vec<PluginRow>, String> {
    let conn = db.plugins().map_err(|e| format!("plugins conn: {e}"))?;
    let mut stmt = conn
        .prepare(&format!("{SELECT_SQL} ORDER BY name COLLATE NOCASE"))
        .map_err(|e| format!("plugins list prepare: {e}"))?;
    let rows = stmt
        .query_map([], row_from_row)
        .map_err(|e| format!("plugins list query: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("plugins row: {e}"))?);
    }
    Ok(out)
}

/// One plugin row by id, or `None` when the id isn't installed.
pub fn get_plugin(db: &Db, id: &str) -> Result<Option<PluginRow>, String> {
    let conn = db.plugins().map_err(|e| format!("plugins conn: {e}"))?;
    conn.query_row(&format!("{SELECT_SQL} WHERE id = ?1"), params![id], row_from_row)
        .optional()
        .map_err(|e| format!("plugins get {id}: {e}"))
}

/// Insert or update a plugin row (id is the primary key).
pub fn upsert_plugin(db: &Db, plugin: &PluginRow) -> Result<(), String> {
    let conn = db.plugins().map_err(|e| format!("plugins conn: {e}"))?;
    conn.execute(
        "INSERT INTO plugins(
            id, name, version, author, description, source_url,
            file_hash, file_path, enabled, imported_at, last_error
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT(id) DO UPDATE SET
            name        = excluded.name,
            version     = excluded.version,
            author      = excluded.author,
            description = excluded.description,
            source_url  = excluded.source_url,
            file_hash   = excluded.file_hash,
            file_path   = excluded.file_path,
            enabled     = excluded.enabled,
            imported_at = excluded.imported_at,
            last_error  = excluded.last_error",
        params![
            plugin.id,
            plugin.name,
            plugin.version,
            plugin.author,
            plugin.description,
            plugin.source_url,
            plugin.file_hash,
            plugin.file_path,
            plugin.enabled as i64,
            plugin.imported_at as i64,
            plugin.last_error,
        ],
    )
    .map_err(|e| format!("plugins upsert: {e}"))?;
    Ok(())
}

/// Delete a plugin row. Idempotent — missing ids are a no-op.
pub fn remove_plugin(db: &Db, id: &str) -> Result<(), String> {
    let conn = db.plugins().map_err(|e| format!("plugins conn: {e}"))?;
    conn.execute("DELETE FROM plugins WHERE id = ?1", params![id])
        .map_err(|e| format!("plugins delete {id}: {e}"))?;
    Ok(())
}

/// Set the `enabled` bit (does not touch the in-memory source map —
/// the manager does that when toggling).
pub fn set_plugin_enabled(db: &Db, id: &str, enabled: bool) -> Result<(), String> {
    let conn = db.plugins().map_err(|e| format!("plugins conn: {e}"))?;
    conn.execute(
        "UPDATE plugins SET enabled = ?1 WHERE id = ?2",
        params![enabled as i64, id],
    )
    .map_err(|e| format!("plugins enable {id}: {e}"))?;
    Ok(())
}

/// Record the most recent sandbox / eval / search failure, or clear it
/// (`None`) after a successful install / validation.
pub fn set_plugin_error(db: &Db, id: &str, error: Option<&str>) -> Result<(), String> {
    let conn = db.plugins().map_err(|e| format!("plugins conn: {e}"))?;
    conn.execute(
        "UPDATE plugins SET last_error = ?1 WHERE id = ?2",
        params![error, id],
    )
    .map_err(|e| format!("plugins error {id}: {e}"))?;
    Ok(())
}
