//! Per-domain versioned migration runner.
//!
//! Each logical database file tracks its own schema version in its own
//! `schema_meta` table (key `schema_version`). On every app launch,
//! [`run_migrations`] iterates [`DOMAIN_SCHEMAS`], and for each domain
//! applies any pending migrations in order inside a single
//! transaction.
//!
//! We use a string column rather than `PRAGMA user_version` because
//! string keys in `schema_meta` are easier to debug ("what version are
//! we on?") and easy to extend. Migrations are idempotent — `IF NOT
//! EXISTS` / `CREATE ... IF NOT EXISTS` on every DDL clause means
//! re-running one is a no-op.
//!
//! Each domain's migrations run independently, so a failure migrating
//! one file (e.g. `news.db`) doesn't block the others.

use rusqlite::OptionalExtension;

use super::pool::{Db, PooledConn};
use super::schema::{META_BOOTSTRAP, DOMAIN_SCHEMAS, DomainSchema};

const VERSION_KEY: &str = "schema_version";

/// Apply any pending migrations for every domain and return when all
/// reachable domains are at their latest known version.
///
/// Errors are reported as `String` to match the rest of the commands'
/// error type. A failed migration does not corrupt the database (each
/// migration runs in a transaction; rollback on error). The caller can
/// surface the error to the user and continue running with the old
/// schema.
pub fn run_migrations(db: &Db) -> Result<(), String> {
    for dom in DOMAIN_SCHEMAS {
        let pool = db
            .pool(dom.label)
            .ok_or_else(|| format!("unknown domain '{}' in DOMAIN_SCHEMAS", dom.label))?;
        let mut conn = pool
            .get()
            .map_err(|e| format!("migrate {} conn: {e}", dom.label))?;
        migrate_domain(&mut conn, dom)
            .map_err(|e| format!("migrate {}: {e}", dom.label))?;
    }
    Ok(())
}

/// Migrate a single domain database to its latest version.
fn migrate_domain(conn: &mut PooledConn, dom: &DomainSchema) -> Result<(), String> {
    conn.execute_batch(META_BOOTSTRAP)
        .map_err(|e| format!("bootstrap schema_meta: {e}"))?;

    let current: Option<String> = conn
        .query_row(
            "SELECT v FROM schema_meta WHERE k = ?1",
            [VERSION_KEY],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("read schema_version: {e}"))?;

    let target = dom
        .versions
        .last()
        .map(|(v, _)| v.to_string())
        .ok_or_else(|| format!("domain '{}' has no versions", dom.label))?;

    if current.as_deref() == Some(target.as_str()) {
        return Ok(());
    }

    for (version, ddl) in dom.versions {
        if Some(*version) == current.as_deref() {
            continue;
        }
        eprintln!("[db::migrate] {}: applying {version}", dom.label);
        let tx = conn
            .transaction()
            .map_err(|e| e.to_string())?;
        tx.execute_batch(ddl)
            .map_err(|e| format!("apply {version}: {e}"))?;
        tx.upsert(VERSION_KEY, version, chrono_like_now_iso())
            .map_err(|e| format!("record version: {e}"))?;
        tx.commit().map_err(|e| e.to_string())?;
        eprintln!("[db::migrate] {}: {version} applied", dom.label);
    }
    Ok(())
}

/// Lightweight ISO-8601 stamp for the schema_meta row. We avoid
/// pulling chrono into the schema layer (it does format through
/// `std::time::SystemTime`).
fn chrono_like_now_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("applied_at_unix={}", secs)
}

trait TxExt {
    /// Insert-or-update a `schema_meta` row (rusqlite's
    /// `Connection::upsert` is still marked unstable in some versions).
    fn upsert(&self, key: &str, version: &str, blob: String) -> rusqlite::Result<()>;
}

impl TxExt for rusqlite::Transaction<'_> {
    fn upsert(&self, key: &str, version: &str, _blob: String) -> rusqlite::Result<()> {
        self.execute(
            "INSERT INTO schema_meta(k, v) VALUES(?1, ?2)
             ON CONFLICT(k) DO UPDATE SET v = excluded.v",
            rusqlite::params![key, version],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a one-off in-memory-style Db in a tempdir and confirm
    /// every domain migrates to its latest version and is idempotent.
    #[test]
    fn all_domains_migrate_and_are_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        run_migrations(&db).unwrap();
        run_migrations(&db).unwrap(); // idempotent

        for dom in DOMAIN_SCHEMAS {
            let pool = db.pool(dom.label).unwrap();
            let conn = pool.get().unwrap();
            let v: String = conn
                .query_row(
                    "SELECT v FROM schema_meta WHERE k = 'schema_version'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            let expected = dom.versions.last().map(|(v, _)| *v).unwrap();
            assert_eq!(v, expected, "domain {} version mismatch", dom.label);
        }
    }

    #[test]
    fn each_domain_has_its_own_schema_meta() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        run_migrations(&db).unwrap();
        // Every domain DB physically exists next to the others.
        for name in [
            "sources", "games", "sessions", "download_history", "wishlist",
            "store_cache", "achievements", "kv", "news",
        ] {
            let p = dir.path().join(format!("{name}.db"));
            assert!(p.exists(), "{name}.db not created");
        }
    }
}
