//! In-game **video** capture.
//!
//! Screenshots live in [`crate::overlay`]; this module owns the heavier video
//! path: a native Windows Graphics Capture (WGC) frame source feeding a Media
//! Foundation H.264/MP4 encoder, driven either as a manual recording or as a
//! rolling replay buffer.
//!
//! The controller here is platform-agnostic (state, commands, events, clip
//! listing). The actual capture/encode work lives in the `platform` submodule:
//! [`win`] on Windows and [`stub`] everywhere else, so macOS/Linux builds stay
//! green and the settings UI still works (it just reports "unsupported").

use std::sync::{Arc, Mutex, MutexGuard};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

pub mod audio;
pub mod listing;

#[cfg(windows)]
#[path = "windows.rs"]
pub mod platform;
#[cfg(not(windows))]
#[path = "stub.rs"]
pub mod platform;

pub use platform::Session;

/// Emitted whenever the recording/replay state changes.
pub const EVENT_CAPTURE_STATE: &str = "capture:state";
/// Emitted once a clip has been written to disk.
pub const EVENT_CLIP_SAVED: &str = "capture:clip-saved";

/// Everything the platform recorder needs to start a capture. Built from
/// `OverlaySettings` by the commands so the encoder stays settings-agnostic.
#[derive(Clone, Debug)]
pub struct CaptureConfig {
    pub fps: u32,
    pub bitrate_kbps: u32,
    pub resolution_scale: f64,
    pub game_audio: bool,
    pub microphone: bool,
    /// Render endpoint used for game-audio loopback.
    pub audio_device: Option<String>,
    /// Capture endpoint used for the microphone.
    pub mic_device: Option<String>,
    pub replay_seconds: u32,
    pub max_clip_seconds: u32,
    pub show_cursor: bool,
    /// Hide the HUD for the duration of a manual recording.
    pub hide_overlay: bool,
    pub game_title: String,
}

/// Serialized recording state pushed to the frontend.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RecordingState {
    /// A manual recording is in progress.
    pub recording: bool,
    /// The rolling replay buffer is armed.
    pub replay_buffering: bool,
    pub started_at: Option<u64>,
    pub duration_ms: u64,
    /// Last error from the capture pipeline, or `None` while healthy.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// A finished clip on disk.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipResult {
    pub file_path: String,
    pub file_name: String,
    pub game_title: String,
    pub timestamp: u64,
    pub duration_ms: u64,
    pub width: u32,
    pub height: u32,
    /// `record` for a manual take, `replay` for a buffered dump.
    pub kind: String,
}

/// Live capture controller: at most one manual recording and one replay
/// buffer, mutually exclusive (starting one stops the other).
pub struct CaptureController {
    pub recording: Option<Session>,
    pub replay: Option<Session>,
    pub state: RecordingState,
    /// True when we hid the HUD to keep it out of a manual recording.
    pub hid_overlay: bool,
}

impl CaptureController {
    pub fn new() -> Self {
        Self {
            recording: None,
            replay: None,
            state: RecordingState::default(),
            hid_overlay: false,
        }
    }

    /// Stop and drop the manual recording session (if any).
    fn stop_recording(&mut self) -> Option<ClipResult> {
        let session = self.recording.take()?;
        session.stop()
    }

    /// Stop and drop the replay session (if any).
    fn stop_replay(&mut self) -> Option<ClipResult> {
        let session = self.replay.take()?;
        session.stop()
    }
}

impl Default for CaptureController {
    fn default() -> Self {
        Self::new()
    }
}

pub type CaptureState = Arc<Mutex<CaptureController>>;

fn lock(state: &CaptureState) -> MutexGuard<'_, CaptureController> {
    state.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Push the current controller state to every window.
fn broadcast(app: &AppHandle, state: &RecordingState) {
    let _ = app.emit(EVENT_CAPTURE_STATE, state);
}

/// Read the capture-relevant slice of the overlay settings.
fn config_from_settings(app: &AppHandle) -> CaptureConfig {
    use crate::overlay::OverlayState;

    let (settings, game_title) = match app.try_state::<OverlayState>() {
        Some(state) => {
            let rt = state
                .inner()
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let title = rt
                .session
                .as_ref()
                .and_then(|session| {
                    let db = app.state::<crate::db::Db>().inner().clone();
                    crate::db::games::get(&db, &session.game_id)
                        .ok()
                        .flatten()
                        .map(|g| g.name)
                })
                .unwrap_or_else(|| "GameIndex".to_string());
            (Some(rt.settings.clone()), title)
        }
        None => (None, "GameIndex".to_string()),
    };

    match settings {
        Some(s) => CaptureConfig {
            fps: s.video_fps.clamp(15, 240),
            bitrate_kbps: s.video_bitrate_kbps.clamp(1_000, 100_000),
            resolution_scale: s.video_resolution_scale.clamp(0.25, 1.0),
            game_audio: s.video_game_audio,
            microphone: s.video_microphone,
            audio_device: s.video_audio_device.clone(),
            mic_device: s.video_mic_device.clone(),
            replay_seconds: s.replay_buffer_seconds.clamp(5, 600),
            max_clip_seconds: s.video_max_clip_seconds,
            show_cursor: s.video_show_cursor,
            hide_overlay: s.video_hide_overlay,
            game_title,
        },
        None => CaptureConfig {
            fps: 60,
            bitrate_kbps: 12_000,
            resolution_scale: 1.0,
            game_audio: true,
            microphone: false,
            audio_device: None,
            mic_device: None,
            replay_seconds: 60,
            max_clip_seconds: 0,
            show_cursor: false,
            hide_overlay: true,
            game_title,
        },
    }
}

/// Resolve the clip output directory from the overlay settings.
fn capture_folder(app: &AppHandle, game_title: &str) -> std::path::PathBuf {
    use crate::overlay::{resolve_capture_dir, OverlayState};
    let folder = app.try_state::<OverlayState>().and_then(|state| {
        let rt = state
            .inner()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        rt.settings.video_folder.clone()
    });
    resolve_capture_dir(folder.as_deref(), game_title)
}

/// Current recording state.
#[tauri::command]
pub fn capture_get_state(app: AppHandle) -> RecordingState {
    current_state(&app)
}

/// Whether the current platform can record at all.
#[tauri::command]
pub fn capture_is_supported() -> bool {
    platform::is_supported()
}

/// Enumerate audio endpoints for the recorder's device dropdowns.
#[tauri::command]
pub fn capture_list_audio_devices() -> audio::AudioDeviceList {
    audio::list_devices()
}

/// Start a manual recording, stopping any replay buffer first.
#[tauri::command]
pub fn capture_start_recording(app: AppHandle) -> Result<RecordingState, String> {
    start_recording_impl(&app)
}

/// Stop the manual recording and return the saved clip (if any).
#[tauri::command]
pub fn capture_stop_recording(app: AppHandle) -> Result<Option<ClipResult>, String> {
    stop_recording_impl(&app)
}

/// Toggle a manual recording.
#[tauri::command]
pub fn capture_toggle_recording(app: AppHandle) -> Result<RecordingState, String> {
    if is_recording(&app) {
        let _ = stop_recording_impl(&app)?;
    } else {
        let _ = start_recording_impl(&app)?;
    }
    Ok(current_state(&app))
}

/// Arm the rolling replay buffer, stopping any manual recording first.
#[tauri::command]
pub fn capture_start_replay(app: AppHandle) -> Result<RecordingState, String> {
    start_replay_impl(&app)
}

/// Disarm the replay buffer.
#[tauri::command]
pub fn capture_stop_replay(app: AppHandle) -> Result<RecordingState, String> {
    stop_replay_impl(&app)
}

/// Dump the buffered replay window to a permanent clip.
#[tauri::command]
pub fn capture_save_replay(app: AppHandle) -> Result<Option<ClipResult>, String> {
    save_replay_impl(&app)
}

/// Recent clips for the active (or named) game.
#[tauri::command]
pub fn capture_get_recent_clips(app: AppHandle, game_title: Option<String>) -> Result<Vec<String>, String> {
    let title = game_title.unwrap_or_else(|| config_from_settings(&app).game_title);
    let dir = capture_folder(&app, &title);
    Ok(listing::list_clips(&dir))
}

/// Delete a clip from disk.
#[tauri::command]
pub fn capture_delete_clip(path: String) -> Result<(), String> {
    listing::delete_clip(&path)
}

/// Reveal a clip (file) or the clips folder in the OS file manager.
#[tauri::command]
pub fn capture_open_clip_folder(path: Option<String>) -> Result<(), String> {
    listing::open_in_file_manager(path)
}

// ── Shared implementations (also used by the global hotkeys) ────────────

/// Snapshot the controller's current recording state, refreshing the live
/// flags from the sessions themselves.
pub fn current_state(app: &AppHandle) -> RecordingState {
    let state = app.state::<CaptureState>();
    let mut controller = lock(state.inner());
    controller.state.recording = controller.recording.as_ref().is_some_and(Session::active);
    controller.state.replay_buffering = controller.replay.as_ref().is_some_and(Session::active);
    controller.state.clone()
}

/// Whether a manual recording is currently active.
pub fn is_recording(app: &AppHandle) -> bool {
    let state = app.state::<CaptureState>();
    lock(state.inner())
        .recording
        .as_ref()
        .is_some_and(Session::active)
}

pub fn start_recording_impl(app: &AppHandle) -> Result<RecordingState, String> {
    let config = config_from_settings(app);
    let folder = capture_folder(app, &config.game_title);
    let _ = std::fs::create_dir_all(&folder);

    let state = app.state::<CaptureState>();
    let mut controller = lock(state.inner());
    let _ = controller.stop_replay();

    let session = platform::start(&config, &folder, now_ms(), "record")?;
    controller.recording = Some(session);
    controller.hid_overlay = false;
    controller.state = RecordingState {
        recording: true,
        replay_buffering: false,
        started_at: Some(now_ms()),
        duration_ms: 0,
        error: None,
    };
    let snapshot = controller.state.clone();
    drop(controller);

    // Keep the HUD out of the clip: hide it only if it was actually visible.
    if config.hide_overlay && overlay_visible(app) {
        hide_overlay_window(app);
        lock(app.state::<CaptureState>().inner()).hid_overlay = true;
    }

    broadcast(app, &snapshot);
    Ok(snapshot)
}

pub fn stop_recording_impl(app: &AppHandle) -> Result<Option<ClipResult>, String> {
    let (clip, restore) = {
        let state = app.state::<CaptureState>();
        let mut controller = lock(state.inner());
        let clip = controller.stop_recording();
        let restore = std::mem::take(&mut controller.hid_overlay);
        controller.state = RecordingState::default();
        (clip, restore)
    };
    if restore {
        show_overlay_window(app);
    }
    if let Some(clip) = &clip {
        let _ = app.emit(EVENT_CLIP_SAVED, clip);
        let _ = app.emit_to("overlay", EVENT_CLIP_SAVED, clip);
    }
    broadcast(app, &RecordingState::default());
    Ok(clip)
}

fn overlay_visible(app: &AppHandle) -> bool {
    app.get_webview_window("overlay")
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false)
}

fn hide_overlay_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("overlay") {
        let _ = window.hide();
    }
}

fn show_overlay_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("overlay") {
        let _ = window.show();
    }
}

pub fn start_replay_impl(app: &AppHandle) -> Result<RecordingState, String> {
    let config = config_from_settings(app);
    let folder = capture_folder(app, &config.game_title);
    let _ = std::fs::create_dir_all(&folder);

    let state = app.state::<CaptureState>();
    let mut controller = lock(state.inner());
    let _ = controller.stop_recording();

    let session = platform::start(&config, &folder, now_ms(), "replay")?;
    controller.replay = Some(session);
    controller.state = RecordingState {
        recording: false,
        replay_buffering: true,
        started_at: Some(now_ms()),
        duration_ms: 0,
        error: None,
    };
    let snapshot = controller.state.clone();
    drop(controller);
    broadcast(app, &snapshot);
    Ok(snapshot)
}

pub fn stop_replay_impl(app: &AppHandle) -> Result<RecordingState, String> {
    {
        let state = app.state::<CaptureState>();
        let mut controller = lock(state.inner());
        let _ = controller.stop_replay();
        controller.state.replay_buffering = false;
    }
    let snapshot = current_state(app);
    broadcast(app, &snapshot);
    Ok(snapshot)
}

pub fn save_replay_impl(app: &AppHandle) -> Result<Option<ClipResult>, String> {
    let clip = {
        let state = app.state::<CaptureState>();
        let controller = lock(state.inner());
        match controller.replay.as_ref() {
            Some(session) => session.save_replay(),
            None => None,
        }
    };
    if let Some(clip) = &clip {
        let _ = app.emit(EVENT_CLIP_SAVED, clip);
        let _ = app.emit_to("overlay", EVENT_CLIP_SAVED, clip);
    }
    Ok(clip)
}

/// Tear down any active sessions. Called on app shutdown / game exit.
pub fn stop_all(app: &AppHandle) {
    if let Some(state) = app.try_state::<CaptureState>() {
        let mut controller = lock(state.inner());
        let _ = controller.stop_recording();
        let _ = controller.stop_replay();
        let restore = std::mem::take(&mut controller.hid_overlay);
        controller.state = RecordingState::default();
        drop(controller);
        if restore {
            show_overlay_window(app);
        }
    }
}
