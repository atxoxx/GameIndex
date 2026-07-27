//! Emulators DAO.
//!
//! One row per configured emulator instance. Each emulator is linked
//! to exactly one ROM folder; scanning that folder produces `Game`
//! rows (in games.db) tagged with `emulator_id`. Deleting an emulator
//! cascades to its ROMs via [`super::games::delete_by_emulator`].

use rusqlite::params;
use serde::{Deserialize, Serialize};

use super::pool::Db;

/// Subset of `lib.rs::EmulatorData` we persist via the DAO. Mirrors the
/// frontend's `Emulator` shape after serde camelCase rename.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmulatorRow {
    pub id: String,
    pub name: String,
    pub platform: String,
    pub executable_path: String,
    pub arguments_template: String,
    pub rom_folder: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_url: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
}

const SELECT_SQL: &str = "SELECT id, name, platform, executable_path, arguments_template, rom_folder, notes, icon_url, created_at, updated_at FROM emulators";

/// Upsert a single emulator (INSERT OR REPLACE on `id`).
pub fn upsert_one(db: &Db, r: &EmulatorRow) -> Result<(), String> {
    let conn = db.emulators().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO emulators(
            id, name, platform, executable_path, arguments_template,
            rom_folder, notes, icon_url, created_at, updated_at
        ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        params![
            r.id,
            r.name,
            r.platform,
            r.executable_path,
            r.arguments_template,
            r.rom_folder,
            r.notes,
            r.icon_url,
            r.created_at as i64,
            r.updated_at as i64,
        ],
    )
    .map_err(|e| format!("emulators upsert_one: {e}"))?;
    Ok(())
}

/// Read every emulator, ordered by name.
pub fn list_all(db: &Db) -> Result<Vec<EmulatorRow>, String> {
    let conn = db.emulators().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(&format!("{SELECT_SQL} ORDER BY name COLLATE NOCASE"))
        .map_err(|e| format!("emulators list prepare: {e}"))?;
    let rows = stmt
        .query_map([], row_from_row)
        .map_err(|e| format!("emulators list query: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("emulators row: {e}"))?);
    }
    Ok(out)
}

/// Read a single emulator by id.
pub fn get(db: &Db, id: &str) -> Result<Option<EmulatorRow>, String> {
    let conn = db.emulators().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(&format!("{SELECT_SQL} WHERE id = ?1"))
        .map_err(|e| format!("emulators get prepare: {e}"))?;
    let mut rows = stmt
        .query(params![id])
        .map_err(|e| format!("emulators get query: {e}"))?;
    if let Some(r) = rows.next().map_err(|e| format!("emulators get row: {e}"))? {
        return Ok(Some(row_from_row(r).map_err(|e| format!("emulators get decode: {e}"))?));
    }
    Ok(None)
}

/// Delete an emulator by id.
pub fn delete(db: &Db, id: &str) -> Result<(), String> {
    let conn = db.emulators().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM emulators WHERE id = ?1", params![id])
        .map_err(|e| format!("emulators delete: {e}"))?;
    Ok(())
}

fn row_from_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<EmulatorRow> {
    Ok(EmulatorRow {
        id: r.get(0)?,
        name: r.get(1)?,
        platform: r.get(2)?,
        executable_path: r.get(3)?,
        arguments_template: r.get(4)?,
        rom_folder: r.get(5)?,
        notes: r.get(6)?,
        icon_url: r.get(7)?,
        created_at: r.get::<_, i64>(8)? as u64,
        updated_at: r.get::<_, i64>(9)? as u64,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::{EMULATORS_DDL, GAMES_DDL};

    fn test_db() -> (tempfile::TempDir, Db) {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        {
            let c = db.emulators().unwrap();
            c.execute_batch(EMULATORS_DDL).unwrap();
            let g = db.games().unwrap();
            g.execute_batch(GAMES_DDL).unwrap();
        }
        (dir, db)
    }

    #[test]
    fn upsert_and_list_round_trips() {
        let (_dir, db) = test_db();
        let row = EmulatorRow {
            id: "emu-dolphin".into(),
            name: "Dolphin".into(),
            platform: "GameCube".into(),
            executable_path: "C:\\emu\\dolphin.exe".into(),
            arguments_template: "\"%ROM%\"".into(),
            rom_folder: "C:\\roms\\gc".into(),
            notes: Some("my gc".into()),
            icon_url: None,
            created_at: 1000,
            updated_at: 2000,
        };
        upsert_one(&db, &row).unwrap();
        let all = list_all(&db).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].platform, "GameCube");
        assert_eq!(all[0].notes.as_deref(), Some("my gc"));
    }
}
