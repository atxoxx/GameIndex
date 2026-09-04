//! Backup & restore of the local domain databases.
//!
//! Everything GameIndex persists lives in per-domain SQLite files under
//! `<app_data_dir>` (see `db/mod.rs`). A backup is a single `.gibak`
//! zip containing a consistent snapshot of the chosen domain databases
//! (by default every domain with data) — taken via SQLite's online
//! backup API, so WAL-mode writes are captured even mid-flight — plus
//! a small manifest describing the archive. Both create and restore
//! accept a domain subset so the user can pick what goes in / comes
//! back; `None` means all domains. Restore validates the archive first,
//! then streams the staged databases back into the live pools via the
//! same backup API (no file swapping, so it works on Windows where open
//! connections would block an `fs::copy`), and the frontend relaunches
//! the app so every pool re-opens cleanly.
//!
//! Credentials (Steam/Epic OAuth, debrid keys) deliberately stay in the
//! OS keychain and are never part of a backup; artwork, downloads and
//! screenshots are re-fetchable and also excluded.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, DatabaseName};
use serde::Serialize;
use tauri::Manager;

use crate::db::kv;
use crate::db::pool::{Db, SqlitePool};

/// Magic string written into the manifest so restore can distinguish a
/// GameIndex backup from an arbitrary zip.
const BACKUP_MAGIC: &str = "gameindex-backup";
/// Bumped when the on-disk backup layout changes incompatibly.
const BACKUP_FORMAT_VERSION: u32 = 1;

/// kv keys recording the last successful backup (for the status header).
const KV_LAST_AT: &str = "backup.last_at";
const KV_LAST_BYTES: &str = "backup.last_bytes";

/// Domain database files included in a backup, in display order.
pub const BACKUP_DOMAINS: &[&str] = &[
    "games",
    "sessions",
    "wishlist",
    "achievements",
    "emulators",
    "mods",
    "plugins",
    "news",
    "sources",
    "download_history",
    "store_cache",
    "kv",
];

/// One row of the backup overview: a domain + the live file's size.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DomainStatus {
    /// File stem, e.g. `"games"`.
    pub name: String,
    /// On-disk size of the live database file in bytes.
    pub size_bytes: u64,
}

/// Everything the Backup tab's overview section renders.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupStatus {
    pub last_backup_at: Option<u64>,
    pub last_backup_bytes: Option<u64>,
    pub domains: Vec<DomainStatus>,
}

/// Result of a create/restore operation.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupOutcome {
    pub file_path: String,
    pub size_bytes: u64,
    pub created_at: u64,
    /// Domain file stems that were written into / read from the archive.
    pub domains: Vec<String>,
}

/// What a `.gibak` archive contains — shown to the user before restore
/// so they can pick which domains to bring back.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInspect {
    pub created_at: u64,
    pub app_version: String,
    /// Domain file stems stored in the archive, in archive order.
    pub domains: Vec<String>,
}

// ─── Commands ─────────────────────────────────────────────────────────────────

/// Summary of what a backup would contain + when the last one was made.
#[tauri::command]
pub fn backup_get_status(app: tauri::AppHandle) -> Result<BackupStatus, String> {
    let db = state_db(&app)?;
    let data_dir = app_data_dir(&app)?;
    let last_at = read_u64(db, KV_LAST_AT)?;
    let last_bytes = read_u64(db, KV_LAST_BYTES)?;
    let mut domains = Vec::with_capacity(BACKUP_DOMAINS.len());
    for name in BACKUP_DOMAINS {
        let path = data_dir.join(format!("{name}.db"));
        let size_bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        domains.push(DomainStatus {
            name: (*name).to_string(),
            size_bytes,
        });
    }
    Ok(BackupStatus {
        last_backup_at: last_at,
        last_backup_bytes: last_bytes,
        domains,
    })
}

/// Peek inside a `.gibak` zip so the frontend can list what a restore
/// would bring back before anything is replaced.
#[tauri::command]
pub fn backup_inspect(source_path: String) -> Result<BackupInspect, String> {
    inspect_archive(&source_path)
}

/// Snapshot the selected domain databases (default: every domain with a
/// live file) into a `.gibak` zip at `target_path`.
#[tauri::command]
pub fn backup_create(
    app: tauri::AppHandle,
    target_path: String,
    domains: Option<Vec<String>>,
) -> Result<BackupOutcome, String> {
    let db = state_db(&app)?;
    let data_dir = app_data_dir(&app)?;
    let outcome = do_create(db, &data_dir, &target_path, domains.as_deref())?;
    // Recording the timestamp is best-effort — the archive itself is the
    // deliverable and is already on disk by now.
    let _ = kv::set(db, KV_LAST_AT, &outcome.created_at.to_string());
    let _ = kv::set(db, KV_LAST_BYTES, &outcome.size_bytes.to_string());
    Ok(outcome)
}

/// Validate a `.gibak` zip and restore the selected domains (default:
/// every domain the archive contains) into the live databases. The
/// frontend relaunches the app once this returns.
#[tauri::command]
pub fn backup_restore(
    app: tauri::AppHandle,
    source_path: String,
    domains: Option<Vec<String>>,
) -> Result<BackupOutcome, String> {
    let db = state_db(&app)?;
    let data_dir = app_data_dir(&app)?;
    let outcome = do_restore(db, &data_dir, &source_path, domains.as_deref())?;
    let _ = kv::set(db, KV_LAST_AT, &outcome.created_at.to_string());
    let _ = kv::set(db, KV_LAST_BYTES, &outcome.size_bytes.to_string());
    Ok(outcome)
}

// ─── Core logic (command wrappers are thin; tests hit these) ─────────────────

fn do_create(
    db: &Db,
    data_dir: &Path,
    target_path: &str,
    only: Option<&[String]>,
) -> Result<BackupOutcome, String> {
    // Reject unknown names up front so a stale selection can never
    // silently produce an archive missing an item the user asked for.
    if let Some(only) = only {
        for name in only {
            if !BACKUP_DOMAINS.contains(&name.as_str()) {
                return Err(format!("Unknown backup item: {name}"));
            }
        }
    }

    // Stage consistent snapshots of the selected domains that actually
    // have a file (fresh installs may never have touched some domains
    // yet). The online backup API reads through the WAL, so mid-write
    // data is captured correctly.
    let staging = tempfile::tempdir().map_err(|e| format!("backup staging: {e}"))?;
    let snapshots_dir = staging.path().join("domains");
    std::fs::create_dir_all(&snapshots_dir)
        .map_err(|e| format!("backup staging dir: {e}"))?;

    let mut backed: Vec<String> = Vec::with_capacity(BACKUP_DOMAINS.len());
    for name in BACKUP_DOMAINS {
        if let Some(only) = only {
            if !only.iter().any(|d| d == name) {
                continue;
            }
        }
        let live = data_dir.join(format!("{name}.db"));
        if !live.is_file() {
            continue;
        }
        let dest = snapshots_dir.join(format!("{name}.db"));
        snapshot_pool(db.pool(name).ok_or_else(|| format!("unknown domain: {name}"))?, &dest, name)?;
        backed.push((*name).to_string());
    }
    if backed.is_empty() {
        return Err("Nothing to back up yet".into());
    }

    let manifest = serde_json::json!({
        "format": BACKUP_MAGIC,
        "version": BACKUP_FORMAT_VERSION,
        "appVersion": env!("CARGO_PKG_VERSION"),
        "createdAt": unix_now(),
        "domains": backed,
    });

    // Assemble the zip: manifest + one snapshot per domain.
    let mut files: Vec<(String, Vec<u8>)> = Vec::with_capacity(backed.len() + 1);
    let manifest_bytes = serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?;
    files.push(("manifest.json".to_string(), manifest_bytes));
    for name in &backed {
        let snapshot = std::fs::read(snapshots_dir.join(format!("{name}.db")))
            .map_err(|e| format!("read snapshot {name}: {e}"))?;
        files.push((format!("domains/{name}.db"), snapshot));
    }

    let target = Path::new(target_path);
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|e| format!("backup output dir: {e}"))?;
        }
    }
    write_zip(target, &files)?;
    let size_bytes = std::fs::metadata(target).map(|m| m.len()).unwrap_or(0);

    Ok(BackupOutcome {
        file_path: target_path.to_string(),
        size_bytes,
        created_at: unix_now(),
        domains: backed,
    })
}

fn do_restore(
    db: &Db,
    data_dir: &Path,
    source_path: &str,
    only: Option<&[String]>,
) -> Result<BackupOutcome, String> {
    // Validate + extract into staging BEFORE touching any live file, so a
    // corrupt or foreign archive can never leave the app half-restored.
    let manifest = load_manifest(source_path)?;
    let available = manifest_domains(&manifest);
    if available.is_empty() {
        return Err("Backup contains no databases".into());
    }
    // Default restores everything in the archive; a requested subset is
    // checked against what the archive actually holds and kept in the
    // archive's own (display) order.
    let domains: Vec<String> = match only {
        Some(only) => {
            for name in only {
                if !available.contains(name) {
                    return Err(format!("Backup does not contain \"{name}\""));
                }
            }
            available
                .into_iter()
                .filter(|d| only.iter().any(|o| o == d))
                .collect()
        }
        None => available,
    };
    if domains.is_empty() {
        return Err("Nothing selected to restore".into());
    }

    let staging = tempfile::tempdir().map_err(|e| format!("restore staging: {e}"))?;
    let file = std::fs::File::open(source_path).map_err(|e| format!("open backup: {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("read backup archive: {e}"))?;
    for name in &domains {
        let entry_name = format!("domains/{name}.db");
        let mut entry = archive
            .by_name(&entry_name)
            .map_err(|_| format!("backup is missing {entry_name}"))?;
        let target = staging.path().join(format!("{name}.db"));
        let mut out = std::fs::File::create(&target).map_err(|e| format!("stage {name}: {e}"))?;
        std::io::copy(&mut entry, &mut out).map_err(|e| format!("extract {name}: {e}"))?;
    }

    // Every staged file must be a real, non-corrupt SQLite database with
    // actual tables before we commit to the restore.
    for name in &domains {
        validate_db(&staging.path().join(format!("{name}.db")), name)?;
    }

    // Flush WALs so the restore lands on a clean base, then stream each
    // staged database back into the live pool via SQLite's backup API —
    // this works even while other connections hold the file open.
    checkpoint_all(db)?;
    for name in &domains {
        let src = staging.path().join(format!("{name}.db"));
        let mut conn = db
            .pool(name)
            .ok_or_else(|| format!("unknown domain: {name}"))?
            .get()
            .map_err(|e| format!("acquire {name} conn: {e}"))?;
        conn.restore(DatabaseName::Main, &src, None::<fn(rusqlite::backup::Progress)>)
            .map_err(|e| format!("restore {name}: {e}"))?;
        // Drop the old WAL/shm sidecars — they describe pre-restore pages.
        let _ = std::fs::remove_file(data_dir.join(format!("{name}.db-wal")));
        let _ = std::fs::remove_file(data_dir.join(format!("{name}.db-shm")));
    }

    let size_bytes = std::fs::metadata(source_path).map(|m| m.len()).unwrap_or(0);
    Ok(BackupOutcome {
        file_path: source_path.to_string(),
        size_bytes,
        created_at: unix_now(),
        domains,
    })
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn state_db(app: &tauri::AppHandle) -> Result<&Db, String> {
    let state: tauri::State<'_, Db> = app.state();
    Ok(state.inner())
}

fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

fn snapshot_pool(pool: &SqlitePool, dest: &Path, name: &str) -> Result<(), String> {
    let conn = pool.get().map_err(|e| format!("acquire {name} conn: {e}"))?;
    conn.backup(DatabaseName::Main, dest, None)
        .map_err(|e| format!("snapshot {name}: {e}"))
}

fn validate_db(path: &Path, name: &str) -> Result<(), String> {
    let conn = Connection::open(path).map_err(|e| format!("open restored {name}: {e}"))?;
    let integrity: String = conn
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(|e| format!("integrity {name}: {e}"))?;
    if !integrity.starts_with("ok") {
        return Err(format!("restored {name} failed integrity check: {integrity}"));
    }
    let tables: u64 = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type IN ('table','view')",
            [],
            |r| r.get(0),
        )
        .map_err(|e| format!("schema {name}: {e}"))?;
    if tables == 0 {
        return Err(format!("restored {name} contains no tables"));
    }
    Ok(())
}

fn checkpoint_all(db: &Db) -> Result<(), String> {
    for name in BACKUP_DOMAINS {
        let Some(pool) = db.pool(name) else { continue };
        let conn = pool.get().map_err(|e| format!("acquire {name} conn: {e}"))?;
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
            .map_err(|e| format!("checkpoint {name}: {e}"))?;
    }
    Ok(())
}

/// Preview an archive: header fields + the domains stored in it.
fn inspect_archive(source_path: &str) -> Result<BackupInspect, String> {
    let manifest = load_manifest(source_path)?;
    Ok(BackupInspect {
        created_at: manifest["createdAt"].as_u64().unwrap_or(0),
        app_version: manifest["appVersion"].as_str().unwrap_or_default().to_string(),
        domains: manifest_domains(&manifest),
    })
}

/// Read a manifest and reject anything that is not a GameIndex backup of
/// the current format version.
fn load_manifest(path: &str) -> Result<serde_json::Value, String> {
    let manifest = read_manifest(path)?;
    if manifest["format"].as_str() != Some(BACKUP_MAGIC) {
        return Err("Not a GameIndex backup file".into());
    }
    if manifest["version"].as_u64() != Some(BACKUP_FORMAT_VERSION as u64) {
        return Err(format!(
            "Unsupported backup version: {version}",
            version = manifest["version"]
        ));
    }
    Ok(manifest)
}

/// Domain file stems listed in a manifest, deduplicated and restricted to
/// known domains, preserving the manifest's own order.
fn manifest_domains(manifest: &serde_json::Value) -> Vec<String> {
    let mut domains: Vec<String> = Vec::new();
    if let Some(list) = manifest["domains"].as_array() {
        for item in list {
            if let Some(name) = item.as_str() {
                if !name.is_empty()
                    && BACKUP_DOMAINS.contains(&name)
                    && !domains.contains(&name.to_string())
                {
                    domains.push(name.to_string());
                }
            }
        }
    }
    domains
}

fn read_manifest(path: &str) -> Result<serde_json::Value, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("open backup file: {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("read backup archive: {e}"))?;
    let mut entry = archive
        .by_name("manifest.json")
        .map_err(|_| "Not a GameIndex backup file (missing manifest.json)".to_string())?;
    let mut buf = String::new();
    entry
        .read_to_string(&mut buf)
        .map_err(|e| format!("read manifest: {e}"))?;
    serde_json::from_str(&buf).map_err(|e| format!("manifest parse: {e}"))
}

fn write_zip(target: &Path, files: &[(String, Vec<u8>)]) -> Result<(), String> {
    let file = std::fs::File::create(target).map_err(|e| format!("create archive: {e}"))?;
    let mut zip = zip::ZipWriter::new(file);
    for (name, bytes) in files {
        zip.start_file(name.as_str(), zip_opts())
            .map_err(|e| format!("zip entry {name}: {e}"))?;
        zip.write_all(bytes).map_err(|e| format!("zip write {name}: {e}"))?;
    }
    zip.finish().map_err(|e| format!("zip finish: {e}"))?;
    Ok(())
}

fn zip_opts() -> zip::write::SimpleFileOptions {
    zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
}

fn read_u64(db: &Db, key: &str) -> Result<Option<u64>, String> {
    Ok(match kv::get(db, key)? {
        Some(v) => v.trim().parse::<u64>().ok(),
        None => None,
    })
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::kv;

    /// Mirrors production startup: open pools then run per-domain
    /// migrations (plain `Db::open` leaves the tables uncreated).
    fn prep() -> (tempfile::TempDir, Db) {
        let dir = tempfile::tempdir().unwrap();
        let db = crate::db::init(dir.path()).unwrap();
        (dir, db)
    }

    #[test]
    fn backup_roundtrip_restores_domain_data() {
        let (dir, db) = prep();
        kv::set(&db, "test.marker", "hello-backup").unwrap();
        let target = dir.path().join("out.gibak");

        do_create(&db, dir.path(), target.to_str().unwrap(), None).unwrap();

        // Wipe the marker, then prove restore brings it back.
        kv::delete(&db, "test.marker").unwrap();
        assert_eq!(kv::get(&db, "test.marker").unwrap(), None);

        do_restore(&db, dir.path(), target.to_str().unwrap(), None).unwrap();
        assert_eq!(kv::get(&db, "test.marker").unwrap(), Some("hello-backup".into()));
    }

    #[test]
    fn restore_rejects_non_zip_file() {
        let (dir, db) = prep();
        let junk = dir.path().join("not-a-backup.gibak");
        std::fs::write(&junk, b"this is not a zip file at all").unwrap();
        let err = do_restore(&db, dir.path(), junk.to_str().unwrap(), None).unwrap_err();
        assert!(err.contains("archive") || err.contains("backup file"), "unexpected err: {err}");
    }

    #[test]
    fn restore_rejects_backup_with_corrupt_database() {
        let (dir, _db) = prep();
        // Valid manifest + valid zip framing, but the "database" payload
        // is garbage → validation must refuse before touching anything.
        let manifest = serde_json::json!({
            "format": BACKUP_MAGIC,
            "version": BACKUP_FORMAT_VERSION,
            "appVersion": "test",
            "createdAt": 0,
            "domains": ["games"],
        });
        let fake = dir.path().join("corrupt.gibak");
        let manifest_bytes = serde_json::to_vec_pretty(&manifest).unwrap();
        write_zip(
            &fake,
            &[
                ("manifest.json".to_string(), manifest_bytes),
                ("domains/games.db".to_string(), b"not a sqlite database".to_vec()),
            ],
        )
        .unwrap();

        let (restore_dir, db) = prep();
        let err = do_restore(&db, restore_dir.path(), fake.to_str().unwrap(), None).unwrap_err();
        assert!(err.contains("games"), "unexpected err: {err}");
    }

    #[test]
    fn create_with_selected_domains_archives_only_them() {
        let (dir, db) = prep();
        kv::set(&db, "test.marker", "x").unwrap();
        let target = dir.path().join("subset.gibak");

        let outcome = do_create(
            &db,
            dir.path(),
            target.to_str().unwrap(),
            Some(&["kv".to_string(), "games".to_string()]),
        )
        .unwrap();
        // Stems come back in BACKUP_DOMAINS display order, not request order.
        assert_eq!(outcome.domains, vec!["games", "kv"]);

        let inspect = inspect_archive(target.to_str().unwrap()).unwrap();
        assert_eq!(inspect.domains, vec!["games", "kv"]);
        assert!(inspect.created_at > 0);
        assert!(!inspect.app_version.is_empty());
    }

    #[test]
    fn create_rejects_unknown_domain() {
        let (dir, db) = prep();
        let target = dir.path().join("bad.gibak");
        let err = do_create(
            &db,
            dir.path(),
            target.to_str().unwrap(),
            Some(&["not_a_domain".to_string()]),
        )
        .unwrap_err();
        assert!(err.contains("not_a_domain"), "unexpected err: {err}");
    }

    #[test]
    fn restore_with_selected_domains_restores_only_them() {
        let (dir, db) = prep();
        kv::set(&db, "test.marker", "hello").unwrap();
        let target = dir.path().join("full.gibak");
        do_create(&db, dir.path(), target.to_str().unwrap(), None).unwrap();

        // Restoring only "games" must leave the kv marker untouched.
        let (dir2, db2) = prep();
        do_restore(
            &db2,
            dir2.path(),
            target.to_str().unwrap(),
            Some(&["games".to_string()]),
        )
        .unwrap();
        assert_eq!(kv::get(&db2, "test.marker").unwrap(), None);

        // Restoring only "kv" brings the marker back.
        let (dir3, db3) = prep();
        do_restore(
            &db3,
            dir3.path(),
            target.to_str().unwrap(),
            Some(&["kv".to_string()]),
        )
        .unwrap();
        assert_eq!(kv::get(&db3, "test.marker").unwrap(), Some("hello".into()));
    }

    #[test]
    fn restore_rejects_domain_not_in_archive() {
        let (dir, db) = prep();
        let target = dir.path().join("subset.gibak");
        do_create(
            &db,
            dir.path(),
            target.to_str().unwrap(),
            Some(&["kv".to_string()]),
        )
        .unwrap();

        let (restore_dir, restore_db) = prep();
        let err = do_restore(
            &restore_db,
            restore_dir.path(),
            target.to_str().unwrap(),
            Some(&["games".to_string()]),
        )
        .unwrap_err();
        assert!(err.contains("games"), "unexpected err: {err}");
    }

    #[test]
    fn inspect_rejects_foreign_zip() {
        let (dir, _db) = prep();
        let junk = dir.path().join("foreign.gibak");
        std::fs::write(&junk, b"definitely not a zip").unwrap();
        let err = inspect_archive(junk.to_str().unwrap()).unwrap_err();
        assert!(err.contains("archive") || err.contains("backup file"), "unexpected err: {err}");
    }
}