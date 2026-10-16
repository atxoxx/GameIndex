use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::AppHandle;

use crate::db::{self};
use crate::metrics_collector;

use super::*;
use super::process::query_running_processes;
use super::session::finalize_session;
use super::steam_install::run_steam_install_scan;

/// How long a pending session (last_pid == 0) may exist before it is
/// considered failed and ended. Pending sessions cover every launch
/// that hasn't produced a process yet: Steam protocol launches
/// (including the user-gated `steam://launch/<appid>/dialog` picker,
/// which can sit open indefinitely while the user decides which
/// action/exe to run), slow UAC elevation prompts, and launcher
/// hand-offs. 10 minutes keeps the session alive through those
/// user-gated / slow-start paths while still eventually ending a
/// launch that never actually started a game.
pub(crate) const PENDING_SESSION_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(600);

/// Steady-state poll interval when no session is in a "hot" state
/// (e.g. a pending launch awaiting its process). 5 s is cheap and
/// sufficient for normal start/exit detection.
pub(crate) const POLL_INTERVAL_STEADY: std::time::Duration = std::time::Duration::from_secs(5);

/// Fast poll interval used while a session needs tighter tracking: a
/// pending launch that hasn't produced a process yet (Steam protocol,
/// UAC elevation, Ubisoft hand-off), or a session inside its post-loss
/// grace window. Either way we want to resolve the state within ~1 s
/// instead of waiting up to POLL_INTERVAL_STEADY.
pub(crate) const POLL_INTERVAL_FAST: std::time::Duration = std::time::Duration::from_secs(1);

/// Poll interval when no session is active at all. The loop still has to
/// run — it passively detects games launched outside GameIndex — but a
/// full process snapshot with nothing running is wasted work, so idle
/// polls relax to this cadence. App-launched sessions never wait on it:
/// launches wake the loop immediately (see `request_immediate_poll`).
/// Passive detection of an externally launched game therefore starts
/// ≤60 s later, which only delays session start — recorded playtime is
/// anchored at attach, so nothing is lost.
pub(crate) const POLL_INTERVAL_IDLE: std::time::Duration = std::time::Duration::from_secs(60);

/// Minimum interval between periodic Steam install scans (registry +
/// `appmanifest_*.acf` reads). The scan exists only to notice installs/
/// uninstalls that happened *outside* GameIndex; both are rare events,
/// so a 5-minute convergence window is plenty and cuts the periodic
/// disk pokes (and the HDD spin-ups they cause) 5x versus the old 60 s.
/// Library mutations and the first/reconcile scan bypass this throttle
/// entirely (see `steam_baseline_dirty` and `request_immediate_poll`),
/// so in-app install/uninstall detection stays immediate.
pub(crate) const STEAM_INSTALL_SCAN_INTERVAL: std::time::Duration = std::time::Duration::from_secs(300);

/// Grace period once a tracked process goes missing before the session
/// is ended. A lost session polls at POLL_INTERVAL_FAST, so this window
/// is now measured at 1 s resolution and still spans several process
/// snapshots — enough to absorb a launcher hand-off or one bad snapshot
/// — while a normal quit no longer holds the running indicator and
/// last-played stamp for 10-15 s. The re-attach window (looking for
/// another live process in the install dir) still runs first.
pub(crate) const SESSION_LOST_GRACE: std::time::Duration = std::time::Duration::from_secs(3);

/// How often the poll loop emits `game-progress` heartbeats and persists
/// the durable in-progress `sessions` row. 30 s bounds crash-loss to half
/// a minute while keeping DB writes negligible (a few rows per tick).
pub(crate) const HEARTBEAT_INTERVAL: std::time::Duration = std::time::Duration::from_secs(30);

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

    std::thread::spawn(move || {
        // Anchor for the periodic heartbeat (game-progress + durable
        // running-row persistence), scoped to this thread.
        let mut last_heartbeat = Instant::now();
        loop {
        // Fast poll while a launch is pending or a lost session is in its
        // grace window; steady otherwise. Drains any pending wake signals
        // first so a recent launch is picked up on the very next cycle.
        let interval = {
            let w = match watcher.lock() {
                Ok(w) => w,
                Err(_) => break,
            };
            w.current_poll_interval()
        };
        // Drop stale wake signals accumulated during the sleep window.
        while wake_rx.try_recv().is_ok() {}

        // Slow work with the watcher lock released: the native process
        // enumeration and the (throttled) Steam manifest scan. Each takes
        // a short lock only to read its inputs or apply its result, so
        // launch / force-close IPC no longer waits on a full process
        // snapshot or a library-folder scan.
        let (steam_inputs, mem_scan) = {
            let mut w = match watcher.lock() {
                Ok(w) => w,
                Err(_) => break,
            };
            (w.steam_install_scan_inputs(), w.memory_scan_filter())
        };
        let steam_scan =
            steam_inputs.map(|inputs| run_steam_install_scan(inputs, &app_handle));
        // Enumerate processes AFTER the slow Steam scan, immediately before
        // the final lock: taking the snapshot first would leave it stale for
        // the entire scan duration, worsening the enumeration→lock gap and
        // the launcher→game hand-off race (a new game PID the snapshot
        // predates reads as "not running" and strands the session).
        let processes = query_running_processes(&mem_scan);

        let mut w = match watcher.lock() {
            Ok(w) => w,
            Err(_) => break,
        };
        if let Some((current, missing_reported)) = steam_scan {
            w.apply_steam_install_scan(current, missing_reported);
        }
        // `apply_poll` removes ended sessions from the map but defers the
        // slow finalization to us; grab a cheap `Db` clone and drop the
        // mutex so the post-exit script / 1 s metrics drain / SQLite
        // writes below never block IPC handlers or the next poll cycle.
        let ended_sessions = w.apply_poll(&app_handle, processes);

        // Re-evaluate interval after polling: if this cycle cleared the
        // last pending session — or a session just went missing and needs
        // the fast cadence — settle on that interval promptly.
        let next_interval = w.current_poll_interval();
        // Nothing running → relax to the idle cadence for the next sleep.
        // Passive detection still needs periodic polls, so this backs off
        // rather than stopping entirely.
        let no_active_sessions = w.active_sessions.is_empty();

        // Periodic heartbeat: emit `game-progress` for every attached
        // session and snapshot the durable running rows to persist below
        // (DB writes stay outside the watcher mutex).
        let heartbeat_rows = if last_heartbeat.elapsed() >= HEARTBEAT_INTERVAL {
            last_heartbeat = Instant::now();
            w.snapshot_running_rows(&app_handle)
        } else {
            Vec::new()
        };

        let db = w.db_clone();
        drop(w);

        // Finalize ended sessions outside the watcher lock — mirrors the
        // force-close path (take_active_session → finalize).
        for (session, remaining_name) in ended_sessions {
            finalize_session(&db, &app_handle, session, remaining_name);
        }

        // Persist the running-row snapshots captured above. Benign race:
        // a concurrent force-close could finalize a session between the
        // snapshot and this write, re-orphaning a running row — it is
        // reconciled (back-dated) by finalize_orphaned_running on next
        // startup, and only loses sub-heartbeat playtime.
        for row in heartbeat_rows {
            let (avg_fps, avg_cpu, avg_gpu, avg_ram, metrics_json) =
                metrics_collector::persist_parts(row.metrics.as_ref());
            if let Err(e) = db::sessions::upsert_running(
                &db,
                &row.game_id,
                &row.game_name,
                row.started_at_ms,
                row.elapsed_seconds,
                avg_fps,
                avg_cpu,
                avg_gpu,
                avg_ram,
                metrics_json.as_deref(),
            ) {
                eprintln!(
                    "[game_watcher] failed to persist running session for {}: {e}",
                    row.game_id
                );
            }
        }

        let wait = if no_active_sessions {
            POLL_INTERVAL_IDLE
        } else if next_interval < interval {
            next_interval
        } else {
            interval
        };

        // Sleep until either the interval elapses or a wake arrives.
        match wake_rx.recv_timeout(wait) {
            Ok(()) | Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        }
        }
    });
}

// ─── Smarter Exe Resolution ───────────────────────────────────────────────────
