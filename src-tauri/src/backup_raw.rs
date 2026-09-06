//! Streaming raw data backup & restore engine.
//!
//! Rather than taking binary SQLite page snapshots (which break across schema
//! migrations and bloat archives with indexes and ephemeral caches), this
//! engine exports pure domain records as newline-delimited JSON (NDJSON)
//! inside a standard compressed `.gibak` (Zip) container.
//!
//! Physical user assets (custom covers/logos in `<app_data_dir>/artwork/` and
//! user plugins in `<app_data_dir>/plugins/`) are bundled alongside the data.
//!
//! Restoring supports both:
//! - "replace": wipes selected domain tables first, restoring a clean archive state.
//! - "merge": non-destructive upsert, leaving games, sessions, and configs added on
//!   the current device intact.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::backup::{BackupOutcome, BackupProgress, BACKUP_DOMAINS};
use crate::db::achievement_links::{self, AchievementLink};
use crate::db::achievements;
use crate::db::emulators::{self, EmulatorRow};
use crate::db::games::{self, GameRow};
use crate::db::kv;
use crate::db::mods::{self, GameModSettingsRow, ModProfileRow, ModRow};
use crate::db::plugins::{self, PluginRow};
use crate::db::pool::Db;
use crate::db::sessions::{self, SessionRecord};
use crate::db::sources;
use crate::source_manager::SourceLink;

pub const BACKUP_RAW_MAGIC: &str = "gameindex-raw-backup";
pub const BACKUP_RAW_FORMAT_VERSION: u32 = 2;

/// Manifest header written to `manifest.json` inside the raw `.gibak` archive.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RawManifest {
    pub format: String,
    pub version: u32,
    pub app_version: String,
    pub created_at: u64,
    pub domains: Vec<String>,
    pub counts: HashMap<String, u64>,
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn zip_file_opts() -> zip::write::SimpleFileOptions {
    zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
}

/// Count primary entities in a domain for quick status rendering and manifest metrics.
pub fn count_domain_items(db: &Db, domain: &str) -> u64 {
    match domain {
        "games" => db
            .games()
            .ok()
            .and_then(|c| {
                c.query_row("SELECT count(*) FROM games", [], |r| r.get::<_, i64>(0))
                    .ok()
            })
            .unwrap_or(0)
            .max(0) as u64,
        "sessions" => sessions::count_all(db).unwrap_or(0),
        "wishlist" => db
            .wishlist()
            .ok()
            .and_then(|c| {
                c.query_row("SELECT count(*) FROM wishlist", [], |r| r.get::<_, i64>(0))
                    .ok()
            })
            .unwrap_or(0)
            .max(0) as u64,
        "achievements" => db
            .achievements()
            .ok()
            .and_then(|c| {
                c.query_row(
                    "SELECT count(*) FROM achievements_cache",
                    [],
                    |r| r.get::<_, i64>(0),
                )
                .ok()
            })
            .unwrap_or(0)
            .max(0) as u64,
        "emulators" => db
            .emulators()
            .ok()
            .and_then(|c| {
                c.query_row("SELECT count(*) FROM emulators", [], |r| r.get::<_, i64>(0))
                    .ok()
            })
            .unwrap_or(0)
            .max(0) as u64,
        "mods" => db
            .mods()
            .ok()
            .and_then(|c| {
                c.query_row("SELECT count(*) FROM mods", [], |r| r.get::<_, i64>(0))
                    .ok()
            })
            .unwrap_or(0)
            .max(0) as u64,
        "plugins" => db
            .plugins()
            .ok()
            .and_then(|c| {
                c.query_row("SELECT count(*) FROM plugins", [], |r| r.get::<_, i64>(0))
                    .ok()
            })
            .unwrap_or(0)
            .max(0) as u64,
        "sources" => db
            .sources()
            .ok()
            .and_then(|c| {
                c.query_row("SELECT count(*) FROM sources", [], |r| r.get::<_, i64>(0))
                    .ok()
            })
            .unwrap_or(0)
            .max(0) as u64,
        "download_history" => db
            .download_history()
            .ok()
            .and_then(|c| {
                c.query_row(
                    "SELECT count(*) FROM download_history",
                    [],
                    |r| r.get::<_, i64>(0),
                )
                .ok()
            })
            .unwrap_or(0)
            .max(0) as u64,
        "kv" => db
            .kv()
            .ok()
            .and_then(|c| {
                c.query_row("SELECT count(*) FROM kv_store", [], |r| r.get::<_, i64>(0))
                    .ok()
            })
            .unwrap_or(0)
            .max(0) as u64,
        "store_cache" => db
            .store_cache()
            .ok()
            .and_then(|c| {
                c.query_row("SELECT count(*) FROM store_cache", [], |r| r.get::<_, i64>(0))
                    .ok()
            })
            .unwrap_or(0)
            .max(0) as u64,
        "news" => db
            .news()
            .ok()
            .and_then(|c| {
                c.query_row("SELECT count(*) FROM news_cache", [], |r| r.get::<_, i64>(0))
                    .ok()
            })
            .unwrap_or(0)
            .max(0) as u64,
        _ => 0,
    }
}

/// Create a raw data `.gibak` archive streaming records into compressed NDJSON entries.
pub fn create_raw_backup<F>(
    db: &Db,
    data_dir: &Path,
    target_path: &str,
    only: Option<&[String]>,
    mut on_progress: Option<F>,
) -> Result<BackupOutcome, String>
where
    F: FnMut(BackupProgress),
{
    // Filter chosen domains
    let mut chosen_domains = Vec::new();
    for name in BACKUP_DOMAINS {
        if let Some(only) = only {
            if !only.iter().any(|d| d == name) {
                continue;
            }
        }
        chosen_domains.push(*name);
    }

    if chosen_domains.is_empty() {
        return Err("Nothing selected to back up".into());
    }

    if let Some(ref mut cb) = on_progress {
        cb(BackupProgress {
            phase: "preparing".into(),
            current_domain: None,
            domain_index: 0,
            total_domains: chosen_domains.len(),
            percent: 5,
            bytes_written: 0,
            message: "Analyzing library records...".into(),
        });
    }

    // Compute entity counts
    let mut domain_counts = HashMap::new();
    for &d in &chosen_domains {
        domain_counts.insert(d.to_string(), count_domain_items(db, d));
    }

    let manifest = RawManifest {
        format: BACKUP_RAW_MAGIC.to_string(),
        version: BACKUP_RAW_FORMAT_VERSION,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        created_at: unix_now(),
        domains: chosen_domains.iter().map(|&s| s.to_string()).collect(),
        counts: domain_counts,
    };

    let target = Path::new(target_path);
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|e| format!("backup output dir: {e}"))?;
        }
    }

    let file = std::fs::File::create(target).map_err(|e| format!("create archive: {e}"))?;
    let mut zip = zip::ZipWriter::new(file);

    // 1. Write manifest.json
    zip.start_file("manifest.json", zip_file_opts())
        .map_err(|e| format!("zip manifest entry: {e}"))?;
    let manifest_bytes = serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?;
    zip.write_all(&manifest_bytes)
        .map_err(|e| format!("zip manifest write: {e}"))?;

    let total_domains = chosen_domains.len();
    let mut asset_paths: Vec<(String, PathBuf)> = Vec::new();

    // 2. Stream domain records as NDJSON
    for (idx, &domain) in chosen_domains.iter().enumerate() {
        let percent = 10 + ((idx as f32 / total_domains as f32) * 70.0) as u8;
        if let Some(ref mut cb) = on_progress {
            cb(BackupProgress {
                phase: "exporting".into(),
                current_domain: Some(domain.to_string()),
                domain_index: idx + 1,
                total_domains,
                percent,
                bytes_written: 0,
                message: format!("Exporting {domain} raw records..."),
            });
        }

        match domain {
            "games" => {
                zip.start_file("data/games.ndjson", zip_file_opts())
                    .map_err(|e| format!("zip games entry: {e}"))?;
                let games_list = games::list_all(db)?;
                for g in &games_list {
                    let line = serde_json::to_string(g).map_err(|e| e.to_string())?;
                    zip.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
                    zip.write_all(b"\n").map_err(|e| e.to_string())?;

                    // Check for custom artwork assets stored on disk
                    for url_opt in [&g.cover_art_url, &g.icon_url, &g.banner_url, &g.logo_url] {
                        if let Some(rel) = url_opt {
                            if rel.starts_with("artwork/") {
                                let disk_path = data_dir.join(rel);
                                if disk_path.is_file() {
                                    asset_paths.push((format!("assets/{rel}"), disk_path));
                                }
                            }
                        }
                    }
                }
            }
            "sessions" => {
                zip.start_file("data/sessions.ndjson", zip_file_opts())
                    .map_err(|e| format!("zip sessions entry: {e}"))?;
                let sessions_list = sessions::list_all(db)?;
                for s in &sessions_list {
                    let line = serde_json::to_string(s).map_err(|e| e.to_string())?;
                    zip.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
                    zip.write_all(b"\n").map_err(|e| e.to_string())?;
                }
            }
            "wishlist" => {
                zip.start_file("data/wishlist.ndjson", zip_file_opts())
                    .map_err(|e| format!("zip wishlist entry: {e}"))?;
                let wishlist_items = crate::db::wishlist::list(db)?;
                for (slug, payload, added_at) in &wishlist_items {
                    let entry = serde_json::json!({
                        "slug": slug,
                        "payloadJson": payload,
                        "addedAt": added_at,
                    });
                    let line = serde_json::to_string(&entry).map_err(|e| e.to_string())?;
                    zip.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
                    zip.write_all(b"\n").map_err(|e| e.to_string())?;
                }
            }
            "emulators" => {
                zip.start_file("data/emulators.ndjson", zip_file_opts())
                    .map_err(|e| format!("zip emulators entry: {e}"))?;
                let emus = emulators::list_all(db)?;
                for emu in &emus {
                    let line = serde_json::to_string(emu).map_err(|e| e.to_string())?;
                    zip.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
                    zip.write_all(b"\n").map_err(|e| e.to_string())?;
                }
            }
            "mods" => {
                zip.start_file("data/mods.ndjson", zip_file_opts())
                    .map_err(|e| format!("zip mods entry: {e}"))?;
                let mod_rows = mods::list_all_mods(db)?;
                for m in &mod_rows {
                    let line = serde_json::to_string(m).map_err(|e| e.to_string())?;
                    zip.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
                    zip.write_all(b"\n").map_err(|e| e.to_string())?;
                }

                zip.start_file("data/mod_profiles.ndjson", zip_file_opts())
                    .map_err(|e| format!("zip mod_profiles entry: {e}"))?;
                let profiles = mods::list_all_profiles(db)?;
                for p in &profiles {
                    let line = serde_json::to_string(p).map_err(|e| e.to_string())?;
                    zip.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
                    zip.write_all(b"\n").map_err(|e| e.to_string())?;
                }

                zip.start_file("data/mod_settings.ndjson", zip_file_opts())
                    .map_err(|e| format!("zip mod_settings entry: {e}"))?;
                let settings = mods::list_all_settings(db)?;
                for s in &settings {
                    let line = serde_json::to_string(s).map_err(|e| e.to_string())?;
                    zip.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
                    zip.write_all(b"\n").map_err(|e| e.to_string())?;
                }
            }
            "plugins" => {
                zip.start_file("data/plugins.ndjson", zip_file_opts())
                    .map_err(|e| format!("zip plugins entry: {e}"))?;
                let plugin_list = plugins::list_plugins(db)?;
                for p in &plugin_list {
                    let line = serde_json::to_string(p).map_err(|e| e.to_string())?;
                    zip.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
                    zip.write_all(b"\n").map_err(|e| e.to_string())?;

                    let js_file = data_dir.join("plugins").join(format!("{}.js", p.id));
                    if js_file.is_file() {
                        asset_paths.push((format!("assets/plugins/{}.js", p.id), js_file));
                    }
                }
            }
            "sources" => {
                zip.start_file("data/sources.ndjson", zip_file_opts())
                    .map_err(|e| format!("zip sources entry: {e}"))?;
                let src_list = sources::list_sources(db)?;
                for s in &src_list {
                    let line = serde_json::to_string(s).map_err(|e| e.to_string())?;
                    zip.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
                    zip.write_all(b"\n").map_err(|e| e.to_string())?;
                }
            }
            "achievements" => {
                zip.start_file("data/achievement_links.ndjson", zip_file_opts())
                    .map_err(|e| format!("zip achievement_links entry: {e}"))?;
                let links = achievement_links::list_all_links(db)?;
                for l in &links {
                    let line = serde_json::to_string(l).map_err(|e| e.to_string())?;
                    zip.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
                    zip.write_all(b"\n").map_err(|e| e.to_string())?;
                }

                zip.start_file("data/achievements_cache.ndjson", zip_file_opts())
                    .map_err(|e| format!("zip achievements_cache entry: {e}"))?;
                let caches = achievements::list_all(db)?;
                for (gid, appid, payload, source, provider) in &caches {
                    let entry = serde_json::json!({
                        "gameId": gid,
                        "steamAppId": appid,
                        "payloadJson": payload,
                        "source": source,
                        "providerId": provider,
                    });
                    let line = serde_json::to_string(&entry).map_err(|e| e.to_string())?;
                    zip.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
                    zip.write_all(b"\n").map_err(|e| e.to_string())?;
                }
            }
            "download_history" => {
                zip.start_file("data/download_history.ndjson", zip_file_opts())
                    .map_err(|e| format!("zip download_history entry: {e}"))?;
                let history = crate::db::download_history::list_all(db)?;
                for h in &history {
                    let line = serde_json::to_string(h).map_err(|e| e.to_string())?;
                    zip.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
                    zip.write_all(b"\n").map_err(|e| e.to_string())?;
                }
            }
            "kv" => {
                zip.start_file("data/kv.ndjson", zip_file_opts())
                    .map_err(|e| format!("zip kv entry: {e}"))?;
                let entries = kv::list_all(db)?;
                for (k, v, updated_at) in &entries {
                    let entry = serde_json::json!({
                        "key": k,
                        "value": v,
                        "updatedAt": updated_at,
                    });
                    let line = serde_json::to_string(&entry).map_err(|e| e.to_string())?;
                    zip.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
                    zip.write_all(b"\n").map_err(|e| e.to_string())?;
                }
            }
            _ => {}
        }
    }

    // 3. Write user assets (artwork and plugin scripts)
    if !asset_paths.is_empty() {
        if let Some(ref mut cb) = on_progress {
            cb(BackupProgress {
                phase: "assets".into(),
                current_domain: None,
                domain_index: total_domains,
                total_domains,
                percent: 85,
                bytes_written: 0,
                message: format!("Bundling {} custom assets...", asset_paths.len()),
            });
        }
        for (archive_path, disk_path) in asset_paths {
            if let Ok(bytes) = std::fs::read(&disk_path) {
                let _ = zip.start_file(&archive_path, zip_file_opts());
                let _ = zip.write_all(&bytes);
            }
        }
    }

    zip.finish().map_err(|e| format!("zip finish: {e}"))?;
    let size_bytes = std::fs::metadata(target).map(|m| m.len()).unwrap_or(0);

    if let Some(ref mut cb) = on_progress {
        cb(BackupProgress {
            phase: "complete".into(),
            current_domain: None,
            domain_index: total_domains,
            total_domains,
            percent: 100,
            bytes_written: size_bytes,
            message: "Backup created successfully".into(),
        });
    }

    Ok(BackupOutcome {
        file_path: target_path.to_string(),
        size_bytes,
        created_at: manifest.created_at,
        domains: chosen_domains.iter().map(|&s| s.to_string()).collect(),
    })
}

/// Restore a raw data `.gibak` archive. Supports both "replace" and "merge" modes.
pub fn restore_raw_backup<F>(
    db: &Db,
    data_dir: &Path,
    source_path: &str,
    domains: Option<&[String]>,
    mode: &str,
    mut on_progress: Option<F>,
) -> Result<BackupOutcome, String>
where
    F: FnMut(BackupProgress),
{
    let file = std::fs::File::open(source_path).map_err(|e| format!("open backup: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("read backup archive: {e}"))?;

    // Read manifest
    let manifest: RawManifest = {
        let mut entry = archive
            .by_name("manifest.json")
            .map_err(|_| "Missing manifest.json in archive".to_string())?;
        let mut buf = String::new();
        entry.read_to_string(&mut buf).map_err(|e| e.to_string())?;
        serde_json::from_str(&buf).map_err(|e| format!("manifest parse: {e}"))?
    };

    let available = manifest.domains;
    let selected_domains: Vec<String> = match domains {
        Some(only) => available
            .into_iter()
            .filter(|d| only.iter().any(|o| o == d))
            .collect(),
        None => available,
    };

    if selected_domains.is_empty() {
        return Err("Nothing selected to restore".into());
    }

    let replace_mode = mode != "merge";
    let total_domains = selected_domains.len();

    for (idx, domain) in selected_domains.iter().enumerate() {
        let percent = 10 + ((idx as f32 / total_domains as f32) * 70.0) as u8;
        if let Some(ref mut cb) = on_progress {
            cb(BackupProgress {
                phase: "restoring".into(),
                current_domain: Some(domain.clone()),
                domain_index: idx + 1,
                total_domains,
                percent,
                bytes_written: 0,
                message: format!("Restoring {domain} records ({mode} mode)..."),
            });
        }

        match domain.as_str() {
            "games" => {
                if let Ok(entry) = archive.by_name("data/games.ndjson") {
                    let reader = BufReader::new(entry);
                    let mut rows: Vec<GameRow> = Vec::new();
                    for line in reader.lines() {
                        let l = line.map_err(|e| e.to_string())?;
                        if l.trim().is_empty() {
                            continue;
                        }
                        if let Ok(row) = serde_json::from_str::<GameRow>(&l) {
                            rows.push(row);
                        }
                    }
                    games::upsert_batch(db, &rows, replace_mode)?;
                }
            }
            "sessions" => {
                if let Ok(entry) = archive.by_name("data/sessions.ndjson") {
                    let reader = BufReader::new(entry);
                    let mut records: Vec<SessionRecord> = Vec::new();
                    for line in reader.lines() {
                        let l = line.map_err(|e| e.to_string())?;
                        if l.trim().is_empty() {
                            continue;
                        }
                        if let Ok(record) = serde_json::from_str::<SessionRecord>(&l) {
                            records.push(record);
                        }
                    }
                    sessions::insert_batch(db, &records, replace_mode)?;
                }
            }
            "wishlist" => {
                if replace_mode {
                    let _ = crate::db::wishlist::clear(db);
                }
                if let Ok(entry) = archive.by_name("data/wishlist.ndjson") {
                    let reader = BufReader::new(entry);
                    for line in reader.lines() {
                        let l = line.map_err(|e| e.to_string())?;
                        if l.trim().is_empty() {
                            continue;
                        }
                        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&l) {
                            let slug = val["slug"].as_str().unwrap_or_default();
                            let payload = val["payloadJson"].as_str().unwrap_or_default();
                            let added_at = val["addedAt"].as_u64().unwrap_or(0);
                            if !slug.is_empty() {
                                let _ = crate::db::wishlist::upsert(db, slug, payload, added_at);
                            }
                        }
                    }
                }
            }
            "emulators" => {
                if replace_mode {
                    if let Ok(conn) = db.emulators() {
                        let _ = conn.execute("DELETE FROM emulators", []);
                    }
                }
                if let Ok(entry) = archive.by_name("data/emulators.ndjson") {
                    let reader = BufReader::new(entry);
                    for line in reader.lines() {
                        let l = line.map_err(|e| e.to_string())?;
                        if l.trim().is_empty() {
                            continue;
                        }
                        if let Ok(row) = serde_json::from_str::<EmulatorRow>(&l) {
                            let _ = emulators::upsert_one(db, &row);
                        }
                    }
                }
            }
            "mods" => {
                if replace_mode {
                    if let Ok(conn) = db.mods() {
                        let _ = conn.execute("DELETE FROM mods", []);
                        let _ = conn.execute("DELETE FROM mod_profiles", []);
                        let _ = conn.execute("DELETE FROM game_mod_settings", []);
                    }
                }
                if let Ok(entry) = archive.by_name("data/mods.ndjson") {
                    let reader = BufReader::new(entry);
                    for line in reader.lines() {
                        let l = line.map_err(|e| e.to_string())?;
                        if l.trim().is_empty() {
                            continue;
                        }
                        if let Ok(row) = serde_json::from_str::<ModRow>(&l) {
                            let _ = mods::upsert_one(db, &row);
                        }
                    }
                }
                if let Ok(entry) = archive.by_name("data/mod_profiles.ndjson") {
                    let reader = BufReader::new(entry);
                    for line in reader.lines() {
                        let l = line.map_err(|e| e.to_string())?;
                        if l.trim().is_empty() {
                            continue;
                        }
                        if let Ok(row) = serde_json::from_str::<ModProfileRow>(&l) {
                            let _ = mods::upsert_profile(db, &row);
                        }
                    }
                }
                if let Ok(entry) = archive.by_name("data/mod_settings.ndjson") {
                    let reader = BufReader::new(entry);
                    for line in reader.lines() {
                        let l = line.map_err(|e| e.to_string())?;
                        if l.trim().is_empty() {
                            continue;
                        }
                        if let Ok(row) = serde_json::from_str::<GameModSettingsRow>(&l) {
                            let _ = mods::upsert_settings(db, &row);
                        }
                    }
                }
            }
            "plugins" => {
                if replace_mode {
                    if let Ok(conn) = db.plugins() {
                        let _ = conn.execute("DELETE FROM plugins", []);
                    }
                }
                if let Ok(entry) = archive.by_name("data/plugins.ndjson") {
                    let reader = BufReader::new(entry);
                    for line in reader.lines() {
                        let l = line.map_err(|e| e.to_string())?;
                        if l.trim().is_empty() {
                            continue;
                        }
                        if let Ok(row) = serde_json::from_str::<PluginRow>(&l) {
                            let _ = plugins::upsert_plugin(db, &row);
                        }
                    }
                }
            }
            "sources" => {
                if replace_mode {
                    if let Ok(conn) = db.sources() {
                        let _ = conn.execute("DELETE FROM sources", []);
                    }
                }
                if let Ok(entry) = archive.by_name("data/sources.ndjson") {
                    let reader = BufReader::new(entry);
                    for line in reader.lines() {
                        let l = line.map_err(|e| e.to_string())?;
                        if l.trim().is_empty() {
                            continue;
                        }
                        if let Ok(row) = serde_json::from_str::<SourceLink>(&l) {
                            let _ = sources::upsert_source(db, &row);
                        }
                    }
                }
            }
            "achievements" => {
                if replace_mode {
                    if let Ok(conn) = db.achievements() {
                        let _ = conn.execute("DELETE FROM achievement_links", []);
                        let _ = conn.execute("DELETE FROM achievements_cache", []);
                    }
                }
                if let Ok(entry) = archive.by_name("data/achievement_links.ndjson") {
                    let reader = BufReader::new(entry);
                    for line in reader.lines() {
                        let l = line.map_err(|e| e.to_string())?;
                        if l.trim().is_empty() {
                            continue;
                        }
                        if let Ok(row) = serde_json::from_str::<AchievementLink>(&l) {
                            let _ = achievement_links::upsert_link(db, &row);
                        }
                    }
                }
                if let Ok(entry) = archive.by_name("data/achievements_cache.ndjson") {
                    let reader = BufReader::new(entry);
                    for line in reader.lines() {
                        let l = line.map_err(|e| e.to_string())?;
                        if l.trim().is_empty() {
                            continue;
                        }
                        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&l) {
                            let gid = val["gameId"].as_str().unwrap_or_default();
                            let appid = val["steamAppId"].as_u64().unwrap_or(0) as u32;
                            let payload = val["payloadJson"].as_str().unwrap_or_default();
                            let source = val["source"].as_str().unwrap_or("steam");
                            let provider = val["providerId"].as_str();
                            if !gid.is_empty() {
                                let _ = achievements::upsert(
                                    db,
                                    gid,
                                    appid,
                                    payload,
                                    unix_now(),
                                    source,
                                    provider,
                                );
                            }
                        }
                    }
                }
            }
            "download_history" => {
                if let Ok(entry) = archive.by_name("data/download_history.ndjson") {
                    let reader = BufReader::new(entry);
                    if let Ok(conn) = db.download_history() {
                        if replace_mode {
                            let _ = conn.execute("DELETE FROM download_history", []);
                        }
                        for line in reader.lines() {
                            let l = line.map_err(|e| e.to_string())?;
                            if l.trim().is_empty() {
                                continue;
                            }
                            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&l) {
                                let did = val["downloadId"].as_str().unwrap_or_default();
                                if !did.is_empty() {
                                    let _ = conn.execute(
                                        "INSERT OR REPLACE INTO download_history(
                                            download_id, kind, name, source_name, save_path, downloaded,
                                            total_size, status, debrid_cached, auto_extract, extracted,
                                            added_at, completed_at, peak_speed
                                         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
                                        params![
                                            did,
                                            val["kind"].as_str().unwrap_or("direct"),
                                            val["name"].as_str().unwrap_or_default(),
                                            val["sourceName"].as_str().unwrap_or_default(),
                                            val["savePath"].as_str().unwrap_or_default(),
                                            val["downloaded"].as_i64().unwrap_or(0),
                                            val["totalSize"].as_i64(),
                                            serde_json::to_string(&val["status"]).unwrap_or_default(),
                                            val["debridCached"].as_i64(),
                                            val["autoExtract"].as_i64(),
                                            val["extracted"].as_i64(),
                                            val["addedAt"].as_i64().unwrap_or(0),
                                            val["completedAt"].as_i64(),
                                            val["peakSpeed"].as_i64().unwrap_or(0),
                                        ],
                                    );
                                }
                            }
                        }
                    }
                }
            }
            "kv" => {
                if replace_mode {
                    if let Ok(conn) = db.kv() {
                        let _ = conn.execute("DELETE FROM kv_store", []);
                    }
                }
                if let Ok(entry) = archive.by_name("data/kv.ndjson") {
                    let reader = BufReader::new(entry);
                    for line in reader.lines() {
                        let l = line.map_err(|e| e.to_string())?;
                        if l.trim().is_empty() {
                            continue;
                        }
                        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&l) {
                            if let (Some(k), Some(v)) = (val["key"].as_str(), val["value"].as_str())
                            {
                                let _ = kv::set(db, k, v);
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }

    // Unpack physical assets if any exist in the archive
    for i in 0..archive.len() {
        let (name, is_file) = {
            if let Ok(entry) = archive.by_index(i) {
                (entry.name().to_string(), entry.is_file())
            } else {
                continue;
            }
        };

        if !is_file {
            continue;
        }

        if let Some(rel) = name.strip_prefix("assets/artwork/") {
            let dest = data_dir.join("artwork").join(rel);
            if let Some(parent) = dest.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if let Ok(mut entry) = archive.by_name(&name) {
                if let Ok(mut out) = std::fs::File::create(&dest) {
                    let _ = std::io::copy(&mut entry, &mut out);
                }
            }
        } else if let Some(rel) = name.strip_prefix("assets/plugins/") {
            let dest = data_dir.join("plugins").join(rel);
            if let Some(parent) = dest.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if let Ok(mut entry) = archive.by_name(&name) {
                if let Ok(mut out) = std::fs::File::create(&dest) {
                    let _ = std::io::copy(&mut entry, &mut out);
                }
            }
        }
    }

    let size_bytes = std::fs::metadata(source_path).map(|m| m.len()).unwrap_or(0);

    if let Some(ref mut cb) = on_progress {
        cb(BackupProgress {
            phase: "complete".into(),
            current_domain: None,
            domain_index: total_domains,
            total_domains,
            percent: 100,
            bytes_written: size_bytes,
            message: "Restore completed successfully".into(),
        });
    }

    Ok(BackupOutcome {
        file_path: source_path.to_string(),
        size_bytes,
        created_at: manifest.created_at,
        domains: selected_domains,
    })
}
