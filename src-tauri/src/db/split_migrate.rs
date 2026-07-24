//! One-time migration of a pre-existing single `gamelib.db` into the
//! new per-domain database files.
//!
//! On the first launch after the storage-layer split, any existing
//! `gamelib.db` (written by the previous single-file build) is copied
//! table-by-table into the new domain files. The copy is `INSERT OR
//! IGNORE`, so re-running is safe, and the original `gamelib.db` is
//! **renamed** (never deleted) to `gamelib.db.pre-split-<timestamp>`
//! so the user can recover manually if something goes wrong.
//!
//! Idempotent: a `split_migrated` row in `kv.schema_meta` short-
//! circuits the whole routine on subsequent launches.

use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};

use super::pool::Db;

const SPLIT_FLAG: &str = "split_migrated";
const SPLIT_VERSION: &str = "v1";

/// Mapping of (domain pool label, tables owned by that domain) to copy
/// out of the legacy `gamelib.db`.
const DOMAIN_TABLES: &[(&str, &[&str])] = &[
    ("sources", &["sources", "sources_cache", "downloads"]),
    ("games", &["games"]),
    ("sessions", &["sessions"]),
    ("wishlist", &["wishlist"]),
    ("store_cache", &["store_cache", "store_detail"]),
    ("achievements", &["achievements_cache"]),
    ("kv", &["kv_store"]),
    ("news", &["news_cache"]),
];

/// Copy data from a legacy `gamelib.db` (if present) into the domain
/// databases. Safe to call on every launch — it no-ops once done.
pub fn run(db: &Db, app_data_dir: &Path) -> Result<(), String> {
    // Already migrated? Skip.
    if let Some(v) = read_flag(db)? {
        if v == SPLIT_VERSION {
            return Ok(());
        }
    }

    let legacy_path = app_data_dir.join("gamelib.db");
    if !legacy_path.exists() {
        // Fresh install (or already renamed on a previous run that
        // crashed before writing the flag). Record completion so we
        // don't scan for the file again.
        write_flag(db)?;
        return Ok(());
    }

    // Open the legacy DB read-only. If it's locked by a crashed prior
    // run we just skip — the app still works via the per-domain files
    // and the legacy JSON import path.
    let legacy = match Connection::open_with_flags(&legacy_path, OpenFlags::SQLITE_OPEN_READ_ONLY) {
        Ok(c) => c,
        Err(e) => {
            eprintln!(
                "[db::split_migrate] skipping: cannot open legacy gamelib.db: {e}"
            );
            return Ok(());
        }
    };

    for (label, tables) in DOMAIN_TABLES {
        let pool = db
            .pool(label)
            .ok_or_else(|| format!("unknown domain '{label}' during split"))?;
        let conn = pool
            .get()
            .map_err(|e| format!("split {label} conn: {e}"))?;

        conn.execute("ATTACH DATABASE ? AS legacy_src", [legacy_path.to_string_lossy().as_ref()])
            .map_err(|e| format!("split attach {label}: {e}"))?;

        for table in *tables {
            // `SELECT *` matches the new table's column order because
            // both schemas are identical for that table.
            let sql = format!(
                "INSERT OR IGNORE INTO {table} SELECT * FROM legacy_src.{table}"
            );
            if let Err(e) = conn.execute(&sql, []) {
                eprintln!(
                    "[db::split_migrate] {label}.{table} copy skipped: {e}"
                );
            }
        }

        // The downloads copy re-fires the FTS5 triggers, so
        // downloads_fts is rebuilt automatically; no manual copy.
        conn.execute("DETACH DATABASE legacy_src", [])
            .map_err(|e| format!("split detach {label}: {e}"))?;
    }

    // Drop the read-only handle before renaming.
    drop(legacy);

    // Rename (atomic) the legacy file so it's preserved but unused.
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let renamed: PathBuf = app_data_dir.join(format!("gamelib.db.pre-split-{ts}"));
    if let Err(e) = std::fs::rename(&legacy_path, &renamed) {
        eprintln!(
            "[db::split_migrate] could not rename legacy gamelib.db (left in place): {e}"
        );
    } else {
        eprintln!(
            "[db::split_migrate] legacy gamelib.db migrated and renamed to {}",
            renamed.display()
        );
    }

    write_flag(db)?;
    Ok(())
}

fn read_flag(db: &Db) -> Result<Option<String>, String> {
    let conn = db.kv().map_err(|e| format!("split flag read: {e}"))?;
    let mut stmt = conn
        .prepare("SELECT v FROM schema_meta WHERE k = ?1")
        .map_err(|e| format!("split flag prepare: {e}"))?;
    let mut rows = stmt
        .query([SPLIT_FLAG])
        .map_err(|e| format!("split flag query: {e}"))?;
    if let Some(row) = rows.next().map_err(|e| format!("split flag row: {e}"))? {
        let v: String = row.get(0).map_err(|e| format!("split flag col: {e}"))?;
        return Ok(Some(v));
    }
    Ok(None)
}

fn write_flag(db: &Db) -> Result<(), String> {
    let conn = db.kv().map_err(|e| format!("split flag write: {e}"))?;
    conn.execute(
        "INSERT INTO schema_meta(k, v) VALUES(?1, ?2)
         ON CONFLICT(k) DO UPDATE SET v = excluded.v",
        [SPLIT_FLAG, SPLIT_VERSION],
    )
    .map_err(|e| format!("split flag write: {e}"))?;
    Ok(())
}
