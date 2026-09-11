//! Standalone launch splash window.
//!
//! The splash used to be an in-process React overlay in the main window.
//! With minimize-on-launch the app hides itself the moment the game starts,
//! so the overlay disappeared with it. The splash now lives in its own
//! always-on-top webview that survives the main window hiding.
//!
//! The main window's `SplashContext` remains the source of truth: it opens
//! the splash, mirrors every status flip through `update_launch_splash_status`
//! and closes it. The standalone entry hydrates from
//! `get_launch_splash_state` and re-renders on each `launch-splash-state`
//! event emitted here.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub(crate) const SPLASH_WINDOW_LABEL: &str = "launch-splash";
const MAIN_WINDOW_LABEL: &str = "main";
const WINDOW_WIDTH: f64 = 760.0;
const WINDOW_HEIGHT: f64 = 700.0;
const STATUS_LAUNCHING: &str = "launching";
const STATUS_ERROR: &str = "error";

/// Snapshot mirrored from the main window's splash state machine. `payload`
/// is the serialized `Game` the splash renders (artwork, title, play time).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchSplashSnapshot {
    pub game_id: String,
    pub status: String,
    pub error_message: Option<String>,
    pub started_at: u64,
    pub payload: Value,
}

/// Managed state shared by the splash commands. A plain `Mutex` is enough:
/// writes swap one snapshot and reads never cross an `.await`.
#[derive(Default)]
pub struct LaunchSplashState(Mutex<Option<LaunchSplashSnapshot>>);

impl LaunchSplashState {
    fn lock(&self) -> std::sync::MutexGuard<'_, Option<LaunchSplashSnapshot>> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Replace the current snapshot with a fresh "launching" one. Every
/// open/retry starts a new launch, so `status` and `error_message` reset
/// while the payload and `startedAt` are replaced.
fn upsert_launching(
    current: &mut Option<LaunchSplashSnapshot>,
    payload: Value,
    game_id: String,
    started_at: u64,
) -> LaunchSplashSnapshot {
    let next = LaunchSplashSnapshot {
        game_id,
        status: STATUS_LAUNCHING.to_string(),
        error_message: None,
        started_at,
        payload,
    };
    *current = Some(next.clone());
    next
}

/// Apply a status transition from the main window. Updates without an
/// active snapshot are dropped rather than resurrecting a closed splash;
/// the error message is only kept for the `error` status so a recovery
/// never leaves a stale reason on screen.
fn apply_status(
    current: &mut Option<LaunchSplashSnapshot>,
    status: &str,
    error_message: Option<String>,
) -> Option<LaunchSplashSnapshot> {
    let snapshot = current.as_mut()?;
    snapshot.status = status.to_string();
    snapshot.error_message = if status == STATUS_ERROR {
        error_message
    } else {
        None
    };
    Some(snapshot.clone())
}

fn build_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    let window = WebviewWindowBuilder::new(
        app,
        SPLASH_WINDOW_LABEL,
        WebviewUrl::App("index.html?window=launch-splash".into()),
    )
    .title("GameIndex")
    .inner_size(WINDOW_WIDTH, WINDOW_HEIGHT)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    // Native shadows are rectangular, so they would outline the whole
    // transparent window; the card's CSS shadow provides the depth.
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .center()
    // The entry shows the window once it has state to render, so the user
    // never sees an empty frame flash before the webview boots.
    .visible(false)
    .build()
    .map_err(|e| format!("failed to create launch splash window: {e}"))?;

    let handle = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            if let Some(state) = handle.try_state::<LaunchSplashState>() {
                *state.lock() = None;
            }
            let _ = handle.emit_to(MAIN_WINDOW_LABEL, "launch-splash-closed", ());
        }
    });

    Ok(window)
}

/// Open (or refresh) the standalone splash window for a new launch. The
/// payload is stored before the window is built so the standalone entry's
/// first `get_launch_splash_state` always finds it.
///
/// This command MUST stay `async`. Building a webview window is only safe
/// off the IPC thread: on Windows the handler runs on the WebView2 UI
/// thread, and creating a controller from inside a WebView2 event callback
/// re-enters the runtime and hangs the IPC queue — taking the immediately
/// following `launch_game` invocation down with it. Async commands execute
/// on the async runtime and dispatch creation to the event loop.
#[tauri::command]
pub async fn open_launch_splash(
    app: AppHandle,
    state: tauri::State<'_, LaunchSplashState>,
    payload: Value,
    game_id: String,
    started_at: u64,
) -> Result<(), String> {
    let snapshot = {
        let mut guard = state.lock();
        upsert_launching(&mut guard, payload, game_id, started_at)
    };

    // Reuse a live window (relaunch/retry) by refreshing and refocusing it.
    // Freshly built windows stay hidden until the entry has state to render
    // and calls `show_launch_splash_window`.
    match app.get_webview_window(SPLASH_WINDOW_LABEL) {
        Some(win) => {
            let _ = win.show();
            let _ = win.set_focus();
        }
        None => {
            build_window(&app)?;
        }
    }
    let _ = app.emit_to(SPLASH_WINDOW_LABEL, "launch-splash-state", &snapshot);
    Ok(())
}

/// Mirror a status flip (started / error) onto the splash window.
#[tauri::command]
pub fn update_launch_splash_status(
    app: AppHandle,
    state: tauri::State<'_, LaunchSplashState>,
    status: String,
    error_message: Option<String>,
) -> Result<(), String> {
    let snapshot = {
        let mut guard = state.lock();
        apply_status(&mut guard, &status, error_message)
    };
    if let Some(snapshot) = snapshot {
        let _ = app.emit_to(SPLASH_WINDOW_LABEL, "launch-splash-state", &snapshot);
    }
    Ok(())
}

/// Snapshot used by the standalone entry to hydrate before any event
/// arrives — the window can be built between an open and its first event.
#[tauri::command]
pub fn get_launch_splash_state(
    state: tauri::State<'_, LaunchSplashState>,
) -> Option<LaunchSplashSnapshot> {
    state.lock().clone()
}

/// Reveal the splash window after the standalone entry has rendered.
#[tauri::command]
pub fn show_launch_splash_window(app: AppHandle) {
    if let Some(window) = app.get_webview_window(SPLASH_WINDOW_LABEL) {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Ask the main window to re-run the launch. Only honored while the
/// splash shows a failure, so a stray event can never relaunch a game
/// that is already starting.
#[tauri::command]
pub fn retry_launch_splash(
    app: AppHandle,
    state: tauri::State<'_, LaunchSplashState>,
) -> Result<(), String> {
    #[derive(Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct RetryPayload {
        game_id: String,
    }

    let game_id = {
        let guard = state.lock();
        match guard.as_ref() {
            Some(snapshot) if snapshot.status == STATUS_ERROR => snapshot.game_id.clone(),
            _ => return Ok(()),
        }
    };

    app.emit_to(
        MAIN_WINDOW_LABEL,
        "launch-splash-retry",
        RetryPayload { game_id },
    )
    .map_err(|e| e.to_string())
}

/// Close the splash window. The `Destroyed` handler clears the snapshot
/// and notifies the main window, so this stays a one-liner for callers.
#[tauri::command]
pub fn close_launch_splash(app: AppHandle, state: tauri::State<'_, LaunchSplashState>) {
    if let Some(window) = app.get_webview_window(SPLASH_WINDOW_LABEL) {
        let _ = window.close();
        return;
    }
    // No window (inline fallback or already closed): clear and notify so
    // the main window's splash state always resolves.
    *state.lock() = None;
    let _ = app.emit_to(MAIN_WINDOW_LABEL, "launch-splash-closed", ());
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_payload() -> Value {
        serde_json::json!({ "id": "game-1", "name": "Half-Life" })
    }

    #[test]
    fn upsert_replaces_the_previous_snapshot_with_a_launching_one() {
        let mut current = None;
        let first = upsert_launching(&mut current, sample_payload(), "game-1".into(), 100);
        assert_eq!(first.status, STATUS_LAUNCHING);
        assert_eq!(first.game_id, "game-1");
        assert_eq!(first.error_message, None);
        assert_eq!(current.as_ref().unwrap().started_at, 100);

        let second = upsert_launching(&mut current, sample_payload(), "game-2".into(), 200);
        assert_eq!(second.game_id, "game-2");
        assert_eq!(second.started_at, 200);
        assert_eq!(current.as_ref().unwrap().game_id, "game-2");
    }

    #[test]
    fn status_without_a_snapshot_is_ignored() {
        let mut current = None;
        assert!(apply_status(&mut current, "started", None).is_none());
        assert!(current.is_none());
    }

    #[test]
    fn error_message_is_stored_on_error_and_cleared_on_recovery() {
        let mut current = None;
        upsert_launching(&mut current, sample_payload(), "game-1".into(), 42);

        let errored = apply_status(&mut current, STATUS_ERROR, Some("boom".into())).unwrap();
        assert_eq!(errored.error_message.as_deref(), Some("boom"));

        let started = apply_status(&mut current, "started", None).unwrap();
        assert_eq!(started.status, "started");
        assert_eq!(started.error_message, None);
    }
}
