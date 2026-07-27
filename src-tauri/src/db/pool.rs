//! SQLite connection pools, one per logical database file.
//!
//! [`Db`] owns eight [`r2d2::Pool`]s of [`rusqlite::Connection`]s, each
//! backed by its own physical file under `<app_data_dir>`:
//!
//! | Pool / file        | Tables                                              |
//! |--------------------|-----------------------------------------------------|
//! | `sources.db`       | `sources`, `sources_cache`, `downloads`, `downloads_fts` |
//! | `games.db`         | `games`                                             |
//! | `sessions.db`      | `sessions`                                          |
//! | `wishlist.db`      | `wishlist`                                          |
//! | `store_cache.db`   | `store_cache`, `store_detail`                       |
//! | `achievements.db`  | `achievements_cache`                                |
//! | `kv.db`            | `kv_store`                                          |
//! | `news.db`          | `news_cache`                                        |
//! | `emulators.db`     | `emulators`                                         |
//!
//! Splitting into separate files means a corrupt or WAL-stuck file can
//! only take down its own domain — the rest of the app keeps working —
//! and each domain gets an independent connection pool, WAL, and
//! checkpoint cadence.
//!
//! ## Why a pool
//!
//! A single [`rusqlite::Connection`] is **not** thread-safe (`!Sync`).
//! Tauri dispatches every command to a tokio worker, so a single
//! shared connection would require a mutex around every operation.
//! `r2d2` + WAL-mode SQLite gives us concurrent reads with one writer,
//! without a contended mutex on the hot path.
//!
//! ## Why sync calls in async commands
//!
//! [`r2d2_sqlite::SqliteConnectionManager`] is sync — opening a
//! connection and running a query is a synchronous Rust call. We
//! deliberately do **not** wrap these calls in `tokio::task::spawn_blocking`:
//! the underlying SQLite work on a local file is sub-millisecond, and
//! `spawn_blocking` would add thread-pool scheduling overhead that
//! exceeds the actual query time. `tauri-plugin-store` follows the
//! same sync-in-async pattern for the same reason.
//!
//! ## PRAGMAs
//!
//! Set on every connection by the manager's customizer:
//! - `journal_mode = WAL` — concurrent readers + one writer.
//! - `synchronous = NORMAL` — durable with WAL, much fewer fsyncs than FULL.
//! - `foreign_keys = ON` — required for `ON DELETE CASCADE` from
//!   `sources` → `sources_cache` / `downloads`.

use std::path::Path;

use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::Connection;

/// Concrete pool type shared by every domain.
pub type SqlitePool = Pool<SqliteConnectionManager>;
/// A connection borrowed from one of the domain pools.
pub type PooledConn = r2d2::PooledConnection<SqliteConnectionManager>;

/// Registry of one connection pool per logical database file.
///
/// Cloning is cheap (each inner `Pool` is an `Arc`); Tauri's `State`
/// container holds a clone and hands it to commands via
/// `app.state::<Db>().inner().clone()`.
#[derive(Clone)]
pub struct Db {
    pub sources: SqlitePool,
    pub games: SqlitePool,
    pub sessions: SqlitePool,
    pub wishlist: SqlitePool,
    pub store_cache: SqlitePool,
    pub achievements: SqlitePool,
    pub kv: SqlitePool,
    pub news: SqlitePool,
    pub emulators: SqlitePool,
    pub mods: SqlitePool,
}

impl Db {
    /// Open (creating if missing) the eight `<name>.db` files under
    /// `app_data_dir`, each with its own pool and PRAGMA customizer.
    pub fn open(app_data_dir: &Path) -> Result<Self, String> {
        std::fs::create_dir_all(app_data_dir)
            .map_err(|e| format!("create app_data_dir: {e}"))?;
        let mk = |name: &str| -> Result<SqlitePool, String> {
            let db_path = app_data_dir.join(format!("{name}.db"));
            let manager =
                SqliteConnectionManager::file(&db_path).with_init(init_connection);
            Pool::builder()
                .max_size(8)
                .build(manager)
                .map_err(|e| format!("build {name} pool: {e}"))
        };
        Ok(Self {
            sources: mk("sources")?,
            games: mk("games")?,
            sessions: mk("sessions")?,
            wishlist: mk("wishlist")?,
            store_cache: mk("store_cache")?,
            achievements: mk("achievements")?,
            kv: mk("kv")?,
            news: mk("news")?,
            emulators: mk("emulators")?,
            mods: mk("mods")?,
        })
    }

    /// Borrow a connection from the `sources` pool.
    pub fn sources(&self) -> Result<PooledConn, String> {
        self.sources.get().map_err(|e| format!("acquire sources conn: {e}"))
    }
    /// Borrow a connection from the `games` pool.
    pub fn games(&self) -> Result<PooledConn, String> {
        self.games.get().map_err(|e| format!("acquire games conn: {e}"))
    }
    /// Borrow a connection from the `sessions` pool.
    pub fn sessions(&self) -> Result<PooledConn, String> {
        self.sessions.get().map_err(|e| format!("acquire sessions conn: {e}"))
    }
    /// Borrow a connection from the `wishlist` pool.
    pub fn wishlist(&self) -> Result<PooledConn, String> {
        self.wishlist.get().map_err(|e| format!("acquire wishlist conn: {e}"))
    }
    /// Borrow a connection from the `store_cache` pool.
    pub fn store_cache(&self) -> Result<PooledConn, String> {
        self.store_cache
            .get()
            .map_err(|e| format!("acquire store_cache conn: {e}"))
    }
    /// Borrow a connection from the `achievements` pool.
    pub fn achievements(&self) -> Result<PooledConn, String> {
        self.achievements
            .get()
            .map_err(|e| format!("acquire achievements conn: {e}"))
    }
    /// Borrow a connection from the `kv` pool.
    pub fn kv(&self) -> Result<PooledConn, String> {
        self.kv.get().map_err(|e| format!("acquire kv conn: {e}"))
    }
    /// Borrow a connection from the `news` pool.
    pub fn news(&self) -> Result<PooledConn, String> {
        self.news.get().map_err(|e| format!("acquire news conn: {e}"))
    }
    /// Borrow a connection from the `emulators` pool.
    pub fn emulators(&self) -> Result<PooledConn, String> {
        self.emulators
            .get()
            .map_err(|e| format!("acquire emulators conn: {e}"))
    }
    /// Borrow a connection from the `mods` pool.
    pub fn mods(&self) -> Result<PooledConn, String> {
        self.mods.get().map_err(|e| format!("acquire mods conn: {e}"))
    }

    /// Return the pool backing a domain `label` (used by the migration
    /// runner). Returns `None` for unknown labels.
    pub fn pool(&self, label: &str) -> Option<&SqlitePool> {
        match label {
            "sources" => Some(&self.sources),
            "games" => Some(&self.games),
            "sessions" => Some(&self.sessions),
            "wishlist" => Some(&self.wishlist),
            "store_cache" => Some(&self.store_cache),
            "achievements" => Some(&self.achievements),
            "kv" => Some(&self.kv),
            "news" => Some(&self.news),
            "emulators" => Some(&self.emulators),
            "mods" => Some(&self.mods),
            _ => None,
        }
    }
}

/// Per-connection PRAGMA setup. Runs on each new connection issued by
/// the pool (including the very first one). Errors are logged but not
/// returned — `PRAGMA journal_mode=WAL` on the first connection will
/// create the `-wal`/`-shm` sidecar files; a transient failure
/// (e.g. file lock) shouldn't block us from returning a pool entry to
/// the caller (we'd hit the same failure again on retry).
fn init_connection(conn: &mut Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;\n\
         PRAGMA synchronous = NORMAL;\n\
         PRAGMA foreign_keys = ON;\n\
         PRAGMA busy_timeout = 5000;\n\
         PRAGMA wal_autocheckpoint = 1000;\n",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_creates_all_domain_dbs_in_tempdir() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        // Each domain pool yields a WAL-mode connection.
        for acquire in [
            Db::sources,
            Db::games,
            Db::sessions,
            Db::wishlist,
            Db::store_cache,
            Db::achievements,
            Db::kv,
            Db::news,
            Db::emulators,
            Db::mods,
        ] {
            let conn = acquire(&db).unwrap();
            let mode: String = conn
                .query_row("PRAGMA journal_mode", [], |r| r.get(0))
                .unwrap();
            assert_eq!(mode.to_lowercase(), "wal");
        }
    }

    #[test]
    fn pool_recycles_connections() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        for _ in 0..16 {
            let _conn = db.games().unwrap();
        }
    }
}
