//! Disk-backed artwork storage.
//!
//! Artwork is kept outside SQLite so loading the library does not duplicate
//! large base64 strings in Rust, SQLite, and the webview heap. Files are
//! stored under `<app_data_dir>/artwork/<game-id>/`.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use base64::{engine::general_purpose, Engine as _};
use mime_guess::MimeGuess;
use std::collections::HashSet;

const ARTWORK_DIR: &str = "artwork";
const CACHE_DIRS: &[&str] = &["artwork-cache", "image-cache", "store-cache", "news-cache"];

fn artwork_root(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(ARTWORK_DIR)
}

fn safe_component(value: &str) -> String {
    value.chars().map(|c| {
        if c.is_ascii_alphanumeric() || matches!(c, '-' | '_') { c } else { '_' }
    }).collect()
}

fn extension_from_data_url(data_url: &str) -> &'static str {
    if data_url.starts_with("data:image/png") { "png" }
    else if data_url.starts_with("data:image/webp") { "webp" }
    else if data_url.starts_with("data:image/gif") { "gif" }
    else { "jpg" }
}

fn decode_data_url(value: &str) -> Option<(&str, Vec<u8>)> {
    let (header, payload) = value.split_once(',')?;
    if !header.starts_with("data:") || !header.contains(";base64") { return None; }
    let bytes = general_purpose::STANDARD.decode(payload).ok()?;
    Some((header, bytes))
}

/// Store a data URL as a file and return a relative artwork path.
pub fn store_data_url(app_data_dir: &Path, game_id: &str, slot: &str, value: &str) -> Result<Option<String>, String> {
    let Some((_header, bytes)) = decode_data_url(value) else { return Ok(None); };
    let dir = artwork_root(app_data_dir).join(safe_component(game_id));
    std::fs::create_dir_all(&dir).map_err(|e| format!("create artwork directory: {e}"))?;
    let relative = format!("{ARTWORK_DIR}/{}/{}.{}", safe_component(game_id), safe_component(slot), extension_from_data_url(value));
    std::fs::write(app_data_dir.join(&relative), bytes).map_err(|e| format!("write artwork: {e}"))?;
    Ok(Some(relative))
}

/// Store a local image file in the artwork directory.
pub fn store_file(app_data_dir: &Path, game_id: &str, slot: &str, source: &Path) -> Result<Option<String>, String> {
    if !source.is_file() { return Ok(None); }
    let bytes = std::fs::read(source).map_err(|e| format!("read artwork source: {e}"))?;
    let ext = MimeGuess::from_path(source).first().map(|m| m.subtype().as_str().to_string()).unwrap_or_else(|| "jpg".to_string());
    let ext = match ext.as_str() { "jpeg" => "jpg", "x-icon" => "ico", other => other };
    let dir = artwork_root(app_data_dir).join(safe_component(game_id));
    std::fs::create_dir_all(&dir).map_err(|e| format!("create artwork directory: {e}"))?;
    let relative = format!("{ARTWORK_DIR}/{}/{}.{}", safe_component(game_id), safe_component(slot), ext);
    std::fs::write(app_data_dir.join(&relative), bytes).map_err(|e| format!("write artwork: {e}"))?;
    Ok(Some(relative))
}

/// Remove temporary/non-library caches older than `max_age`.
pub fn cleanup_non_library_caches(app_data_dir: &Path, max_age: Duration) {
    let now = SystemTime::now();
    for name in CACHE_DIRS {
        let root = app_data_dir.join(name);
        let Ok(entries) = std::fs::read_dir(root) else { continue; };
        for entry in entries.flatten() {
            let path = entry.path();
            let stale = entry.metadata().ok().and_then(|m| m.modified().ok())
                .and_then(|modified| now.duration_since(modified).ok())
                .map(|age| age > max_age).unwrap_or(false);
            if stale {
                if path.is_dir() { let _ = std::fs::remove_dir_all(path); }
                else { let _ = std::fs::remove_file(path); }
            }
        }
    }
}

/// Delete artwork files no longer referenced by library rows.
pub fn cleanup_unreferenced_artwork(app_data_dir: &Path, library_ids: &HashSet<String>) {
    let root = artwork_root(app_data_dir);
    let Ok(entries) = std::fs::read_dir(root) else { return; };
    for entry in entries.flatten() {
        if entry.path().is_dir() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !library_ids.contains(&name) { let _ = std::fs::remove_dir_all(entry.path()); }
        }
    }
}
