//! Mods DAO.
//!
//! One row per detected/managed mod. Rows are produced by the mods
//! scanner (`crate::mods::detect`) and reconciled on every re-scan:
//! rows whose on-disk artifact disappeared are deleted, while
//! Nexus linkage (`nexus_mod_id`, `latest_version`, …) and user notes
//! survive the replace because the scanner copies them over from the
//! previous row before the transactional swap.

use rusqlite::params;
use serde_json::Value;
use serde::{Deserialize, Serialize};

use super::pool::Db;

/// One managed mod. Mirrors the frontend's `GameMod` shape after
/// serde camelCase rename.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModProfileRow {
    pub id: String,
    pub game_id: String,
    pub name: String,
    pub mod_states: Value,
    pub load_order: Vec<String>,
    pub created_at: u64,
    pub updated_at: u64,
}

/// One managed mod. Mirrors the frontend's GameMod shape after
/// serde camelCase rename.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModRow {
    pub id: String,
    pub game_id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    pub engine: String,
    pub kind: String,
    pub path: String,
    pub enabled: bool,
    pub load_order: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_count: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub md5: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nexus_mod_id: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nexus_domain: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latest_version: Option<String>,
    #[serde(default)]
    pub update_available: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    pub detected_at: u64,
    pub updated_at: u64,
}

/// Per-game modding configuration (detected engine, mods root folder,
/// resolved plugins.txt path, Nexus Mods game domain).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameModSettingsRow {
    pub game_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mods_root: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_root: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub engine: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plugins_txt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nexus_domain: Option<String>,
    pub updated_at: u64,
}

const SELECT_SQL: &str = "SELECT id, game_id, name, version, author, engine, kind, path, enabled, load_order, size_bytes, file_count, md5, nexus_mod_id, nexus_domain, latest_version, update_available, notes, detected_at, updated_at FROM mods";

fn row_from_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<ModRow> {
    Ok(ModRow {
        id: r.get(0)?,
        game_id: r.get(1)?,
        name: r.get(2)?,
        version: r.get(3)?,
        author: r.get(4)?,
        engine: r.get(5)?,
        kind: r.get(6)?,
        path: r.get(7)?,
        enabled: r.get::<_, i64>(8)? != 0,
        load_order: r.get(9)?,
        size_bytes: r.get(10)?,
        file_count: r.get(11)?,
        md5: r.get(12)?,
        nexus_mod_id: r.get(13)?,
        nexus_domain: r.get(14)?,
        latest_version: r.get(15)?,
        update_available: r.get::<_, i64>(16)? != 0,
        notes: r.get(17)?,
        detected_at: r.get::<_, i64>(18)? as u64,
        updated_at: r.get::<_, i64>(19)? as u64,
    })
}

fn bind_insert(conn: &rusqlite::Connection, m: &ModRow) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO mods(
            id, game_id, name, version, author, engine, kind, path,
            enabled, load_order, size_bytes, file_count, md5,
            nexus_mod_id, nexus_domain, latest_version, update_available,
            notes, detected_at, updated_at
        ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20)",
        params![
            m.id,
            m.game_id,
            m.name,
            m.version,
            m.author,
            m.engine,
            m.kind,
            m.path,
            m.enabled as i64,
            m.load_order,
            m.size_bytes,
            m.file_count,
            m.md5,
            m.nexus_mod_id,
            m.nexus_domain,
            m.latest_version,
            m.update_available as i64,
            m.notes,
            m.detected_at as i64,
            m.updated_at as i64,
        ],
    )
    .map_err(|e| format!("mods upsert: {e}"))?;
    Ok(())
}

/// Upsert a single mod row.
pub fn upsert_one(db: &Db, m: &ModRow) -> Result<(), String> {
    let conn = db.mods().map_err(|e| e.to_string())?;
    bind_insert(&conn, m)
}

/// Transactionally replace every mod row of a game with the freshly
/// scanned set (delete + insert). Used by the scanner so a re-scan
/// never leaves stale rows behind.
pub fn replace_for_game(db: &Db, game_id: &str, mods: &[ModRow]) -> Result<(), String> {
    let mut conn = db.mods().map_err(|e| e.to_string())?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("mods tx begin: {e}"))?;
    tx.execute("DELETE FROM mods WHERE game_id = ?1", params![game_id])
        .map_err(|e| format!("mods clear: {e}"))?;
    for m in mods {
        bind_insert(&tx, m)?;
    }
    tx.commit().map_err(|e| format!("mods tx commit: {e}"))?;
    Ok(())
}

/// Every mod of a game, load-order first.
pub fn list_for_game(db: &Db, game_id: &str) -> Result<Vec<ModRow>, String> {
    let conn = db.mods().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(&format!(
            "{SELECT_SQL} WHERE game_id = ?1 ORDER BY load_order, name COLLATE NOCASE"
        ))
        .map_err(|e| format!("mods list prepare: {e}"))?;
    let rows = stmt
        .query_map(params![game_id], row_from_row)
        .map_err(|e| format!("mods list query: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("mods row: {e}"))?);
    }
    Ok(out)
}

/// Single mod by id.
pub fn get(db: &Db, id: &str) -> Result<Option<ModRow>, String> {
    let conn = db.mods().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(&format!("{SELECT_SQL} WHERE id = ?1"))
        .map_err(|e| format!("mods get prepare: {e}"))?;
    let mut rows = stmt
        .query(params![id])
        .map_err(|e| format!("mods get query: {e}"))?;
    if let Some(r) = rows.next().map_err(|e| format!("mods get row: {e}"))? {
        return Ok(Some(
            row_from_row(r).map_err(|e| format!("mods get decode: {e}"))?,
        ));
    }
    Ok(None)
}

/// Delete a mod row by id.
pub fn delete(db: &Db, id: &str) -> Result<(), String> {
    let conn = db.mods().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM mods WHERE id = ?1", params![id])
        .map_err(|e| format!("mods delete: {e}"))?;
    Ok(())
}

/// Aggregated per-game mod counts for the main Mods page overview.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModsOverviewRow {
    pub game_id: String,
    pub total: i64,
    pub enabled: i64,
    pub updates: i64,
    pub engines: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mods_root: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_size_bytes: Option<i64>,
}

/// One overview row per game that has at least one mod row.
pub fn overview(db: &Db) -> Result<Vec<ModsOverviewRow>, String> {
    let conn = db.mods().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT m.game_id,
                    COUNT(*),
                    SUM(m.enabled),
                    SUM(m.update_available),
                    GROUP_CONCAT(DISTINCT m.engine),
                    (SELECT s.mods_root FROM game_mod_settings s WHERE s.game_id = m.game_id),
                    SUM(m.size_bytes)
             FROM mods m GROUP BY m.game_id",
        )
        .map_err(|e| format!("mods overview prepare: {e}"))?;
    let rows = stmt
        .query_map([], |r| {
            Ok(ModsOverviewRow {
                game_id: r.get(0)?,
                total: r.get(1)?,
                enabled: r.get::<_, Option<i64>>(2)?.unwrap_or(0),
                updates: r.get::<_, Option<i64>>(3)?.unwrap_or(0),
                engines: r
                    .get::<_, Option<String>>(4)?
                    .unwrap_or_default()
                    .split(',')
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string())
                    .collect(),
                mods_root: r.get(5)?,
                total_size_bytes: r.get(6)?,
            })
        })
        .map_err(|e| format!("mods overview query: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("mods overview row: {e}"))?);
    }
    Ok(out)
}

pub fn list_profiles(db: &Db, game_id: &str) -> Result<Vec<ModProfileRow>, String> {
    let conn = db.mods()?;
    let mut stmt = conn.prepare("SELECT id, game_id, name, mod_states, COALESCE(load_order, '[]'), created_at, updated_at FROM mod_profiles WHERE game_id = ?1 ORDER BY name COLLATE NOCASE")
        .map_err(|e| format!("profiles prepare: {e}"))?;
    let rows = stmt.query_map(params![game_id], |r| {
        let states: String = r.get(3)?;
        let order: String = r.get(4)?;
        Ok(ModProfileRow { id: r.get(0)?, game_id: r.get(1)?, name: r.get(2)?, mod_states: serde_json::from_str(&states).unwrap_or(Value::Object(Default::default())), load_order: serde_json::from_str(&order).unwrap_or_default(), created_at: r.get::<_, i64>(5)? as u64, updated_at: r.get::<_, i64>(6)? as u64 })
    }).map_err(|e| format!("profiles query: {e}"))?;
    rows.map(|r| r.map_err(|e| format!("profile row: {e}"))).collect()
}

pub fn upsert_profile(db: &Db, p: &ModProfileRow) -> Result<(), String> {
    let conn = db.mods()?;
    conn.execute("INSERT OR REPLACE INTO mod_profiles(id, game_id, name, mod_states, load_order, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7)", params![p.id, p.game_id, p.name, serde_json::to_string(&p.mod_states).map_err(|e| e.to_string())?, serde_json::to_string(&p.load_order).map_err(|e| e.to_string())?, p.created_at as i64, p.updated_at as i64]).map_err(|e| format!("profile upsert: {e}"))?;
    Ok(())
}

pub fn delete_profile(db: &Db, id: &str) -> Result<(), String> {
    let conn = db.mods()?;
    conn.execute("DELETE FROM mod_profiles WHERE id = ?1", params![id]).map_err(|e| format!("profile delete: {e}"))?;
    Ok(())
}

/// Upsert the per-game modding settings row.
pub fn upsert_settings(db: &Db, s: &GameModSettingsRow) -> Result<(), String> {
    let conn = db.mods().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO game_mod_settings(
            game_id, mods_root, custom_root, engine, plugins_txt, nexus_domain, updated_at
        ) VALUES (?1,?2,?3,?4,?5,?6,?7)",
        params![
            s.game_id,
            s.mods_root,
            s.custom_root,
            s.engine,
            s.plugins_txt,
            s.nexus_domain,
            s.updated_at as i64,
        ],
    )
    .map_err(|e| format!("mod settings upsert: {e}"))?;
    Ok(())
}

/// Read the per-game modding settings row, if any.
pub fn get_settings(db: &Db, game_id: &str) -> Result<Option<GameModSettingsRow>, String> {
    let conn = db.mods().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT game_id, mods_root, custom_root, engine, plugins_txt, nexus_domain, updated_at
             FROM game_mod_settings WHERE game_id = ?1",
        )
        .map_err(|e| format!("mod settings prepare: {e}"))?;
    let mut rows = stmt
        .query(params![game_id])
        .map_err(|e| format!("mod settings query: {e}"))?;
    if let Some(r) = rows.next().map_err(|e| format!("mod settings row: {e}"))? {
        return Ok(Some(GameModSettingsRow {
            game_id: r.get(0).map_err(|e| e.to_string())?,
            mods_root: r.get(1).map_err(|e| e.to_string())?,
            custom_root: r.get(2).map_err(|e| e.to_string())?,
            engine: r.get(3).map_err(|e| e.to_string())?,
            plugins_txt: r.get(4).map_err(|e| e.to_string())?,
            nexus_domain: r.get(5).map_err(|e| e.to_string())?,
            updated_at: r.get::<_, i64>(6).map_err(|e| e.to_string())? as u64,
        }));
    }
    Ok(None)
}

/// Every mod across all games.
pub fn list_all_mods(db: &Db) -> Result<Vec<ModRow>, String> {
    let conn = db.mods().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(&format!("{SELECT_SQL} ORDER BY game_id, load_order"))
        .map_err(|e| format!("mods list_all prepare: {e}"))?;
    let rows = stmt
        .query_map([], row_from_row)
        .map_err(|e| format!("mods list_all query: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("mods row: {e}"))?);
    }
    Ok(out)
}

/// Every mod profile across all games.
pub fn list_all_profiles(db: &Db) -> Result<Vec<ModProfileRow>, String> {
    let conn = db.mods()?;
    let mut stmt = conn
        .prepare("SELECT id, game_id, name, mod_states, COALESCE(load_order, '[]'), created_at, updated_at FROM mod_profiles ORDER BY game_id, name")
        .map_err(|e| format!("profiles list_all prepare: {e}"))?;
    let rows = stmt
        .query_map([], |r| {
            let states: String = r.get(3)?;
            let order: String = r.get(4)?;
            Ok(ModProfileRow {
                id: r.get(0)?,
                game_id: r.get(1)?,
                name: r.get(2)?,
                mod_states: serde_json::from_str(&states).unwrap_or(Value::Object(Default::default())),
                load_order: serde_json::from_str(&order).unwrap_or_default(),
                created_at: r.get::<_, i64>(5)? as u64,
                updated_at: r.get::<_, i64>(6)? as u64,
            })
        })
        .map_err(|e| format!("profiles list_all query: {e}"))?;
    rows.map(|r| r.map_err(|e| format!("profile row: {e}"))).collect()
}

/// Every per-game modding settings row.
pub fn list_all_settings(db: &Db) -> Result<Vec<GameModSettingsRow>, String> {
    let conn = db.mods().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT game_id, mods_root, custom_root, engine, plugins_txt, nexus_domain, updated_at FROM game_mod_settings ORDER BY game_id")
        .map_err(|e| format!("mod settings list_all prepare: {e}"))?;
    let rows = stmt
        .query_map([], |r| {
            Ok(GameModSettingsRow {
                game_id: r.get(0)?,
                mods_root: r.get(1)?,
                custom_root: r.get(2)?,
                engine: r.get(3)?,
                plugins_txt: r.get(4)?,
                nexus_domain: r.get(5)?,
                updated_at: r.get::<_, i64>(6)? as u64,
            })
        })
        .map_err(|e| format!("mod settings list_all query: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("mod settings row: {e}"))?);
    }
    Ok(out)
}

#[cfg(test)]

mod tests {
    use super::*;
    use crate::db::schema::MODS_DDL;

    fn test_db() -> (tempfile::TempDir, Db) {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        {
            let c = db.mods().unwrap();
            c.execute_batch(MODS_DDL).unwrap();
        }
        (dir, db)
    }

    fn sample(id: &str, game: &str, order: i64) -> ModRow {
        ModRow {
            id: id.into(),
            game_id: game.into(),
            name: format!("Mod {id}"),
            version: Some("1.0".into()),
            author: None,
            engine: "bethesda".into(),
            kind: "plugin".into(),
            path: format!("C:\\games\\Data\\{id}.esp"),
            enabled: true,
            load_order: order,
            size_bytes: Some(1024),
            file_count: Some(1),
            md5: None,
            nexus_mod_id: None,
            nexus_domain: None,
            latest_version: None,
            update_available: false,
            notes: None,
            detected_at: 100,
            updated_at: 100,
        }
    }

    #[test]
    fn replace_and_list_round_trips() {
        let (_dir, db) = test_db();
        replace_for_game(&db, "g1", &[sample("a", "g1", 1), sample("b", "g1", 0)]).unwrap();
        let all = list_for_game(&db, "g1").unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].id, "b"); // load_order sorted
        replace_for_game(&db, "g1", &[sample("c", "g1", 0)]).unwrap();
        let all = list_for_game(&db, "g1").unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].id, "c");
    }

    #[test]
    fn overview_aggregates_per_game() {
        let (_dir, db) = test_db();
        let mut disabled = sample("a", "g1", 0);
        disabled.enabled = false;
        replace_for_game(&db, "g1", &[disabled, sample("b", "g1", 1)]).unwrap();
        let rows = overview(&db).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].total, 2);
        assert_eq!(rows[0].enabled, 1);
        assert_eq!(rows[0].total_size_bytes, Some(2048));
    }
}
