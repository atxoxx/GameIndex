//! Download manager: every download runs concurrently (no queue, no
//! single active slot). Torrents run on librqbit; direct/debrid
//! downloads run on the HTTP worker in `http.rs`. All records live in
//! one map and are emitted together on the `download-progress` event
//! every second.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::AtomicU64;
use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter};
use tokio::sync::RwLock;

use crate::db::pool::Db;

use super::extract;
use super::http;
use super::persistence;
use super::torrent;
use super::types::{
    gate_completion, unix_now, Download, DownloadKind, DownloadStatus,
};

/// How long a torrent may sit in FetchingMetadata without any real
/// transfer before we surface an error. Must exceed the add-task retry
/// budget (torrent::add_and_start: 3 × 90 s + 15 s + 30 s ≈ 315 s) so
/// the watchdog never kills a still-retrying add; it only fires when
/// the add task itself gave up (or died) without failing the record.
const METADATA_FETCH_TIMEOUT_SECS: u64 = 360;

/// Consecutive poll failures tolerated before failing a debrid download.
/// AllDebrid's API rate-limits at 12 req/s (429/503) and servers blip —
/// a permanent failure is only declared after sustained errors (~5 min).
const MAX_DEBRID_POLL_FAILURES: u32 = 8;

pub type SharedManager = Arc<RwLock<DownloadManager>>;
pub type WeakManager = std::sync::Weak<RwLock<DownloadManager>>;

pub struct DownloadManager {
    session: Option<Arc<librqbit::Session>>,
    downloads: HashMap<String, Download>,
    state_dir: PathBuf,
    app: Option<AppHandle>,
    dirty: bool,
    last_emitted_hash: u64,
    /// Live byte counters for direct downloads (shared with workers).
    pub direct_counters: HashMap<String, Arc<AtomicU64>>,
    direct_last_calc: HashMap<String, (u64, std::time::Instant)>,
    /// "Seed after download complete" user preference (pushed from the
    /// frontend at startup and on toggle).
    pub seed_after_complete: bool,
    /// Default active debrid provider (e.g. "alldebrid") synced from settings.
    pub default_debrid_provider: Option<String>,
    /// Default active debrid API key synced from settings.
    pub default_debrid_apikey: Option<String>,
    /// In-memory debrid credentials per download id (never persisted).
    pub debrid_params: HashMap<String, (String, String)>,
    /// Resolved multi-file debrid entries (name, size, direct_url, orig_url) per download
    /// id. Kept so a pause → resume of an already-resolved debrid
    /// download re-runs the multi-file worker instead of treating the
    /// folder as a single file.
    pub debrid_files: HashMap<String, Vec<(String, u64, String, String)>>,
    /// Monotonic worker generation per download id; bumped on every
    /// worker spawn. A worker whose captured generation is stale must
    /// stop immediately (superseded by a newer worker).
    pub direct_generations: HashMap<String, u64>,
    /// Per-download worker lifetime lock (C1 single-writer invariant).
    pub direct_locks: HashMap<String, Arc<tokio::sync::Mutex<()>>>,
    /// Download ids whose URL changed while a partial existed; the next
    /// worker drops the stale `.gamelib_tmp` before streaming.
    pub direct_reset_partial: std::collections::HashSet<String>,
    /// Optional `download_history` ledger DB. When set, completions and
    /// removals are recorded so download-page statistics survive
    /// deletion of the live record.
    history_db: Option<Db>,
}

impl DownloadManager {
    pub fn new(state_dir: PathBuf) -> Self {
        Self {
            session: None,
            downloads: HashMap::new(),
            state_dir,
            app: None,
            dirty: false,
            last_emitted_hash: 0,
            direct_counters: HashMap::new(),
            direct_last_calc: HashMap::new(),
            seed_after_complete: false,
            default_debrid_provider: None,
            default_debrid_apikey: None,
            debrid_params: HashMap::new(),
            debrid_files: HashMap::new(),
            direct_generations: HashMap::new(),
            direct_locks: HashMap::new(),
            direct_reset_partial: std::collections::HashSet::new(),
            history_db: None,
        }
    }

    pub fn set_app(&mut self, app: AppHandle) {
        self.app = Some(app);
    }

    /// Attach the `download_history` ledger DB. Completions and removals
    /// are recorded from then on (best-effort, never fatal).
    pub fn set_history_db(&mut self, db: Db) {
        self.history_db = Some(db);
    }

    /// Best-effort write of `d` into the download-history ledger.
    /// Failures are logged but never panic and never fail the tick.
    pub fn record_history(&self, d: &Download) {
        let Some(db) = &self.history_db else {
            return;
        };
        if let Err(e) = crate::db::download_history::upsert(db, d) {
            eprintln!(
                "[downloads] Failed to record download history for {}: {}",
                d.id, e
            );
        }
    }

    pub fn session(&self) -> Option<&Arc<librqbit::Session>> {
        self.session.as_ref()
    }

    pub fn downloads_map(&self) -> &HashMap<String, Download> {
        &self.downloads
    }

    pub fn downloads_mut(&mut self) -> &mut HashMap<String, Download> {
        &mut self.downloads
    }

    // ── Persistence / emission ─────────────────────────────────────────

    pub fn mark_dirty(&mut self) {
        self.dirty = true;
    }

    pub fn flush_if_dirty(&mut self) {
        if self.dirty {
            persistence::save(&self.state_dir, &self.downloads);
            self.dirty = false;
        }
    }

    /// Snapshot for the frontend: completed records at the bottom,
    /// everything else newest-first.
    pub fn list(&self) -> Vec<Download> {
        let mut all: Vec<Download> = self.downloads.values().cloned().collect();
        all.sort_by(|a, b| {
            let a_done = matches!(a.status, DownloadStatus::Completed);
            let b_done = matches!(b.status, DownloadStatus::Completed);
            match (a_done, b_done) {
                (true, true) | (false, false) => b.added_at.cmp(&a.added_at),
                (true, false) => std::cmp::Ordering::Greater,
                (false, true) => std::cmp::Ordering::Less,
            }
        });
        all
    }

    pub fn emit_progress(&mut self) {
        if let Some(app) = &self.app {
            let snapshot = self.list();
            let hash = hash_snapshot(&snapshot);
            if hash != self.last_emitted_hash {
                self.last_emitted_hash = hash;
                let _ = app.emit("download-progress", &snapshot);
            }
        }
    }

    pub fn emit_progress_force(&mut self) {
        if let Some(app) = &self.app {
            let snapshot = self.list();
            // Deliberately do NOT update `last_emitted_hash` here: the
            // 1 s tick re-emits this snapshot once more, so a single
            // dropped event (e.g. the `extracted` flip) cannot leave
            // the frontend stuck on stale state forever.
            let _ = app.emit("download-progress", &snapshot);
        }
    }

    /// Swap a record's id (torrent placeholder → real infohash id),
    /// carrying the direct-download bookkeeping along.
    pub fn rekey(&mut self, old_id: &str, new_id: &str) {
        if old_id == new_id {
            return;
        }
        if let Some(mut d) = self.downloads.remove(old_id) {
            d.id = new_id.to_string();
            self.downloads.insert(new_id.to_string(), d);
        }
        if let Some(c) = self.direct_counters.remove(old_id) {
            self.direct_counters.insert(new_id.to_string(), c);
        }
        if let Some(p) = self.debrid_params.remove(old_id) {
            self.debrid_params.insert(new_id.to_string(), p);
        }
        if let Some(g) = self.direct_generations.remove(old_id) {
            self.direct_generations.insert(new_id.to_string(), g);
        }
        if let Some(l) = self.direct_locks.remove(old_id) {
            self.direct_locks.insert(new_id.to_string(), l);
        }
        if self.direct_reset_partial.remove(old_id) {
            self.direct_reset_partial.insert(new_id.to_string());
        }
        self.mark_dirty();
    }

    // ── Initialisation ─────────────────────────────────────────────────

    /// Open the librqbit session, load persisted state and reconcile
    /// with whatever librqbit restored from its own session state.
    pub async fn initialize(&mut self) -> Result<(), String> {
        if self.session.is_some() {
            return Ok(());
        }
        let session = torrent::init_session(&self.state_dir).await?;
        self.session = Some(session.clone());

        let loaded = persistence::load(&self.state_dir);
        self.downloads = loaded.downloads;

        // Reconcile the librqbit-restored torrents:
        //  * seeding records keep their session entry alive,
        //  * completed ones are deleted from the session (releases
        //    file locks),
        //  * everything else is paused here; in-progress records are
        //    resumed afterwards by `resume_in_progress`.
        struct Restored {
            fid: String,
            handle: Arc<librqbit::ManagedTorrent>,
            name: Option<String>,
        }
        let restored: Vec<Restored> = session.with_torrents(|iter| {
            iter.map(|(_id, mt)| Restored {
                fid: torrent::frontend_id_from_hash(&mt.shared().info_hash.0),
                handle: Arc::clone(mt),
                name: mt.name(),
            })
            .collect()
        });

        for r in restored {
            let record_status = self.downloads.get(&r.fid).map(|d| d.status.clone());
            match record_status {
                Some(DownloadStatus::Seeding) => {
                    // Leave running — librqbit seeds completed torrents.
                    let _ = session.unpause(&r.handle).await;
                }
                Some(DownloadStatus::Completed) => {
                    let stats = r.handle.stats();
                    if stats.progress_bytes > 0 {
                        torrent::delete_torrent_keep_files(&session, &r.handle).await;
                    }
                }
                Some(_) => {
                    // Quiesce-then-pause: a restored torrent may already
                    // be transferring, and a bare pause() can race an
                    // in-flight chunk write ("file is None").
                    torrent::pause_torrent(&session, &r.handle).await;
                }
                None => {
                    // Torrent in the session without a record —
                    // register it paused so the user can see it.
                    torrent::pause_torrent(&session, &r.handle).await;
                    let name = r.name.unwrap_or_else(|| "Restored".to_string());
                    let mut d = Download::new(
                        r.fid.clone(),
                        DownloadKind::Torrent,
                        name,
                        String::new(),
                        String::new(),
                        None,
                        "Discovered".to_string(),
                        false,
                    );
                    d.status = DownloadStatus::Paused;
                    self.downloads.insert(r.fid.clone(), d);
                }
            }
        }

        // Rebuild resolved debrid file lists from the persisted record so a
        // paused (or interrupted) debrid download resumes from where it left
        // off across restarts: the per-file download URLs survive in `uris`
        // and the names/sizes in `files`.
        for d in self.downloads.values() {
            if d.kind != DownloadKind::Debrid || self.debrid_files.contains_key(&d.id) {
                continue;
            }
            let Some(uris) = d.uris.as_ref() else {
                continue;
            };
            if d.files.len() != uris.len() || d.files.is_empty() {
                continue;
            }
            let rebuilt: Vec<(String, u64, String, String)> = d
                .files
                .iter()
                .enumerate()
                .filter_map(|(i, f)| uris.get(i).map(|u| (f.name.clone(), f.size, u.clone(), u.clone())))
                .collect();
            if !rebuilt.is_empty() {
                self.debrid_files.insert(d.id.clone(), rebuilt);
            }
        }

        self.mark_dirty();
        Ok(())
    }

    // ── Stats refresh (1 s tick) ───────────────────────────────────────

    /// Poll librqbit + the direct counters, update every record, and
    /// detect completions.
    pub async fn refresh_stats(&mut self) {

        // ---- Torrents ----
        if let Some(session) = self.session.clone() {
            struct StatsEntry {
                fid: String,
                downloaded: u64,
                total: Option<u64>,
                progress: Option<f32>,
                status: DownloadStatus,
                name: Option<String>,
                download_speed: u64,
                upload_speed: u64,
                seeds: u32,
                peers: u32,
                files: Option<Vec<super::types::DownloadFile>>,
                handle: Arc<librqbit::ManagedTorrent>,
            }
            let collected: Vec<StatsEntry> = session.with_torrents(|iter| {
                let mut entries = Vec::new();
                for (_id, mt) in iter {
                    let stats = mt.stats();
                    let total = stats.total_bytes;
                    let downloaded = stats.progress_bytes;
                    let (download_speed, upload_speed, seeds, peers) =
                        torrent::extract_live_stats(&stats);
                    entries.push(StatsEntry {
                        fid: torrent::frontend_id_from_hash(&mt.shared().info_hash.0),
                        downloaded,
                        total: if total > 0 { Some(total) } else { None },
                        progress: if total > 0 {
                            Some(downloaded as f32 / total as f32)
                        } else {
                            None
                        },
                        status: torrent::map_state_to_status(
                            &stats.state,
                            total,
                            downloaded,
                            stats.error.as_deref(),
                        ),
                        name: mt.name(),
                        download_speed,
                        upload_speed,
                        seeds,
                        peers,
                        files: torrent::files_from_handle(mt, &stats),
                        handle: Arc::clone(mt),
                    });
                }
                entries
            });

            let mut to_extract: Vec<(String, String, String, Vec<super::types::DownloadFile>)> =
                Vec::new();
            let mut to_delete: Vec<Arc<librqbit::ManagedTorrent>> = Vec::new();
            let mut to_record: Vec<Download> = Vec::new();
            let mut save_needed = false;
            let mut pause_sweep: Vec<Arc<librqbit::ManagedTorrent>> = Vec::new();

            for entry in collected {
                let Some(d) = self.downloads.get_mut(&entry.fid) else {
                    continue;
                };
                let was_done = matches!(
                    d.status,
                    DownloadStatus::Completed | DownloadStatus::Seeding
                );

                d.downloaded = entry.downloaded;
                d.total_size = entry.total.or(d.total_size);
                d.progress = entry.progress.or(d.progress);
                d.download_speed = entry.download_speed;
                d.peak_speed = Some(d.peak_speed.unwrap_or(0).max(entry.download_speed));
                d.upload_speed = entry.upload_speed;
                d.seeds = entry.seeds;
                d.peers = entry.peers;

                // Activity gate: only live speed is trustworthy —
                // librqbit can fake `progress == total` right after
                // metadata arrives (see `gate_completion`).
                if entry.download_speed > 0 || entry.upload_speed > 0 {
                    d.had_real_downloads = Some(true);
                }

                // Status reconciliation. States the MANAGER owns
                // (Queued / Seeding / user-facing Error) are not
                // overwritten by librqbit's view.
                let keep_manager_status = matches!(
                    d.status,
                    DownloadStatus::Queued | DownloadStatus::Seeding | DownloadStatus::Paused
                ) || (matches!(d.status, DownloadStatus::Error(_))
                    && !matches!(entry.status, DownloadStatus::Error(_)));
                let was_active = d.status.is_active();
                if !keep_manager_status {
                    d.status = gate_completion(entry.status.clone(), d.had_real_downloads);
                }

                // Auto-heal the librqbit pause/write race: "file is
                // None" means a chunk write hit a handle that pause()/
                // delete() drained (upstream `FsFileIsNone`). If we
                // still want this torrent running, unpause it —
                // librqbit re-checks the files, re-opens them and goes
                // Live again, so the download continues instead of
                // dead-erroring. Only for this specific signature, so
                // real failures (disk full, permissions) still surface.
                if was_active {
                    if let DownloadStatus::Error(msg) = &entry.status {
                        if msg.contains("file is None") {
                            println!(
                                "[downloads] healing torrent after pause/write race (file is None)"
                            );
                            // Bounded: unpause must never stall the tick.
                            let session_clone = session.clone();
                            let handle = entry.handle.clone();
                            let fut = async move { session_clone.unpause(&handle).await };
                            let _ = torrent::run_session_op_bounded(
                                "torrent heal unpause",
                                fut,
                                Duration::from_secs(torrent::SESSION_OP_TIMEOUT_SECS),
                            )
                            .await;
                        }
                    }
                }

                // M2: enforce Paused/Queued intent against the session.
                // 9.x allows pausing mid-check (`Initializing { paused }`
                // maps to Paused), so this sweep is a safety net for the
                // window before the pause lands.
                // Completed is excluded so the sweep can never flip a
                // Completed record to Paused; Seeding/Error entries are
                // excluded by design.
                if matches!(d.status, DownloadStatus::Paused | DownloadStatus::Queued)
                    && matches!(
                        entry.status,
                        DownloadStatus::FetchingMetadata | DownloadStatus::Downloading
                    )
                {
                    pause_sweep.push(entry.handle.clone());
                }

                // Metadata watchdog for the active torrent. Fires only
                // after the add task's own retry budget (see
                // `torrent::add_and_start`) is exhausted and the record
                // still hasn't errored on its own.
                if matches!(d.status, DownloadStatus::FetchingMetadata)
                    && d.kind == DownloadKind::Torrent
                    && d.had_real_downloads != Some(true)
                    && unix_now().saturating_sub(d.added_at) > METADATA_FETCH_TIMEOUT_SECS
                {
                    d.status = DownloadStatus::Error(
                        "Timed out fetching metadata — no peers responded after \
                         several attempts. Check your firewall, wait a minute and \
                         try again (the DHT routing table keeps warming up), or \
                         try a different source."
                            .to_string(),
                    );
                }

                if let Some(files) = entry.files {
                    d.files = files;
                }
                if d.name.is_empty() || d.name == "Fetching metadata\u{2026}" {
                    if let Some(n) = entry.name {
                        d.name = n;
                        save_needed = true;
                    }
                }

                // ---- Completion transition ----
                let now_completed = matches!(d.status, DownloadStatus::Completed);
                let actually_downloaded = d.downloaded > 0;
                if !was_done && now_completed && actually_downloaded {
                    save_needed = true;
                    d.completed_at = Some(unix_now());
                    let auto_extract = d.auto_extract.unwrap_or(false);
                    let wants_seed = self.seed_after_complete && !auto_extract;
                    if wants_seed {
                        // Keep the session entry alive and uploading.
                        d.status = DownloadStatus::Seeding;
                        d.should_seed = Some(true);
                    } else {
                        d.should_seed = Some(false);
                        // Delete from the session to release file locks.
                        to_delete.push(entry.handle.clone());
                        if auto_extract && !d.extracted.unwrap_or(false) {
                            d.extracted = Some(true);
                            to_extract.push((
                                d.id.clone(),
                                d.save_path.clone(),
                                d.name.clone(),
                                d.files.clone(),
                            ));
                        }
                    }
                    // Record AFTER the wants_seed branch so the ledger
                    // status is the final one (Completed or Seeding).
                    to_record.push(d.clone());
                }

            }

            for handle in pause_sweep {
                // Run off the tick: the quiesce wait (up to 2 s) must
                // not stall the 1 s status loop. Expected pause errors
                // ("initializing", "already paused") are handled inside.
                let session_clone = session.clone();
                tokio::spawn(async move {
                    torrent::pause_torrent(&session_clone, &handle).await;
                });
            }

            if save_needed {
                self.mark_dirty();
            }

            for (id, save_path, name, files) in to_extract {
                spawn_extraction(id, save_path, name, files);
            }
            for handle in to_delete {
                let session_clone = session.clone();
                tokio::spawn(async move {
                    println!(
                        "[downloads] Torrent completed. Deleting from librqbit \
                         session to release file locks."
                    );
                    torrent::delete_torrent_keep_files(&session_clone, &handle).await;
                });
            }
            for d in &to_record {
                self.record_history(d);
            }

            // Orphan sweep: a timed-out `add_torrent` can still resolve
            // internally AFTER the timeout dropped our future, leaving a
            // Live session entry with no owning record — an invisible
            // download that writes files the UI never reports. Delete any
            // session torrent whose infohash has no record AND no
            // in-flight add (a FetchingMetadata record whose source magnet
            // carries the same infohash).
            {
                let orphans: Vec<Arc<librqbit::ManagedTorrent>> =
                    session.with_torrents(|iter| {
                        let mut orphans = Vec::new();
                        for (_id, mt) in iter {
                            let fid =
                                torrent::frontend_id_from_hash(&mt.shared().info_hash.0);
                            if self.downloads.contains_key(&fid) {
                                continue;
                            }
                            let in_flight = self.downloads.values().any(|d| {
                                matches!(d.status, DownloadStatus::FetchingMetadata)
                                    && torrent::btih_from_magnet(&d.source_uri)
                                        .and_then(|h| {
                                            torrent::frontend_id_from_btih_hex(&h)
                                        })
                                        .as_deref()
                                        == Some(fid.as_str())
                            });
                            if !in_flight {
                                orphans.push(Arc::clone(mt));
                            }
                        }
                        orphans
                    });
                for handle in orphans {
                    println!(
                        "[downloads] Removing orphan session torrent (no owning record)"
                    );
                    // Off the tick: the delete drains file handles and can
                    // block on a stuck disk write; it must never stall the
                    // 1 s status loop (which holds the manager write lock).
                    let session_clone = session.clone();
                    tokio::spawn(async move {
                        torrent::delete_torrent_keep_files(&session_clone, &handle).await;
                    });
                }
            }
        }

        // ---- Direct downloads: speed from the shared byte counters ----
        let mut direct_save_needed = false;
        let ids: Vec<String> = self.downloads.keys().cloned().collect();
        for id in ids {
            let Some(kind) = self.downloads.get(&id).map(|d| d.kind) else {
                continue;
            };
            if kind == DownloadKind::Torrent {
                continue;
            }
            let mut speed = 0;
            let mut current_bytes = 0;
            if let Some(counter) = self.direct_counters.get(&id) {
                current_bytes = counter.load(std::sync::atomic::Ordering::SeqCst);
                let now = std::time::Instant::now();
                if let Some((last_bytes, last_instant)) = self.direct_last_calc.get(&id) {
                    let elapsed = now.duration_since(*last_instant).as_secs_f64();
                    let bytes_diff = current_bytes.saturating_sub(*last_bytes);
                    let raw_speed = if elapsed > 0.0 {
                        (bytes_diff as f64 / elapsed) as u64
                    } else {
                        0
                    };
                    let prev_speed = self.downloads.get(&id).map(|d| d.download_speed).unwrap_or(0);
                    speed = if prev_speed == 0 || raw_speed == 0 {
                        raw_speed
                    } else {
                        ((raw_speed as f64 * 0.7) + (prev_speed as f64 * 0.3)) as u64
                    };
                }
                self.direct_last_calc.insert(id.clone(), (current_bytes, now));
            }

            if let Some(d) = self.downloads.get_mut(&id) {
                if current_bytes > 0 || speed > 0 {
                    d.had_real_downloads = Some(true);
                }
                if matches!(d.status, DownloadStatus::Downloading) {
                    if d.downloaded != current_bytes {
                        d.downloaded = current_bytes;
                        direct_save_needed = true;
                    }
                    if d.download_speed != speed {
                        d.download_speed = speed;
                        d.peak_speed = Some(d.peak_speed.unwrap_or(0).max(speed));
                        direct_save_needed = true;
                    }
                    if let Some(total) = d.total_size {
                        if total > 0 {
                            let prog =
                                Some((current_bytes as f32 / total as f32).min(1.0));
                            if d.progress != prog {
                                d.progress = prog;
                                direct_save_needed = true;
                            }
                        }
                    }

                    // Live per-file percentage for the in-flight file. The
                    // byte counter accumulates across the whole transfer, so
                    // subtract the bytes of files already fully downloaded to
                    // isolate the current file's progress.
                    let committed: u64 = d
                        .files
                        .iter()
                        .filter(|f| f.selected && f.progress >= 1.0)
                        .map(|f| f.downloaded)
                        .sum();
                    let in_flight_bytes = current_bytes.saturating_sub(committed);
                    if let Some(f) = d
                        .files
                        .iter_mut()
                        .find(|f| f.selected && f.progress < 1.0)
                    {
                        if f.size > 0 {
                            let fp = (in_flight_bytes as f32 / f.size as f32).min(1.0);
                            let capped = in_flight_bytes.min(f.size);
                            if (f.progress - fp).abs() > 0.0005 || f.downloaded != capped {
                                f.downloaded = capped;
                                f.progress = fp;
                                direct_save_needed = true;
                            }
                        } else if f.downloaded != in_flight_bytes {
                            f.downloaded = in_flight_bytes;
                            direct_save_needed = true;
                        }
                    }
                } else if d.download_speed != 0 {
                    d.download_speed = 0;
                    direct_save_needed = true;
                }
            }
        }
        if direct_save_needed {
            self.mark_dirty();
        }

        // Clean up counters for removed downloads.
        self.direct_counters
            .retain(|id, _| self.downloads.contains_key(id));
        self.direct_last_calc
            .retain(|id, _| self.downloads.contains_key(id));
        self.direct_generations
            .retain(|id, _| self.downloads.contains_key(id));
        self.direct_locks
            .retain(|id, _| self.downloads.contains_key(id));
        self.direct_reset_partial
            .retain(|id| self.downloads.contains_key(id));

    }
}

// ─── Start orchestration (needs the shared Arc, so free functions) ──────────

/// Mark `id` as actively running (unless it already is) and emit the
/// updated record. Concurrent downloads are allowed — every download
/// starts immediately and no longer waits for a single active slot.
async fn begin_download(
    manager: &SharedManager,
    id: &str,
    in_flight_status: DownloadStatus,
) -> bool {
    let mut guard = manager.write().await;
    let Some(d) = guard.downloads_mut().get_mut(id) else {
        return false;
    };
    if d.status.is_active() {
        return true;
    }
    d.status = in_flight_status;
    guard.mark_dirty();
    guard.emit_progress_force();
    true
}

/// Kick off the worker for `id`. Returns false when the record vanished
/// or couldn't start.
pub async fn start_download(manager: &SharedManager, id: &str) -> bool {
    let (kind, status) = {
        let guard = manager.read().await;
        match guard.downloads_map().get(id) {
            Some(d) => (d.kind, d.status.clone()),
            None => return false,
        }
    };
    if status.is_active() {
        return true;
    }

    match kind {
        DownloadKind::Torrent => start_torrent(manager, id).await,
        DownloadKind::Direct => start_direct(manager, id).await,
        DownloadKind::Debrid => start_debrid(manager, id).await,
    }
}

/// Start (or resume) a torrent download.
async fn start_torrent(manager: &SharedManager, id: &str) -> bool {
    if !begin_download(manager, id, DownloadStatus::FetchingMetadata).await {
        return false;
    }
    let (session, source_uri, save_path, only_files, referer) = {
        let mut guard = manager.write().await;
        let Some(session) = guard.session().cloned() else {
            drop(guard);
            fail_download(manager, id, "Torrent engine not initialized.".to_string()).await;
            return false;
        };
        let Some(d) = guard.downloads_mut().get_mut(id) else {
            drop(guard);
            fail_download(manager, id, "Download vanished.".to_string()).await;
            return false;
        };
        (
            session,
            d.source_uri.clone(),
            d.save_path.clone(),
            d.only_files.clone(),
            d.referer.clone(),
        )
    };

    if save_path.trim().is_empty() {
        fail_download(
            manager,
            id,
            "Save folder missing — please remove and re-add this download \
             with a folder selected."
                .to_string(),
        )
        .await;
        return false;
    }

    // Fast path: the torrent is already in the session (paused
    // earlier, or restored by librqbit's session persistence). Just
    // unpause it — this is what makes pause → resume and app-restart
    // resume work for torrents WITH a file selection too (a re-add
    // of an existing infohash only yields `AlreadyManaged`, which
    // never starts the torrent on its own).
    if source_uri.is_empty() || torrent::find_handle(&session, id).is_some() {
        if let Some(handle) = torrent::find_handle(&session, id) {
            // Unpausing requires resolved metadata — librqbit panics
            // on a metadata-less torrent (torrent_state/mod.rs:382).
            // Paused / restored handles always carry metadata; a
            // still-resolving magnet falls through to the re-add path
            // below, whose bounded timeout covers the fetch.
            if handle.with_metadata(|_| ()).is_ok() {
                // Reconcile the session's file selection with the
                // record before unpausing. A fresh add applies the
                // selection at add time, but a restored / paused
                // session entry keeps whatever it had at add time.
                if let Some(of) = only_files.as_deref() {
                    let session_of = handle.only_files();
                    if session_of.as_deref() != Some(of) {
                        let set: HashSet<usize> = of.iter().copied().collect();
                        let _ = session.update_only_files(&handle, &set).await;
                    }
                }
                let _ = session.unpause(&handle).await;
                // Stats are read AFTER the unpause so a resumed entry
                // reports Live/Downloading — reading the pre-unpause
                // Paused state would let the 1 s pause sweep re-pause
                // the torrent on the next tick.
                let mut guard = manager.write().await;
                if let Some(d) = guard.downloads_mut().get_mut(id) {
                    let stats = handle.stats();
                    let status = torrent::map_state_to_status(
                        &stats.state,
                        stats.total_bytes,
                        stats.progress_bytes,
                        stats.error.as_deref(),
                    );
                    d.status = gate_completion(status, d.had_real_downloads);
                }
                guard.mark_dirty();
                guard.emit_progress_force();
                return true;
            }
        }
        if source_uri.is_empty() {
            fail_download(
                manager,
                id,
                "This download has no source URI and can't be restarted."
                    .to_string(),
            )
            .await;
            return false;
        }
    }

    // Full (re-)add in the background — add_torrent can take up to
    // 120 s for magnets while metadata is fetched.
    let manager_clone = Arc::clone(manager);
    let id_owned = id.to_string();
    let spawn_fut: std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>> =
        Box::pin(async move {
        match torrent::add_and_start(
            &session,
            &source_uri,
            &save_path,
            only_files.as_deref(),
            referer.as_deref(),
        )
        .await
        {
            Ok(outcome) => {
                let (handle, already_managed) = match outcome {
                    torrent::AddOutcome::Added { handle } => (handle, false),
                    torrent::AddOutcome::AlreadyManaged { handle } => (handle, true),
                };
                let real_id =
                    torrent::frontend_id_from_hash(&handle.shared().info_hash.0);
                let name = handle
                    .name()
                    .unwrap_or_else(|| "Fetching metadata\u{2026}".to_string());

                let mut guard = manager_clone.write().await;
                // The user may have removed the download while we were
                // adding it — clean the session back up (only the entry
                // we created; never a pre-existing torrent).
                if !guard.downloads_map().contains_key(&id_owned) {
                    drop(guard);
                    if !already_managed {
                        let _ = session
                            .delete(
                                librqbit::api::TorrentIdOrHash::Id(handle.id()),
                                false,
                            )
                            .await;
                    }
                    return;
                }
                // M1: another record already owns this infohash.
                let existing_dup = guard
                    .downloads_map()
                    .get(&real_id)
                    .filter(|d| d.id != id_owned)
                    .map(|d| d.clone());
                if let Some(existing) = existing_dup {
                    drop(guard);
                    // AlreadyManaged: the handle IS the pre-existing
                    // torrent — touching it would kill the first
                    // download. Added: undo only the entry we created.
                    if !already_managed {
                        let _ = session
                            .delete(
                                librqbit::api::TorrentIdOrHash::Id(handle.id()),
                                false,
                            )
                            .await;
                    }
                    fail_download(
                        &manager_clone,
                        &id_owned,
                        format!(
                            "This torrent is already in your downloads ({}). \
                             Resume it there, or remove it first if you want to re-download.",
                            existing.name
                        ),
                    )
                    .await;
                    return;
                }
                guard.rekey(&id_owned, &real_id);
                let was_paused = guard
                    .downloads_map()
                    .get(&real_id)
                    .map(|d| matches!(d.status, DownloadStatus::Paused))
                    .unwrap_or(false);
                if let Some(d) = guard.downloads_mut().get_mut(&real_id) {
                    d.name = name;
                }
                guard.mark_dirty();
                guard.emit_progress_force();
                drop(guard);

                if was_paused {
                    // The user paused while the add was in flight — keep
                    // the session entry paused. Quiesce first: the entry
                    // was just made Live by `add_and_start` and may be
                    // writing already.
                    torrent::pause_torrent(&session, &handle).await;
                    let mut guard = manager_clone.write().await;
                    guard.mark_dirty();
                    guard.emit_progress_force();
                    return;
                }

                if already_managed {
                    // M1-passed `AlreadyManaged`: no other record owns
                    // this infohash, so the pre-existing session entry
                    // is ours. This is the resume-after-restart /
                    // metadata-wasn't-ready-yet path — adopt the entry
                    // (sync its file selection, then unpause) instead
                    // of leaving it paused forever.
                    if let Some(of) = only_files.as_deref() {
                        let session_of = handle.only_files();
                        if session_of.as_deref() != Some(of) {
                            let set: HashSet<usize> = of.iter().copied().collect();
                            let _ = session.update_only_files(&handle, &set).await;
                        }
                    }
                    let _ = session.unpause(&handle).await;
                }

                // Stats/files are read AFTER any unpause so a resumed
                // entry reports Live/Downloading — reading the
                // pre-unpause Paused state would let the 1 s pause
                // sweep re-pause the torrent on the next tick.
                let stats = handle.stats();
                let live_files = torrent::files_from_handle(&handle, &stats);
                let mut guard = manager_clone.write().await;
                // The user may have paused/removed while we were
                // finalising — respect that instead of overwriting it.
                let wants_run = guard
                    .downloads_map()
                    .get(&real_id)
                    .map(|d| d.status.is_active())
                    .unwrap_or(false);
                if !wants_run {
                    // User paused/removed while finalising — stop the
                    // entry without racing its writes.
                    drop(guard);
                    torrent::pause_torrent(&session, &handle).await;
                    let mut guard = manager_clone.write().await;
                    guard.mark_dirty();
                    guard.emit_progress_force();
                    return;
                }
                if let Some(d) = guard.downloads_mut().get_mut(&real_id) {
                    if let Some(files) = live_files {
                        // Selected-files sum as the progress denominator.
                        let selected_sum: u64 =
                            files.iter().filter(|f| f.selected).map(|f| f.size).sum();
                        d.total_size = if selected_sum > 0 {
                            Some(selected_sum)
                        } else if stats.total_bytes > 0 {
                            Some(stats.total_bytes)
                        } else {
                            None
                        };
                        d.files = files;
                    } else if stats.total_bytes > 0 {
                        d.total_size = Some(stats.total_bytes);
                    }
                    d.status = gate_completion(
                        torrent::map_state_to_status(
                            &stats.state,
                            stats.total_bytes,
                            stats.progress_bytes,
                            stats.error.as_deref(),
                        ),
                        d.had_real_downloads,
                    );
                }
                guard.mark_dirty();
                guard.emit_progress_force();
            }
            Err(e) => {
                fail_download(&manager_clone, &id_owned, e).await;
            }
        }
    });
    tokio::spawn(spawn_fut);
    true
}

/// Start (or resume) a direct HTTP download.
async fn start_direct(manager: &SharedManager, id: &str) -> bool {
    if !begin_download(manager, id, DownloadStatus::Downloading).await {
        return false;
    }
    // Magnet guard: mark the record errored and abort.
    {
        let mut guard = manager.write().await;
        let Some(d) = guard.downloads_mut().get_mut(id) else {
            return false;
        };
        if d.source_uri.starts_with("magnet:") {
            d.status = DownloadStatus::Error(
                "Direct download has a magnet source — cannot restart.".to_string(),
            );
            guard.mark_dirty();
            guard.emit_progress_force();
            return false;
        }
    }
    spawn_direct_worker(manager, id).await
}

/// Create the byte counter, bump the worker generation, and spawn the
/// direct-download worker for `id`. The worker is handed a per-download
/// lifetime lock so a replacement (mirror switch / URL edit) can never
/// write concurrently with a still-running predecessor (C1).
/// Returns false when the record vanished before the spawn.
pub async fn spawn_direct_worker(manager: &SharedManager, id: &str) -> bool {
    let (url, save_path, referer, counter, generation, lock) = {
        let mut guard = manager.write().await;
        let (source_uri, save_path, referer) = {
            let Some(d) = guard.downloads_mut().get_mut(id) else {
                return false;
            };
            (d.source_uri.clone(), d.save_path.clone(), d.referer.clone())
        };
        let generation = {
            let e = guard.direct_generations.entry(id.to_string()).or_insert(0u64);
            *e += 1;
            *e
        };
        let counter = Arc::new(AtomicU64::new(0));
        guard
            .direct_counters
            .insert(id.to_string(), Arc::clone(&counter));
        let lock = guard
            .direct_locks
            .entry(id.to_string())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
            .clone();
        (source_uri, save_path, referer, counter, generation, lock)
    };

    let weak = Arc::downgrade(manager);
    let id_owned = id.to_string();
    let spawn_fut: std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>> =
        Box::pin(async move {
            http::run_direct_download(
                id_owned,
                url,
                save_path,
                referer,
                counter,
                weak,
                generation,
                lock,
            )
            .await;
        });
    tokio::spawn(spawn_fut);
    true
}

/// Spawn the multi-file debrid HTTP worker. Mirrors `spawn_direct_worker`
/// (counter/generation/lock setup) but hands the worker the full file
/// list to download sequentially into the record's save folder.
async fn spawn_debrid_files_worker(
    manager: &SharedManager,
    id: &str,
    files: Vec<(String, u64, String, String)>,
    only_files: Option<Vec<usize>>,
    seed_bytes: u64,
    segments: u32,
    url_refresher: Option<Arc<super::http::UrlRefresher>>,
) -> bool {
    let (save_dir, counter, generation, lock) = {
        let mut guard = manager.write().await;
        let save_dir = {
            let Some(d) = guard.downloads_mut().get_mut(id) else {
                return false;
            };
            d.save_path.clone()
        };
        let generation = {
            let e = guard.direct_generations.entry(id.to_string()).or_insert(0u64);
            *e += 1;
            *e
        };
        let counter = Arc::new(AtomicU64::new(seed_bytes));
        guard
            .direct_counters
            .insert(id.to_string(), Arc::clone(&counter));
        let lock = guard
            .direct_locks
            .entry(id.to_string())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
            .clone();
        (save_dir, counter, generation, lock)
    };

    let weak = Arc::downgrade(manager);
    let id_owned = id.to_string();
    let spawn_fut: std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>> =
        Box::pin(async move {
            http::run_debrid_files_download(
                id_owned,
                files,
                only_files,
                save_dir,
                counter,
                weak,
                generation,
                lock,
                segments,
                url_refresher,
            )
            .await;
        });
    tokio::spawn(spawn_fut);
    true
}

/// Start a debrid download: upload the magnet, poll until ready, then
/// hand the resolved link to the HTTP worker.
async fn start_debrid(manager: &SharedManager, id: &str) -> bool {
    // Already resolved to direct links earlier? Resume the multi-file
    // worker from the stored file list; without one (legacy single-file),
    // fall back to plain direct (which claims the slot itself).
    let (is_magnet, resolved, source_uri, preserved_magnet) = {
        let guard = manager.read().await;
        let Some(d) = guard.downloads_map().get(id) else {
            return false;
        };
        let is_magnet = d.source_uri.starts_with("magnet:");
        let resolved = if is_magnet {
            None
        } else {
            guard.debrid_files.get(id).cloned()
        };
        (
            is_magnet,
            resolved,
            d.source_uri.clone(),
            d.magnet_uri.clone(),
        )
    };
    if !is_magnet {
        if let Some(files) = resolved {
            if files.is_empty() {
                fail_download(
                    manager,
                    id,
                    "No files resolved for this debrid download.".to_string(),
                )
                .await;
                return false;
            }
            if !begin_download(manager, id, DownloadStatus::Downloading).await {
                return false;
            }
            // Don't reset progress/per-file bytes here: a pause→resume must
            // continue from where it left off, so the persisted `downloaded`
            // seeds the worker counter and the worker re-checks every file on
            // disk (skip completed / resume partial).
            let (only_files, seed, segments, url_refresher) = {
                let guard = manager.read().await;
                let Some(d) = guard.downloads_map().get(id) else {
                    return false;
                };
                let (segments, url_refresher) = guard
                    .debrid_params
                    .get(id)
                    .map(|(provider, apikey)| debrid_worker_options(provider, apikey))
                    .or_else(|| {
                        let p = guard.default_debrid_provider.as_deref()?;
                        let k = guard.default_debrid_apikey.as_deref()?;
                        if !p.is_empty() && !k.is_empty() {
                            Some(debrid_worker_options(p, k))
                        } else {
                            None
                        }
                    })
                    .unwrap_or((0, None));
                (d.only_files.clone(), d.downloaded, segments, url_refresher)
            };
            return spawn_debrid_files_worker(
                manager,
                id,
                files,
                only_files,
                seed,
                segments,
                url_refresher,
            )
            .await;
        }
        // Degraded record: `source_uri` was overwritten with the first
        // file's direct URL but no resolved file list survived (legacy
        // single-file record, or a restart between resolve and persist).
        // A preserved magnet lets us re-run the resolve flow and recover
        // the FULL file list; falling through to start_direct would
        // download only that first file's URL.
        if let Some(magnet) = preserved_magnet
            .filter(|m| m.starts_with("magnet:") && !m.trim().is_empty())
        {
            return spawn_magnet_resolve(manager, id, magnet).await;
        }
        return start_direct(manager, id).await;
    }
    // Fresh magnet: resolve it through the debrid provider.
    spawn_magnet_resolve(manager, id, source_uri).await
}

/// Shared tail of the debrid magnet flow: mark FetchingMetadata, look up
/// credentials (per-download params → default provider fallback), then
/// spawn `run_debrid_flow` for `magnet`. Used by both the fresh-magnet
/// path and the degraded-record self-heal in `start_debrid`.
async fn spawn_magnet_resolve(manager: &SharedManager, id: &str, magnet: String) -> bool {
    if !begin_download(manager, id, DownloadStatus::FetchingMetadata).await {
        return false;
    }
    let params = {
        let guard = manager.read().await;
        if !guard.downloads_map().contains_key(id) {
            return false;
        }
        guard.debrid_params.get(id).cloned().or_else(|| {
            let p = guard.default_debrid_provider.as_deref()?;
            let k = guard.default_debrid_apikey.as_deref()?;
            (!p.is_empty() && !k.is_empty()).then(|| (p.to_string(), k.to_string()))
        })
    };

    let Some((provider, apikey)) = params else {
        fail_download(
            manager,
            id,
            "Debrid credentials are no longer available (app restarted). \
             Remove this download and add it again."
                .to_string(),
        )
        .await;
        return false;
    };

    let manager_clone = Arc::clone(manager);
    let id_owned = id.to_string();
    let spawn_fut: std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>> =
        Box::pin(async move {
            run_debrid_flow(manager_clone, id_owned, magnet, provider, apikey).await;
        });
    tokio::spawn(spawn_fut);
    true
}

async fn run_debrid_flow(
    manager: SharedManager,
    id: String,
    magnet: String,
    provider: String,
    apikey: String,
) {
    use super::debrid::{AllDebridClient, RealDebridClient, TorBoxClient};

    println!("[downloads] Uploading magnet to debrid ({})", provider);
    let upload_res = if provider == "alldebrid" {
        AllDebridClient::upload_magnet(&apikey, &magnet).await
    } else if provider == "realdebrid" {
        RealDebridClient::upload_magnet(&apikey, &magnet).await
    } else if provider == "torbox" {
        TorBoxClient::upload_magnet(&apikey, &magnet).await
    } else {
        Err("Unsupported provider".to_string())
    };

    let (transfer_id, cached) = match upload_res {
        Ok(upload) => (upload.id, upload.cached),
        Err(e) => {
            fail_download(&manager, &id, format!("Debrid upload failed: {}", e)).await;
            return;
        }
    };

    // Stamp the cache result immediately so the UI can surface "Cached"
    // while the file list is still being resolved.
    {
        let mut guard = manager.write().await;
        if let Some(d) = guard.downloads_mut().get_mut(&id) {
            d.debrid_cached = Some(cached);
        }
        guard.mark_dirty();
        guard.emit_progress_force();
    }

    let mut poll_failures: u32 = 0;
    let mut interval = tokio::time::interval(Duration::from_secs(3));
    loop {
        interval.tick().await;

        // Stop polling when the user paused or removed the download.
        {
            let guard = manager.read().await;
            match guard.downloads_map().get(&id) {
                Some(d) => {
                    if !matches!(
                        d.status,
                        DownloadStatus::FetchingMetadata | DownloadStatus::Downloading
                    ) {
                        return;
                    }
                }
                None => return,
            }
        }

        let status_res = if provider == "alldebrid" {
            AllDebridClient::get_status(&apikey, &transfer_id).await
        } else if provider == "realdebrid" {
            RealDebridClient::get_status(&apikey, &transfer_id).await
        } else {
            TorBoxClient::get_status(&apikey, &transfer_id).await
        };

        let status = match status_res {
            Ok(s) => {
                poll_failures = 0;
                s
            }
            Err(e) => {
                let lower = e.to_lowercase();
                // Terminal provider errors must not waste retry time.
                if lower.contains("not_found")
                    || lower.contains("auth_bad")
                    || lower.contains("invalid_apikey")
                {
                    fail_download(&manager, &id, format!("Failed to poll debrid: {}", e)).await;
                    return;
                }
                poll_failures += 1;
                if poll_failures >= MAX_DEBRID_POLL_FAILURES {
                    fail_download(
                        &manager,
                        &id,
                        format!(
                            "Failed to poll debrid after {} consecutive errors: {}",
                            poll_failures, e
                        ),
                    )
                    .await;
                    return;
                }
                println!(
                    "[downloads] Transient debrid poll error ({}/{}): {}",
                    poll_failures, MAX_DEBRID_POLL_FAILURES, e
                );
                // Back off before the next poll (10s..60s, escalating).
                tokio::time::sleep(Duration::from_secs((10 * poll_failures).min(60) as u64)).await;
                continue;
            }
        };

        if status.status == "ready" {
            if status.files.is_empty() {
                fail_download(
                    &manager,
                    &id,
                    "No download links returned by debrid".to_string(),
                )
                .await;
                return;
            }

            println!(
                "[downloads] Debrid ready. {} file(s)",
                status.files.len()
            );
            // AllDebrid's `/f/…` links are short download *pages* — fetching
            // them directly yields HTML. Unlock each into a direct CDN URL
            // (`.debrid.it`) before handing them to the HTTP worker, falling
            // back to the raw link if unlocking fails.
            //
            // AllDebrid unlock calls are independent and take one RTT each —
            // unlock in parallel (2 in flight, staying well under the 12 req/s
            // API limit) instead of serially. The result order is preserved so
            // the per-file naming below stays deterministic.
            let links: Vec<String> = if provider == "alldebrid" {
                let sem = Arc::new(tokio::sync::Semaphore::new(2));
                let mut set = tokio::task::JoinSet::new();
                for (i, f) in status.files.iter().enumerate() {
                    let sem = Arc::clone(&sem);
                    let apikey = apikey.clone();
                    let link = f.link.clone();
                    set.spawn(async move {
                        let _permit = sem.acquire_owned().await;
                        (i, AllDebridClient::unrestrict_link(&apikey, &link).await)
                    });
                }
                let mut results = vec![None; status.files.len()];
                while let Some(joined) = set.join_next().await {
                    if let Ok((i, res)) = joined {
                        results[i] = Some(res);
                    }
                }
                status
                    .files
                    .iter()
                    .zip(results)
                    .map(|(f, res)| match res {
                        Some(Ok(direct)) if !direct.is_empty() => direct,
                        _ => f.link.clone(),
                    })
                    .collect()
            } else {
                status.files.iter().map(|f| f.link.clone()).collect()
            };

            // Build the final (name, size, direct_url, orig_url) list, sanitising names and
            // de-duplicating so same-named files in different folders can't
            // collide on disk.
            let mut files: Vec<(String, u64, String, String)> = Vec::with_capacity(status.files.len());
            let mut used = std::collections::HashSet::new();
            for (f, link) in status.files.iter().zip(links) {
                let mut name = if f.name.trim().is_empty() {
                    filename_from_url(&link)
                } else {
                    sanitize_rel_path(f.name.clone())
                };
                name = uniquify(name, &mut used);
                files.push((name, f.size, link, f.link.clone()));
            }

            // Single-file downloads keep the file name as the record name;
            // multi-file downloads fall back to the torrent/archive title.
            let record_name = if files.len() == 1 {
                files[0].0.clone()
            } else {
                status
                    .name
                    .clone()
                    .map(sanitize_filename)
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| "debrid_download".to_string())
            };
            let total: u64 = files.iter().map(|(_, s, _, _)| *s).sum();
            let total_size = resolved_total_size(total, status.magnet_size);

            {
                let mut guard = manager.write().await;
                let Some(d) = guard.downloads_mut().get_mut(&id) else {
                    return;
                };
                // `save_path` stays the folder the command was given; the
                // worker drops every file into it.
                d.source_uri = files[0].2.clone();
                // Preserve the original magnet: `source_uri` now points at
                // the first file's direct URL only, so a restart-resume of
                // a record that lost its resolved file list needs the
                // magnet to re-resolve the FULL list.
                d.magnet_uri = Some(magnet.clone());
                d.uris = Some(files.iter().map(|(_, _, l, _)| l.clone()).collect());
                d.name = record_name;
                d.total_size = total_size;
                d.status = DownloadStatus::Downloading;
                d.progress = Some(0.0);
                d.files = files
                    .iter()
                    .map(|(n, s, _, _)| super::types::DownloadFile {
                        name: n.clone(),
                        size: *s,
                        downloaded: 0,
                        progress: 0.0,
                        selected: true,
                    })
                    .collect();
                // Remember the resolved list so pause → resume re-runs the
                // multi-file worker instead of misreading the folder as a
                // single file path.
                guard.debrid_files.insert(id.clone(), files.clone());
                guard.mark_dirty();
                guard.emit_progress_force();
            }
            // Same worker machinery as start_direct (generation + lock),
            // so a pause/remove during the debrid HTTP phase is safe.
            //
            // AllDebrid unlock links expire after hours. The refresher lets the
            // HTTP worker re-unlock a file's original URL before retrying, so a long or
            // stalled download resumes against a live link instead of a dead one.
            // Segmented (8-stream) downloads match AllDebrid's documented IDM/FDM
            // recommendation (8 connections/file); other providers stay single-connection.
            let (segments, url_refresher) = debrid_worker_options(&provider, &apikey);
            spawn_debrid_files_worker(&manager, &id, files, None, 0, segments, url_refresher)
                .await;
            return;
        } else if status.status == "error" {
            let err_msg = status
                .error_message
                .unwrap_or_else(|| "Debrid download error".to_string());
            fail_download(&manager, &id, err_msg).await;
            return;
        } else {
            let mut guard = manager.write().await;
            if let Some(d) = guard.downloads_mut().get_mut(&id) {
                d.progress = Some(status.progress / 100.0);
                d.status = DownloadStatus::Downloading;
            }
            guard.mark_dirty();
            guard.emit_progress();
        }
    }
}

/// Full-magnet size honesty: the per-file sum is authoritative; when
/// files carry no sizes (sum == 0, e.g. legacy links or a provider that
/// omits them), fall back to the provider's magnet-level size so the
/// record never shows "first file only" (or zero) sizing.
fn resolved_total_size(file_sum: u64, magnet_size: Option<u64>) -> Option<u64> {
    if file_sum > 0 {
        return Some(file_sum);
    }
    magnet_size.filter(|&s| s > 0)
}

/// Strip path separators and characters illegal in a file name on the
/// common desktop OSes. Debrid file names come from torrent metadata and
/// are not guaranteed to be filesystem-safe.
fn sanitize_filename(name: String) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    let trimmed = cleaned.trim();
    // A bare "." or ".." (or an all-dots name) would resolve to the
    // parent directory — never allow it as a target file name.
    if trimmed.is_empty() || trimmed.chars().all(|c| c == '.') {
        "debrid_download".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Sanitise a debrid-relative path, preserving `/` folder separators so
/// nested torrent files recreate their subfolders on disk. Each path
/// component is cleaned independently (illegal characters → `_`), and
/// empty / `.` / `..` components are neutralised to prevent traversal.
fn sanitize_rel_path(path: String) -> String {
    let mut parts: Vec<String> = Vec::new();
    for comp in path.replace('\\', "/").split('/') {
        let cleaned: String = comp
            .chars()
            .map(|c| match c {
                ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0' => '_',
                c if c.is_control() => '_',
                c => c,
            })
            .collect();
        let trimmed = cleaned.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed == "." || trimmed == ".." || trimmed.chars().all(|c| c == '.') {
            parts.push("_".to_string());
        } else {
            parts.push(trimmed.to_string());
        }
    }
    if parts.is_empty() {
        "debrid_download".to_string()
    } else {
        parts.join("/")
    }
}

/// Return `name`, appending a numeric suffix when it collides with a
/// name already chosen for this download (same-named files that lived in
/// different folders of the torrent).
fn uniquify(name: String, used: &mut std::collections::HashSet<String>) -> String {
    let mut candidate = name.clone();
    let mut n = 2u32;
    while !used.insert(candidate.clone()) {
        candidate = format!("{name}_{n}");
        n += 1;
    }
    candidate
}

/// Best-effort filename from a debrid-resolved download URL. Falls back
/// to a generic name when the link carries no meaningful last path
/// segment (e.g. a bare host or a query-string-only URL).
fn filename_from_url(url: &str) -> String {
    const FALLBACK: &str = "debrid_download";
    let Ok(parsed) = url::Url::parse(url) else {
        return FALLBACK.to_string();
    };
    let Some(name) = parsed
        .path_segments()
        .and_then(|mut segs| segs.next_back())
        .filter(|s| !s.is_empty())
    else {
        return FALLBACK.to_string();
    };
    let decoded = urlencoding::decode(name)
        .map(|c| c.into_owned())
        .unwrap_or_else(|_| name.to_string());
    if decoded.contains('.') && decoded.len() <= 255 {
        decoded
    } else {
        FALLBACK.to_string()
    }
}

/// Download-segment count for a debrid provider (0 = single connection).
/// AllDebrid officially recommends 8 connections per file.
fn segments_for(provider: &str) -> u32 {
    if provider == "alldebrid" {
        super::http::SEGMENT_COUNT
    } else {
        0
    }
}

/// Build the optional URL-refresher for a provider. AllDebrid unlock
/// links expire after hours; the refresher re-unlocks a file's original URL via
/// `/v4/link/unlock` so retries hit a live link.
fn debrid_worker_options(
    provider: &str,
    apikey: &str,
) -> (u32, Option<Arc<super::http::UrlRefresher>>) {
    let segs = segments_for(provider);
    let apikey = apikey.to_string();
    let refresher: Arc<super::http::UrlRefresher> = match provider {
        "alldebrid" => Arc::new(move |_url: String, orig_url: String| {
            let apikey = apikey.clone();
            Box::pin(async move {
                super::debrid::AllDebridClient::unrestrict_link(&apikey, &orig_url)
                    .await
                    .ok()
            })
        }),
        "realdebrid" => Arc::new(move |_url: String, orig_url: String| {
            let apikey = apikey.clone();
            Box::pin(async move {
                super::debrid::RealDebridClient::unrestrict_link(&apikey, &orig_url)
                    .await
                    .ok()
            })
        }),
        "torbox" => Arc::new(move |_url: String, orig_url: String| {
            let apikey = apikey.clone();
            Box::pin(async move {
                super::debrid::TorBoxClient::unrestrict_link(&apikey, &orig_url)
                    .await
                    .ok()
            })
        }),
        _ => return (segs, None),
    };
    (segs, Some(refresher))
}

/// Mark a download as errored and free the active slot.
pub async fn fail_download(manager: &SharedManager, id: &str, err: String) {
    let mut guard = manager.write().await;
    if let Some(d) = guard.downloads_mut().get_mut(id) {
        d.status = DownloadStatus::Error(err);
        d.download_speed = 0;
    }
    guard.mark_dirty();
    guard.emit_progress_force();
}

/// Called by workers when a download finished successfully.
pub async fn on_download_finished(manager: &SharedManager, _id: &str) {
    let mut guard = manager.write().await;
    guard.mark_dirty();
    guard.emit_progress_force();
}

/// Spawn an archive-extraction task for a completed download.
pub fn spawn_extraction(
    id: String,
    save_path: String,
    name: String,
    files: Vec<super::types::DownloadFile>,
) {
    let manager = super::manager_handle();
    tokio::spawn(async move {
        println!("[downloads] Starting auto-extraction for {}", name);
        let id_clone = id.clone();
        let files_clone = files.clone();
        let save_path_clone = save_path.clone();
        let result = tokio::task::spawn_blocking(move || {
            extract::extract_archives_for_download(&id_clone, &save_path_clone, &files_clone)
        })
        .await;

        match result {
            Ok(Ok(extracted)) => {
                // Delete only what actually extracted (first parts +
                // their volume siblings). Nothing is deleted on failure.
                if !extracted.is_empty() {
                    println!(
                        "[downloads] Extraction complete for {}. Deleting {} archive(s).",
                        name,
                        extracted.len()
                    );
                    extract::delete_archives_for_download(&save_path, &files, &extracted);
                }
            }
            Ok(Err(e)) => {
                println!("[downloads] Extraction failed for {}: {}", name, e);
            }
            Err(e) => {
                println!("[downloads] Extraction task panicked for {}: {}", name, e);
            }
        }
        if let Some(manager) = manager {
            let mut guard = manager.write().await;
            if let Some(d) = guard.downloads_mut().get_mut(&id) {
                d.extracted = Some(true);
            }
            guard.mark_dirty();
            guard.emit_progress_force();
        }
    });
}

fn hash_snapshot(downloads: &[Download]) -> u64 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    for d in downloads {
        d.id.hash(&mut hasher);
        d.name.hash(&mut hasher);
        d.downloaded.hash(&mut hasher);
        d.total_size.hash(&mut hasher);
        if let Some(p) = d.progress {
            p.to_bits().hash(&mut hasher);
        }
        d.download_speed.hash(&mut hasher);
        d.upload_speed.hash(&mut hasher);
        d.peers.hash(&mut hasher);
        d.seeds.hash(&mut hasher);
        d.queue_position.hash(&mut hasher);
        d.had_real_downloads.hash(&mut hasher);
        d.extracted.hash(&mut hasher);
        match &d.status {
            DownloadStatus::Queued => 0u8.hash(&mut hasher),
            DownloadStatus::FetchingMetadata => 1u8.hash(&mut hasher),
            DownloadStatus::Downloading => 2u8.hash(&mut hasher),
            DownloadStatus::Paused => 3u8.hash(&mut hasher),
            DownloadStatus::Seeding => 4u8.hash(&mut hasher),
            DownloadStatus::Completed => 5u8.hash(&mut hasher),
            DownloadStatus::Error(msg) => {
                6u8.hash(&mut hasher);
                msg.hash(&mut hasher);
            }
            DownloadStatus::Removed => 7u8.hash(&mut hasher),
        }
    }
    hasher.finish()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolved_total_size_prefers_file_sum() {
        assert_eq!(resolved_total_size(100, Some(50)), Some(100));
        assert_eq!(resolved_total_size(100, None), Some(100));
    }

    #[test]
    fn resolved_total_size_falls_back_to_magnet_size() {
        // Files resolved but with no sizes (legacy links): the
        // magnet-level size is the only honest total.
        assert_eq!(resolved_total_size(0, Some(145_604_511)), Some(145_604_511));
    }

    #[test]
    fn resolved_total_size_none_when_both_unknown() {
        assert_eq!(resolved_total_size(0, None), None);
        assert_eq!(resolved_total_size(0, Some(0)), None);
    }
}
