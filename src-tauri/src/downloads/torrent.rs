//! librqbit 9.x wrapper: session initialisation, torrent add/start,
//! stat snapshots and id mapping.
//!
//! ## librqbit 9.0.1 API notes
//!
//! - `Session::new_with_opts(folder, SessionOptions)` returns `Arc<Self>`.
//! - `session.with_torrents(|iter| ...)` yields `(usize, &Arc<ManagedTorrent>)`.
//! - `session.add_torrent(...)` returns `AddTorrentResponse` with
//!   `Added` / `AlreadyManaged` / `ListOnly` variants.
//! - `TorrentStats.live` (`Option<LiveStats>`) exposes speeds as
//!   `Speed { mbps }` where `mbps` is actually MiB/s → multiply by
//!   1_048_576 for bytes/sec.
//! - `session.pause/unpause(&handle)`, `session.delete(id, delete_files)`.
//! - 9.x restructured `SessionOptions`: `listen_port_range` +
//!   `enable_upnp_port_forwarding` → `listen: ListenerOptions` (dualstack
//!   `[::]` ephemeral port; uTP behind `ListenerMode`), `peer_opts` →
//!   `connect: ConnectionOptions`, `dht_config: PersistentDhtConfig` →
//!   `dht: DhtSessionConfig`; `defer_writes_up_to` is gone (the write
//!   path was reworked — async bitv flushing, no deferred queue).
//! - `TorrentStatsState::Initializing { paused }` carries the file-check
//!   pause flag (pausing during the initial check is now allowed).

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

/// How long a librqbit session operation that drains file handles
/// (pause / delete) may block on in-flight disk I/O before we give up.
/// librqbit drains handles while holding internal locks; a stuck chunk
/// write (slow/removed disk, antivirus lock) would otherwise freeze the
/// whole app, since the lock wait is synchronous.
pub(crate) const SESSION_OP_TIMEOUT_SECS: u64 = 10;

/// Open (or create) a librqbit session with persistence, recovering
/// through a ladder of progressively weaker configs when init fails
/// (e.g. a locked/corrupt DHT routing table, the stored DHT port taken
/// by a lingering process, or a corrupt session db). Never gives up
/// session persistence unless nothing else opens.
pub async fn init_session(
    state_dir: &std::path::Path,
) -> Result<Arc<librqbit::Session>, String> {
    std::fs::create_dir_all(state_dir)
        .map_err(|e| format!("Failed to create state dir: {}", e))?;

    // Persistent DHT routing table at an explicitly writable path —
    // keeping it across restarts is the single biggest metadata-fetch
    // speedup (magnets resolve in seconds instead of 30–120 s).
    let dht_persist_path = state_dir.join("dht.json");
    let session_json_path = state_dir.join("session.json");
    let make_dht_config = |persist: bool, port: Option<u16>| librqbit::DhtSessionConfig {
        bootstrap_addrs: None,
        port,
        persistence: if persist {
            Some(librqbit::dht::DhtPersistenceConfig {
                config_filename: Some(dht_persist_path.clone()),
                dump_interval: None,
            })
        } else {
            None
        },
    };

    // Session-level trackers: merged into EVERY torrent's announce list.
    // This is the ONLY place our curated trackers reach MAGNET links —
    // librqbit ignores `AddTorrentOptions.trackers` on the magnet add
    // path, so without this a trackless magnet relies solely on DHT.
    let session_trackers = || -> std::collections::HashSet<url::Url> {
        default_trackers_vec()
            .iter()
            .filter_map(|t| url::Url::parse(t).ok())
            .collect()
    };

    // Incoming peer listener: ephemeral dualstack (IPv4+IPv6) TCP + uTP
    // ports. Replaces the old 6881..6891 range — no conflict risk, the
    // bound port is read back and announced to trackers.
    let make_listener = || librqbit::ListenerOptions {
        mode: librqbit::ListenerMode::TcpAndUtp,
        listen_addr: (std::net::Ipv6Addr::UNSPECIFIED, 0).into(),
        enable_upnp_port_forwarding: true,
        ..Default::default()
    };

    // Outgoing peer connections: cycle to fast peers quickly (2 s
    // connect timeout vs the 10 s server-profile default), catch stuck
    // peers at 20 s, keep NAT bindings alive with a 30 s keep-alive.
    let make_connect = || librqbit::ConnectionOptions {
        peer_opts: build_peer_opts(),
        ..Default::default()
    };

    let make_opts =
        |session_persist: bool, dht_persist: bool, dht_port: Option<u16>| {
            librqbit::SessionOptions {
                persistence: if session_persist {
                    Some(librqbit::SessionPersistenceConfig::Json {
                        folder: Some(state_dir.to_path_buf()),
                    })
                } else {
                    None
                },
                fastresume: true,
                listen: Some(make_listener()),
                connect: Some(make_connect()),
                concurrent_init_limit: Some(4),
                dht: Some(make_dht_config(dht_persist, dht_port)),
                trackers: session_trackers(),
                ..Default::default()
            }
        };

    // Preferred config: session persistence + fastresume and a persisted
    // DHT routing table, reusing the stored DHT port (warm start).
    let err_msg = match librqbit::Session::new_with_opts(
        state_dir.to_path_buf(),
        make_opts(true, true, None),
    )
    .await
    {
        Ok(s) => return Ok(s),
        Err(e) => {
            let msg = e.to_string();
            eprintln!(
                "[downloads] Warning: persistent torrent session init failed: {}",
                msg
            );
            msg
        }
    };

    // ── Recovery ladder ────────────────────────────────────────────────
    // The only init steps that can realistically fail after the state dir
    // is created are the DHT (locked/unreadable `dht.json`, or the stored
    // DHT UDP port already taken by a lingering process) and the session
    // db (`session.json` corrupt after a crash). Retrying the SAME config
    // as before would just fail again, so walk down in increasing
    // aggressiveness, keeping session persistence for as long as possible.

    // 1) DHT port conflict? Rebind the DHT on an ephemeral port while
    //    keeping the routing table and full session persistence.
    match librqbit::Session::new_with_opts(
        state_dir.to_path_buf(),
        make_opts(true, true, Some(0)),
    )
    .await
    {
        Ok(s) => {
            eprintln!("[downloads] Recovered: DHT bound to an ephemeral port.");
            return Ok(s);
        }
        Err(e) => eprintln!(
            "[downloads] Warning: DHT retry on an ephemeral port also failed: {}",
            e
        ),
    }

    // 2) Unreadable/locked routing table? Move it aside so the next
    //    attempt builds a fresh one (rebuilds within minutes).
    if quarantine_file(&dht_persist_path, "DHT routing table") {
        match librqbit::Session::new_with_opts(
            state_dir.to_path_buf(),
            make_opts(true, true, None),
        )
        .await
        {
            Ok(s) => {
                eprintln!(
                    "[downloads] Recovered: rebuilt the DHT routing table \
                     (old table quarantined)."
                );
                return Ok(s);
            }
            Err(e) => eprintln!(
                "[downloads] Warning: full-persistence retry after quarantining \
                 dht.json also failed: {}",
                e
            ),
        }
    }

    // 3) Corrupt session db? Move it aside too and retry full
    //    persistence — a fresh session.json restores fastresume.
    if quarantine_file(&session_json_path, "session database") {
        match librqbit::Session::new_with_opts(
            state_dir.to_path_buf(),
            make_opts(true, true, None),
        )
        .await
        {
            Ok(s) => {
                eprintln!(
                    "[downloads] Recovered: rebuilt the session database \
                     (old session.json quarantined)."
                );
                return Ok(s);
            }
            Err(e) => eprintln!(
                "[downloads] Warning: full-persistence retry after quarantining \
                 session.json also failed: {}",
                e
            ),
        }
    }

    // 4) DHT persistence itself is the blocker: keep session persistence
    //    (torrents + fastresume survive restarts) but run the DHT
    //    in-memory on a random port.
    match librqbit::Session::new_with_opts(state_dir.to_path_buf(), make_opts(true, false, None))
        .await
    {
        Ok(s) => {
            eprintln!(
                "[downloads] Recovered: session persistence kept, DHT running \
                 without persistence."
            );
            return Ok(s);
        }
        Err(e) => eprintln!(
            "[downloads] Warning: session-persistence-only init also failed: {}",
            e
        ),
    }

    // 5) Last resort: fully transient session (no session persistence, no
    //    DHT persistence).
    librqbit::Session::new_with_opts(state_dir.to_path_buf(), make_opts(false, false, None))
        .await
        .map_err(|fallback_err| {
            format!(
                "Failed to open torrent session (even without persistence): {} \
                 (original persistent-init error: {})",
                fallback_err, err_msg
            )
        })
}

/// Move a suspect state file (DHT routing table / session db) out of
/// the way so the next init builds a fresh one. Best-effort: on Windows
/// a file locked by a lingering process can't be renamed, and callers
/// fall further down the recovery ladder. Returns true when moved.
fn quarantine_file(path: &std::path::Path, what: &str) -> bool {
    if !path.exists() {
        return false;
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let file_name = path
        .file_name()
        .and_then(|f| f.to_str())
        .unwrap_or("state");
    let target = path.with_file_name(format!("{}.corrupt-{}", file_name, stamp));
    match std::fs::rename(path, &target) {
        Ok(_) => {
            eprintln!(
                "[downloads] Quarantined {} {} -> {}",
                what,
                path.display(),
                target.display()
            );
            true
        }
        Err(e) => {
            eprintln!(
                "[downloads] Could not quarantine {} {}: {}",
                what,
                path.display(),
                e
            );
            false
        }
    }
}

// ─── Trackers ───────────────────────────────────────────────────────────────

/// Curated public trackers (ngosang/trackerslist, refreshed Aug 2026).
/// HTTPS/TCP first — they traverse most firewalls; UDP kept as
/// fallback. These are registered BOTH at the session level
/// (`SessionOptions.trackers`, applied to every torrent including
/// magnets — librqbit 8.x ignores per-add trackers for magnet links)
/// and per-add (where they extend a `.torrent`'s own announce list).
const DEFAULT_TRACKERS: &[&str] = &[
    "https://tracker.opentrackr.org:443/announce",
    "https://tracker.bt4g.com:443/announce",
    "https://open.ftorrent.com:443/announce",
    "https://tracker.pmman.tech:443/announce",
    "https://tr.zukizuki.org:443/announce",
    "https://edgev.duckdns.org:443/announce",
    "https://tracker.leechshield.link:443/announce",
    "https://tracker.gcrenwp.top:443/announce",
    "https://tracker.nekomi.cn:443/announce",
    "http://tracker.opentrackr.org:1337/announce",
    "http://tracker.qu.ax:6969/announce",
    "http://tracker.mywaifu.best:6969/announce",
    "http://tracker.bz:80/announce",
    "http://tracker.dler.org:6969/announce",
    "http://t.overflow.biz:6969/announce",
    "http://buny.uk:6969/announce",
    "http://1337.abcvg.info:80/announce",
    "http://tracker.waaa.moe:6969/announce",
    "http://ipv4announce.sktorrent.eu:6969/announce",
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.tracker.cl:1337/announce",
    "udp://tracker.qu.ax:6969/announce",
    "udp://tracker.peerfect.org:6969/announce",
    "udp://tracker2.dler.org:80/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://open.stealth.si:80/announce",
    "udp://exodus.desync.com:6969/announce",
    "udp://explodie.org:6969/announce",
    "udp://open.demonii.com:1337/announce",
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

/// Best-effort BTv1 infohash from a magnet URI (40-hex only). Base32
/// hashes and percent-encoded `xt=` fall through to the authoritative
/// post-add duplicate check in the start task.
pub fn btih_from_magnet(uri: &str) -> Option<String> {
    let query = uri.strip_prefix("magnet:?")?;
    for pair in query.split('&') {
        if let Some(v) = pair.strip_prefix("xt=") {
            let v = v.to_lowercase();
            if let Some(h) = v.strip_prefix("urn:btih:") {
                if h.len() == 40 && h.chars().all(|c| c.is_ascii_hexdigit()) {
                    return Some(h.to_string());
                }
            }
        }
    }
    None
}

/// Frontend id (`dl_<n>`) for a 40-hex infohash — mirrors
/// `frontend_id_from_hash`.
pub fn frontend_id_from_btih_hex(btih_hex: &str) -> Option<String> {
    let h = btih_hex.trim();
    if h.len() != 40 || !h.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let mut bytes = [0u8; 20];
    for (i, pair) in h.as_bytes().chunks_exact(2).enumerate() {
        bytes[i] = (hex_digit(pair[0]) << 4) | hex_digit(pair[1]);
    }
    Some(frontend_id_from_hash(&bytes))
}

fn hex_digit(c: u8) -> u8 {
    match c {
        b'0'..=b'9' => c - b'0',
        b'a'..=b'f' => c - b'a' + 10,
        b'A'..=b'F' => c - b'A' + 10,
        _ => 0,
    }
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
        // 9.x allows pausing during the initial file check — the
        // `paused` flag distinguishes "paused while checking" from a
        // plain metadata fetch.
        librqbit::TorrentStatsState::Initializing { paused: true } => DownloadStatus::Paused,
        librqbit::TorrentStatsState::Initializing { paused: false } => DownloadStatus::FetchingMetadata,
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

pub async fn build_add_torrent(
    uri: &str,
    referer: Option<&str>,
) -> Result<librqbit::AddTorrent<'static>, String> {
    match local_torrent_path(uri) {
        Some(path) => {
            let bytes = tokio::fs::read(&path)
                .await
                .map_err(|e| format!("Failed to read .torrent file: {}", e))?;
            Ok(librqbit::AddTorrent::from_bytes(bytes))
        }
        None => {
            // Anti-hotlink .torrent URLs need a Referer header; fetch the
            // bytes ourselves and hand them to librqbit instead of
            // `from_url`, which never sends one.
            if let Some(r) = referer {
                if uri.starts_with("http://") || uri.starts_with("https://") {
                    let bytes = fetch_torrent_bytes(uri, Some(r)).await?;
                    return Ok(librqbit::AddTorrent::from_bytes(bytes));
                }
            }
            Ok(librqbit::AddTorrent::from_url(uri.to_string()))
        }
    }
}

/// Download a `.torrent` file over HTTP(S), optionally with a `Referer`
/// header for anti-hotlink hosts that reject requests without the right
/// one (librqbit's `from_url` sends none), and return its bytes.
async fn fetch_torrent_bytes(uri: &str, referer: Option<&str>) -> Result<Vec<u8>, String> {
    const TORRENT_HTTP_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
    let client = reqwest::Client::builder()
        .user_agent(TORRENT_HTTP_UA)
        .build()
        .map_err(|e| format!("Failed to build .torrent fetch client: {e}"))?;
    let mut req = client.get(uri);
    if let Some(r) = referer {
        req = req.header(reqwest::header::REFERER, r);
    }
    let resp = req
        .send()
        .await
        .map_err(|e| format!("Failed to fetch .torrent file: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!(
            "Failed to fetch .torrent file: HTTP {}",
            resp.status().as_u16()
        ));
    }
    resp.bytes()
        .await
        .map(|b| b.to_vec())
        .map_err(|e| format!("Failed to read .torrent file: {e}"))
}

/// Obtain the raw bytes of a `.torrent` from a local path or an
/// http(s) URL (optionally with a Referer). Used by the swarm-free
/// file listing command — the torrent metadata is embedded in the file
/// itself, so no peer connection is needed to list its contents.
pub async fn read_torrent_bytes(
    uri: &str,
    referer: Option<&str>,
) -> Result<Vec<u8>, String> {
    if let Some(path) = local_torrent_path(uri) {
        return tokio::fs::read(&path)
            .await
            .map_err(|e| format!("Failed to read .torrent file: {}", e));
    }
    if uri.starts_with("http://") || uri.starts_with("https://") {
        return fetch_torrent_bytes(uri, referer).await;
    }
    Err("Source must be a local .torrent path or an http(s) .torrent URL".to_string())
}

/// Result of adding a torrent. `Added` means we own a fresh session
/// entry; `AlreadyManaged` means the infohash was already in the
/// session — the handle is the PRE-EXISTING torrent, which callers
/// must never unpause, re-select or delete.
pub enum AddOutcome {
    Added { handle: Arc<librqbit::ManagedTorrent> },
    AlreadyManaged { handle: Arc<librqbit::ManagedTorrent> },
}

/// How long ONE metadata-fetch attempt may run before we retry. During
/// resolution librqbit re-announces to the tracker set every
/// `force_tracker_interval` (30 s), so a single attempt covers several
/// announce rounds plus a DHT query.
const ADD_ATTEMPT_TIMEOUT_SECS: u64 = 90;
/// Maximum add attempts. Each retry re-announces to the (now
/// session-wide) tracker set and re-queries the DHT — with the
/// persisted routing table warming up across attempts, cold starts
/// usually resolve on attempt 2–3.
const ADD_MAX_ATTEMPTS: u32 = 3;
/// Delay in seconds between attempt `i` and `i + 1`.
const ADD_RETRY_DELAYS_SECS: [u64; 2] = [15, 30];

/// Add a torrent to the session and bring it Live, applying an
/// optional file selection. Waits (bounded, with retries) for metadata
/// when a file selection needs to be applied.
///
/// This is the single start path used for fresh starts, queue starts
/// and seeding re-adds — replacing the three divergent copies in the
/// old engine.
pub async fn add_and_start(
    session: &Arc<librqbit::Session>,
    source_uri: &str,
    save_path: &str,
    only_files: Option<&[usize]>,
    referer: Option<&str>,
) -> Result<AddOutcome, String> {
    // Note: `list_only` adds do NOT leave a session entry in librqbit
    // 8.x (the response returns before the torrent is created), so a
    // fresh add of a previously list_only-registered infohash comes
    // back `Added`. An `AlreadyManaged` response means the infohash is
    // already tracked — the caller owns the adoption decision (it must
    // never unpause an entry owned by another record, but MAY adopt one
    // it owns, e.g. a session-restored torrent on resume).

    let mut attempt: u32 = 0;

    loop {
        attempt += 1;
        let add = build_add_torrent(source_uri, referer).await?;
        let add_opts = librqbit::AddTorrentOptions {
            output_folder: Some(save_path.into()),
            overwrite: true,
            list_only: false,
            // Selection is applied at add time (compute_only_files); the old
            // post-add update_only_files retry loop was redundant.
            only_files: only_files.map(|v| v.to_vec()),
            trackers: Some(default_trackers_vec()),
            force_tracker_interval: Some(Duration::from_secs(30)),
            ..Default::default()
        };

        let response = match tokio::time::timeout(
            Duration::from_secs(ADD_ATTEMPT_TIMEOUT_SECS),
            session.add_torrent(add, Some(add_opts)),
        )
        .await
        {
            Ok(Ok(resp)) => resp,
            Ok(Err(e)) => {
                let msg = format!("Failed to add torrent: {}", e);
                eprintln!(
                    "[downloads] add_torrent attempt {}/{} failed: {}",
                    attempt, ADD_MAX_ATTEMPTS, msg
                );
                if attempt >= ADD_MAX_ATTEMPTS {
                    return Err(finish_metadata_error(&msg));
                }
                tokio::time::sleep(Duration::from_secs(
                    ADD_RETRY_DELAYS_SECS[(attempt - 1) as usize],
                ))
                .await;
                continue;
            }
            Err(_) => {
                // The per-add peer stream (tracker announces + DHT) was
                // dropped with the timed-out future; the retry below
                // starts a fresh announce round.
                let msg = format!(
                    "Timed out fetching metadata (attempt {}/{}) — no peers responded",
                    attempt, ADD_MAX_ATTEMPTS
                );
                eprintln!("[downloads] {}", msg);
                if attempt >= ADD_MAX_ATTEMPTS {
                    return Err(finish_metadata_error(&msg));
                }
                tokio::time::sleep(Duration::from_secs(
                    ADD_RETRY_DELAYS_SECS[(attempt - 1) as usize],
                ))
                .await;
                continue;
            }
        };

        let already_managed =
            matches!(&response, librqbit::AddTorrentResponse::AlreadyManaged(..));
        let handle = response
            .into_handle()
            .ok_or_else(|| "Failed to start torrent: no handle returned".to_string())?;

        if already_managed {
            // M1: never unpause or change the selection of a torrent we
            // don't own.
            return Ok(AddOutcome::AlreadyManaged { handle });
        }

        let _ = session.unpause(&handle).await;
        return Ok(AddOutcome::Added { handle });
    }
}

/// Wrap the last-attempt failure in a user-facing hint.
fn finish_metadata_error(last_error: &str) -> String {
    format!(
        "{} after {} attempts. Check your firewall, wait a minute \
         and try again (the DHT routing table keeps warming up), or \
         try a different source.",
        last_error, ADD_MAX_ATTEMPTS
    )
}

/// Delete a torrent from the session by frontend id (keeps files).
pub async fn delete_from_session(session: &Arc<librqbit::Session>, frontend_id: &str) {
    if let Some(handle) = find_handle(session, frontend_id) {
        delete_torrent_keep_files(session, &handle).await;
    }
}

// ─── Race-safe pause / delete ───────────────────────────────────────────────

/// librqbit's `pause()` / `delete()` drain the file handles out of the
/// Live storage while a peer's chunk write can still be dispatched
/// after passing the "check_steal" gate — the write then fails with
/// `file is None` and can fatal-error the torrent. 9.x reworked the
/// disk path (async bitv flushing, no deferred-write queue), but the
/// quiesce stays as belt-and-braces: wait until the torrent stops
/// transferring before draining, so no write is in flight when the
/// handles go.
async fn wait_quiescent(
    handle: &Arc<librqbit::ManagedTorrent>,
    max_wait: Duration,
) {
    let deadline = std::time::Instant::now() + max_wait;
    loop {
        let stats = handle.stats();
        if !matches!(stats.state, librqbit::TorrentStatsState::Live) {
            // paused / initializing / error → no in-flight writes
            return;
        }
        let active = stats
            .live
            .as_ref()
            .map(|l| l.download_speed.mbps > 0.0)
            .unwrap_or(false);
        if !active {
            return; // live but idle → nothing to drain-race
        }
        if std::time::Instant::now() >= deadline {
            return; // best effort; the race is unlikely even then
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

/// Run a librqbit session operation (pause / delete / unpause) on a
/// blocking thread and wait up to `max_wait` for it. librqbit drains
/// file handles under internal locks; a chunk write still in flight
/// (stuck/slow disk, antivirus lock) makes that lock wait SYNCHRONOUS,
/// so a plain `timeout` around the future would never fire — the async
/// worker would just block. Moving the op onto a blocking thread keeps
/// the runtime free, and the bounded wait means a stuck disk can never
/// freeze the app. On timeout the op is abandoned — its blocking thread
/// finishes whenever the disk lets it — and None is returned.
pub(crate) async fn run_session_op_bounded<F, T>(
    what: &'static str,
    fut: F,
    max_wait: Duration,
) -> Option<T>
where
    F: std::future::Future<Output = T> + Send + 'static,
    T: Send + 'static,
{
    let (tx, rx) = tokio::sync::oneshot::channel();
    tokio::task::spawn_blocking(move || {
        let out = tokio::runtime::Handle::current().block_on(fut);
        let _ = tx.send(out);
    });
    match tokio::time::timeout(max_wait, rx).await {
        Ok(Ok(out)) => Some(out),
        Ok(Err(_)) => {
            eprintln!("[downloads] {what}: result channel closed unexpectedly");
            None
        }
        Err(_) => {
            eprintln!(
                "[downloads] {what} did not finish within {}s — abandoning it \
                 (files may stay locked until the app restarts)",
                max_wait.as_secs()
            );
            None
        }
    }
}

/// Pause a session entry, first waiting (bounded) for in-flight writes
/// to drain so the handle drain can't race a chunk write. Safe on any
/// state; the errors ("initializing", "already paused") are expected —
/// the 1 s manager sweep keeps retrying until it lands.
pub async fn pause_torrent(
    session: &Arc<librqbit::Session>,
    handle: &Arc<librqbit::ManagedTorrent>,
) {
    wait_quiescent(handle, Duration::from_millis(2000)).await;
    let session = session.clone();
    let handle = handle.clone();
    let fut = async move { session.pause(&handle).await };
    let outcome = run_session_op_bounded(
        "torrent pause",
        fut,
        Duration::from_secs(SESSION_OP_TIMEOUT_SECS),
    )
    .await;
    if let Some(Err(e)) = outcome {
        println!("[downloads] pause skipped ({}), 1s sweep will retry", e);
    }
}

/// Delete a session entry (keep files), quiescing first so the
/// internal pause inside `session.delete` can't race a chunk write.
/// Runs off the async runtime and gives up after a bounded wait so a
/// stuck disk write can never hang the app.
pub async fn delete_torrent_keep_files(
    session: &Arc<librqbit::Session>,
    handle: &Arc<librqbit::ManagedTorrent>,
) {
    delete_torrent(session, handle, false).await;
}

/// Delete a session entry (with optional file deletion), quiescing
/// first. Used by remove-with-files. Runs off the async runtime and
/// gives up after a bounded wait so a stuck disk write can never hang
/// the app.
pub async fn delete_torrent(
    session: &Arc<librqbit::Session>,
    handle: &Arc<librqbit::ManagedTorrent>,
    delete_files: bool,
) {
    wait_quiescent(handle, Duration::from_millis(2000)).await;
    let session = session.clone();
    let id = handle.id();
    let fut = async move {
        session
            .delete(librqbit::api::TorrentIdOrHash::Id(id), delete_files)
            .await
    };
    let _ = run_session_op_bounded(
        "torrent delete",
        fut,
        Duration::from_secs(SESSION_OP_TIMEOUT_SECS),
    )
    .await;
}
