//! Resumable direct-HTTP downloader.
//!
//! Behaviour:
//!  * hoster resolution before streaming (`hosters::resolve`),
//!  * response validation on every attempt (reject 4xx/5xx and
//!    `text/html` bodies — the "link returned a web page" guard),
//!  * Range-based resume into a `.gamelib_tmp` temp file,
//!  * stall watchdog (30 s without data → retry),
//!  * exponential backoff (max 10 retries, honours `Retry-After`),
//!  * mirror fallback across the record's `uris` list,
//!  * global download-speed throttle (shared with the settings UI).

use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;

use reqwest::header::{CONTENT_ENCODING, CONTENT_RANGE, CONTENT_TYPE, RANGE};
use reqwest::StatusCode;
use tokio::fs::OpenOptions;
use tokio::io::{AsyncSeekExt, AsyncWriteExt};

use super::manager::{self, WeakManager};
use super::types::{unix_now, Download, DownloadStatus};

const MAX_RETRY_ATTEMPTS: u32 = 10;
const INITIAL_RETRY_DELAY_MS: u64 = 1000;
const MAX_RETRY_DELAY_MS: u64 = 15000;
/// Cap on re-unlocking one file's link within a single worker. Without it
/// a provider that keeps minting unusable URLs could loop forever.
const MAX_FILE_REFRESHES: u32 = 6;
const STALL_TIMEOUT_SECS: u64 = 30;
/// A Range chunk may stall a little longer than a single stream: CDN
/// edges under load can pause briefly while another task on the same
/// connection makes progress.
const SEGMENT_STALL_TIMEOUT_SECS: u64 = 30;
const REQUEST_TIMEOUT_SECS: u64 = 60;
const RETRYABLE_STATUSES: &[u16] = &[429, 500, 502, 503, 504];

/// Number of parallel Range streams per file — the debrid services'
/// documented IDM/FDM recommendation ("8 connections per file").
pub const SEGMENT_COUNT: u32 = 8;
/// Files smaller than this per-segment floor stay single-connection;
/// segmentation only pays off once files are large enough to split.
const SEGMENT_MIN_BYTES: u64 = 8 * 1024 * 1024;
/// Internal reconnects per chunk before the whole file attempt gives up
/// and bubbles a retryable error (one flaky connection must not restart
/// the other workers' chunks).
const SEGMENT_RECONNECTS: u32 = 8;

/// Work-stealing chunk sizing. Equal static segments leave every other
/// connection idle while the slowest one finishes; fixed-size chunks let
/// a fast worker pick up the next unfinished range instead.
const CHUNK_MIN_BYTES: u64 = 4 * 1024 * 1024;
const CHUNK_MAX_BYTES: u64 = 32 * 1024 * 1024;
/// Chunks per worker used to size the split: enough work-stealing
/// granularity to smooth out slow connections without flooding the CDN
/// with tiny requests.
const CHUNKS_PER_WORKER: u64 = 4;

/// Exponential backoff for worker retries, capped and optionally
/// overridden by a server's `Retry-After`.
fn retry_delay(attempt: u32, retry_after: Option<Duration>, base_ms: u64, max_ms: u64) -> Duration {
    if let Some(d) = retry_after {
        return d.min(Duration::from_millis(max_ms));
    }
    let exp = base_ms
        .checked_mul(1u64 << attempt.saturating_sub(1).min(20))
        .unwrap_or(max_ms);
    Duration::from_millis(exp.min(max_ms))
}

/// Split a file into a work-stealing plan: `(workers, chunk_size, chunk_count)`.
///
/// Small files stay single-stream (one worker, one chunk). Larger files
/// get up to `max_workers` parallel connections and chunks sized so each
/// worker has several ranges to steal, clamped to keep requests efficient
/// and the resume metadata compact.
fn chunk_plan(total: u64, max_workers: u32) -> (u32, u64, usize) {
    if total < SEGMENT_MIN_BYTES || max_workers <= 1 {
        return (1, total.max(1), 1);
    }
    let workers = max_workers.min((total / SEGMENT_MIN_BYTES).max(1) as u32);
    if workers <= 1 {
        return (1, total, 1);
    }
    let target_chunks = (workers as u64 * CHUNKS_PER_WORKER).max(1);
    let chunk_size = (total / target_chunks).clamp(CHUNK_MIN_BYTES, CHUNK_MAX_BYTES);
    let chunk_count = total.div_ceil(chunk_size) as usize;
    (workers, chunk_size, chunk_count.max(1))
}

/// Parse the first byte offset out of a `Content-Range: bytes 100-199/1000`
/// header. Used to reject a CDN that answers a mid-file Range with bytes
/// from somewhere else (which would silently corrupt the temp file).
fn content_range_start(value: &str) -> Option<u64> {
    let rest = value.trim().strip_prefix("bytes ")?;
    let (start, _) = rest.split_once('-')?;
    start.trim().parse().ok()
}

/// True when a URL is a provider page/raw link that must be unlocked into
/// a direct CDN URL before it can be streamed. Newly resolved downloads
/// leave the direct slot empty; after a restart the persisted record
/// carries the original provider link in both slots, so shape-detect it.
pub fn url_needs_debrid_resolution(url: &str) -> bool {
    let url = url.trim();
    if url.is_empty() {
        return true;
    }
    if url.starts_with("torbox:") || url.starts_with("torbox-zip:") {
        return true;
    }
    let Ok(parsed) = url::Url::parse(url) else {
        return false;
    };
    let Some(host) = parsed.host_str() else {
        return false;
    };
    let host = host.to_ascii_lowercase();
    if host == "alldebrid.com" || host.ends_with(".alldebrid.com") {
        return parsed.path().starts_with("/f/");
    }
    if host == "real-debrid.com" || host.ends_with(".real-debrid.com") {
        return parsed.path().starts_with("/d/");
    }
    false
}

/// Refreshes an expiring direct link (AllDebrid unlock URLs die after
/// hours). Takes `(current_url, original_url)` and returns the fresh URL,
/// or None when unavailable/failed.
pub type UrlRefresher =
    dyn Fn(String, String) -> std::pin::Pin<Box<dyn std::future::Future<Output = Option<String>> + Send>>
        + Send
        + Sync;

/// Firefox UA: several game hosters throttle/block Chrome-based UAs.
const DOWNLOAD_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0";

/// Build a tuned HTTP client for direct and segmented debrid downloads.
///
/// Features:
///  * HTTP/1.1 enforcement: eliminates HTTP/2 stream multiplexing flow-control
///    starvation and deadlocks on CDN reverse proxies (Cloudflare, CDN77).
///  * TCP keep-alive & TCP nodelay: keeps long-running connections alive across NATs.
///  * Connection pooling: caches up to 32 idle connections per host.
pub fn build_download_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(DOWNLOAD_USER_AGENT)
        .cookie_store(true)
        .http1_only()
        .tcp_keepalive(Some(Duration::from_secs(15)))
        .tcp_nodelay(true)
        .pool_idle_timeout(Some(Duration::from_secs(60)))
        .pool_max_idle_per_host(32)
        .connect_timeout(Duration::from_secs(15))
        .build()
        .unwrap_or_default()
}

/// Global direct-download speed limit in bytes/sec (0 = unlimited).
static DIRECT_LIMIT_BPS: AtomicU64 = AtomicU64::new(0);

pub fn set_direct_speed_limit(bps: u64) {
    DIRECT_LIMIT_BPS.store(bps, Ordering::Relaxed);
}

// ─── Diagnostics counters ───────────────────────────────────────────────────
//
// Process-lifetime tallies of the HTTP worker's failure/fallback events.
// They are best-effort observability only (never read on a hot path) and
// reset on demand from the diagnostics view.

static RETRY_COUNT: AtomicU64 = AtomicU64::new(0);
static STALL_COUNT: AtomicU64 = AtomicU64::new(0);
static TRANSIENT_ERROR_COUNT: AtomicU64 = AtomicU64::new(0);
static MIRROR_SWITCH_COUNT: AtomicU64 = AtomicU64::new(0);
static SEGMENT_RECONNECT_COUNT: AtomicU64 = AtomicU64::new(0);

/// Snapshot of the HTTP worker's lifetime counters.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpCounters {
    pub retries: u64,
    pub stalls: u64,
    pub transient_errors: u64,
    pub mirror_switches: u64,
    pub segment_reconnects: u64,
}

pub fn http_counters() -> HttpCounters {
    HttpCounters {
        retries: RETRY_COUNT.load(Ordering::Relaxed),
        stalls: STALL_COUNT.load(Ordering::Relaxed),
        transient_errors: TRANSIENT_ERROR_COUNT.load(Ordering::Relaxed),
        mirror_switches: MIRROR_SWITCH_COUNT.load(Ordering::Relaxed),
        segment_reconnects: SEGMENT_RECONNECT_COUNT.load(Ordering::Relaxed),
    }
}

pub fn reset_http_counters() {
    RETRY_COUNT.store(0, Ordering::Relaxed);
    STALL_COUNT.store(0, Ordering::Relaxed);
    TRANSIENT_ERROR_COUNT.store(0, Ordering::Relaxed);
    MIRROR_SWITCH_COUNT.store(0, Ordering::Relaxed);
    SEGMENT_RECONNECT_COUNT.store(0, Ordering::Relaxed);
}

enum AttemptResult {
    Completed,
    /// User paused / removed the download — stop silently.
    Aborted,
    /// Permanent failure for this URL (try the next mirror, then error).
    Fatal(String),
    Retryable(String, Option<Duration>),
}

/// Run a direct download to completion (or pause/error). Handles
/// retries and mirror fallback internally; on success marks the record
/// Completed and triggers extraction.
pub async fn run_direct_download(
    id: String,
    url: String,
    save_path: String,
    referer: Option<String>,
    bytes_counter: Arc<AtomicU64>,
    manager_weak: WeakManager,
    generation: u64,
    worker_lock: Arc<tokio::sync::Mutex<()>>,
    segments: u32,
) {
    // ── C1 single-writer invariant ────────────────────────────────
    // We hold the per-download worker lock for our entire lifetime
    // (including finalize). A replacement worker spawned by a mirror
    // switch / URL edit blocks here until we have fully exited, so it
    // can never write a byte while we are alive.
    let _lock_guard = worker_lock.lock().await;

    // A newer worker was spawned while we waited for the lock — we
    // never started; exit without touching the record or the files.
    if is_superseded(&manager_weak, &id, generation).await {
        return;
    }

    // URL was switched while a partial existed: the old worker (now
    // fully stopped — we hold the lock) wrote bytes of the OLD url.
    // Drop the stale partial so we never resume foreign bytes.
    if let Some(manager) = manager_weak.upgrade() {
        let mut guard = manager.write().await;
        if guard.direct_reset_partial.remove(&id) {
            let path = Path::new(&save_path);
            let fname = path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("direct_download")
                .to_string();
            let parent = path.parent().unwrap_or_else(|| Path::new("."));
            let stale = parent.join(format!("{}.gamelib_tmp", fname));
            if stale.exists() {
                let _ = std::fs::remove_file(&stale);
            }
            let stale_meta = parent.join(format!("{}.gamelib_tmp.meta", fname));
            if stale_meta.exists() {
                let _ = std::fs::remove_file(&stale_meta);
            }
        }
    }

    let client = build_download_client();

    let mut current_url = url;
    let current_save_path = save_path;

    // A pre-allocated temp from a segmented attempt cannot be resumed by
    // the single-stream path (it would see a "complete" file).
    if segments <= 1 {
        clear_segmented_partial(&current_save_path);
    }

    'mirrors: loop {
        // Resolve the raw source URI into a real file URL (plus any
        // hoster-specific headers) before streaming.
        let (effective_url, extra_headers) =
            match super::hosters::resolve(&current_url).await {
                super::hosters::ResolveOutcome::Passthrough => {
                    (current_url.clone(), Vec::new())
                }
                super::hosters::ResolveOutcome::Resolved(t) => {
                    println!("[downloads] Resolved {} -> {}", current_url, t.url);
                    (t.url, t.headers)
                }
                super::hosters::ResolveOutcome::Error(e) => {
                    match next_mirror(&manager_weak, &id, &current_save_path, generation).await {
                        Some(next) => {
                            current_url = next;
                            continue 'mirrors;
                        }
                        None => {
                            finish_with_error(&manager_weak, &id, e, generation).await;
                            return;
                        }
                    }
                }
            };

        let mut request_headers = extra_headers;
        if let Some(mgr) = manager_weak.upgrade() {
            let guard = mgr.read().await;
            if let Some(d) = guard.downloads_map().get(&id) {
                if let Some(custom) = &d.extra_headers {
                    for (k, v) in custom {
                        request_headers.push((k.clone(), v.clone()));
                    }
                }
            }
        }

        let mut attempt: u32 = 0;
        loop {
            // Stop immediately if a newer worker took over (C1).
            if is_superseded(&manager_weak, &id, generation).await {
                return;
            }
            let outcome = if segments > 1 {
                attempt_segmented_download(
                    &client,
                    &id,
                    &effective_url,
                    &current_save_path,
                    &bytes_counter,
                    0,
                    true,
                    &manager_weak,
                    &request_headers,
                    referer.as_deref(),
                    generation,
                    segments,
                )
                .await
            } else {
                attempt_download(
                    &client,
                    &id,
                    &effective_url,
                    &current_save_path,
                    &bytes_counter,
                    0,
                    true,
                    &manager_weak,
                    &request_headers,
                    referer.as_deref(),
                    generation,
                )
                .await
            };
            match outcome {
                AttemptResult::Completed => {
                    finalize_success(&manager_weak, &id, &bytes_counter, generation).await;
                    return;
                }
                AttemptResult::Aborted => return,
                AttemptResult::Fatal(msg) => {
                    match next_mirror(&manager_weak, &id, &current_save_path, generation).await {
                        Some(next) => {
                            current_url = next;
                            bytes_counter.store(0, Ordering::SeqCst);
                            continue 'mirrors;
                        }
                        None => {
                            finish_with_error(&manager_weak, &id, msg, generation).await;
                            return;
                        }
                    }
                }
                AttemptResult::Retryable(msg, retry_after) => {
                    attempt += 1;
                    RETRY_COUNT.fetch_add(1, Ordering::Relaxed);
                    if attempt > MAX_RETRY_ATTEMPTS {
                        let final_msg =
                            format!("Exhausted {} retries: {}", MAX_RETRY_ATTEMPTS, msg);
                        match next_mirror(&manager_weak, &id, &current_save_path, generation).await {
                            Some(next) => {
                                current_url = next;
                                bytes_counter.store(0, Ordering::SeqCst);
                                continue 'mirrors;
                            }
                            None => {
                                finish_with_error(&manager_weak, &id, final_msg, generation).await;
                                return;
                            }
                        }
                    }

                    // Bail out if the user paused/removed meanwhile.
                    if !still_downloading(&manager_weak, &id, generation).await {
                        return;
                    }

                    let delay = retry_delay(
                        attempt,
                        retry_after,
                        INITIAL_RETRY_DELAY_MS,
                        MAX_RETRY_DELAY_MS,
                    );
                    println!(
                        "[downloads] Retryable error ({}). Retry {}/{} in {:?}",
                        msg, attempt, MAX_RETRY_ATTEMPTS, delay
                    );
                    tokio::time::sleep(delay).await;
                }
            }
        }
    }
}

/// Download every file in a debrid-resolved torrent into `save_dir`,
/// updating the record's per-file list as each one lands, then finalise
/// once all files are done. Files are streamed sequentially; when
/// `segments > 1` each file is fetched over work-stealing Range chunks,
/// otherwise via a single connection. Reuses `attempt_download`'s
/// retry/backoff, stall-watchdog and resume machinery; the `base_offset`
/// counter keeps the record's progress reflecting the whole transfer
/// rather than just the current file.
///
/// An empty `direct_url` (or a provider page/raw link left in both slots
/// by a persisted record) is resolved through `url_refresher` lazily,
/// right before that file starts. Resolving every file up front costs one
/// provider API call per file and delays the transfer for minutes on
/// large torrents.
pub async fn run_debrid_files_download(
    id: String,
    files: Vec<(String, u64, String, String)>, // (name, size, direct_url, orig_url)
    only_files: Option<Vec<usize>>,
    save_dir: String,
    bytes_counter: Arc<AtomicU64>,
    manager_weak: WeakManager,
    generation: u64,
    worker_lock: Arc<tokio::sync::Mutex<()>>,
    segments: u32,
    url_refresher: Option<Arc<UrlRefresher>>,
) {
    let _lock_guard = worker_lock.lock().await;
    if is_superseded(&manager_weak, &id, generation).await {
        return;
    }

    let client = build_download_client();

    let selected: Option<std::collections::HashSet<usize>> =
        only_files.map(|v| v.into_iter().collect());

    let mut base_offset: u64 = 0;
    for (idx, (name, size, direct_url, orig_url)) in files.iter().enumerate() {
        // Honour the user's per-file selection (debrid downloads support it
        // the same way torrents do). Deselected files are never fetched.
        if let Some(sel) = &selected {
            if !sel.contains(&idx) {
                continue;
            }
        }

        let save_path = Path::new(&save_dir)
            .join(name)
            .to_string_lossy()
            .into_owned();
        let path = Path::new(&save_path);
        if segments <= 1 {
            clear_segmented_partial(&save_path);
        }

        // Skip files that already landed on disk (pause→resume / app restart
        // must not re-download a completed file). The final file existing at
        // the expected size is our completion signal; a partial file only
        // exists as `<name>.gamelib_tmp` and is resumed by attempt_download.
        let on_disk_size = std::fs::metadata(path)
            .map(|m| if m.is_file() { m.len() } else { 0 })
            .unwrap_or(0);
        if on_disk_size > 0 && (*size == 0 || on_disk_size == *size) {
            base_offset += on_disk_size;
            mark_file_complete(&manager_weak, &id, idx, on_disk_size).await;
            continue;
        }

        let mut file_url = direct_url.clone();
        let mut needs_resolution = url_needs_debrid_resolution(&file_url);
        let mut attempt: u32 = 0;
        let mut refreshes: u32 = 0;
        loop {
            if is_superseded(&manager_weak, &id, generation).await {
                return;
            }
            if needs_resolution {
                let resolved = match &url_refresher {
                    Some(refresh) => refresh(file_url.clone(), orig_url.clone()).await,
                    None => None,
                };
                match resolved {
                    Some(fresh) if !fresh.trim().is_empty() => {
                        println!("[downloads] Resolved debrid link for {}", save_path);
                        file_url = fresh;
                        needs_resolution = false;
                    }
                    _ => {
                        finish_with_error(
                            &manager_weak,
                            &id,
                            "Could not resolve the debrid download link. The provider \
                             did not return a usable URL."
                                .to_string(),
                            generation,
                        )
                        .await;
                        return;
                    }
                }
            }
            let outcome = if segments > 1 {
                attempt_segmented_download(
                    &client,
                    &id,
                    &file_url,
                    &save_path,
                    &bytes_counter,
                    base_offset,
                    false,
                    &manager_weak,
                    &[],
                    None,
                    generation,
                    segments,
                )
                .await
            } else {
                attempt_download(
                    &client,
                    &id,
                    &file_url,
                    &save_path,
                    &bytes_counter,
                    base_offset,
                    false,
                    &manager_weak,
                    &[],
                    None,
                    generation,
                )
                .await
            };
            match outcome {
                AttemptResult::Completed => break,
                AttemptResult::Aborted => return,
                AttemptResult::Fatal(msg) => {
                    // If the link expired (401/403/410/HTML) or became invalid, try refreshing
                    if refreshes < MAX_FILE_REFRESHES {
                        if let Some(refresh) = &url_refresher {
                            if let Some(fresh) = refresh(file_url.clone(), orig_url.clone()).await {
                                if !fresh.is_empty() && fresh != file_url {
                                    println!(
                                        "[downloads] Refreshed expired debrid link after status ({}) for {}",
                                        msg, save_path
                                    );
                                    refreshes += 1;
                                    file_url = fresh;
                                    needs_resolution = false;
                                    tokio::time::sleep(Duration::from_millis(500)).await;
                                    continue;
                                }
                            }
                        }
                    }
                    finish_with_error(&manager_weak, &id, msg, generation).await;
                    return;
                }
                AttemptResult::Retryable(msg, retry_after) => {
                    attempt += 1;
                    RETRY_COUNT.fetch_add(1, Ordering::Relaxed);
                    if attempt > MAX_RETRY_ATTEMPTS {
                        let final_msg =
                            format!("Exhausted {} retries: {}", MAX_RETRY_ATTEMPTS, msg);
                        finish_with_error(&manager_weak, &id, final_msg, generation).await;
                        return;
                    }
                    if !still_downloading(&manager_weak, &id, generation).await {
                        return;
                    }
                    // Unlock URLs expire after hours — refresh before the retry
                    // sleeps so a long-stalled download resumes with a live link.
                    if refreshes < MAX_FILE_REFRESHES {
                        if let Some(refresh) = &url_refresher {
                            if let Some(fresh) = refresh(file_url.clone(), orig_url.clone()).await {
                                if !fresh.is_empty() && fresh != file_url {
                                    println!(
                                        "[downloads] Refreshed expired debrid link for {}",
                                        save_path
                                    );
                                    refreshes += 1;
                                    file_url = fresh;
                                    needs_resolution = false;
                                }
                            }
                        }
                    }
                    let delay = retry_delay(
                        attempt,
                        retry_after,
                        INITIAL_RETRY_DELAY_MS,
                        MAX_RETRY_DELAY_MS,
                    );
                    tokio::time::sleep(delay).await;
                }
            }
        }

        // File landed: record its real byte count and advance the offset
        // so the next file's progress stacks on top of this one.
        let after = bytes_counter.load(Ordering::SeqCst);
        let file_bytes = after.saturating_sub(base_offset);
        base_offset = after;
        mark_file_complete(&manager_weak, &id, idx, file_bytes).await;
    }

    finalize_success(&manager_weak, &id, &bytes_counter, generation).await;
}

/// Mark one debrid file as fully downloaded in the record (used both when a
/// file was just streamed and when it was already present on disk).
async fn mark_file_complete(manager_weak: &WeakManager, id: &str, idx: usize, bytes: u64) {
    let Some(manager) = manager_weak.upgrade() else {
        return;
    };
    let mut guard = manager.write().await;
    if let Some(item) = guard.downloads_mut().get_mut(id) {
        if let Some(f) = item.files.get_mut(idx) {
            f.downloaded = bytes;
            if f.size == 0 && bytes > 0 {
                f.size = bytes;
            }
            f.progress = 1.0;
        }
    }
    guard.mark_dirty();
    guard.emit_progress_force();
}

/// Drop a segmented partial left by a prior multi-connection attempt so the
/// single-stream path can start from zero. A plain partial (no `.meta`) is
/// left untouched and resumed.
fn clear_segmented_partial(save_path: &str) {
    let path = Path::new(save_path);
    let filename = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("direct_download");
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let meta = parent.join(format!("{}.gamelib_tmp.meta", filename));
    if meta.exists() {
        let temp = parent.join(format!("{}.gamelib_tmp", filename));
        let _ = std::fs::remove_file(&temp);
        let _ = std::fs::remove_file(&meta);
    }
}

/// Advance the record to its next mirror URL (dropping the stale
/// partial file). Returns the next URL, or None when exhausted.
async fn next_mirror(
    manager_weak: &WeakManager,
    id: &str,
    save_path: &str,
    generation: u64,
) -> Option<String> {
    if is_superseded(manager_weak, id, generation).await {
        return None;
    }
    let manager = manager_weak.upgrade()?;
    let mut guard = manager.write().await;
    let item = guard.downloads_mut().get_mut(id)?;
    let uris = item.uris.clone()?;
    if uris.len() < 2 {
        return None;
    }
    let current_idx = uris.iter().position(|u| u == &item.source_uri)?;
    let next_idx = current_idx + 1;
    if next_idx >= uris.len() {
        return None;
    }
    let next_url = uris[next_idx].clone();
    println!(
        "[downloads] Mirror {} failed; trying mirror {} ({})",
        current_idx + 1,
        next_idx + 1,
        next_url
    );
    MIRROR_SWITCH_COUNT.fetch_add(1, Ordering::Relaxed);
    item.source_uri = next_url.clone();
    guard.mark_dirty();
    guard.emit_progress_force();
    drop(guard);

    // Each mirror serves different bytes — a partial from a failed
    // mirror must not be appended to by the next one.
    let path = Path::new(save_path);
    let fname = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("direct_download")
        .to_string();
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let stale_temp = parent.join(format!("{}.gamelib_tmp", fname));
    if stale_temp.exists() {
        let _ = std::fs::remove_file(&stale_temp);
    }
    let stale_meta = parent.join(format!("{}.gamelib_tmp.meta", fname));
    if stale_meta.exists() {
        let _ = std::fs::remove_file(&stale_meta);
    }
    Some(next_url)
}

async fn still_downloading(manager_weak: &WeakManager, id: &str, generation: u64) -> bool {
    let Some(manager) = manager_weak.upgrade() else {
        return false;
    };
    let guard = manager.read().await;
    matches!(
        guard.downloads_map().get(id).map(|d| &d.status),
        Some(DownloadStatus::Downloading)
    ) && guard.direct_generations.get(id).copied() == Some(generation)
}

/// True when a newer worker has been spawned for this id, or the
/// manager/record is gone. The current worker must stop immediately —
/// it no longer owns the temp file, the final path, or the record.
async fn is_superseded(manager_weak: &WeakManager, id: &str, generation: u64) -> bool {
    let Some(manager) = manager_weak.upgrade() else {
        return true;
    };
    let guard = manager.read().await;
    guard.direct_generations.get(id).copied() != Some(generation)
}

async fn finish_with_error(
    manager_weak: &WeakManager,
    id: &str,
    err: String,
    generation: u64,
) {
    // Stale worker must not fail the record.
    if is_superseded(manager_weak, id, generation).await {
        return;
    }
    if let Some(manager) = manager_weak.upgrade() {
        manager::fail_download(&manager, id, err).await;
    }
}

async fn finalize_success(
    manager_weak: &WeakManager,
    id: &str,
    bytes_counter: &Arc<AtomicU64>,
    generation: u64,
) {
    if is_superseded(manager_weak, id, generation).await {
        return;
    }
    let Some(manager) = manager_weak.upgrade() else {
        return;
    };
    let mut history_item: Option<Download> = None;
    {
        let mut guard = manager.write().await;
        if let Some(item) = guard.downloads_mut().get_mut(id) {
            item.status = DownloadStatus::Completed;
            item.progress = Some(1.0);
            item.downloaded = item
                .total_size
                .unwrap_or_else(|| bytes_counter.load(Ordering::SeqCst));
            item.download_speed = 0;
            item.upload_speed = 0;
            item.had_real_downloads = Some(true);
            item.completed_at = Some(unix_now());
            item.extracted = Some(!item.auto_extract.unwrap_or(false));
            history_item = Some(item.clone());
        }
        guard.mark_dirty();
        guard.emit_progress_force();
    }

    // Record the completion in the download-history ledger. The mutable
    // borrow is dropped above, so the clone is written via a fresh guard.
    if let Some(item) = history_item {
        let guard = manager.write().await;
        guard.record_history(&item);
    }

    // Extraction + post-actions run off the caller's lock.
    manager::queue_post_completion(id.to_string(), true);

    manager::on_download_finished(&manager, id).await;
}

/// Token-bucket throttle for the global speed limit.
///
/// Refills tokens at `limit` bytes/sec with a burst capacity of up to 250ms
/// (clamped between 512 KB and 16 MB). When tokens go negative, tasks calculate
/// the sleep time needed to recover the deficit, release the mutex lock immediately,
/// and sleep outside the lock.
///
/// This avoids lock serialization across concurrent Range segments and prevents
/// OS timer tick quantization (e.g. Windows ~15.6ms sleep) from artificially capping
/// throughput at 1 MB/s.
struct Throttle {
    tokens: f64,
    last_update: std::time::Instant,
}

impl Throttle {
    fn new() -> Self {
        Self {
            tokens: 0.0,
            last_update: std::time::Instant::now(),
        }
    }

    fn consume(&mut self, bytes: u64, limit: u64) -> Duration {
        let now = std::time::Instant::now();
        let elapsed = now.duration_since(self.last_update).as_secs_f64();
        self.last_update = now;

        // Capacity: 250 ms of bandwidth, minimum 512 KB, maximum 16 MB.
        let limit_f64 = limit as f64;
        let capacity = (limit_f64 * 0.25).clamp(512.0 * 1024.0, 16.0 * 1024.0 * 1024.0);

        // Refill tokens earned over elapsed time.
        self.tokens = (self.tokens + elapsed * limit_f64).min(capacity);

        // Deduct bytes consumed.
        self.tokens -= bytes as f64;

        // Prevent runaway negative deficit (clamp to -2 * capacity).
        let min_deficit = -2.0 * capacity;
        if self.tokens < min_deficit {
            self.tokens = min_deficit;
        }

        if self.tokens < 0.0 {
            let wait_secs = (-self.tokens) / limit_f64;
            Duration::from_secs_f64(wait_secs)
        } else {
            Duration::ZERO
        }
    }
}

static GLOBAL_THROTTLE: std::sync::OnceLock<tokio::sync::Mutex<Throttle>> =
    std::sync::OnceLock::new();

/// Account `bytes` against the process-global direct-download limit.
/// No-op while the limit is unlimited. Shared across every stream so the
/// cap applies to the aggregate transfer, not per connection.
async fn throttle_account(bytes: u64) {
    let limit = DIRECT_LIMIT_BPS.load(Ordering::Relaxed);
    if limit == 0 {
        return;
    }
    let wait_time = {
        let throttle = GLOBAL_THROTTLE.get_or_init(|| tokio::sync::Mutex::new(Throttle::new()));
        let mut guard = throttle.lock().await;
        guard.consume(bytes, limit)
    };

    // Only sleep when deficit is at least 5ms to avoid sub-millisecond timer sleep thrashing.
    if wait_time >= Duration::from_millis(5) {
        tokio::time::sleep(wait_time.min(Duration::from_secs(2))).await;
    }
}

/// One HTTP attempt. The caller handles retry / mirror fallback.
///
/// `base_offset` is the byte count of files already committed by a
/// multi-file caller (0 for a plain single-file download) — it is added
/// to the shared counter so progress reflects the whole download.
/// `report_total` controls whether the record's `total_size` is set from
/// this response's `Content-Length` (single-file) or left to the caller
/// (multi-file, where the total is known up front).
async fn attempt_download(
    client: &reqwest::Client,
    id: &str,
    url: &str,
    save_path: &str,
    bytes_counter: &Arc<AtomicU64>,
    base_offset: u64,
    report_total: bool,
    manager_weak: &WeakManager,
    extra_headers: &[(String, String)],
    referer: Option<&str>,
    generation: u64,
) -> AttemptResult {
    let path = Path::new(save_path);
    let filename = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("direct_download")
        .to_string();
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let temp_path = parent.join(format!("{}.gamelib_tmp", filename));

    // Resume support: pick up from the temp file's current size.
    let mut current_size = 0;
    if temp_path.exists() {
        if let Ok(metadata) = std::fs::metadata(&temp_path) {
            current_size = metadata.len();
        }
    }
    bytes_counter.store(base_offset + current_size, Ordering::SeqCst);

    println!(
        "[downloads] Starting HTTP attempt for {} from byte {}",
        filename, current_size
    );

    // Disable compression on resume so byte ranges are exact.
    let is_resume = current_size > 0;
    let mut req = client.get(url);
    if is_resume {
        req = req.header("Accept-Encoding", "identity");
        req = req.header(RANGE, format!("bytes={}-", current_size));
    }
    if let Some(r) = referer {
        req = req.header(reqwest::header::REFERER, r);
    }
    for (k, v) in extra_headers {
        req = req.header(k.as_str(), v.as_str());
    }

    // Bound the connect/response phase (reqwest default has no timeout):
    // the C1 worker lock is held for our whole lifetime, so a wedged
    // server must not hold it forever.
    let send_res = tokio::time::timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS), req.send())
        .await;
    let mut resp = match send_res {
        Ok(Ok(r)) => r,
        Ok(Err(e)) => {
            return AttemptResult::Retryable(format!("Connection failed: {}", e), None)
        }
        Err(_) => {
            return AttemptResult::Retryable(
                format!("No response from server within {}s", REQUEST_TIMEOUT_SECS),
                None,
            )
        }
    };

    let status = resp.status();
    // ── Response validation (preflight, applied to the
    // real transfer response so no extra round-trip is needed) ──
    if status != StatusCode::OK && status != StatusCode::PARTIAL_CONTENT {
        let code = status.as_u16();
        if RETRYABLE_STATUSES.contains(&code) {
            let retry_after = parse_retry_after(&resp);
            TRANSIENT_ERROR_COUNT.fetch_add(1, Ordering::Relaxed);
            return AttemptResult::Retryable(
                format!("HTTP {} (transient)", code),
                retry_after,
            );
        }
        println!(
            "[downloads] HTTP {} for {} (final url: {})",
            code,
            url,
            resp.url()
        );
        return AttemptResult::Fatal(format!(
            "The download link is not available (HTTP {}).",
            status
        ));
    }

    // Reject HTML bodies — the link returned a web page, not a file.
    if let Some(content_type) = resp.headers().get(CONTENT_TYPE) {
        if let Ok(ct) = content_type.to_str() {
            let ct_lower = ct.to_ascii_lowercase();
            if ct_lower.starts_with("text/html")
                || ct_lower.starts_with("application/xhtml")
            {
                println!(
                    "[downloads] HTML page (not a file) for {} (final url: {})",
                    url,
                    resp.url()
                );
                return AttemptResult::Fatal(
                    "The download link returned a web page instead of a file. \
                     It may have expired or be invalid."
                        .to_string(),
                );
            }
        }
    }

    // Compressed bodies make byte-offset resume unreliable.
    let content_encoding = resp
        .headers()
        .get(CONTENT_ENCODING)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    let server_compressed = !content_encoding.is_empty() && content_encoding != "identity";

    // Compressed bodies can never be appended to our uncompressed temp file
    // (byte offsets don't line up), so restart from zero whenever the server
    // compressed the response — whether it returned 200 or 206.
    let mut restart_from_zero = is_resume && server_compressed;
    // A 200 when we asked to resume means the Range header was ignored. Only
    // keep the existing partial when the new body is at least as large as what
    // we already have, otherwise we'd skip past its end and corrupt the file.
    let mut range_ignored = false;
    if is_resume && status != StatusCode::PARTIAL_CONTENT && !server_compressed {
        match resp.content_length() {
            Some(len) if len < current_size => restart_from_zero = true,
            _ => range_ignored = true,
        }
    }

    if restart_from_zero {
        current_size = 0;
        bytes_counter.store(base_offset, Ordering::SeqCst);
        if temp_path.exists() {
            let _ = tokio::fs::remove_file(&temp_path).await;
        }
    }

    if report_total {
        if let Some(content_length) = resp.content_length() {
            let total = if status == StatusCode::PARTIAL_CONTENT {
                current_size + content_length
            } else {
                content_length
            };
            set_total_size(manager_weak, id, total).await;
        }
    }

    if let Some(parent_dir) = temp_path.parent() {
        if !parent_dir.exists() {
            if let Err(e) = tokio::fs::create_dir_all(parent_dir).await {
                return AttemptResult::Fatal(format!(
                    "Failed to create parent directories: {}",
                    e
                ));
            }
        }
    }

    let append_mode =
        (status == StatusCode::PARTIAL_CONTENT && !restart_from_zero) || range_ignored;
    let file_res = OpenOptions::new()
        .create(true)
        .write(true)
        .append(append_mode)
        .truncate(!append_mode)
        .open(&temp_path)
        .await;

    let file = match file_res {
        Ok(f) => f,
        Err(e) => {
            return AttemptResult::Fatal(format!("Failed to create file: {}", e));
        }
    };
    let mut file = tokio::io::BufWriter::with_capacity(256 * 1024, file);

    let mut skip_remaining: u64 = if range_ignored { current_size } else { 0 };
    let mut buffer_size = base_offset + current_size;
    let mut abort_check = std::time::Instant::now();

    loop {
        // Check pause/remove roughly every 500 ms (not every chunk).
        if abort_check.elapsed() >= Duration::from_millis(500) {
            abort_check = std::time::Instant::now();
            if let Some(manager) = manager_weak.upgrade() {
                let guard = manager.read().await;
                match guard.downloads_map().get(id) {
                    Some(item) => {
                        let superseded =
                            guard.direct_generations.get(id).copied() != Some(generation);
                        if superseded || !matches!(item.status, DownloadStatus::Downloading) {
                            println!(
                                "[downloads] Download no longer active for {} (superseded={})",
                                filename, superseded
                            );
                            drop(file);
                            return AttemptResult::Aborted;
                        }
                    }
                    None => {
                        drop(file);
                        let _ = tokio::fs::remove_file(&temp_path).await;
                        return AttemptResult::Aborted;
                    }
                }
            } else {
                drop(file);
                return AttemptResult::Aborted;
            }
        }

        // Next chunk, with a stall watchdog.
        let chunk_res =
            tokio::time::timeout(Duration::from_secs(STALL_TIMEOUT_SECS), resp.chunk())
                .await;
        let chunk = match chunk_res {
            Ok(inner) => match inner {
                Ok(Some(c)) => c,
                Ok(None) => break, // Complete.
                Err(e) => {
                    drop(file);
                    return AttemptResult::Retryable(
                        format!("Download interrupted: {}", e),
                        None,
                    );
                }
            },
            Err(_) => {
                drop(file);
                STALL_COUNT.fetch_add(1, Ordering::Relaxed);
                return AttemptResult::Retryable(
                    "Download stalled (no data received for 30s)".to_string(),
                    None,
                );
            }
        };

        // Skip the already-downloaded prefix when Range was ignored.
        let to_write: &[u8] = if skip_remaining > 0 {
            if (skip_remaining as usize) >= chunk.len() {
                skip_remaining -= chunk.len() as u64;
                continue;
            } else {
                let off = skip_remaining as usize;
                skip_remaining = 0;
                &chunk[off..]
            }
        } else {
            &chunk[..]
        };

        if let Err(e) = file.write_all(to_write).await {
            drop(file);
            return AttemptResult::Retryable(format!("Disk write failed: {}", e), None);
        }

        buffer_size += to_write.len() as u64;
        bytes_counter.store(buffer_size, Ordering::SeqCst);
        throttle_account(to_write.len() as u64).await;
    }

    // C1: never rename over the final path on behalf of a superseded
    // worker — the newer worker owns that path now.
    if is_superseded(manager_weak, id, generation).await {
        drop(file);
        return AttemptResult::Aborted;
    }

    let _ = file.flush().await;
    drop(file);

    // Renaming can transiently fail while antivirus or another process briefly
    // locks the freshly written file. Retry the rename instead of discarding a
    // fully downloaded file and starting over from scratch.
    let mut rename_attempts = 0;
    loop {
        match tokio::fs::rename(&temp_path, path).await {
            Ok(_) => break,
            Err(e) => {
                rename_attempts += 1;
                if rename_attempts >= 5 {
                    return AttemptResult::Fatal(format!(
                        "Failed to finalize file after {} attempts: {}",
                        rename_attempts, e
                    ));
                }
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
        }
    }

    AttemptResult::Completed
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
struct SegmentMeta {
    total_size: u64,
    chunk_size: u64,
    #[serde(default)]
    chunks: Vec<u64>,
}

/// Shared resume state for a work-stealing download. `chunks[i]` is the
/// number of bytes written for chunk `i`; `next` hands out chunks so two
/// workers can never fetch the same range.
struct SegmentProgressTracker {
    meta_path: std::path::PathBuf,
    total_size: u64,
    chunk_size: u64,
    chunks: Vec<u64>,
    next: usize,
    dirty: bool,
}

impl SegmentProgressTracker {
    fn chunk_len(&self, idx: usize) -> u64 {
        let start = idx as u64 * self.chunk_size;
        self.total_size
            .saturating_sub(start)
            .min(self.chunk_size)
    }

    fn completed_bytes(&self) -> u64 {
        self.chunks.iter().sum()
    }

    fn claim(&mut self) -> Option<(usize, u64, u64, u64)> {
        while self.next < self.chunks.len() {
            let idx = self.next;
            self.next += 1;
            let start = idx as u64 * self.chunk_size;
            let end = (start + self.chunk_size).min(self.total_size);
            if self.chunks[idx] < self.chunk_len(idx) {
                return Some((idx, start, end, self.chunks[idx]));
            }
        }
        None
    }

    /// Take any pending dirty state out of the tracker and return the
    /// (path, json) payload to be written to disk. Returns `None` when
    /// nothing needs persisting. Clearing `dirty` happens here so the
    /// actual disk write can run *after* the mutex guard is dropped.
    fn take_pending_save(&mut self) -> Option<(std::path::PathBuf, String)> {
        if !self.dirty {
            return None;
        }
        let meta = SegmentMeta {
            total_size: self.total_size,
            chunk_size: self.chunk_size,
            chunks: self.chunks.clone(),
        };
        let json = serde_json::to_string(&meta).ok()?;
        self.dirty = false;
        Some((self.meta_path.clone(), json))
    }
}

enum SegmentResult {
    /// Streamed to completion.
    Done,
    /// Server answered 200 to a byte-range request — no range support,
    /// the whole file must fall back to a single connection.
    RangeUnsupported,
    /// User paused/removed or the worker was superseded.
    Aborted,
    /// Permanent failure for this URL (dead link, HTML page, ...).
    Fatal(String),
    /// Temporary failure. `downloaded` carries this chunk's committed
    /// bytes so the reconnect resumes where it stopped instead of
    /// restarting the whole range.
    Transient {
        msg: String,
        downloaded: u64,
        retry_after: Option<Duration>,
    },
}

impl SegmentResult {
    fn transient(msg: String, downloaded: u64, retry_after: Option<Duration>) -> Self {
        Self::Transient {
            msg,
            downloaded,
            retry_after,
        }
    }
}

/// Download one byte-range chunk of `url` directly into `temp_path` at
/// offset `chunk_start + existing`.
async fn stream_chunk(
    client: &reqwest::Client,
    id: &str,
    url: &str,
    temp_path: &std::path::Path,
    chunk_start: u64,
    chunk_end: u64,
    initial_existing: u64,
    chunk_index: usize,
    progress_tracker: &Arc<tokio::sync::Mutex<SegmentProgressTracker>>,
    bytes_counter: &Arc<AtomicU64>,
    manager_weak: &WeakManager,
    extra_headers: &[(String, String)],
    referer: Option<&str>,
    generation: u64,
) -> SegmentResult {
    let chunk_len = chunk_end - chunk_start;
    let mut current_downloaded = initial_existing.min(chunk_len);
    if current_downloaded >= chunk_len {
        return SegmentResult::Done;
    }
    let resume_from = chunk_start + current_downloaded;

    let mut req = client.get(url);
    req = req.header("Accept-Encoding", "identity");
    req = req.header(RANGE, format!("bytes={}-{}", resume_from, chunk_end - 1));
    if let Some(r) = referer {
        req = req.header(reqwest::header::REFERER, r);
    }
    for (k, v) in extra_headers {
        req = req.header(k.as_str(), v.as_str());
    }

    let send_res = tokio::time::timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS), req.send())
        .await;
    let mut resp = match send_res {
        Ok(Ok(r)) => r,
        Ok(Err(e)) => {
            return SegmentResult::transient(
                format!("Connection failed: {}", e),
                current_downloaded,
                None,
            )
        }
        Err(_) => {
            return SegmentResult::transient(
                format!("No response from server within {}s", REQUEST_TIMEOUT_SECS),
                current_downloaded,
                None,
            )
        }
    };

    let status = resp.status();
    if status == StatusCode::OK {
        // Server ignored the Range header and sent full body
        return SegmentResult::RangeUnsupported;
    }
    if status != StatusCode::PARTIAL_CONTENT {
        let code = status.as_u16();
        if RETRYABLE_STATUSES.contains(&code) {
            TRANSIENT_ERROR_COUNT.fetch_add(1, Ordering::Relaxed);
            return SegmentResult::transient(
                format!("HTTP {} (transient)", code),
                current_downloaded,
                parse_retry_after(&resp),
            );
        }
        if let Some(content_type) = resp.headers().get(CONTENT_TYPE) {
            if let Ok(ct) = content_type.to_str() {
                let ct_lower = ct.to_ascii_lowercase();
                if ct_lower.starts_with("text/html")
                    || ct_lower.starts_with("application/xhtml")
                {
                    return SegmentResult::Fatal(
                        "The download link returned a web page instead of a file. \
                         It may have expired or be invalid."
                            .to_string(),
                    );
                }
            }
        }
        return SegmentResult::Fatal(format!(
            "The download link is not available (HTTP {}).",
            status
        ));
    }

    if let Some(start) = resp
        .headers()
        .get(CONTENT_RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(content_range_start)
    {
        if start != resume_from {
            return SegmentResult::transient(
                format!(
                    "Server returned byte range starting at {} (expected {})",
                    start, resume_from
                ),
                current_downloaded,
                None,
            );
        }
    }

    // Resume-mode open: `create` but never `truncate` — the file may hold
    // bytes before `resume_from` that the seek positions us to preserve.
    let file_res = OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(temp_path)
        .await;
    let mut file = match file_res {
        Ok(f) => f,
        Err(e) => {
            return SegmentResult::transient(
                format!("Failed to open destination file: {}", e),
                current_downloaded,
                None,
            )
        }
    };

    if let Err(e) = file.seek(std::io::SeekFrom::Start(resume_from)).await {
        return SegmentResult::transient(
            format!("Failed to seek to byte {}: {}", resume_from, e),
            current_downloaded,
            None,
        );
    }

    let mut abort_check = std::time::Instant::now();
    let mut last_save = std::time::Instant::now();
    let mut uncommitted_bytes = 0u64;

    loop {
        if abort_check.elapsed() >= Duration::from_millis(500) {
            abort_check = std::time::Instant::now();
            if let Some(manager) = manager_weak.upgrade() {
                let guard = manager.read().await;
                match guard.downloads_map().get(id) {
                    Some(item) => {
                        let superseded =
                            guard.direct_generations.get(id).copied() != Some(generation);
                        if superseded || !matches!(item.status, DownloadStatus::Downloading) {
                            let _ = file.flush().await;
                            drop(file);
                            return SegmentResult::Aborted;
                        }
                    }
                    None => {
                        let _ = file.flush().await;
                        drop(file);
                        return SegmentResult::Aborted;
                    }
                }
            } else {
                let _ = file.flush().await;
                drop(file);
                return SegmentResult::Aborted;
            }
        }

        let chunk_res =
            tokio::time::timeout(Duration::from_secs(SEGMENT_STALL_TIMEOUT_SECS), resp.chunk())
                .await;
        let chunk = match chunk_res {
            Ok(inner) => match inner {
                Ok(Some(c)) => c,
                Ok(None) => break, // Chunk complete.
                Err(e) => {
                    let _ = file.flush().await;
                    drop(file);
                    return SegmentResult::transient(
                        format!("Download interrupted: {}", e),
                        current_downloaded,
                        None,
                    );
                }
            },
            Err(_) => {
                let _ = file.flush().await;
                drop(file);
                STALL_COUNT.fetch_add(1, Ordering::Relaxed);
                return SegmentResult::transient(
                    format!(
                        "Segment download stalled (no data received for {}s)",
                        SEGMENT_STALL_TIMEOUT_SECS
                    ),
                    current_downloaded,
                    None,
                );
            }
        };

        if let Err(e) = file.write_all(&chunk).await {
            drop(file);
            return SegmentResult::transient(
                format!("Disk write failed: {}", e),
                current_downloaded,
                None,
            );
        }

        let chunk_bytes = chunk.len() as u64;
        current_downloaded = (current_downloaded + chunk_bytes).min(chunk_len);
        uncommitted_bytes += chunk_bytes;
        bytes_counter.fetch_add(chunk_bytes, Ordering::SeqCst);
        throttle_account(chunk_bytes).await;

        if uncommitted_bytes >= 2 * 1024 * 1024 || last_save.elapsed() >= Duration::from_secs(2) {
            uncommitted_bytes = 0;
            last_save = std::time::Instant::now();
            let pending = if let Ok(mut tracker) = progress_tracker.try_lock() {
                if let Some(val) = tracker.chunks.get_mut(chunk_index) {
                    *val = current_downloaded;
                    tracker.dirty = true;
                }
                tracker.take_pending_save()
            } else {
                None
            };
            if let Some((path, json)) = pending {
                let _ = tokio::fs::write(path, json).await;
            }
        }
    }

    let _ = file.flush().await;
    drop(file);

    let pending = {
        let mut tracker = progress_tracker.lock().await;
        if let Some(val) = tracker.chunks.get_mut(chunk_index) {
            *val = current_downloaded;
            tracker.dirty = true;
        }
        tracker.take_pending_save()
    };
    if let Some((path, json)) = pending {
        let _ = tokio::fs::write(path, json).await;
    }

    SegmentResult::Done
}

/// Multi-connection download of one file via work-stealing byte ranges
/// directly into a single `.gamelib_tmp` pre-allocated file.
///
/// `report_total` mirrors `attempt_download`: when `false` (multi-file debrid,
/// where the record's `total_size` is already the full magnet sum) the per-file
/// `Content-Range` total is NOT written back to the record — otherwise every
/// file switch would clobber the whole-magnet total with the current file's size.
async fn attempt_segmented_download(
    client: &reqwest::Client,
    id: &str,
    url: &str,
    save_path: &str,
    bytes_counter: &Arc<AtomicU64>,
    base_offset: u64,
    report_total: bool,
    manager_weak: &WeakManager,
    extra_headers: &[(String, String)],
    referer: Option<&str>,
    generation: u64,
    max_segments: u32,
) -> AttemptResult {
    let client = client.clone();
    let path = std::path::Path::new(save_path);
    let filename = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("direct_download")
        .to_string();
    let parent = path.parent().unwrap_or_else(|| std::path::Path::new("."));
    let temp_path = parent.join(format!("{}.gamelib_tmp", filename));
    let meta_path = parent.join(format!("{}.gamelib_tmp.meta", filename));

    // Ensure parent directories exist
    if !parent.exists() {
        if let Err(e) = tokio::fs::create_dir_all(parent).await {
            return AttemptResult::Fatal(format!("Failed to create parent directories: {}", e));
        }
    }

    // ── Probe: does the server honor byte ranges, and how big is the file?
    let mut probe = client.get(url);
    probe = probe.header(RANGE, "bytes=0-0");
    probe = probe.header("Accept-Encoding", "identity");
    if let Some(r) = referer {
        probe = probe.header(reqwest::header::REFERER, r);
    }
    for (k, v) in extra_headers {
        probe = probe.header(k.as_str(), v.as_str());
    }
    let send_res = tokio::time::timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS), probe.send())
        .await;
    let resp = match send_res {
        Ok(Ok(r)) => r,
        Ok(Err(e)) => return AttemptResult::Retryable(format!("Connection failed: {}", e), None),
        Err(_) => {
            return AttemptResult::Retryable(
                format!("No response from server within {}s", REQUEST_TIMEOUT_SECS),
                None,
            )
        }
    };
    let status = resp.status();
    let total: u64 = if status == StatusCode::PARTIAL_CONTENT {
        // Content-Range: bytes 0-0/<TOTAL>
        resp.headers()
            .get(CONTENT_RANGE)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.rsplit('/').next())
            .and_then(|v| v.trim().parse::<u64>().ok())
            .unwrap_or(0)
    } else {
        0
    };

    if total == 0 {
        if status != StatusCode::OK && status != StatusCode::PARTIAL_CONTENT {
            let code = status.as_u16();
            if RETRYABLE_STATUSES.contains(&code) {
                TRANSIENT_ERROR_COUNT.fetch_add(1, Ordering::Relaxed);
                return AttemptResult::Retryable(
                    format!("HTTP {} (transient)", code),
                    parse_retry_after(&resp),
                );
            }
            if let Some(content_type) = resp.headers().get(CONTENT_TYPE) {
                if let Ok(ct) = content_type.to_str() {
                    let ct_lower = ct.to_ascii_lowercase();
                    if ct_lower.starts_with("text/html")
                        || ct_lower.starts_with("application/xhtml")
                    {
                        return AttemptResult::Fatal(
                            "The download link returned a web page instead of a file. \
                             It may have expired or be invalid."
                                .to_string(),
                        );
                    }
                }
            }
            return AttemptResult::Fatal(format!(
                "The download link is not available (HTTP {}).",
                status
            ));
        }
        return attempt_download(
            &client,
            id,
            url,
            save_path,
            bytes_counter,
            base_offset,
            false,
            manager_weak,
            extra_headers,
            referer,
            generation,
        )
        .await;
    }

    // Inform manager of total size (only for single-file callers; the
    // multi-file debrid worker owns the full-magnet total and would be
    // clobbered by this file's Content-Range size).
    if report_total {
        set_total_size(manager_weak, id, total).await;
    }

    // ── Clean up any legacy .part000..007 files from prior versions
    if let Ok(entries) = std::fs::read_dir(parent) {
        let prefix = format!("{}.gamelib_tmp.part", filename);
        for entry in entries.flatten() {
            if let Some(name) = entry.file_name().to_str() {
                if name.starts_with(&prefix) {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }
    }

    // ── Plan the work-stealing split (small files stay single-stream).
    let (workers, chunk_size, chunk_count) = chunk_plan(total, max_segments);
    if workers <= 1 {
        // A previous *segmented* attempt may have left a pre-allocated temp
        // at the full size; that must not be mistaken for a complete single
        // stream. A plain partial has no `.meta` and is kept for resume.
        if meta_path.exists() {
            let _ = tokio::fs::remove_file(&temp_path).await;
            let _ = tokio::fs::remove_file(&meta_path).await;
        }
        return attempt_download(
            &client,
            id,
            url,
            save_path,
            bytes_counter,
            base_offset,
            false,
            manager_weak,
            extra_headers,
            referer,
            generation,
        )
        .await;
    }

    // ── Resume metadata checking & preallocation
    let mut chunks: Vec<u64> = vec![0; chunk_count];
    let mut is_valid_resume = false;
    if meta_path.exists() && temp_path.exists() {
        if let Ok(content) = tokio::fs::read_to_string(&meta_path).await {
            if let Ok(meta) = serde_json::from_str::<SegmentMeta>(&content) {
                let lengths_ok = meta.chunks.iter().enumerate().all(|(i, done)| {
                    let len = total
                        .saturating_sub(i as u64 * chunk_size)
                        .min(chunk_size);
                    *done <= len
                });
                if meta.total_size == total
                    && meta.chunk_size == chunk_size
                    && meta.chunks.len() == chunk_count
                    && lengths_ok
                {
                    chunks = meta.chunks;
                    is_valid_resume = true;
                }
            }
        }
    }

    if !is_valid_resume {
        let file_res = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&temp_path)
            .await;
        match file_res {
            Ok(f) => {
                if let Err(e) = f.set_len(total).await {
                    return AttemptResult::Fatal(format!(
                        "Failed to pre-allocate file ({} bytes): {}",
                        total, e
                    ));
                }
            }
            Err(e) => {
                return AttemptResult::Fatal(format!("Failed to create temp file: {}", e));
            }
        }
    } else if let Ok(f) = OpenOptions::new().write(true).open(&temp_path).await {
        // A crash before the last `set_len` can leave the sparse temp
        // shorter than the resume metadata claims.
        let _ = f.set_len(total).await;
    }

    let progress_tracker = Arc::new(tokio::sync::Mutex::new(SegmentProgressTracker {
        meta_path: meta_path.clone(),
        total_size: total,
        chunk_size,
        chunks,
        next: 0,
        dirty: false,
    }));
    let on_disk = progress_tracker.lock().await.completed_bytes();
    bytes_counter.store(base_offset + on_disk, Ordering::SeqCst);

    let mut set = tokio::task::JoinSet::new();
    for _ in 0..workers {
        let client_ref = client.clone();
        let id_owned = id.to_string();
        let url_owned = url.to_string();
        let temp_path_owned = temp_path.clone();
        let tracker = Arc::clone(&progress_tracker);
        let counter = Arc::clone(bytes_counter);
        let weak = manager_weak.clone();
        let headers = extra_headers.to_vec();
        let referer = referer.map(|s| s.to_string());

        set.spawn(async move {
            loop {
                let claimed = { tracker.lock().await.claim() };
                let Some((chunk_index, chunk_start, chunk_end, existing)) = claimed else {
                    break;
                };
                let mut downloaded = existing;
                let mut attempt: u32 = 0;
                loop {
                    let res = stream_chunk(
                        &client_ref,
                        &id_owned,
                        &url_owned,
                        &temp_path_owned,
                        chunk_start,
                        chunk_end,
                        downloaded,
                        chunk_index,
                        &tracker,
                        &counter,
                        &weak,
                        &headers,
                        referer.as_deref(),
                        generation,
                    )
                    .await;
                    match res {
                        SegmentResult::Done => break,
                        SegmentResult::Transient {
                            msg,
                            downloaded: after,
                            retry_after,
                        } => {
                            downloaded = after;
                            // Persist the chunk offset before sleeping so a
                            // pause/restart never re-fetches committed bytes.
                            let pending = {
                                let mut t = tracker.lock().await;
                                if let Some(val) = t.chunks.get_mut(chunk_index) {
                                    *val = after;
                                    t.dirty = true;
                                }
                                t.take_pending_save()
                            };
                            if let Some((path, json)) = pending {
                                let _ = tokio::fs::write(path, json).await;
                            }
                            attempt += 1;
                            RETRY_COUNT.fetch_add(1, Ordering::Relaxed);
                            SEGMENT_RECONNECT_COUNT.fetch_add(1, Ordering::Relaxed);
                            if attempt >= SEGMENT_RECONNECTS {
                                return SegmentResult::transient(msg, after, retry_after);
                            }
                            if !still_downloading(&weak, &id_owned, generation).await {
                                return SegmentResult::Aborted;
                            }
                            println!(
                                "[downloads] Chunk {} transient error ({}), reconnecting \
                                 attempt {}/{} from byte {}",
                                chunk_index, msg, attempt, SEGMENT_RECONNECTS, after
                            );
                            let delay = retry_delay(attempt, retry_after, 500, 8_000);
                            tokio::time::sleep(delay).await;
                        }
                        other => return other,
                    }
                }
            }
            SegmentResult::Done
        });
    }

    // ── Gather results
    let mut aborted = false;
    let mut fatal: Option<String> = None;
    let mut transient: Option<String> = None;
    let mut range_unsupported = false;

    while let Some(joined) = set.join_next().await {
        match joined {
            Ok(SegmentResult::Done) => {}
            Ok(SegmentResult::Aborted) => aborted = true,
            Ok(SegmentResult::Fatal(e)) => {
                fatal.get_or_insert(e);
            }
            Ok(SegmentResult::Transient { msg, .. }) => {
                transient.get_or_insert(msg);
            }
            Ok(SegmentResult::RangeUnsupported) => range_unsupported = true,
            Err(e) => {
                transient.get_or_insert(format!("Segment task panicked: {}", e));
            }
        }
    }

    if aborted {
        return AttemptResult::Aborted;
    }
    if let Some(e) = fatal {
        return AttemptResult::Fatal(e);
    }
    if let Some(e) = transient {
        return AttemptResult::Retryable(e, None);
    }
    if range_unsupported {
        let _ = tokio::fs::remove_file(&temp_path).await;
        let _ = tokio::fs::remove_file(&meta_path).await;
        return attempt_download(
            &client,
            id,
            url,
            save_path,
            bytes_counter,
            base_offset,
            false,
            manager_weak,
            extra_headers,
            referer,
            generation,
        )
        .await;
    }

    if is_superseded(manager_weak, id, generation).await {
        return AttemptResult::Aborted;
    }

    // Clean up metadata file
    let _ = tokio::fs::remove_file(&meta_path).await;

    // Verify final file size
    let on_disk_actual = std::fs::metadata(&temp_path)
        .map(|m| if m.is_file() { m.len() } else { 0 })
        .unwrap_or(0);
    if on_disk_actual != total {
        return AttemptResult::Retryable(
            format!(
                "Size mismatch: got {} bytes on disk, expected {}",
                on_disk_actual, total
            ),
            None,
        );
    }

    // Instant atomic rename into place
    let mut rename_attempts = 0;
    loop {
        match tokio::fs::rename(&temp_path, path).await {
            Ok(_) => break,
            Err(e) => {
                rename_attempts += 1;
                if rename_attempts >= 5 {
                    return AttemptResult::Fatal(format!(
                        "Failed to finalize file after {} attempts: {}",
                        rename_attempts, e
                    ));
                }
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
        }
    }

    AttemptResult::Completed
}

fn parse_retry_after(resp: &reqwest::Response) -> Option<Duration> {
    resp.headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.trim().parse::<u64>().ok())
        .map(Duration::from_secs)
}

async fn set_total_size(manager_weak: &WeakManager, id: &str, size: u64) {
    if let Some(manager) = manager_weak.upgrade() {
        let mut guard = manager.write().await;
        if let Some(item) = guard.downloads_mut().get_mut(id) {
            item.total_size = Some(size);
            // A single-file (direct) download's file entry has an unknown
            // size until the first response reports Content-Length — mirror it
            // so the per-file progress bar also advances live.
            if item.files.len() == 1 && item.files[0].size == 0 {
                item.files[0].size = size;
            }
        }
        guard.mark_dirty();
        guard.emit_progress_force();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunk_plan_keeps_small_and_single_worker_files_whole() {
        assert_eq!(chunk_plan(7 * 1024 * 1024, 8), (1, 7 * 1024 * 1024, 1));
        assert_eq!(chunk_plan(1024 * 1024 * 1024, 1), (1, 1024 * 1024 * 1024, 1));
    }

    #[test]
    fn chunk_plan_splits_large_files_into_work_stealing_ranges() {
        let (workers, chunk_size, count) = chunk_plan(100 * 1024 * 1024, 8);
        assert_eq!(workers, 8);
        assert_eq!(chunk_size, CHUNK_MIN_BYTES);
        assert_eq!(count, 25);

        let (workers, chunk_size, count) = chunk_plan(1024 * 1024 * 1024, 8);
        assert_eq!(workers, 8);
        assert_eq!(chunk_size, CHUNK_MAX_BYTES);
        assert_eq!(count, 32);
    }

    #[test]
    fn retry_delay_grows_exponentially_and_respects_retry_after() {
        assert_eq!(retry_delay(1, None, 500, 8_000), Duration::from_millis(500));
        assert_eq!(retry_delay(3, None, 500, 8_000), Duration::from_millis(2_000));
        assert_eq!(
            retry_delay(20, None, 500, 8_000),
            Duration::from_millis(8_000)
        );
        assert_eq!(
            retry_delay(1, Some(Duration::from_secs(60)), 500, 8_000),
            Duration::from_millis(8_000)
        );
    }

    #[test]
    fn content_range_start_rejects_unparseable_headers() {
        assert_eq!(content_range_start("bytes 100-199/1000"), Some(100));
        assert_eq!(content_range_start("bytes 0-0/*"), Some(0));
        assert_eq!(content_range_start("nonsense"), None);
        assert_eq!(content_range_start("bytes nope"), None);
    }

    #[test]
    fn url_needs_debrid_resolution_detects_provider_links() {
        assert!(url_needs_debrid_resolution(""));
        assert!(url_needs_debrid_resolution("torbox:12:34"));
        assert!(url_needs_debrid_resolution("torbox-zip:12"));
        assert!(url_needs_debrid_resolution("https://alldebrid.com/f/abc"));
        assert!(url_needs_debrid_resolution("https://www.alldebrid.com/f/abc"));
        assert!(url_needs_debrid_resolution("https://real-debrid.com/d/abc"));

        assert!(!url_needs_debrid_resolution(
            "https://cdn.alldebrid.com/dl/abc/game.rar"
        ));
        assert!(!url_needs_debrid_resolution(
            "https://download.torbox.app/abc/game.rar"
        ));
        assert!(!url_needs_debrid_resolution("https://example.com/game.rar"));
        assert!(!url_needs_debrid_resolution(
            "https://alldebrid.com/dl/game.rar"
        ));
    }

    #[test]
    fn tracker_claims_incomplete_chunks_once_and_skips_done_ones() {
        let mut tracker = SegmentProgressTracker {
            meta_path: std::path::PathBuf::new(),
            total_size: 10,
            chunk_size: 4,
            chunks: vec![4, 0, 2],
            next: 0,
            dirty: false,
        };
        assert_eq!(tracker.chunk_len(0), 4);
        assert_eq!(tracker.chunk_len(2), 2);
        assert_eq!(tracker.completed_bytes(), 6);

        let mut claimed = Vec::new();
        while let Some((idx, start, end, existing)) = tracker.claim() {
            claimed.push((idx, start, end, existing));
        }
        assert_eq!(claimed, vec![(1, 4, 8, 0)]);
    }
}
