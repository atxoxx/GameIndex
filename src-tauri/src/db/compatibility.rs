//! Compatibility layer DAO.
//!
//! Stores global Wine/Proton/Linux runner configuration and per-game
//! runner overrides in a dedicated, isolated `compatibility.db` file.

use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::params;
use serde_json::Value;

use super::pool::Db;

const GLOBAL_SETTINGS_ID: &str = "global";

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Retrieve the raw JSON string for global compatibility settings.
pub fn get_global_settings(db: &Db) -> Result<Option<String>, String> {
    let conn = db.compatibility().map_err(|e| format!("compatibility conn: {e}"))?;
    let mut stmt = conn
        .prepare("SELECT settings_json FROM compatibility_settings WHERE id = ?1")
        .map_err(|e| format!("compatibility settings prepare: {e}"))?;
    let mut rows = stmt
        .query(params![GLOBAL_SETTINGS_ID])
        .map_err(|e| format!("compatibility settings query: {e}"))?;
    if let Some(row) = rows.next().map_err(|e| format!("compatibility settings row: {e}"))? {
        let v: String = row.get(0).map_err(|e| format!("compatibility settings col: {e}"))?;
        return Ok(Some(v));
    }
    Ok(None)
}

/// Save the raw JSON string for global compatibility settings.
pub fn set_global_settings(db: &Db, settings_json: &str) -> Result<(), String> {
    let conn = db.compatibility().map_err(|e| format!("compatibility conn: {e}"))?;
    conn.execute(
        "INSERT INTO compatibility_settings(id, settings_json, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(id) DO UPDATE SET
             settings_json = excluded.settings_json,
             updated_at = excluded.updated_at",
        params![GLOBAL_SETTINGS_ID, settings_json, unix_now() as i64],
    )
    .map_err(|e| format!("compatibility set_global_settings: {e}"))?;
    Ok(())
}

/// Retrieve per-game compatibility profile as serde_json::Value.
pub fn get_for_game(db: &Db, game_id: &str) -> Result<Option<Value>, String> {
    let conn = db.compatibility().map_err(|e| format!("compatibility conn: {e}"))?;
    let mut stmt = conn
        .prepare("SELECT config_json FROM game_compatibility WHERE game_id = ?1")
        .map_err(|e| format!("game compatibility prepare: {e}"))?;
    let mut rows = stmt
        .query(params![game_id])
        .map_err(|e| format!("game compatibility query: {e}"))?;
    if let Some(row) = rows.next().map_err(|e| format!("game compatibility row: {e}"))? {
        let raw: String = row.get(0).map_err(|e| format!("game compatibility col: {e}"))?;
        let parsed = serde_json::from_str::<Value>(&raw)
            .map_err(|e| format!("parse game compatibility JSON for {game_id}: {e}"))?;
        return Ok(Some(parsed));
    }
    Ok(None)
}

/// Upsert per-game compatibility profile.
pub fn upsert_for_game(db: &Db, game_id: &str, config: &Value) -> Result<(), String> {
    let raw = serde_json::to_string(config)
        .map_err(|e| format!("serialize game compatibility for {game_id}: {e}"))?;
    let now = unix_now() as i64;
    let conn = db.compatibility().map_err(|e| format!("compatibility conn: {e}"))?;
    conn.execute(
        "INSERT INTO game_compatibility(game_id, config_json, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?3)
         ON CONFLICT(game_id) DO UPDATE SET
             config_json = excluded.config_json,
             updated_at = excluded.updated_at",
        params![game_id, raw, now],
    )
    .map_err(|e| format!("upsert_for_game: {e}"))?;
    Ok(())
}

/// Delete per-game compatibility profile.
pub fn delete_for_game(db: &Db, game_id: &str) -> Result<(), String> {
    let conn = db.compatibility().map_err(|e| format!("compatibility conn: {e}"))?;
    conn.execute("DELETE FROM game_compatibility WHERE game_id = ?1", params![game_id])
        .map_err(|e| format!("delete_for_game: {e}"))?;
    Ok(())
}

/// List all per-game compatibility profiles keyed by game_id.
pub fn list_all_for_games(db: &Db) -> Result<HashMap<String, Value>, String> {
    let conn = db.compatibility().map_err(|e| format!("compatibility conn: {e}"))?;
    let mut stmt = conn
        .prepare("SELECT game_id, config_json FROM game_compatibility")
        .map_err(|e| format!("list_all_for_games prepare: {e}"))?;
    let rows = stmt
        .query_map([], |r| {
            let gid: String = r.get(0)?;
            let raw: String = r.get(1)?;
            Ok((gid, raw))
        })
        .map_err(|e| format!("list_all_for_games query_map: {e}"))?;

    let mut out = HashMap::new();
    for row in rows {
        if let Ok((gid, raw)) = row {
            if let Ok(v) = serde_json::from_str::<Value>(&raw) {
                out.insert(gid, v);
            }
        }
    }
    Ok(out)
}

/// Batch upsert per-game compatibility profiles in a single transaction.
pub fn upsert_batch_for_games(db: &Db, items: &[(String, Value)]) -> Result<(), String> {
    if items.is_empty() {
        return Ok(());
    }
    let mut conn = db.compatibility().map_err(|e| format!("compatibility conn: {e}"))?;
    let tx = conn.transaction().map_err(|e| format!("tx: {e}"))?;
    let now = unix_now() as i64;
    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO game_compatibility(game_id, config_json, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?3)
                 ON CONFLICT(game_id) DO UPDATE SET
                     config_json = excluded.config_json,
                     updated_at = excluded.updated_at",
            )
            .map_err(|e| format!("prepare batch: {e}"))?;

        for (gid, config) in items {
            if let Ok(raw) = serde_json::to_string(config) {
                let _ = stmt.execute(params![gid, raw, now]);
            }
        }
    }
    tx.commit().map_err(|e| format!("tx commit: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compatibility_crud_and_batch_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        crate::db::migrate::run_migrations(&db).unwrap();

        // 1. Global settings
        assert_eq!(get_global_settings(&db).unwrap(), None);
        set_global_settings(&db, r#"{"enableDxvk":true}"#).unwrap();
        let global = get_global_settings(&db).unwrap();
        assert_eq!(global.as_deref(), Some(r#"{"enableDxvk":true}"#));

        // 2. Per-game single upsert
        let sample_profile = serde_json::json!({
            "enabled": true,
            "runnerType": "proton"
        });
        upsert_for_game(&db, "game-1", &sample_profile).unwrap();
        let got = get_for_game(&db, "game-1").unwrap().unwrap();
        assert_eq!(got["enabled"], true);
        assert_eq!(got["runnerType"], "proton");

        // 3. Batch upsert & list_all
        let batch = vec![
            ("game-2".to_string(), serde_json::json!({"enabled": false})),
            ("game-3".to_string(), serde_json::json!({"runnerType": "ge-proton"})),
        ];
        upsert_batch_for_games(&db, &batch).unwrap();

        let all = list_all_for_games(&db).unwrap();
        assert_eq!(all.len(), 3);
        assert!(all.contains_key("game-1"));
        assert!(all.contains_key("game-2"));
        assert!(all.contains_key("game-3"));

        // 4. Delete
        delete_for_game(&db, "game-1").unwrap();
        assert_eq!(get_for_game(&db, "game-1").unwrap(), None);
        let all_after = list_all_for_games(&db).unwrap();
        assert_eq!(all_after.len(), 2);
    }
}

