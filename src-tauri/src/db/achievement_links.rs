// dead-code lint rather than deleting keeps the API stable.
#![allow(dead_code)]

//! Achievement-links DAO.
//!
//! One row per `(game_id, source)` in the `achievement_links` table:
//! per-game source identity (provider id, display name, source url) plus
//! the persisted manual-unlock state (`manual_unlocks_json`, a compact
//! `{ <apiName>: <unix secs> }` map). A game may hold several links at
//! once (e.g. a 'retro' and a 'manual' link); the active source is the
//! `source` column on the `achievements_cache` row.
//!
//! Errors are mapped to `String` at every `?` site via
//! `.map_err(|e| e.to_string())?` so the public API stays
//! `Result<T, String>` without dragging `rusqlite::Error` out of
//! the module.

use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::pool::Db;

/// One `achievement_links` row, mirrored to the frontend with camelCase
/// field names. `manual_unlocks` round-trips through the
/// `manual_unlocks_json` TEXT column.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AchievementLink {
    pub game_id: String,
    pub source: String,
    #[serde(default)]
    pub provider_id: Option<String>,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub source_url: Option<String>,
    #[serde(default)]
    pub manual_unlocks: Option<HashMap<String, i64>>,
    pub created_at: u64,
    pub updated_at: u64,
}

const SELECT_SQL: &str = "SELECT game_id, source, provider_id, display_name, source_url, manual_unlocks_json, created_at, updated_at FROM achievement_links";

/// Upsert one link (`INSERT ... ON CONFLICT(game_id, source) DO UPDATE`).
/// `created_at` is only set on insert (preserved on conflict); a zero
/// `created_at` on a fresh link is stamped with the current time.
pub fn upsert_link(db: &Db, link: &AchievementLink) -> Result<(), String> {
    let conn = db.achievements().map_err(|e| e.to_string())?;
    let now = now_secs();
    let created_at = if link.created_at == 0 { now } else { link.created_at };
    let manual_unlocks_json = link
        .manual_unlocks
        .as_ref()
        .map(|m| {
            serde_json::to_string(m)
                .map_err(|e| format!("achievement_links serialize manual_unlocks: {e}"))
        })
        .transpose()?;
    conn.execute(
        "INSERT INTO achievement_links(
            game_id, source, provider_id, display_name, source_url,
            manual_unlocks_json, created_at, updated_at
        ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
        ON CONFLICT(game_id, source) DO UPDATE SET
            provider_id         = excluded.provider_id,
            display_name        = excluded.display_name,
            source_url          = excluded.source_url,
            manual_unlocks_json = excluded.manual_unlocks_json,
            updated_at          = excluded.updated_at",
        params![
            link.game_id,
            link.source,
            link.provider_id,
            link.display_name,
            link.source_url,
            manual_unlocks_json,
            created_at as i64,
            now as i64,
        ],
    )
    .map_err(|e| format!("achievement_links upsert: {e}"))?;
    Ok(())
}

/// Read every link for one game, ordered by source.
pub fn get_links_for_game(db: &Db, game_id: &str) -> Result<Vec<AchievementLink>, String> {
    let conn = db.achievements().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(&format!("{SELECT_SQL} WHERE game_id = ?1 ORDER BY source"))
        .map_err(|e| format!("achievement_links get prepare: {e}"))?;
    let rows = stmt
        .query_map(params![game_id], row_from_row)
        .map_err(|e| format!("achievement_links get query: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("achievement_links row: {e}"))?);
    }
    Ok(out)
}

/// Read every link across all games.
pub fn list_all_links(db: &Db) -> Result<Vec<AchievementLink>, String> {
    let conn = db.achievements().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(SELECT_SQL)
        .map_err(|e| format!("achievement_links list prepare: {e}"))?;
    let rows = stmt
        .query_map([], row_from_row)
        .map_err(|e| format!("achievement_links list query: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("achievement_links row: {e}"))?);
    }
    Ok(out)
}

/// Delete one link.
pub fn delete_link(db: &Db, game_id: &str, source: &str) -> Result<(), String> {
    let conn = db.achievements().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM achievement_links WHERE game_id = ?1 AND source = ?2",
        params![game_id, source],
    )
    .map_err(|e| format!("achievement_links delete: {e}"))?;
    Ok(())
}

/// Read a link's persisted manual-unlock map, if any.
pub fn read_manual_unlocks(
    db: &Db,
    game_id: &str,
    source: &str,
) -> Result<Option<HashMap<String, i64>>, String> {
    let conn = db.achievements().map_err(|e| e.to_string())?;
    let raw: Option<String> = conn
        .query_row(
            "SELECT manual_unlocks_json FROM achievement_links
              WHERE game_id = ?1 AND source = ?2",
            params![game_id, source],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| format!("achievement_links read_manual_unlocks: {e}"))?
        .flatten();
    Ok(raw.and_then(|s| serde_json::from_str(&s).ok()))
}

/// Merge a fresh set of manual unlocks into the persisted map — the
/// union never removes an already-unlocked achievement — and persist.
/// Returns the merged map.
pub fn update_manual_unlocks(
    db: &Db,
    game_id: &str,
    source: &str,
    unlocks: &HashMap<String, i64>,
) -> Result<HashMap<String, i64>, String> {
    let mut merged = read_manual_unlocks(db, game_id, source)?.unwrap_or_default();
    merged.extend(unlocks.iter().map(|(k, v)| (k.clone(), *v)));
    let conn = db.achievements().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE achievement_links
            SET manual_unlocks_json = ?1, updated_at = ?2
          WHERE game_id = ?3 AND source = ?4",
        params![
            serde_json::to_string(&merged).map_err(|e| e.to_string())?,
            now_secs() as i64,
            game_id,
            source,
        ],
    )
    .map_err(|e| format!("achievement_links update_manual_unlocks: {e}"))?;
    Ok(merged)
}

fn row_from_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<AchievementLink> {
    let manual_unlocks_json: Option<String> = r.get(5)?;
    Ok(AchievementLink {
        game_id: r.get(0)?,
        source: r.get(1)?,
        provider_id: r.get(2)?,
        display_name: r.get(3)?,
        source_url: r.get(4)?,
        manual_unlocks: manual_unlocks_json.and_then(|s| serde_json::from_str(&s).ok()),
        created_at: r.get::<_, i64>(6)? as u64,
        updated_at: r.get::<_, i64>(7)? as u64,
    })
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::ACHIEVEMENTS_DDL;

    fn test_db() -> (tempfile::TempDir, Db) {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        let c = db.achievements().unwrap();
        c.execute_batch(ACHIEVEMENTS_DDL).unwrap();
        c.execute_batch(crate::db::schema::ACHIEVEMENTS_V2_DDL).unwrap();
        (dir, db)
    }

    #[test]
    fn upsert_get_delete_round_trips() {
        let (_dir, db) = test_db();
        let link = AchievementLink {
            game_id: "game-1".into(),
            source: "manual".into(),
            provider_id: Some("retro-player".into()),
            display_name: Some("Manual".into()),
            source_url: None,
            manual_unlocks: Some(HashMap::from([("ach_a".into(), 1000i64)])),
            created_at: 0,
            updated_at: 0,
        };
        upsert_link(&db, &link).unwrap();

        let links = get_links_for_game(&db, "game-1").unwrap();
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].source, "manual");
        assert_eq!(
            links[0].manual_unlocks.as_ref().unwrap().get("ach_a"),
            Some(&1000i64)
        );
        let created = links[0].created_at;
        assert!(created > 0, "created_at stamped on insert");

        // Upsert again (same key) updates in place, preserves created_at.
        let mut again = link;
        again.manual_unlocks = None;
        upsert_link(&db, &again).unwrap();
        let links = get_links_for_game(&db, "game-1").unwrap();
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].created_at, created, "created_at preserved on conflict");
        assert!(links[0].updated_at > 0, "updated_at refreshed on conflict");

        delete_link(&db, "game-1", "manual").unwrap();
        assert!(get_links_for_game(&db, "game-1").unwrap().is_empty());
    }

    #[test]
    fn manual_unlocks_merge_is_monotonic() {
        let (_dir, db) = test_db();
        upsert_link(
            &db,
            &AchievementLink {
                game_id: "game-2".into(),
                source: "manual".into(),
                provider_id: None,
                display_name: None,
                source_url: None,
                manual_unlocks: None,
                created_at: 0,
                updated_at: 0,
            },
        )
        .unwrap();

        update_manual_unlocks(
            &db,
            "game-2",
            "manual",
            &HashMap::from([("ach_a".into(), 1000i64), ("ach_b".into(), 2000i64)]),
        )
        .unwrap();
        update_manual_unlocks(&db, "game-2", "manual", &HashMap::from([("ach_b".into(), 3000i64)]))
            .unwrap();

        let merged = read_manual_unlocks(&db, "game-2", "manual").unwrap().unwrap();
        assert_eq!(merged.len(), 2, "old unlocks never dropped");
        assert_eq!(merged.get("ach_b"), Some(&3000i64));
    }
}
