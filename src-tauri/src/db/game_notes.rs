//! Game-notes DAO.
//!
//! One row per user-authored note / guide attached to a library game.
//! Notes are ordered pinned-first, then most-recently-updated, which is
//! the order the Notes tab renders its list sidebar in. `content` is
//! Markdown; the renderer lives entirely on the frontend.
//!
//! `tags_json` is a compact JSON array so tag filtering stays a
//! frontend concern (the dataset per game is tiny) rather than needing
//! its own join table.

use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

use super::pool::Db;

/// One note row, round-tripped to the frontend as camelCase JSON.
///
/// `created_at` / `updated_at` are unix milliseconds. `updated_at` is
/// always rewritten server-side on save; `created_at` is preserved on
/// update so the list can honestly show when a note was started.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameNote {
    #[serde(default)]
    pub id: String,
    pub game_id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub created_at: u64,
    #[serde(default)]
    pub updated_at: u64,
}

/// List every note for a game, pinned first then newest-updated first.
pub fn list_for_game(db: &Db, game_id: &str) -> Result<Vec<GameNote>, String> {
    let conn = db.game_notes().map_err(|e| format!("game_notes conn: {e}"))?;
    let mut stmt = conn
        .prepare(
            "SELECT id, game_id, title, content, tags_json, pinned, created_at, updated_at
             FROM game_notes
             WHERE game_id = ?1
             ORDER BY pinned DESC, updated_at DESC",
        )
        .map_err(|e| format!("game_notes list prepare: {e}"))?;
    let rows = stmt
        .query_map(params![game_id], |r| {
            let tags_json: String = r.get(4)?;
            Ok(GameNote {
                id: r.get(0)?,
                game_id: r.get(1)?,
                title: r.get(2)?,
                content: r.get(3)?,
                tags: serde_json::from_str(&tags_json).unwrap_or_default(),
                pinned: r.get::<_, i64>(5)? != 0,
                created_at: r.get::<_, i64>(6)?.max(0) as u64,
                updated_at: r.get::<_, i64>(7)?.max(0) as u64,
            })
        })
        .map_err(|e| format!("game_notes list query: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("game_notes row: {e}"))?);
    }
    Ok(out)
}

/// Search notes across every game.
///
/// An empty query returns the most recently updated notes, which is what the
/// Notes tab shows in its "All games" scope before the user types. Matching is
/// case-insensitive for ASCII (SQLite `LIKE`) and covers title, Markdown body
/// and tags. `%`/`_` are escaped so a literal query cannot turn into a wildcard.
pub fn search(db: &Db, query: &str, limit: u32) -> Result<Vec<GameNote>, String> {
    let conn = db.game_notes().map_err(|e| format!("game_notes conn: {e}"))?;
    let limit = limit.clamp(1, 200) as i64;
    let trimmed = query.trim();
    let mut stmt = conn
        .prepare(
            "SELECT id, game_id, title, content, tags_json, pinned, created_at, updated_at
             FROM game_notes
             WHERE ?1 = ''
                OR title LIKE ?2 ESCAPE '\\'
                OR content LIKE ?2 ESCAPE '\\'
                OR tags_json LIKE ?2 ESCAPE '\\'
             ORDER BY pinned DESC, updated_at DESC
             LIMIT ?3",
        )
        .map_err(|e| format!("game_notes search prepare: {e}"))?;
    let pattern = format!(
        "%{}%",
        trimmed
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_")
    );
    let rows = stmt
        .query_map(params![trimmed, pattern, limit], |r| {
            let tags_json: String = r.get(4)?;
            Ok(GameNote {
                id: r.get(0)?,
                game_id: r.get(1)?,
                title: r.get(2)?,
                content: r.get(3)?,
                tags: serde_json::from_str(&tags_json).unwrap_or_default(),
                pinned: r.get::<_, i64>(5)? != 0,
                created_at: r.get::<_, i64>(6)?.max(0) as u64,
                updated_at: r.get::<_, i64>(7)?.max(0) as u64,
            })
        })
        .map_err(|e| format!("game_notes search query: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("game_notes search row: {e}"))?);
    }
    Ok(out)
}

/// Insert a new note or update an existing one (keyed by `id`).///
/// Normalization happens here so the frontend can post a bare draft:
/// a blank `id` gets a generated one, a zero `createdAt` is stamped
/// with now, and `updatedAt` is always rewritten.
pub fn upsert(db: &Db, mut note: GameNote) -> Result<GameNote, String> {
    let now = unix_now_ms();
    if note.id.trim().is_empty() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        note.id = format!("note-{now}-{nanos}");
    }
    if note.created_at == 0 {
        note.created_at = now;
    }
    note.updated_at = now;

    let tags_json =
        serde_json::to_string(&note.tags).map_err(|e| format!("game_notes tags encode: {e}"))?;
    let conn = db.game_notes().map_err(|e| format!("game_notes conn: {e}"))?;
    conn.execute(
        "INSERT INTO game_notes(id, game_id, title, content, tags_json, pinned, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(id) DO UPDATE SET
             game_id    = excluded.game_id,
             title      = excluded.title,
             content    = excluded.content,
             tags_json  = excluded.tags_json,
             pinned     = excluded.pinned,
             updated_at = excluded.updated_at",
        params![
            note.id,
            note.game_id,
            note.title,
            note.content,
            tags_json,
            note.pinned as i64,
            note.created_at as i64,
            note.updated_at as i64,
        ],
    )
    .map_err(|e| format!("game_notes upsert: {e}"))?;
    Ok(note)
}

/// Delete one note by id. Idempotent: returns the number of rows
/// removed (0 when the id was already gone).
pub fn delete(db: &Db, id: &str) -> Result<u64, String> {
    let conn = db.game_notes().map_err(|e| format!("game_notes conn: {e}"))?;
    conn.execute("DELETE FROM game_notes WHERE id = ?1", params![id])
        .map(|n| n as u64)
        .map_err(|e| format!("game_notes delete: {e}"))
}

/// Delete every note for a game. Returns the number of rows removed.
pub fn delete_for_game(db: &Db, game_id: &str) -> Result<u64, String> {
    let conn = db.game_notes().map_err(|e| format!("game_notes conn: {e}"))?;
    conn.execute("DELETE FROM game_notes WHERE game_id = ?1", params![game_id])
        .map(|n| n as u64)
        .map_err(|e| format!("game_notes delete_for_game: {e}"))
}

/// Current wall-clock time in unix milliseconds.
pub fn unix_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn draft(game_id: &str, title: &str, content: &str) -> GameNote {
        GameNote {
            id: String::new(),
            game_id: game_id.to_string(),
            title: title.to_string(),
            content: content.to_string(),
            tags: vec!["guide".to_string()],
            pinned: false,
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn search_matches_title_content_and_tags_across_games() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        super::super::migrate::run_migrations(&db).unwrap();

        upsert(&db, draft("game-a", "Boss guide", "Phase two: dodge the beam")).unwrap();
        upsert(&db, draft("game-b", "Collectibles", "All 40 shards")).unwrap();

        let by_title = search(&db, "boss", 50).unwrap();
        assert_eq!(by_title.len(), 1);
        assert_eq!(by_title[0].game_id, "game-a");

        let by_body = search(&db, "SHARDS", 50).unwrap();
        assert_eq!(by_body.len(), 1);
        assert_eq!(by_body[0].game_id, "game-b");

        let by_tag = search(&db, "guide", 50).unwrap();
        assert!(by_tag.iter().all(|n| n.tags.iter().any(|tag| tag == "guide")));

        // Both notes use the "guide" tag from the draft helper, so an empty
        // query returns recent notes across games rather than nothing.
        let recent = search(&db, "  ", 50).unwrap();
        assert_eq!(recent.len(), 2);

        // A literal wildcard is not treated as one.
        assert!(search(&db, "%", 50).unwrap().is_empty());
    }

    #[test]
    fn round_trip_create_list_update_delete() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        super::super::migrate::run_migrations(&db).unwrap();

        // Create: blank id / timestamps get normalized.
        let created = upsert(&db, draft("game-a", "Boss guide", "## Phase 1")).unwrap();
        assert!(!created.id.is_empty());
        assert!(created.created_at > 0);
        assert_eq!(created.updated_at, created.created_at);

        // A second game's notes must not leak into the first list.
        upsert(&db, draft("game-b", "Other", "x")).unwrap();
        let listed = list_for_game(&db, "game-a").unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].title, "Boss guide");
        assert_eq!(listed[0].tags, vec!["guide".to_string()]);

        // Update keeps created_at, bumps updated_at, and pins the note.
        let mut edit = created.clone();
        edit.title = "Boss guide v2".to_string();
        edit.content = "## Phase 2".to_string();
        edit.pinned = true;
        let saved = upsert(&db, edit).unwrap();
        assert_eq!(saved.created_at, created.created_at);
        assert!(saved.updated_at >= created.updated_at);
        let listed = list_for_game(&db, "game-a").unwrap();
        assert_eq!(listed[0].content, "## Phase 2");
        assert!(listed[0].pinned);

        // Delete is idempotent.
        assert_eq!(delete(&db, &created.id).unwrap(), 1);
        assert_eq!(delete(&db, &created.id).unwrap(), 0);
        assert!(list_for_game(&db, "game-a").unwrap().is_empty());
    }

    #[test]
    fn list_for_unknown_game_is_empty_and_delete_for_game_scopes() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        super::super::migrate::run_migrations(&db).unwrap();

        assert!(list_for_game(&db, "missing").unwrap().is_empty());
        assert_eq!(delete_for_game(&db, "missing").unwrap(), 0);

        upsert(&db, draft("game-a", "A", "x")).unwrap();
        upsert(&db, draft("game-b", "B", "x")).unwrap();
        assert_eq!(delete_for_game(&db, "game-a").unwrap(), 1);
        assert_eq!(list_for_game(&db, "game-b").unwrap().len(), 1);
    }

    #[test]
    fn pins_and_recent_updates_sort_first() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        super::super::migrate::run_migrations(&db).unwrap();

        let first = upsert(&db, draft("game-a", "First", "1")).unwrap();
        let second = upsert(&db, draft("game-a", "Second", "2")).unwrap();
        // `updated_at` is ms-precision; bump the first note explicitly
        // so the ordering assertion isn't a same-millisecond coin flip.
        let mut older = first.clone();
        older.updated_at = second.updated_at.saturating_sub(1000);
        {
            let conn = db.game_notes().unwrap();
            conn.execute(
                "UPDATE game_notes SET updated_at = ?1 WHERE id = ?2",
                params![older.updated_at as i64, older.id],
            )
            .unwrap();
        }

        let listed = list_for_game(&db, "game-a").unwrap();
        assert_eq!(listed[0].id, second.id);

        let mut pin = first;
        pin.pinned = true;
        upsert(&db, pin).unwrap();
        let listed = list_for_game(&db, "game-a").unwrap();
        assert_eq!(listed[0].title, "First");
    }
}
