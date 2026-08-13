//! Core DTOs for the download manager.
//!
//! Wire format notes: every struct is `camelCase` on the wire and must
//! stay compatible with `src/types/download.ts` on the frontend.
//! `DownloadStatus` is adjacently tagged (`kind` / `message`).

use serde::{Deserialize, Serialize};

/// Lifecycle status of a download.
///
/// Hydra-style semantics: only ONE download is ever `Downloading` /
/// `FetchingMetadata` at a time (the "active" download). Everything
/// else waits in `Queued`. Completed torrents may transition to
/// `Seeding` when the user enabled seed-after-complete.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase", tag = "kind", content = "message")]
pub enum DownloadStatus {
    /// Waiting for the active slot.
    Queued,
    /// Torrent metadata resolution (DHT/trackers) or debrid magnet upload.
    FetchingMetadata,
    /// Actively transferring bytes.
    Downloading,
    /// Paused by the user (does not occupy the active slot and is not
    /// auto-started by the queue).
    Paused,
    /// Torrent finished and is uploading to peers.
    Seeding,
    Completed,
    Error(String),
}

impl DownloadStatus {
    /// True when this download occupies the single active slot.
    pub fn is_active(&self) -> bool {
        matches!(
            self,
            DownloadStatus::FetchingMetadata | DownloadStatus::Downloading
        )
    }
}

/// What kind of pipeline this download runs on.
#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DownloadKind {
    Torrent,
    Direct,
    /// Magnet handed to a debrid service; becomes an HTTP download of
    /// the debrid-resolved link once the service reports `ready`.
    Debrid,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DownloadFile {
    pub name: String,
    pub size: u64,
    pub downloaded: u64,
    pub progress: f32,
    pub selected: bool,
}

/// One download's full state — the record emitted to the frontend on
/// every `download-progress` tick and returned by every command.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Download {
    pub id: String,
    pub kind: DownloadKind,
    pub name: String,
    /// The magnet URI, `.torrent` path/URL, or direct file URL.
    pub source_uri: String,
    /// Torrents: folder to download into. Direct: full target file path.
    pub save_path: String,
    pub downloaded: u64,
    /// Total bytes of all selected files. `None` until known.
    pub total_size: Option<u64>,
    /// 0.0 – 1.0; `None` while total size is unknown.
    pub progress: Option<f32>,
    /// Live download speed in bytes/sec.
    pub download_speed: u64,
    /// Live upload speed in bytes/sec (torrents only).
    pub upload_speed: u64,
    /// Peers currently connected.
    pub peers: u32,
    /// Known-but-not-connected swarm remainder (`seen - live`).
    pub seeds: u32,
    pub status: DownloadStatus,
    pub game_id: Option<String>,
    pub source_name: String,
    /// Unix seconds when the user added the download.
    pub added_at: u64,
    pub files: Vec<DownloadFile>,
    pub auto_extract: Option<bool>,
    pub extracted: Option<bool>,
    /// Mirror URLs (direct downloads fall back to the next one on failure).
    pub uris: Option<Vec<String>>,
    /// Optional `Referer` header to send when fetching the source
    /// `.torrent` URL (anti-hotlink hosts 401 without it).
    #[serde(default)]
    pub referer: Option<String>,
    /// Completion gate: `true` once real bytes/speed were observed.
    /// Guards against librqbit's transient `progress == total`
    /// right after metadata arrives (see `gate_completion`).
    #[serde(default)]
    pub had_real_downloads: Option<bool>,
    /// Torrent file selection (indices into the metadata file list).
    /// `None` = all files.
    #[serde(default)]
    pub only_files: Option<Vec<usize>>,
    /// True when the user wants this torrent to seed after completion.
    #[serde(default)]
    pub should_seed: Option<bool>,
    /// 0-based position in the waiting queue (only set while `Queued`).
    #[serde(default)]
    pub queue_position: Option<usize>,
}

impl Download {
    /// Fresh record with everything zeroed except identity fields.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        id: String,
        kind: DownloadKind,
        name: String,
        source_uri: String,
        save_path: String,
        game_id: Option<String>,
        source_name: String,
        auto_extract: bool,
    ) -> Self {
        Self {
            id,
            kind,
            name,
            source_uri,
            save_path,
            downloaded: 0,
            total_size: None,
            progress: Some(0.0),
            download_speed: 0,
            upload_speed: 0,
            peers: 0,
            seeds: 0,
            status: DownloadStatus::Queued,
            game_id,
            source_name,
            added_at: unix_now(),
            files: Vec::new(),
            auto_extract: Some(auto_extract),
            extracted: Some(false),
            uris: None,
            referer: None,
            had_real_downloads: Some(false),
            only_files: None,
            should_seed: Some(false),
            queue_position: None,
        }
    }
}

pub fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Gate `Completed` against the per-download "we have seen real
/// activity" flag. librqbit 8.x can briefly report
/// `progress_bytes == total_bytes` right after metadata arrives; without
/// the gate the UI would flash a false 100% completion.
pub fn gate_completion(
    status: DownloadStatus,
    had_real_downloads: Option<bool>,
) -> DownloadStatus {
    if matches!(status, DownloadStatus::Completed)
        && !had_real_downloads.unwrap_or(false)
    {
        return DownloadStatus::Downloading;
    }
    status
}
