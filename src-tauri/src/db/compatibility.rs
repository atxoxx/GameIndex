//! Compatibility layer DAO.
//!
//! Stores global Wine/Proton/Linux runner configuration and per-game
//! runner overrides in a dedicated, isolated `compatibility.db` file.

use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::pool::Db;

const GLOBAL_SETTINGS_ID: &str = "global";

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// One row of `compatibility_settings` (raw global settings JSON).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompatibilitySettingsRow {
    pub id: String,
    pub settings_json: String,
    pub updated_at: u64,
}

/// One row of `game_compatibility` (per-game override JSON).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameCompatibilityRow {
    pub game_id: String,
    pub config_json: String,
    pub created_at: u64,
    pub updated_at: u64,
}

/// One row of `compatibility_runners`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompatibilityRunnerRow {
    pub id: String,
    pub name: String,
    pub path: String,
    pub kind: String,
    pub version: Option<String>,
    pub is_proton: bool,
    pub created_at: u64,
    pub updated_at: u64,
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

/// List every raw row of `compatibility_settings` (including timestamps).
pub fn list_global_settings_rows(db: &Db) -> Result<Vec<CompatibilitySettingsRow>, String> {
    let conn = db.compatibility().map_err(|e| format!("compatibility conn: {e}"))?;
    let mut stmt = conn
        .prepare("SELECT id, settings_json, updated_at FROM compatibility_settings")
        .map_err(|e| format!("list global settings prepare: {e}"))?;
    let rows = stmt
        .query_map([], |r| {
            Ok(CompatibilitySettingsRow {
                id: r.get(0)?,
                settings_json: r.get(1)?,
                updated_at: r.get::<_, i64>(2)?.max(0) as u64,
            })
        })
        .map_err(|e| format!("list global settings query: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("list global settings row: {e}"))
}

/// Upsert one raw `compatibility_settings` row, preserving its timestamp.
pub fn upsert_settings_row(db: &Db, row: &CompatibilitySettingsRow) -> Result<(), String> {
    let conn = db.compatibility().map_err(|e| format!("compatibility conn: {e}"))?;
    conn.execute(
        "INSERT INTO compatibility_settings(id, settings_json, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(id) DO UPDATE SET
             settings_json = excluded.settings_json,
             updated_at = excluded.updated_at",
        params![row.id, row.settings_json, row.updated_at as i64],
    )
    .map_err(|e| format!("upsert settings row: {e}"))?;
    Ok(())
}

/// List every raw row of `game_compatibility` (including timestamps).
pub fn list_game_rows(db: &Db) -> Result<Vec<GameCompatibilityRow>, String> {
    let conn = db.compatibility().map_err(|e| format!("compatibility conn: {e}"))?;
    let mut stmt = conn
        .prepare("SELECT game_id, config_json, created_at, updated_at FROM game_compatibility")
        .map_err(|e| format!("list game compatibility prepare: {e}"))?;
    let rows = stmt
        .query_map([], |r| {
            Ok(GameCompatibilityRow {
                game_id: r.get(0)?,
                config_json: r.get(1)?,
                created_at: r.get::<_, i64>(2)?.max(0) as u64,
                updated_at: r.get::<_, i64>(3)?.max(0) as u64,
            })
        })
        .map_err(|e| format!("list game compatibility query: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("list game compatibility row: {e}"))
}

/// Upsert one raw `game_compatibility` row, preserving its timestamps.
pub fn upsert_game_row(db: &Db, row: &GameCompatibilityRow) -> Result<(), String> {
    let conn = db.compatibility().map_err(|e| format!("compatibility conn: {e}"))?;
    conn.execute(
        "INSERT INTO game_compatibility(game_id, config_json, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(game_id) DO UPDATE SET
             config_json = excluded.config_json,
             updated_at = excluded.updated_at",
        params![
            row.game_id,
            row.config_json,
            row.created_at as i64,
            row.updated_at as i64
        ],
    )
    .map_err(|e| format!("upsert game row: {e}"))?;
    Ok(())
}

/// List every registered compatibility runner.
pub fn list_runners(db: &Db) -> Result<Vec<CompatibilityRunnerRow>, String> {
    let conn = db.compatibility().map_err(|e| format!("compatibility conn: {e}"))?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, path, kind, version, is_proton, created_at, updated_at
             FROM compatibility_runners",
        )
        .map_err(|e| format!("list runners prepare: {e}"))?;
    let rows = stmt
        .query_map([], |r| {
            Ok(CompatibilityRunnerRow {
                id: r.get(0)?,
                name: r.get(1)?,
                path: r.get(2)?,
                kind: r.get(3)?,
                version: r.get(4)?,
                is_proton: r.get::<_, i64>(5)? != 0,
                created_at: r.get::<_, i64>(6)?.max(0) as u64,
                updated_at: r.get::<_, i64>(7)?.max(0) as u64,
            })
        })
        .map_err(|e| format!("list runners query: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("list runners row: {e}"))
}

/// Upsert one compatibility runner, preserving its timestamps.
pub fn upsert_runner(db: &Db, row: &CompatibilityRunnerRow) -> Result<(), String> {
    let conn = db.compatibility().map_err(|e| format!("compatibility conn: {e}"))?;
    conn.execute(
        "INSERT INTO compatibility_runners(
             id, name, path, kind, version, is_proton, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             path = excluded.path,
             kind = excluded.kind,
             version = excluded.version,
             is_proton = excluded.is_proton,
             updated_at = excluded.updated_at",
        params![
            row.id,
            row.name,
            row.path,
            row.kind,
            row.version,
            row.is_proton as i64,
            row.created_at as i64,
            row.updated_at as i64
        ],
    )
    .map_err(|e| format!("upsert runner: {e}"))?;
    Ok(())
}

/// Remove every compatibility settings row, per-game override and runner.
pub fn clear_all(db: &Db) -> Result<(), String> {
    let conn = db.compatibility().map_err(|e| format!("compatibility conn: {e}"))?;
    conn.execute("DELETE FROM compatibility_settings", [])
        .map_err(|e| format!("clear compatibility_settings: {e}"))?;
    conn.execute("DELETE FROM game_compatibility", [])
        .map_err(|e| format!("clear game_compatibility: {e}"))?;
    conn.execute("DELETE FROM compatibility_runners", [])
        .map_err(|e| format!("clear compatibility_runners: {e}"))?;
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

    #[test]
    fn raw_rows_roundtrip_and_clear_all() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        crate::db::migrate::run_migrations(&db).unwrap();

        let settings = CompatibilitySettingsRow {
            id: "global".into(),
            settings_json: r#"{"enableDxvk":true}"#.into(),
            updated_at: 111,
        };
        upsert_settings_row(&db, &settings).unwrap();
        let listed = list_global_settings_rows(&db).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].settings_json, settings.settings_json);
        assert_eq!(listed[0].updated_at, 111);

        let profile = GameCompatibilityRow {
            game_id: "game-9".into(),
            config_json: r#"{"enabled":true}"#.into(),
            created_at: 222,
            updated_at: 333,
        };
        upsert_game_row(&db, &profile).unwrap();
        let profiles = list_game_rows(&db).unwrap();
        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0].game_id, "game-9");
        assert_eq!(profiles[0].created_at, 222);
        assert_eq!(profiles[0].updated_at, 333);

        let runner = CompatibilityRunnerRow {
            id: "proton-ge".into(),
            name: "GE-Proton".into(),
            path: "/opt/proton".into(),
            kind: "ge-proton".into(),
            version: Some("9-20".into()),
            is_proton: true,
            created_at: 444,
            updated_at: 555,
        };
        upsert_runner(&db, &runner).unwrap();
        let runners = list_runners(&db).unwrap();
        assert_eq!(runners.len(), 1);
        assert_eq!(runners[0].version.as_deref(), Some("9-20"));
        assert!(runners[0].is_proton);

        clear_all(&db).unwrap();
        assert!(list_global_settings_rows(&db).unwrap().is_empty());
        assert!(list_game_rows(&db).unwrap().is_empty());
        assert!(list_runners(&db).unwrap().is_empty());
    }
}

