//! Save Backups — engine + Tauri commands.
//!
//! The suite has two persistence layers: this module's SQLite index
//! (`saves.db`, see [`crate::db::saves`]) and the versioned `.gisave`
//! snapshot archives written to disk by [`engine`] (legacy directory
//! snapshots are still read). Commands are the only
//! surface the frontend touches; detection lives in [`detect`] and the
//! curated data in [`registry`].
//!
//! Everything is gated behind `SavesSettings::enabled` at the UI layer —
//! the backend stays usable (and testable) with the feature off.

mod detect;
mod engine;
mod pcgw;
mod registry;

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_opener::OpenerExt;

use crate::db::game_notes::unix_now_ms;
use crate::db::saves::{self, SaveBackup, SaveLocation};
use crate::db::{self, Db};

pub use engine::{BackupManifest, RestoreResult};

/// kv key holding the JSON [`SavesSettings`].
const KV_SETTINGS: &str = "saves.settings";

/// Progress payload emitted on `saves-progress` for scans and backups.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveProgress {
    /// `scan | backup | restore`.
    pub phase: String,
    pub game_id: String,
    pub game_name: String,
    pub current: u64,
    pub total: u64,
    /// 0–100.
    pub percent: u8,
    pub message: String,
}

/// User-tunable configuration for the suite.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavesSettings {
    /// Master switch gating the nav tab + per-game tab.
    #[serde(default)]
    pub enabled: bool,
    /// Absolute folder snapshots are written to (empty = app-data default).
    #[serde(default)]
    pub backup_dir: String,
    #[serde(default = "default_true")]
    pub auto_backup_on_exit: bool,
    #[serde(default = "default_true")]
    pub include_emulator_saves: bool,
    /// Also consult PCGamingWiki for save paths the local scan missed.
    #[serde(default = "default_true")]
    pub include_pcgw: bool,
    /// Keep at most this many snapshots per game (0 = unlimited).
    #[serde(default = "default_retention")]
    pub retention: u32,
    /// Snapshot current saves before a restore so it can be undone.
    #[serde(default = "default_true")]
    pub restore_safety_snapshot: bool,
    /// File globs skipped during backup (empty = built-in defaults).
    #[serde(default)]
    pub ignore_patterns: Vec<String>,
    #[serde(default)]
    pub last_scan_at: u64,
}

fn default_true() -> bool {
    true
}
fn default_retention() -> u32 {
    10
}

impl Default for SavesSettings {
    fn default() -> Self {
        SavesSettings {
            enabled: false,
            backup_dir: String::new(),
            auto_backup_on_exit: true,
            include_emulator_saves: true,
            include_pcgw: true,
            retention: default_retention(),
            restore_safety_snapshot: true,
            ignore_patterns: Vec::new(),
            last_scan_at: 0,
        }
    }
}

impl SavesSettings {
    /// Effective ignore patterns (falls back to the built-in defaults).
    fn effective_ignore(&self) -> Vec<String> {
        if self.ignore_patterns.is_empty() {
            engine::default_ignore()
        } else {
            self.ignore_patterns.clone()
        }
    }
}

/// Overview payload for the Saves page header.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavesSummary {
    pub enabled: bool,
    pub backup_dir: String,
    pub games_with_locations: u64,
    pub total_locations: u64,
    pub missing_locations: u64,
    pub total_backups: u64,
    pub total_backup_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_backup_at: Option<u64>,
    pub auto_backup_on_exit: bool,
    pub retention: u32,
}

// ── Helpers ─────────────────────────────────────────────────────────────

fn state_db(app: &AppHandle) -> Result<Db, String> {
    let state: tauri::State<'_, Db> = app.state();
    Ok(state.inner().clone())
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("app data dir: {e}"))
}

/// Resolve the settings' backup directory, filling in the app-data
/// default when unset.
fn resolved_backup_dir(app: &AppHandle, settings: &SavesSettings) -> Result<PathBuf, String> {
    if settings.backup_dir.trim().is_empty() {
        Ok(app_data_dir(app)?.join("save_backups"))
    } else {
        Ok(PathBuf::from(&settings.backup_dir))
    }
}

fn load_settings(db: &Db) -> SavesSettings {
    db::kv::get(db, KV_SETTINGS)
        .ok()
        .flatten()
        .and_then(|raw| serde_json::from_str::<SavesSettings>(&raw).ok())
        .unwrap_or_default()
}

fn store_settings(db: &Db, settings: &SavesSettings) -> Result<(), String> {
    let raw = serde_json::to_string(settings).map_err(|e| format!("settings encode: {e}"))?;
    db::kv::set(db, KV_SETTINGS, &raw)
}

/// Merge freshly detected locations into the stored set (case-insensitive
/// path de-dupe). Returns how many new rows were added.
fn merge_locations(
    db: &Db,
    game: &db::games::GameRow,
    detected: Vec<detect::DetectedLocation>,
) -> Result<u32, String> {
    let mut added = 0u32;
    for d in detected {
        if saves::find_location_by_path(db, &game.id, &d.path)?.is_some() {
            continue;
        }
        saves::upsert_location(
            db,
            SaveLocation {
                id: String::new(),
                game_id: game.id.clone(),
                path: d.path,
                label: d.label,
                kind: d.kind,
                source: d.source,
                include: true,
                created_at: 0,
                updated_at: 0,
                last_backup_at: None,
                last_restore_at: None,
            },
        )?;
        added += 1;
    }
    Ok(added)
}

/// Local detection: curated registry + heuristics + Steam Cloud + emulator.
fn merge_detected(db: &Db, game: &db::games::GameRow, include_emulator: bool) -> Result<u32, String> {
    let detected = detect::detect_for_game(db, game, include_emulator);
    merge_locations(db, game, detected)
}

/// PCGamingWiki detection (cached, never fatal to a scan).
async fn merge_pcgw(db: &Db, game: &db::games::GameRow) -> Result<u32, String> {
    let result = pcgw::detect_for_game(db, game).await;
    merge_locations(db, game, result.locations)
}

fn included_locations(db: &Db, game_id: &str) -> Result<Vec<SaveLocation>, String> {
    Ok(saves::list_locations(db, game_id)?
        .into_iter()
        .filter(|l| l.include)
        .collect())
}

// ── Settings ────────────────────────────────────────────────────────────

/// Read the suite settings (backup dir defaulted to app data when unset).
#[tauri::command]
pub fn saves_get_settings(app: AppHandle) -> Result<SavesSettings, String> {
    let db = state_db(&app)?;
    let mut settings = load_settings(&db);
    if settings.backup_dir.trim().is_empty() {
        settings.backup_dir = resolved_backup_dir(&app, &settings)?
            .to_string_lossy()
            .to_string();
    }
    Ok(settings)
}

/// Persist the suite settings and return the normalized value.
#[tauri::command]
pub fn saves_set_settings(
    app: AppHandle,
    settings: SavesSettings,
) -> Result<SavesSettings, String> {
    let db = state_db(&app)?;
    let mut next = settings;
    if next.retention > 1000 {
        next.retention = 1000;
    }
    if next.backup_dir.trim().is_empty() {
        next.backup_dir = resolved_backup_dir(&app, &next)?
            .to_string_lossy()
            .to_string();
    }
    store_settings(&db, &next)?;
    Ok(next)
}

/// Header summary for the Saves page.
#[tauri::command]
pub async fn saves_summary(app: AppHandle) -> Result<SavesSummary, String> {
    let db = state_db(&app)?;
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut settings = load_settings(&db);
        if settings.backup_dir.trim().is_empty() {
            settings.backup_dir = resolved_backup_dir(&app_handle, &settings)?
                .to_string_lossy()
                .to_string();
        }
        let (locations, games, backups, bytes) = saves::summary_counts(&db)?;
        // `.exists()` probes the filesystem for every stored path; a stale
        // location on a slow/removable drive must not stall the event loop.
        let all = saves::list_all_locations(&db)?;
        let missing = all
            .iter()
            .filter(|l| !Path::new(&l.path).exists())
            .count() as u64;
        let last_backup_at = saves::list_backups(&db, None)?
            .first()
            .map(|b| b.created_at);
        Ok(SavesSummary {
            enabled: settings.enabled,
            backup_dir: settings.backup_dir,
            games_with_locations: games,
            total_locations: locations,
            missing_locations: missing,
            total_backups: backups,
            total_backup_bytes: bytes,
            last_backup_at,
            auto_backup_on_exit: settings.auto_backup_on_exit,
            retention: settings.retention,
        })
    })
    .await
    .map_err(|e| format!("saves_summary task: {e}"))?
}

// ── Locations ───────────────────────────────────────────────────────────

/// List stored save locations for a game.
#[tauri::command]
pub fn saves_list_locations(app: AppHandle, game_id: String) -> Result<Vec<SaveLocation>, String> {
    let db = state_db(&app)?;
    saves::list_locations(&db, &game_id)
}

/// List every stored save location (Saves page).
#[tauri::command]
pub fn saves_list_all_locations(app: AppHandle) -> Result<Vec<SaveLocation>, String> {
    let db = state_db(&app)?;
    saves::list_all_locations(&db)
}

/// Detect and persist locations for one game, returning the merged set.
///
/// The local scanners always run. When `include_pcgw` is requested (the
/// explicit "Rescan"/"Scan" actions) the suite also performs one cached
/// PCGamingWiki lookup; the automatic detect-on-mount leaves it off so
/// opening a game never waits on the network.
#[tauri::command]
pub async fn saves_detect_locations(
    app: AppHandle,
    game_id: String,
    include_pcgw: Option<bool>,
) -> Result<Vec<SaveLocation>, String> {
    let db = state_db(&app)?;
    let settings = load_settings(&db);
    let Some(game) = db::games::get(&db, &game_id)? else {
        return Err(format!("Game not found: {game_id}"));
    };
    merge_detected(&db, &game, settings.include_emulator_saves)?;
    if include_pcgw.unwrap_or(false) && settings.include_pcgw {
        let _ = merge_pcgw(&db, &game).await;
    }
    saves::list_locations(&db, &game_id)
}

/// Scan the library for save locations. Emits `saves-progress` and returns
/// the number of games scanned.
///
/// Only installed games are considered, and games that already have stored
/// locations are skipped — the per-game "Rescan" action is the way to look
/// for more on those. The first pass is local-only so it stays fast and
/// offline; when `include_pcgw` is on, a second pass consults PCGamingWiki
/// for the games the local scan could not place. Wiki answers are cached
/// for a week, so repeat scans are near-instant. Network lookups are
/// serialized with a short delay to respect the wiki's 60 requests/minute
/// limit.
#[tauri::command]
pub async fn saves_detect_all(app: AppHandle) -> Result<u32, String> {
    let db = state_db(&app)?;
    let mut settings = load_settings(&db);
    // Only installed games can have save data on disk, and a game that
    // already has stored locations is left alone: the per-game "Rescan"
    // action is the way to look for more. Repeat scans stay cheap.
    let mut targets: Vec<db::games::GameRow> = Vec::new();
    for game in db::games::list_all(&db)? {
        if !game.installed {
            continue;
        }
        if !saves::list_locations(&db, &game.id)?.is_empty() {
            continue;
        }
        targets.push(game);
    }
    let total = targets.len() as u64;
    let mut added_total = 0u32;
    for (i, game) in targets.iter().enumerate() {
        let _ = app.emit(
            "saves-progress",
            SaveProgress {
                phase: "scan".into(),
                game_id: game.id.clone(),
                game_name: game.name.clone(),
                current: i as u64,
                total,
                percent: if total == 0 { 100 } else { ((i as u64 * 100) / total) as u8 },
                message: format!("Scanning {}", game.name),
            },
        );
        added_total += merge_detected(&db, game, settings.include_emulator_saves).unwrap_or(0);
    }

    if settings.include_pcgw {
        // Local detection may have placed some games; only the remaining
        // ones need a (paced) wiki lookup.
        let unresolved: Vec<&db::games::GameRow> = targets
            .iter()
            .filter(|game| {
                saves::list_locations(&db, &game.id)
                    .map(|l| l.is_empty())
                    .unwrap_or(false)
            })
            .collect();
        let pcgw_total = unresolved.len() as u64;
        for (i, game) in unresolved.iter().enumerate() {
            let _ = app.emit(
                "saves-progress",
                SaveProgress {
                    phase: "scan".into(),
                    game_id: game.id.clone(),
                    game_name: game.name.clone(),
                    current: i as u64,
                    total: pcgw_total,
                    percent: if pcgw_total == 0 { 100 } else { ((i as u64 * 100) / pcgw_total) as u8 },
                    message: format!("PCGamingWiki: {}", game.name),
                },
            );
            let result = pcgw::detect_for_game(&db, *game).await;
            added_total += merge_locations(&db, *game, result.locations).unwrap_or(0);
            if result.fetched {
                tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
            }
        }
    }

    settings.last_scan_at = unix_now_ms();
    let _ = store_settings(&db, &settings);
    let _ = app.emit(
        "saves-progress",
        SaveProgress {
            phase: "scan".into(),
            game_id: String::new(),
            game_name: String::new(),
            current: total,
            total,
            percent: 100,
            message: format!("Found {added_total} new save location(s)"),
        },
    );
    Ok(targets.len() as u32)
}

/// Add a user-chosen folder/file as a save location.
#[tauri::command]
pub fn saves_add_location(
    app: AppHandle,
    game_id: String,
    path: String,
    label: Option<String>,
) -> Result<SaveLocation, String> {
    let db = state_db(&app)?;
    let trimmed = path.trim().to_string();
    if trimmed.is_empty() {
        return Err("A path is required".into());
    }
    let kind = if Path::new(&trimmed).is_dir() {
        "dir"
    } else {
        "file"
    };
    let label = label.filter(|l| !l.trim().is_empty()).unwrap_or_else(|| {
        Path::new(&trimmed)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Saves")
            .to_string()
    });
    saves::upsert_location(
        &db,
        SaveLocation {
            id: String::new(),
            game_id,
            path: trimmed,
            label,
            kind: kind.into(),
            source: "manual".into(),
            include: true,
            created_at: 0,
            updated_at: 0,
            last_backup_at: None,
            last_restore_at: None,
        },
    )
}

/// Update a stored location (label / include / kind).
#[tauri::command]
pub fn saves_update_location(
    app: AppHandle,
    location: SaveLocation,
) -> Result<SaveLocation, String> {
    let db = state_db(&app)?;
    if location.id.trim().is_empty() {
        return Err("Location id is required".into());
    }
    saves::upsert_location(&db, location)
}

/// Remove a stored location.
#[tauri::command]
pub fn saves_remove_location(app: AppHandle, id: String) -> Result<u64, String> {
    let db = state_db(&app)?;
    saves::delete_location(&db, &id)
}

/// Remove every location for a game.
#[tauri::command]
pub fn saves_clear_locations(app: AppHandle, game_id: String) -> Result<u64, String> {
    let db = state_db(&app)?;
    saves::delete_locations_for_game(&db, &game_id)
}

// ── Backups ─────────────────────────────────────────────────────────────

/// List backup snapshots, optionally scoped to a game.
#[tauri::command]
pub fn saves_list_backups(
    app: AppHandle,
    game_id: Option<String>,
) -> Result<Vec<SaveBackup>, String> {
    let db = state_db(&app)?;
    saves::list_backups(&db, game_id.as_deref())
}

/// Snapshot a game's included save locations.
///
/// Walking and zipping potentially tens of thousands of files is heavy disk
/// I/O, so the body runs on a blocking thread — a synchronous command would
/// run on the event loop and freeze the whole UI for the duration.
#[tauri::command]
pub async fn saves_backup_game(
    app: AppHandle,
    game_id: String,
    note: Option<String>,
) -> Result<SaveBackup, String> {
    let db = state_db(&app)?;
    let settings = load_settings(&db);
    let Some(game) = db::games::get(&db, &game_id)? else {
        return Err(format!("Game not found: {game_id}"));
    };
    let backup_dir = resolved_backup_dir(&app, &settings)?;
    let ignore = settings.effective_ignore();
    let include_emulator = settings.include_emulator_saves;
    let retention = settings.retention;
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        // Auto-detect on first backup so a game the user never opened still
        // gets sensible coverage.
        if saves::list_locations(&db, &game_id)?.is_empty() {
            merge_detected(&db, &game, include_emulator)?;
        }
        let locations = included_locations(&db, &game_id)?;
        if locations.is_empty() {
            return Err("No save locations configured for this game".into());
        }
        std::fs::create_dir_all(&backup_dir).map_err(|e| format!("create backup dir: {e}"))?;
        let backup = engine::create_backup(
            Some(&app_handle),
            &db,
            &game.id,
            &game.name,
            &locations,
            "manual",
            note.as_deref().unwrap_or(""),
            &backup_dir,
            &ignore,
        )?;
        engine::prune_backups(&db, &backup_dir, &game.id, retention);
        Ok(backup)
    })
    .await
    .map_err(|e| format!("saves_backup_game task: {e}"))?
}

/// Snapshot every game that has included locations.
#[tauri::command]
pub async fn saves_backup_all(app: AppHandle) -> Result<Vec<SaveBackup>, String> {
    let db = state_db(&app)?;
    let settings = load_settings(&db);
    let backup_dir = resolved_backup_dir(&app, &settings)?;
    let ignore = settings.effective_ignore();
    let retention = settings.retention;
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::create_dir_all(&backup_dir).map_err(|e| format!("create backup dir: {e}"))?;
        let games = db::games::list_all(&db)?;
        let mut done = Vec::new();
        for game in games {
            let locations = included_locations(&db, &game.id)?;
            if locations.is_empty() {
                continue;
            }
            match engine::create_backup(
                Some(&app_handle),
                &db,
                &game.id,
                &game.name,
                &locations,
                "manual",
                "Backup all",
                &backup_dir,
                &ignore,
            ) {
                Ok(backup) => {
                    engine::prune_backups(&db, &backup_dir, &game.id, retention);
                    done.push(backup);
                }
                Err(e) => eprintln!("[saves] backup_all {} failed: {e}", game.id),
            }
        }
        Ok(done)
    })
    .await
    .map_err(|e| format!("saves_backup_all task: {e}"))?
}

/// Restore a snapshot, optionally snapshotting current saves first.
#[tauri::command]
pub async fn saves_restore_backup(
    app: AppHandle,
    backup_id: String,
) -> Result<RestoreResult, String> {
    let db = state_db(&app)?;
    let settings = load_settings(&db);
    let backup_dir = resolved_backup_dir(&app, &settings)?;
    let ignore = settings.effective_ignore();
    let safety = settings.restore_safety_snapshot;
    let retention = settings.retention;
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let backup = saves::get_backup(&db, &backup_id)?
            .ok_or_else(|| format!("Backup not found: {backup_id}"))?;
        let result = engine::restore_backup(
            Some(&app_handle),
            &db,
            &backup,
            safety,
            &backup_dir,
            &ignore,
        )?;
        // Prune again: the safety snapshot counts toward retention.
        engine::prune_backups(&db, &backup_dir, &backup.game_id, retention);
        Ok(result)
    })
    .await
    .map_err(|e| format!("saves_restore_backup task: {e}"))?
}

/// Delete one snapshot (index row + on-disk directory).
#[tauri::command]
pub async fn saves_delete_backup(app: AppHandle, backup_id: String) -> Result<u64, String> {
    let db = state_db(&app)?;
    let settings = load_settings(&db);
    let backup_dir = resolved_backup_dir(&app, &settings)?;
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(backup) = saves::get_backup(&db, &backup_id)? {
            engine::delete_snapshot(&backup, &backup_dir);
        }
        saves::delete_backup(&db, &backup_id)
    })
    .await
    .map_err(|e| format!("saves_delete_backup task: {e}"))?
}

/// Delete every snapshot for a game.
#[tauri::command]
pub async fn saves_delete_game_backups(app: AppHandle, game_id: String) -> Result<u64, String> {
    let db = state_db(&app)?;
    let settings = load_settings(&db);
    let backup_dir = resolved_backup_dir(&app, &settings)?;
    tauri::async_runtime::spawn_blocking(move || {
        for backup in saves::list_backups(&db, Some(&game_id))? {
            engine::delete_snapshot(&backup, &backup_dir);
        }
        saves::delete_backups_for_game(&db, &game_id)
    })
    .await
    .map_err(|e| format!("saves_delete_game_backups task: {e}"))?
}

/// Read a snapshot's manifest for the backup browser.
#[tauri::command]
pub async fn saves_get_backup_manifest(
    app: AppHandle,
    backup_id: String,
) -> Result<Option<BackupManifest>, String> {
    let db = state_db(&app)?;
    tauri::async_runtime::spawn_blocking(move || match saves::get_backup(&db, &backup_id)? {
        Some(backup) => Ok(engine::read_manifest(&backup)),
        None => Err(format!("Backup not found: {backup_id}")),
    })
    .await
    .map_err(|e| format!("saves_get_backup_manifest task: {e}"))?
}

// ── Opening paths ───────────────────────────────────────────────────────

/// Reveal an arbitrary path in the OS file manager.
#[tauri::command]
pub fn saves_open_path(app: AppHandle, path: String) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("Empty path".into());
    }
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| format!("open path: {e}"))
}

/// Reveal a snapshot in the OS file manager. Archives are revealed by
/// their containing folder so the file is visible rather than launched.
#[tauri::command]
pub fn saves_open_backup(app: AppHandle, backup_id: String) -> Result<(), String> {
    let db = state_db(&app)?;
    let backup = saves::get_backup(&db, &backup_id)?
        .ok_or_else(|| format!("Backup not found: {backup_id}"))?;
    let root = Path::new(&backup.root_path);
    let target = if root.is_file() {
        root.parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| backup.root_path.clone())
    } else {
        backup.root_path.clone()
    };
    app.opener()
        .open_path(target, None::<&str>)
        .map_err(|e| format!("open backup: {e}"))
}

/// Reveal a stored location's folder.
#[tauri::command]
pub fn saves_open_location(app: AppHandle, id: String) -> Result<(), String> {
    let db = state_db(&app)?;
    let location = saves::list_all_locations(&db)?
        .into_iter()
        .find(|l| l.id == id)
        .ok_or_else(|| format!("Location not found: {id}"))?;
    let target = if Path::new(&location.path).is_dir() {
        location.path
    } else {
        Path::new(&location.path)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or(location.path)
    };
    app.opener()
        .open_path(target, None::<&str>)
        .map_err(|e| format!("open location: {e}"))
}
