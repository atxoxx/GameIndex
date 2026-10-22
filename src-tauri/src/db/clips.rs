#![allow(dead_code)]

//! Clips DAO — the highlight-reel registry.
//!
//! `clips` holds one row per recorded/imported clip (file path + light
//! metadata); `reels` + `reel_items` hold user-built playlists over that
//! registry. Reels are ordered references only: v1 never copies or
//! transcodes video, so every operation here is cheap SQL.
//!
//! All `?` after rusqlite calls route through `.map_err(|e| e.to_string())`
//! to keep the public `Result<T, String>` API.

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::pool::Db;

/// One registered clip (a recording, replay dump or imported file).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipRow {
    pub id: String,
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub game_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub game_name: Option<String>,
    pub title: String,
    /// `record` | `replay` | `import`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<i64>,
    #[serde(default)]
    pub favorite: bool,
    /// When the footage was recorded (Unix ms).
    pub created_at: i64,
    /// When it entered the registry (Unix ms).
    pub added_at: i64,
}

/// A reel (playlist) plus its clip ids in playback order.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReelRow {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub clip_ids: Vec<String>,
}

const CLIP_SELECT: &str = "SELECT id, path, game_id, game_name, title, kind, duration_ms, size_bytes, favorite, created_at, added_at FROM clips ORDER BY created_at DESC";

fn clip_from_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<ClipRow> {
    Ok(ClipRow {
        id: r.get(0)?,
        path: r.get(1)?,
        game_id: r.get(2)?,
        game_name: r.get(3)?,
        title: r.get(4)?,
        kind: r.get(5)?,
        duration_ms: r.get(6)?,
        size_bytes: r.get(7)?,
        favorite: r.get::<_, i64>(8)? != 0,
        created_at: r.get(9)?,
        added_at: r.get(10)?,
    })
}

/// Every registered clip, newest footage first.
pub fn list_clips(db: &Db) -> Result<Vec<ClipRow>, String> {
    let conn = db.clips().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(CLIP_SELECT).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], clip_from_row).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn get_clip(db: &Db, id: &str) -> Result<Option<ClipRow>, String> {
    let conn = db.clips().map_err(|e| e.to_string())?;
    conn.query_row(
        &CLIP_SELECT.replace(" ORDER BY created_at DESC", " WHERE id = ?1"),
        params![id],
        clip_from_row,
    )
    .optional()
    .map_err(|e| e.to_string())
}

/// Look a clip up by its file path (the upsert key).
pub fn get_clip_by_path(db: &Db, path: &str) -> Result<Option<ClipRow>, String> {
    let conn = db.clips().map_err(|e| e.to_string())?;
    conn.query_row(
        &CLIP_SELECT.replace(" ORDER BY created_at DESC", " WHERE path = ?1"),
        params![path],
        clip_from_row,
    )
    .optional()
    .map_err(|e| e.to_string())
}

/// Insert a clip. Re-registering the same file path updates its metadata
/// instead of erroring, so the "import from captures" flow is idempotent.
pub fn register_clip(db: &Db, clip: &ClipRow) -> Result<(), String> {
    if clip.path.trim().is_empty() {
        return Err("clip path cannot be empty".into());
    }
    if clip.title.trim().is_empty() {
        return Err("clip title cannot be empty".into());
    }
    let conn = db.clips().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO clips(id, path, game_id, game_name, title, kind, duration_ms, size_bytes, favorite, created_at, added_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)
         ON CONFLICT(path) DO UPDATE SET
             game_id = excluded.game_id,
             game_name = excluded.game_name,
             title = excluded.title,
             kind = excluded.kind,
             duration_ms = excluded.duration_ms,
             size_bytes = excluded.size_bytes",
        params![
            clip.id,
            clip.path,
            clip.game_id,
            clip.game_name,
            clip.title,
            clip.kind,
            clip.duration_ms,
            clip.size_bytes,
            clip.favorite as i32,
            clip.created_at,
            clip.added_at,
        ],
    )
    .map_err(|e| format!("clips register: {e}"))?;
    Ok(())
}

/// Update the editable fields of a clip (title / favorite / game link).
pub fn update_clip(
    db: &Db,
    id: &str,
    title: Option<&str>,
    favorite: Option<bool>,
    game_id: Option<Option<&str>>,
    game_name: Option<Option<&str>>,
) -> Result<(), String> {
    if let Some(t) = title {
        if t.trim().is_empty() {
            return Err("clip title cannot be empty".into());
        }
    }
    let conn = db.clips().map_err(|e| e.to_string())?;
    let affected = conn
        .execute(
            "UPDATE clips SET
                 title = COALESCE(?2, title),
                 favorite = COALESCE(?3, favorite),
                 game_id = CASE WHEN ?4 IS NULL THEN game_id ELSE ?5 END,
                 game_name = CASE WHEN ?6 IS NULL THEN game_name ELSE ?7 END
             WHERE id = ?1",
            params![
                id,
                title,
                favorite.map(|b| b as i32),
                game_id.is_some(),
                game_id.flatten(),
                game_name.is_some(),
                game_name.flatten(),
            ],
        )
        .map_err(|e| format!("clips update: {e}"))?;
    if affected == 0 {
        return Err(format!("clip not found: {id}"));
    }
    Ok(())
}

/// Remove a clip from the registry (the file on disk is untouched) and
/// from every reel it was part of.
pub fn delete_clip(db: &Db, id: &str) -> Result<(), String> {
    let mut conn = db.clips().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM reel_items WHERE clip_id = ?1", params![id])
        .map_err(|e| format!("clips delete items: {e}"))?;
    tx.execute("DELETE FROM clips WHERE id = ?1", params![id])
        .map_err(|e| format!("clips delete: {e}"))?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// All reels with their ordered clip ids.
pub fn list_reels(db: &Db) -> Result<Vec<ReelRow>, String> {
    let conn = db.clips().map_err(|e| e.to_string())?;
    let mut reels: Vec<ReelRow> = {
        let mut stmt = conn
            .prepare("SELECT id, name, description, created_at, updated_at FROM reels ORDER BY updated_at DESC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(ReelRow {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    description: r.get(2)?,
                    created_at: r.get(3)?,
                    updated_at: r.get(4)?,
                    clip_ids: Vec::new(),
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
    };
    let mut items = conn
        .prepare("SELECT clip_id FROM reel_items WHERE reel_id = ?1 ORDER BY position ASC")
        .map_err(|e| e.to_string())?;
    for reel in &mut reels {
        let rows = items
            .query_map(params![reel.id], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        reel.clip_ids = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    }
    Ok(reels)
}

/// Create a reel. Names must be unique enough to be usable in the UI:
/// an exact duplicate name is rejected (case-insensitive).
pub fn create_reel(
    db: &Db,
    id: &str,
    name: &str,
    description: Option<&str>,
    now_ms: i64,
) -> Result<(), String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("reel name cannot be empty".into());
    }
    let conn = db.clips().map_err(|e| e.to_string())?;
    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM reels WHERE lower(name) = lower(?1)",
            params![trimmed],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if existing.is_some() {
        return Err(format!("a reel named \"{trimmed}\" already exists"));
    }
    conn.execute(
        "INSERT INTO reels(id, name, description, created_at, updated_at) VALUES (?1,?2,?3,?4,?4)",
        params![id, trimmed, description, now_ms],
    )
    .map_err(|e| format!("reels insert: {e}"))?;
    Ok(())
}

pub fn rename_reel(
    db: &Db,
    id: &str,
    name: &str,
    description: Option<&str>,
    now_ms: i64,
) -> Result<(), String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("reel name cannot be empty".into());
    }
    let conn = db.clips().map_err(|e| e.to_string())?;
    let affected = conn
        .execute(
            "UPDATE reels SET name = ?2, description = COALESCE(?3, description), updated_at = ?4 WHERE id = ?1",
            params![id, trimmed, description, now_ms],
        )
        .map_err(|e| format!("reels update: {e}"))?;
    if affected == 0 {
        return Err(format!("reel not found: {id}"));
    }
    Ok(())
}

pub fn delete_reel(db: &Db, id: &str) -> Result<(), String> {
    let mut conn = db.clips().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM reel_items WHERE reel_id = ?1", params![id])
        .map_err(|e| format!("reels delete items: {e}"))?;
    tx.execute("DELETE FROM reels WHERE id = ?1", params![id])
        .map_err(|e| format!("reels delete: {e}"))?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Append a clip to the end of a reel (no-op when already present).
/// Returns `true` when a row was inserted.
pub fn add_clip_to_reel(db: &Db, reel_id: &str, clip_id: &str, now_ms: i64) -> Result<bool, String> {
    let mut conn = db.clips().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let exists: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM reels WHERE id = ?1",
            params![reel_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if exists == 0 {
        return Err(format!("reel not found: {reel_id}"));
    }
    let clip_exists: i64 = tx
        .query_row("SELECT COUNT(*) FROM clips WHERE id = ?1", params![clip_id], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if clip_exists == 0 {
        return Err(format!("clip not found: {clip_id}"));
    }
    let next_pos: i64 = tx
        .query_row(
            "SELECT COALESCE(MAX(position) + 1, 0) FROM reel_items WHERE reel_id = ?1",
            params![reel_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let inserted = tx
        .execute(
            "INSERT OR IGNORE INTO reel_items(reel_id, clip_id, position) VALUES (?1, ?2, ?3)",
            params![reel_id, clip_id, next_pos],
        )
        .map_err(|e| format!("reel items insert: {e}"))?;
    tx.execute(
        "UPDATE reels SET updated_at = ?2 WHERE id = ?1",
        params![reel_id, now_ms],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(inserted > 0)
}

pub fn remove_clip_from_reel(db: &Db, reel_id: &str, clip_id: &str, now_ms: i64) -> Result<(), String> {
    let mut conn = db.clips().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM reel_items WHERE reel_id = ?1 AND clip_id = ?2",
        params![reel_id, clip_id],
    )
    .map_err(|e| e.to_string())?;
    // Re-pack positions so the next append stays dense.
    let ids: Vec<String> = {
        let mut stmt = tx
            .prepare("SELECT clip_id FROM reel_items WHERE reel_id = ?1 ORDER BY position ASC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![reel_id], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
    };
    for (idx, id) in ids.iter().enumerate() {
        tx.execute(
            "UPDATE reel_items SET position = ?3 WHERE reel_id = ?1 AND clip_id = ?2",
            params![reel_id, id, idx as i64],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.execute(
        "UPDATE reels SET updated_at = ?2 WHERE id = ?1",
        params![reel_id, now_ms],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Rewrite a reel's order. Ids not currently in the reel are ignored;
/// clips present in the reel but absent from `clip_ids` are appended in
/// their previous relative order so a stale payload can't lose items.
pub fn reorder_reel(db: &Db, reel_id: &str, clip_ids: &[String], now_ms: i64) -> Result<(), String> {
    let mut conn = db.clips().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let current: Vec<String> = {
        let mut stmt = tx
            .prepare("SELECT clip_id FROM reel_items WHERE reel_id = ?1 ORDER BY position ASC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![reel_id], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
    };
    if current.is_empty() {
        return Err(format!("reel not found or empty: {reel_id}"));
    }
    let mut ordered: Vec<String> = clip_ids
        .iter()
        .filter(|id| current.contains(id))
        .cloned()
        .collect();
    for id in &current {
        if !ordered.contains(id) {
            ordered.push(id.clone());
        }
    }
    // Two-phase update: park positions above the current range first so
    // the unique (reel_id, position) index never sees a collision.
    tx.execute(
        "UPDATE reel_items SET position = position + 100000 WHERE reel_id = ?1",
        params![reel_id],
    )
    .map_err(|e| e.to_string())?;
    for (idx, id) in ordered.iter().enumerate() {
        tx.execute(
            "UPDATE reel_items SET position = ?3 WHERE reel_id = ?1 AND clip_id = ?2",
            params![reel_id, id, idx as i64],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.execute(
        "UPDATE reels SET updated_at = ?2 WHERE id = ?1",
        params![reel_id, now_ms],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_db() -> (tempfile::TempDir, Db) {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        crate::db::migrate::run_migrations(&db).unwrap();
        (dir, db)
    }

    fn sample_clip(id: &str, path: &str) -> ClipRow {
        ClipRow {
            id: id.into(),
            path: path.into(),
            game_id: Some("g1".into()),
            game_name: Some("Test Game".into()),
            title: "Nice moment".into(),
            kind: Some("replay".into()),
            duration_ms: Some(30_000),
            size_bytes: Some(1024),
            favorite: false,
            created_at: 1_700_000_000_000,
            added_at: 1_700_000_000_000,
        }
    }

    #[test]
    fn clip_registry_round_trips_and_upserts_by_path() {
        let (_dir, db) = test_db();
        register_clip(&db, &sample_clip("c1", "C:\\clips\\a.mp4")).unwrap();
        // Same path, updated title, different id: the registry keeps one row.
        let mut again = sample_clip("c2", "C:\\clips\\a.mp4");
        again.title = "Renamed moment".into();
        register_clip(&db, &again).unwrap();

        let clips = list_clips(&db).unwrap();
        assert_eq!(clips.len(), 1);
        assert_eq!(clips[0].title, "Renamed moment");
        assert_eq!(clips[0].path, "C:\\clips\\a.mp4");
    }

    #[test]
    fn clip_registry_rejects_empty_path_and_missing_update() {
        let (_dir, db) = test_db();
        let mut bad = sample_clip("c1", " ");
        bad.path = " ".into();
        assert!(register_clip(&db, &bad).is_err());
        assert!(update_clip(&db, "missing", Some("x"), None, None, None).is_err());
    }

    #[test]
    fn reels_keep_order_and_reject_duplicate_names() {
        let (_dir, db) = test_db();
        register_clip(&db, &sample_clip("c1", "C:\\clips\\a.mp4")).unwrap();
        register_clip(&db, &sample_clip("c2", "C:\\clips\\b.mp4")).unwrap();
        create_reel(&db, "r1", "Best of 2026", None, 1).unwrap();
        assert!(create_reel(&db, "r2", "best of 2026", None, 1).is_err());

        add_clip_to_reel(&db, "r1", "c1", 2).unwrap();
        add_clip_to_reel(&db, "r1", "c2", 3).unwrap();
        assert!(add_clip_to_reel(&db, "r1", "missing-clip", 4).is_err());

        reorder_reel(&db, "r1", &["c2".to_string(), "c1".to_string()], 5).unwrap();
        let reels = list_reels(&db).unwrap();
        assert_eq!(reels.len(), 1);
        assert_eq!(reels[0].clip_ids, vec!["c2".to_string(), "c1".to_string()]);

        remove_clip_from_reel(&db, "r1", "c2", 6).unwrap();
        assert_eq!(list_reels(&db).unwrap()[0].clip_ids, vec!["c1".to_string()]);

        // Deleting the clip also removes it from the reel.
        delete_clip(&db, "c1").unwrap();
        assert!(list_reels(&db).unwrap()[0].clip_ids.is_empty());
    }
}
