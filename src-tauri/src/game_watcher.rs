//! Unified game watcher — process detection, session tracking, and smarter exe resolution.
//!
//! Replaces the old split between `launch_game` (child.wait() for local games),
//! `spawn_game_exe` + `watch_steam_game` (WMI polling for Steam), and the
//! "largest .exe" heuristic in `steam/sync.rs`.
//!
//! ## Architecture
//!
//! ```text
//! GameWatcher (Tauri managed state, single background thread)
//! ├── process_index: HashMap<normalized_exe_path, Vec<GameRef>>
//! │   Built from the full game library on startup + refreshed on sync
//! │
//! ├── active_sessions: HashMap<game_id, ActiveSession>
//! │   Tracks running games — whether launched through the app or
//! │   detected passively via WMI polling
//! │
//! └── Background poll loop (every 5 s):
//!     1. Query Win32_Process (all processes, one WMI round-trip)
//!     2. Match running processes against process_index
//!     3. New matches → start metrics, emit "game-started"
//!     4. Missing matches → stop metrics, emit "game-exited"
//! ```
//!
//! ## Exe Resolution (resolve_game_exe)
//!
//! Multi-strategy approach tried in priority order:
//! 1. Name scoring: how well the exe stem matches the game name
//! 2. Directory depth: prefer root-level exes over deeply nested ones
//! 3. Keyword exclusion: extended skip list for known non-game binaries
//! 4. Size: final tiebreaker — largest remaining candidate

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{AppHandle, Emitter};

use crate::db::{self, Db};
use crate::metrics_collector;
use crate::steam_game_watcher;

// ─── Data Types ───────────────────────────────────────────────────────────────

/// Lightweight reference to a game in the library — just enough to
/// match a process path and emit events.
#[derive(Debug, Clone)]
pub struct GameRef {
    pub game_id: String,
    pub game_name: String,
    /// Platform tag (e.g. "Steam", "Epic", "Manual"). Stored for
    /// upcoming Steam-specific features (rich presence, overlay
    /// hooks) and multi-store integrations.
    #[allow(dead_code)]
    pub platform: String,
    pub exe_path: Option<String>,        // known exe path (from sync or manual import)
    pub install_dir: Option<PathBuf>,    // for prefix-matching Steam/Epic games
    /// Steam AppID when known. Used by `register_launched_session` to
    /// resolve the install dir; see comment on that method for the
    /// Steam protocol-launch flow that benefits from this carry-over.
    #[allow(dead_code)]
    pub steam_app_id: Option<u32>,
}

/// A running game session tracked by the watcher.
///
/// Field-level visibility (`pub`) lets `lib.rs::force_close_game` destructure
/// the session out of the watcher mutex and run the slow post-kill steps
/// (post-exit script, metrics collection flush, db writes, game-exited
/// emit) without holding the global `Arc<Mutex<GameWatcher>>` — without
/// this, a 10-second `recv_timeout` would block the background poll loop
/// and any concurrent force-close IPC for the full duration.
pub struct ActiveSession {
    pub game_id: String,
    pub game_name: String,
    pub started_at: Instant,
    pub last_pid: u32,
    pub stop_tx: std::sync::mpsc::Sender<()>,
    pub metrics_rx: Option<std::sync::mpsc::Receiver<Option<metrics_collector::SessionMetrics>>>,
    /// `true` if the session was started by `register_launched_session`
    /// (user clicked Launch); `false` if detected passively by
    /// `start_passive_session`. Wired up so future telemetry and
    /// Activity-page filters can distinguish manual launches from
    /// games the user started outside the app.
    #[allow(dead_code)]
    pub launched_by_app: bool,
    pub matched_exe: String,
    /// Install directory used to re-attach the session when the initial
    /// process exits but a launcher has spawned the real game process, or
    /// when the launch provided no PID (UAC elevation, Steam protocol).
    pub install_dir: Option<PathBuf>,
    /// When the process was first noticed as dead/missing.
    /// If Some, the session is in a grace period.
    pub lost_at: Option<Instant>,
    /// Optional script (path + admin flag) run after the game process
    /// exits. Wired by `register_launched_session` for app-launched games.
    pub post_exit_script: Option<(String, bool)>,
}

/// How long a pending session (last_pid == 0) may exist before it is
/// considered failed and ended. Steam updates / slow UAC prompts can
/// take a while, but 2 minutes is plenty — if no matching process has
/// appeared by then, the launch did not actually start the game.
const PENDING_SESSION_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);

/// Steady-state poll interval when no session is in a "hot" state
/// (e.g. a pending launch awaiting its process). 5 s is cheap and
/// sufficient for normal start/exit detection.
const POLL_INTERVAL_STEADY: std::time::Duration = std::time::Duration::from_secs(5);

/// Fast poll interval used while a session is pending (last_pid == 0)
/// — i.e. a launch that hasn't produced a process yet (Steam
/// protocol, UAC elevation, Ubisoft hand-off). We want to detect the
/// real process within ~1 s instead of waiting up to POLL_INTERVAL_STEADY.
const POLL_INTERVAL_PENDING: std::time::Duration = std::time::Duration::from_secs(1);

/// Grace period once a tracked process goes missing before the session
/// is ended. Kept short (was 20 s) so the running indicator and
/// last-played stamp update promptly; the re-attach window (looking
/// for another live process in the install dir) still runs first.
const SESSION_LOST_GRACE: std::time::Duration = std::time::Duration::from_secs(8);

/// Serializable info about a candidate exe found during resolution.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExeCandidate {
    pub path: String,
    pub size_bytes: u64,
    pub name_score: f32,
    pub depth: u32,
}

/// Payload for the "steam-install-changed" event emitted when a Steam
/// AppID installation status changes (game downloaded / installed / uninstalled).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamInstallChangedPayload {
    pub app_id: u32,
    pub installed: bool,
    pub exe_path: Option<String>,
}

// ─── GameWatcher ──────────────────────────────────────────────────────────────

pub struct GameWatcher {
    process_index: HashMap<String, Vec<GameRef>>,
    active_sessions: HashMap<String, ActiveSession>,
    gpu_id: Option<String>,
    gpu_name: Option<String>,
    /// User-configurable telemetry knobs (master toggle, sampling
    /// interval, per-metric capture flags). Read at the moment a
    /// collection thread is started so live setting changes apply to
    /// the next game launch / detection without a restart.
    metrics_config: metrics_collector::MetricsConfig,
    /// Phase 3: handle to the SQLite pool so `finalize_session` can
    /// record each session row before emitting the `game-exited`
    /// event. Pool ops are sync and ~ms, so the inline write is
    /// cheap and guarantees the row is committed before any
    /// frontend listener sees the event.
    db: Db,
    /// Sender used to wake the background poll loop immediately (e.g.
    /// right after a launch registers a pending session) so detection
    /// latency drops from the steady poll interval to near-zero.
    /// `None` until `start_background_poll` wires it up.
    wake_tx: Option<std::sync::mpsc::Sender<()>>,
    last_steam_install_poll: Option<Instant>,
    steam_installed_appids: std::collections::HashSet<u32>,
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
            steam_installed_appids: std::collections::HashSet::new(),
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

    /// `true` while any session is still pending (no process captured
    /// yet). Used to pick the faster poll interval right after a launch.
    fn has_pending_session(&self) -> bool {
        self.active_sessions.values().any(|s| s.last_pid == 0)
    }

    /// Interval to use for the next poll cycle: fast while a launch is
    /// still awaiting its process, steady otherwise.
    fn current_poll_interval(&self) -> std::time::Duration {
        if self.has_pending_session() {
            POLL_INTERVAL_PENDING
        } else {
            POLL_INTERVAL_STEADY
        }
    }

    /// Rebuild the process index from a list of game references.
    pub fn rebuild_index(&mut self, games: Vec<GameRef>) {
        let mut index: HashMap<String, Vec<GameRef>> = HashMap::new();

        for game in games {
            if let Some(ref exe) = game.exe_path {
                let norm = exe.to_lowercase().replace('/', "\\");
                index.entry(norm).or_default().push(game.clone());
            }

            if let Some(ref install_dir) = game.install_dir {
                let dir_key = install_dir.to_string_lossy().to_lowercase().replace('/', "\\");
                let dir_key = dir_key.trim_end_matches('\\');
                let prefixed_key = format!("__dir__{}", dir_key);
                index.entry(prefixed_key).or_default().push(game.clone());
            }
        }

        self.process_index = index;
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
                },
            );
        }

        // Kick the poll loop immediately so the pending path
        // (Steam protocol / UAC / Ubisoft hand-off) detects the real
        // process within ~1 s instead of waiting for the next
        // steady-interval poll.
        self.request_immediate_poll();
    }

    /// Poll Steam library folders for installation state changes.
    fn poll_steam_install_changes(&mut self, app_handle: &AppHandle) {
        let now = Instant::now();
        if let Some(last) = self.last_steam_install_poll {
            // Re-scan throttle (registry + appmanifest_*.acf files). The
            // `steam_installed_appids` diff below only emits on actual
            // install-state changes, so a 60 s cadence is plenty.
            if now.duration_since(last) < std::time::Duration::from_secs(60) {
                return;
            }
        }

        let is_first_run = self.last_steam_install_poll.is_none();
        self.last_steam_install_poll = Some(now);

        let current_installed: std::collections::HashSet<u32> =
            crate::steam::sync::detect_installed_steam_appids()
                .into_iter()
                .collect();

        if is_first_run {
            self.steam_installed_appids = current_installed;
            return;
        }

        let newly_installed: Vec<u32> = current_installed
            .difference(&self.steam_installed_appids)
            .copied()
            .collect();

        let uninstalled: Vec<u32> = self
            .steam_installed_appids
            .difference(&current_installed)
            .copied()
            .collect();

        self.steam_installed_appids = current_installed;

        for appid in newly_installed {
            let name = self
                .process_index
                .values()
                .flatten()
                .find(|g| g.steam_app_id == Some(appid))
                .map(|g| g.game_name.clone())
                .unwrap_or_default();

            let exe_path = resolve_steam_game_exe(appid, &name);

            let _ = app_handle.emit(
                "steam-install-changed",
                SteamInstallChangedPayload {
                    app_id: appid,
                    installed: true,
                    exe_path,
                },
            );
        }

        for appid in uninstalled {
            let _ = app_handle.emit(
                "steam-install-changed",
                SteamInstallChangedPayload {
                    app_id: appid,
                    installed: false,
                    exe_path: None,
                },
            );
        }
    }

    /// Run one poll cycle. Resolves pending sessions, re-attaches sessions
    /// whose tracked process died to a still-running process in the install
    /// directory, and detects new passively-launched games.
    ///
    /// Returns the sessions that ended this cycle, already removed from
    /// `active_sessions` (via `take_active_session`), each paired with the
    /// name of any remaining active session at the time of removal. The
    /// caller runs the slow finalization (post-exit script, metrics drain,
    /// db writes, `game-exited` emit) AFTER releasing the watcher mutex.
    pub fn poll(&mut self, app_handle: &AppHandle) -> Vec<(ActiveSession, Option<String>)> {
        self.poll_steam_install_changes(app_handle);

        let processes = query_running_processes();
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
        // PID → exe-path lookup built from the same poll's process
        // snapshot. Liveness by PID alone is not enough: between 5 s polls
        // the OS can recycle a PID to an unrelated process, which would
        // keep a dead session "running" against a foreign exe — inflated
        // playtime, metrics sampling the wrong process, and `game-exited`
        // never firing until that foreign process exits. A session is only
        // currently running when its PID is alive AND still resolves to
        // the tracked exe.
        let exe_by_pid: std::collections::HashMap<u32, &str> = processes
            .iter()
            .map(|p| (p.pid, p.exe_path.as_str()))
            .collect();

        let mut ended_ids: Vec<String> = Vec::new();
        let mut transitions: Vec<(String, ProcessInfo)> = Vec::new();

        for (gid, session) in &mut self.active_sessions {
            let is_pending = session.last_pid == 0;
            let session_exe_norm = session.matched_exe.to_lowercase().replace('/', "\\");
            let is_currently_running = !is_pending
                && exe_by_pid
                    .get(&session.last_pid)
                    .map(|proc_exe| {
                        // Empty `matched_exe` (only possible for pending
                        // launches, which have last_pid == 0 and never
                        // reach this check) counts as running. Both the
                        // PID and its path come from the same `processes`
                        // snapshot, so a present PID always has a
                        // queryable path here — no PID-only fallback
                        // needed.
                        session_exe_norm.is_empty()
                            || proc_exe.to_lowercase().replace('/', "\\") == session_exe_norm
                    })
                    .unwrap_or(false);

            if is_currently_running {
                session.lost_at = None;
                continue;
            }

            // Re-attach to a still-running process for this game. The
            // tracked PID (often a launcher / bootstrapper) may have exited
            // when the real game process took over — e.g. after the player
            // clicks Play and the game goes fullscreen. `find_session_process`
            // searches the install dir first, then climbs up the directory
            // tree (shared publisher roots like `Rockstar Games\Launcher`
            // vs `Rockstar Games\GameName`), and finally falls back to an
            // exe-stem match. Without this broadening, launcher-based games
            // lose their session a few seconds after launch.
            let found_proc =
                find_session_process(&processes, session.install_dir.as_ref(), &session.matched_exe);

            if let Some(proc) = found_proc {
                session.lost_at = None;
                transitions.push((gid.clone(), proc));
            } else {
                if is_pending {
                    if session.started_at.elapsed() > PENDING_SESSION_TIMEOUT {
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
                    }
                }
            }
        }

        // Apply transitions before ending sessions so a session that
        // just found a new process is not also finished.
        for (gid, proc) in transitions {
            if let Some(session) = self.active_sessions.get_mut(&gid) {
                let was_pending = session.last_pid == 0;

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
            let norm = proc.exe_path.to_lowercase().replace('/', "\\");

            // Blacklist: never treat known non-game processes (launchers,
            // crash handlers, Wallpaper Engine's wallpaper64.exe, etc.) as a
            // launched game. Without this, a background app like Wallpaper
            // Engine that is always running would be picked up as a session
            // the moment the real game quits and its process index entry
            // matches (the running indicator would "shift" to it).
            if let Some(stem) = Path::new(&proc.exe_path)
                .file_stem()
                .and_then(|s| s.to_str())
            {
                let lower = stem.to_lowercase();
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
                        if remainder.starts_with('\\') || remainder.is_empty() {
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
            },
        );
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
    /// `non_windows` always returns `killed: false`: the
    /// cross-platform process poll in `query_running_processes()`
    /// returns an empty list on every non-Windows target today, so we
    /// have nothing to `kill` even if we pulled in `libc`. The session
    /// is still cleaned up via `finalize_session`.
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
            expected_exe_lower: session.matched_exe.to_lowercase().replace('/', "\\"),
            install_dir_lower: session.install_dir.as_ref().map(|d| {
                d.to_string_lossy()
                    .to_lowercase()
                    .replace('/', "\\")
                    .trim_end_matches('\\')
                    .to_string()
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

/// Finalize an ended game session: run the post-exit script, stop the
/// metrics collector (waiting up to 1 s for it to drain — metrics are
/// nice-to-have telemetry, not a UX blocker), record the session row +
/// `last_played` stamp in SQLite, then emit `game-exited` with the name
/// of any still-active session.
///
/// Designed to run OUTSIDE the global `Arc<Mutex<GameWatcher>>`: the
/// caller (`start_background_poll`, `force_close_game`) extracts the
/// owned session via `take_active_session` first and drops the lock
/// before invoking this, so the blocking script / recv / db work never
/// freezes IPC handlers or the background poll loop.
fn finalize_session(
    db: &db::Db,
    app_handle: &AppHandle,
    mut session: ActiveSession,
    remaining_name: Option<String>,
) {
    // Run the post-exit script (if any) before recording the session.
    // Blocking is fine — the game has already exited and the watcher
    // mutex is not held here.
    if let Some((script, admin)) = &session.post_exit_script {
        let _ = crate::run_script_blocking(script, *admin);
    }
    let _ = session.stop_tx.send(());
    let elapsed = session.started_at.elapsed().as_secs();
    let metrics = session
        .metrics_rx
        .as_mut()
        .and_then(|rx| rx.recv_timeout(std::time::Duration::from_secs(1)).unwrap_or(None));

    // Capture the wall-clock time at session-end (Unix ms). The frontend
    // uses this to stamp `Game.lastPlayed`, which drives the "Continue
    // Playing" rail on the Library page. We use the same clock the
    // frontend reads via `Date.now()` (i.e. system time, not monotonic)
    // so the value survives timezone shifts and clock corrections without
    // a re-derivation step.
    //
    // We approximate the session start as `finished_at - elapsed` since
    // `started_at` on the watcher is a monotonic `Instant` (no fixed
    // epoch) and we need wall-clock ms for the DB row.
    let finished_at_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let started_at_ms = finished_at_ms.saturating_sub(elapsed * 1000);

    // Phase 3: write the session row before emitting the event so any
    // frontend listener that reads from the DB sees a row in place.
    // Synchronous SQLite insert on a WAL pool is sub-millisecond; the
    // emit follows only after the commit returns.
    let metrics_json = metrics
        .as_ref()
        .and_then(|m| serde_json::to_string(m).ok());
    // `SessionMetrics` exposes u32 scalars directly (not Option<F>), so
    // we always populate the averages. Cast to f32 for the SQLite REAL
    // columns.
    let (avg_fps, avg_cpu, avg_gpu, avg_ram) = match metrics.as_ref() {
        Some(m) => (
            Some(m.avg_fps as f32),
            Some(m.avg_cpu_usage as f32),
            Some(m.avg_gpu_usage as f32),
            Some(m.avg_ram_usage as f32),
        ),
        None => (None, None, None, None),
    };
    if let Err(e) = db::sessions::insert(
        db,
        &session.game_id,
        &session.game_name,
        started_at_ms,
        finished_at_ms,
        elapsed,
        avg_fps,
        avg_cpu,
        avg_gpu,
        avg_ram,
        metrics_json.as_deref(),
    ) {
        eprintln!(
            "[game_watcher] failed to record session for {}: {e}",
            session.game_id
        );
    }

    // Mirror the timestamp into the games table so the Library
    // "Continue Playing" rail can sort without a JOIN. Phase 3 hot-path:
    // replaces the old full-library-rewrite triggered by save_games.
    if let Err(e) = db::games::update_last_played(db, &session.game_id, finished_at_ms) {
        eprintln!(
            "[game_watcher] failed to update last_played for {}: {e}",
            session.game_id
        );
    }

    let _ = app_handle.emit(
        "game-exited",
        GameExitPayload {
            game_id: session.game_id.clone(),
            elapsed_seconds: elapsed,
            finished_at: finished_at_ms,
            metrics,
            remaining_game_name: remaining_name,
        },
    );
}

/// Owned kill-target data produced by
/// [`GameWatcher::gather_force_close_data`] — extracted under the
/// watcher mutex so the caller can drop the lock and pass the strings
/// (which include normalized exe paths used by
/// [`kill_matching_processes`]) into the slow Win32 phase without
/// holding the global mutex.
#[derive(Debug, Clone)]
pub struct ForceCloseData {
    pub pid: u32,
    pub expected_exe_lower: String,
    pub install_dir_lower: Option<String>,
}

/// Terminate every currently-running process belonging to a game.
///
/// A process is "the game" when its exe path equals the expected
/// (normalized) exe, OR it lives inside the game's install directory
/// and is not one of the known non-game binaries (`SKIP_KEYWORDS` —
/// launchers, crash handlers, redistributables). The install-dir
/// branch lets us kill the real game even when:
///
///   * the launch was a pending session (no tracked PID yet), or
///   * the tracked PID was a launcher that already exited, or
///   * the game re-spawned under a new child PID.
///
/// Each candidate is killed via `kill_pid_if_exe_matches` (which
/// verifies the exe and escalates TerminateProcess → taskkill /T so
/// the whole process tree, including anti-cheat daemons, dies).
///
/// Returns `true` if at least one matching process was terminated.
#[cfg(windows)]
pub fn kill_matching_processes(expected_exe_lower: &str, install_dir_lower: Option<&str>) -> bool {
    let processes = query_running_processes();
    if processes.is_empty() {
        return false;
    }

    let mut killed_any = false;

    // 1. Exact tracked-exe match (fast, no install-dir assumption).
    if !expected_exe_lower.is_empty() {
        for proc in &processes {
            let path_lower = proc.exe_path.to_lowercase().replace('/', "\\");
            if path_lower == expected_exe_lower {
                if kill_pid_if_exe_matches(proc.pid, expected_exe_lower) {
                    killed_any = true;
                }
            }
        }
    }

    // 2. Install-dir match — covers pending launches and re-parented
    //    game processes that don't share the tracked exe name exactly.
    if let Some(dir) = install_dir_lower {
        if !dir.is_empty() {
            for proc in &processes {
                let path_lower = proc.exe_path.to_lowercase().replace('/', "\\");
                if !path_lower.starts_with(dir) {
                    continue;
                }
                // Ensure it's actually inside the dir, not a sibling
                // prefix (e.g. "FooBar" when looking for "Foo").
                let remainder = &path_lower[dir.len()..];
                if !remainder.is_empty() && !remainder.starts_with('\\') {
                    continue;
                }
                // Skip known non-game binaries (launchers, crash
                // handlers, redistributables) so we don't nuke a
                // harmless sibling. The game process won't be in here.
                if let Some(stem) = std::path::Path::new(&proc.exe_path)
                    .file_stem()
                    .and_then(|s| s.to_str())
                {
                    let lower = stem.to_lowercase();
                    if SKIP_KEYWORDS.iter().any(|kw| lower.contains(kw)) {
                        continue;
                    }
                }
                // Use the candidate's own exact path for the verify step.
                if kill_pid_if_exe_matches(proc.pid, &path_lower) {
                    killed_any = true;
                }
            }
        }
    }

    killed_any
}

/// Outcome of `GameWatcher::force_close`. Serialised via serde so the
/// frontend can render an accurate toast without guessing.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForceCloseResult {
    /// The PID that was tracked at the time the user clicked
    /// force-close. `0` when the session had no PID yet (pending Steam
    /// protocol / UAC). Informational; primarily used by debug logs
    /// and the toast copy ("PID N for "X") when killed.
    pub pid: u32,
    /// `true` when at least one matching process (the tracked exe and/or
    /// a live process inside the game's install dir) was terminated.
    /// The match is verified via `QueryFullProcessImageNameW` and
    /// escalates TerminateProcess → taskkill /T, so the whole process
    /// tree (anti-cheat, crash handler, VR runtime) is killed. `false`
    /// only when no live game process could be found/terminated (PID
    /// recycled, access denied, or nothing matched). The session is
    /// ALWAYS cleaned up via `finalize_session` regardless of this flag —
    /// only the toast copy diverges.
    pub killed: bool,
}

/// Windows-only helper. Re-reads the tracked PID's exe path and
/// compares it against the expected lowercase/normalized path we
/// stored in `ActiveSession.matched_exe` at launch time. Only when
/// the path matches do we escalate to killing, escalating through:
///
///   1. Direct `TerminateProcess` (fast, requires `PROCESS_TERMINATE`
///      rights on the target). Works for ~99% of games — user launches
///      the game under their own token, owns the resulting process.
///
///   2. Fallback to `taskkill /F /T /PID <pid>`. Doesn't require
///      `PROCESS_TERMINATE` because taskkill hands the kill off to
///      the SYSTEM-owned Task Scheduler service which has rights
///      the user's token doesn't. This is the escape hatch for the
///      elevation case: game launched with `runas`/UAC and our
///      GameIndex process runs at a lower integrity level, so the
///      DACL on the game's process token denies us
///      `PROCESS_TERMINATE` and TerminateProcess returns
///      `ERROR_ACCESS_DENIED`.
///
/// The `/T` flag on taskkill also nukes the process TREE (anti-cheat
/// daemon, crash handler, VR runtime, any helper that shares the
/// tracked PID as parent) which single-TerminateProcess would
/// leave orphaned. Game-level "I closed it but something is still
/// using my GPU/IO" complaints usually come from this omission.
///
/// Doing this with a QUERY handle FIRST then escalating to terminate
/// (or taskkill) is intentional: `PROCESS_QUERY_LIMITED_INFORMATION`
/// is granted more liberally than `PROCESS_TERMINATE`, so we want to
/// be sure the target IS the right process before asking for the
/// higher privilege (or shelling out a subprocess). The reverse
/// order (open terminate first, then query) would work too but
/// needlessly escalates without first confirming intent.
///
/// Returns `true` on a verified+successful kill by any path,
/// `false` on any verification or kill failure.
///
/// Anti-cheat caveat: PPL (Protected Process Light) anti-cheat
/// cannot be terminated via either path without admin / driver
/// cooperation. For those titles the kill is best-effort — the
/// user will see the warning toast and may need to close via the
/// anti-cheat's own menu or reboot the system.
#[cfg(windows)]
fn kill_pid_if_exe_matches(pid: u32, expected_exe_lower: &str) -> bool {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use windows::core::PWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, TerminateProcess,
        PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
        PROCESS_TERMINATE,
    };

    unsafe {
        // 1. Verify the PID still belongs to the process we expect.
        //    OpenProcess may fail with ERROR_ACCESS_DENIED if the
        //    tracked process has already exited AND its PID has been
        //    recycled to a system process owned by another user —
        //    in that case we cannot safely issue a kill on this PID.
        let query_handle = match OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION,
            false,
            pid,
        ) {
            Ok(h) => h,
            Err(e) => {
                eprintln!(
                    "[game_watcher] force_close: OpenProcess(query) failed for PID {pid}: {e}; cannot verify PID safety, skipping kill"
                );
                return false;
            }
        };

        let mut buf = [0u16; 1024];
        let mut size = buf.len() as u32;
        let verified = QueryFullProcessImageNameW(
            query_handle,
            PROCESS_NAME_WIN32,
            PWSTR::from_raw(buf.as_mut_ptr()),
            &mut size,
        )
        .is_ok()
            && {
                let actual = OsString::from_wide(&buf[..size as usize])
                    .to_string_lossy()
                    .to_string()
                    .to_lowercase()
                    .replace('/', "\\");
                actual == expected_exe_lower
            };
        let _ = CloseHandle(query_handle);

        if !verified {
            eprintln!(
                "[game_watcher] force_close: PID {pid} exe path no longer matches tracked session; PID likely recycled. Skipping kill."
            );
            return false;
        }

        // 2. PID verified — escalate to direct TerminateProcess.
        //    Fast and synchronous in the typical case (game running
        //    under our token). On access-denied (game elevated above
        //    us, or DACL denied) fall through to taskkill which uses
        //    SYSTEM-level Task Scheduler service rights.
        let term_handle = match OpenProcess(PROCESS_TERMINATE, false, pid) {
            Ok(h) => h,
            Err(e) => {
                eprintln!(
                    "[game_watcher] force_close: OpenProcess(terminate) failed for PID {pid}: {e}; falling back to taskkill"
                );
                return try_taskkill(pid);
            }
        };
        if TerminateProcess(term_handle, 0).is_ok() {
            let _ = CloseHandle(term_handle);
            eprintln!(
                "[game_watcher] force-closed PID {pid} via TerminateProcess"
            );
            return true;
        }
        let _ = CloseHandle(term_handle);
        eprintln!(
            "[game_watcher] force_close: TerminateProcess returned false for PID {pid}; falling back to taskkill"
        );
    }

    // 3. Fallback for elevated/process-tree cases — see helper.
    try_taskkill(pid)
}

/// Win32 fallback: `taskkill /F /T /PID <pid>`. Returns true on
/// exit-code 0, false otherwise.
///
/// The `/F` switch forces termination (kills the process even if
/// it's hung in a non-responding window). The `/T` switch kills the
/// entire process tree (parent + children), which matters for
/// games with separate processes for the launcher, anti-cheat
/// daemon, VR runtime, crash reporter — a single TerminateProcess
/// on the parent leaves those orphaned and still consuming GPU/IO
/// until they notice their parent is gone (EAC/BattleEye especially
/// are notorious for this — "I closed the game but my fans are
/// still spinning at 100%").
///
/// Why we shell out: invoking taskkill.exe means spawning a child
/// Rust process, paying the CreateProcess + stdio pipe cost (~50ms
/// cold, ~10ms warm). We could use `NtTerminateProcess` / the
/// Task Scheduler COM API to avoid that, but taskkill.exe is what
/// every Microsoft / Steam / Epic-process tool calls here, is
/// present on every Windows install since XP, and side-steps the
/// 32/64-bit token + privilege juggling that would be required to
/// inline it. Trailing whitespace in the search path is benign
/// — `Command::new("taskkill")` relies on PATH resolution, which
/// for `%SystemRoot%\System32` is always present in the default
/// user's PATH.
#[cfg(windows)]
fn try_taskkill(pid: u32) -> bool {
    use std::process::Command;
    let pid_str = pid.to_string();

    match Command::new("taskkill")
        .args(["/F", "/T", "/PID", &pid_str])
        .output()
    {
        Ok(output) => {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                eprintln!(
                    "[game_watcher] taskkill /F /T /PID {} succeeded: {}",
                    pid,
                    stdout.trim()
                );
                true
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                let stdout = String::from_utf8_lossy(&output.stdout);
                eprintln!(
                    "[game_watcher] taskkill /F /T /PID {} failed: exit={:?} stdout={} stderr={}",
                    pid,
                    output.status.code(),
                    stdout.trim(),
                    stderr.trim()
                );
                false
            }
        }
        Err(e) => {
            eprintln!(
                "[game_watcher] force_close: failed to invoke taskkill for PID {pid}: {e}"
            );
            false
        }
    }
}

// ─── Shared Types ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameExitPayload {
    #[serde(rename = "gameId")]
    pub game_id: String,
    #[serde(rename = "elapsedSeconds")]
    pub elapsed_seconds: u64,
    /// Unix-millisecond timestamp captured at session-end (when the
    /// process actually exited). The frontend uses this to stamp
    /// `Game.lastPlayed`, which drives the "Continue Playing" rail on
    /// the Library page. `0` is treated as "unknown" and skipped
    /// upstream so an unset system clock doesn't poison the value.
    #[serde(rename = "finishedAt")]
    pub finished_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metrics: Option<metrics_collector::SessionMetrics>,
    /// When another session is still active after this one ends, this
    /// carries that session's game name so tray / overlay listeners
    /// can update their status line without re-locking the watcher.
    /// `None` means no remaining sessions → the tray flips to idle.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remaining_game_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameStartedPayload {
    #[serde(rename = "gameId")]
    pub game_id: String,
    #[serde(rename = "gameName")]
    pub game_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detected_exe: Option<String>,
}

#[derive(Debug, Clone)]
struct ProcessInfo {
    pid: u32,
    exe_path: String,
    /// Working set size in bytes; used to pick the dominant process
    /// when multiple candidates live inside the same install directory.
    working_set_size: u64,
}

/// Query running processes natively using Toolhelp32 snapshot.
/// This is 1000x faster than WMI, handles UAC elevated processes via
/// PROCESS_QUERY_LIMITED_INFORMATION, and does not depend on COM or WMI service availability.
#[cfg(windows)]
fn query_running_processes() -> Vec<ProcessInfo> {
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW, PROCESS_NAME_WIN32};
    use windows::Win32::System::ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
    use windows::Win32::Foundation::CloseHandle;
    use std::os::windows::ffi::OsStringExt;

    let mut result = Vec::new();

    unsafe {
        let snapshot = match CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) {
            Ok(h) => h,
            Err(_) => return Vec::new(),
        };

        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };

        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                let pid = entry.th32ProcessID;
                if pid != 0 {
                    if let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
                        let mut buffer = [0u16; 1024];
                        let mut size = buffer.len() as u32;
                        if QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, windows::core::PWSTR::from_raw(buffer.as_mut_ptr()), &mut size).is_ok() {
                            let path = std::ffi::OsString::from_wide(&buffer[..size as usize])
                                .to_string_lossy()
                                .into_owned();

                            let mut counters = PROCESS_MEMORY_COUNTERS::default();
                            let working_set = if GetProcessMemoryInfo(
                                handle,
                                &mut counters,
                                std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32,
                            ).is_ok() {
                                counters.WorkingSetSize as u64
                            } else {
                                0
                            };

                            result.push(ProcessInfo {
                                pid,
                                exe_path: path,
                                working_set_size: working_set,
                            });
                        }
                        let _ = CloseHandle(handle);
                    }
                }

                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snapshot);
    }

    result
}

#[cfg(not(windows))]
fn query_running_processes() -> Vec<ProcessInfo> {
    Vec::new()
}

/// Helper to extract the game's root directory from an executable path,
/// walking up out of common binary or helper subfolders to prevent
/// launcher vs. game process sibling directory path mismatches.
fn get_game_root_dir(exe_path: &Path) -> Option<PathBuf> {
    let mut current = exe_path.parent()?;
    const COMMON_SUBDIRS: &[&str] = &[
        "bin", "binaries", "win64", "win32", "x64", "x86", "release", "debug",
        "win-x64", "win-x86", "game", "retail", "launcher",
    ];
    // Walk up as long as the current directory name is a common binary/launcher folder,
    // up to a maximum of 3 levels.
    for _ in 0..3 {
        if let Some(name) = current.file_name().and_then(|n| n.to_str()) {
            let lower = name.to_lowercase();
            if COMMON_SUBDIRS.iter().any(|&item| item == lower) {
                if let Some(parent) = current.parent() {
                    current = parent;
                    continue;
                }
            }
        }
        break;
    }
    Some(current.to_path_buf())
}

/// Locate a still-running process for an active session when the tracked
/// PID has gone missing (the launcher / bootstrapper exited and handed off
/// to the real game — commonly right as the game goes fullscreen).
///
/// Search strategy, in priority order:
///   1. The session's `install_dir` (the original behaviour).
///   2. Progressively higher parent directories (up to 3 levels). This
///      catches publisher launchers that install their games in a *sibling*
///      folder under a shared root — e.g. `Rockstar Games\Launcher` launches
///      `Rockstar Games\Grand Theft Auto V`, or `Ubisoft\UbisoftConnect`
///      launches `Ubisoft\GameName`. Without this step the watcher never
///      re-attaches and the session is ended a few seconds after launch.
///   3. As a last resort, any running process whose exe stem exactly matches
///      the session's tracked exe stem (handles games that relaunch the same
///      binary under a different path). Candidates are restricted to the
///      install-dir tree (and its parents) so an unrelated title with a
///      similar name is never grabbed.
///
/// Skip-keyword executables (launchers, crash handlers, etc.) are always
/// excluded from every tier.
fn find_session_process(
    processes: &[ProcessInfo],
    install_dir: Option<&PathBuf>,
    matched_exe: &str,
) -> Option<ProcessInfo> {
    // Tier 1: the session's own install dir.
    if let Some(dir) = install_dir {
        if let Some(p) = find_best_process_in_dir(processes, dir) {
            return Some(p);
        }

        // Tier 2: climb the directory tree (max 3 levels) to catch sibling
        // publisher folders.
        let mut cur = dir.parent();
        for _ in 0..3 {
            match cur {
                Some(p) if !p.as_os_str().is_empty() => {
                    if let Some(found) = find_best_process_in_dir(processes, p) {
                        return Some(found);
                    }
                    cur = p.parent();
                }
                _ => break,
            }
        }
    }

    // Tier 3: exact exe-stem match, restricted to the install-dir tree.
    let stem = Path::new(matched_exe)
        .file_stem()
        .and_then(|s| s.to_str())
        .map(|s| s.to_lowercase());
    if let Some(lower) = stem {
        if !lower.is_empty() && !SKIP_KEYWORDS.iter().any(|kw| lower.contains(kw)) {
            if let Some(dir_lower) = install_dir.map(|d| {
                d.to_string_lossy()
                    .to_lowercase()
                    .replace('/', "\\")
                    .trim_end_matches('\\')
                    .to_string()
            }) {
                let mut best: Option<(u64, ProcessInfo)> = None;
                for p in processes {
                    let pstem = match Path::new(&p.exe_path).file_stem().and_then(|s| s.to_str()) {
                        Some(s) => s.to_lowercase(),
                        None => continue,
                    };
                    if SKIP_KEYWORDS.iter().any(|kw| pstem.contains(kw)) {
                        continue;
                    }
                    if pstem != lower {
                        continue;
                    }
                    // Keep the candidate within the install-dir tree (or its
                    // parents) to avoid stealing an unrelated game.
                    let pl = p.exe_path.to_lowercase().replace('/', "\\");
                    if pl.starts_with(&dir_lower) {
                        let score = p.working_set_size;
                        if best.as_ref().map(|(s, _)| score > *s).unwrap_or(true) {
                            best = Some((score, p.clone()));
                        }
                        continue;
                    }
                    let mut cur = install_dir.and_then(|d| d.parent());
                    let mut within = false;
                    for _ in 0..4 {
                        if let Some(pp) = cur {
                            let pp_l = pp
                                .to_string_lossy()
                                .to_lowercase()
                                .replace('/', "\\")
                                .trim_end_matches('\\')
                                .to_string();
                            if !pp_l.is_empty() && pl.starts_with(&pp_l) {
                                within = true;
                                break;
                            }
                            cur = pp.parent();
                        } else {
                            break;
                        }
                    }
                    if within {
                        let score = p.working_set_size;
                        if best.as_ref().map(|(s, _)| score > *s).unwrap_or(true) {
                            best = Some((score, p.clone()));
                        }
                    }
                }
                if let Some((_, p)) = best {
                    return Some(p);
                }
            }
        }
    }

    None
}

/// Find the best running process inside an install directory. Prefers
/// executables whose stem does not contain known non-game keywords
/// (launchers, crash handlers, etc.) and, when multiple candidates
/// remain, picks the one with the largest working set.
fn find_best_process_in_dir(processes: &[ProcessInfo], install_dir: &Path) -> Option<ProcessInfo> {
    let dir_lower = install_dir
        .to_string_lossy()
        .to_lowercase()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_string();

    if dir_lower.is_empty() {
        return None;
    }

    let mut candidates: Vec<ProcessInfo> = processes
        .iter()
        .filter(|p| {
            let path_lower = p.exe_path.to_lowercase().replace('/', "\\");
            if !path_lower.starts_with(&dir_lower) {
                return false;
            }
            // Make sure the match is actually inside the directory, not a
            // sibling path that happens to share the prefix (e.g. "FooBar"
            // when looking for "Foo").
            let remainder = &path_lower[dir_lower.len()..];
            remainder.starts_with('\\') || remainder.is_empty()
        })
        .cloned()
        .collect();

    if candidates.is_empty() {
        return None;
    }

    // Prefer executables that are not launchers/crash handlers/etc.
    let skip_filtered: Vec<ProcessInfo> = candidates
        .iter()
        .filter(|p| {
            if let Some(stem) = Path::new(&p.exe_path).file_stem().and_then(|s| s.to_str()) {
                let lower = stem.to_lowercase();
                !SKIP_KEYWORDS.iter().any(|kw| lower.contains(kw))
            } else {
                true
            }
        })
        .cloned()
        .collect();

    // Skip-keyword executables (launchers, crash handlers, Wallpaper
    // Engine, etc.) are NEVER the game we're looking for. If every
    // candidate matches a skip keyword we return None rather than
    // picking one — without this guard a lone wallpaper64.exe (or
    // similar background app) in a parent directory like
    // `…\steamapps\common\` would be chosen as the "best process".
    if skip_filtered.is_empty() {
        return None;
    }
    candidates = skip_filtered;

    candidates.sort_by(|a, b| b.working_set_size.cmp(&a.working_set_size));
    candidates.into_iter().next()
}

// ─── Background Poll Thread ───────────────────────────────────────────────────

pub fn start_background_poll(
    watcher: Arc<Mutex<GameWatcher>>,
    app_handle: AppHandle,
) {
    // Wake channel: lets a launch (or session transition) request an
    // immediate poll instead of waiting out the full sleep.
    let (wake_tx, wake_rx) = std::sync::mpsc::channel::<()>();

    // Wire the sender into the watcher so `request_immediate_poll` works.
    {
        let mut w = match watcher.lock() {
            Ok(w) => w,
            Err(_) => return,
        };
        w.set_wake_sender(wake_tx);
    }

    std::thread::spawn(move || loop {
        // Fast poll while a launch is still pending; steady otherwise.
        // Drains any pending wake signals first so a recent launch is
        // picked up on the very next cycle.
        let interval = {
            let w = match watcher.lock() {
                Ok(w) => w,
                Err(_) => break,
            };
            w.current_poll_interval()
        };
        // Drop stale wake signals accumulated during the sleep window.
        while wake_rx.try_recv().is_ok() {}

        let mut w = match watcher.lock() {
            Ok(w) => w,
            Err(_) => break,
        };
        // `poll` removes ended sessions from the map but defers the slow
        // finalization to us; grab a cheap `Db` clone and drop the mutex
        // so the post-exit script / 1 s metrics drain / SQLite writes
        // below never block IPC handlers or the next poll cycle.
        let ended_sessions = w.poll(&app_handle);

        // Re-evaluate interval after polling: if we just cleared the last
        // pending session, settle back to the steady interval promptly.
        let next_interval = w.current_poll_interval();
        let db = w.db_clone();
        drop(w);

        // Finalize ended sessions outside the watcher lock — mirrors the
        // force-close path (take_active_session → finalize).
        for (session, remaining_name) in ended_sessions {
            finalize_session(&db, &app_handle, session, remaining_name);
        }

        let wait = if next_interval < interval {
            next_interval
        } else {
            interval
        };

        // Sleep until either the interval elapses or a wake arrives.
        match wake_rx.recv_timeout(wait) {
            Ok(()) | Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        }
    });
}

// ─── Smarter Exe Resolution ───────────────────────────────────────────────────

const SKIP_KEYWORDS: &[&str] = &[
    // Redistributables & runtimes
    "redist", "vcredist", "dotnet", "dxsetup", "directx",
    "ue4prereq", "ue4-prereq", "ue5prereq", "ue5-prereq",
    "physx", "openal",
    // Launchers & patchers
    "launcher", "patcher", "updater", "bootstrapper",
    // Crash handlers & telemetry
    "crash", "crashpad", "crashreport", "crashhandler",
    "errorreport", "bugreport", "debug",
    // Uninstallers
    "unin", "unins", "uninstall", "unwise",
    // Setup/Install
    "setup", "install", "register",
    // Utilities
    "helper", "autorun", "plugin", "manual", "readme", "7za",
    "config", "configuration", "settings",
    // Steam-specific
    "steamclient", "steamerror",
    // Unity
    "unitycrashhandler", "unitycrashhandler64",
    "videoplayer",
    // Unreal
    "ue4_game", "ue5_game",
    // Known non-game processes
    "gamingservices", "gamingservice",
    "eadesktop", "origin", "ubisoftconnect", "upc",
    "epicgameslauncher", "galaxyclient",
    // Wallpaper Engine — always-running background app that must never be
    // tracked as a game (covers wallpaper64.exe / wallpaper32.exe).
    "wallpaper",
];

/// Resolve the main game executable for a given install directory.
///
/// Multi-strategy approach:
/// 1. Name match scoring against the provided game_name (+200 exact, +10 per word)
/// 2. Directory depth: prefer shallower exes (-5 per level below root)
/// 3. Keyword exclusion (handled during scan)
/// 4. Size: largest as tiebreaker
pub fn resolve_game_exe(install_dir: &Path, game_name: &str) -> Option<String> {
    let candidates = scan_for_exe_candidates(install_dir);
    if candidates.is_empty() {
        return None;
    }

    let game_name_lower = game_name.to_lowercase();
    let game_words: Vec<&str> = game_name_lower
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .filter(|w| w.len() > 1)
        .collect();

    let mut scored: Vec<(&ExeCandidate, u32)> = candidates
        .iter()
        .map(|c| {
            let stem = Path::new(&c.path)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_lowercase();

            let mut score: u32 = 0;

            // Name match scoring
            if stem == game_name_lower {
                score += 200;
            }
            let stem_words: Vec<&str> = stem
                .split(|c: char| !c.is_alphanumeric())
                .filter(|w| !w.is_empty())
                .collect();
            for gw in &game_words {
                for sw in &stem_words {
                    if sw.contains(gw) || gw.contains(sw) {
                        score += 10;
                    }
                }
            }

            // Directory depth penalty
            let depth_penalty = (c.depth.saturating_sub(1) * 5) as u32;
            score = score.saturating_sub(depth_penalty);

            (c, score)
        })
        .collect();

    scored.sort_by(|(a, a_score), (b, b_score)| {
        b_score
            .cmp(a_score)
            .then_with(|| b.size_bytes.cmp(&a.size_bytes))
    });

    scored.first().map(|(c, _)| c.path.clone())
}

fn scan_for_exe_candidates(dir: &Path) -> Vec<ExeCandidate> {
    let mut candidates = Vec::new();
    scan_dir_for_candidates(dir, &mut candidates, 0);
    candidates
}

fn scan_dir_for_candidates(dir: &Path, candidates: &mut Vec<ExeCandidate>, depth: u32) {
    if depth > 4 {
        return;
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                let lower = name.to_lowercase();
                if lower.starts_with('.')
                    || lower.starts_with('_')
                    || lower == "redist"
                    || lower == "redistributables"
                    || lower == "__installer"
                    || lower == "support"
                    || lower == "directx"
                    || lower == "dotnet"
                    || lower == "vcredist"
                {
                    continue;
                }
            }
            scan_dir_for_candidates(&path, candidates, depth + 1);
        } else if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            if !ext.eq_ignore_ascii_case("exe") {
                continue;
            }

            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                let lower = stem.to_lowercase();
                if SKIP_KEYWORDS.iter().any(|kw| lower.contains(kw)) {
                    continue;
                }
            }

            if let Ok(meta) = entry.metadata() {
                candidates.push(ExeCandidate {
                    path: path.to_string_lossy().to_string(),
                    size_bytes: meta.len(),
                    name_score: 0.0,
                    depth,
                });
            }
        }
    }
}

/// Convenience wrapper: resolve the exe for a Steam AppID.
pub fn resolve_steam_game_exe(steam_app_id: u32, game_name: &str) -> Option<String> {
    let install_dir = steam_game_watcher::game_install_path(steam_app_id)?;
    if !install_dir.exists() {
        return None;
    }
    resolve_game_exe(&install_dir, game_name)
}

/// Build GameRef entries from a list of game data structs.
///
/// Emulator ROMs are filtered out: every ROM of an emulator carries the
/// emulator's executable as its `exe_path`, so keeping them in the process
/// index would make one running emulator process match every ROM — fanning
/// out into N passive sessions (one per ROM) that all get recorded on exit.
/// ROM sessions are only ever tracked through the app-launch path, which
/// registers the exact game_id and never consults the process index.
pub fn build_game_refs_from_library(games: &[GameRefInput]) -> Vec<GameRef> {
    games
        .iter()
        .filter(|g| g.emulator_id.is_none())
        .map(|g| {
            let install_dir = if g.platform == "Steam" {
                g.steam_app_id
                    .and_then(|id| steam_game_watcher::game_install_path(id))
                    .or_else(|| {
                        if !g.exe_path.is_empty() {
                            get_game_root_dir(Path::new(&g.exe_path))
                        } else {
                            None
                        }
                    })
            } else if !g.exe_path.is_empty() {
                get_game_root_dir(Path::new(&g.exe_path))
            } else {
                None
            };

            GameRef {
                game_id: g.game_id.clone(),
                game_name: g.game_name.clone(),
                platform: g.platform.clone(),
                exe_path: if g.exe_path.is_empty() {
                    None
                } else {
                    Some(g.exe_path.clone())
                },
                install_dir,
                steam_app_id: g.steam_app_id,
            }
        })
        .collect()
}

// Inbound payload from the frontend `rebuild_watcher_index` Tauri
// command. The JS sender (GameContext.tsx) sends camelCase keys
// (`gameId`, `gameName`, `exePath`, `steamAppId`); without this
// attribute serde would reject the payload as missing `game_id`
// etc. Every other inbound Tauri struct in lib.rs already uses
// `rename_all = "camelCase"` — this one was the outlier and tripped
// the IPC deserializer on every startup of a populated library.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameRefInput {
    pub game_id: String,
    pub game_name: String,
    pub platform: String,
    pub exe_path: String,
    pub steam_app_id: Option<u32>,
    /// Emulator linkage when the game is a scanned ROM. Every ROM of one
    /// emulator shares the emulator's executable as its exe path, so a
    /// single running emulator process would match every ROM in the
    /// process index. Emulator games are excluded from passive detection
    /// (see `build_game_refs_from_library`) — only app-launched sessions
    /// (which register the exact game_id via `register_launched_session`)
    /// record ROM sessions.
    pub emulator_id: Option<String>,
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_skip_keywords_cover_known_patterns() {
        let bad_names = [
            "vcredist_x64", "UE4PrereqSetup", "UnityCrashHandler64",
            "CrashReportClient", "unins000", "dotnetfx35", "launcher",
            "patcher", "updater", "dxsetup", "wallpaper64",
        ];
        for name in bad_names {
            assert!(
                SKIP_KEYWORDS.iter().any(|kw| name.to_lowercase().contains(kw)),
                "SKIP_KEYWORDS should cover '{}'",
                name
            );
        }
    }

    #[test]
    fn test_skip_keywords_dont_match_game_names() {
        let good_names = [
            "witcher3", "Cyberpunk2077", "EldenRing", "BaldursGate3",
            "RedDeadRedemption2", "gtav", "cs2", "RocketLeague",
            "Hades2", "Starfield",
        ];
        for name in good_names {
            assert!(
                !SKIP_KEYWORDS.iter().any(|kw| name.to_lowercase().contains(kw)),
                "'{}' should NOT be excluded by SKIP_KEYWORDS",
                name
            );
        }
    }

    #[test]
    fn test_name_scoring_exact_match() {
        let exact = ExeCandidate {
            path: "C:\\Games\\EldenRing\\EldenRing.exe".to_string(),
            size_bytes: 100_000,
            name_score: 0.0,
            depth: 1,
        };
        let partial = ExeCandidate {
            path: "C:\\Games\\EldenRing\\Binaries\\Win64\\eldenring.exe".to_string(),
            size_bytes: 200_000,
            name_score: 0.0,
            depth: 3,
        };
        // exact: +200 (stem == name) +10 (word overlap) = 210
        // partial: +10 (word overlap) - 10 (depth 3 → penalty 10) = 0
        let exact_score: u32 = 200 + 10;
        let partial_score: u32 = 10_i32.saturating_sub(10) as u32;
        assert!(exact_score > partial_score);
    }

    #[test]
    fn test_get_game_root_dir_heuristics() {
        assert_eq!(
            get_game_root_dir(Path::new("C:\\Games\\GameName\\game.exe")),
            Some(PathBuf::from("C:\\Games\\GameName"))
        );
        assert_eq!(
            get_game_root_dir(Path::new("C:\\Games\\GameName\\binaries\\win64\\game.exe")),
            Some(PathBuf::from("C:\\Games\\GameName"))
        );
        assert_eq!(
            get_game_root_dir(Path::new("C:\\Games\\GameName\\game\\bin\\x64\\game.exe")),
            Some(PathBuf::from("C:\\Games\\GameName"))
        );
        assert_eq!(
            get_game_root_dir(Path::new("C:\\Games\\GameName\\MySubFolder\\game.exe")),
            Some(PathBuf::from("C:\\Games\\GameName\\MySubFolder"))
        );
    }

    #[test]
    fn test_emulator_games_excluded_from_passive_index() {
        // All ROMs of one emulator share the emulator exe as their path.
        // They must NOT enter the process index: one running emulator
        // process would otherwise match every ROM and record a phantom
        // session for each on exit.
        let input = vec![
            GameRefInput {
                game_id: "emu-rom-1".to_string(),
                game_name: "Super Mario Bros".to_string(),
                platform: "NES".to_string(),
                exe_path: "C:\\Emulators\\RetroArch\\retroarch.exe".to_string(),
                steam_app_id: None,
                emulator_id: Some("emu-nes".to_string()),
            },
            GameRefInput {
                game_id: "emu-rom-2".to_string(),
                game_name: "Zelda".to_string(),
                platform: "NES".to_string(),
                exe_path: "C:\\Emulators\\RetroArch\\retroarch.exe".to_string(),
                steam_app_id: None,
                emulator_id: Some("emu-nes".to_string()),
            },
            GameRefInput {
                game_id: "steam-1".to_string(),
                game_name: "Skyrim".to_string(),
                platform: "Steam".to_string(),
                exe_path: "C:\\Steam\\steamapps\\common\\Skyrim\\Skyrim.exe".to_string(),
                steam_app_id: Some(489830),
                emulator_id: None,
            },
        ];

        let refs = build_game_refs_from_library(&input);
        assert_eq!(refs.len(), 1, "only non-emulator games may enter the index");
        assert_eq!(refs[0].game_id, "steam-1");
    }
}
