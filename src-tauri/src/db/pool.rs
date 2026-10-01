//! SQLite connection pools, one per logical database file.
//!
//! [`Db`] owns one [`r2d2::Pool`] of [`rusqlite::Connection`]s per
//! logical database file, each backed by its own physical file under
//! `<app_data_dir>`:
//!
//! | Pool / file        | Tables                                              |
//! |--------------------|-----------------------------------------------------|
//! | `sources.db`       | `sources`, `sources_cache`, `downloads`, `downloads_fts` |
//! | `games.db`         | `games`                                             |
//! | `sessions.db`      | `sessions`                                          |
//! | `download_history.db` | `download_history`                                |
//! | `wishlist.db`      | `wishlist`                                          |
//! | `store_cache.db`   | `store_cache`, `store_detail`                       |
//! | `achievements.db`  | `achievements_cache`                                |
//! | `kv.db`            | `kv_store`                                          |
//! | `news.db`         | `news_cache`                                        |
//! | `game_notes.db`   | `game_notes`                                        |
//! | `emulators.db`    | `emulators`                                         |
//! | `mods.db`          | `mods`, `game_mod_settings`                        |
//! | `plugins.db`       | `plugins`                                           |
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
    pub download_history: SqlitePool,
    pub wishlist: SqlitePool,
    pub store_cache: SqlitePool,
    pub achievements: SqlitePool,
    pub kv: SqlitePool,
    pub news: SqlitePool,
    pub game_notes: SqlitePool,
    pub emulators: SqlitePool,
    pub mods: SqlitePool,
    pub plugins: SqlitePool,
    pub compatibility: SqlitePool,
    pub saves: SqlitePool,
}

impl Db {
    /// Open (creating if missing) the `<name>.db` files under
    /// `app_data_dir`, each with its own pool and PRAGMA customizer.
    pub fn open(app_data_dir: &Path) -> Result<Self, String> {
        std::fs::create_dir_all(app_data_dir)
            .map_err(|e| format!("create app_data_dir: {e}"))?;
        let mk = |name: &str, max: u32, min: u32| -> Result<SqlitePool, String> {
            let db_path = app_data_dir.join(format!("{name}.db"));
            let manager =
                SqliteConnectionManager::file(&db_path).with_init(init_connection);
            Pool::builder()
                .max_size(max)
                // Keep 1 idle connection per pool (or more on demand) to minimize
                // baseline memory and open file descriptors while keeping instant access.
                .min_idle(Some(min))
                .build(manager)
                .map_err(|e| format!("build {name} pool: {e}"))
        };
        Ok(Self {
            sources: mk("sources", 6, 1)?,
            games: mk("games", 6, 1)?,
            sessions: mk("sessions", 4, 1)?,
            download_history: mk("download_history", 4, 1)?,
            wishlist: mk("wishlist", 4, 1)?,
            store_cache: mk("store_cache", 4, 1)?,
            achievements: mk("achievements", 4, 1)?,
            kv: mk("kv", 4, 1)?,
            news: mk("news", 4, 1)?,
            game_notes: mk("game_notes", 4, 1)?,
            emulators: mk("emulators", 4, 1)?,
            mods: mk("mods", 4, 1)?,
            plugins: mk("plugins", 4, 1)?,
            compatibility: mk("compatibility", 4, 1)?,
            saves: mk("saves", 4, 1)?,
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
    /// Borrow a connection from the `download_history` pool.
    pub fn download_history(&self) -> Result<PooledConn, String> {
        self.download_history
            .get()
            .map_err(|e| format!("acquire download_history conn: {e}"))
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
    /// Borrow a connection from the `game_notes` pool.
    pub fn game_notes(&self) -> Result<PooledConn, String> {
        self.game_notes
            .get()
            .map_err(|e| format!("acquire game_notes conn: {e}"))
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
    /// Borrow a connection from the `plugins` pool.
    pub fn plugins(&self) -> Result<PooledConn, String> {
        self.plugins.get().map_err(|e| format!("acquire plugins conn: {e}"))
    }
    /// Borrow a connection from the `compatibility` pool.
    pub fn compatibility(&self) -> Result<PooledConn, String> {
        self.compatibility
            .get()
            .map_err(|e| format!("acquire compatibility conn: {e}"))
    }
    /// Borrow a connection from the `saves` pool.
    pub fn saves(&self) -> Result<PooledConn, String> {
        self.saves.get().map_err(|e| format!("acquire saves conn: {e}"))
    }

    /// Return the pool backing a domain `label` (used by the migration
    /// runner). Returns `None` for unknown labels.
    pub fn pool(&self, label: &str) -> Option<&SqlitePool> {
        match label {
            "sources" => Some(&self.sources),
            "games" => Some(&self.games),
            "sessions" => Some(&self.sessions),
            "download_history" => Some(&self.download_history),
            "wishlist" => Some(&self.wishlist),
            "store_cache" => Some(&self.store_cache),
            "achievements" => Some(&self.achievements),
            "kv" => Some(&self.kv),
            "news" => Some(&self.news),
            "game_notes" => Some(&self.game_notes),
            "emulators" => Some(&self.emulators),
            "mods" => Some(&self.mods),
            "plugins" => Some(&self.plugins),
            "compatibility" => Some(&self.compatibility),
            "saves" => Some(&self.saves),
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
         PRAGMA wal_autocheckpoint = 1000;\n\
         PRAGMA cache_size = -512;\n",
    )
}

/// Free-page share above which rewriting the file is worth more than the copy
/// it costs.
const VACUUM_FREE_PAGE_RATIO: f64 = 0.25;

/// Compact one domain file: truncate its WAL, then `VACUUM` if at least
/// [`VACUUM_FREE_PAGE_RATIO`] of its pages sit on the freelist. Returns the
/// bytes reclaimed.
///
/// Delete-then-insert churn leaves freed pages on the freelist, which SQLite
/// reuses but never returns to the filesystem, so the file only grows.
///
/// The caller must hold the *only* connection to the file: `VACUUM` takes an
/// exclusive lock, so this is safe from [`super::init`] and nowhere else.
pub fn compact_connection(conn: &Connection) -> Result<u64, String> {
    // TRUNCATE, not the passive default: a logically empty WAL keeps whatever
    // size it grew to, and every open pays to read its index.
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .map_err(|e| format!("wal_checkpoint: {e}"))?;

    let page_size: i64 = conn
        .query_row("PRAGMA page_size", [], |r| r.get(0))
        .map_err(|e| format!("read page_size: {e}"))?;
    let page_count: i64 = conn
        .query_row("PRAGMA page_count", [], |r| r.get(0))
        .map_err(|e| format!("read page_count: {e}"))?;
    let free_pages: i64 = conn
        .query_row("PRAGMA freelist_count", [], |r| r.get(0))
        .map_err(|e| format!("read freelist_count: {e}"))?;

    if page_count <= 0 || (free_pages as f64) < (page_count as f64) * VACUUM_FREE_PAGE_RATIO {
        return Ok(0);
    }

    let before = page_count * page_size;
    conn.execute_batch("VACUUM;")
        .map_err(|e| format!("vacuum: {e}"))?;
    let after_pages: i64 = conn
        .query_row("PRAGMA page_count", [], |r| r.get(0))
        .map_err(|e| format!("read page_count after vacuum: {e}"))?;
    Ok((before - after_pages * page_size).max(0) as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compact_connection_reclaims_freelist_pages() {
        let dir = tempfile::tempdir().unwrap();
        let mut conn = Connection::open(dir.path().join("bloated.db")).unwrap();
        init_connection(&mut conn).unwrap();
        conn.execute_batch("CREATE TABLE t (id INTEGER PRIMARY KEY, blob BLOB);")
            .unwrap();
        for _ in 0..200 {
            conn.execute("INSERT INTO t (blob) VALUES (zeroblob(20000))", []).unwrap();
        }
        conn.execute("DELETE FROM t", []).unwrap();

        let free_before: i64 = conn
            .query_row("PRAGMA freelist_count", [], |r| r.get(0))
            .unwrap();
        assert!(free_before > 0, "deleting rows should leave free pages");

        let reclaimed = compact_connection(&conn).unwrap();
        assert!(reclaimed > 0, "expected reclaimed bytes, got {reclaimed}");
        let free_after: i64 = conn
            .query_row("PRAGMA freelist_count", [], |r| r.get(0))
            .unwrap();
        assert_eq!(free_after, 0);

        assert_eq!(compact_connection(&conn).unwrap(), 0);
    }

    #[test]
    fn compact_connection_skips_a_file_without_free_pages() {
        let dir = tempfile::tempdir().unwrap();
        let mut conn = Connection::open(dir.path().join("lean.db")).unwrap();
        init_connection(&mut conn).unwrap();
        conn.execute_batch("CREATE TABLE t (id INTEGER PRIMARY KEY);").unwrap();
        assert_eq!(compact_connection(&conn).unwrap(), 0);
    }

    #[test]
    fn open_creates_all_domain_dbs_in_tempdir() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        // Each domain pool yields a WAL-mode connection.
        for acquire in [
            Db::sources,
            Db::games,
            Db::sessions,
            Db::download_history,
            Db::wishlist,
            Db::store_cache,
            Db::achievements,
            Db::kv,
            Db::news,
            Db::game_notes,
            Db::emulators,
            Db::mods,
            Db::plugins,
            Db::compatibility,
            Db::saves,
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
