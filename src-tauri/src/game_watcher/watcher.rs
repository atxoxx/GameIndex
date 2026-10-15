use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::time::Instant;
use tauri::{AppHandle, Emitter};

use crate::db::{self, Db};
use crate::metrics_collector;
use crate::steam_game_watcher;

use super::*;
use super::paths::{
    exe_stem_lower, get_game_root_dir, is_path_sep, normalize_path_lower, now_unix_ms,
    trim_path_separators,
};
use super::poll::{
    PENDING_SESSION_TIMEOUT, POLL_INTERVAL_FAST, POLL_INTERVAL_STEADY, SESSION_LOST_GRACE,
    STEAM_INSTALL_SCAN_INTERVAL,
};
use super::process::{MemoryScanFilter, ProcessInfo, RunningSessionSnapshot};
use super::session::{find_session_process, is_currently_running};
use super::steam_install::{reconciled_baseline, SteamScanInputs};
use super::types::SteamLibraryGame;

pub struct GameWatcher {
    pub(crate) process_index: HashMap<String, Vec<GameRef>>,
    pub(crate) active_sessions: HashMap<String, ActiveSession>,
    pub(crate) gpu_id: Option<String>,
    pub(crate) gpu_name: Option<String>,
    /// User-configurable telemetry knobs (master toggle, sampling
    /// interval, per-metric capture flags). Read at the moment a
    /// collection thread is started so live setting changes apply to
    /// the next game launch / detection without a restart.
    pub(crate) metrics_config: metrics_collector::MetricsConfig,
    /// Phase 3: handle to the SQLite pool so `finalize_session` can
    /// record each session row before emitting the `game-exited`
    /// event. Pool ops are sync and ~ms, so the inline write is
    /// cheap and guarantees the row is committed before any
    /// frontend listener sees the event.
    pub(crate) db: Db,
    /// Sender used to wake the background poll loop immediately (e.g.
    /// right after a launch registers a pending session) so detection
    /// latency drops from the steady poll interval to near-zero.
    /// `None` until `start_background_poll` wires it up.
    pub(crate) wake_tx: Option<std::sync::mpsc::Sender<()>>,
    pub(crate) last_steam_install_poll: Option<Instant>,
    /// AppID → fully-installed state at the last poll. *Presence* in this
    /// map means an `appmanifest_<appid>.acf` exists on disk; the bool
    /// tracks whether Steam considers it fully installed (`StateFlags`
    /// bit 4). Tracking presence (not just fully-installed) is what lets
    /// the poll distinguish a genuine uninstall — Steam deletes the
    /// manifest — from an in-progress update, which keeps the manifest
    /// and only flips `StateFlags`.
    pub(crate) steam_manifest_appids: std::collections::HashMap<u32, bool>,
    /// Every Steam game in the library, refreshed on each index rebuild.
    /// The install scan uses it both to resolve a newly installed game's
    /// exe and as the baseline that surfaces installs/uninstalls which
    /// happened while the app was closed.
    pub(crate) steam_library: HashMap<u32, SteamLibraryGame>,
    /// `true` once the library has been (re)loaded and the next Steam
    /// scan should reconcile its declared install state against disk.
    /// Bypasses the scan throttle so startup/mutation reconciling is
    /// prompt instead of waiting out the periodic cadence.
    pub(crate) steam_baseline_dirty: bool,
    /// AppIDs already announced as uninstalled. Stops a repeat event
    /// while the library index hasn't yet dropped the removed entry.
    pub(crate) steam_missing_reported: HashSet<u32>,
}

impl GameWatcher {
    pub fn new(db: Db) -> Self {
        Self {
            process_index: HashMap::new(),
            active_sessions: HashMap::new(),
            gpu_id: None,
            gpu_name: None,
            metrics_config: metrics_collector::MetricsConfig::default(),
            db,
            wake_tx: None,
            last_steam_install_poll: None,
            steam_manifest_appids: std::collections::HashMap::new(),
            steam_library: HashMap::new(),
            steam_baseline_dirty: true,
            steam_missing_reported: HashSet::new(),
        }
    }

    /// Wire the wake channel from the background poll thread. Called
    /// once at startup so the watcher can request an immediate re-poll.
    pub fn set_wake_sender(&mut self, tx: std::sync::mpsc::Sender<()>) {
        self.wake_tx = Some(tx);
    }

    /// Request the background loop to poll right now instead of waiting
    /// out its current sleep. Best-effort: a disconnected/already-pending
    /// wake is harmless.
    fn request_immediate_poll(&self) {
        if let Some(tx) = &self.wake_tx {
            let _ = tx.send(());
        }
    }

    /// `true` while any session needs tighter tracking: still pending
    /// (no process captured yet) or inside its post-loss grace window.
    /// Used to pick the faster poll interval.
    fn has_hot_session(&self) -> bool {
        self.active_sessions
            .values()
            .any(|s| s.last_pid == 0 || s.lost_at.is_some())
    }

    /// Interval to use for the next poll cycle: fast while a launch is
    /// awaiting its process or a lost session is burning down its grace
    /// period, steady otherwise.
    pub(crate) fn current_poll_interval(&self) -> std::time::Duration {
        if self.has_hot_session() {
            POLL_INTERVAL_FAST
        } else {
            POLL_INTERVAL_STEADY
        }
    }

    /// Rebuild the process index from a list of game references.
    pub fn rebuild_index(&mut self, games: Vec<GameRef>) {
        // Capture the library's Steam entries first: the process index
        // only holds games with a resolvable exe/install dir, but the
        // install scan needs every Steam-platform game (including owned-
        // but-not-installed ones) to reconcile closed-app install/
        // uninstall. Only genuine Steam games qualify — a local/manual
        // import may carry a Steam AppID for metadata but has no
        // appmanifest, so treating it as Steam would report it as
        // uninstalled and delete it from the library.
        let mut steam_library: HashMap<u32, SteamLibraryGame> = HashMap::new();
        for game in &games {
            if game.platform == "Steam" {
                if let Some(appid) = game.steam_app_id {
                    steam_library.insert(
                        appid,
                        SteamLibraryGame {
                            name: game.game_name.clone(),
                            installed: game.installed,
                        },
                    );
                }
            }
        }
        // Only a change to the Steam AppID set or an install flag needs a
        // reconcile scan. Metadata-only rebuilds (artwork, description,
        // display-name enrichment) fire constantly and must not each
        // trigger a full manifest scan.
        let steam_set_changed = steam_library.len() != self.steam_library.len()
            || steam_library.iter().any(|(appid, game)| {
                self.steam_library
                    .get(appid)
                    .map(|old| old.installed != game.installed)
                    .unwrap_or(true)
            });
        self.steam_library = steam_library;
        if steam_set_changed {
            self.steam_baseline_dirty = true;
        }

        let mut index: HashMap<String, Vec<GameRef>> = HashMap::new();

        for game in games {
            if let Some(ref exe) = game.exe_path {
                let norm = normalize_path_lower(exe);
                index.entry(norm).or_default().push(game.clone());
            }

            if let Some(ref install_dir) = game.install_dir {
                let dir_key = trim_path_separators(&normalize_path_lower(
                    &install_dir.to_string_lossy(),
                ))
                .to_string();
                let prefixed_key = format!("__dir__{}", dir_key);
                index.entry(prefixed_key).or_default().push(game.clone());
            }
        }

        self.process_index = index;

        // Reconcile the newly-loaded library against disk on the next
        // poll rather than waiting out the steady/idle sleep.
        if self.steam_baseline_dirty {
            self.request_immediate_poll();
        }
    }

    pub fn set_gpu(&mut self, id: Option<String>, name: Option<String>) {
        self.gpu_id = id;
        self.gpu_name = name;
    }

    /// Update the user-configurable telemetry knobs. Applied to the next
    /// collection thread started for a launch or passive detection.
    pub fn set_metrics_config(&mut self, config: metrics_collector::MetricsConfig) {
        self.metrics_config = config;
    }

    /// Read the current telemetry config (used to seed the frontend on load).
    pub fn metrics_config(&self) -> metrics_collector::MetricsConfig {
        self.metrics_config.clone()
    }

    /// The GPU selected at the last launch, or `(None, None)` until one is set.
    /// Lets the overlay's live sampler target the same adapter as the session
    /// collector instead of always defaulting to GPU index 0.
    pub fn gpu(&self) -> (Option<String>, Option<String>) {
        (self.gpu_id.clone(), self.gpu_name.clone())
    }

    /// PID of a tracked session's process, or `None` while it is still
    /// pending (no process captured yet). Lets the overlay resolve a game's
    /// PID for RTSS/Afterburner FPS without waiting on the next event.
    pub fn active_pid(&self, game_id: &str) -> Option<u32> {
        self.active_sessions
            .get(game_id)
            .map(|session| session.last_pid)
            .filter(|pid| *pid != 0)
    }

    /// Register a session launched explicitly through the app.
    pub fn register_launched_session(
        &mut self,
        app_handle: &AppHandle,
        game_id: &str,
        game_name: &str,
        platform: &str,
        steam_app_id: Option<u32>,
        exe_path: Option<&str>,
        initial_pid: u32,
        metrics_stop_tx: std::sync::mpsc::Sender<()>,
        metrics_rx: std::sync::mpsc::Receiver<Option<metrics_collector::SessionMetrics>>,
        post_exit_script: Option<(String, bool)>,
    ) {
        let install_dir = if platform == "Steam" {
            steam_app_id
                .and_then(|id| steam_game_watcher::game_install_path(id))
                .or_else(|| {
                    exe_path.and_then(|ep| get_game_root_dir(Path::new(ep)))
                })
        } else if let Some(ep) = exe_path {
            get_game_root_dir(Path::new(ep))
        } else {
            None
        };

        // Re-launch guard: a session for this same `game_id` may already
        // exist — e.g. process detection passively started one moments
        // earlier, before the user clicked Launch. The insert below would
        // silently replace it, leaking the old session's metrics collector
        // thread (its `stop_tx` is never fired and the result receiver is
        // dropped). Stop the old collector before taking over the entry;
        // the new session replaces it wholesale, no metrics merging.
        if let Some(existing) = self.active_sessions.get(game_id) {
            let _ = existing.stop_tx.send(());
        }

        self.active_sessions.insert(
            game_id.to_string(),
            ActiveSession {
                game_id: game_id.to_string(),
                game_name: game_name.to_string(),
                started_at: Instant::now(),
                last_pid: initial_pid,
                stop_tx: metrics_stop_tx,
                metrics_rx: Some(metrics_rx),
                launched_by_app: true,
                matched_exe: exe_path.unwrap_or("").to_string(),
                // A known-PID launch is attached immediately; a pending
                // protocol launch (initial_pid == 0) anchors later in the
                // poll loop when the real process first appears.
                attached_at: if initial_pid != 0 {
                    Some(Instant::now())
                } else {
                    None
                },
                attached_at_ms: if initial_pid != 0 { now_unix_ms() } else { 0 },
                install_dir,
                lost_at: None,
                post_exit_script,
            },
        );

        // Sync emit for the known-PID path. The pending path
        // (initial_pid == 0) is handled by the poll loop's
        // transition detector when the real process appears.
        // Without this branch, app-launched games with known PIDs
        // never fire game-started, breaking tray listeners.
        if initial_pid != 0 {
            let _ = app_handle.emit(
                "game-started",
                GameStartedPayload {
                    game_id: game_id.to_string(),
                    game_name: game_name.to_string(),
                    detected_exe: exe_path.map(|s| s.to_string()),
                    pid: initial_pid,
                },
            );
        }

        // Kick the poll loop immediately so the pending path
        // (Steam protocol / UAC / Ubisoft hand-off) detects the real
        // process within ~1 s instead of waiting for the next
        // steady-interval poll.
        self.request_immediate_poll();
    }

    /// Snapshot the inputs the Steam-install scan needs and advance its
    /// throttle, so the slow part (`run_steam_install_scan`: registry +
    /// `appmanifest_*.acf` reads, `resolve_steam_game_exe`) can run
    /// without the watcher lock held. Returns `None` while throttled.
    ///
    /// A "reconcile" scan (first run, or right after the library index
    /// was rebuilt) skips the throttle and seeds the baseline from the
    /// library's declared install state — see `reconciled_baseline`.
    pub(crate) fn steam_install_scan_inputs(&mut self) -> Option<SteamScanInputs> {
        let now = Instant::now();
        let reconcile = self.steam_baseline_dirty || self.last_steam_install_poll.is_none();
        if !reconcile {
            if let Some(last) = self.last_steam_install_poll {
                // Re-scan throttle (registry + appmanifest_*.acf files).
                // The diff only emits on actual install-state changes, so
                // a 5-minute cadence is plenty for out-of-app changes.
                if now.duration_since(last) < STEAM_INSTALL_SCAN_INTERVAL {
                    return None;
                }
            }
        }

        self.last_steam_install_poll = Some(now);
        self.steam_baseline_dirty = false;

        // Only reconcile the library's declared state on a reconcile
        // scan; on a steady scan `steam_manifest_appids` is the accurate
        // observed baseline and must not be rewritten from a library
        // flag that may lag behind an in-flight install.
        let previous = if reconcile {
            reconciled_baseline(&self.steam_manifest_appids, &self.steam_library)
        } else {
            self.steam_manifest_appids.clone()
        };

        Some(SteamScanInputs {
            previous,
            missing_reported: self.steam_missing_reported.clone(),
            library: self.steam_library.clone(),
        })
    }

    /// Apply the completed Steam-install scan (computed off-lock).
    pub(crate) fn apply_steam_install_scan(
        &mut self,
        current: HashMap<u32, bool>,
        missing_reported: HashSet<u32>,
    ) {
        self.steam_manifest_appids = current;
        self.steam_missing_reported = missing_reported;
    }

    /// `true` while at least one game session is being tracked. Read by the
    /// local-achievements watcher (via `AppHandle` state) so it only scans
    /// crack/emulator files at the fast cadence while a game is running.
    pub fn has_active_sessions(&self) -> bool {
        !self.active_sessions.is_empty()
    }

    /// Path/stem inputs that let the process snapshot decide which processes
    /// need a working-set read (see [`MemoryScanFilter`]). Empty when no
    /// session is active, which skips every per-process memory query.
    pub(crate) fn memory_scan_filter(&self) -> MemoryScanFilter {
        let mut filter = MemoryScanFilter::default();
        for session in self.active_sessions.values() {
            if let Some(dir) = session.install_dir.as_ref() {
                let prefix =
                    trim_path_separators(&normalize_path_lower(&dir.to_string_lossy())).to_string();
                if !prefix.is_empty() && !filter.dir_prefixes.iter().any(|p| *p == prefix) {
                    filter.dir_prefixes.push(prefix);
                }
            }
            if let Some(stem) = exe_stem_lower(&session.matched_exe) {
                if !stem.is_empty() && !filter.exe_stems.iter().any(|s| *s == stem) {
                    filter.exe_stems.push(stem);
                }
            }
        }
        filter
    }

    /// Run one poll cycle. Resolves pending sessions, re-attaches sessions
    /// whose tracked process died to a still-running process in the install
    /// directory, and detects new passively-launched games.
    ///
    /// `processes` is the already-enumerated process snapshot: enumerating
    /// it (a full Toolhelp32 sweep on Windows, `/proc` walk on Linux) is
    /// the expensive part of a poll, so callers take it before acquiring
    /// the watcher lock.
    ///
    /// Returns the sessions that ended this cycle, already removed from
    /// `active_sessions` (via `take_active_session`), each paired with the
    /// name of any remaining active session at the time of removal. The
    /// caller runs the slow finalization (post-exit script, metrics drain,
    /// db writes, `game-exited` emit) AFTER releasing the watcher mutex.
    pub(crate) fn apply_poll(
        &mut self,
        app_handle: &AppHandle,
        processes: Vec<ProcessInfo>,
    ) -> Vec<(ActiveSession, Option<String>)> {
        if processes.is_empty() {
            return Vec::new();
        }

        // ── Resolve pending sessions and re-attach dead sessions ───────
        // Pending sessions (last_pid == 0) happen when a launch provides
        // no PID: UAC elevation without a process handle, or Steam
        // protocol launches. If the tracked PID dies (launcher exits
        // after spawning the real game), we look for any still-running
        // process inside the game's install directory and continue the
        // same session.
        // Liveness is checked against this same poll's process snapshot.
        // Liveness by PID alone is not enough: between 5 s polls the OS
        // can recycle a PID to an unrelated process, which would keep a
        // dead session "running" against a foreign exe — inflated
        // playtime, metrics sampling the wrong process, and `game-exited`
        // never firing until that foreign process exits. A session is only
        // currently running when its PID (or a descendant — wrapper chains
        // like gamescope → wine) still resolves to the tracked exe.
        let mut ended_ids: Vec<String> = Vec::new();
        let mut transitions: Vec<(String, ProcessInfo)> = Vec::new();

        for (gid, session) in &mut self.active_sessions {
            let is_pending = session.last_pid == 0;
            let is_currently_running =
                is_currently_running(&processes, session.last_pid, &session.matched_exe);

            if is_currently_running {
                // The same PID reappeared in the snapshot after a gap —
                // clear the grace period and tell the frontend the session
                // is healthy again.
                if session.lost_at.is_some() {
                    let _ = app_handle.emit(
                        "game-session-restored",
                        GameSessionLostPayload {
                            game_id: gid.clone(),
                            game_name: session.game_name.clone(),
                        },
                    );
                }
                session.lost_at = None;
                continue;
            }

            // Re-attach to a still-running process for this game. The
            // tracked PID (often a launcher / bootstrapper / splash screen)
            // may have exited when the real game process took over — e.g.
            // after the player clicks Play and the game goes fullscreen.
            // `find_session_process` searches the install dir first, then
            // climbs up the directory tree (shared publisher roots like
            // `Rockstar Games\Launcher` vs `Rockstar Games\GameName`),
            // falls back to an exe-stem match, and finally accepts a live
            // descendant of the tracked PID (a splash that spawned the
            // real game under a different name, e.g. `Game.exe` →
            // `Game-Win64-Shipping.exe`).
            //
            // Attempted on every poll while the process is missing, not just
            // the first: a game that appears a poll or two after its splash
            // exited (slow asset preload, shader compile) must still be
            // picked up before the grace window ends. Matching stays strict
            // — same exe stem, or a descendant of the tracked PID confined
            // to the install dir — so a leftover helper is never grabbed.
            let found_proc = find_session_process(
                &processes,
                session.last_pid,
                session.install_dir.as_ref(),
                &session.matched_exe,
            );

            if let Some(proc) = found_proc {
                // Re-attached to a new process (launcher hand-off or a
                // respawn). If this session had entered the grace period,
                // restore it to "running" for the frontend.
                if session.lost_at.is_some() {
                    let _ = app_handle.emit(
                        "game-session-restored",
                        GameSessionLostPayload {
                            game_id: gid.clone(),
                            game_name: session.game_name.clone(),
                        },
                    );
                }
                session.lost_at = None;
                transitions.push((gid.clone(), proc));
            } else {
                if is_pending {
                    if session.started_at.elapsed() > PENDING_SESSION_TIMEOUT {
                        eprintln!(
                            "[game_watcher] {} pending launch timed out after {}s.",
                            session.game_name,
                            PENDING_SESSION_TIMEOUT.as_secs()
                        );
                        ended_ids.push(gid.clone());
                    }
                } else {
                    if let Some(lost_time) = session.lost_at {
                        if lost_time.elapsed() > SESSION_LOST_GRACE {
                            ended_ids.push(gid.clone());
                        }
                    } else {
                        session.lost_at = Some(Instant::now());
                        eprintln!(
                            "[game_watcher] {} (PID {}) lost. Starting {}s grace period.",
                            session.game_name, session.last_pid,
                            SESSION_LOST_GRACE.as_secs()
                        );
                        // Emit once at grace entry so the frontend can show a
                        // "closing" state instead of flipping straight to
                        // stopped (launcher hand-offs otherwise read as a
                        // hard exit for up to SESSION_LOST_GRACE).
                        let _ = app_handle.emit(
                            "game-session-lost",
                            GameSessionLostPayload {
                                game_id: gid.clone(),
                                game_name: session.game_name.clone(),
                            },
                        );
                    }
                }
            }
        }

        // Apply transitions before ending sessions so a session that
        // just found a new process is not also finished.
        for (gid, proc) in transitions {
            if let Some(session) = self.active_sessions.get_mut(&gid) {
                let was_pending = session.last_pid == 0;

                // A pending launch just produced a real process — anchor
                // playtime at the attach instant so the pending window
                // (user-gated Steam dialog, slow launch, elevation) is
                // not counted as playtime.
                if was_pending {
                    session.attached_at = Some(Instant::now());
                    session.attached_at_ms = now_unix_ms();
                }

                // Stop metrics collection bound to the old (or dummy)
                // PID. A new collector will be started for the real one.
                let _ = session.stop_tx.send(());

                session.last_pid = proc.pid;
                session.matched_exe = proc.exe_path.clone();
                // Re-anchor the install dir to the real game's location so
                // subsequent re-attaches and Force Close target the actual
                // process (the originally-tracked launcher may live in a
                // different folder under a shared publisher root).
                session.install_dir = get_game_root_dir(Path::new(&proc.exe_path));
                session.lost_at = None;

                eprintln!(
                    "[game_watcher] {} transitioned to PID {} ({})",
                    session.game_name, proc.pid, proc.exe_path
                );

                let (tx, rx) = metrics_collector::start_metrics_collection(
                    self.metrics_config.clone(),
                    proc.pid,
                    self.gpu_id.clone(),
                    self.gpu_name.clone(),
                );
                session.stop_tx = tx;
                session.metrics_rx = Some(rx);

                // Notify the frontend the first time a process is found.
                if was_pending {
                    let _ = app_handle.emit(
                        "game-started",
                        GameStartedPayload {
                            game_id: session.game_id.clone(),
                            game_name: session.game_name.clone(),
                            detected_exe: Some(proc.exe_path),
                            pid: proc.pid,
                        },
                    );
                }
            }
        }

        // Extract the ended sessions from the map under this short critical
        // section and hand them to the caller as owned data. The slow
        // finalization (post-exit script, up-to-1s metrics drain, SQLite
        // writes, `game-exited` emit) runs in `start_background_poll` AFTER
        // the watcher mutex is released — mirroring the force-close path —
        // so it no longer blocks IPC handlers or the next poll.
        let mut ended_sessions: Vec<(ActiveSession, Option<String>)> = Vec::new();
        for gid in ended_ids {
            if let Some((session, remaining_name)) = self.take_active_session(&gid) {
                ended_sessions.push((session, remaining_name));
            }
        }

        // ── Collect which new processes match known games ─────────────
        let tracked: std::collections::HashSet<String> = self
            .active_sessions
            .keys()
            .cloned()
            .collect();

        // One process = one session. PIDs already claimed by a live or
        // pending session must never spawn a second passive session:
        // multiple library entries can share a single exe path (e.g.
        // duplicate imports, or emulator ROMs that all point at the
        // emulator's executable), and without this guard a single running
        // process fans out into N phantom sessions that are all recorded
        // on exit. Built before the match loops and extended as matches
        // are claimed below.
        let mut claimed_pids: std::collections::HashSet<u32> = self
            .active_sessions
            .values()
            .filter(|s| s.last_pid != 0)
            .map(|s| s.last_pid)
            .collect();

        // Collect matches before starting sessions (avoid borrow conflicts)
        let mut new_matches: Vec<(GameRef, ProcessInfo)> = Vec::new();

        for proc in &processes {
            let norm = normalize_path_lower(&proc.exe_path);

            // Blacklist: never treat known non-game processes (launchers,
            // crash handlers, Wallpaper Engine's wallpaper64.exe, etc.) as a
            // launched game. Without this, a background app like Wallpaper
            // Engine that is always running would be picked up as a session
            // the moment the real game quits and its process index entry
            // matches (the running indicator would "shift" to it).
            if let Some(lower) = exe_stem_lower(&proc.exe_path) {
                if SKIP_KEYWORDS.iter().any(|kw| lower.contains(kw)) {
                    continue;
                }
            }

            // Exact path match
            if let Some(games) = self.process_index.get(&norm) {
                for game in games {
                    if !tracked.contains(&game.game_id) && !claimed_pids.contains(&proc.pid) {
                        new_matches.push((game.clone(), proc.clone()));
                        claimed_pids.insert(proc.pid);
                    }
                }
            }

            // Install-dir prefix match
            for (key, games) in &self.process_index {
                if let Some(dir) = key.strip_prefix("__dir__") {
                    if norm.starts_with(dir) {
                        // Make sure the match is actually inside the directory, not a
                        // sibling path that happens to share the prefix (e.g. "FooBar"
                        // when looking for "Foo").
                        let remainder = &norm[dir.len()..];
                        if remainder.is_empty() || remainder.starts_with(is_path_sep) {
                            for game in games {
                                if !tracked.contains(&game.game_id)
                                    && !claimed_pids.contains(&proc.pid)
                                    && !new_matches.iter().any(|(g, _)| g.game_id == game.game_id)
                                {
                                    new_matches.push((game.clone(), proc.clone()));
                                    claimed_pids.insert(proc.pid);
                                }
                            }
                        }
                    }
                }
            }
        }

        // Now start sessions (mutable borrow of self)
        for (game, proc) in new_matches {
            self.start_passive_session(app_handle, &game, &proc);
        }

        ended_sessions
    }

    fn start_passive_session(
        &mut self,
        app_handle: &AppHandle,
        game: &GameRef,
        proc: &ProcessInfo,
    ) {
        let pid = proc.pid;
        let (stop_tx, metrics_rx) = metrics_collector::start_metrics_collection(
            self.metrics_config.clone(),
            pid,
            self.gpu_id.clone(),
            self.gpu_name.clone(),
        );

        self.active_sessions.insert(
            game.game_id.clone(),
            ActiveSession {
                game_id: game.game_id.clone(),
                game_name: game.game_name.clone(),
                started_at: Instant::now(),
                last_pid: pid,
                stop_tx,
                metrics_rx: Some(metrics_rx),
                launched_by_app: false,
                attached_at: Some(Instant::now()),
                attached_at_ms: now_unix_ms(),
                matched_exe: proc.exe_path.clone(),
                install_dir: game.install_dir.clone(),
                lost_at: None,
                post_exit_script: None,
            },
        );

        let _ = app_handle.emit(
            "game-started",
            GameStartedPayload {
                game_id: game.game_id.clone(),
                game_name: game.game_name.clone(),
                detected_exe: Some(proc.exe_path.clone()),
                pid: proc.pid,
            },
        );
    }

    /// Emit a `game-progress` heartbeat for every attached session and
    /// return the durable running-row snapshots for the caller to persist
    /// (outside the watcher mutex). Pending sessions (no process captured
    /// yet) and never-attached sessions are skipped.
    pub(crate) fn snapshot_running_rows(&self, app_handle: &AppHandle) -> Vec<RunningSessionSnapshot> {
        let mut rows = Vec::new();
        for session in self.active_sessions.values() {
            if session.last_pid == 0 || session.attached_at.is_none() {
                continue;
            }
            let elapsed = session.elapsed_seconds();
            let _ = app_handle.emit(
                "game-progress",
                GameProgressPayload {
                    game_id: session.game_id.clone(),
                    game_name: session.game_name.clone(),
                    elapsed_seconds: elapsed,
                },
            );
            rows.push(RunningSessionSnapshot {
                game_id: session.game_id.clone(),
                game_name: session.game_name.clone(),
                started_at_ms: session.attached_at_ms,
                elapsed_seconds: elapsed,
            });
        }
        rows
    }

    /// Returns whether the watcher currently tracks a session for
    /// the given `game_id`. Exposed as a public API for upcoming
    /// frontend status checks (e.g. "Stop download if game is running").
    #[allow(dead_code)]
    pub fn is_running(&self, game_id: &str) -> bool {
        self.active_sessions.contains_key(game_id)
    }

    /// Returns the `game_name` of one currently-active session, or
    /// `None` if no sessions are running. Used by the system tray to
    /// label the "Playing: X" status item — the listener closure
    /// reads the watcher's in-memory state once per emit, so any
    /// path that registers a session (Launch button via
    /// `register_launched_session`, passive WMI detection via
    /// `start_passive_session`, future integration paths we haven't
    /// wired yet) ends up reflected in the tray without bespoke
    /// event-payload parsing.
    ///
    /// When multiple sessions are active simultaneously (rare —
    /// dual-monitor multi-client setups), the first one in
    /// `active_sessions` HashMap iteration order is returned.
    /// `HashMap` iteration ordering isn't stable, but the
    /// multi-session case is uncommon enough that deterministic
    /// selection isn't worth the extra bookkeeping; if a user really
    /// wants per-window labels we'd need a multi-tray setup, not a
    /// single status line.
    ///
    /// Reserved accessor — the current tray listener reads the
    /// game name from the `game-started` / `game-exited` event
    /// payloads (to avoid a re-lock, see the tray listener
    /// comments). Re-stored on `GameWatcher` so the planned
    /// "polling status check" Admin UI command path can read
    /// "is anything running and what is it" without replaying
    /// the event log. Silence the dead-code lint until that
    /// path lands.
    #[allow(dead_code)]
    pub fn current_session_name(&self) -> Option<String> {
        self.active_sessions
            .values()
            .next()
            .map(|s| s.game_name.clone())
    }

    /// Force-terminate the tracked process for `game_id` and finalize
    /// the session in the same atomic step.
    ///
    /// Why we kill-then-finalize in a single call (rather than letting
    /// the 5 s poll loop pick up the dead process organically):
    ///
    ///   - Snappier UX: the user clicks "Force Close" and the running
    ///     indicator disappears within the same React tick instead of
    ///     after the next poll cycle. Window of inconsistency between
    ///     backend state and `runningGameIds` frontend state drops from
    ///     0–5 s to 0 ms.
    ///   - One cleanup path: by routing back through the existing
    ///     `finalize_session`, the activity dashboard, last-played stamp,
    ///     SQLite session row, and `game-exited` event all see the same
    ///     snapshot they would on a natural exit. The frontend's
    ///     ActivityContext listener filters sessions shorter than one
    ///     minute (existing behavior) — a force-closed sub-minute
    ///     session still updates `game.playTime` and `lastPlayed` in
    ///     `GameContext`, just no separate Activity row, mirroring
    ///     natural exits.
    ///
    /// PID-recycling guard: between the last 5 s poll and the closing
    /// click, the tracked PID could in theory be recycled by the OS to
    /// an unrelated user-owned process. Naively calling
    /// `OpenProcess(PROCESS_TERMINATE) + TerminateProcess` on that PID
    /// would kill the WRONG process. We guard against this by re-reading
    /// the process's actual exe path via `QueryFullProcessImageNameW`
    /// and comparing it against `session.matched_exe` (normalized
    /// lowercase + back-slashes). Only when the exe matches do we open
    /// a terminate handle and call `TerminateProcess`. A mismatched
    /// exe OR a failed query means we report `killed: false` and let
    /// the session get cleared via `finalize_session` anyway — the user
    /// still gets the running indicator cleared, and the frontend can
    /// show a warning toast.
    ///
    /// Safe-rail enumeration of the return shapes:
    ///   - `Ok({ pid: 0, killed: true })`    — pending session (Steam
    ///     protocol / UAC) where the real process was found and
    ///     terminated via the install-dir scan. Frontend = "Force
    ///     closed X" success toast.
    ///   - `Ok({ pid: N, killed: true })`    — tracked PID verified +
    ///     terminated (and/or a matching process killed). Frontend =
    ///     "Force closed X" success toast.
    ///   - `Ok({ pid: N, killed: false })`   — session exists but we
    ///     could not safely terminate any matching process (PID
    ///     recycled, access denied, no matching process found).
    ///     Frontend = warning toast "ended session, please close X
    ///     manually".
    ///   - `Err(...)`                        — session is no longer
    ///     tracked (race between button click and watcher cleanup).
    ///     Frontend = error toast.
    ///
    /// `killed` reflects whether the process sweep actually terminated
    /// something: Windows uses TerminateProcess/taskkill, Linux sends
    /// SIGTERM then SIGKILL, and other targets (where
    /// `query_running_processes()` returns empty) always report `false`.
    /// The session is still cleaned up via `finalize_session` either way.
    /// Atomically remove the active session for `game_id` from
    /// `active_sessions` and return it alongside the (Option<String>)
    /// name of any *other* currently-active session.
    ///
    /// Returns `None` when no session exists for `game_id` — callers
    /// should treat that as a benign race with the background poll
    /// loop or another concurrent `force_close_game` IPC.
    ///
    /// Why this exists: previously, `force_close` held `&mut
    /// self.active_sessions` for the entire kill + 10-second
    /// `metrics_rx.recv_timeout` window, freezing the background poll
    /// loop and any concurrent force-close click. By taking ownership
    /// in this short critical section, the caller can drop the
    /// `Arc<Mutex<GameWatcher>>` lock before doing the slow finalization
    /// work.
    pub fn take_active_session(
        &mut self,
        game_id: &str,
    ) -> Option<(ActiveSession, Option<String>)> {
        let remaining_name = self
            .active_sessions
            .values()
            .find(|s| s.game_id != game_id)
            .map(|s| s.game_name.clone());
        let session = self.active_sessions.remove(game_id)?;
        Some((session, remaining_name))
    }

    /// Snapshot the kill-target fields for `game_id` and return them
    /// as fully-owned data so the caller can drop the watcher mutex
    /// before invoking `kill_matching_processes` (which performs a
    /// slow Win32 enumeration of every running PID).
    ///
    /// Returns `None` when no session exists for `game_id`. The caller
    /// (`force_close_game` Tauri command) treats that as the
    /// "Game is not running" error path.
    pub fn gather_force_close_data(&self, game_id: &str) -> Option<ForceCloseData> {
        let session = self.active_sessions.get(game_id)?;
        Some(ForceCloseData {
            pid: session.last_pid,
            expected_exe_lower: normalize_path_lower(&session.matched_exe),
            install_dir_lower: session.install_dir.as_ref().map(|d| {
                trim_path_separators(&normalize_path_lower(&d.to_string_lossy())).to_string()
            }),
        })
    }

    /// Cheap clone of the inner `Db` so callers can release the
    /// watcher mutex before doing SQLite writes (the pool is an
    /// `Arc<...>` collection, so cloning is just an atomic refcount
    /// bump). See `db::pool::Db`.
    pub fn db_clone(&self) -> db::Db {
        self.db.clone()
    }
}
