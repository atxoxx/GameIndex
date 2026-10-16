//! Smart Shelves DAO.
//!
//! One row per user-defined shelf: a named, auto-updating query over the
//! library. Membership is recomputed on the frontend from `rules`, so
//! only the definition is persisted here. `rules` is a compact JSON
//! object and is opaque to this layer — the rule vocabulary and
//! evaluation live in `src/hooks/shelfRules.ts`.
//!
//! `sort` is the shelf's own sort order (applied to the Library when the
//! shelf is activated), `pinned` surfaces it as a Home rail, and
//! `position` is the user's drag order in the sidebar.

use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

use super::pool::Db;

/// Upper bound on stored shelves. Keeps the sidebar list and the
/// per-render rule evaluation bounded.
pub const MAX_SHELVES: usize = 30;

fn default_icon() -> String {
    "layers".to_string()
}

fn default_color() -> String {
    "accent".to_string()
}

fn default_sort() -> String {
    "alphabetical".to_string()
}

/// One shelf row, round-tripped to the frontend as camelCase JSON.
///
/// `created_at` / `updated_at` are unix milliseconds; `updated_at` is
/// rewritten on every save while `created_at` is preserved so the list
/// can keep a stable age ordering.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Shelf {
    #[serde(default)]
    pub id: String,
    pub name: String,
    #[serde(default = "default_icon")]
    pub icon: String,
    #[serde(default = "default_color")]
    pub color: String,
    /// Compact JSON object of shelf rules (opaque to the DAO).
    #[serde(default)]
    pub rules: serde_json::Value,
    #[serde(default = "default_sort")]
    pub sort: String,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub position: i64,
    #[serde(default)]
    pub created_at: u64,
    #[serde(default)]
    pub updated_at: u64,
}

fn unix_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn row_to_shelf(r: &rusqlite::Row<'_>) -> rusqlite::Result<Shelf> {
    let rules_json: String = r.get(4)?;
    Ok(Shelf {
        id: r.get(0)?,
        name: r.get(1)?,
        icon: r.get(2)?,
        color: r.get(3)?,
        rules: serde_json::from_str(&rules_json)
            .unwrap_or_else(|_| serde_json::Value::Object(serde_json::Map::new())),
        sort: r.get(5)?,
        pinned: r.get::<_, i64>(6)? != 0,
        position: r.get(7)?,
        created_at: r.get::<_, i64>(8)?.max(0) as u64,
        updated_at: r.get::<_, i64>(9)?.max(0) as u64,
    })
}

/// Number of stored shelves.
pub fn count(db: &Db) -> Result<usize, String> {
    let conn = db.shelves().map_err(|e| format!("shelves conn: {e}"))?;
    let n: i64 = conn
        .query_row("SELECT COUNT(*) FROM shelves", [], |r| r.get(0))
        .map_err(|e| format!("shelves count: {e}"))?;
    Ok(n.max(0) as usize)
}

/// Every shelf ordered by the user's drag position, then age.
pub fn list(db: &Db) -> Result<Vec<Shelf>, String> {
    let conn = db.shelves().map_err(|e| format!("shelves conn: {e}"))?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, icon, color, rules_json, sort, pinned, position, created_at, updated_at
             FROM shelves
             ORDER BY position ASC, created_at ASC",
        )
        .map_err(|e| format!("shelves list prepare: {e}"))?;
    let rows = stmt
        .query_map([], row_to_shelf)
        .map_err(|e| format!("shelves list query: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("shelves row: {e}"))?);
    }
    Ok(out)
}

/// Insert a new shelf or update an existing one (keyed by `id`).
///
/// Normalization mirrors `db::game_notes::upsert`: a blank `id` is
/// generated, a zero `created_at` is stamped with now, and `updated_at`
/// is always rewritten. A brand-new shelf is appended after the current
/// maximum position. Enforces [`MAX_SHELVES`] for new rows.
pub fn upsert(db: &Db, mut shelf: Shelf) -> Result<Shelf, String> {
    let now = unix_now_ms();
    let is_new = shelf.id.trim().is_empty();
    if is_new {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        shelf.id = format!("shelf-{now}-{nanos}");
    }
    if is_new && count(db)? >= MAX_SHELVES {
        return Err(format!("shelf limit reached ({MAX_SHELVES})"));
    }
    if shelf.created_at == 0 {
        shelf.created_at = now;
    }
    if shelf.icon.trim().is_empty() {
        shelf.icon = default_icon();
    }
    if shelf.color.trim().is_empty() {
        shelf.color = default_color();
    }
    if shelf.sort.trim().is_empty() {
        shelf.sort = default_sort();
    }
    shelf.updated_at = now;

    let rules_json =
        serde_json::to_string(&shelf.rules).map_err(|e| format!("shelves rules encode: {e}"))?;
    let conn = db.shelves().map_err(|e| format!("shelves conn: {e}"))?;

    if is_new {
        let next_position: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(position), -1) + 1 FROM shelves",
                [],
                |r| r.get(0),
            )
            .map_err(|e| format!("shelves next position: {e}"))?;
        shelf.position = next_position;
    }

    conn.execute(
        "INSERT INTO shelves(id, name, icon, color, rules_json, sort, pinned, position, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(id) DO UPDATE SET
             name       = excluded.name,
             icon       = excluded.icon,
             color      = excluded.color,
             rules_json = excluded.rules_json,
             sort       = excluded.sort,
             pinned     = excluded.pinned,
             position   = excluded.position,
             updated_at = excluded.updated_at",
        params![
            shelf.id,
            shelf.name,
            shelf.icon,
            shelf.color,
            rules_json,
            shelf.sort,
            shelf.pinned as i64,
            shelf.position,
            shelf.created_at as i64,
            shelf.updated_at as i64,
        ],
    )
    .map_err(|e| format!("shelves upsert: {e}"))?;
    Ok(shelf)
}

/// Delete one shelf by id. Returns the number of rows removed (0 when the
/// id was already gone).
pub fn delete(db: &Db, id: &str) -> Result<u64, String> {
    let conn = db.shelves().map_err(|e| format!("shelves conn: {e}"))?;
    conn.execute("DELETE FROM shelves WHERE id = ?1", params![id])
        .map(|n| n as u64)
        .map_err(|e| format!("shelves delete: {e}"))
}

/// Persist a new drag order. `ids` is the full list in display order;
/// each id's `position` is set to its index.
pub fn reorder(db: &Db, ids: &[String]) -> Result<(), String> {
    let mut conn = db.shelves().map_err(|e| format!("shelves conn: {e}"))?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    {
        let mut stmt = tx
            .prepare("UPDATE shelves SET position = ?1 WHERE id = ?2")
            .map_err(|e| format!("shelves reorder prepare: {e}"))?;
        for (index, id) in ids.iter().enumerate() {
            stmt.execute(params![index as i64, id])
                .map_err(|e| format!("shelves reorder {id}: {e}"))?;
        }
    }
    tx.commit().map_err(|e| e.to_string())
}

/// Record a game as completed at `completed_at` (unix ms). Upsert.
pub fn set_completed_at(db: &Db, game_id: &str, completed_at: u64) -> Result<(), String> {
    let conn = db.shelves().map_err(|e| format!("shelves conn: {e}"))?;
    conn.execute(
        "INSERT INTO game_completions(game_id, completed_at) VALUES (?1, ?2)
         ON CONFLICT(game_id) DO UPDATE SET completed_at = excluded.completed_at",
        params![game_id, completed_at as i64],
    )
    .map_err(|e| format!("shelves set completion: {e}"))?;
    Ok(())
}

/// Clear a game's completion timestamp (e.g. its status left `completed`).
pub fn clear_completed_at(db: &Db, game_id: &str) -> Result<(), String> {
    let conn = db.shelves().map_err(|e| format!("shelves conn: {e}"))?;
    conn.execute("DELETE FROM game_completions WHERE game_id = ?1", params![game_id])
        .map_err(|e| format!("shelves clear completion: {e}"))?;
    Ok(())
}

/// Every game id → completion timestamp (unix ms).
pub fn completions(db: &Db) -> Result<Vec<(String, u64)>, String> {
    let conn = db.shelves().map_err(|e| format!("shelves conn: {e}"))?;
    let mut stmt = conn
        .prepare("SELECT game_id, completed_at FROM game_completions")
        .map_err(|e| format!("shelves completions prepare: {e}"))?;
    let rows = stmt
        .query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?.max(0) as u64))
        })
        .map_err(|e| format!("shelves completions query: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("shelves completion row: {e}"))?);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn draft(name: &str) -> Shelf {
        Shelf {
            id: String::new(),
            name: name.to_string(),
            icon: String::new(),
            color: String::new(),
            rules: json!({ "playStatus": "backlog" }),
            sort: String::new(),
            pinned: false,
            position: 0,
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn round_trip_create_list_update_delete() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        super::super::migrate::run_migrations(&db).unwrap();

        let created = upsert(&db, draft("Backlog")).unwrap();
        assert!(!created.id.is_empty());
        assert!(created.created_at > 0);
        assert_eq!(created.updated_at, created.created_at);
        assert_eq!(created.icon, "layers");
        assert_eq!(created.color, "accent");
        assert_eq!(created.sort, "alphabetical");
        assert_eq!(created.position, 0);

        let second = upsert(&db, draft("Short Games")).unwrap();
        assert_eq!(second.position, 1);

        let listed = list(&db).unwrap();
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[1].name, "Short Games");
        assert_eq!(listed[0].rules["playStatus"], "backlog");

        let mut edit = created.clone();
        edit.name = "Backlog (renamed)".to_string();
        edit.rules = json!({ "playtimeMaxHours": 0 });
        edit.pinned = true;
        let saved = upsert(&db, edit).unwrap();
        assert_eq!(saved.created_at, created.created_at);
        assert_eq!(saved.position, created.position);
        let listed = list(&db).unwrap();
        let found = listed.iter().find(|s| s.id == created.id).unwrap();
        assert_eq!(found.name, "Backlog (renamed)");
        assert!(found.pinned);
        assert_eq!(found.rules["playtimeMaxHours"], 0);

        assert_eq!(delete(&db, &created.id).unwrap(), 1);
        assert_eq!(delete(&db, &created.id).unwrap(), 0);
        assert_eq!(list(&db).unwrap().len(), 1);
    }

    #[test]
    fn reorder_sets_positions_in_display_order() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        super::super::migrate::run_migrations(&db).unwrap();

        let a = upsert(&db, draft("A")).unwrap();
        let b = upsert(&db, draft("B")).unwrap();
        let c = upsert(&db, draft("C")).unwrap();

        reorder(&db, &[c.id.clone(), a.id.clone(), b.id.clone()]).unwrap();
        let listed = list(&db).unwrap();
        let names: Vec<&str> = listed.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(names, vec!["C", "A", "B"]);
        assert_eq!(listed[0].position, 0);
        assert_eq!(listed[2].position, 2);
    }

    #[test]
    fn enforces_max_shelves_for_new_rows_but_allows_edits() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        super::super::migrate::run_migrations(&db).unwrap();

        let mut first = None;
        for i in 0..MAX_SHELVES {
            let s = upsert(&db, draft(&format!("S{i}"))).unwrap();
            if first.is_none() {
                first = Some(s);
            }
        }
        assert_eq!(count(&db).unwrap(), MAX_SHELVES);

        let err = upsert(&db, draft("Overflow")).unwrap_err();
        assert!(err.contains("limit"));

        // Editing an existing shelf is still allowed at the cap.
        let mut edit = first.unwrap();
        edit.name = "Renamed".to_string();
        upsert(&db, edit).unwrap();
        assert_eq!(count(&db).unwrap(), MAX_SHELVES);
    }

    #[test]
    fn malformed_rules_json_degrades_to_empty_object() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        super::super::migrate::run_migrations(&db).unwrap();

        upsert(&db, draft("Valid")).unwrap();
        {
            let conn = db.shelves().unwrap();
            conn.execute("UPDATE shelves SET rules_json = 'not json'", [])
                .unwrap();
        }
        let listed = list(&db).unwrap();
        assert_eq!(listed[0].rules, serde_json::Value::Object(serde_json::Map::new()));
    }

    #[test]
    fn completion_timestamps_round_trip_and_clear() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        super::super::migrate::run_migrations(&db).unwrap();

        assert!(completions(&db).unwrap().is_empty());

        set_completed_at(&db, "game-a", 111).unwrap();
        set_completed_at(&db, "game-b", 222).unwrap();
        set_completed_at(&db, "game-a", 333).unwrap(); // upsert overwrites
        let rows = completions(&db).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows.iter().find(|r| r.0 == "game-a").unwrap().1, 333);

        clear_completed_at(&db, "game-a").unwrap();
        assert_eq!(completions(&db).unwrap().len(), 1);
        clear_completed_at(&db, "missing").unwrap(); // idempotent
    }
}
