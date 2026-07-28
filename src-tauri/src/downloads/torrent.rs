//! librqbit 8.x wrapper: session initialisation, torrent add/start,
//! stat snapshots and id mapping.
//!
//! ## librqbit 8.1.1 API notes
//!
//! - `Session::new_with_opts(folder, SessionOptions)` returns `Arc<Self>`.
//! - `session.with_torrents(|iter| ...)` yields `(usize, &Arc<ManagedTorrent>)`.
//! - `session.add_torrent(...)` returns `AddTorrentResponse` with
//!   `Added` / `AlreadyManaged` / `ListOnly` variants.
//! - `TorrentStats.live` (`Option<LiveStats>`) exposes speeds as
//!   `Speed { mbps }` where `mbps` is actually MiB/s → multiply by
//!   1_048_576 for bytes/sec.
//! - `session.pause/unpause(&handle)`, `session.delete(id, delete_files)`.

use std::sync::Arc;
use std::time::Duration;

use super::types::{DownloadFile, DownloadStatus};

// ─── Session init ───────────────────────────────────────────────────────────

fn build_peer_opts() -> Option<librqbit::PeerConnectionOptions> {
    // Desktop-client tuning: cycle to fast peers quickly (2 s connect
    // timeout vs the 10 s server-profile default), catch stuck peers at
    // 20 s, keep NAT bindings alive with a 30 s keep-alive.
    Some(librqbit::PeerConnectionOptions {
        connect_timeout: Some(Duration::from_secs(2)),
        read_write_timeout: Some(Duration::from_secs(20)),
        keep_alive_interval: Some(Duration::from_secs(30)),
    })
}

/// Open (or create) a librqbit session with persistence, falling back
/// to a non-persistent session when the persistent init fails (e.g.
/// corrupted session state / read-only cache dir).
pub async fn init_session(
    state_dir: &std::path::Path,
) -> Result<Arc<librqbit::Session>, String> {
    std::fs::create_dir_all(state_dir)
        .map_err(|e| format!("Failed to create state dir: {}", e))?;

    // Persistent DHT routing table at an explicitly writable path —
    // keeping it across restarts is the single biggest metadata-fetch
    // speedup (magnets resolve in seconds instead of 30–120 s).
    let dht_persist_path = state_dir.join("dht.json");
    let make_dht_config = || librqbit::dht::PersistentDhtConfig {
        config_filename: Some(dht_persist_path.clone()),
        ..Default::default()
    };

    let persistent_opts = librqbit::SessionOptions {
        persistence: Some(librqbit::SessionPersistenceConfig::Json {
            folder: Some(state_dir.to_path_buf()),
        }),
        fastresume: true,
        listen_port_range: Some(6881..6891),
        enable_upnp_port_forwarding: true,
        peer_opts: build_peer_opts(),
        concurrent_init_limit: Some(4),
        dht_config: Some(make_dht_config()),
        // MEGABYTES; coalesces piece writes into ~1-2 flushes/sec.
        defer_writes_up_to: Some(4),
        ..Default::default()
    };

    match librqbit::Session::new_with_opts(state_dir.to_path_buf(), persistent_opts).await {
        Ok(s) => Ok(s),
        Err(e) => {
            let err_msg = e.to_string();
            eprintln!(
                "[downloads] Warning: persistent torrent session init failed: {}",
                err_msg
            );
            eprintln!("[downloads] Falling back to non-persistent session.");
            let transient_opts = librqbit::SessionOptions {
                persistence: None,
                fastresume: true,
                listen_port_range: Some(6881..6891),
                enable_upnp_port_forwarding: true,
                peer_opts: build_peer_opts(),
                concurrent_init_limit: Some(4),
                dht_config: Some(make_dht_config()),
                defer_writes_up_to: Some(4),
                ..Default::default()
            };
            librqbit::Session::new_with_opts(state_dir.to_path_buf(), transient_opts)
                .await
                .map_err(|fallback_err| {
                    format!(
                        "Failed to open torrent session (even without persistence): {} \
                         (original persistent-init error: {})",
                        fallback_err, err_msg
                    )
                })
        }
    }
}

// ─── Trackers ───────────────────────────────────────────────────────────────

/// Curated public trackers (ngosang/trackerslist). HTTPS/TCP first —
/// they traverse most firewalls; UDP kept last as fallback. Injected
/// into EVERY add via `AddTorrentOptions.trackers` (librqbit extends
/// them onto the torrent's own announce list).
const DEFAULT_TRACKERS: &[&str] = &[
    "https://tracker.tamersunion.org:443/announce",
    "https://tracker.bittorrentic.com:443/announce",
    "https://tracker.cyberia.is:6969/announce",
    "http://tracker.opentrackr.org:80/announce",
    "http://tracker.internetwarriors.net:1337/announce",
    "http://tracker.gbitt.info:80/announce",
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://tracker.openbittorrent.com:6969/announce",
    "udp://tracker.tiny-vps.com:6969/announce",
    "udp://explodie.org:6969/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://tracker.dler.org:6969/announce",
    "udp://opentracker.i2p.rocks:6969/announce",
    "udp://tracker.openbittorrent.com:80/announce",
    "udp://tracker.internetwarriors.net:1337/announce",
];

pub fn default_trackers_vec() -> Vec<String> {
    DEFAULT_TRACKERS.iter().map(|s| s.to_string()).collect()
}

// ─── Id helpers ─────────────────────────────────────────────────────────────

pub fn frontend_id_from_hash(info_hash: &[u8; 20]) -> String {
    let mut hash_bytes = [0u8; 8];
    hash_bytes.copy_from_slice(&info_hash[0..8]);
    let numeric_id = (u64::from_be_bytes(hash_bytes) & 0x7fffffffffffffff) as usize;
    format!("dl_{}", numeric_id)
}

pub fn parse_frontend_id(frontend_id: &str) -> Option<usize> {
    frontend_id.strip_prefix("dl_")?.parse::<usize>().ok()
}

/// Find a `ManagedTorrent` by the numeric part of its frontend id.
pub fn find_handle(
    session: &Arc<librqbit::Session>,
    frontend_id: &str,
) -> Option<Arc<librqbit::ManagedTorrent>> {
    let numeric_id = parse_frontend_id(frontend_id)?;
    session.with_torrents(|iter| {
        for (_id, mt) in iter {
            let info_hash = &mt.shared().info_hash;
            let mut hash_bytes = [0u8; 8];
            hash_bytes.copy_from_slice(&info_hash.0[0..8]);
            let computed =
                (u64::from_be_bytes(hash_bytes) & 0x7fffffffffffffff) as usize;
            if computed == numeric_id {
                return Some(Arc::clone(mt));
            }
        }
        None
    })
}

// ─── Stats mapping ──────────────────────────────────────────────────────────

/// Map librqbit state to our status. Completion keys purely off byte
/// counts (`total > 0 && downloaded >= total`) — `TorrentStats.finished`
/// is deliberately ignored (stale `true` after list_only adds).
/// Callers must additionally run `gate_completion`.
pub fn map_state_to_status(
    state: &librqbit::TorrentStatsState,
    total: u64,
    downloaded: u64,
    error: Option<&str>,
) -> DownloadStatus {
    if total > 0 && downloaded >= total {
        return DownloadStatus::Completed;
    }
    match state {
        librqbit::TorrentStatsState::Paused => DownloadStatus::Paused,
        librqbit::TorrentStatsState::Error => {
            DownloadStatus::Error(error.unwrap_or("Torrent error").to_string())
        }
        librqbit::TorrentStatsState::Initializing => DownloadStatus::FetchingMetadata,
        librqbit::TorrentStatsState::Live => {
            if total == 0 {
                DownloadStatus::FetchingMetadata
            } else {
                DownloadStatus::Downloading
            }
        }
    }
}

/// `(download_bps, upload_bps, seeds, peers)` from a stats snapshot.
pub fn extract_live_stats(stats: &librqbit::TorrentStats) -> (u64, u64, u32, u32) {
    let Some(live) = stats.live.as_ref() else {
        return (0, 0, 0, 0);
    };
    // `Speed.mbps` is actually MiB/s (mis-named upstream).
    let download_speed = (live.download_speed.mbps * 1_048_576.0) as u64;
    let upload_speed = (live.upload_speed.mbps * 1_048_576.0) as u64;
    let peers = u32::try_from(live.snapshot.peer_stats.live).unwrap_or(u32::MAX);
    let seeds = u32::try_from(
        live.snapshot
            .peer_stats
            .seen
            .saturating_sub(live.snapshot.peer_stats.live),
    )
    .unwrap_or(u32::MAX);
    (download_speed, upload_speed, seeds, peers)
}

/// Build a `DownloadFile` list from a live handle. `None` when the
/// metadata isn't parsed yet — callers must PRESERVE their cached list
/// in that case (a transient miss must not wipe the user's selection).
pub fn files_from_handle(
    handle: &Arc<librqbit::ManagedTorrent>,
    stats: &librqbit::TorrentStats,
) -> Option<Vec<DownloadFile>> {
    let only_files_list = handle.only_files();
    handle
        .with_metadata(|meta_data| {
            meta_data
                .file_infos
                .iter()
                .enumerate()
                .map(|(i, info)| {
                    let f_downloaded = stats.file_progress.get(i).copied().unwrap_or(0);
                    let f_size = info.len;
                    let f_progress = if f_size > 0 {
                        f_downloaded as f32 / f_size as f32
                    } else {
                        0.0
                    };
                    let f_selected = match &only_files_list {
                        Some(indices) => indices.contains(&i),
                        None => true,
                    };
                    DownloadFile {
                        name: info.relative_filename.to_string_lossy().into_owned(),
                        size: f_size,
                        downloaded: f_downloaded,
                        progress: f_progress,
                        selected: f_selected,
                    }
                })
                .collect::<Vec<DownloadFile>>()
        })
        .ok()
}

// ─── Add / start ────────────────────────────────────────────────────────────

/// True when the URI points at a local `.torrent` file.
pub fn local_torrent_path(uri: &str) -> Option<String> {
    let trimmed = uri.trim();
    if let Some(stripped) = trimmed.strip_prefix("file://") {
        return Some(stripped.to_string());
    }
    if (trimmed.ends_with(".torrent") || trimmed.contains(".torrent?"))
        && !trimmed.starts_with("http://")
        && !trimmed.starts_with("https://")
        && !trimmed.starts_with("magnet:")
    {
        return Some(trimmed.to_string());
    }
    None
}

async fn build_add_torrent(uri: &str) -> Result<librqbit::AddTorrent<'static>, String> {
    match local_torrent_path(uri) {
        Some(path) => {
            let bytes = tokio::fs::read(&path)
                .await
                .map_err(|e| format!("Failed to read .torrent file: {}", e))?;
            Ok(librqbit::AddTorrent::from_bytes(bytes))
        }
        None => Ok(librqbit::AddTorrent::from_url(uri.to_string())),
    }
}

/// Add a torrent to the session and bring it Live, applying an
/// optional file selection. Waits (bounded) for metadata when a file
/// selection needs to be applied. Returns the live handle.
///
/// This is the single start path used for fresh starts, queue starts
/// and seeding re-adds — replacing the three divergent copies in the
/// old engine.
pub async fn add_and_start(
    session: &Arc<librqbit::Session>,
    source_uri: &str,
    save_path: &str,
    only_files: Option<&[usize]>,
) -> Result<Arc<librqbit::ManagedTorrent>, String> {
    // A previous list_only add of the same infohash leaves librqbit
    // treating the torrent as metadata-only; delete-then-re-add gives
    // a clean slate (metadata stays cached, so the re-add is fast).
    let add = build_add_torrent(source_uri).await?;
    let add_opts = librqbit::AddTorrentOptions {
        output_folder: Some(save_path.into()),
        overwrite: true,
        list_only: false,
        only_files: only_files.map(|v| v.to_vec()),
        trackers: Some(default_trackers_vec()),
        force_tracker_interval: Some(Duration::from_secs(30)),
        ..Default::default()
    };

    let response = tokio::time::timeout(
        Duration::from_secs(120),
        session.add_torrent(add, Some(add_opts)),
    )
    .await
    .map_err(|_| {
        "Timed out fetching metadata — no peers responded. Check your \
         firewall or try a different source."
            .to_string()
    })?
    .map_err(|e| format!("Failed to add torrent: {}", e))?;

    let handle = response
        .into_handle()
        .ok_or_else(|| "Failed to start torrent: no handle returned".to_string())?;

    // Apply the file selection once metadata is parsed. Calling
    // update_only_files before metadata is loaded silently fails and
    // the torrent would download ALL files.
    if let Some(indices) = only_files {
        let only_files_set: std::collections::HashSet<usize> =
            indices.iter().copied().collect();
        let mut update_ok = false;
        for attempt in 0..30 {
            if handle.with_metadata(|_| ()).is_ok() {
                match session.update_only_files(&handle, &only_files_set).await {
                    Ok(()) => {
                        update_ok = true;
                        break;
                    }
                    Err(e) => {
                        eprintln!(
                            "[downloads] update_only_files failed (will retry): {}",
                            e
                        );
                    }
                }
            } else if attempt == 9 {
                eprintln!(
                    "[downloads] metadata not parsed after 10s; still waiting to \
                     apply file selection..."
                );
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
        if !update_ok {
            eprintln!(
                "[downloads] gave up waiting for metadata; file selection may \
                 not be applied."
            );
        }
    }

    let _ = session.unpause(&handle).await;
    Ok(handle)
}

/// Delete a torrent from the session by frontend id (keeps files).
pub async fn delete_from_session(session: &Arc<librqbit::Session>, frontend_id: &str) {
    if let Some(handle) = find_handle(session, frontend_id) {
        let _ = session
            .delete(librqbit::api::TorrentIdOrHash::Id(handle.id()), false)
            .await;
    }
}
