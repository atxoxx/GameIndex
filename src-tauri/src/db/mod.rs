//! Persistent storage layer.
//!
//! Every JSON file in `<app_data_dir>` and the bulk of the frontend
//! `localStorage` payloads are persisted into **one SQLite database
//! per logical domain**, all living in `<app_data_dir>`:
//!
//! | File            | Tables                                                  |
//! |-----------------|---------------------------------------------------------|
//! | `sources.db`    | `sources`, `sources_cache`, `downloads`, `downloads_fts` |
//! | `games.db`      | `games`                                                 |
//! | `sessions.db`   | `sessions`                                              |
//! | `wishlist.db`   | `wishlist`                                              |
//! | `store_cache.db`| `store_cache`, `store_detail`                          |
//! | `achievements.db`| `achievements_cache`                                   |
//! | `kv.db`         | `kv_store` (settings + non-sensitive auth metadata)     |
//! | `news.db`       | `news_cache`                                            |
//!
//! Splitting into separate physical files means a corrupt or
//! WAL-stuck file can only take down its own domain — the rest of the
//! app keeps working — and each domain gets an independent connection
//! pool, WAL, and checkpoint cadence. Sensitive credentials (Steam /
//! Epic OAuth, debrid API keys) live in the OS keychain via
//! [`crate::db::secrets`], not in any of these files.
//!
//! A pre-existing single `gamelib.db` (written by the previous
//! single-file build) is one-time copied into the new domain files by
//! [`crate::db::split_migrate`] on first launch after the split, then
//! renamed to `gamelib.db.pre-split-<timestamp>` for recovery.
//!
//! ## Module map
//!
//! - [`atomic`] — Phase-0 crash-safe write helper for the legacy
//!   JSON files that haven't been migrated yet.
//! - [`pool`] — registry of r2d2 + WAL-mode SQLite connection pools,
//!   one per domain file, exposed via typed accessors (`db.games()`,
//!   `db.kv()`, …).
//! - [`schema`] — embedded per-domain SQL DDL + version registry.
//! - [`migrate`] — per-domain versioned migration runner, called once
//!   at startup.
//! - [`split_migrate`] — one-time copier from a legacy `gamelib.db`.
//! - [`legacy`] — auto-importer that reads the original JSON files
//!   into the DB and moves them to `legacy-backup-v1/`.
//! - [`secrets`] — thin wrapper over the `keyring` crate (OS
//!   keychain). Used for Epic/Steam OAuth tokens and debrid keys.
//! - [`sources`] / [`games`] / [`sessions`] / [`wishlist`] /
//!   [`store_cache`] / [`achievements`] / [`news`] / [`kv`] — one DAO
//!   per domain, each drawing its connection from the matching pool.
//!
//! ## Lifecycle
//!
//! ```text
//! lib.rs::run()
//!   └── .setup(|app| {
//!         let db = db::Db::open(&app.path().app_data_dir()?)?;
//!         db::migrate::run_migrations(&db)?;         // per-domain schemas
//!         db::split_migrate::run(&db, &data_dir)?;   // legacy gamelib.db copy
//!         db::legacy::auto_import(&db, &data_dir)?;  // one-shot JSON import
//!         app.manage(db);
//!       })
//! ```
//!
//! Tauri commands extract the DB via
//! `app.state::<Db>().inner().clone()` so they can take it by
//! reference (avoids recompiling SP-style borrowing chains across
//! `.await`).

pub mod achievement_links;
pub mod achievements;
pub mod atomic;
pub mod emulators;
pub mod games;
pub mod kv;
pub mod legacy;
pub mod migrate;
pub mod mods;
pub mod news;
pub mod pool;
pub mod plugins;
pub mod schema;
pub mod secrets;
pub mod sessions;
pub mod sources;
pub mod split_migrate;
pub mod store_cache;
pub mod wishlist;

pub use pool::Db;

/// Convenience: open the per-domain databases under `app_data_dir`,
/// apply pending migrations, one-time-split any legacy `gamelib.db`,
/// and run the legacy JSON auto-import.
/// Returns the ready-to-`app.manage()` registry.
pub fn init(app_data_dir: &std::path::Path) -> Result<Db, String> {
    let db = Db::open(app_data_dir)?;
    migrate::run_migrations(&db)?;
    split_migrate::run(&db, app_data_dir)?;
    legacy::auto_import(&db, app_data_dir)?;
    Ok(db)
}
