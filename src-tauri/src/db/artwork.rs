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

/// The on-disk directory name for a game id. Kept `pub(crate)` so the
/// library health sweep maps a stored artwork URL back to the folder it
/// was written under without re-implementing the same transform.
pub(crate) fn safe_component(value: &str) -> String {
    value.chars().map(|c| {
        if c.is_ascii_alphanumeric() || matches!(c, '-' | '_') { c } else { '_' }
    }).collect()
}

fn extension_from_data_url(data_url: &str) -> &'static str {
    if data_url.starts_with("data:image/png") { "png" }
    else if data_url.starts_with("data:image/webp") { "webp" }
    else if data_url.starts_with("data:image/gif") { "gif" }
    else if data_url.starts_with("data:image/x-icon")
        || data_url.starts_with("data:image/vnd.microsoft.icon")
        || data_url.starts_with("data:image/ico")
    { "ico" }
    else { "jpg" }
}

fn decode_data_url(value: &str) -> Option<(&str, Vec<u8>)> {
    let (header, payload) = value.split_once(',')?;
    if !header.starts_with("data:") || !header.contains(";base64") { return None; }
    let bytes = general_purpose::STANDARD.decode(payload).ok()?;
    Some((header, bytes))
}

/// Slots that get a downscaled sibling written next to the full-resolution
/// file. Grid/list cards read the `_thumb` variant; detail surfaces keep the
/// original, so a card never decodes a 600x900 poster into a 200px box.
const THUMB_SLOTS: &[&str] = &["cover", "banner", "hero"];

/// Fit-within target box (longest edge) per slot. Images smaller than the
/// box are written as-is — thumbnails are never upscaled.
fn thumb_box(slot: &str) -> Option<(u32, u32)> {
    match slot {
        "cover" => Some((300, 450)),
        "banner" | "hero" => Some((720, 405)),
        _ => None,
    }
}

/// Relative path of a slot's thumbnail sibling: `artwork/<game-id>/<slot>_thumb.webp`.
fn thumbnail_relative_path(game_id: &str, slot: &str) -> Option<String> {
    thumb_box(slot)?;
    Some(format!(
        "{ARTWORK_DIR}/{}/{}_thumb.webp",
        safe_component(game_id),
        safe_component(slot)
    ))
}

/// Decode `bytes`, downscale to fit the slot's box (Lanczos3, never upscaled)
/// and encode losslessly as WebP. Returns `None` for undecodable input so the
/// caller keeps the full-resolution file.
fn encode_thumbnail(bytes: &[u8], slot: &str) -> Option<Vec<u8>> {
    let (max_w, max_h) = thumb_box(slot)?;
    let image = image::load_from_memory(bytes).ok()?;
    let resized = if image.width() > max_w || image.height() > max_h {
        image.resize(max_w, max_h, image::imageops::FilterType::Lanczos3)
    } else {
        image
    };
    let mut out = Vec::new();
    image::codecs::webp::WebPEncoder::new_lossless(&mut out)
        .encode(
            resized.as_bytes(),
            resized.width(),
            resized.height(),
            resized.color().into(),
        )
        .ok()?;
    Some(out)
}

/// Best-effort thumbnail write. A thumbnail is an optimization, so a decode or
/// encode failure must never fail the full-resolution artwork write.
fn write_thumbnail(app_data_dir: &Path, game_id: &str, slot: &str, bytes: &[u8]) {
    let Some(relative) = thumbnail_relative_path(game_id, slot) else { return; };
    let Some(thumb) = encode_thumbnail(bytes, slot) else { return; };
    let _ = write_atomic(&app_data_dir.join(&relative), &thumb);
}

/// Store a data URL as a file and return a relative artwork path.
pub fn store_data_url(app_data_dir: &Path, game_id: &str, slot: &str, value: &str) -> Result<Option<String>, String> {
    let Some((_header, bytes)) = decode_data_url(value) else { return Ok(None); };
    let dir = artwork_root(app_data_dir).join(safe_component(game_id));
    std::fs::create_dir_all(&dir).map_err(|e| format!("create artwork directory: {e}"))?;
    let relative = format!("{ARTWORK_DIR}/{}/{}.{}", safe_component(game_id), safe_component(slot), extension_from_data_url(value));
    write_atomic(&app_data_dir.join(&relative), &bytes)?;
    write_thumbnail(app_data_dir, game_id, slot, &bytes);
    Ok(Some(relative))
}

/// Store a local image file in the artwork directory.
pub fn store_file(app_data_dir: &Path, game_id: &str, slot: &str, source: &Path) -> Result<Option<String>, String> {
    if !source.is_file() { return Ok(None); }
    let bytes = std::fs::read(source).map_err(|e| format!("read artwork source: {e}"))?;
    let ext = MimeGuess::from_path(source).first().map(|m| m.subtype().as_str().to_string()).unwrap_or_else(|| "jpg".to_string());
    let ext = match ext.as_str() {
        "jpeg" => "jpg",
        "x-icon" | "vnd.microsoft.icon" | "ico" => "ico",
        other => other,
    };
    let dir = artwork_root(app_data_dir).join(safe_component(game_id));
    std::fs::create_dir_all(&dir).map_err(|e| format!("create artwork directory: {e}"))?;
    let relative = format!("{ARTWORK_DIR}/{}/{}.{}", safe_component(game_id), safe_component(slot), ext);
    write_atomic(&app_data_dir.join(&relative), &bytes)?;
    write_thumbnail(app_data_dir, game_id, slot, &bytes);
    Ok(Some(relative))
}

/// Write via a unique temp file + rename so concurrent writers (e.g.
/// React StrictMode double-invoking `load_games`) can never observe a
/// half-written artwork file.
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::sync::atomic::{AtomicU64, Ordering};
    static TMP_COUNTER: AtomicU64 = AtomicU64::new(0);
    let seq = TMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let tmp = path.with_file_name(format!(
        ".{}.{}.{}.tmp",
        path.file_name().map(|n| n.to_string_lossy()).unwrap_or_default(),
        std::process::id(),
        seq
    ));
    std::fs::write(&tmp, bytes).map_err(|e| format!("write artwork: {e}"))?;
    if let Err(e) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("commit artwork: {e}"));
    }
    Ok(())
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

/// Generate any missing grid thumbnails for artwork already on disk. Covers
/// libraries written before thumbnails existed; idempotent, so it is safe to
/// run on every boot. Returns the number of thumbnails written.
pub fn ensure_thumbnails(app_data_dir: &Path) -> usize {
    let Ok(games) = std::fs::read_dir(artwork_root(app_data_dir)) else { return 0; };
    let mut written = 0;
    for game in games.flatten() {
        if !game.path().is_dir() { continue; }
        let game_id = game.file_name().to_string_lossy().to_string();
        let Ok(files) = std::fs::read_dir(game.path()) else { continue; };
        for file in files.flatten() {
            let name = file.file_name().to_string_lossy().to_string();
            let Some((slot, _ext)) = name.rsplit_once('.') else { continue; };
            // A `_thumb` file's stem ends in `_thumb`, so it never matches a
            // slot name and the walk is not re-encoding its own output.
            if !THUMB_SLOTS.contains(&slot) { continue; }
            let Some(relative) = thumbnail_relative_path(&game_id, slot) else { continue; };
            if app_data_dir.join(&relative).is_file() { continue; }
            let Ok(bytes) = std::fs::read(file.path()) else { continue; };
            let Some(thumb) = encode_thumbnail(&bytes, slot) else { continue; };
            if write_atomic(&app_data_dir.join(&relative), &thumb).is_ok() { written += 1; }
        }
    }
    written
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extension_from_data_url_detects_ico_variants() {
        assert_eq!(extension_from_data_url("data:image/x-icon;base64,AA=="), "ico");
        assert_eq!(extension_from_data_url("data:image/vnd.microsoft.icon;base64,AA=="), "ico");
        assert_eq!(extension_from_data_url("data:image/ico;base64,AA=="), "ico");
        assert_eq!(extension_from_data_url("data:image/png;base64,AA=="), "png");
        assert_eq!(extension_from_data_url("data:image/webp;base64,AA=="), "webp");
        assert_eq!(extension_from_data_url("data:image/jpeg;base64,AA=="), "jpg");
    }

    #[test]
    fn store_data_url_writes_decoded_file_and_reports_relative_path() {
        let dir = tempfile::tempdir().unwrap();
        // 1x1 transparent PNG.
        let png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
        let relative = store_data_url(dir.path(), "game/one", "icon", png)
            .unwrap()
            .expect("data URL should be stored");
        assert_eq!(relative, "artwork/game_one/icon.png");

        let bytes = std::fs::read(dir.path().join(&relative)).unwrap();
        assert!(bytes.starts_with(&[0x89, b'P', b'N', b'G']));
    }

    fn rgb_png(width: u32, height: u32) -> Vec<u8> {
        let image = image::DynamicImage::ImageRgb8(image::RgbImage::new(width, height));
        let mut out = Vec::new();
        image
            .write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)
            .unwrap();
        out
    }

    #[test]
    fn encode_thumbnail_downscales_to_fit_and_emits_webp() {
        let thumb = encode_thumbnail(&rgb_png(600, 900), "cover").expect("png should decode");
        assert_eq!(&thumb[0..4], b"RIFF");
        assert_eq!(&thumb[8..12], b"WEBP");
        let decoded = image::load_from_memory(&thumb).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (300, 450));
    }

    #[test]
    fn encode_thumbnail_rejects_undecodable_bytes() {
        assert!(encode_thumbnail(b"not an image", "cover").is_none());
        assert!(encode_thumbnail(&rgb_png(10, 10), "logo").is_none());
    }

    #[test]
    fn ensure_thumbnails_backfills_missing_and_skips_existing() {
        let dir = tempfile::tempdir().unwrap();
        let game_dir = dir.path().join("artwork/g1");
        std::fs::create_dir_all(&game_dir).unwrap();
        std::fs::write(game_dir.join("cover.png"), rgb_png(600, 900)).unwrap();

        assert_eq!(ensure_thumbnails(dir.path()), 1);
        assert!(game_dir.join("cover_thumb.webp").is_file());
        assert_eq!(ensure_thumbnails(dir.path()), 0);
    }

    #[test]
    fn store_data_url_ignores_non_data_urls() {
        let dir = tempfile::tempdir().unwrap();
        assert!(store_data_url(dir.path(), "g1", "icon", "https://example.com/a.png")
            .unwrap()
            .is_none());
        assert!(store_data_url(dir.path(), "g1", "icon", "data:image/png,notbase64")
            .unwrap()
            .is_none());
    }
}

