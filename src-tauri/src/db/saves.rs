//! Save-backup DAO.
//!
//! Two tables (see `schema_saves.sql`): `save_locations` holds the
//! folders/files that make up a game's save data, and `save_backups`
//! is the index of snapshots taken of them. The snapshot payload
//! itself lives on disk under the configured backup folder — this DAO
//! only tracks the metadata the UI needs to list, diff and restore.
//!
//! Timestamps are unix milliseconds so the frontend can render relative
//! times with the same helpers it uses everywhere else.

use rusqlite::params;
use serde::{Deserialize, Serialize};

use super::game_notes::unix_now_ms;
use super::pool::Db;

/// One discovered or user-added save location.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveLocation {
    #[serde(default)]
    pub id: String,
    pub game_id: String,
    /// Absolute path to a folder or file.
    pub path: String,
    /// Human label shown in the UI (defaults to the folder name).
    #[serde(default)]
    pub label: String,
    /// `"dir"` or `"file"`.
    #[serde(default = "default_kind")]
    pub kind: String,
    /// How the location was found: `curated | heuristic | steam | emulator | pcgamingwiki | manual`.
    #[serde(default = "default_source")]
    pub source: String,
    /// Whether this location participates in backups.
    #[serde(default = "default_true")]
    pub include: bool,
    #[serde(default)]
    pub created_at: u64,
    #[serde(default)]
    pub updated_at: u64,
    #[serde(default)]
    pub last_backup_at: Option<u64>,
    #[serde(default)]
    pub last_restore_at: Option<u64>,
}

fn default_kind() -> String {
    "dir".to_string()
}
fn default_source() -> String {
    "manual".to_string()
}
fn default_true() -> bool {
    true
}

/// One backup snapshot in the index.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveBackup {
    #[serde(default)]
    pub id: String,
    pub game_id: String,
    #[serde(default)]
    pub game_name: String,
    #[serde(default)]
    pub created_at: u64,
    /// `manual | auto-exit | pre-restore`.
    #[serde(default = "default_manual")]
    pub kind: String,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub location_count: u32,
    #[serde(default)]
    pub file_count: u64,
    #[serde(default)]
    pub total_bytes: u64,
    /// `complete | partial | failed`.
    #[serde(default = "default_complete")]
    pub status: String,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub root_path: String,
    #[serde(default)]
    pub manifest_path: String,
}

fn default_manual() -> String {
    "manual".to_string()
}
fn default_complete() -> String {
    "complete".to_string()
}

const LOCATION_COLS: &str = "id, game_id, path, label, kind, source, include, created_at, updated_at, last_backup_at, last_restore_at";
const BACKUP_COLS: &str = "id, game_id, game_name, created_at, kind, note, location_count, file_count, total_bytes, status, error, root_path, manifest_path";

fn location_from_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<SaveLocation> {
    Ok(SaveLocation {
        id: r.get(0)?,
        game_id: r.get(1)?,
        path: r.get(2)?,
        label: r.get(3)?,
        kind: r.get(4)?,
        source: r.get(5)?,
        include: r.get::<_, i64>(6)? != 0,
        created_at: r.get::<_, i64>(7)?.max(0) as u64,
        updated_at: r.get::<_, i64>(8)?.max(0) as u64,
        last_backup_at: r.get::<_, Option<i64>>(9)?.map(|v| v.max(0) as u64),
        last_restore_at: r.get::<_, Option<i64>>(10)?.map(|v| v.max(0) as u64),
    })
}

fn backup_from_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<SaveBackup> {
    Ok(SaveBackup {
        id: r.get(0)?,
        game_id: r.get(1)?,
        game_name: r.get(2)?,
        created_at: r.get::<_, i64>(3)?.max(0) as u64,
        kind: r.get(4)?,
        note: r.get(5)?,
        location_count: r.get::<_, i64>(6)?.max(0) as u32,
        file_count: r.get::<_, i64>(7)?.max(0) as u64,
        total_bytes: r.get::<_, i64>(8)?.max(0) as u64,
        status: r.get(9)?,
        error: r.get(10)?,
        root_path: r.get(11)?,
        manifest_path: r.get(12)?,
    })
}

/// List every location for one game (newest-first is irrelevant here;
/// creation order keeps manual + detected entries stable between scans).
pub fn list_locations(db: &Db, game_id: &str) -> Result<Vec<SaveLocation>, String> {
    let conn = db.saves().map_err(|e| format!("saves conn: {e}"))?;
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {LOCATION_COLS} FROM save_locations WHERE game_id = ?1 ORDER BY created_at, id"
        ))
        .map_err(|e| format!("saves list_locations prepare: {e}"))?;
    let rows = stmt
        .query_map(params![game_id], location_from_row)
        .map_err(|e| format!("saves list_locations query: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("saves location row: {e}"))?);
    }
    Ok(out)
}

/// List every location across the library.
pub fn list_all_locations(db: &Db) -> Result<Vec<SaveLocation>, String> {
    let conn = db.saves().map_err(|e| format!("saves conn: {e}"))?;
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {LOCATION_COLS} FROM save_locations ORDER BY game_id, created_at, id"
        ))
        .map_err(|e| format!("saves list_all_locations prepare: {e}"))?;
    let rows = stmt
        .query_map([], location_from_row)
        .map_err(|e| format!("saves list_all_locations query: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("saves location row: {e}"))?);
    }
    Ok(out)
}

/// Insert or update a location (keyed by `id`; a blank id is generated).
pub fn upsert_location(db: &Db, mut loc: SaveLocation) -> Result<SaveLocation, String> {
    let now = unix_now_ms();
    if loc.id.trim().is_empty() {
        loc.id = format!("loc-{now}-{}", rand_suffix());
    }
    if loc.created_at == 0 {
        loc.created_at = now;
    }
    loc.updated_at = now;
    let conn = db.saves().map_err(|e| format!("saves conn: {e}"))?;
    conn.execute(
        "INSERT INTO save_locations(id, game_id, path, label, kind, source, include, created_at, updated_at, last_backup_at, last_restore_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)
         ON CONFLICT(id) DO UPDATE SET
             path           = excluded.path,
             label          = excluded.label,
             kind           = excluded.kind,
             source         = excluded.source,
             include        = excluded.include,
             updated_at     = excluded.updated_at,
             last_backup_at = excluded.last_backup_at,
             last_restore_at= excluded.last_restore_at",
        params![
            loc.id,
            loc.game_id,
            loc.path,
            loc.label,
            loc.kind,
            loc.source,
            loc.include as i64,
            loc.created_at as i64,
            loc.updated_at as i64,
            loc.last_backup_at.map(|v| v as i64),
            loc.last_restore_at.map(|v| v as i64),
        ],
    )
    .map_err(|e| format!("saves upsert_location: {e}"))?;
    Ok(loc)
}

/// Delete one location by id. Idempotent.
pub fn delete_location(db: &Db, id: &str) -> Result<u64, String> {
    let conn = db.saves().map_err(|e| format!("saves conn: {e}"))?;
    conn.execute("DELETE FROM save_locations WHERE id = ?1", params![id])
        .map(|n| n as u64)
        .map_err(|e| format!("saves delete_location: {e}"))
}

/// Delete every location for a game.
pub fn delete_locations_for_game(db: &Db, game_id: &str) -> Result<u64, String> {
    let conn = db.saves().map_err(|e| format!("saves conn: {e}"))?;
    conn.execute("DELETE FROM save_locations WHERE game_id = ?1", params![game_id])
        .map(|n| n as u64)
        .map_err(|e| format!("saves delete_locations_for_game: {e}"))
}

/// Find a location for a game by path (used to de-dupe detection runs).
/// Matching is case-insensitive so Windows paths don't duplicate.
pub fn find_location_by_path(
    db: &Db,
    game_id: &str,
    path: &str,
) -> Result<Option<SaveLocation>, String> {
    let target = path.to_lowercase();
    Ok(list_locations(db, game_id)?
        .into_iter()
        .find(|l| l.path.to_lowercase() == target))
}

/// List backups, optionally scoped to a game. Newest first.
pub fn list_backups(db: &Db, game_id: Option<&str>) -> Result<Vec<SaveBackup>, String> {
    let conn = db.saves().map_err(|e| format!("saves conn: {e}"))?;
    let mut out = Vec::new();
    match game_id {
        Some(gid) => {
            let mut stmt = conn
                .prepare(&format!(
                    "SELECT {BACKUP_COLS} FROM save_backups WHERE game_id = ?1 ORDER BY created_at DESC"
                ))
                .map_err(|e| format!("saves list_backups prepare: {e}"))?;
            let rows = stmt
                .query_map(params![gid], backup_from_row)
                .map_err(|e| format!("saves list_backups query: {e}"))?;
            for row in rows {
                out.push(row.map_err(|e| format!("saves backup row: {e}"))?);
            }
        }
        None => {
            let mut stmt = conn
                .prepare(&format!(
                    "SELECT {BACKUP_COLS} FROM save_backups ORDER BY created_at DESC"
                ))
                .map_err(|e| format!("saves list_backups prepare: {e}"))?;
            let rows = stmt
                .query_map([], backup_from_row)
                .map_err(|e| format!("saves list_backups query: {e}"))?;
            for row in rows {
                out.push(row.map_err(|e| format!("saves backup row: {e}"))?);
            }
        }
    }
    Ok(out)
}

/// Fetch a single backup row.
pub fn get_backup(db: &Db, id: &str) -> Result<Option<SaveBackup>, String> {
    let conn = db.saves().map_err(|e| format!("saves conn: {e}"))?;
    let mut stmt = conn
        .prepare(&format!("SELECT {BACKUP_COLS} FROM save_backups WHERE id = ?1"))
        .map_err(|e| format!("saves get_backup prepare: {e}"))?;
    let mut rows = stmt
        .query_map(params![id], backup_from_row)
        .map_err(|e| format!("saves get_backup query: {e}"))?;
    match rows.next() {
        Some(row) => Ok(Some(row.map_err(|e| format!("saves get_backup row: {e}"))?)),
        None => Ok(None),
    }
}

/// Insert a backup index row (keyed by `id`).
pub fn insert_backup(db: &Db, mut b: SaveBackup) -> Result<SaveBackup, String> {
    let now = unix_now_ms();
    if b.id.trim().is_empty() {
        b.id = format!("bak-{now}-{}", rand_suffix());
    }
    if b.created_at == 0 {
        b.created_at = now;
    }
    let conn = db.saves().map_err(|e| format!("saves conn: {e}"))?;
    conn.execute(
        "INSERT OR REPLACE INTO save_backups(id, game_id, game_name, created_at, kind, note, location_count, file_count, total_bytes, status, error, root_path, manifest_path)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
        params![
            b.id,
            b.game_id,
            b.game_name,
            b.created_at as i64,
            b.kind,
            b.note,
            b.location_count as i64,
            b.file_count as i64,
            b.total_bytes as i64,
            b.status,
            b.error,
            b.root_path,
            b.manifest_path,
        ],
    )
    .map_err(|e| format!("saves insert_backup: {e}"))?;
    Ok(b)
}

/// Delete one backup index row. Idempotent.
pub fn delete_backup(db: &Db, id: &str) -> Result<u64, String> {
    let conn = db.saves().map_err(|e| format!("saves conn: {e}"))?;
    conn.execute("DELETE FROM save_backups WHERE id = ?1", params![id])
        .map(|n| n as u64)
        .map_err(|e| format!("saves delete_backup: {e}"))
}

/// Delete every backup index row for a game.
pub fn delete_backups_for_game(db: &Db, game_id: &str) -> Result<u64, String> {
    let conn = db.saves().map_err(|e| format!("saves conn: {e}"))?;
    conn.execute("DELETE FROM save_backups WHERE game_id = ?1", params![game_id])
        .map(|n| n as u64)
        .map_err(|e| format!("saves delete_backups_for_game: {e}"))
}

/// Stamp a location as just backed up.
pub fn touch_location_backup(db: &Db, id: &str, at_ms: u64) -> Result<(), String> {
    let conn = db.saves().map_err(|e| format!("saves conn: {e}"))?;
    conn.execute(
        "UPDATE save_locations SET last_backup_at = ?2, updated_at = ?2 WHERE id = ?1",
        params![id, at_ms as i64],
    )
    .map(|_| ())
    .map_err(|e| format!("saves touch_location_backup: {e}"))
}

/// Stamp a location as just restored.
pub fn touch_location_restore(db: &Db, id: &str, at_ms: u64) -> Result<(), String> {
    let conn = db.saves().map_err(|e| format!("saves conn: {e}"))?;
    conn.execute(
        "UPDATE save_locations SET last_restore_at = ?2, updated_at = ?2 WHERE id = ?1",
        params![id, at_ms as i64],
    )
    .map(|_| ())
    .map_err(|e| format!("saves touch_location_restore: {e}"))
}

/// Aggregate counters for the Saves overview. Returns
/// `(location_count, games_with_locations, backup_count, total_bytes)`.
pub fn summary_counts(db: &Db) -> Result<(u64, u64, u64, u64), String> {
    let conn = db.saves().map_err(|e| format!("saves conn: {e}"))?;
    let location_count: i64 = conn
        .query_row("SELECT count(*) FROM save_locations", [], |r| r.get(0))
        .unwrap_or(0);
    let games: i64 = conn
        .query_row(
            "SELECT count(DISTINCT game_id) FROM save_locations",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let backup_count: i64 = conn
        .query_row("SELECT count(*) FROM save_backups", [], |r| r.get(0))
        .unwrap_or(0);
    let total_bytes: i64 = conn
        .query_row("SELECT COALESCE(SUM(total_bytes), 0) FROM save_backups", [], |r| {
            r.get(0)
        })
        .unwrap_or(0);
    Ok((
        location_count.max(0) as u64,
        games.max(0) as u64,
        backup_count.max(0) as u64,
        total_bytes.max(0) as u64,
    ))
}

fn rand_suffix() -> String {
    // Cheap uniqueness without pulling a UUID dep: nanos + a per-call
    // counter mixed through the address of a stack local.
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    let marker = &nanos as *const u32 as usize;
    format!("{nanos:x}{marker:x}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn location(game_id: &str, path: &str) -> SaveLocation {
        SaveLocation {
            id: String::new(),
            game_id: game_id.to_string(),
            path: path.to_string(),
            label: "Saves".to_string(),
            kind: "dir".to_string(),
            source: "manual".to_string(),
            include: true,
            created_at: 0,
            updated_at: 0,
            last_backup_at: None,
            last_restore_at: None,
        }
    }

    #[test]
    fn locations_round_trip_and_scope_by_game() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        super::super::migrate::run_migrations(&db).unwrap();

        let a = upsert_location(&db, location("game-a", "/tmp/a")).unwrap();
        assert!(!a.id.is_empty());
        upsert_location(&db, location("game-b", "/tmp/b")).unwrap();

        assert_eq!(list_locations(&db, "game-a").unwrap().len(), 1);
        assert_eq!(list_all_locations(&db).unwrap().len(), 2);

        // Case-insensitive path dedupe lookup.
        assert!(find_location_by_path(&db, "game-a", "/TMP/A").unwrap().is_some());

        // Toggle include + restore stamp.
        let mut edit = a.clone();
        edit.include = false;
        upsert_location(&db, edit).unwrap();
        assert!(!list_locations(&db, "game-a").unwrap()[0].include);

        touch_location_backup(&db, &a.id, 1_000).unwrap();
        touch_location_restore(&db, &a.id, 2_000).unwrap();
        let listed = list_locations(&db, "game-a").unwrap();
        assert_eq!(listed[0].last_backup_at, Some(1_000));
        assert_eq!(listed[0].last_restore_at, Some(2_000));

        assert_eq!(delete_location(&db, &a.id).unwrap(), 1);
        assert_eq!(delete_location(&db, &a.id).unwrap(), 0);
        assert_eq!(delete_locations_for_game(&db, "game-b").unwrap(), 1);
    }

    #[test]
    fn backups_index_and_summary() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        super::super::migrate::run_migrations(&db).unwrap();

        let b = insert_backup(
            &db,
            SaveBackup {
                id: String::new(),
                game_id: "game-a".into(),
                game_name: "Game A".into(),
                created_at: 0,
                kind: "manual".into(),
                note: String::new(),
                location_count: 2,
                file_count: 5,
                total_bytes: 1_024,
                status: "complete".into(),
                error: None,
                root_path: "/backups/a".into(),
                manifest_path: "/backups/a/manifest.json".into(),
            },
        )
        .unwrap();
        assert!(!b.id.is_empty());
        assert!(b.created_at > 0);

        assert_eq!(list_backups(&db, Some("game-a")).unwrap().len(), 1);
        assert_eq!(list_backups(&db, None).unwrap().len(), 1);

        let (locations, games, backups, bytes) = summary_counts(&db).unwrap();
        assert_eq!((locations, games, backups, bytes), (0, 0, 1, 1_024));

        assert_eq!(delete_backup(&db, &b.id).unwrap(), 1);
        assert_eq!(delete_backup(&db, &b.id).unwrap(), 0);
    }
}
