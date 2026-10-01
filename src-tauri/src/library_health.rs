//! Library health helpers that need filesystem access.
//!
//! The Storage page's Health & Maintenance center derives most findings
//! from the in-memory library (duplicate rows, missing metadata, stale
//! sizes, unplayed backlog). Two questions can only be answered on the
//! Rust side: whether a recorded install folder still exists, and which
//! artwork files on disk are no longer referenced by any library row.
//!
//! Path existence already lives in [`crate::size::check_paths_exist`].
//! This module adds the artwork sweep and the surgical delete that runs
//! after the user confirms a cleanup. Both commands are read-only until
//! `delete_orphaned_artwork` is called with an explicit path list, so a
//! scan can never remove anything on its own.

use std::collections::HashMap;
use std::path::{Component, Path};

use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::db::artwork::safe_component;
use crate::db::Db;

const ARTWORK_DIR: &str = "artwork";

/// One artwork file that no library row points at any more.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OrphanArtwork {
    /// Path relative to the app data dir, e.g. `artwork/<id>/cover.png`.
    /// Passed back verbatim to [`delete_orphaned_artwork`].
    pub relative_path: String,
    /// The folder name (safe component of the owning game id) the file
    /// lives under. Display-only.
    pub game_id: String,
    /// Slot inferred from the file stem (`cover`, `icon`, `banner`,
    /// `logo`, or whatever a legacy writer produced).
    pub slot: String,
    pub size_bytes: u64,
    /// `unreferenced_game` when the whole folder belongs to a game that
    /// is no longer in the library, `unreferenced_slot` when the game is
    /// still present but this particular file was replaced.
    pub reason: String,
    /// Last modified time in unix seconds, when the platform reports it.
    pub modified_at: Option<u64>,
}

/// Percent-decode a URL so it can be compared against an on-disk relative
/// path. Asset-protocol URLs percent-encode separators
/// (`C%3A%2F…%2Fartwork%2Fcover.png`), which a plain substring test would
/// miss — that mismatch once caused live artwork to be treated as orphaned.
fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(value) = u8::from_str_radix(&input[i + 1..i + 3], 16) {
                out.push(value);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Map each artwork folder name to the artwork URL strings its owning
/// game still references, decoded and slash-normalized so the reference
/// test below works across `file://` and asset-protocol forms.
fn collect_referenced(rows: &[crate::db::games::GameRow]) -> HashMap<String, Vec<String>> {
    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    for row in rows {
        let entry = map.entry(safe_component(&row.id)).or_default();
        for url in [
            row.cover_art_url.as_ref(),
            row.icon_url.as_ref(),
            row.banner_url.as_ref(),
            row.logo_url.as_ref(),
        ] {
            if let Some(url) = url {
                entry.push(percent_decode(url).replace('\\', "/"));
            }
        }
    }
    map
}

/// True when `relative_path` (`artwork/<dir>/<file>`) is still referenced
/// by one of its owning game's artwork URLs.
pub(crate) fn is_artwork_referenced(
    relative_path: &str,
    referenced: &HashMap<String, Vec<String>>,
) -> bool {
    let mut parts = relative_path.splitn(3, '/');
    if parts.next().is_none() {
        return false;
    }
    let Some(dir) = parts.next() else { return false };
    if parts.next().is_none() {
        return false;
    }
    referenced
        .get(dir)
        .map(|urls| urls.iter().any(|url| url.contains(relative_path)))
        .unwrap_or(false)
}

/// Walk every file under `<app_data_dir>/artwork` and return the ones not
/// referenced by the library rows. Pure against the passed-in reference
/// map so it can be unit-tested without a database.
pub(crate) fn scan_artwork(
    artwork_root: &Path,
    referenced: &HashMap<String, Vec<String>>,
) -> Vec<OrphanArtwork> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(artwork_root) else {
        return out;
    };
    for entry in entries.flatten() {
        let dir_path = entry.path();
        if !dir_path.is_dir() {
            continue;
        }
        let dir = entry.file_name().to_string_lossy().to_string();
        let dir_known = referenced.contains_key(&dir);
        let Ok(files) = std::fs::read_dir(&dir_path) else {
            continue;
        };
        for file in files.flatten() {
            let file_path = file.path();
            if !file_path.is_file() {
                continue;
            }
            let file_name = file.file_name().to_string_lossy().to_string();
            let relative_path = format!("{ARTWORK_DIR}/{dir}/{file_name}");
            if is_artwork_referenced(&relative_path, referenced) {
                continue;
            }
            let meta = file.metadata().ok();
            let size_bytes = meta.as_ref().map(|m| m.len()).unwrap_or(0);
            let modified_at = meta
                .as_ref()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs());
            let slot = file_name
                .rsplit_once('.')
                .map(|(stem, _)| stem.to_string())
                .unwrap_or_else(|| file_name.clone());
            out.push(OrphanArtwork {
                relative_path,
                game_id: dir.clone(),
                slot,
                size_bytes,
                reason: if dir_known {
                    "unreferenced_slot".into()
                } else {
                    "unreferenced_game".into()
                },
                modified_at,
            });
        }
    }
    out.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    out
}

/// Reject anything that is not `artwork/<dir>/<file>` so a malformed or
/// malicious relative path can never escape the artwork directory.
pub(crate) fn is_safe_artwork_path(relative_path: &str) -> bool {
    let normalized = relative_path.replace('\\', "/");
    if !normalized.starts_with(&format!("{ARTWORK_DIR}/")) {
        return false;
    }
    Path::new(&normalized)
        .components()
        .all(|c| matches!(c, Component::Normal(_)))
}

/// List artwork files under `<app_data_dir>/artwork` that no library row
/// references any more. Read-only: the caller decides whether to delete.
#[tauri::command]
pub async fn scan_orphaned_artwork(app: tauri::AppHandle) -> Result<Vec<OrphanArtwork>, String> {
    let db = app.state::<Db>().inner().clone();
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let artwork_root = data_dir.join(ARTWORK_DIR);
        if !artwork_root.exists() {
            return Ok(Vec::new());
        }
        let rows = crate::db::games::list_all(&db)?;
        let referenced = collect_referenced(&rows);
        Ok(scan_artwork(&artwork_root, &referenced))
    })
    .await
    .map_err(|e| format!("scan_orphaned_artwork task: {e}"))?
}

/// Delete a user-confirmed set of orphaned artwork files, returning the
/// number of bytes reclaimed. Empty game folders are pruned afterwards.
#[tauri::command]
pub async fn delete_orphaned_artwork(
    app: tauri::AppHandle,
    relative_paths: Vec<String>,
) -> Result<u64, String> {
    let db = app.state::<Db>().inner().clone();
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let artwork_root = data_dir.join(ARTWORK_DIR);
        // Re-derive the reference set from the live library before deleting
        // anything: even if the frontend sends a stale or wrong path list,
        // a file that is still referenced is never removed.
        let referenced = match crate::db::games::list_all(&db) {
            Ok(rows) => collect_referenced(&rows),
            Err(e) => return Err(format!("Could not verify artwork references: {e}")),
        };
        let mut freed: u64 = 0;
        for relative_path in relative_paths {
            if !is_safe_artwork_path(&relative_path) {
                continue;
            }
            if is_artwork_referenced(&relative_path, &referenced) {
                continue;
            }
            let full = data_dir.join(&relative_path);
            if !full.starts_with(&artwork_root) {
                continue;
            }
            if let Ok(meta) = std::fs::metadata(&full) {
                if meta.is_file() && std::fs::remove_file(&full).is_ok() {
                    freed += meta.len();
                }
            }
            if let Some(parent) = full.parent() {
                if parent != artwork_root {
                    if let Ok(mut it) = std::fs::read_dir(parent) {
                        if it.next().is_none() {
                            let _ = std::fs::remove_dir(parent);
                        }
                    }
                }
            }
        }
        Ok(freed)
    })
    .await
    .map_err(|e| format!("delete_orphaned_artwork task: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_path_rejects_traversal_and_absolute_paths() {
        assert!(is_safe_artwork_path("artwork/g1/cover.png"));
        assert!(!is_safe_artwork_path("../secrets.txt"));
        assert!(!is_safe_artwork_path("artwork/../../secrets.txt"));
        assert!(!is_safe_artwork_path("/etc/passwd"));
        assert!(!is_safe_artwork_path("artwork\\..\\..\\secrets.txt"));
        assert!(!is_safe_artwork_path("other/g1/cover.png"));
    }

    #[test]
    fn percent_decoded_asset_urls_stay_referenced() {
        // What `convertFileSrc` stores: separators (and the drive colon)
        // percent-encoded. This is the exact form that previously failed a
        // plain substring match and caused live artwork to be flagged.
        let encoded = "http://asset.localhost/C%3A%2Fdata%2Fartwork%2Fg1%2Fcover.png";
        let decoded = percent_decode(encoded).replace('\\', "/");
        let mut referenced = HashMap::new();
        referenced.insert("g1".to_string(), vec![decoded]);
        assert!(is_artwork_referenced("artwork/g1/cover.png", &referenced));
        assert!(!is_artwork_referenced("artwork/g1/banner.png", &referenced));
    }

    #[test]
    fn scan_reports_unreferenced_games_and_slots() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join(ARTWORK_DIR);
        std::fs::create_dir_all(root.join("g1")).unwrap();
        std::fs::create_dir_all(root.join("g2")).unwrap();
        std::fs::write(root.join("g1").join("cover.png"), b"cover").unwrap();
        std::fs::write(root.join("g1").join("banner.png"), b"banner").unwrap();
        std::fs::write(root.join("g2").join("icon.png"), b"icon!!").unwrap();

        let mut referenced = HashMap::new();
        referenced.insert(
            "g1".to_string(),
            vec!["file:///data/artwork/g1/cover.png".to_string()],
        );

        let mut orphans = scan_artwork(&root, &referenced);
        orphans.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
        assert_eq!(orphans.len(), 2);

        let banner = orphans
            .iter()
            .find(|o| o.relative_path == "artwork/g1/banner.png")
            .expect("replaced slot should be orphaned");
        assert_eq!(banner.reason, "unreferenced_slot");
        assert_eq!(banner.size_bytes, 6);

        let icon = orphans
            .iter()
            .find(|o| o.relative_path == "artwork/g2/icon.png")
            .expect("deleted game folder should be orphaned");
        assert_eq!(icon.reason, "unreferenced_game");
        assert_eq!(icon.size_bytes, 6);
    }
}
