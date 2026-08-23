//! On-disk persistence for the download manager.
//!
//! State lives in `<app_data_dir>/torrent-engine/downloads.json` (the
//! same directory librqbit uses for its session state, so torrent
//! fast-resume keeps working across the rewrite).
//!
//! ## Format
//!
//! v2 (this module): `{ "version": 2, "downloads": [Download...],
//! "queue": ["id"...] }`.
//!
//! v1 (pre-rewrite): a bare `HashMap<String, SavedMetadata>`. Loaded
//! transparently and migrated to v2 on the first save.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::types::{unix_now, Download, DownloadFile, DownloadKind, DownloadStatus};

/// A torrent the user removed from the list. Kept so a torrent that
/// librqbit restores from its own session state on the next boot — the
/// session delete from `torrent_remove` is async and can be cut short
/// by an exit — is dropped again instead of resurrected as a
/// "Discovered" record.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct RemovedTorrent {
    id: String,
    delete_files: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct StateV2 {
    version: u32,
    downloads: Vec<Download>,
    #[serde(default)]
    queue: Vec<String>,
    #[serde(default)]
    removed: Vec<RemovedTorrent>,
}

/// The legacy (v1) per-download metadata shape.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyMetadata {
    source_uri: String,
    save_path: String,
    game_id: Option<String>,
    source_name: String,
    added_at: u64,
    auto_extract: Option<bool>,
    extracted: Option<bool>,
    total_size: Option<u64>,
    #[serde(default)]
    files: Vec<DownloadFile>,
    status: Option<DownloadStatus>,
    uris: Option<Vec<String>>,
    #[serde(default)]
    had_real_downloads: Option<bool>,
}

pub struct LoadedState {
    pub downloads: HashMap<String, Download>,
    /// Removed torrent frontend ids → whether the user asked to delete
    /// the on-disk files.
    pub removed_torrents: HashMap<String, bool>,
}

pub fn state_file(state_dir: &Path) -> PathBuf {
    state_dir.join("downloads.json")
}

/// Load persisted state, trying v2 first and falling back to the
/// legacy v1 map. Live stats (speeds, peers) are reset; statuses are
/// normalised for a cold start (an interrupted active download comes
/// back as `Queued` so the queue restarts it).
pub fn load(state_dir: &Path) -> LoadedState {
    let path = state_file(state_dir);
    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => {
            return LoadedState {
                downloads: HashMap::new(),
                removed_torrents: HashMap::new(),
            }
        }
    };

    if let Ok(v2) = serde_json::from_str::<StateV2>(&content) {
        let mut map = HashMap::new();
        for mut d in v2.downloads {
            normalise_on_load(&mut d);
            map.insert(d.id.clone(), d);
        }
        let removed_torrents = v2
            .removed
            .into_iter()
            .map(|r| (r.id, r.delete_files))
            .collect();
        return LoadedState {
            downloads: map,
            removed_torrents,
        };
    }

    // Legacy v1 migration.
    let legacy: HashMap<String, LegacyMetadata> =
        serde_json::from_str(&content).unwrap_or_default();
    let mut map = HashMap::new();
    for (id, meta) in legacy {
        let kind = if id.starts_with("dd_") {
            DownloadKind::Direct
        } else if id.starts_with("db_") {
            DownloadKind::Debrid
        } else {
            DownloadKind::Torrent
        };
        let status = meta.status.clone().unwrap_or(DownloadStatus::Completed);
        let was_completed = matches!(status, DownloadStatus::Completed);
        let name = std::path::Path::new(&meta.save_path)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("Restored Download")
            .to_string();
        let mut d = Download {
            id: id.clone(),
            kind,
            name,
            source_uri: meta.source_uri,
            save_path: meta.save_path,
            downloaded: if was_completed {
                meta.total_size.unwrap_or(0)
            } else {
                0
            },
            total_size: meta.total_size,
            progress: if was_completed { Some(1.0) } else { Some(0.0) },
            download_speed: 0,
            upload_speed: 0,
            peers: 0,
            seeds: 0,
            status,
            game_id: meta.game_id,
            game_poster: None,
            source_name: meta.source_name,
            added_at: meta.added_at,
            files: meta.files,
            auto_extract: meta.auto_extract,
            extracted: meta.extracted,
            uris: meta.uris,
            referer: None,
            had_real_downloads: match meta.had_real_downloads {
                Some(b) => Some(b),
                None => Some(was_completed),
            },
            debrid_cached: None,
            only_files: None,
            should_seed: Some(false),
            queue_position: None,
            extra_headers: None,
            peak_speed: None,
            completed_at: None,
            magnet_uri: None,
        };
        normalise_on_load(&mut d);
        map.insert(id, d);
    }
    LoadedState {
        downloads: map,
        removed_torrents: HashMap::new(),
    }
}

/// Reset live stats and normalise statuses after a cold start.
fn normalise_on_load(d: &mut Download) {
    d.download_speed = 0;
    d.upload_speed = 0;
    d.peers = 0;
    d.seeds = 0;
    d.queue_position = None;
    match d.status {
        // A download that was mid-flight when the app closed goes
        // back to the queue so the manager restarts it.
        DownloadStatus::Downloading | DownloadStatus::FetchingMetadata => {
            d.status = DownloadStatus::Queued;
            // Re-stamp so watchdog timers measure from this boot.
            d.added_at = unix_now();
        }
        DownloadStatus::Seeding => {
            // Seeding resumes on startup (manager re-adds to session).
            d.should_seed = Some(true);
        }
        _ => {}
    }
}

/// Persist the full state (v2 format). Blocking write — call from the
/// background flush path only (or from a removal command so a just-
/// deleted download can never be resurrected by an immediate exit).
pub fn save(
    state_dir: &Path,
    downloads: &HashMap<String, Download>,
    removed_torrents: &HashMap<String, bool>,
) {
    let state = StateV2 {
        version: 2,
        downloads: downloads.values().cloned().collect(),
        queue: Vec::new(),
        removed: removed_torrents
            .iter()
            .map(|(id, delete_files)| RemovedTorrent {
                id: id.clone(),
                delete_files: *delete_files,
            })
            .collect(),
    };
    if let Ok(content) = serde_json::to_string_pretty(&state) {
        let path = state_file(state_dir);
        let tmp = path.with_extension("json.tmp");
        if std::fs::write(&tmp, &content).is_ok() {
            let _ = std::fs::rename(&tmp, &path);
        } else {
            let _ = std::fs::write(&path, content);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn temp_state_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "gamelib-persist-test-{}-{}",
            tag,
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn removed_torrents_round_trip() {
        let dir = temp_state_dir("roundtrip");
        let mut downloads = HashMap::new();
        let d = Download::new(
            "dl_123".to_string(),
            DownloadKind::Torrent,
            "Game".to_string(),
            "magnet:?xt=urn:btih:abc".to_string(),
            "C:\\Games\\Game".to_string(),
            None,
            "Store".to_string(),
            false,
        );
        downloads.insert(d.id.clone(), d);

        let mut removed = HashMap::new();
        removed.insert("dl_999".to_string(), true);
        removed.insert("dl_1000".to_string(), false);
        save(&dir, &downloads, &removed);

        let loaded = load(&dir);
        assert_eq!(loaded.downloads.len(), 1);
        assert_eq!(loaded.removed_torrents.get("dl_999"), Some(&true));
        assert_eq!(loaded.removed_torrents.get("dl_1000"), Some(&false));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn v2_without_removed_field_still_loads() {
        // State written by a build predating the tombstone field must
        // load with an empty tombstone set (serde default).
        let dir = temp_state_dir("backcompat");
        std::fs::write(
            state_file(&dir),
            r#"{"version": 2, "downloads": [], "queue": []}"#,
        )
        .unwrap();

        let loaded = load(&dir);
        assert!(loaded.downloads.is_empty());
        assert!(loaded.removed_torrents.is_empty());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
