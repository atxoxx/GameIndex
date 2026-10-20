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

use std::sync::{Arc, OnceLock};
use std::time::Duration;

use super::types::{Download, DownloadFile, DownloadStatus};

// ─── Session init ───────────────────────────────────────────────────────────

/// Concurrent peer slots per torrent. librqbit defaults to 128. Its
/// semaphore is shared by *connecting* and live peers, so on swarms whose
/// tracker lists are full of dead entries most of the cap sits in
/// connection attempts: a 200-slot probe measured ~175 slots connecting
/// and only ~25 live peers. 1000 widens the candidate pool enough that a
/// large swarm can fill its live slots from the peers that actually
/// transfer instead of burning them on dead tracker entries.
pub(crate) const PEER_LIMIT_PER_TORRENT: usize = 1000;

/// Public DHT bootstrap routers used by standard BitTorrent clients
/// (qBittorrent, Transmission, libtorrent, uTorrent). Librqbit's fallback
/// only includes two nodes; configuring the full set guarantees fast
/// bootstrap and magnet resolution even if specific routers are congested
/// or unreachable.
pub(crate) const DEFAULT_DHT_BOOTSTRAP: &[&str] = &[
    "router.bittorrent.com:6881",
    "router.utorrent.com:6881",
    "dht.transmissionbt.com:6881",
    "dht.libtorrent.org:25401",
    "dht.aelitis.com:6881",
];

/// Environment override for uTP. The user-facing switch lives in the
/// `download_transport` kv setting (see `mod.rs`); this only lets a
/// developer force uTP on without touching the settings UI.
/// Set `GAMEINDEX_TORRENT_UTP=1` (or "true" / "yes") to opt in.
pub(crate) fn utp_env_override() -> bool {
    std::env::var("GAMEINDEX_TORRENT_UTP")
        .map(|v| {
            let v = v.trim();
            v == "1" || v.eq_ignore_ascii_case("true") || v.eq_ignore_ascii_case("yes")
        })
        .unwrap_or(false)
}

/// Whether to open a uTP listener alongside TCP. Off unless the user turns
/// it on: librqbit's userspace uTP uses LEDBAT congestion control over a
/// single shared UDP socket, which on high-speed swarms and Windows can
/// cause UDP drops, backoff and throttled throughput versus kernel TCP.
/// Upstream therefore defaults to `ListenerMode::TcpOnly`. uTP still helps
/// on swarms/NATs that only accept it, so it is exposed as a setting that
/// takes effect on the next session start.
pub(crate) fn utp_enabled(setting: bool) -> bool {
    setting || utp_env_override()
}

/// Build the incoming-peer listener options. Kept separate from
/// [`init_session`] so the TCP/uTP choice is unit-testable without
/// mutating process-wide environment variables.
pub(crate) fn build_listener_opts(enable_utp: bool) -> librqbit::ListenerOptions {
    librqbit::ListenerOptions {
        mode: if enable_utp {
            librqbit::ListenerMode::TcpAndUtp
        } else {
            librqbit::ListenerMode::TcpOnly
        },
        listen_addr: (std::net::Ipv6Addr::UNSPECIFIED, 0).into(),
        enable_upnp_port_forwarding: true,
        ..Default::default()
    }
}

pub(crate) fn build_peer_opts() -> Option<librqbit::PeerConnectionOptions> {
    // Desktop-client tuning (matches libtorrent / qBittorrent and BEP 3):
    // - connect_timeout (12 s): gives worldwide / cross-continental peers
    //   sufficient time for TCP handshake and SYN retransmission without
    //   holding connection slots indefinitely on dead endpoints.
    // - read_write_timeout (120 s): BitTorrent BEP 3 protocol standard. Choked
    //   peers can sit idle between keep-alives (sent every 60–120 s) or unchoke
    //   evaluation cycles (every 30 s). Dropping them at 15 s kills choked peers
    //   and wipes the swarm into exponential backoff.
    // - keep_alive_interval (30 s): regularly sends BitTorrent keep-alives
    //   to prevent remote NAT firewalls and peers from closing idle connections.
    Some(librqbit::PeerConnectionOptions {
        connect_timeout: Some(Duration::from_secs(12)),
        read_write_timeout: Some(Duration::from_secs(120)),
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
    enable_utp: bool,
    disable_upload: bool,
) -> Result<Arc<librqbit::Session>, String> {
    std::fs::create_dir_all(state_dir)
        .map_err(|e| format!("Failed to create state dir: {}", e))?;

    // Persistent DHT routing table at an explicitly writable path —
    // keeping it across restarts is the single biggest metadata-fetch
    // speedup (magnets resolve in seconds instead of 30–120 s).
    let dht_persist_path = state_dir.join("dht.json");
    let session_json_path = state_dir.join("session.json");
    let make_dht_config = |persist: bool, port: Option<u16>| librqbit::DhtSessionConfig {
        bootstrap_addrs: Some(
            DEFAULT_DHT_BOOTSTRAP
                .iter()
                .map(|s| s.to_string())
                .collect(),
        ),
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

    // Incoming peer listener: ephemeral dualstack (IPv4+IPv6) TCP port,
    // plus uTP when the transport setting (or the env override) asks for it.
    let make_listener = || build_listener_opts(utp_enabled(enable_utp));

    // Outgoing peer connections: desktop peer tuning
    // (8 s connect timeout, 120 s read/write timeout, 30 s keep-alive).
    let make_connect = || librqbit::ConnectionOptions {
        peer_opts: build_peer_opts(),
        ..Default::default()
    };

    // Concurrency for disk I/O, piece hash checks, and file allocation.
    // Defaulting to 8 threads causes thread starvation and I/O bottlenecks
    // on fast drives and high-speed broadband swarms.
    let worker_threads = 16.max(
        std::thread::available_parallelism()
            .map(|n| n.get() * 2)
            .unwrap_or(16),
    );
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
                // Concurrent torrent initializations (file checks). Each
                // init is a blocking hash pass over the on-disk files, so
                // this bounds the disk burst when many torrents enter the
                // session at once (bulk add, app resume). Raised from 4 to
                // 8 so a busy resume reaches Live quicker without
                // saturating a spinning drive.
                concurrent_init_limit: Some(8),
                dht: Some(make_dht_config(dht_persist, dht_port)),
                trackers: session_trackers(),
                peer_limit: Some(PEER_LIMIT_PER_TORRENT),
                runtime_worker_threads: Some(worker_threads),
                // Hard upload disable (librqbit `disable-upload` feature):
                // suppresses bitfield/have advertisements and refuses
                // piece requests, and cannot be changed at runtime. A
                // plain rate limit of ~0 is not equivalent — the limiter
                // DOES gate both directions, but only disable-upload also
                // stops the advertisements.
                disable_upload,
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

/// Extract BEP 9 `x.pe=` peer hints from a magnet URI. These are
/// addresses the magnet's author already knew about, so seeding them
/// into `AddTorrentOptions.initial_peers` lets the swarm bootstrap from
/// peers that likely hold the content instead of waiting on a tracker
/// announce. Only `ip:port` (v4/v6) forms are accepted; hostnames would
/// need resolution and are skipped (trackers/DHT cover them).
pub fn magnet_initial_peers(uri: &str) -> Vec<std::net::SocketAddr> {
    let Some(query) = uri.strip_prefix("magnet:?") else {
        return Vec::new();
    };
    let mut peers = Vec::new();
    for pair in query.split('&') {
        if let Some(v) = pair.strip_prefix("x.pe=") {
            let decoded = v.replace("%3A", ":").replace("%3a", ":");
            if let Ok(addr) = decoded.parse::<std::net::SocketAddr>() {
                peers.push(addr);
            }
        }
    }
    peers
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

/// Per-state peer counts plus ETA / average piece time for the diagnostics
/// view. Best-effort: when librqbit reports no `live` stats (paused, still
/// resolving metadata, ...) everything comes back zeroed.
#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerBreakdown {
    pub live: u64,
    pub live_tcp: u64,
    pub live_utp: u64,
    pub queued: u64,
    pub connecting: u64,
    pub dead: u64,
    pub seen: u64,
    /// Seconds until completion, when librqbit can estimate it.
    pub eta_secs: Option<u64>,
    /// Average time to fetch one piece, in milliseconds.
    pub average_piece_ms: Option<u64>,
}

/// Expand a stats snapshot into the per-peer-state breakdown. `live` is
/// `None` for a paused / metadata-less torrent, so callers get a zeroed
/// breakdown instead of an error.
pub fn peer_breakdown(stats: &librqbit::TorrentStats) -> PeerBreakdown {
    let Some(live) = stats.live.as_ref() else {
        return PeerBreakdown::default();
    };
    let peers = &live.snapshot.peer_stats;
    // `DurationWithHumanReadable` keeps its inner `Duration` private; its
    // serde shape (`{ duration: { secs, nanos }, humanReadable }`) is the
    // only stable way to read the seconds back out.
    let eta_secs = live.time_remaining.as_ref().and_then(|remaining| {
        serde_json::to_value(remaining)
            .ok()
            .and_then(|v| v.get("duration")?.get("secs")?.as_u64())
    });
    let average_piece_ms = live
        .average_piece_download_time
        .map(|d| d.as_millis() as u64);
    PeerBreakdown {
        live: peers.live as u64,
        live_tcp: peers.live_tcp as u64,
        live_utp: peers.live_utp as u64,
        queued: peers.queued as u64,
        connecting: peers.connecting as u64,
        dead: peers.dead as u64,
        seen: peers.seen as u64,
        eta_secs,
        average_piece_ms,
    }
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

// ─── Torrent detail (modal) ─────────────────────────────────────────────────

/// One connected peer, flattened for the detail modal. Built from
/// librqbit's per-peer stats snapshot (which is not nameable through the
/// crate's public re-exports, so we read it through its serde shape).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TorrentPeerInfo {
    pub address: String,
    pub state: String,
    /// BitTorrent client string reported in the extended handshake.
    pub client: Option<String>,
    /// "tcp" or "utp" (absent unless the peer reached Live).
    pub connection: Option<String>,
    pub downloaded: u64,
    pub uploaded: u64,
    pub pieces: u64,
    pub errors: u64,
}

/// Full torrent detail for the download row's info modal. Torrent-side
/// fields come from the live handle; record-side fields (added date,
/// peak speed, magnet, ...) are merged from the persisted `Download`.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TorrentDetail {
    pub id: String,
    pub info_hash: String,
    pub name: String,
    pub magnet_uri: Option<String>,
    pub save_path: String,
    pub source_name: String,
    pub status: DownloadStatus,
    pub total_size: Option<u64>,
    pub downloaded: u64,
    pub uploaded: u64,
    /// `uploaded / downloaded`; `0.0` until any bytes are downloaded.
    pub ratio: f64,
    pub download_speed: u64,
    pub upload_speed: u64,
    pub peers: u32,
    pub seeds: u32,
    pub peak_speed: u64,
    pub added_at: u64,
    pub completed_at: Option<u64>,
    pub breakdown: PeerBreakdown,
    pub peer_list: Vec<TorrentPeerInfo>,
    pub trackers: Vec<String>,
    pub files: Vec<DownloadFile>,
    pub only_files: Option<Vec<usize>>,
    /// True when no live peer has been seen for the stall window.
    pub stalled: bool,
}

/// Hex-encode a 20-byte info hash as the canonical 40-char v1 string.
pub fn info_hash_hex(info_hash: &[u8; 20]) -> String {
    let mut s = String::with_capacity(40);
    for b in info_hash {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

/// Read the per-peer snapshot and flatten it. Reads `PeerStats` through
/// its serde representation because the underlying types are re-exported
/// only through the (private) `torrent_state` module.
fn peer_list_from_handle(handle: &Arc<librqbit::ManagedTorrent>) -> Vec<TorrentPeerInfo> {
    let Some(live) = handle.live() else {
        return Vec::new();
    };
    let snapshot = live.per_peer_stats_snapshot(Default::default());
    let Ok(value) = serde_json::to_value(&snapshot) else {
        return Vec::new();
    };
    let Some(peers) = value.get("peers").and_then(|p| p.as_object()) else {
        return Vec::new();
    };
    peers
        .iter()
        .map(|(address, p)| {
            let counters = p.get("counters");
            let counter = |key: &str| {
                counters
                    .and_then(|c| c.get(key))
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0)
            };
            TorrentPeerInfo {
                address: address.clone(),
                state: p
                    .get("state")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string(),
                client: p
                    .get("client_name")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .map(str::to_string),
                connection: p
                    .get("conn_kind")
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
                downloaded: counter("fetched_bytes"),
                uploaded: counter("uploaded_bytes"),
                pieces: counter("downloaded_and_checked_pieces"),
                errors: counter("errors"),
            }
        })
        .collect()
}

/// Build the detail modal payload for a live torrent handle, merging the
/// persisted record's bookkeeping fields. `stalled` is decided by the
/// manager (it tracks the no-live-peer window across ticks).
pub fn build_torrent_detail(
    handle: &Arc<librqbit::ManagedTorrent>,
    record: &Download,
    stalled: bool,
) -> TorrentDetail {
    let stats = handle.stats();
    let (download_speed, upload_speed, seeds, peers) = extract_live_stats(&stats);
    let total_size = if stats.total_bytes > 0 {
        Some(stats.total_bytes)
    } else {
        record.total_size
    };
    let downloaded = stats.progress_bytes.max(record.downloaded);
    let uploaded = stats.uploaded_bytes.max(record.uploaded);
    let ratio = if downloaded > 0 {
        uploaded as f64 / downloaded as f64
    } else {
        0.0
    };

    // Session trackers are registered on `ManagedTorrentShared.trackers`;
    // sorting keeps the list stable between ticks.
    let mut trackers: Vec<String> = handle
        .shared()
        .trackers
        .iter()
        .map(|u| u.to_string())
        .collect();
    trackers.sort();

    let files = files_from_handle(handle, &stats).unwrap_or_else(|| record.files.clone());

    let magnet_uri = record
        .magnet_uri
        .clone()
        .or_else(|| record.source_uri.starts_with("magnet:").then(|| record.source_uri.clone()));

    TorrentDetail {
        id: record.id.clone(),
        info_hash: info_hash_hex(&handle.shared().info_hash.0),
        name: handle.name().unwrap_or_else(|| record.name.clone()),
        magnet_uri,
        save_path: record.save_path.clone(),
        source_name: record.source_name.clone(),
        status: record.status.clone(),
        total_size,
        downloaded,
        uploaded,
        ratio,
        download_speed,
        upload_speed,
        peers,
        seeds,
        peak_speed: record.peak_speed.unwrap_or(0),
        added_at: record.added_at,
        completed_at: record.completed_at,
        breakdown: peer_breakdown(&stats),
        peer_list: peer_list_from_handle(handle),
        trackers,
        files,
        only_files: record.only_files.clone(),
        stalled,
    }
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
            // Always fetch http(s) .torrent URLs ourselves with a
            // browser UA (and Referer when the source provides one)
            // instead of `from_url`, whose bare client gets 403s or
            // HTML anti-bot pages that surface as a useless "error
            // decoding torrent" after 3 expensive retries.
            if uri.starts_with("http://") || uri.starts_with("https://") {
                match fetch_torrent_bytes(uri, referer).await {
                    Ok(bytes) => return Ok(librqbit::AddTorrent::from_bytes(bytes)),
                    Err(e) => {
                        // The verdict is about the CONTENT, not the
                        // transport — routing it back through
                        // `from_url` would hit the same page, so
                        // surface it.
                        if e.contains(NON_TORRENT_MARKER) {
                            return Err(e);
                        }
                        eprintln!(
                            "[downloads] own .torrent fetch failed ({}), trying librqbit's client",
                            e
                        );
                    }
                }
            }
            Ok(librqbit::AddTorrent::from_url(uri.to_string()))
        }
    }
}

/// Substring marking "this URL/data is not a .torrent file" errors —
/// those must never be retried or fallen back on, since the payload
/// won't change.
const NON_TORRENT_MARKER: &str = "not a .torrent file";

/// Shared `.torrent` fetch client. Stateless (no cookie jar), so one
/// pooled instance serves every add — rebuilding it per fetch discarded
/// its connection pool and made the 3× add-retry budget pay three
/// handshakes instead of reusing one keep-alive connection.
static TORRENT_FETCH_CLIENT: OnceLock<Result<reqwest::Client, String>> = OnceLock::new();

const TORRENT_HTTP_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

fn torrent_fetch_client() -> Result<&'static reqwest::Client, String> {
    match TORRENT_FETCH_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(TORRENT_HTTP_UA)
            .build()
            .map_err(|e| format!("Failed to build .torrent fetch client: {e}"))
    }) {
        Ok(client) => Ok(client),
        Err(e) => Err(e.clone()),
    }
}

/// Download a `.torrent` file over HTTP(S), optionally with a `Referer`
/// header for anti-hotlink hosts that reject requests without the right
/// one (librqbit's `from_url` sends none), and return its bytes.
async fn fetch_torrent_bytes(uri: &str, referer: Option<&str>) -> Result<Vec<u8>, String> {
    let client = torrent_fetch_client()?;
    let mut req = client.get(uri);
    if let Some(r) = referer {
        req = req.header(reqwest::header::REFERER, r);
    }
    let resp = req
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("Failed to fetch .torrent file: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!(
            "Failed to fetch .torrent file: HTTP {}",
            resp.status().as_u16()
        ));
    }
    let bytes = resp
        .bytes()
        .await
        .map(|b| b.to_vec())
        .map_err(|e| format!("Failed to read .torrent file: {e}"))?;
    validate_torrent_bytes(&bytes)?;
    Ok(bytes)
}

/// A valid `.torrent` is raw bencode — the first non-whitespace byte is
/// a dictionary opener (`d`). An HTML anti-bot page, a login page or a
/// plain-text error page isn't; reject it with an actionable message
/// instead of letting librqbit surface the opaque "error decoding
/// torrent".
fn validate_torrent_bytes(bytes: &[u8]) -> Result<(), String> {
    let first = bytes
        .iter()
        .find(|b| !b.is_ascii_whitespace())
        .copied()
        .unwrap_or(0);
    if first == b'd' {
        return Ok(());
    }
    Err(format!(
        "The URL returned data that is {marker} (likely an HTML or error \
         page — the host may require a browser). Try the magnet link or \
         a different source.",
        marker = NON_TORRENT_MARKER
    ))
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

/// Tracker announcements follow the interval each tracker returns. An
/// earlier version forced a 90 s re-announce for the torrent's whole
/// lifetime; that ignores the tracker's own `interval`/`min_interval`
/// and gets clients rate-limited or temporarily banned by public
/// trackers, which erodes peer discovery exactly when it is needed.
/// The initial announce is still immediate (and magnet resolution is
/// backed by DHT plus the add retries), so nothing needs overriding.

/// How long ONE metadata-fetch attempt may run before we retry. Each
/// retry starts a fresh announce round plus a DHT query.
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
        // BEP 9 peer hints turn a trackless magnet into something that can
        // start moving before the first announce lands.
        let initial_peers = magnet_initial_peers(source_uri);
        let add_opts = librqbit::AddTorrentOptions {
            output_folder: Some(save_path.into()),
            overwrite: true,
            list_only: false,
            // Selection is applied at add time (compute_only_files); the old
            // post-add update_only_files retry loop was redundant.
            only_files: only_files.map(|v| v.to_vec()),
            trackers: Some(default_trackers_vec()),
            peer_opts: build_peer_opts(),
            peer_limit: Some(PEER_LIMIT_PER_TORRENT),
            initial_peers: if initial_peers.is_empty() {
                None
            } else {
                Some(initial_peers)
            },
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
                if is_permanent_add_error(&msg) {
                    // A decode/magnet-parsing failure is deterministic —
                    // the payload won't differ on attempt 2, and the
                    // firewall/DHT advice would just mislead.
                    return Err(finish_permanent_add_error(&msg));
                }
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

/// Errors that can never succeed on a retry — the source payload itself
/// is bad. Matched on message text because librqbit's `add_torrent`
/// error is an opaque `anyhow` chain behind our `String` error type.
fn is_permanent_add_error(msg: &str) -> bool {
    msg.contains(NON_TORRENT_MARKER)
        || msg.contains("error decoding torrent")
        || msg.contains("provided path is not a valid magnet URL")
        || msg.contains("unsupported URL")
        || msg.contains("magnet link didn't contain")
}

/// Wrap a permanent add failure with actionable advice (no retry
/// rhetoric — the firewall/DHT hints would be misleading here).
fn finish_permanent_add_error(msg: &str) -> String {
    format!(
        "{} — the source data itself is bad, so this was not retried. \
         Try the magnet link or a different source.",
        msg
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

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bencode_torrent_bytes_validate_ok() {
        // A minimal bencode dict: d<contents>e — the usual .torrent shape.
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"d4:name");
        bytes.extend_from_slice(&8u32.to_be_bytes());
        bytes.extend_from_slice(b"fake.bin");
        bytes.push(b'e');
        assert!(validate_torrent_bytes(&bytes).is_ok());
    }

    #[test]
    fn leading_whitespace_torrent_bytes_validate_ok() {
        // Some CDNs prepend stray newlines — bencode still follows.
        assert!(validate_torrent_bytes(b"\n\td4:lengthi0e ee".as_slice()).is_ok());
    }

    #[test]
    fn html_page_rejected_with_marker() {
        let html = b"<html><body>Cloudflare check</body></html>".as_slice();
        let err = validate_torrent_bytes(html).unwrap_err();
        assert!(err.contains(NON_TORRENT_MARKER));
        assert!(err.contains("magnet link"));
    }

    #[test]
    fn empty_payload_rejected() {
        assert!(validate_torrent_bytes(&[]).is_err());
        assert!(validate_torrent_bytes(b"   \n".as_slice()).is_err());
    }

    #[test]
    fn permanent_errors_are_classified() {
        for msg in [
            "Failed to add torrent: error decoding torrent",
            "Failed to add torrent: provided path is not a valid magnet URL",
            "Failed to add torrent: unsupported URL \"ftp://x\"",
            "Failed to add torrent: magnet link didn't contain a BTv1 infohash",
        ] {
            assert!(is_permanent_add_error(msg), "missed: {msg}");
        }
        assert!(!is_permanent_add_error("transport error"));
    }

    #[test]
    fn non_torrent_payloads_are_permanent() {
        let msg = format!(
            "Failed to add torrent: {}",
            validate_torrent_bytes(b"<html>x</html>").unwrap_err()
        );
        assert!(is_permanent_add_error(&msg));
        assert!(finish_permanent_add_error(&msg).contains("not retried"));
    }

    #[test]
    fn metadata_errors_are_not_classified_permanent() {
        let msg = "Timed out fetching metadata (attempt 3/3) — no peers responded";
        assert!(!is_permanent_add_error(&msg));
    }

    #[test]
    fn peer_tuning_matches_desktop_clients() {
        let opts = build_peer_opts().expect("peer options");
        // Bounded connect timeout so dead tracker entries free their slot,
        // but generous enough for slow/overseas peers to finish a handshake.
        assert_eq!(opts.connect_timeout, Some(Duration::from_secs(12)));
        // Long idle timeout: choked peers can go a while without sending
        // anything except keep-alives, and dropping them loses the slot.
        assert_eq!(opts.read_write_timeout, Some(Duration::from_secs(120)));
        // Wide candidate pool so a big swarm fills its live slots.
        assert!(PEER_LIMIT_PER_TORRENT >= 1000);
        assert_eq!(opts.keep_alive_interval, Some(Duration::from_secs(30)));
    }

    #[test]
    fn magnet_peer_hints_are_parsed() {
        let uri = "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567\
            &dn=Example&x.pe=203.0.113.7:6881&x.pe=[2001:db8::1]:51413";
        let peers = magnet_initial_peers(uri);
        assert_eq!(peers.len(), 2);
        assert!(peers.contains(&"203.0.113.7:6881".parse().unwrap()));
        assert!(peers.contains(&"[2001:db8::1]:51413".parse().unwrap()));
    }

    #[test]
    fn magnet_peer_hints_ignore_hostnames_and_other_schemes() {
        // Hostnames need resolution and are skipped; a non-magnet URI has none.
        assert!(magnet_initial_peers("magnet:?x.pe=seed.example.com:6881").is_empty());
        assert!(magnet_initial_peers("https://example.com/a.torrent").is_empty());
    }

    #[test]
    fn info_hash_hex_is_canonical() {
        let hash = [
            0x00, 0x01, 0x0a, 0x0f, 0x10, 0x7f, 0xa0, 0xff, 0xde, 0xad, 0xbe, 0xef, 0x01, 0x02,
            0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
        ];
        assert_eq!(info_hash_hex(&hash), "00010a0f107fa0ffdeadbeef0102030405060708");
    }

    #[test]
    fn listener_defaults_to_tcp_only() {
        let opts = build_listener_opts(false);
        assert!(matches!(opts.mode, librqbit::ListenerMode::TcpOnly));
        assert!(opts.mode.tcp_enabled());
        assert!(!opts.mode.utp_enabled());
        assert!(opts.enable_upnp_port_forwarding);
    }

    #[test]
    fn listener_can_opt_into_utp() {
        let opts = build_listener_opts(true);
        assert!(matches!(opts.mode, librqbit::ListenerMode::TcpAndUtp));
        assert!(opts.mode.tcp_enabled());
        assert!(opts.mode.utp_enabled());
        assert!(opts.enable_upnp_port_forwarding);
    }

    #[test]
    fn dht_bootstrap_routers_configured() {
        assert!(DEFAULT_DHT_BOOTSTRAP.len() >= 5);
        assert!(DEFAULT_DHT_BOOTSTRAP.iter().any(|r| r.contains("bittorrent.com")));
        assert!(DEFAULT_DHT_BOOTSTRAP.iter().any(|r| r.contains("utorrent.com")));
        assert!(DEFAULT_DHT_BOOTSTRAP.iter().any(|r| r.contains("transmissionbt.com")));
    }
}
