//! Mod management commands.
//!
//! The scanner (`detect`) reads the install from disk; this module
//! layers the *management* on top:
//!
//! - **enable/disable** — Bethesda plugins flip their `*` marker in
//!   `plugins.txt`; every other engine renames the artifact with a
//!   `.disabled` suffix (the same convention BepInEx/MO users apply
//!   by hand). Steam Workshop items are read-only.
//! - **load order** — persisted in `mods.db`; for Bethesda games the
//!   order is written back to `plugins.txt` so the game actually
//!   honors it.
//! - **conflicts** — folder-based mods are diffed by relative file
//!   path; two mods shipping the same file are flagged (last-loaded
//!   wins in most engines).
//! - **Nexus Mods** — optional API-key integration for identifying
//!   local files (MD5 search) and checking for updates.

pub mod detect;
pub mod nexus;

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::Manager;

use crate::db::{self, mods::{GameModSettingsRow, ModRow}};
use detect::now_secs;

/// Full per-game payload the frontend renders from.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameModsPayload {
    pub mods: Vec<ModRow>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub settings: Option<GameModSettingsRow>,
    pub engines: Vec<String>,
    pub supports_reorder: bool,
}

/// Two-or-more mods shipping the same relative file path.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModConflict {
    pub relative_path: String,
    pub mod_ids: Vec<String>,
}

fn distinct_engines(mods: &[ModRow]) -> Vec<String> {
    let mut engines: Vec<String> = Vec::new();
    for m in mods {
        if !engines.contains(&m.engine) {
            engines.push(m.engine.clone());
        }
    }
    engines
}

fn payload_from_db(db: &db::Db, game_id: &str) -> Result<GameModsPayload, String> {
    let mods = db::mods::list_for_game(db, game_id)?;
    let settings = db::mods::get_settings(db, game_id)?;
    let supports_reorder = settings
        .as_ref()
        .map(|s| s.plugins_txt.is_some())
        .unwrap_or(false);
    Ok(GameModsPayload {
        engines: distinct_engines(&mods),
        supports_reorder,
        mods,
        settings,
    })
}

/// Rebuild `plugins.txt` from the DB's current enabled flags + load
/// order. No-op when the game has no resolved plugins.txt (unknown
/// Bethesda title or non-Bethesda game).
fn rewrite_plugins_txt(db: &db::Db, game_id: &str) -> Result<(), String> {
    let Some(settings) = db::mods::get_settings(db, game_id)? else {
        return Ok(());
    };
    let Some(pt) = settings.plugins_txt else {
        return Ok(());
    };
    let pt_path = Path::new(&pt);
    let star = detect::plugins_txt_is_star_format(pt_path);
    let mods = db::mods::list_for_game(db, game_id)?;
    let mut lines: Vec<String> =
        vec!["# This file was written by GameIndex mod manager.".to_string()];
    for m in mods.iter().filter(|m| m.engine == "bethesda") {
        let Some(fname) = Path::new(&m.path)
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
        else {
            continue;
        };
        if star {
            lines.push(if m.enabled { format!("*{fname}") } else { fname });
        } else if m.enabled {
            lines.push(fname);
        }
    }
    if let Some(parent) = pt_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("plugins.txt mkdir: {e}"))?;
    }
    fs::write(pt_path, lines.join("\r\n") + "\r\n")
        .map_err(|e| format!("plugins.txt write: {e}"))
}

/// Rename-based enable/disable for file/folder artifacts: append or
/// strip the `.disabled` suffix. Returns the new path.
fn toggle_artifact(path: &str, enabled: bool) -> Result<String, String> {
    let p = PathBuf::from(path);
    let name = p
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .ok_or_else(|| format!("bad mod path '{path}'"))?;
    let currently_disabled = name.to_lowercase().ends_with(".disabled");
    let target_name = if enabled {
        if !currently_disabled {
            return Ok(path.to_string());
        }
        name[..name.len() - ".disabled".len()].to_string()
    } else {
        if currently_disabled {
            return Ok(path.to_string());
        }
        format!("{name}.disabled")
    };
    let target = p.with_file_name(&target_name);
    fs::rename(&p, &target).map_err(|e| format!("rename '{name}': {e}"))?;
    Ok(target.to_string_lossy().to_string())
}

fn walk_relative(root: &Path, base: &Path, cap: &mut u32, out: &mut Vec<String>) {
    if *cap == 0 {
        return;
    }
    let Ok(rd) = fs::read_dir(root) else {
        return;
    };
    for entry in rd.flatten() {
        if *cap == 0 {
            break;
        }
        let p = entry.path();
        if p.is_dir() {
            walk_relative(&p, base, cap, out);
        } else {
            *cap -= 1;
            if let Ok(rel) = p.strip_prefix(base) {
                out.push(rel.to_string_lossy().replace('\\', "/"));
            }
        }
    }
}

// === Commands ==============================================================

/// The frontend stores `steamAppId` as a number, but older rows (and
/// manual edits) may carry a string. Accept both over IPC.
fn steam_app_id_string(v: Option<serde_json::Value>) -> Option<String> {
    match v? {
        serde_json::Value::String(s) if !s.trim().is_empty() => Some(s),
        serde_json::Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

/// Scan a game install for mods, reconcile with previously-known rows
/// (Nexus linkage + notes survive), persist, and return the payload.
#[tauri::command]
pub async fn mods_scan_game(
    app: tauri::AppHandle,
    game_id: String,
    game_path: String,
    steam_app_id: Option<serde_json::Value>,
) -> Result<GameModsPayload, String> {
    let db = app.state::<db::Db>().inner().clone();
    let gid = game_id.clone();
    let mut appid = steam_app_id_string(steam_app_id);
    if appid.is_none() {
        if let Ok(Some(g)) = db::games::get(&db, &game_id) {
            if let Some(sid) = g.steam_app_id {
                appid = Some(sid.to_string());
            }
        }
    }
    let custom_root = db::mods::get_settings(&db, &game_id)?.and_then(|s| s.custom_root);
    let custom_root_clone = custom_root.clone();
    let outcome = tokio::task::spawn_blocking(move || {
        detect::scan(
            &gid,
            &game_path,
            appid.as_deref(),
            custom_root_clone.as_deref(),
        )
    })
    .await
    .map_err(|e| format!("scan task: {e}"))??;

    // Reconcile: keep user/Nexus metadata across re-scans.
    let existing: HashMap<String, ModRow> = db::mods::list_for_game(&db, &game_id)?
        .into_iter()
        .map(|m| (m.id.clone(), m))
        .collect();
    let mut mods = outcome.mods;
    for m in &mut mods {
        if let Some(prev) = existing.get(&m.id) {
            m.nexus_mod_id = prev.nexus_mod_id;
            m.nexus_domain = prev.nexus_domain.clone();
            m.latest_version = prev.latest_version.clone();
            m.update_available = prev.update_available;
            m.detected_at = prev.detected_at;
            if m.version.is_none() {
                m.version = prev.version.clone();
            }
            if m.author.is_none() {
                m.author = prev.author.clone();
            }
            if m.notes.is_none() {
                m.notes = prev.notes.clone();
            }
            // The MD5 identifies the artifact's bytes — only reuse it
            // when the size didn't change under us.
            if prev.size_bytes == m.size_bytes {
                m.md5 = prev.md5.clone();
            }
        }
    }
    // Enrich Workshop mods with Steam Web API metadata (titles, preview images)
    detect::enrich_workshop_metadata(&mut mods).await;

    db::mods::replace_for_game(&db, &game_id, &mods)?;

    let prev_settings = db::mods::get_settings(&db, &game_id)?;
    let settings = GameModSettingsRow {
        game_id: game_id.clone(),
        mods_root: outcome.mods_root,
        custom_root,
        engine: outcome.engines.first().cloned(),
        plugins_txt: outcome.plugins_txt,
        // A user-picked Nexus domain always wins over the guess.
        nexus_domain: prev_settings
            .and_then(|p| p.nexus_domain)
            .or(outcome.nexus_domain),
        updated_at: now_secs(),
    };
    db::mods::upsert_settings(&db, &settings)?;
    payload_from_db(&db, &game_id)
}

/// Load a game's mods straight from the DB (no disk scan).
#[tauri::command]
pub fn mods_list(app: tauri::AppHandle, game_id: String) -> Result<GameModsPayload, String> {
    let db = app.state::<db::Db>().inner().clone();
    payload_from_db(&db, &game_id)
}

/// Enable or disable one mod (plugins.txt marker or `.disabled`
/// rename depending on engine). Returns the updated row.
#[tauri::command]
pub fn mods_set_enabled(
    app: tauri::AppHandle,
    mod_id: String,
    enabled: bool,
) -> Result<ModRow, String> {
    let db = app.state::<db::Db>().inner().clone();
    let mut row = db::mods::get(&db, &mod_id)?.ok_or("mod not found")?;
    match row.engine.as_str() {
        "bethesda" => {
            row.enabled = enabled;
            row.updated_at = now_secs();
            db::mods::upsert_one(&db, &row)?;
            rewrite_plugins_txt(&db, &row.game_id)?;
        }
        _ => {
            row.path = toggle_artifact(&row.path, enabled)?;
            row.enabled = enabled;
            row.updated_at = now_secs();
            db::mods::upsert_one(&db, &row)?;
        }
    }
    Ok(row)
}

/// Persist a new load order (array of mod ids, first = loads first)
/// and write it back to `plugins.txt` when the game supports it.
#[tauri::command]
pub fn mods_reorder(
    app: tauri::AppHandle,
    game_id: String,
    ordered_ids: Vec<String>,
) -> Result<GameModsPayload, String> {
    let db = app.state::<db::Db>().inner().clone();
    let mods = db::mods::list_for_game(&db, &game_id)?;
    let by_id: HashMap<String, ModRow> = mods.into_iter().map(|m| (m.id.clone(), m)).collect();
    let now = now_secs();
    for (i, id) in ordered_ids.iter().enumerate() {
        if let Some(m) = by_id.get(id) {
            let mut m = m.clone();
            m.load_order = i as i64;
            m.updated_at = now;
            db::mods::upsert_one(&db, &m)?;
        }
    }
    rewrite_plugins_txt(&db, &game_id)?;
    payload_from_db(&db, &game_id)
}

/// Delete a mod's on-disk artifact (plus Unreal `.ucas`/`.utoc`
/// siblings) and its DB row.
#[tauri::command]
pub fn mods_delete(app: tauri::AppHandle, mod_id: String) -> Result<(), String> {
    let db = app.state::<db::Db>().inner().clone();
    let row = db::mods::get(&db, &mod_id)?.ok_or("mod not found")?;
    let p = PathBuf::from(&row.path);
    if p.is_dir() {
        fs::remove_dir_all(&p).map_err(|e| format!("delete folder: {e}"))?;
    } else if p.is_file() {
        fs::remove_file(&p).map_err(|e| format!("delete file: {e}"))?;
        if row.engine == "unreal" {
            for ext in ["ucas", "utoc"] {
                let sib = p.with_extension(ext);
                if sib.is_file() {
                    let _ = fs::remove_file(&sib);
                }
            }
        }
    }
    db::mods::delete(&db, &mod_id)?;
    if row.engine == "bethesda" {
        rewrite_plugins_txt(&db, &row.game_id)?;
    }
    Ok(())
}

/// Relative file listing for the detail pane (capped at 1000 files).
#[tauri::command]
pub async fn mods_list_files(app: tauri::AppHandle, mod_id: String) -> Result<Vec<String>, String> {
    let db = app.state::<db::Db>().inner().clone();
    let row = db::mods::get(&db, &mod_id)?.ok_or("mod not found")?;
    tokio::task::spawn_blocking(move || {
        let p = PathBuf::from(&row.path);
        if p.is_file() {
            return Ok(vec![p
                .file_name()
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or_default()]);
        }
        let mut out = Vec::new();
        let mut cap = 1000u32;
        walk_relative(&p, &p, &mut cap, &mut out);
        out.sort();
        Ok(out)
    })
    .await
    .map_err(|e| format!("list files task: {e}"))?
}

/// File-level conflicts between folder-based mods: two enabled mods
/// shipping the same relative path.
#[tauri::command]
pub async fn mods_conflicts(
    app: tauri::AppHandle,
    game_id: String,
) -> Result<Vec<ModConflict>, String> {
    let db = app.state::<db::Db>().inner().clone();
    let mods = db::mods::list_for_game(&db, &game_id)?;
    tokio::task::spawn_blocking(move || {
        let mut by_path: HashMap<String, Vec<String>> = HashMap::new();
        for m in mods.iter().filter(|m| m.kind == "folder") {
            let root = PathBuf::from(&m.path);
            let mut files = Vec::new();
            let mut cap = 5000u32;
            walk_relative(&root, &root, &mut cap, &mut files);
            for f in files {
                by_path.entry(f.to_lowercase()).or_default().push(m.id.clone());
            }
        }
        let mut out: Vec<ModConflict> = by_path
            .into_iter()
            .filter(|(_, ids)| ids.len() > 1)
            .map(|(relative_path, mod_ids)| ModConflict {
                relative_path,
                mod_ids,
            })
            .collect();
        out.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
        out.truncate(500);
        Ok(out)
    })
    .await
    .map_err(|e| format!("conflicts task: {e}"))?
}

/// Per-game aggregate counts for the main Mods page overview list.
#[tauri::command]
pub fn mods_overview(app: tauri::AppHandle) -> Result<Vec<db::mods::ModsOverviewRow>, String> {
    let db = app.state::<db::Db>().inner().clone();
    db::mods::overview(&db)
}

/// Set (or clear) the Nexus Mods game domain used for update checks,
/// e.g. `skyrimspecialedition`.
#[tauri::command]
pub fn mods_set_nexus_domain(
    app: tauri::AppHandle,
    game_id: String,
    domain: Option<String>,
) -> Result<(), String> {
    let db = app.state::<db::Db>().inner().clone();
    let mut settings = db::mods::get_settings(&db, &game_id)?
        .unwrap_or_else(|| empty_settings(&game_id));
    settings.nexus_domain = domain.filter(|d| !d.trim().is_empty());
    settings.updated_at = now_secs();
    db::mods::upsert_settings(&db, &settings)
}

fn empty_settings(game_id: &str) -> GameModSettingsRow {
    GameModSettingsRow {
        game_id: game_id.to_string(),
        mods_root: None,
        custom_root: None,
        engine: None,
        plugins_txt: None,
        nexus_domain: None,
        updated_at: 0,
    }
}

/// Set (or clear) a user-picked mods folder for a game. The folder is
/// scanned as a `generic` mods root on top of the automatic engine
/// detection, and becomes the "Open mods folder" target.
#[tauri::command]
pub fn mods_set_custom_root(
    app: tauri::AppHandle,
    game_id: String,
    path: Option<String>,
) -> Result<(), String> {
    let db = app.state::<db::Db>().inner().clone();
    let path = path.filter(|p| !p.trim().is_empty());
    if let Some(p) = &path {
        if !std::path::Path::new(p).is_dir() {
            return Err(format!("'{p}' is not a folder"));
        }
    }
    let mut settings = db::mods::get_settings(&db, &game_id)?
        .unwrap_or_else(|| empty_settings(&game_id));
    settings.custom_root = path;
    settings.updated_at = now_secs();
    db::mods::upsert_settings(&db, &settings)
}

/// Store (or clear, with an empty string) the Nexus Mods API key in
/// the OS keychain.
#[tauri::command]
pub fn nexus_set_api_key(key: String) -> Result<(), String> {
    let store = crate::db::secrets::SecretStore::new();
    if key.trim().is_empty() {
        store.delete(nexus::NEXUS_KEY_ACCOUNT)
    } else {
        store.set(nexus::NEXUS_KEY_ACCOUNT, key.trim())
    }
}

/// Validate the stored key against `/users/validate.json`.
#[tauri::command]
pub async fn nexus_get_status() -> Result<nexus::NexusStatus, String> {
    match nexus::get_api_key()? {
        Some(key) if !key.is_empty() => Ok(nexus::validate(&key).await),
        _ => Ok(nexus::NexusStatus::disconnected()),
    }
}

/// Identify unlinked mods via MD5 search and check linked mods for
/// newer versions. Returns the refreshed payload.
#[tauri::command]
pub async fn nexus_check_updates(
    app: tauri::AppHandle,
    game_id: String,
) -> Result<GameModsPayload, String> {
    let db = app.state::<db::Db>().inner().clone();
    let key = nexus::get_api_key()?
        .filter(|k| !k.is_empty())
        .ok_or("Nexus Mods API key not set")?;
    let settings = db::mods::get_settings(&db, &game_id)?;
    let default_domain = settings.and_then(|s| s.nexus_domain);

    let mods = db::mods::list_for_game(&db, &game_id)?;
    let mut lookups = 0u32;
    const MAX_LOOKUPS: u32 = 40;

    for mut m in mods {
        if m.engine == "workshop" || lookups >= MAX_LOOKUPS {
            continue;
        }
        let domain = m
            .nexus_domain
            .clone()
            .or_else(|| default_domain.clone());
        let Some(domain) = domain else {
            continue;
        };
        let mut changed = false;

        // 1. Hash + identify unlinked single-file artifacts.
        if m.nexus_mod_id.is_none() && m.kind != "folder" {
            if m.md5.is_none() {
                let path = PathBuf::from(&m.path);
                let hash = tokio::task::spawn_blocking(move || nexus::file_md5(&path))
                    .await
                    .map_err(|e| format!("md5 task: {e}"))??;
                if let Some(h) = hash {
                    m.md5 = Some(h);
                    changed = true;
                }
            }
            if let Some(md5) = m.md5.clone() {
                lookups += 1;
                if let Some(hit) = nexus::md5_search(&key, &domain, &md5).await? {
                    m.nexus_mod_id = Some(hit.mod_id);
                    m.nexus_domain = Some(domain.clone());
                    if m.author.is_none() {
                        m.author = hit.author;
                    }
                    if m.version.is_none() {
                        m.version = hit.file_version;
                    }
                    if let Some(name) = hit.mod_name {
                        m.name = name;
                    }
                    changed = true;
                }
            }
        }

        // 2. Update check for linked mods.
        if let Some(nexus_id) = m.nexus_mod_id {
            lookups += 1;
            if let Some(latest) = nexus::mod_latest_version(&key, &domain, nexus_id).await? {
                let update = m
                    .version
                    .as_deref()
                    .map(|v| v != latest)
                    .unwrap_or(false);
                if m.latest_version.as_deref() != Some(latest.as_str())
                    || m.update_available != update
                {
                    m.latest_version = Some(latest);
                    m.update_available = update;
                    changed = true;
                }
            }
        }

        if changed {
            m.updated_at = now_secs();
            db::mods::upsert_one(&db, &m)?;
        }
    }
    payload_from_db(&db, &game_id)
}
