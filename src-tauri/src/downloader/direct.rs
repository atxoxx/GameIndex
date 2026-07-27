use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use reqwest::header::{CONTENT_ENCODING, CONTENT_TYPE, RANGE};
use reqwest::StatusCode;
use tokio::fs::OpenOptions;
use tokio::io::AsyncWriteExt;

use crate::torrent_engine::{DownloadStatus, TorrentEngine};

// ── Resilience tuning (mirrors Hydra's JsHttpDownloader) ──────────────────────
const MAX_RETRY_ATTEMPTS: u32 = 10;
const INITIAL_RETRY_DELAY_MS: u64 = 1000;
const MAX_RETRY_DELAY_MS: u64 = 15000;
const STALL_TIMEOUT_SECS: u64 = 30;
const RETRYABLE_STATUSES: &[u16] = &[429, 500, 502, 503, 504];

/// Firefox UA: several game hosters throttle/block Chrome-based UAs.
const DOWNLOAD_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0";

/// Outcome of a single download attempt. Lets the outer retry loop decide
/// whether to retry, fall back to the next mirror, or stop.
enum AttemptResult {
    /// File fully downloaded and finalized.
    Completed,
    /// User paused / removed the download — do not retry, do not error.
    Aborted,
    /// Permanent failure for this URL (try the next mirror, then error).
    Fatal(String),
    /// Transient failure — retry the same URL (optionally after `Retry-After`).
    Retryable(String, Option<Duration>),
}

fn try_next_mirror_or_fail(
    engine_weak: std::sync::Weak<tokio::sync::RwLock<TorrentEngine>>,
    id: String,
    err_msg: String,
) -> bool {
    if let Some(engine) = engine_weak.upgrade() {
        let mut guard = match engine.try_write() {
            Ok(g) => g,
            Err(_) => engine.blocking_write(),
        };
        let mut transition_info = None;
        if let Some(item) = guard.downloads_mut().get_mut(&id) {
            if let Some(uris) = &item.uris {
                if uris.len() > 1 {
                    if let Some(current_idx) = uris.iter().position(|u| u == &item.source_uri) {
                        let next_idx = current_idx + 1;
                        if next_idx < uris.len() {
                            let next_url = uris[next_idx].clone();
                            println!(
                                "[DirectDownloader] Download failed on mirror {} ({}). Trying next mirror {} ({})...",
                                current_idx + 1,
                                item.source_uri,
                                next_idx + 1,
                                next_url
                            );
                            item.source_uri = next_url.clone();
                            transition_info = Some((next_url, item.save_path.clone()));
                        }
                    }
                }
            }
        }

        if let Some((next_url, save_path)) = transition_info {
            // Each mirror serves different bytes, so a partial downloaded
            // from a failed mirror must not be appended to by the next one.
            // Drop the stale temp file so the next mirror starts clean.
            let path = Path::new(&save_path);
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

            let bytes_counter = Arc::new(AtomicU64::new(0));
            guard.direct_counters.insert(id.clone(), Arc::clone(&bytes_counter));
            guard.mark_dirty();
            guard.emit_progress_force();

            let engine_weak_clone = engine_weak.clone();
            let id_clone = id.clone();
            tokio::spawn(async move {
                run_direct_download(
                    id_clone,
                    next_url,
                    save_path,
                    bytes_counter,
                    engine_weak_clone,
                )
                .await;
            });
            return true;
        }

        if let Some(item) = guard.downloads_mut().get_mut(&id) {
            item.status = DownloadStatus::Error(err_msg);
        }
        guard.mark_dirty();
        guard.emit_progress_force();
    }
    false
}

/// Runs a direct HTTP download in a background task.
///
/// Wraps a single attempt in a retry loop (mirroring Hydra's
/// `JsHttpDownloader`): transient network errors, retryable HTTP statuses,
/// and stalls are retried with exponential backoff before we fall back to the
/// next mirror or fail.
pub async fn run_direct_download(
    id: String,
    url: String,
    save_path: String,
    bytes_counter: Arc<AtomicU64>,
    engine_weak: std::sync::Weak<tokio::sync::RwLock<TorrentEngine>>,
) {
    // Resolve the raw source URI into a real file URL (and any hoster-specific
    // headers) before streaming. Mirrors Hydra's per-hoster resolvers
    // (`getXxxDownloadOptions`). Done once per run so retries reuse the result.
    let (effective_url, extra_headers) =
        match crate::downloader::hosters::resolve(&url).await {
            crate::downloader::hosters::ResolveOutcome::Passthrough => {
                (url.clone(), Vec::new())
            }
            crate::downloader::hosters::ResolveOutcome::Resolved(t) => {
                println!("[DirectDownloader] Resolved {} -> {}", url, t.url);
                (t.url, t.headers)
            }
            crate::downloader::hosters::ResolveOutcome::Error(e) => {
                try_next_mirror_or_fail(engine_weak.clone(), id.clone(), e);
                return;
            }
        };

    // Disable automatic decompression so byte ranges are exact and resume is
    // reliable. We also send `Accept-Encoding: identity` to ask the server not
    // to compress the body in the first place.
    let client = reqwest::Client::builder()
        .user_agent(DOWNLOAD_USER_AGENT)
        // Carry cookies set on intermediate redirect/error responses. Some
        // hosters (e.g. buzzheavier, gofile CDN) issue a 302 that drops a
        // session cookie; without it the final request 404s.
        .cookie_store(true)
        .build()
        .unwrap_or_default();

    let mut attempt: u32 = 0;
    loop {
        match attempt_download(
            &client,
            &id,
            &effective_url,
            &save_path,
            &bytes_counter,
            &engine_weak,
            &extra_headers,
        )
        .await
        {
            AttemptResult::Completed | AttemptResult::Aborted => return,
            AttemptResult::Fatal(msg) => {
                try_next_mirror_or_fail(engine_weak.clone(), id.clone(), msg);
                return;
            }
            AttemptResult::Retryable(msg, retry_after) => {
                attempt += 1;
                if attempt > MAX_RETRY_ATTEMPTS {
                    try_next_mirror_or_fail(
                        engine_weak.clone(),
                        id.clone(),
                        format!("Exhausted {} retries: {}", MAX_RETRY_ATTEMPTS, msg),
                    );
                    return;
                }

                // Bail out if the user paused/removed the download while we
                // were about to back off.
                if let Some(engine) = engine_weak.upgrade() {
                    let guard = engine.read().await;
                    if let Some(item) = guard.downloads_map().get(&id) {
                        if matches!(item.status, DownloadStatus::Paused) {
                            println!("[DirectDownloader] Download paused for {} before retry", id);
                            return;
                        }
                    }
                } else {
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
                    "[DirectDownloader] Retryable error ({}). Retry {}/{} in {:?}",
                    msg, attempt, MAX_RETRY_ATTEMPTS, delay
                );
                tokio::time::sleep(delay).await;
            }
        }
    }
}

/// Performs one HTTP download attempt. The caller handles retry/fallback.
async fn attempt_download(
    client: &reqwest::Client,
    id: &str,
    url: &str,
    save_path: &str,
    bytes_counter: &Arc<AtomicU64>,
    engine_weak: &std::sync::Weak<tokio::sync::RwLock<TorrentEngine>>,
    extra_headers: &[(String, String)],
) -> AttemptResult {
    // We download to a temporary file, then rename it upon completion.
    let path = Path::new(save_path);
    let filename = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("direct_download")
        .to_string();
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let temp_path = parent.join(format!("{}.gamelib_tmp", filename));

    // Get current size to support resume.
    let mut current_size = 0;
    if temp_path.exists() {
        if let Ok(metadata) = std::fs::metadata(&temp_path) {
            current_size = metadata.len();
        }
    }
    bytes_counter.store(current_size, Ordering::SeqCst);

    println!(
        "[DirectDownloader] Starting attempt for {} from byte {}",
        filename, current_size
    );

    // Build the request. Disable compression so byte ranges are exact.
    let is_resume = current_size > 0;
    let mut req = client
        .get(url)
        .header("Accept-Encoding", "identity");
    for (k, v) in extra_headers {
        req = req.header(k.as_str(), v.as_str());
    }
    if is_resume {
        req = req.header(RANGE, format!("bytes={}-", current_size));
    }

    let resp_res = req.send().await;
    let mut resp = match resp_res {
        Ok(r) => r,
        Err(e) => {
            // Connection-level failures are almost always transient (reset,
            // timeout, DNS). Retry rather than failing the direct link.
            return AttemptResult::Retryable(format!("Connection failed: {}", e), None);
        }
    };

    let status = resp.status();

    // Retryable transient HTTP statuses (rate limits / gateway hiccups).
    if status != StatusCode::OK && status != StatusCode::PARTIAL_CONTENT {
        let code = status.as_u16();
        if RETRYABLE_STATUSES.contains(&code) {
            let retry_after = parse_retry_after(&resp);
            return AttemptResult::Retryable(
                format!("HTTP {} (transient)", code),
                retry_after,
            );
        }
        // Diagnostics: surface where the request actually landed and what the
        // server told us. A 404 on a "direct" link usually means the hoster
        // needs a `Referer`, a redirect-set `Cookie`, or the URL points at a
        // redirect page rather than the file.
        println!(
            "[DirectDownloader] HTTP {} for {} (final url: {})",
            code,
            url,
            resp.url()
        );
        if let Some(loc) = resp.headers().get(reqwest::header::LOCATION) {
            if let Ok(l) = loc.to_str() {
                println!("[DirectDownloader]   Location: {}", l);
            }
        }
        if let Some(ct) = resp.headers().get(CONTENT_TYPE) {
            if let Ok(ct) = ct.to_str() {
                println!("[DirectDownloader]   Content-Type: {}", ct);
            }
        }
        for cookie in resp.headers().get_all(reqwest::header::SET_COOKIE).iter() {
            if let Ok(c) = cookie.to_str() {
                println!("[DirectDownloader]   Set-Cookie: {}", c);
            }
        }
        return AttemptResult::Fatal(format!("HTTP Error: {}", status));
    }

    // Guard against the server returning an HTML error/expired page
    // instead of the file (common with dead hoster links). Saving a
    // `text/html` body as the download would silently corrupt it and
    // mark the download "Completed". Upstream Hydra's `JsHttpDownloader`
    // rejects `text/html` the same way — fail fast here (and let the
    // mirror fallback / error path take over).
    if let Some(content_type) = resp.headers().get(CONTENT_TYPE) {
        if let Ok(ct) = content_type.to_str() {
            if ct.to_ascii_lowercase().starts_with("text/html") {
                // Diagnostics: many "direct" URLs are actually portal/redirect
                // pages (buzzheavier, gofile, etc.) that need a per-hoster
                // resolver or a `Referer`/`Cookie` to yield the real file. Log
                // where we landed so the right resolver can be added.
                println!(
                    "[DirectDownloader] HTML page (not a file) for {} (final url: {})",
                    url,
                    resp.url()
                );
                if let Some(loc) = resp.headers().get(reqwest::header::LOCATION) {
                    if let Ok(l) = loc.to_str() {
                        println!("[DirectDownloader]   Location: {}", l);
                    }
                }
                return AttemptResult::Fatal(
                    "Server returned an HTML page instead of a file (link may be expired or blocked)"
                        .to_string(),
                );
            }
        }
    }

    // If the server compressed the body, byte-offset resume is unreliable
    // (the Range applies to compressed bytes). Restart from byte 0 instead
    // of appending corrupt data — mirrors upstream's `JsHttpDownloader`
    // content-encoding guard.
    let content_encoding = resp
        .headers()
        .get(CONTENT_ENCODING)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    let server_compressed = content_encoding != "" && content_encoding != "identity";

    // If we asked to resume (Range header) but the server ignored it and
    // returned a full `200` (instead of `206 Partial Content`), the body is
    // the whole file. If it's also compressed we must restart from zero;
    // otherwise we keep our partial and simply skip the prefix we already
    // hold (mirrors Hydra's `resolveResumeAction` rangeIgnored branch).
    let restart_from_zero = is_resume && status != StatusCode::PARTIAL_CONTENT && server_compressed;
    let range_ignored = is_resume && status != StatusCode::PARTIAL_CONTENT && !server_compressed;

    if restart_from_zero {
        current_size = 0;
        bytes_counter.store(0, Ordering::SeqCst);
        // Drop the stale partial so we don't append the full body to it.
        if temp_path.exists() {
            let _ = tokio::fs::remove_file(&temp_path).await;
        }
    }

    if let Some(content_length) = resp.content_length() {
        let total = if status == StatusCode::PARTIAL_CONTENT {
            current_size + content_length
        } else {
            content_length
        };
        set_total_size(engine_weak, id, total).await;
    }

    // Ensure parent directories exist.
    if let Some(parent_dir) = temp_path.parent() {
        if !parent_dir.exists() {
            if let Err(e) = tokio::fs::create_dir_all(parent_dir).await {
                set_status_error(
                    engine_weak,
                    id,
                    format!("Failed to create parent directories: {}", e),
                )
                .await;
                return AttemptResult::Fatal(format!("Failed to create parent directories: {}", e));
            }
        }
    }

    // Resume (206) / range-ignored (200, partial kept) appends to the partial;
    // a fresh download or a restart-from-zero truncates so we never duplicate.
    let append_mode = (status == StatusCode::PARTIAL_CONTENT && !restart_from_zero) || range_ignored;
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
            let msg = format!("Failed to create file: {}", e);
            set_status_error(engine_weak, id, msg.clone()).await;
            return AttemptResult::Fatal(msg);
        }
    };

    // For a range-ignored resume, drop the prefix bytes we already have on
    // disk so the appended bytes line up with the existing partial.
    let mut skip_remaining: u64 = if range_ignored { current_size } else { 0 };
    let mut buffer_size = current_size;

    loop {
        // Check if download was paused, removed, or errored from the engine side.
        if let Some(engine) = engine_weak.upgrade() {
            let guard = engine.read().await;
            if let Some(item) = guard.downloads_map().get(id) {
                if matches!(item.status, DownloadStatus::Paused) {
                    println!("[DirectDownloader] Download paused for {}", filename);
                    drop(file);
                    return AttemptResult::Aborted;
                }
            } else {
                // Download was removed. Clean up temp file.
                drop(file);
                let _ = tokio::fs::remove_file(&temp_path).await;
                return AttemptResult::Aborted;
            }
        } else {
            drop(file);
            return AttemptResult::Aborted;
        }

        // Fetch next chunk, guarding against stalls (no data for a long time).
        let chunk_res = tokio::time::timeout(Duration::from_secs(STALL_TIMEOUT_SECS), resp.chunk()).await;
        let chunk = match chunk_res {
            Ok(inner) => match inner {
                Ok(Some(c)) => c,
                Ok(None) => break, // Download complete!
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

        // Skip the already-downloaded prefix when the server ignored Range.
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
    }

    // Flush and close the file.
    let _ = file.flush().await;
    drop(file);

    // Rename to final path.
    if let Err(e) = tokio::fs::rename(&temp_path, path).await {
        return AttemptResult::Retryable(format!("Failed to finalize file: {}", e), None);
    }

    // Mark as completed.
    if let Some(engine) = engine_weak.upgrade() {
        let mut guard = engine.write().await;
        let mut auto_extract = false;
        let mut files_clone = Vec::new();
        if let Some(item) = guard.downloads_mut().get_mut(id) {
            item.status = DownloadStatus::Completed;
            item.progress = Some(1.0);
            item.downloaded = item.total_size.unwrap_or(buffer_size);
            item.download_speed = 0;
            item.upload_speed = 0;
            item.had_real_downloads = Some(true);
            auto_extract = item.auto_extract.unwrap_or(false);
            files_clone = item.files.clone();
        }
        guard.mark_dirty();
        guard.emit_progress_force();

        // Trigger extraction if requested.
        if auto_extract {
            let id_clone = id.to_string();
            let id_clone_for_extract = id.to_string();
            let save_path_clone = save_path.to_string();
            let engine_clone = Arc::clone(&engine);
            tokio::spawn(async move {
                println!("[DirectDownloader] Starting auto-extraction for {}", filename);
                let success = tokio::task::spawn_blocking(move || {
                    crate::torrent_engine::extract_archives_for_torrent(
                        &id_clone_for_extract,
                        &save_path_clone,
                        &files_clone,
                    )
                })
                .await
                .map(|r| r.is_ok())
                .unwrap_or(false);

                if success {
                    if let Some(mut guard) = engine_clone.try_write().ok() {
                        if let Some(d) = guard.downloads_mut().get_mut(&id_clone) {
                            d.extracted = Some(true);
                            guard.mark_dirty();
                            guard.emit_progress_force();
                        }
                    }
                }
            });
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

async fn set_status_error(
    engine_weak: &std::sync::Weak<tokio::sync::RwLock<TorrentEngine>>,
    id: &str,
    err: String,
) {
    if let Some(engine) = engine_weak.upgrade() {
        let mut guard = engine.write().await;
        if let Some(item) = guard.downloads_mut().get_mut(id) {
            item.status = DownloadStatus::Error(err);
            guard.mark_dirty();
            guard.emit_progress_force();
        }
    }
}

async fn set_total_size(
    engine_weak: &std::sync::Weak<tokio::sync::RwLock<TorrentEngine>>,
    id: &str,
    size: u64,
) {
    if let Some(engine) = engine_weak.upgrade() {
        let mut guard = engine.write().await;
        if let Some(item) = guard.downloads_mut().get_mut(id) {
            item.total_size = Some(size);
            guard.mark_dirty();
            guard.emit_progress_force();
        }
    }
}
