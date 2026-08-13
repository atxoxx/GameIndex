//! Resumable direct-HTTP downloader (Hydra `JsHttpDownloader`
//! equivalent).
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

use reqwest::header::{CONTENT_ENCODING, CONTENT_TYPE, RANGE};
use reqwest::StatusCode;
use tokio::fs::OpenOptions;
use tokio::io::AsyncWriteExt;

use super::manager::{self, WeakManager};
use super::types::DownloadStatus;

const MAX_RETRY_ATTEMPTS: u32 = 10;
const INITIAL_RETRY_DELAY_MS: u64 = 1000;
const MAX_RETRY_DELAY_MS: u64 = 15000;
const STALL_TIMEOUT_SECS: u64 = 30;
const REQUEST_TIMEOUT_SECS: u64 = 60;
const RETRYABLE_STATUSES: &[u16] = &[429, 500, 502, 503, 504];

/// Firefox UA: several game hosters throttle/block Chrome-based UAs.
const DOWNLOAD_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0";

/// Global direct-download speed limit in bytes/sec (0 = unlimited).
static DIRECT_LIMIT_BPS: AtomicU64 = AtomicU64::new(0);

pub fn set_direct_speed_limit(bps: u64) {
    DIRECT_LIMIT_BPS.store(bps, Ordering::Relaxed);
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
/// Completed, triggers extraction, and advances the queue.
pub async fn run_direct_download(
    id: String,
    url: String,
    save_path: String,
    bytes_counter: Arc<AtomicU64>,
    manager_weak: WeakManager,
    generation: u64,
    worker_lock: Arc<tokio::sync::Mutex<()>>,
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
        }
    }

    let client = reqwest::Client::builder()
        .user_agent(DOWNLOAD_USER_AGENT)
        // Carry cookies set on redirect/error responses — some hosters
        // 302 through a cookie-setting hop.
        .cookie_store(true)
        .build()
        .unwrap_or_default();

    let mut current_url = url;
    let current_save_path = save_path;

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

        let mut attempt: u32 = 0;
        loop {
            // Stop immediately if a newer worker took over (C1).
            if is_superseded(&manager_weak, &id, generation).await {
                return;
            }
            match attempt_download(
                &client,
                &id,
                &effective_url,
                &current_save_path,
                &bytes_counter,
                0,
                true,
                &manager_weak,
                &extra_headers,
                generation,
            )
            .await
            {
                AttemptResult::Completed => {
                    finalize_success(
                        &manager_weak,
                        &id,
                        &current_save_path,
                        &bytes_counter,
                        generation,
                    )
                    .await;
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

                    let delay = match retry_after {
                        Some(d) => d.min(Duration::from_millis(MAX_RETRY_DELAY_MS)),
                        None => {
                            let exp = INITIAL_RETRY_DELAY_MS
                                .checked_mul(1u64 << (attempt - 1))
                                .unwrap_or(MAX_RETRY_DELAY_MS);
                            Duration::from_millis(exp.min(MAX_RETRY_DELAY_MS))
                        }
                    };
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

/// Download every file in a debrid-resolved torrent sequentially into
/// `save_dir`, updating the record's per-file list as each one lands,
/// then finalise once all files are done. Reuses `attempt_download`'s
/// retry/backoff, stall-watchdog and resume machinery; the `base_offset`
/// counter keeps the record's progress reflecting the whole transfer
/// rather than just the current file.
pub async fn run_debrid_files_download(
    id: String,
    files: Vec<(String, u64, String)>, // (name, size, url)
    save_dir: String,
    bytes_counter: Arc<AtomicU64>,
    manager_weak: WeakManager,
    generation: u64,
    worker_lock: Arc<tokio::sync::Mutex<()>>,
) {
    let _lock_guard = worker_lock.lock().await;
    if is_superseded(&manager_weak, &id, generation).await {
        return;
    }

    let client = reqwest::Client::builder()
        .user_agent(DOWNLOAD_USER_AGENT)
        .cookie_store(true)
        .build()
        .unwrap_or_default();

    let mut base_offset: u64 = 0;
    for (idx, (name, _size, url)) in files.iter().enumerate() {
        let save_path = Path::new(&save_dir)
            .join(name)
            .to_string_lossy()
            .into_owned();

        let mut attempt: u32 = 0;
        loop {
            if is_superseded(&manager_weak, &id, generation).await {
                return;
            }
            match attempt_download(
                &client,
                &id,
                url,
                &save_path,
                &bytes_counter,
                base_offset,
                false,
                &manager_weak,
                &[],
                generation,
            )
            .await
            {
                AttemptResult::Completed => break,
                AttemptResult::Aborted => return,
                AttemptResult::Fatal(msg) => {
                    finish_with_error(&manager_weak, &id, msg, generation).await;
                    return;
                }
                AttemptResult::Retryable(msg, retry_after) => {
                    attempt += 1;
                    if attempt > MAX_RETRY_ATTEMPTS {
                        let final_msg =
                            format!("Exhausted {} retries: {}", MAX_RETRY_ATTEMPTS, msg);
                        finish_with_error(&manager_weak, &id, final_msg, generation).await;
                        return;
                    }
                    if !still_downloading(&manager_weak, &id, generation).await {
                        return;
                    }
                    let delay = match retry_after {
                        Some(d) => d.min(Duration::from_millis(MAX_RETRY_DELAY_MS)),
                        None => {
                            let exp = INITIAL_RETRY_DELAY_MS
                                .checked_mul(1u64 << (attempt - 1))
                                .unwrap_or(MAX_RETRY_DELAY_MS);
                            Duration::from_millis(exp.min(MAX_RETRY_DELAY_MS))
                        }
                    };
                    tokio::time::sleep(delay).await;
                }
            }
        }

        // File landed: record its real byte count and advance the offset
        // so the next file's progress stacks on top of this one.
        let after = bytes_counter.load(Ordering::SeqCst);
        let file_bytes = after.saturating_sub(base_offset);
        base_offset = after;
        if let Some(manager) = manager_weak.upgrade() {
            let mut guard = manager.write().await;
            if let Some(item) = guard.downloads_mut().get_mut(&id) {
                if let Some(f) = item.files.get_mut(idx) {
                    f.downloaded = file_bytes;
                    if f.size == 0 {
                        f.size = file_bytes;
                    }
                    f.progress = 1.0;
                }
            }
            guard.mark_dirty();
            guard.emit_progress_force();
        }
    }

    finalize_success(&manager_weak, &id, &save_dir, &bytes_counter, generation).await;
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
        manager::advance_queue(&manager).await;
    }
}

async fn finalize_success(
    manager_weak: &WeakManager,
    id: &str,
    save_path: &str,
    bytes_counter: &Arc<AtomicU64>,
    generation: u64,
) {
    if is_superseded(manager_weak, id, generation).await {
        return;
    }
    let Some(manager) = manager_weak.upgrade() else {
        return;
    };
    let mut auto_extract = false;
    let mut files_clone = Vec::new();
    let mut name = String::new();
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
            auto_extract = item.auto_extract.unwrap_or(false);
            item.extracted = Some(!auto_extract);
            files_clone = item.files.clone();
            name = item.name.clone();
        }
        guard.mark_dirty();
        guard.emit_progress_force();
    }

    if auto_extract {
        manager::spawn_extraction(
            id.to_string(),
            save_path.to_string(),
            name,
            files_clone,
        );
    }

    manager::on_download_finished(&manager, id).await;
}

/// Simple token-bucket style throttle for the global speed limit.
struct Throttle {
    window_start: std::time::Instant,
    window_bytes: u64,
}

impl Throttle {
    fn new() -> Self {
        Self {
            window_start: std::time::Instant::now(),
            window_bytes: 0,
        }
    }

    async fn account(&mut self, bytes: u64) {
        let limit = DIRECT_LIMIT_BPS.load(Ordering::Relaxed);
        if limit == 0 {
            return;
        }
        self.window_bytes += bytes;
        let elapsed = self.window_start.elapsed().as_secs_f64();
        let allowed = (limit as f64 * elapsed) as u64;
        if self.window_bytes > allowed {
            let excess = self.window_bytes - allowed;
            let sleep_secs = excess as f64 / limit as f64;
            tokio::time::sleep(Duration::from_secs_f64(sleep_secs.min(2.0))).await;
        }
        // Reset the window periodically so old history doesn't allow
        // long bursts after an idle period.
        if elapsed > 5.0 {
            self.window_start = std::time::Instant::now();
            self.window_bytes = 0;
        }
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

    // Disable compression so byte ranges are exact and resume works.
    let is_resume = current_size > 0;
    let mut req = client.get(url).header("Accept-Encoding", "identity");
    for (k, v) in extra_headers {
        req = req.header(k.as_str(), v.as_str());
    }
    if is_resume {
        req = req.header(RANGE, format!("bytes={}-", current_size));
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
    // ── Response validation (Hydra-style preflight, applied to the
    // real transfer response so no extra round-trip is needed) ──
    if status != StatusCode::OK && status != StatusCode::PARTIAL_CONTENT {
        let code = status.as_u16();
        if RETRYABLE_STATUSES.contains(&code) {
            let retry_after = parse_retry_after(&resp);
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

    // Server ignored our Range → 200 with the whole file. Compressed:
    // restart from zero. Uncompressed: keep the partial, skip prefix.
    let restart_from_zero =
        is_resume && status != StatusCode::PARTIAL_CONTENT && server_compressed;
    let range_ignored =
        is_resume && status != StatusCode::PARTIAL_CONTENT && !server_compressed;

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

    let mut file = match file_res {
        Ok(f) => f,
        Err(e) => {
            return AttemptResult::Fatal(format!("Failed to create file: {}", e));
        }
    };

    let mut skip_remaining: u64 = if range_ignored { current_size } else { 0 };
    let mut buffer_size = base_offset + current_size;
    let mut throttle = Throttle::new();
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
        throttle.account(to_write.len() as u64).await;
    }

    // C1: never rename over the final path on behalf of a superseded
    // worker — the newer worker owns that path now.
    if is_superseded(manager_weak, id, generation).await {
        drop(file);
        return AttemptResult::Aborted;
    }

    let _ = file.flush().await;
    drop(file);

    if let Err(e) = tokio::fs::rename(&temp_path, path).await {
        return AttemptResult::Retryable(format!("Failed to finalize file: {}", e), None);
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
        }
        guard.mark_dirty();
        guard.emit_progress_force();
    }
}
