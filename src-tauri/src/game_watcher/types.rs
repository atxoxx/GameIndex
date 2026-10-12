use serde::Serialize;
use std::path::PathBuf;
use std::time::Instant;

use crate::metrics_collector;


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
    /// Library's `installed` flag at the last index rebuild. The Steam
    /// install scan uses it as the baseline so an install/uninstall that
    /// happened while the app was closed is detected on the next scan
    /// (and so a not-installed owned game is never mistaken for one).
    pub installed: bool,
}

/// Library-declared Steam game, captured at watcher-index rebuild time.
/// Only Steam games carry an AppID, so this doubles as the set the
/// install scan is allowed to emit transitions for.
#[derive(Debug, Clone)]
pub(crate) struct SteamLibraryGame {
    pub(crate) name: String,
    pub(crate) installed: bool,
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
    /// When the session's process was first actually observed running
    /// (the attach instant). `None` while the session is still pending
    /// (last_pid == 0 — no process captured yet). Playtime is measured
    /// from this instant, NOT `started_at`, so a launch that spends
    /// minutes in a user-gated Steam dialog / slow UAC prompt before
    /// the game appears doesn't count that waiting time as playtime.
    pub attached_at: Option<Instant>,
    /// Wall-clock Unix-ms timestamp of the attach instant. Anchored
    /// alongside `attached_at` so the durable running-session row and the
    /// `game-progress` heartbeat can report a stable `started_at` without
    /// re-deriving it from a monotonic `Instant`.
    pub attached_at_ms: u64,
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

impl ActiveSession {
    /// Playtime in whole seconds, measured from the attach instant —
    /// when the session's process was first actually observed running.
    /// A session that never attached (pending launch that timed out)
    /// reports `0`.
    pub fn elapsed_seconds(&self) -> u64 {
        self.attached_at
            .map(|t| t.elapsed().as_secs())
            .unwrap_or(0)
    }
}

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
    /// OS process id of the game process, or `0` while a launch is still
    /// pending (the real PID isn't known yet). Carried on the event because
    /// `game-started` is emitted while the watcher mutex is held, so listeners
    /// (the in-game overlay) must not re-lock the watcher to resolve it.
    #[serde(default)]
    pub pid: u32,
}

/// Payload for the periodic "game-progress" heartbeat emitted by the poll
/// loop. Carries the attach-anchored elapsed playtime so the frontend can
/// show a live session timer (and so the durable running row stays fresh).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameProgressPayload {
    #[serde(rename = "gameId")]
    pub game_id: String,
    #[serde(rename = "gameName")]
    pub game_name: String,
    #[serde(rename = "elapsedSeconds")]
    pub elapsed_seconds: u64,
}

/// Payload for the "game-session-lost" / "game-session-restored" events.
/// "Lost" fires once when a tracked process goes missing and the session
/// enters its grace period (could be a launcher hand-off); "restored"
/// fires when it re-attaches to a live process before the grace expires.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameSessionLostPayload {
    #[serde(rename = "gameId")]
    pub game_id: String,
    #[serde(rename = "gameName")]
    pub game_name: String,
}
