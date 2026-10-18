//! Generic key/value store.
//!
//! Stores non-sensitive metadata (Steam library-sync timestamps,
//! last Epic login time, etc.) under string keys. Values are
//! compact JSON or plain strings — opaque to the schema.
//!
//! Survives logout / login cycles; the keyring is intentionally
//! reserved for actual credentials, this is for everything *around*
//! them.

use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::params;

use super::pool::Db;

pub fn get(db: &Db, key: &str) -> Result<Option<String>, String> {
    let conn = db.kv().map_err(|e| format!("kv conn: {e}"))?;
    let mut stmt = conn
        .prepare("SELECT v FROM kv_store WHERE k = ?1")
        .map_err(|e| format!("kv get prepare: {e}"))?;
    let mut rows = stmt
        .query(params![key])
        .map_err(|e| format!("kv get query: {e}"))?;
    if let Some(row) = rows.next().map_err(|e| format!("kv get row: {e}"))? {
        let v: String = row.get(0).map_err(|e| format!("kv get col: {e}"))?;
        return Ok(Some(v));
    }
    Ok(None)
}

/// Values for a batch of keys, in one pooled checkout + one query.
/// The batch price cache used to checkout the kv pool once per key.
/// Absent keys simply don't appear in the result.
pub fn get_many(
    db: &Db,
    keys: &[String],
) -> Result<std::collections::HashMap<String, String>, String> {
    let mut out = std::collections::HashMap::new();
    if keys.is_empty() {
        return Ok(out);
    }
    let conn = db.kv().map_err(|e| format!("kv conn: {e}"))?;
    let placeholders = vec!["?"; keys.len()].join(",");
    let sql = format!("SELECT k, v FROM kv_store WHERE k IN ({placeholders})");
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("kv get_many prepare: {e}"))?;
    let params: Vec<&dyn rusqlite::ToSql> =
        keys.iter().map(|k| k as &dyn rusqlite::ToSql).collect();
    let rows = stmt
        .query_map(params.as_slice(), |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(|e| format!("kv get_many query: {e}"))?;
    for row in rows {
        let (k, v) = row.map_err(|e| format!("kv get_many row: {e}"))?;
        out.insert(k, v);
    }
    Ok(out)
}

/// Upsert a batch of keys inside one transaction — one commit + one
/// pool checkout instead of one per entry.
pub fn set_many(db: &Db, entries: &[(String, String)]) -> Result<(), String> {
    if entries.is_empty() {
        return Ok(());
    }
    let mut conn = db.kv().map_err(|e| format!("kv conn: {e}"))?;
    let tx = conn.transaction().map_err(|e| format!("kv set_many tx: {e}"))?;
    let mut stmt = tx
        .prepare(
            "INSERT INTO kv_store(k, v, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(k) DO UPDATE SET
                 v = excluded.v,
                 updated_at = excluded.updated_at",
        )
        .map_err(|e| format!("kv set_many prepare: {e}"))?;
    let now = unix_now();
    for (key, value) in entries {
        stmt.execute(params![key, value, now])
            .map_err(|e| format!("kv set_many {key}: {e}"))?;
    }
    drop(stmt);
    tx.commit().map_err(|e| format!("kv set_many commit: {e}"))
}

pub fn set(db: &Db, key: &str, value: &str) -> Result<(), String> {
    let conn = db.kv().map_err(|e| format!("kv conn: {e}"))?;
    conn.execute(
        "INSERT INTO kv_store(k, v, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(k) DO UPDATE SET
             v = excluded.v,
             updated_at = excluded.updated_at",
        params![key, value, unix_now()],
    )
    .map_err(|e| format!("kv set: {e}"))?;
    Ok(())
}

pub fn delete(db: &Db, key: &str) -> Result<(), String> {
    let conn = db.kv().map_err(|e| format!("kv conn: {e}"))?;
    conn.execute("DELETE FROM kv_store WHERE k = ?1", params![key])
        .map_err(|e| format!("kv delete: {e}"))?;
    Ok(())
}

pub fn list_all(db: &Db) -> Result<Vec<(String, String, u64)>, String> {
    let conn = db.kv().map_err(|e| format!("kv conn: {e}"))?;
    let mut stmt = conn
        .prepare("SELECT k, v, updated_at FROM kv_store ORDER BY k")
        .map_err(|e| format!("kv list prepare: {e}"))?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)? as u64,
            ))
        })
        .map_err(|e| format!("kv list query: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("kv row: {e}"))?);
    }
    Ok(out)
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

