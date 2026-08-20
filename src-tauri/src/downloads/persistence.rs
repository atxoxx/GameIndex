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

#[derive(Debug, Serialize, Deserialize)]
struct StateV2 {
    version: u32,
    downloads: Vec<Download>,
    #[serde(default)]
    queue: Vec<String>,
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
    pub queue: Vec<String>,
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
                queue: Vec::new(),
            }
        }
    };

    if let Ok(v2) = serde_json::from_str::<StateV2>(&content) {
        let mut map = HashMap::new();
        for mut d in v2.downloads {
            normalise_on_load(&mut d);
            map.insert(d.id.clone(), d);
        }
        let queue = v2
            .queue
            .into_iter()
            .filter(|id| map.contains_key(id))
            .collect();
        return LoadedState {
            downloads: map,
            queue,
        };
    }

    // Legacy v1 migration.
    let legacy: HashMap<String, LegacyMetadata> =
        serde_json::from_str(&content).unwrap_or_default();
    let mut map = HashMap::new();
    let mut queue = Vec::new();
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
        };
        normalise_on_load(&mut d);
        if matches!(d.status, DownloadStatus::Queued) {
            queue.push(id.clone());
        }
        map.insert(id, d);
    }
    LoadedState {
        downloads: map,
        queue,
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
/// background flush path only.
pub fn save(state_dir: &Path, downloads: &HashMap<String, Download>, queue: &[String]) {
    let state = StateV2 {
        version: 2,
        downloads: downloads.values().cloned().collect(),
        queue: queue.to_vec(),
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
