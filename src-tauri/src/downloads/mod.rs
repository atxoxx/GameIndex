//! Download subsystem.
//!
//! One active download at a time + a persistent queue; torrents on
//! librqbit with optional seeding after completion; direct/debrid
//! downloads on a resumable HTTP worker with hoster resolvers.
//!
//! Command names are kept from the previous engine so the frontend
//! call sites keep working (`torrent_add`, `torrent_pause`, ...).

pub mod browser_resolver;
pub mod debrid;
pub mod extract;
pub mod hosters;
pub mod http;
pub mod manager;
pub mod persistence;
pub mod torrent;
pub mod types;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use tauri::AppHandle;
use tokio::sync::OnceCell;
use tokio::time::interval;

use manager::{DownloadManager, SharedManager};
use types::{unix_now, Download, DownloadKind, DownloadStatus, DownloadFile};

pub use extract::cleanup_extractions;

// ─── Singleton ──────────────────────────────────────────────────────────────

static MANAGER: OnceCell<SharedManager> = OnceCell::const_new();

/// Non-blocking accessor (None until `initialize_engine` completes).
pub fn manager_handle() -> Option<SharedManager> {
    MANAGER.get().cloned()
}

/// Poll for the manager up to ~2 s — covers the cold-start race where
/// a user clicks Download before the async init task finished.
async fn wait_for_manager() -> Result<SharedManager, String> {
    const MAX_ATTEMPTS: usize = 20;
    for _ in 0..MAX_ATTEMPTS {
        if let Some(m) = manager_handle() {
            return Ok(m);
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    Err("Download engine not initialized".to_string())
}

/// Initialize the download manager and spawn the 1 s status loop.
pub async fn initialize_engine(app: AppHandle, app_data_dir: PathBuf) -> Result<(), String> {
    // Same directory as the previous engine so librqbit fast-resume
    // and the persisted downloads survive the rewrite.
    let state_dir = app_data_dir.join("torrent-engine");
    let mut mgr = DownloadManager::new(state_dir);
    mgr.set_app(app);
    mgr.initialize().await?;
    let shared = Arc::new(tokio::sync::RwLock::new(mgr));
    MANAGER
        .set(shared.clone())
        .map_err(|_| "Download engine already initialized".to_string())?;

    // Re-add seeding torrents that librqbit didn't restore itself.
    resume_persisted_seeding(&shared).await;

    // Kick the queue: restart whatever was mid-flight at last exit.
    manager::advance_queue(&shared).await;

    let loop_handle = shared.clone();
    tokio::spawn(async move {
        let mut tick = interval(Duration::from_secs(1));
        tick.tick().await; // skip the immediate first tick
        loop {
            tick.tick().await;
            let want_advance = {
                let mut guard = loop_handle.write().await;
                let want_advance = guard.refresh_stats().await;
                guard.flush_if_dirty();
                guard.emit_progress();
                want_advance
            };
            if want_advance {
                manager::advance_queue(&loop_handle).await;
            }
        }
    });
    Ok(())
}

/// Re-add persisted Seeding torrents that are missing from the session.
async fn resume_persisted_seeding(shared: &SharedManager) {
    let to_seed: Vec<(String, String, String, Option<Vec<usize>>, Option<String>)> = {
        let guard = shared.read().await;
        let Some(session) = guard.session().cloned() else {
            return;
        };
        guard
            .downloads_map()
            .values()
            .filter(|d| {
                matches!(d.status, DownloadStatus::Seeding)
                    && !d.source_uri.is_empty()
                    && torrent::find_handle(&session, &d.id).is_none()
            })
            .map(|d| {
                (
                    d.id.clone(),
                    d.source_uri.clone(),
                    d.save_path.clone(),
                    d.only_files.clone(),
                    d.referer.clone(),
                )
            })
            .collect()
    };

    for (id, source_uri, save_path, only_files, referer) in to_seed {
        let shared_clone = shared.clone();
        tokio::spawn(async move {
            let session = {
                let guard = shared_clone.read().await;
                guard.session().cloned()
            };
            let Some(session) = session else { return };
            match torrent::add_and_start(
                &session,
                &source_uri,
                &save_path,
                only_files.as_deref(),
                referer.as_deref(),
            )
            .await
            {
                Ok(torrent::AddOutcome::Added { .. }) => {
                    println!("[downloads] Resumed seeding for {}", id);
                }
                Ok(torrent::AddOutcome::AlreadyManaged { .. }) => {
                    println!("[downloads] {} already in session; keeping it as-is", id);
                }
                Err(e) => {
                    eprintln!("[downloads] Failed to resume seeding for {}: {}", id, e);
                    let mut guard = shared_clone.write().await;
                    if let Some(d) = guard.downloads_mut().get_mut(&id) {
                        d.status = DownloadStatus::Completed;
                        d.should_seed = Some(false);
                    }
                    guard.mark_dirty();
                }
            }
        });
    }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

fn normalize_path(p: &str) -> String {
    let mut normalized = p.replace('/', "\\");
    while normalized.contains("\\\\") {
        normalized = normalized.replace("\\\\", "\\");
    }
    if normalized.ends_with('\\') && normalized.len() > 3 {
        normalized.pop();
    }
    normalized
}

/// Queue the record if something else is active, otherwise start it.
async fn queue_or_start(manager: &SharedManager, id: &str) {
    if !manager::start_download(manager, id).await {
        // Slot busy or the record vanished — make sure it waits.
        let mut guard = manager.write().await;
        if guard.downloads_map().contains_key(id) {
            guard.enqueue_back(id);
            guard.emit_progress_force();
        }
    }
}

/// M1: re-add of an infohash that already has a record. Live records
/// are rejected; stable records (Paused/Completed/Seeding) are
/// repurposed as an explicit re-download.
async fn handle_duplicate_add(
    mgr: &SharedManager,
    existing: &Download,
    trimmed: String,
    save_path: String,
    game_id: Option<String>,
    source_name: String,
    auto_extract: bool,
    referer: Option<String>,
) -> Result<Download, String> {
    if matches!(
        existing.status,
        DownloadStatus::Queued
            | DownloadStatus::FetchingMetadata
            | DownloadStatus::Downloading
            | DownloadStatus::Error(_)
    ) {
        return Err(format!(
            "This torrent is already in your downloads ({}). \
             Resume it there, or remove it first if you want to re-download.",
            existing.name
        ));
    }

    // Repurpose the existing record as a fresh download.
    let snapshot = {
        let mut guard = mgr.write().await;
        let Some(d) = guard.downloads_mut().get_mut(&existing.id) else {
            return Err("Download vanished while adding".to_string());
        };
        d.source_uri = trimmed;
        d.save_path = save_path;
        d.game_id = game_id;
        d.source_name = source_name;
        d.auto_extract = Some(auto_extract);
        d.referer = referer;
        d.only_files = None;
        d.downloaded = 0;
        d.total_size = None;
        d.progress = Some(0.0);
        d.download_speed = 0;
        d.upload_speed = 0;
        d.peers = 0;
        d.seeds = 0;
        d.files.clear();
        d.had_real_downloads = Some(false);
        d.extracted = Some(false);
        d.status = DownloadStatus::Queued;
        d.added_at = unix_now();
        let snapshot = d.clone();
        guard.mark_dirty();
        guard.emit_progress_force();
        snapshot
    };

    // Drop any live session entry (keep files) so the start path
    // re-adds with the new save_path/selection as a fresh `Added`.
    let session = { mgr.read().await.session().cloned() };
    if let Some(session) = session {
        torrent::delete_from_session(&session, &existing.id).await;
    }

    queue_or_start(mgr, &existing.id).await;
    Ok(snapshot)
}

/// Preempt whatever is active in favour of `id` (explicit user resume).
/// The preempted download goes to the FRONT of the queue.
async fn preempt_and_start(manager: &SharedManager, id: &str) {
    let (session, preempted) = {
        let mut guard = manager.write().await;
        let session = guard.session().cloned();
        let active = guard
            .active_id()
            .cloned()
            .filter(|a| a != id && guard.has_active());
        if let Some(active_id) = &active {
            if let Some(d) = guard.downloads_mut().get_mut(active_id) {
                d.status = DownloadStatus::Queued;
                d.download_speed = 0;
            }
            guard.enqueue_front(active_id);
            let active_clone = active_id.clone();
            guard.release_active(&active_clone);
        }
        guard.mark_dirty();
        (session, active)
    };

    // Pause the preempted torrent's session entry (direct workers stop
    // on their own when they observe the status change). Quiesce first
    // so the pause can't race the preempted torrent's in-flight writes.
    if let (Some(session), Some(active_id)) = (&session, &preempted) {
        if let Some(handle) = torrent::find_handle(session, active_id) {
            torrent::pause_torrent(session, &handle).await;
        }
    }

    manager::start_download(manager, id).await;
}

// ─── Tauri commands: adds ───────────────────────────────────────────────────

#[tauri::command]
pub async fn torrent_add(
    magnet_uri: String,
    save_path: String,
    game_id: Option<String>,
    source_name: String,
    auto_extract: Option<bool>,
    list_only: Option<bool>,
    referer: Option<String>,
) -> Result<Download, String> {
    let mgr = wait_for_manager().await?;
    let save_path = normalize_path(&save_path);

    if save_path.trim().is_empty() {
        return Err(
            "No download folder selected. Please pick a folder before starting a download."
                .to_string(),
        );
    }

    let trimmed = magnet_uri.trim().to_string();
    let is_local = torrent::local_torrent_path(&trimmed).is_some();
    if !is_local
        && !(trimmed.starts_with("magnet:")
            || trimmed.starts_with("http://")
            || trimmed.starts_with("https://"))
    {
        return Err(
            "Source URI must be a magnet: link, a .torrent file path, or an http(s):// torrent URL"
                .to_string(),
        );
    }

    // ── list_only: synchronous metadata registration for the
    // file-selection UI. Fast (librqbit just registers the infohash)
    // and does NOT occupy the active slot. ──
    if list_only.unwrap_or(false) {
        let session = {
            let guard = mgr.read().await;
            guard
                .session()
                .cloned()
                .ok_or_else(|| "Download engine not initialized".to_string())?
        };

        let add = torrent::build_add_torrent(&trimmed, referer.as_deref()).await?;
        let add_opts = librqbit::AddTorrentOptions {
            output_folder: Some(save_path.clone().into()),
            overwrite: true,
            list_only: true,
            trackers: Some(torrent::default_trackers_vec()),
            force_tracker_interval: Some(Duration::from_secs(30)),
            ..Default::default()
        };

        let response = tokio::time::timeout(
            Duration::from_secs(120),
            session.add_torrent(add, Some(add_opts)),
        )
        .await
        .map_err(|_| {
            "Torrent is taking too long to fetch metadata — your network may be \
             blocking DHT or trackers."
                .to_string()
        })?
        .map_err(|e| format!("Failed to add torrent: {}", e))?;

        let (id_str, name, files, total_size) = match response {
            librqbit::AddTorrentResponse::Added(_, handle)
            | librqbit::AddTorrentResponse::AlreadyManaged(_, handle) => {
                let id_str = torrent::frontend_id_from_hash(&handle.shared().info_hash.0);
                let name = handle
                    .name()
                    .unwrap_or_else(|| "Fetching metadata\u{2026}".to_string());
                let stats = handle.stats();
                let files = torrent::files_from_handle(&handle, &stats).unwrap_or_default();
                // Keep the entry paused — it must not download yet.
                let _ = session.pause(&handle).await;
                (id_str, name, files, stats.total_bytes)
            }
            librqbit::AddTorrentResponse::ListOnly(res) => {
                let id_str = torrent::frontend_id_from_hash(&res.info_hash.0);
                let name = res
                    .info
                    .name
                    .as_ref()
                    .map(|n| n.to_string())
                    .unwrap_or_else(|| "Unknown".to_string());
                let files = res
                    .info
                    .iter_file_details()
                    .ok()
                    .map(|iter| {
                        iter.map(|info| DownloadFile {
                            name: info
                                .filename
                                .to_pathbuf()
                                .map(|p| p.to_string_lossy().into_owned())
                                .unwrap_or_default(),
                            size: info.len,
                            downloaded: 0,
                            progress: 0.0,
                            selected: true,
                        })
                        .collect::<Vec<DownloadFile>>()
                    })
                    .unwrap_or_default();
                let total = files.iter().map(|f| f.size).sum::<u64>();
                (id_str, name, files, total)
            }
        };

        let mut guard = mgr.write().await;
        if let Some(existing) = guard.downloads_mut().get_mut(&id_str) {
            existing.save_path = save_path;
            existing.game_id = game_id;
            existing.source_name = source_name;
            existing.auto_extract = Some(auto_extract.unwrap_or(false));
            existing.referer = referer.clone();
            if existing.files.is_empty() {
                existing.files = files;
            }
            let snapshot = existing.clone();
            guard.mark_dirty();
            guard.emit_progress_force();
            return Ok(snapshot);
        }
        let mut d = Download::new(
            id_str.clone(),
            DownloadKind::Torrent,
            name,
            trimmed,
            save_path,
            game_id,
            source_name,
            auto_extract.unwrap_or(false),
        );
        d.status = DownloadStatus::Paused;
        d.total_size = if total_size > 0 { Some(total_size) } else { None };
        d.files = files;
        d.referer = referer.clone();
        guard.downloads_mut().insert(id_str, d.clone());
        guard.mark_dirty();
        guard.emit_progress_force();
        return Ok(d);
    }

    // ── M1: duplicate-infohash fast-fail (magnets only; base32 /
    // .torrent URLs are caught authoritatively in the start task). ──
    if let Some(btih) = torrent::btih_from_magnet(&trimmed) {
        let candidate_id = torrent::frontend_id_from_btih_hex(&btih);
        let duplicate = {
            let guard = mgr.read().await;
            let by_real_id = candidate_id
                .as_deref()
                .and_then(|cid| guard.downloads_map().get(cid));
            let by_source = guard.downloads_map().values().find(|d| {
                torrent::btih_from_magnet(&d.source_uri).as_deref() == Some(btih.as_str())
            });
            by_real_id.or(by_source).cloned()
        };
        if let Some(existing) = duplicate {
            return handle_duplicate_add(
                &mgr,
                &existing,
                trimmed,
                save_path,
                game_id,
                source_name,
                auto_extract.unwrap_or(false),
                referer,
            )
            .await;
        }
    }

    // ── Normal add: create the record and queue-or-start. ──
    static TEMP_ID_CTR: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let ctr = TEMP_ID_CTR.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let id = format!("dl_pending_{}_{}", unix_now(), ctr);

    let mut d = Download::new(
        id.clone(),
        DownloadKind::Torrent,
        "Fetching metadata\u{2026}".to_string(),
        trimmed,
        save_path,
        game_id,
        source_name,
        auto_extract.unwrap_or(false),
    );
    d.referer = referer;
    {
        let mut guard = mgr.write().await;
        guard.downloads_mut().insert(id.clone(), d.clone());
        guard.mark_dirty();
        guard.emit_progress_force();
    }
    queue_or_start(&mgr, &id).await;

    let guard = mgr.read().await;
    Ok(guard.downloads_map().get(&id).cloned().unwrap_or(d))
}

#[tauri::command]
pub async fn direct_download_start(
    id: String,
    url: String,
    save_path: String,
    game_id: Option<String>,
    source_name: String,
    auto_extract: Option<bool>,
    uris: Option<Vec<String>>,
    referer: Option<String>,
    extra_headers: Option<Vec<(String, String)>>,
) -> Result<Download, String> {
    let mgr = wait_for_manager().await?;

    let filename = std::path::Path::new(&save_path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("direct_download")
        .to_string();

    let mut d = Download::new(
        id.clone(),
        DownloadKind::Direct,
        filename.clone(),
        url,
        save_path,
        game_id,
        source_name,
        auto_extract.unwrap_or(false),
    );
    d.files = vec![DownloadFile {
        name: filename,
        size: 0,
        downloaded: 0,
        progress: 0.0,
        selected: true,
    }];
    d.uris = uris.filter(|u| !u.is_empty());
    d.referer = referer;
    d.extra_headers = extra_headers;

    {
        let mut guard = mgr.write().await;
        guard.downloads_mut().insert(id.clone(), d.clone());
        guard.mark_dirty();
        guard.emit_progress_force();
    }
    queue_or_start(&mgr, &id).await;

    let guard = mgr.read().await;
    Ok(guard.downloads_map().get(&id).cloned().unwrap_or(d))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn debrid_download_start(
    id: String,
    magnet: String,
    save_path: String,
    game_id: Option<String>,
    source_name: String,
    provider: String,
    apikey: String,
    auto_extract: Option<bool>,
) -> Result<Download, String> {
    let mgr = wait_for_manager().await?;

    let mut d = Download::new(
        id.clone(),
        DownloadKind::Debrid,
        format!("Debrid: {}", id),
        magnet,
        save_path,
        game_id,
        format!("{} (Debrid)", source_name),
        auto_extract.unwrap_or(false),
    );
    d.status = DownloadStatus::Queued;

    {
        let mut guard = mgr.write().await;
        guard
            .debrid_params
            .insert(id.clone(), (provider, apikey));
        guard.downloads_mut().insert(id.clone(), d.clone());
        guard.mark_dirty();
        guard.emit_progress_force();
    }
    queue_or_start(&mgr, &id).await;

    let guard = mgr.read().await;
    Ok(guard.downloads_map().get(&id).cloned().unwrap_or(d))
}

// ─── Tauri commands: lifecycle ──────────────────────────────────────────────

#[tauri::command]
pub async fn torrent_pause(id: String) -> Result<(), String> {
    let mgr = wait_for_manager().await?;

    let session = {
        let mut guard = mgr.write().await;
        let session = guard.session().cloned();
        guard.remove_from_queue(&id);
        if let Some(d) = guard.downloads_mut().get_mut(&id) {
            d.status = DownloadStatus::Paused;
            d.download_speed = 0;
        }
        guard.release_active(&id);
        guard.mark_dirty();
        guard.emit_progress_force();
        session
    };

    if let Some(session) = session {
        if let Some(handle) = torrent::find_handle(&session, &id) {
            // M2: this can fail while the torrent is Initializing (file
            // re-check). The 1s tick sweep in refresh_stats keeps
            // retrying, so the pause lands within ~1s of the check
            // completing; Paused is now in keep_manager_status so the
            // record stays Paused throughout. Quiesces first so the
            // handle drain can't race an in-flight chunk write.
            torrent::pause_torrent(&session, &handle).await;
        }
    }

    manager::advance_queue(&mgr).await;
    Ok(())
}

#[tauri::command]
pub async fn torrent_resume(id: String) -> Result<(), String> {
    let mgr = wait_for_manager().await?;
    {
        let guard = mgr.read().await;
        let d = guard
            .downloads_map()
            .get(&id)
            .ok_or_else(|| format!("Download not found: {}", id))?;
        if d.status.is_active() {
            return Ok(());
        }
        if matches!(d.status, DownloadStatus::Completed | DownloadStatus::Seeding) {
            return Err("Download is already completed".to_string());
        }
    }
    preempt_and_start(&mgr, &id).await;
    Ok(())
}

#[tauri::command]
pub async fn torrent_remove(id: String, delete_files: Option<bool>) -> Result<(), String> {
    let mgr = wait_for_manager().await?;
    let delete_files = delete_files.unwrap_or(false);

    extract::kill_extraction(&id);

    let (session, download_opt) = {
        let mut guard = mgr.write().await;
        let session = guard.session().cloned();
        guard.remove_from_queue(&id);
        guard.debrid_params.remove(&id);
        guard.debrid_files.remove(&id);
        guard.direct_counters.remove(&id);
        guard.direct_generations.remove(&id);
        guard.direct_locks.remove(&id);
        guard.direct_reset_partial.remove(&id);
        let download_opt = guard.downloads_mut().remove(&id);
        guard.release_active(&id);
        guard.mark_dirty();
        guard.emit_progress_force();
        (session, download_opt)
    };

    let id_clone = id.clone();
    tokio::spawn(async move {
        if let Some(session) = session {
            if let Some(handle) = torrent::find_handle(&session, &id_clone) {
                // Quiesce first: `session.delete` pauses internally and
                // can race a download's in-flight writes ("file is None").
                torrent::delete_torrent(&session, &handle, delete_files).await;
            }
        }

        if delete_files {
            if let Some(download) = download_opt {
                let _ = tokio::task::spawn_blocking(move || {
                    delete_download_files(&download);
                })
                .await;
            }
        }
    });

    manager::advance_queue(&mgr).await;
    Ok(())
}

/// Best-effort deletion of a removed download's on-disk data.
fn delete_download_files(download: &Download) {
    let save_path_buf = std::path::PathBuf::from(&download.save_path);

    if download.kind == DownloadKind::Direct {
        // Direct downloads: save_path is the target FILE; also drop
        // the in-progress temp file.
        if save_path_buf.is_file() {
            let _ = std::fs::remove_file(&save_path_buf);
        }
        if let (Some(parent), Some(fname)) = (
            save_path_buf.parent(),
            save_path_buf.file_name().and_then(|s| s.to_str()),
        ) {
            let tmp = parent.join(format!("{}.gamelib_tmp", fname));
            if tmp.exists() {
                let _ = std::fs::remove_file(&tmp);
            }
        }
        return;
    }

    // Torrents and debrid downloads: `save_path` is the folder and each
    // `DownloadFile::name` is relative to it (librqbit writes directly
    // under `save_path` because we pass `output_folder` explicitly).
    // Delete every file at both the flat location and the legacy
    // `save_path/<name>` root-folder location, then prune empty dirs.
    let root_folder = save_path_buf.join(&download.name);
    for file in &download.files {
        let rel = std::path::Path::new(&file.name);
        // A torrent may exist in either layout (flat, or nested under
        // its root folder) — try both.
        let flat = save_path_buf.join(rel);
        if flat.exists() && flat.is_file() {
            let _ = std::fs::remove_file(&flat);
        }
        let nested = root_folder.join(rel);
        if nested.exists() && nested.is_file() {
            let _ = std::fs::remove_file(&nested);
        }
    }

    for root in [save_path_buf.clone(), root_folder.clone()] {
        let mut dirs_to_check = Vec::new();
        for file in &download.files {
            let file_path = root.join(std::path::Path::new(&file.name));
            let mut parent = file_path.parent();
            while let Some(p) = parent {
                if p.starts_with(&root) && p != root {
                    dirs_to_check.push(p.to_path_buf());
                    parent = p.parent();
                } else {
                    break;
                }
            }
        }
        dirs_to_check.sort_by(|a, b| b.components().count().cmp(&a.components().count()));
        dirs_to_check.dedup();
        for dir in dirs_to_check {
            if dir.exists() && dir.is_dir() {
                if let Ok(entries) = std::fs::read_dir(&dir) {
                    if entries.count() == 0 {
                        let _ = std::fs::remove_dir(&dir);
                    }
                }
            }
        }
    }

    // Remove the now-empty folders themselves, deepest first: the legacy
    // `save_path/<name>` root, then the download folder `save_path`.
    // Guarded by `is_dir()` + emptiness so a shared download folder is
    // never removed while it still holds other downloads.
    for folder in [&root_folder, &save_path_buf] {
        if folder.is_dir() {
            if let Ok(entries) = std::fs::read_dir(folder) {
                if entries.count() == 0 {
                    let _ = std::fs::remove_dir(folder);
                }
            }
        }
    }
}

#[tauri::command]
pub async fn torrent_get_all() -> Result<Vec<Download>, String> {
    let mgr = wait_for_manager().await?;
    let guard = mgr.read().await;
    Ok(guard.list())
}

#[tauri::command]
pub async fn torrent_select_save_path(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let path = tokio::task::spawn_blocking(move || app.dialog().file().blocking_pick_folder())
        .await
        .map_err(|e| format!("Folder picker task failed: {}", e))?;
    Ok(path.map(|p| p.to_string()))
}

#[tauri::command]
pub async fn torrent_pause_all() -> Result<usize, String> {
    let mgr = wait_for_manager().await?;

    let (session, to_pause_in_session, affected) = {
        let mut guard = mgr.write().await;
        let session = guard.session().cloned();
        let mut affected = 0usize;
        let mut in_session = Vec::new();
        let ids: Vec<String> = guard.downloads_map().keys().cloned().collect();
        for id in ids {
            if let Some(d) = guard.downloads_mut().get_mut(&id) {
                if matches!(
                    d.status,
                    DownloadStatus::Downloading
                        | DownloadStatus::FetchingMetadata
                        | DownloadStatus::Queued
                ) {
                    d.status = DownloadStatus::Paused;
                    d.download_speed = 0;
                    affected += 1;
                    if d.kind == DownloadKind::Torrent {
                        in_session.push(id.clone());
                    }
                }
            }
            guard.remove_from_queue(&id);
            guard.release_active(&id);
        }
        guard.mark_dirty();
        guard.emit_progress_force();
        (session, in_session, affected)
    };

    if let Some(session) = session {
        for id in to_pause_in_session {
            if let Some(handle) = torrent::find_handle(&session, &id) {
                torrent::pause_torrent(&session, &handle).await;
            }
        }
    }

    Ok(affected)
}

#[tauri::command]
pub async fn torrent_resume_all() -> Result<usize, String> {
    let mgr = wait_for_manager().await?;

    let affected = {
        let mut guard = mgr.write().await;
        let mut paused: Vec<(u64, String)> = guard
            .downloads_map()
            .values()
            .filter(|d| matches!(d.status, DownloadStatus::Paused))
            .map(|d| (d.added_at, d.id.clone()))
            .collect();
        paused.sort();
        let count = paused.len();
        for (_, id) in paused {
            guard.enqueue_back(&id);
        }
        guard.mark_dirty();
        guard.emit_progress_force();
        count
    };

    manager::advance_queue(&mgr).await;
    Ok(affected)
}

#[tauri::command]
pub async fn torrent_set_speed_limits(
    download_limit_kbps: Option<u32>,
    upload_limit_kbps: Option<u32>,
    disable_upload: bool,
) -> Result<(), String> {
    let mgr = wait_for_manager().await?;
    let session = {
        let guard = mgr.read().await;
        guard
            .session()
            .cloned()
            .ok_or_else(|| "Download engine not initialized".to_string())?
    };

    let download_bps = download_limit_kbps
        .filter(|&v| v > 0)
        .and_then(|v| std::num::NonZeroU32::new(v * 1024));

    let upload_bps = if disable_upload {
        std::num::NonZeroU32::new(1) // effectively disabled
    } else {
        upload_limit_kbps
            .filter(|&v| v > 0)
            .and_then(|v| std::num::NonZeroU32::new(v * 1024))
    };

    session.ratelimits.set_download_bps(download_bps);
    session.ratelimits.set_upload_bps(upload_bps);

    // Apply the same download cap to direct HTTP downloads.
    http::set_direct_speed_limit(
        download_bps.map(|v| v.get() as u64).unwrap_or(0),
    );

    Ok(())
}

#[tauri::command]
pub async fn torrent_update_only_files(
    id: String,
    only_files: Vec<usize>,
) -> Result<(), String> {
    let mgr = wait_for_manager().await?;
    let session = {
        let guard = mgr.read().await;
        guard.session().cloned()
    };

    if let Some(session) = &session {
        if let Some(handle) = torrent::find_handle(session, &id) {
            let only_files_set: std::collections::HashSet<usize> =
                only_files.iter().copied().collect();
            session
                .update_only_files(&handle, &only_files_set)
                .await
                .map_err(|e| format!("Failed to update files: {}", e))?;
        }
    }

    let mut guard = mgr.write().await;
    if let Some(d) = guard.downloads_mut().get_mut(&id) {
        d.only_files = Some(only_files.clone());
        for (i, f) in d.files.iter_mut().enumerate() {
            f.selected = only_files.contains(&i);
        }
        let selected_sum: u64 = d.files.iter().filter(|f| f.selected).map(|f| f.size).sum();
        if selected_sum > 0 {
            d.total_size = Some(selected_sum);
        }
    }
    guard.mark_dirty();
    guard.emit_progress_force();
    Ok(())
}

/// Update per-file selection for a debrid download. Unlike torrents, the
/// selection filters the resolved debrid file list on the next start/resume.
/// If the download is actively transferring it is paused first so the new
/// selection applies cleanly (the worker is restarted on the next resume).
#[tauri::command]
pub async fn debrid_update_only_files(
    id: String,
    only_files: Vec<usize>,
) -> Result<(), String> {
    let mgr = wait_for_manager().await?;
    let was_active = {
        let mut guard = mgr.write().await;
        let Some(d) = guard.downloads_mut().get_mut(&id) else {
            return Err(format!("Download not found: {id}"));
        };
        if d.kind != DownloadKind::Debrid {
            return Err(
                "Only debrid downloads support this file-selection command".to_string(),
            );
        }
        for &i in &only_files {
            if i >= d.files.len() {
                return Err(format!("Invalid file index {i}"));
            }
        }
        let was_active = d.status.is_active();
        d.only_files = Some(only_files.clone());
        for (i, f) in d.files.iter_mut().enumerate() {
            f.selected = only_files.contains(&i);
        }
        let selected_sum: u64 = d.files.iter().filter(|f| f.selected).map(|f| f.size).sum();
        if selected_sum > 0 {
            d.total_size = Some(selected_sum);
        }
        if was_active {
            d.status = DownloadStatus::Paused;
            d.download_speed = 0;
            guard.remove_from_queue(&id);
            guard.release_active(&id);
        }
        guard.mark_dirty();
        guard.emit_progress_force();
        was_active
    };
    if was_active {
        manager::advance_queue(&mgr).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn torrent_start_selected(
    id: String,
    only_files: Vec<usize>,
    auto_extract: bool,
) -> Result<(), String> {
    let mgr = wait_for_manager().await?;

    {
        let mut guard = mgr.write().await;
        let d = guard
            .downloads_mut()
            .get_mut(&id)
            .ok_or_else(|| format!("Download not found: {}", id))?;
        if d.save_path.trim().is_empty() {
            d.status = DownloadStatus::Error(
                "Save folder missing — please remove and re-add this download \
                 with a folder selected."
                    .to_string(),
            );
            guard.mark_dirty();
            guard.emit_progress_force();
            return Err("Download has no save folder.".to_string());
        }
        d.only_files = Some(only_files);
        d.auto_extract = Some(auto_extract);
        d.added_at = unix_now();
        for (i, f) in d.files.iter_mut().enumerate() {
            let selected = d
                .only_files
                .as_ref()
                .map(|of| of.contains(&i))
                .unwrap_or(true);
            f.selected = selected;
        }
        let selected_sum: u64 = d.files.iter().filter(|f| f.selected).map(|f| f.size).sum();
        if selected_sum > 0 {
            d.total_size = Some(selected_sum);
        }
        guard.mark_dirty();
    }

    queue_or_start(&mgr, &id).await;
    Ok(())
}

#[tauri::command]
pub async fn torrent_open_folder(app: AppHandle, id: String) -> Result<(), String> {
    let mgr = wait_for_manager().await?;
    let path_str = {
        let guard = mgr.read().await;
        let d = guard
            .downloads_map()
            .get(&id)
            .ok_or_else(|| format!("Download not found: {}", id))?;
        d.save_path.clone()
    };

    let path = std::path::Path::new(&path_str);
    let target_path = if path.is_file() {
        path.parent().unwrap_or(path)
    } else {
        path
    };

    if !target_path.exists() {
        return Err("Download folder does not exist yet".to_string());
    }

    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(target_path.to_string_lossy().as_ref(), None::<&str>)
        .map_err(|e| format!("Failed to open folder: {}", e))
}

// ─── Tauri commands: queue & seeding ────────────────────────────────────────

#[tauri::command]
pub async fn download_queue_reorder(ids: Vec<String>) -> Result<(), String> {
    let mgr = wait_for_manager().await?;
    let mut guard = mgr.write().await;
    guard.reorder_queue(&ids);
    guard.emit_progress_force();
    Ok(())
}

/// Push the "seed after download complete" preference from the frontend.
#[tauri::command]
pub async fn download_set_seed_config(seed_after_complete: bool) -> Result<(), String> {
    let mgr = wait_for_manager().await?;
    let mut guard = mgr.write().await;
    guard.seed_after_complete = seed_after_complete;
    Ok(())
}

/// Start or stop seeding a completed torrent.
#[tauri::command]
pub async fn download_set_seeding(id: String, seed: bool) -> Result<(), String> {
    let mgr = wait_for_manager().await?;

    if !seed {
        // Stop seeding: drop the session entry, mark Completed.
        let session = {
            let mut guard = mgr.write().await;
            let session = guard.session().cloned();
            if let Some(d) = guard.downloads_mut().get_mut(&id) {
                if !matches!(d.status, DownloadStatus::Seeding) {
                    return Ok(());
                }
                d.status = DownloadStatus::Completed;
                d.should_seed = Some(false);
                d.upload_speed = 0;
            }
            guard.mark_dirty();
            guard.emit_progress_force();
            session
        };
        if let Some(session) = session {
            torrent::delete_from_session(&session, &id).await;
        }
        return Ok(());
    }

    // Start seeding a completed torrent.
    let (session, source_uri, save_path, only_files, referer) = {
        let mut guard = mgr.write().await;
        let session = guard
            .session()
            .cloned()
            .ok_or_else(|| "Download engine not initialized".to_string())?;
        let d = guard
            .downloads_mut()
            .get_mut(&id)
            .ok_or_else(|| format!("Download not found: {}", id))?;
        if d.kind != DownloadKind::Torrent {
            return Err("Only torrents can seed".to_string());
        }
        if !matches!(d.status, DownloadStatus::Completed) {
            return Err("Only completed torrents can start seeding".to_string());
        }
        if d.source_uri.is_empty() {
            return Err("This download has no source URI".to_string());
        }
        d.status = DownloadStatus::Seeding;
        d.should_seed = Some(true);
        let tuple = (
            session,
            d.source_uri.clone(),
            d.save_path.clone(),
            d.only_files.clone(),
            d.referer.clone(),
        );
        guard.mark_dirty();
        guard.emit_progress_force();
        tuple
    };

    let mgr_clone = mgr.clone();
    let id_clone = id.clone();
    tokio::spawn(async move {
        match torrent::add_and_start(
            &session,
            &source_uri,
            &save_path,
            only_files.as_deref(),
            referer.as_deref(),
        )
        .await
        {
            Ok(torrent::AddOutcome::Added { .. }) => {
                println!("[downloads] Seeding started for {}", id_clone)
            }
            Ok(torrent::AddOutcome::AlreadyManaged { .. }) => {
                println!(
                    "[downloads] {} already in session; keeping it as-is",
                    id_clone
                )
            }
            Err(e) => {
                eprintln!("[downloads] Failed to start seeding: {}", e);
                let mut guard = mgr_clone.write().await;
                if let Some(d) = guard.downloads_mut().get_mut(&id_clone) {
                    d.status = DownloadStatus::Completed;
                    d.should_seed = Some(false);
                }
                guard.mark_dirty();
                guard.emit_progress_force();
            }
        }
    });

    Ok(())
}

// ─── Tauri commands: direct/debrid utilities ────────────────────────────────

#[tauri::command]
pub async fn direct_download_update_url(id: String, new_url: String) -> Result<(), String> {
    let mgr = wait_for_manager().await?;

    let was_running = {
        let mut guard = mgr.write().await;
        let d = guard
            .downloads_mut()
            .get_mut(&id)
            .ok_or_else(|| "Download not found".to_string())?;
        let was_running = matches!(
            d.status,
            DownloadStatus::Downloading | DownloadStatus::Error(_)
        );
        // URL changed while a partial may exist: the next worker must
        // drop the stale `.gamelib_tmp` before streaming (the old
        // worker's bytes belong to the old URL).
        let url_changed = d.source_uri != new_url;
        d.source_uri = new_url.clone();
        // Pausing gives the running worker an immediate abort signal;
        // ordering safety comes from the per-download worker lock, so
        // no sleep is needed here.
        if matches!(d.status, DownloadStatus::Downloading) {
            d.status = DownloadStatus::Paused;
        }
        guard.mark_dirty();
        guard.emit_progress_force();
        if url_changed {
            guard.direct_reset_partial.insert(id.clone());
        }
        was_running
    };

    if was_running {
        preempt_and_start(&mgr, &id).await;
    }

    Ok(())
}

#[tauri::command]
pub async fn test_debrid_key(
    provider: String,
    apikey: String,
) -> Result<debrid::DebridUserInfo, String> {
    if provider == "alldebrid" {
        debrid::AllDebridClient::test_key(&apikey).await
    } else if provider == "realdebrid" {
        debrid::RealDebridClient::test_key(&apikey).await
    } else if provider == "torbox" {
        debrid::TorBoxClient::test_key(&apikey).await
    } else {
        Err("Unsupported debrid provider".to_string())
    }
}

#[tauri::command]
pub async fn debrid_check_cache(
    provider: String,
    apikey: String,
    magnet: String,
) -> Result<debrid::DebridCacheResult, String> {
    if provider == "alldebrid" {
        debrid::AllDebridClient::check_cache(&apikey, &magnet).await
    } else {
        Err("Cache check is only supported for AllDebrid".to_string())
    }
}

#[tauri::command]
pub async fn debrid_unrestrict_link(
    provider: String,
    apikey: String,
    url: String,
) -> Result<String, String> {
    if provider == "alldebrid" {
        debrid::AllDebridClient::unrestrict_link(&apikey, &url).await
    } else if provider == "realdebrid" {
        debrid::RealDebridClient::unrestrict_link(&apikey, &url).await
    } else if provider == "torbox" {
        debrid::TorBoxClient::unrestrict_link(&apikey, &url).await
    } else {
        Err("Unsupported provider".to_string())
    }
}

