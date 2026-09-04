//! Covers, executables, media files and screenshot helpers.

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use crate::game_scraper;
use crate::game_scraper::{GameMetadataResult, LaunchBoxImageResult};
use crate::steam_game_watcher;

/// Managed state holding cancellation tokens for active executable scans.
#[derive(Default)]
pub struct ExeScanState {
    pub active: std::sync::Mutex<HashMap<String, Arc<AtomicBool>>>,
}

/// Progress update emitted via `exe-scan-progress`.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExeScanProgress {
    pub scan_id: String,
    pub current_folder: String,
    pub folder_index: usize,
    pub total_folders: usize,
    pub folders_scanned: usize,
    pub files_examined: usize,
    pub exes_found: usize,
    pub last_found_exe: Option<String>,
    pub done: bool,
    pub cancelled: bool,
}

/// Read an image file from disk and return it as a base64 data URL.
#[tauri::command]
pub fn read_cover_image(file_path: String) -> Result<String, String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err("File not found".into());
    }
    let data = std::fs::read(path).map_err(|e| format!("Failed to read file: {}", e))?;
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    let b64 = base64_encode(&data);
    Ok(format!("data:{};base64,{}", mime, b64))
}

/// Simple base64 encoding (no external crate needed).
fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(CHARS[((triple >> 18) & 63) as usize] as char);
        out.push(CHARS[((triple >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            out.push(CHARS[((triple >> 6) & 63) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(CHARS[(triple & 63) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

/// Serializable struct holding metadata about a scanned executable.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExeInfo {
    pub(crate) path: String,
    pub(crate) size: u64,
    pub(crate) modified_at: u64,
}

/// Recursively scan multiple directories for .exe files with live progress events and cancellation.
#[tauri::command]
pub async fn scan_folders_for_exes(
    app: tauri::AppHandle,
    folder_paths: Vec<String>,
    scan_id: Option<String>,
) -> Result<Vec<ExeInfo>, String> {
    let sid = scan_id.unwrap_or_else(|| {
        format!(
            "scan-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0)
        )
    });
    let cancel = Arc::new(AtomicBool::new(false));

    if let Some(state) = app.try_state::<ExeScanState>() {
        if let Ok(mut lock) = state.active.lock() {
            lock.insert(sid.clone(), cancel.clone());
        }
    }

    let progress_app = app.clone();
    let task_sid = sid.clone();
    let cancel_flag = cancel.clone();

    let result = tokio::task::spawn_blocking(move || {
        scan_folders_inner(&progress_app, &folder_paths, &task_sid, &cancel_flag)
    })
    .await
    .map_err(|e| format!("scan task failed: {e}"))?;

    if let Some(state) = app.try_state::<ExeScanState>() {
        if let Ok(mut lock) = state.active.lock() {
            lock.remove(&sid);
        }
    }

    result
}

/// Cancel an ongoing multi-folder executable scan.
#[tauri::command]
pub fn cancel_scan_exes(app: tauri::AppHandle, scan_id: Option<String>) -> Result<(), String> {
    if let Some(state) = app.try_state::<ExeScanState>() {
        if let Ok(lock) = state.active.lock() {
            if let Some(sid) = scan_id {
                if let Some(flag) = lock.get(&sid) {
                    flag.store(true, Ordering::Relaxed);
                }
            } else {
                for flag in lock.values() {
                    flag.store(true, Ordering::Relaxed);
                }
            }
        }
    }
    Ok(())
}

/// Recursively scan a directory for .exe files and return their paths, sizes, and modified dates.
#[tauri::command]
pub fn scan_folder_for_exes(folder_path: String) -> Vec<ExeInfo> {
    let mut exes = Vec::new();
    let path = Path::new(&folder_path);
    if path.is_dir() {
        scan_dir(path, &mut exes);
    }
    exes
}

/// Non-game executables to skip during folder scanning.
const SKIP_KEYWORDS: &[&str] = &["redist", "autorun", "helper", "unin", "crash", "setup", "install", "plugin", "manual", "readme", "register", "7za"];

/// Download a single image URL and return it as a base64 data URL.
#[tauri::command]
pub async fn download_image(url: String) -> Result<Option<String>, String> {
    Ok(game_scraper::download_image_to_base64(&url).await)
}

/// Download and persist artwork without returning its bytes to the webview.
#[tauri::command]
pub async fn download_artwork(
    app: tauri::AppHandle,
    game_id: String,
    slot: String,
    url: String,
) -> Result<Option<String>, String> {
    let Some(data_url) = game_scraper::download_image_to_base64(&url).await else { return Ok(None); };
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?;
    crate::db::artwork::store_data_url(&root, &game_id, &slot, &data_url)
}

/// Resolve a disk-backed artwork path to a Tauri asset URL.
#[tauri::command]
pub fn artwork_asset_url(app: tauri::AppHandle, relative_path: String) -> Result<String, String> {
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = root.join(&relative_path);
    if !path.is_file() { return Err("Artwork file not found".into()); }
    Ok(tauri::Url::from_file_path(path).map_err(|_| "Invalid artwork path".to_string())?.to_string())
}

#[tauri::command]
pub fn cleanup_artwork_cache(app: tauri::AppHandle) -> Result<(), String> {
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?;
    crate::db::artwork::cleanup_non_library_caches(&root, std::time::Duration::from_secs(30 * 24 * 60 * 60));
    Ok(())
}

/// Store a selected local image in the artwork directory.
#[tauri::command]
pub fn store_artwork_file(
    app: tauri::AppHandle,
    game_id: String,
    slot: String,
    file_path: String,
) -> Result<Option<String>, String> {
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?;
    crate::db::artwork::store_file(&root, &game_id, &slot, Path::new(&file_path))
}

/// Search for game metadata across multiple online sources.
/// When `skip_launchbox` is true (Steam-synced games), LaunchBox is
/// skipped â€” IGDB and Steam provide better metadata for known titles.
#[tauri::command]
pub async fn search_game_metadata(game_name: String, skip_launchbox: Option<bool>, steam_app_id: Option<u32>) -> Vec<GameMetadataResult> {
    game_scraper::search_game_metadata(&game_name, skip_launchbox.unwrap_or(false), steam_app_id).await
}

/// Fetch full IGDB metadata for a game by its numeric IGDB id. Returns
/// `None` when the id doesn't exist (e.g. a stale persisted `igdbId`).
/// Used by the frontend to re-fetch metadata/images for games that
/// carry an `igdbId` but no artwork — same result shape as
/// `search_game_metadata` items.
#[tauri::command]
pub async fn get_igdb_game_by_id(id: u64) -> Result<Option<GameMetadataResult>, String> {
    Ok(game_scraper::fetch_igdb_game_by_id(id).await)
}

/// Download images from URLs and return them as base64 data URLs.
#[tauri::command]
pub async fn fetch_game_images(urls: Vec<String>) -> Vec<Option<String>> {
    game_scraper::fetch_game_images(urls).await
}

/// Search the LaunchBox Games Database for images of a game.
#[tauri::command]
pub async fn search_launchbox_images(game_name: String) -> Result<Vec<LaunchBoxImageResult>, String> {
    game_scraper::search_launchbox_images(&game_name).await
}

/// Recursively scan a folder for image files (jpg, jpeg, png, gif, bmp, webp)
/// and return their paths. Used by the Community â†’ Screenshots tab to let
/// users browse their screenshot folders.
/// Like `list_image_files` but also returns common video clip formats
/// (.mp4, .webm, .mov, .mkv) so the Community → Screenshots tab can show
/// gameplay recordings alongside still captures. Recurses into subfolders.
#[tauri::command]
pub fn list_media_files(folder_path: String) -> Vec<String> {
    fn list_media_files_flat(dir: &std::path::Path) -> Vec<String> {
        let mut paths = Vec::new();
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_dir() {
                    paths.extend(list_media_files_flat(&p));
                } else if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
                    let lower = ext.to_lowercase();
                    if matches!(
                        lower.as_str(),
                        "jpg" | "jpeg" | "png" | "gif" | "bmp" | "webp"
                            | "mp4" | "webm" | "mov" | "mkv"
                    ) {
                        paths.push(p.to_string_lossy().to_string());
                    }
                }
            }
        }
        paths
    }
    let mut paths = list_media_files_flat(std::path::Path::new(&folder_path));
    paths.sort();
    paths
}

/// Serializable result for auto-detecting Steam screenshot folders.
/// Maps to the frontend's per-game screenshot grouping UI on the
/// Community â†’ Screenshots tab.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SteamScreenshotFolder {
    /// Steam AppID that owns these screenshots.
    pub(crate) app_id: u32,
    /// Display name resolved from the user's library, or a fallback
    /// like "Unknown Game (730)" when no library entry has this appid.
    pub(crate) game_name: String,
    /// The absolute filesystem path to the screenshots folder.
    pub(crate) folder_path: String,
    /// Sorted list of absolute paths to image files in this folder.
    pub(crate) screenshots: Vec<String>,
}

/// Auto-detect Steam screenshot folders by scanning ALL userdata
/// directories under `<steam_root>\userdata\*\760\remote\<appId>\screenshots`.
///
/// No Steam login required â€” this scans the filesystem directly,
/// finding screenshots from every Steam account that has ever signed
/// in on this machine. Duplicate appIds (same game played by multiple
/// accounts) are deduplicated: the first account's folder wins.
///
/// The frontend cross-references each discovered appid against the
/// user's library for game names, cover art, and platform badges.
/// Returns an empty Vec when Steam isn't installed or no screenshot
/// folders exist yet.
#[tauri::command]
pub fn detect_steam_screenshot_folders() -> Vec<SteamScreenshotFolder> {
    let steam_root = match steam_game_watcher::find_steam_install_dir() {
        Some(r) => r,
        None => return Vec::new(),
    };

    let userdata_root = steam_root.join("userdata");
    if !userdata_root.exists() || !userdata_root.is_dir() {
        return Vec::new();
    }

    let mut results: Vec<SteamScreenshotFolder> = Vec::new();

    // Walk every <userdata>/<steamId>/760/remote/ for screenshot folders.
    if let Ok(user_entries) = std::fs::read_dir(&userdata_root) {
        for user_entry in user_entries.flatten() {
            let user_dir = user_entry.path();
            if !user_dir.is_dir() {
                continue;
            }

            let remote_root = user_dir.join("760").join("remote");
            if !remote_root.exists() || !remote_root.is_dir() {
                continue;
            }

            if let Ok(app_entries) = std::fs::read_dir(&remote_root) {
                for app_entry in app_entries.flatten() {
                    let p = app_entry.path();
                    if !p.is_dir() {
                        continue;
                    }

                    let dir_name = match p.file_name().and_then(|n| n.to_str()) {
                        Some(n) => n.to_string(),
                        None => continue,
                    };

                    let app_id: u32 = match dir_name.parse() {
                        Ok(id) => id,
                        Err(_) => continue,
                    };

                    // Deduplicate: same game played by multiple accounts.
                    if results.iter().any(|r| r.app_id == app_id) {
                        continue;
                    }

                    let screenshots_dir = p.join("screenshots");
                    if !screenshots_dir.exists() || !screenshots_dir.is_dir() {
                        let loose: Vec<String> = list_image_files_flat(&p);
                        if loose.is_empty() {
                            continue;
                        }
                        results.push(SteamScreenshotFolder {
                            app_id,
                            game_name: format!("Unknown Game ({})", app_id),
                            folder_path: p.to_string_lossy().to_string(),
                            screenshots: loose,
                        });
                        continue;
                    }

                    let images: Vec<String> = list_image_files_flat(&screenshots_dir);
                    if images.is_empty() {
                        continue;
                    }

                    results.push(SteamScreenshotFolder {
                        app_id,
                        game_name: format!("Unknown Game ({})", app_id),
                        folder_path: screenshots_dir.to_string_lossy().to_string(),
                        screenshots: images,
                    });
                }
            }
        }
    }

    results.sort_by_key(|r| r.app_id);
    results
}

/// Non-recursive image-file lister for a single directory.
fn list_image_files_flat(dir: &std::path::Path) -> Vec<String> {
    let mut paths = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() {
                if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
                    let lower = ext.to_lowercase();
                    if lower == "jpg" || lower == "jpeg" || lower == "png" || lower == "gif" || lower == "bmp" || lower == "webp" {
                        paths.push(p.to_string_lossy().to_string());
                    }
                }
            }
        }
    }
    // Sort by modified time, newest first (better for screenshot browsing)
    paths.sort_by(|a, b| {
        let ma = std::fs::metadata(a).ok().and_then(|m| m.modified().ok());
        let mb = std::fs::metadata(b).ok().and_then(|m| m.modified().ok());
        mb.cmp(&ma)
    });
    paths
}

/// Save screenshot image base64 data to the specified path.
#[tauri::command]
pub fn save_screenshot(file_path: String, base64_data: String) -> Result<(), String> {
     use base64::{Engine as _, engine::general_purpose};

     let clean_data = if base64_data.contains(",") {
         base64_data.split(',').nth(1).unwrap_or(&base64_data)
     } else {
         &base64_data
     };

     let bytes = general_purpose::STANDARD
         .decode(clean_data)
         .map_err(|e| format!("Failed to decode base64: {}", e))?;

     std::fs::write(&file_path, bytes)
         .map_err(|e| format!("Failed to write file: {}", e))?;

     Ok(())
}

/// Write an arbitrary text payload (CSV / JSON export) to the specified
/// path. Kept separate from `save_screenshot` because that command only
/// accepts base64 image payloads; exports are plain UTF-8 text.
#[tauri::command]
pub fn save_text_file(file_path: String, contents: String) -> Result<(), String> {
     std::fs::write(&file_path, contents)
         .map_err(|e| format!("Failed to write file: {}", e))
}

/// Read a text file into a string (used by the emulator-config JSON
/// import path — the frontend picks the file via the dialog plugin and
/// hands us the path).
#[tauri::command]
pub fn read_text_file(file_path: String) -> Result<String, String> {
     std::fs::read_to_string(&file_path)
         .map_err(|e| format!("Failed to read file: {}", e))
}

fn scan_folders_inner(
    app: &tauri::AppHandle,
    folder_paths: &[String],
    scan_id: &str,
    cancel: &Arc<AtomicBool>,
) -> Result<Vec<ExeInfo>, String> {
    let mut exes = Vec::new();
    let mut folders_scanned = 0usize;
    let mut files_examined = 0usize;
    let mut last_emit = Instant::now();
    let total_folders = folder_paths.len();

    // Initial emit
    let _ = app.emit(
        "exe-scan-progress",
        ExeScanProgress {
            scan_id: scan_id.to_string(),
            current_folder: folder_paths.first().cloned().unwrap_or_default(),
            folder_index: if total_folders > 0 { 1 } else { 0 },
            total_folders,
            folders_scanned: 0,
            files_examined: 0,
            exes_found: 0,
            last_found_exe: None,
            done: false,
            cancelled: false,
        },
    );

    let mut is_cancelled = false;

    for (idx, root_str) in folder_paths.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            is_cancelled = true;
            break;
        }
        let root_path = Path::new(root_str);
        if !root_path.is_dir() {
            continue;
        }

        walk_scan_dir(
            app,
            scan_id,
            root_path,
            0,
            idx + 1,
            total_folders,
            &mut exes,
            &mut folders_scanned,
            &mut files_examined,
            &mut last_emit,
            cancel,
        );

        if cancel.load(Ordering::Relaxed) {
            is_cancelled = true;
            break;
        }
    }

    // Final emit
    let _ = app.emit(
        "exe-scan-progress",
        ExeScanProgress {
            scan_id: scan_id.to_string(),
            current_folder: String::new(),
            folder_index: total_folders,
            total_folders,
            folders_scanned,
            files_examined,
            exes_found: exes.len(),
            last_found_exe: exes.last().map(|e| e.path.clone()),
            done: true,
            cancelled: is_cancelled,
        },
    );

    Ok(exes)
}

fn walk_scan_dir(
    app: &tauri::AppHandle,
    scan_id: &str,
    dir: &Path,
    depth: usize,
    folder_index: usize,
    total_folders: usize,
    exes: &mut Vec<ExeInfo>,
    folders_scanned: &mut usize,
    files_examined: &mut usize,
    last_emit: &mut Instant,
    cancel: &Arc<AtomicBool>,
) {
    if cancel.load(Ordering::Relaxed) || depth > 25 {
        return;
    }

    *folders_scanned += 1;

    // Periodic progress emit while walking folders
    if last_emit.elapsed() >= Duration::from_millis(80) {
        *last_emit = Instant::now();
        let _ = app.emit(
            "exe-scan-progress",
            ExeScanProgress {
                scan_id: scan_id.to_string(),
                current_folder: dir.to_string_lossy().to_string(),
                folder_index,
                total_folders,
                folders_scanned: *folders_scanned,
                files_examined: *files_examined,
                exes_found: exes.len(),
                last_found_exe: exes.last().map(|e| e.path.clone()),
                done: false,
                cancelled: false,
            },
        );
    }

    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        if cancel.load(Ordering::Relaxed) {
            return;
        }
        let entry_path = entry.path();
        let is_symlink = entry.file_type().map(|ft| ft.is_symlink()).unwrap_or(false);
        if is_symlink {
            continue;
        }

        if entry_path.is_dir() {
            if let Some(name) = entry_path.file_name().and_then(|n| n.to_str()) {
                // Skip hidden folders, system volume information, recycle bins
                if name.starts_with('.') || name.starts_with('_') || name.starts_with('$') {
                    continue;
                }
            }
            walk_scan_dir(
                app,
                scan_id,
                &entry_path,
                depth + 1,
                folder_index,
                total_folders,
                exes,
                folders_scanned,
                files_examined,
                last_emit,
                cancel,
            );
        } else if let Some(ext) = entry_path.extension().and_then(|e| e.to_str()) {
            *files_examined += 1;
            if ext.eq_ignore_ascii_case("exe") {
                if let Some(stem) = entry_path.file_stem().and_then(|s| s.to_str()) {
                    if SKIP_KEYWORDS.iter().any(|kw| stem.to_lowercase().contains(kw)) {
                        continue;
                    }
                }
                if let Ok(meta) = entry.metadata() {
                    let size = meta.len();
                    let modified_at = meta
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    let found_path = entry_path.to_string_lossy().to_string();
                    exes.push(ExeInfo {
                        path: found_path.clone(),
                        size,
                        modified_at,
                    });

                    // Emit progress immediately on exe found
                    *last_emit = Instant::now();
                    let _ = app.emit(
                        "exe-scan-progress",
                        ExeScanProgress {
                            scan_id: scan_id.to_string(),
                            current_folder: dir.to_string_lossy().to_string(),
                            folder_index,
                            total_folders,
                            folders_scanned: *folders_scanned,
                            files_examined: *files_examined,
                            exes_found: exes.len(),
                            last_found_exe: Some(found_path),
                            done: false,
                            cancelled: false,
                        },
                    );
                }
            } else if last_emit.elapsed() >= Duration::from_millis(100) {
                *last_emit = Instant::now();
                let _ = app.emit(
                    "exe-scan-progress",
                    ExeScanProgress {
                        scan_id: scan_id.to_string(),
                        current_folder: dir.to_string_lossy().to_string(),
                        folder_index,
                        total_folders,
                        folders_scanned: *folders_scanned,
                        files_examined: *files_examined,
                        exes_found: exes.len(),
                        last_found_exe: exes.last().map(|e| e.path.clone()),
                        done: false,
                        cancelled: false,
                    },
                );
            }
        }
    }
}

fn scan_dir(dir: &Path, exes: &mut Vec<ExeInfo>) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let entry_path = entry.path();
            if entry_path.is_dir() {
                if let Some(name) = entry_path.file_name().and_then(|n| n.to_str()) {
                    if name.starts_with('.') || name.starts_with('_') {
                        continue;
                    }
                }
                scan_dir(&entry_path, exes);
            } else if let Some(ext) = entry_path.extension().and_then(|e| e.to_str()) {
                if ext.eq_ignore_ascii_case("exe") {
                    if let Some(stem) = entry_path.file_stem().and_then(|s| s.to_str()) {
                        if SKIP_KEYWORDS.iter().any(|kw| stem.to_lowercase().contains(kw)) {
                            continue;
                        }
                    }
                    if let Ok(meta) = entry.metadata() {
                        let size = meta.len();
                        let modified_at = meta.modified()
                            .ok()
                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|d| d.as_secs())
                            .unwrap_or(0);
                        exes.push(ExeInfo {
                            path: entry_path.to_string_lossy().to_string(),
                            size,
                            modified_at,
                        });
                    }
                }
            }
        }
    }
}



