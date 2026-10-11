//! In-game overlay HUD.
//!
//! A transparent, always-on-top window that floats over a borderless-windowed
//! game. It is built lazily on first show (never at boot), positioned in a
//! configured corner of the monitor under the cursor, and toggled between a
//! click-through ticker and an interactive panel by a global hotkey.
//!
//! The overlay is a pure view: this module owns the window lifecycle, the
//! toggle hotkey, the corner geometry, the settings persistence and the live
//! telemetry bridge. Windows is the only supported platform for the HUD, but
//! nothing here is Windows-gated, so macOS/Linux builds stay green (the
//! telemetry source itself no-ops off Windows — see `metrics_collector`).

use std::str::FromStr;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, Listener, Manager, PhysicalPosition, PhysicalSize, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_global_shortcut::ShortcutEvent;

use crate::db;
use crate::game_watcher::GameWatcher;
use crate::metrics_collector;

/// Window label of the overlay webview. Mirrored in `tauri.conf.json` and
/// `capabilities/overlay.json`.
pub const OVERLAY_WINDOW_LABEL: &str = "overlay";
const MAIN_WINDOW_LABEL: &str = "main";

/// Single `kv_store` row holding the serialized [`OverlaySettings`].
const SETTINGS_KEY: &str = "overlay.settings.v1";

/// Default window footprints in physical pixels. The user can drag/resize the
/// HUD; the resulting bounds are persisted per presentation (see
/// `overlay_save_bounds`).
const DEFAULT_TICKER_WIDTH: f64 = 480.0;
const DEFAULT_TICKER_HEIGHT: f64 = 72.0;
const DEFAULT_PANEL_WIDTH: f64 = 540.0;
const DEFAULT_PANEL_HEIGHT: f64 = 620.0;
/// Clamps so a bad persisted size can't produce an unusable window.
const MIN_OVERLAY_WIDTH: f64 = 180.0;
const MIN_OVERLAY_HEIGHT: f64 = 44.0;
const MAX_OVERLAY_DIM: f64 = 4000.0;
/// Gap between the overlay edge and the monitor work-area edge.
const OVERLAY_MARGIN: f64 = 16.0;

/// Events (kept as consts so the frontend contract has one source of truth).
pub const EVENT_METRICS: &str = "overlay:metrics";
pub const EVENT_TOGGLE: &str = "overlay:toggle";
pub const EVENT_SESSION: &str = "overlay:session";
pub const EVENT_CLOSED: &str = "overlay:closed";

/// Persisted overlay configuration. Every field is optional at the wire level
/// (the container `default` fills missing keys from [`Default`]) and unknown
/// keys are ignored, so older/partial payloads still load.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct OverlaySettings {
    pub enabled: bool,
    pub hotkey: String,
    /// One of `top-left` | `top-right` | `bottom-left` | `bottom-right`.
    pub corner: String,
    pub opacity: f64,
    pub ticker_widgets: Vec<String>,
    pub panel_widgets: Vec<String>,
    pub poll_interval_ms: u64,
    /// Show CPU/GPU temperatures in the performance widget.
    pub show_temps: bool,
    /// Show the rolling FPS/CPU/GPU sparkline graphs.
    pub show_graphs: bool,
    /// Last user-dragged window position. `None` re-anchors to `corner`.
    #[serde(default)]
    pub pos_x: Option<i32>,
    #[serde(default)]
    pub pos_y: Option<i32>,
    /// Persisted footprint of each presentation (physical px).
    pub ticker_width: f64,
    pub ticker_height: f64,
    pub panel_width: f64,
    pub panel_height: f64,

    // ── Screenshot capture ─────────────────────────────────────────────
    /// `png` (lossless, default) or `jpg` (smaller).
    pub screenshot_format: String,
    /// Custom output folder. `None` uses `Videos\Captures\<Game>`.
    #[serde(default)]
    pub screenshot_folder: Option<String>,
    /// Global shortcut that fires a screenshot, or empty to disable.
    pub screenshot_hotkey: String,
    pub screenshot_sound: bool,
    pub screenshot_flash: bool,
    pub screenshot_copy_to_clipboard: bool,
    /// Keep the HUD visible in the capture instead of hiding it first.
    pub screenshot_include_overlay: bool,
    /// Delay (ms) between hiding the HUD and grabbing the frame.
    pub screenshot_delay_ms: u64,

    // ── Video capture ──────────────────────────────────────────────────
    pub video_enabled: bool,
    /// Global shortcut that starts/stops a recording, or empty to disable.
    pub video_hotkey: String,
    /// Global shortcut that dumps the replay buffer, or empty to disable.
    pub replay_hotkey: String,
    pub video_fps: u32,
    pub video_bitrate_kbps: u32,
    /// 1.0 = native, down to 0.25 for lower-cost captures.
    pub video_resolution_scale: f64,
    /// Container/codec id; currently `mp4` (H.264 + AAC).
    pub video_format: String,
    /// Custom output folder. `None` uses `Videos\Captures\<Game>`.
    #[serde(default)]
    pub video_folder: Option<String>,
    pub video_game_audio: bool,
    pub video_microphone: bool,
    /// Output (render) device id used for game-audio loopback. `None` uses the
    /// system default render device.
    #[serde(default)]
    pub video_audio_device: Option<String>,
    /// Microphone device id. `None` uses the system default.
    #[serde(default)]
    pub video_mic_device: Option<String>,
    /// Rolling replay length in seconds.
    pub replay_buffer_seconds: u32,
    /// Hard stop for a recording in seconds. `0` = unlimited.
    pub video_max_clip_seconds: u32,
    /// Include the mouse cursor in the capture.
    pub video_show_cursor: bool,
    pub video_sound: bool,
    /// Pre-roll countdown before recording starts (ms).
    pub video_countdown_ms: u64,
    /// Hide the HUD while recording so it stays out of the clip.
    pub video_hide_overlay: bool,

    /// Session-scoped: true while the record toggle has a capture running.
    #[serde(default)]
    pub video_recording: bool,
    /// Session-scoped: true while the replay buffer is armed.
    #[serde(default)]
    pub replay_buffer_active: bool,
}

impl Default for OverlaySettings {
    fn default() -> Self {
        Self {
            enabled: true,
            hotkey: "Shift+F1".to_string(),
            corner: "bottom-right".to_string(),
            opacity: 0.9,
            ticker_widgets: [
                "fps",
                "cpu",
                "gpu",
                "cpuTemp",
                "gpuTemp",
                "ram",
                "sparkline",
                "session",
                "mic",
                "record",
                "replay",
                "screenshot",
            ]
            .iter()
            .map(|s| s.to_string())
            .collect(),
            panel_widgets: [
                "session",
                "performance",
                "captures",
                "recording",
                "notes",
                "timer",
                "achievements",
                "downloads",
                "notifications",
                "settings",
            ]
            .iter()
            .map(|s| s.to_string())
            .collect(),
            poll_interval_ms: 1000,
            show_temps: true,
            show_graphs: true,
            pos_x: None,
            pos_y: None,
            ticker_width: DEFAULT_TICKER_WIDTH,
            ticker_height: DEFAULT_TICKER_HEIGHT,
            panel_width: DEFAULT_PANEL_WIDTH,
            panel_height: DEFAULT_PANEL_HEIGHT,

            screenshot_format: "png".to_string(),
            screenshot_folder: None,
            screenshot_hotkey: "F12".to_string(),
            screenshot_sound: true,
            screenshot_flash: true,
            screenshot_copy_to_clipboard: true,
            screenshot_include_overlay: false,
            screenshot_delay_ms: 60,

            video_enabled: true,
            video_hotkey: "Shift+F2".to_string(),
            replay_hotkey: "Shift+F3".to_string(),
            video_fps: 60,
            video_bitrate_kbps: 12_000,
            video_resolution_scale: 1.0,
            video_format: "mp4".to_string(),
            video_folder: None,
            video_game_audio: true,
            video_microphone: false,
            video_audio_device: None,
            video_mic_device: None,
            replay_buffer_seconds: 60,
            video_max_clip_seconds: 0,
            video_show_cursor: false,
            video_sound: true,
            video_countdown_ms: 0,
            video_hide_overlay: true,

            video_recording: false,
            replay_buffer_active: false,
        }
    }
}

/// Session descriptor pushed to the overlay as `overlay:session`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlaySession {
    pub game_id: String,
    pub started_at: u64,
    /// Process id of the game, or `0` while the launch is still pending.
    /// Drives the live telemetry sampler.
    #[serde(default)]
    pub pid: u32,
}

/// Live, in-memory overlay state shared across commands and the hotkey
/// handler. Persisted settings live in the database; this mirrors them for
/// hot-path reads and owns the pieces that cannot be serialized.
pub struct OverlayRuntime {
    pub settings: OverlaySettings,
    /// The accelerator currently bound, or `None` when registration failed
    /// (or the overlay is disabled).
    pub accelerator: Option<String>,
    /// Global screenshot binding, or `None` when unset/registration failed.
    pub screenshot_accelerator: Option<String>,
    /// Global start/stop-recording binding.
    pub record_accelerator: Option<String>,
    /// Global save-replay binding.
    pub replay_accelerator: Option<String>,
    /// The running live-telemetry sampler, if any.
    pub live: Option<metrics_collector::LiveMetricsHandle>,
    /// The game the overlay is currently showing, or `None` when idle.
    pub session: Option<OverlaySession>,
    /// Ticker (`true`) vs interactive panel (`false`).
    pub collapsed: bool,
}

impl OverlayRuntime {
    pub fn new(settings: OverlaySettings) -> Self {
        Self {
            settings,
            accelerator: None,
            screenshot_accelerator: None,
            record_accelerator: None,
            replay_accelerator: None,
            live: None,
            session: None,
            collapsed: true,
        }
    }
}

/// Managed state type. `Arc<Mutex<..>>` per repo convention for shared state
/// beyond the `Db` pool.
pub type OverlayState = Arc<Mutex<OverlayRuntime>>;

fn lock(state: &OverlayState) -> MutexGuard<'_, OverlayRuntime> {
    state.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Read persisted settings from kv, falling back cleanly when the row is
/// absent, unreadable or written by an older schema.
pub fn load_settings(db: &db::Db) -> OverlaySettings {
    match db::kv::get(db, SETTINGS_KEY) {
        Ok(Some(raw)) => serde_json::from_str(&raw).unwrap_or_default(),
        _ => OverlaySettings::default(),
    }
}

fn persist_settings(app: &AppHandle, settings: &OverlaySettings) -> Result<(), String> {
    let db = app.state::<db::Db>().inner().clone();
    let json = serde_json::to_string(settings).map_err(|e| format!("overlay settings: {e}"))?;
    db::kv::set(&db, SETTINGS_KEY, &json)
}

/// Parse a user-supplied accelerator into a `Shortcut`, surfacing a readable
/// error instead of panicking so a bad binding can be rejected and the
/// previous one kept intact.
fn parse_accelerator(accelerator: &str) -> Result<Shortcut, String> {
    Shortcut::from_str(accelerator).map_err(|e| format!("invalid accelerator '{accelerator}': {e}"))
}

/// Pure corner math: given the target monitor work area `(x, y, width,
/// height)`, the window `size` `(width, height)` and an outer `margin`,
/// return the window's top-left position for `corner`.
pub fn corner_rect(
    corner: &str,
    work_area: (f64, f64, f64, f64),
    size: (f64, f64),
    margin: f64,
) -> Result<(f64, f64), String> {
    let (ax, ay, aw, ah) = work_area;
    let (sw, sh) = size;
    let (x, y) = match corner {
        "top-left" => (ax + margin, ay + margin),
        "top-right" => (ax + aw - sw - margin, ay + margin),
        "bottom-left" => (ax + margin, ay + ah - sh - margin),
        "bottom-right" => (ax + aw - sw - margin, ay + ah - sh - margin),
        other => return Err(format!("invalid overlay corner: {other}")),
    };
    // Never place the window outside the work area's top-left, even when the
    // overlay is larger than the monitor (tiny/rotated displays).
    Ok((x.max(ax), y.max(ay)))
}

fn is_valid_corner(corner: &str) -> bool {
    matches!(
        corner,
        "top-left" | "top-right" | "bottom-left" | "bottom-right"
    )
}

/// Window size for the ticker (`collapsed`) vs the expanded panel, clamped to
/// a usable range so a stale persisted value can't produce a broken window.
fn overlay_size(settings: &OverlaySettings, collapsed: bool) -> (f64, f64) {
    let (w, h) = if collapsed {
        (settings.ticker_width, settings.ticker_height)
    } else {
        (
            settings.panel_width.max(DEFAULT_PANEL_WIDTH),
            settings.panel_height.max(DEFAULT_PANEL_HEIGHT),
        )
    };
    (
        w.clamp(MIN_OVERLAY_WIDTH, MAX_OVERLAY_DIM),
        h.clamp(MIN_OVERLAY_HEIGHT, MAX_OVERLAY_DIM),
    )
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// The monitor the overlay should target. There is no portable "monitor of the
/// game window" API, so we approximate it with the monitor under the cursor
/// and fall back to the primary monitor, then the first available one.
fn target_monitor(app: &AppHandle) -> Option<tauri::Monitor> {
    if let Ok(pos) = app.cursor_position() {
        if let Ok(Some(monitor)) = app.monitor_from_point(pos.x, pos.y) {
            return Some(monitor);
        }
    }
    if let Ok(Some(monitor)) = app.primary_monitor() {
        return Some(monitor);
    }
    app.available_monitors().ok().and_then(|m| m.into_iter().next())
}

/// Make the overlay a non-activating tool window (Windows): it can be shown,
/// moved and clicked without taking foreground from the running game — which
/// makes many borderless games minimize when they lose activation.
#[cfg(windows)]
fn make_non_activating(window: &WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
    };

    // Tauri's HWND comes from a different `windows` crate version than ours;
    // both wrap a raw pointer, so round-trip through `isize`.
    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    let raw = hwnd.0 as isize;
    unsafe {
        let hwnd = HWND(raw as *mut std::ffi::c_void);
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let next = ex | (WS_EX_NOACTIVATE.0 as isize) | (WS_EX_TOOLWINDOW.0 as isize);
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next);
    }
}

#[cfg(not(windows))]
fn make_non_activating(_window: &WebviewWindow) {}

/// Move + size the overlay window for `settings.corner` on the target monitor.
/// `collapsed` picks the ticker vs panel footprint so the interactive window
/// always matches the visible content.
fn apply_geometry(
    window: &WebviewWindow,
    app: &AppHandle,
    settings: &OverlaySettings,
    collapsed: bool,
) -> Result<(), String> {
    let size = overlay_size(settings, collapsed);
    let (work_area, scale_factor) = match target_monitor(app) {
        Some(monitor) => {
            let scale = monitor.scale_factor();
            let pos = monitor.position();
            let msize = monitor.size();
            (
                (
                    pos.x as f64,
                    pos.y as f64,
                    msize.width as f64,
                    msize.height as f64,
                ),
                scale,
            )
        }
        None => ((0.0, 0.0, 1920.0, 1080.0), 1.0),
    };
    let (ax, ay, aw, ah) = work_area;
    let phys_size = (size.0 * scale_factor, size.1 * scale_factor);
    let phys_margin = OVERLAY_MARGIN * scale_factor;

    // An explicit user position (from dragging) wins, clamped so the window
    // always stays on the monitor; otherwise anchor to the configured corner.
    let (x, y) = match (settings.pos_x, settings.pos_y) {
        (Some(x), Some(y)) => (
            (x as f64).clamp(ax, (ax + aw - phys_size.0).max(ax)),
            (y as f64).clamp(ay, (ay + ah - phys_size.1).max(ay)),
        ),
        _ => corner_rect(&settings.corner, work_area, phys_size, phys_margin)?,
    };

    window
        .set_size(PhysicalSize::new(
            phys_size.0.round() as u32,
            phys_size.1.round() as u32,
        ))
        .map_err(|e| e.to_string())?;
    window
        .set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32))
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Build the overlay window on first use, or return the existing one.
fn ensure_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(OVERLAY_WINDOW_LABEL) {
        return Ok(window);
    }

    let window = WebviewWindowBuilder::new(
        app,
        OVERLAY_WINDOW_LABEL,
        WebviewUrl::App("index.html?window=overlay".into()),
    )
    .title("GameIndex Overlay")
    .inner_size(DEFAULT_TICKER_WIDTH, DEFAULT_TICKER_HEIGHT)
    .resizable(true)
    .decorations(false)
    .transparent(true)
    // Native shadows are rectangular and would outline the whole transparent
    // window; the card's CSS shadow provides the depth (same as the splash).
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    // The frontend reveals the window once it has something to render.
    .visible(false)
    .build()
    .map_err(|e| format!("failed to create overlay window: {e}"))?;

    // Never steal focus from the running game: a NOACTIVATE tool window can be
    // shown and clicked without the game losing foreground (which makes many
    // borderless games minimize).
    make_non_activating(&window);

    let handle = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            // Stop telemetry and drop the session so a later show rebuilds
            // from a clean slate.
            if let Some(state) = handle.try_state::<OverlayState>() {
                let live = {
                    let mut rt = lock(state.inner());
                    rt.session = None;
                    rt.live.take()
                };
                if let Some(live) = live {
                    live.stop();
                }
            }
            let _ = handle.emit_to(MAIN_WINDOW_LABEL, EVENT_CLOSED, ());
        }
    });

    Ok(window)
}

/// Build (if needed), position and show the overlay, then replay the current
/// session and start live telemetry when a game is running. Shared by the
/// `overlay_show` command and the global-hotkey handler so both entry points
/// behave identically.
fn present(app: &AppHandle, collapsed: bool) -> Result<(), String> {
    let state = app.state::<OverlayState>();
    let settings = {
        let mut rt = lock(state.inner());
        rt.collapsed = collapsed;
        rt.settings.clone()
    };

    let window = ensure_window(app)?;
    apply_geometry(&window, app, &settings, collapsed)?;
    let _ = window.show();
    // Deliberately no `set_focus()`: yanking focus from a running game can drop
    // its input. The HUD is always-on-top; clicking the ticker focuses and
    // expands it.
    // The HUD is interactive whenever it is visible: the compact ticker is
    // click-to-expand and the panel is fully interactive. The window is sized
    // to its content so the game stays clickable everywhere else, and the
    // user hides the HUD (hotkey) when they want to play undisturbed.
    window
        .set_ignore_cursor_events(false)
        .map_err(|e| e.to_string())?;

    // Replay the current session so a freshly built overlay renders the
    // session widget without waiting for the next game lifecycle event, and
    // spin up telemetry for the running game.
    let session = lock(state.inner()).session.clone();
    let _ = app.emit_to(OVERLAY_WINDOW_LABEL, EVENT_SESSION, session.clone());
    // Tell the frontend which presentation to render; the listener may not be
    // attached on the very first show, where the frontend already boots on the
    // ticker.
    let _ = app.emit_to(
        OVERLAY_WINDOW_LABEL,
        EVENT_TOGGLE,
        serde_json::json!({ "collapsed": collapsed }),
    );
    if let Some(session) = session {
        let pid = resolve_pid(app, &session);
        if pid != 0 {
            let _ = start_live(app, pid);
        }
    }
    Ok(())
}

/// Show the overlay in the ticker (`collapsed`) or panel presentation.
///
/// MUST stay `async`: creating a webview window from the IPC thread re-enters
/// the runtime on Windows and can hang the IPC queue (see the same note on
/// `launch_splash::open_launch_splash`).
#[tauri::command]
pub async fn overlay_show(app: AppHandle, collapsed: bool) -> Result<(), String> {
    present(&app, collapsed)
}

/// Hide the overlay without destroying it. The window (and its webview) stays
/// alive so the next show is instant. Telemetry stops with it — there is
/// nothing left to render.
#[tauri::command]
pub fn overlay_hide(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(OVERLAY_WINDOW_LABEL) {
        window.hide().map_err(|e| e.to_string())?;
    }
    if let Some(state) = app.try_state::<OverlayState>() {
        let live = lock(state.inner()).live.take();
        if let Some(live) = live {
            live.stop();
        }
    }
    Ok(())
}

/// Toggle whether the overlay receives mouse input. The HUD is normally
/// interactive while visible; this stays for completeness.
#[tauri::command]
pub fn overlay_set_interactive(app: AppHandle, interactive: bool) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(OVERLAY_WINDOW_LABEL) {
        window
            .set_ignore_cursor_events(!interactive)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Switch between the compact ticker (`collapsed`) and the expanded panel,
/// resizing and repositioning the window so the interactive area matches the
/// visible content.
#[tauri::command]
pub fn overlay_set_collapsed(
    app: AppHandle,
    state: tauri::State<'_, OverlayState>,
    collapsed: bool,
) -> Result<(), String> {
    let settings = {
        let mut rt = lock(state.inner());
        rt.collapsed = collapsed;
        rt.settings.clone()
    };
    if let Some(window) = app.get_webview_window(OVERLAY_WINDOW_LABEL) {
        apply_geometry(&window, &app, &settings, collapsed)?;
        let _ = window.set_ignore_cursor_events(false);
    }
    Ok(())
}

/// Persist the window's current position + footprint for the active
/// presentation. Called (debounced) by the frontend after the user drags or
/// resizes the HUD.
#[tauri::command]
pub fn overlay_save_bounds(
    app: AppHandle,
    state: tauri::State<'_, OverlayState>,
) -> Result<(), String> {
    let Some(window) = app.get_webview_window(OVERLAY_WINDOW_LABEL) else {
        return Ok(());
    };
    let pos = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.inner_size().map_err(|e| e.to_string())?;
    let scale = window.scale_factor().unwrap_or(1.0);
    let collapsed = lock(state.inner()).collapsed;

    let settings = {
        let mut rt = lock(state.inner());
        rt.settings.pos_x = Some(pos.x);
        rt.settings.pos_y = Some(pos.y);
        if collapsed {
            rt.settings.ticker_width = ((size.width as f64) / scale).round();
            rt.settings.ticker_height = ((size.height as f64) / scale).round();
        } else {
            rt.settings.panel_width = ((size.width as f64) / scale).round();
            rt.settings.panel_height = ((size.height as f64) / scale).round();
        }
        rt.settings.clone()
    };
    persist_settings(&app, &settings)
}

/// Resize the ticker window to fit its measured content. The frontend measures
/// the HUD and calls this whenever the element set changes; the window is
/// re-anchored to its corner (or kept at a dragged position) and the new
/// footprint is persisted by the usual `overlay_save_bounds` round-trip.
#[tauri::command]
pub fn overlay_fit_ticker(
    app: AppHandle,
    state: tauri::State<'_, OverlayState>,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let settings = {
        let mut rt = lock(state.inner());
        if !rt.collapsed {
            return Ok(());
        }
        let w = width.clamp(MIN_OVERLAY_WIDTH, MAX_OVERLAY_DIM);
        let h = height.clamp(MIN_OVERLAY_HEIGHT, MAX_OVERLAY_DIM);
        // Ignore sub-pixel churn so the ResizeObserver can't ping-pong.
        if (rt.settings.ticker_width - w).abs() < 1.0
            && (rt.settings.ticker_height - h).abs() < 1.0
        {
            return Ok(());
        }
        rt.settings.ticker_width = w;
        rt.settings.ticker_height = h;
        rt.settings.clone()
    };
    if let Some(window) = app.get_webview_window(OVERLAY_WINDOW_LABEL) {
        apply_geometry(&window, &app, &settings, true)?;
    }
    Ok(())
}

/// Reposition the overlay to a new corner and persist the choice.
#[tauri::command]
pub fn overlay_set_corner(
    app: AppHandle,
    state: tauri::State<'_, OverlayState>,
    corner: String,
) -> Result<(), String> {
    if !is_valid_corner(&corner) {
        return Err(format!("invalid overlay corner: {corner}"));
    }
    let (settings, collapsed) = {
        let mut rt = lock(state.inner());
        rt.settings.corner = corner;
        // Re-anchor to the corner: drop any dragged position.
        rt.settings.pos_x = None;
        rt.settings.pos_y = None;
        (rt.settings.clone(), rt.collapsed)
    };
    persist_settings(&app, &settings)?;
    if let Some(window) = app.get_webview_window(OVERLAY_WINDOW_LABEL) {
        apply_geometry(&window, &app, &settings, collapsed)?;
    }
    Ok(())
}

/// Current overlay settings (the in-memory mirror of the kv row).
#[tauri::command]
pub fn overlay_get_settings(
    state: tauri::State<'_, OverlayState>,
) -> Result<OverlaySettings, String> {
    Ok(lock(state.inner()).settings.clone())
}

/// Current running session, or `None`. Lets a freshly mounted overlay seed its
/// state without racing the one-shot `overlay:session` event.
#[tauri::command]
pub fn overlay_get_session(
    state: tauri::State<'_, OverlayState>,
) -> Result<Option<OverlaySession>, String> {
    Ok(lock(state.inner()).session.clone())
}

/// Persist a full settings payload and apply the parts the backend owns: the
/// global hotkey and the corner. Opacity is echoed back to the frontend, which
/// applies it in CSS (Tauri has no portable native window-opacity API).
#[tauri::command]
pub fn overlay_save_settings(
    app: AppHandle,
    state: tauri::State<'_, OverlayState>,
    settings: OverlaySettings,
) -> Result<(), String> {
    if !is_valid_corner(&settings.corner) {
        return Err(format!("invalid overlay corner: {}", settings.corner));
    }

    // Surfaces an invalid/conflicting binding as an error and keeps the
    // previous one, so a bad save never leaves the overlay unreachable.
    register_hotkey(&app, state.inner(), &settings.hotkey)?;
    // Capture bindings are best-effort; a conflict there is logged, not fatal.
    register_capture_hotkeys(&app, state.inner());

    {
        let mut rt = lock(state.inner());
        rt.settings = settings.clone();
    }
    persist_settings(&app, &settings)?;

    if let Some(window) = app.get_webview_window(OVERLAY_WINDOW_LABEL) {
        let collapsed = lock(state.inner()).collapsed;
        apply_geometry(&window, &app, &settings, collapsed)?;
    }
    Ok(())
}

/// Re-register the global toggle hotkey and return the updated settings. On an
/// invalid accelerator the error is returned and the previous binding is left
/// in place.
#[tauri::command]
pub fn overlay_set_hotkey(
    app: AppHandle,
    state: tauri::State<'_, OverlayState>,
    accelerator: String,
) -> Result<OverlaySettings, String> {
    // `register_hotkey` restores the previous binding itself when the new one
    // fails, so we simply propagate the error.
    register_hotkey(&app, state.inner(), &accelerator)?;

    let settings = {
        let mut rt = lock(state.inner());
        rt.settings.hotkey = accelerator;
        rt.settings.clone()
    };
    persist_settings(&app, &settings)?;
    Ok(settings)
}

/// Resolve the process id to sample: the session's own pid, or the watcher's
/// live pid for that game when the launch is still pending. Safe to call
/// outside the watcher lock (hotkey/main thread and IPC commands only).
fn resolve_pid(app: &AppHandle, session: &OverlaySession) -> u32 {
    if session.pid != 0 {
        return session.pid;
    }
    app.try_state::<Arc<Mutex<GameWatcher>>>()
        .and_then(|watcher| {
            watcher
                .lock()
                .ok()
                .and_then(|guard| guard.active_pid(&session.game_id))
        })
        .unwrap_or(0)
}

/// Start (or restart) the ~1 s live telemetry sampler for `pid`. Only one
/// sampler runs at a time; any previous one is stopped first. Reuses the
/// user's telemetry gating exactly as the session collector does.
fn start_live(app: &AppHandle, pid: u32) -> Result<(), String> {
    let state = app.state::<OverlayState>();

    let previous = lock(state.inner()).live.take();
    if let Some(previous) = previous {
        previous.stop();
    }

    let config = app
        .state::<Arc<Mutex<GameWatcher>>>()
        .lock()
        .map(|w| w.metrics_config())
        .unwrap_or_default();
    // FPS is the overlay's headline metric, so always attempt the RTSS/
    // Afterburner read here even if the user turned FPS off for session
    // recording. Everything else honours the session gating.
    let mut config = config;
    config.capture_fps = true;
    // Clamp so a misconfigured tiny/zero interval can't spin the sampler.
    let interval = Duration::from_millis(lock(state.inner()).settings.poll_interval_ms.max(250));

    let emit_app = app.clone();
    let handle = metrics_collector::start_live_collection(
        config,
        pid,
        None,
        None,
        interval,
        move |sample| {
            let _ = emit_app.emit_to(OVERLAY_WINDOW_LABEL, EVENT_METRICS, sample);
        },
    );

    lock(state.inner()).live = Some(handle);
    Ok(())
}

/// Start the live telemetry sampler for `pid`.
#[tauri::command]
pub fn overlay_start_live_metrics(app: AppHandle, pid: u32) -> Result<(), String> {
    start_live(&app, pid)
}

/// Stop the live telemetry sampler and join its thread.
#[tauri::command]
pub fn overlay_stop_live_metrics(state: tauri::State<'_, OverlayState>) -> Result<(), String> {
    let handle = lock(state.inner()).live.take();
    if let Some(handle) = handle {
        handle.stop();
    }
    Ok(())
}

/// Which global binding a registration targets.
#[derive(Clone, Copy)]
enum Binding {
    Toggle,
    Screenshot,
    Record,
    Replay,
}

impl Binding {
    fn get(self, rt: &OverlayRuntime) -> Option<String> {
        match self {
            Binding::Toggle => rt.accelerator.clone(),
            Binding::Screenshot => rt.screenshot_accelerator.clone(),
            Binding::Record => rt.record_accelerator.clone(),
            Binding::Replay => rt.replay_accelerator.clone(),
        }
    }

    fn set(self, rt: &mut OverlayRuntime, value: Option<String>) {
        match self {
            Binding::Toggle => rt.accelerator = value,
            Binding::Screenshot => rt.screenshot_accelerator = value,
            Binding::Record => rt.record_accelerator = value,
            Binding::Replay => rt.replay_accelerator = value,
        }
    }
}

/// Register `accelerator` for `which`, replacing any previous binding. An
/// empty accelerator unbinds; an invalid/conflicting one restores the previous
/// binding and returns an error.
fn register_binding(
    app: &AppHandle,
    state: &OverlayState,
    which: Binding,
    accelerator: &str,
) -> Result<(), String> {
    let previous = which.get(&lock(state));
    let trimmed = accelerator.trim().to_string();

    let global = app.global_shortcut();
    if let Some(ref previous) = previous {
        if let Ok(old) = Shortcut::from_str(previous) {
            let _ = global.unregister(old);
        }
    }

    if trimmed.is_empty() {
        which.set(&mut lock(state), None);
        return Ok(());
    }

    let shortcut = parse_accelerator(&trimmed)?;
    if let Err(e) = global.register(shortcut) {
        // Roll back to the binding that was working before.
        if let Some(ref previous) = previous {
            if let Ok(old) = Shortcut::from_str(previous) {
                let _ = global.register(old);
            }
        }
        return Err(format!("failed to register '{trimmed}': {e}"));
    }

    which.set(&mut lock(state), Some(trimmed));
    Ok(())
}

/// Register `accelerator` as the global toggle hotkey, replacing any previous
/// binding. On failure the previous binding is restored and the error returned.
fn register_hotkey(
    app: &AppHandle,
    state: &OverlayState,
    accelerator: &str,
) -> Result<(), String> {
    register_binding(app, state, Binding::Toggle, accelerator)
}

/// (Re)register every global capture binding (screenshot / record / replay).
/// Best-effort: a bad or conflicting capture binding is logged, never fatal.
fn register_capture_hotkeys(app: &AppHandle, state: &OverlayState) {
    let (screenshot, record, replay) = {
        let rt = lock(state);
        (
            rt.settings.screenshot_hotkey.clone(),
            rt.settings.video_hotkey.clone(),
            rt.settings.replay_hotkey.clone(),
        )
    };
    for (which, accel) in [
        (Binding::Screenshot, screenshot),
        (Binding::Record, record),
        (Binding::Replay, replay),
    ] {
        if let Err(e) = register_binding(app, state, which, &accel) {
            eprintln!("[overlay] capture hotkey registration failed: {e}");
        }
    }
}

/// Register the persisted default hotkeys at boot. Failures are logged, never
/// fatal — the overlay stays usable from the frontend even without a hotkey.
pub fn register_default_hotkey(app: &AppHandle, state: &OverlayState) {
    let (enabled, hotkey) = {
        let rt = lock(state);
        (rt.settings.enabled, rt.settings.hotkey.clone())
    };
    if !enabled {
        return;
    }
    if let Err(e) = register_hotkey(app, state, &hotkey) {
        eprintln!("[overlay] default hotkey registration failed: {e}");
    }
    register_capture_hotkeys(app, state);
}

/// Global-shortcut handler. Dispatches the overlay toggle, a screenshot, a
/// record toggle or a replay dump depending on which binding fired.
pub fn handle_hotkey(app: &AppHandle, shortcut: &Shortcut, event: ShortcutEvent) {
    if event.state != ShortcutState::Pressed {
        return;
    }
    let Some(state) = app.try_state::<OverlayState>() else {
        return;
    };

    let matches = |accel: &Option<String>| {
        accel
            .as_ref()
            .and_then(|a| Shortcut::from_str(a).ok())
            .map(|s| s.id() == shortcut.id())
            .unwrap_or(false)
    };

    let (is_toggle, is_shot, is_rec, is_replay) = {
        let rt = lock(state.inner());
        (
            matches(&rt.accelerator),
            matches(&rt.screenshot_accelerator),
            matches(&rt.record_accelerator),
            matches(&rt.replay_accelerator),
        )
    };

    if is_shot {
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = overlay_capture_screenshot(handle, None).await;
        });
        return;
    }

    if is_rec {
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = crate::capture::capture_toggle_recording(handle);
        });
        return;
    }

    if is_replay {
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = crate::capture::save_replay_impl(&handle);
        });
        return;
    }

    if !is_toggle {
        return;
    }

    // Window creation/positioning must run on the main thread, but the
    // global-shortcut callback arrives on its own thread.
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Err(e) = show_or_toggle(&handle) {
            eprintln!("[overlay] hotkey toggle failed: {e}");
        }
    });
}

/// Hotkey behaviour: show the compact ticker when the HUD is hidden, hide it
/// when visible. Clicking the ticker expands it to the panel.
fn show_or_toggle(app: &AppHandle) -> Result<(), String> {
    let Some(state) = app.try_state::<OverlayState>() else {
        return Ok(());
    };
    let visible = app
        .get_webview_window(OVERLAY_WINDOW_LABEL)
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false);

    if !visible {
        return present(app, true);
    }

    // Hotkey off → hide the HUD and stop telemetry. The window is kept warm so
    // the next show is instant.
    if let Some(window) = app.get_webview_window(OVERLAY_WINDOW_LABEL) {
        let _ = window.hide();
    }
    let live = lock(state.inner()).live.take();
    if let Some(live) = live {
        live.stop();
    }
    Ok(())
}

/// Store the current session and mirror it to the overlay window. `None`
/// clears it (game ended / no remaining sessions).
pub fn set_session(app: &AppHandle, session: Option<OverlaySession>) {
    if let Some(state) = app.try_state::<OverlayState>() {
        lock(state.inner()).session = session.clone();
    }
    let _ = app.emit_to(OVERLAY_WINDOW_LABEL, EVENT_SESSION, session);
}

/// Forward the existing game lifecycle events to the overlay as
/// `overlay:session`. Called once from `lib.rs` setup.
pub fn register_listeners(app: &AppHandle) {
    let started = app.clone();
    app.listen("game-started", move |event| {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(event.payload()) else {
            return;
        };
        let Some(game_id) = value.get("gameId").and_then(|v| v.as_str()) else {
            return;
        };
        // `pid` is `0` for a pending launch; the overlay starts telemetry
        // lazily on the next `game-started`/show once the real PID lands.
        let pid = value.get("pid").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
        set_session(
            &started,
            Some(OverlaySession {
                game_id: game_id.to_string(),
                started_at: now_ms(),
                pid,
            }),
        );

        // This listener runs while the GameWatcher mutex is held, so telemetry
        // must be (re)started off this thread. By the time the main-thread
        // closure runs the lock is released and `resolve_pid` is safe.
        let handle = started.clone();
        let _ = started.run_on_main_thread(move || {
            let Some(state) = handle.try_state::<OverlayState>() else {
                return;
            };
            let visible = handle
                .get_webview_window(OVERLAY_WINDOW_LABEL)
                .and_then(|w| w.is_visible().ok())
                .unwrap_or(false);
            if !visible {
                return;
            }
            if let Some(session) = lock(state.inner()).session.clone() {
                let pid = resolve_pid(&handle, &session);
                if pid != 0 {
                    let _ = start_live(&handle, pid);
                }
            }
        });
    });

    let exited = app.clone();
    app.listen("game-exited", move |event| {
        // Only clear the overlay session once the last game has quit; if
        // another session remains, keep showing it.
        let clear = serde_json::from_str::<serde_json::Value>(event.payload())
            .ok()
            .and_then(|v| v.get("remainingGameName").map(|name| name.is_null()))
            .unwrap_or(true);
        if clear {
            set_session(&exited, None);
            // A recording/replay buffer makes no sense once the game is gone.
            crate::capture::stop_all(&exited);
            // Tear the HUD down when the last game exits; the Destroyed
            // handler stops telemetry and emits `overlay:closed`.
            if let Some(window) = exited.get_webview_window(OVERLAY_WINDOW_LABEL) {
                let _ = window.close();
            }
        }
    });
}

pub const EVENT_SCREENSHOT: &str = "overlay:screenshot-captured";

/// Result of an in-game screen capture.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotResult {
    pub file_path: String,
    pub file_name: String,
    pub game_title: String,
    pub timestamp: u64,
    pub width: u32,
    pub height: u32,
}

fn adler32(data: &[u8]) -> u32 {
    let mut s1 = 1u32;
    let mut s2 = 0u32;
    for &b in data {
        s1 = (s1 + b as u32) % 65521;
        s2 = (s2 + s1) % 65521;
    }
    (s2 << 16) | s1
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for &b in data {
        crc ^= b as u32;
        for _ in 0..8 {
            if crc & 1 != 0 {
                crc = (crc >> 1) ^ 0xEDB8_8320;
            } else {
                crc >>= 1;
            }
        }
    }
    !crc
}

fn write_png_chunk(out: &mut Vec<u8>, chunk_type: &[u8; 4], data: &[u8]) {
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    let crc_start = out.len();
    out.extend_from_slice(chunk_type);
    out.extend_from_slice(data);
    let crc = crc32(&out[crc_start..]);
    out.extend_from_slice(&crc.to_be_bytes());
}

/// Standalone, dependency-free uncompressed PNG encoder (RFC 2083 / RFC 1950).
pub fn encode_uncompressed_png(width: u32, height: u32, rgba: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(b"\x89PNG\r\n\x1a\n");

    let mut ihdr = Vec::with_capacity(13);
    ihdr.extend_from_slice(&width.to_be_bytes());
    ihdr.extend_from_slice(&height.to_be_bytes());
    ihdr.push(8); // bit depth 8
    ihdr.push(6); // color type RGBA
    ihdr.push(0); // compression
    ihdr.push(0); // filter
    ihdr.push(0); // interlace
    write_png_chunk(&mut out, b"IHDR", &ihdr);

    let stride = (width * 4) as usize;
    let mut raw_data = Vec::with_capacity((height as usize) * (stride + 1));
    for y in 0..(height as usize) {
        raw_data.push(0); // filter type 0 (None)
        let start = y * stride;
        let end = start + stride;
        if end <= rgba.len() {
            raw_data.extend_from_slice(&rgba[start..end]);
        }
    }

    let checksum = adler32(&raw_data);
    let mut idat = Vec::new();
    idat.push(0x78); // zlib header
    idat.push(0x01);

    const MAX_BLOCK: usize = 65535;
    let total_len = raw_data.len();
    let mut offset = 0;
    while offset < total_len {
        let chunk_len = (total_len - offset).min(MAX_BLOCK);
        let is_last = (offset + chunk_len) == total_len;
        idat.push(if is_last { 0x01 } else { 0x00 });
        let len_u16 = chunk_len as u16;
        let nlen_u16 = !len_u16;
        idat.extend_from_slice(&len_u16.to_le_bytes());
        idat.extend_from_slice(&nlen_u16.to_le_bytes());
        idat.extend_from_slice(&raw_data[offset..offset + chunk_len]);
        offset += chunk_len;
    }
    idat.extend_from_slice(&checksum.to_be_bytes());
    write_png_chunk(&mut out, b"IDAT", &idat);
    write_png_chunk(&mut out, b"IEND", &[]);

    out
}

#[cfg(windows)]
mod gdi_capture {
    #[link(name = "gdi32")]
    #[link(name = "user32")]
    extern "system" {
        fn GetDC(hwnd: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
        fn ReleaseDC(hwnd: *mut std::ffi::c_void, hdc: *mut std::ffi::c_void) -> i32;
        fn CreateCompatibleDC(hdc: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
        fn CreateCompatibleBitmap(hdc: *mut std::ffi::c_void, cx: i32, cy: i32) -> *mut std::ffi::c_void;
        fn SelectObject(hdc: *mut std::ffi::c_void, hgdiobj: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
        fn BitBlt(
            hdc_dst: *mut std::ffi::c_void,
            x: i32,
            y: i32,
            cx: i32,
            cy: i32,
            hdc_src: *mut std::ffi::c_void,
            x1: i32,
            y1: i32,
            rop: u32,
        ) -> i32;
        fn DeleteDC(hdc: *mut std::ffi::c_void) -> i32;
        fn DeleteObject(hover: *mut std::ffi::c_void) -> i32;
        fn GetDIBits(
            hdc: *mut std::ffi::c_void,
            hbm: *mut std::ffi::c_void,
            start: u32,
            lines: u32,
            bits: *mut std::ffi::c_void,
            bmi: *mut std::ffi::c_void,
            usage: u32,
        ) -> i32;
        fn GetSystemMetrics(n_index: i32) -> i32;
    }

    const SM_CXSCREEN: i32 = 0;
    const SM_CYSCREEN: i32 = 1;
    const SRCCOPY: u32 = 0x00CC0020;
    const DIB_RGB_COLORS: u32 = 0;
    const BI_RGB: u32 = 0;

    #[repr(C)]
    struct BitmapInfoHeader {
        bi_size: u32,
        bi_width: i32,
        bi_height: i32,
        bi_planes: u16,
        bi_bit_count: u16,
        bi_compression: u32,
        bi_size_image: u32,
        bi_xpels_per_meter: i32,
        bi_ypels_per_meter: i32,
        bi_clr_used: u32,
        bi_clr_important: u32,
    }

    #[repr(C)]
    struct BitmapInfo {
        bmi_header: BitmapInfoHeader,
        bmi_colors: [u32; 1],
    }

    pub fn capture_rgba() -> Result<(u32, u32, Vec<u8>), String> {
        unsafe {
            let width = GetSystemMetrics(SM_CXSCREEN);
            let height = GetSystemMetrics(SM_CYSCREEN);
            if width <= 0 || height <= 0 {
                return Err("Invalid desktop screen dimensions".into());
            }

            let null_hwnd = std::ptr::null_mut();
            let hdc_screen = GetDC(null_hwnd);
            if hdc_screen.is_null() {
                return Err("Failed to obtain desktop DC".into());
            }

            let hdc_mem = CreateCompatibleDC(hdc_screen);
            if hdc_mem.is_null() {
                ReleaseDC(null_hwnd, hdc_screen);
                return Err("Failed to create memory DC".into());
            }

            let hbitmap = CreateCompatibleBitmap(hdc_screen, width, height);
            if hbitmap.is_null() {
                DeleteDC(hdc_mem);
                ReleaseDC(null_hwnd, hdc_screen);
                return Err("Failed to allocate compatible bitmap".into());
            }

            let prev_obj = SelectObject(hdc_mem, hbitmap);
            let blt_res = BitBlt(hdc_mem, 0, 0, width, height, hdc_screen, 0, 0, SRCCOPY);

            SelectObject(hdc_mem, prev_obj);
            DeleteDC(hdc_mem);
            ReleaseDC(null_hwnd, hdc_screen);

            if blt_res == 0 {
                DeleteObject(hbitmap);
                return Err("BitBlt screen copy failed".into());
            }

            let mut bmi = BitmapInfo {
                bmi_header: BitmapInfoHeader {
                    bi_size: std::mem::size_of::<BitmapInfoHeader>() as u32,
                    bi_width: width,
                    bi_height: -height, // top-down
                    bi_planes: 1,
                    bi_bit_count: 32,
                    bi_compression: BI_RGB,
                    bi_size_image: (width * height * 4) as u32,
                    bi_xpels_per_meter: 0,
                    bi_ypels_per_meter: 0,
                    bi_clr_used: 0,
                    bi_clr_important: 0,
                },
                bmi_colors: [0],
            };

            let mut raw_pixels = vec![0u8; (width * height * 4) as usize];
            let hdc_screen2 = GetDC(null_hwnd);
            let lines = GetDIBits(
                hdc_screen2,
                hbitmap,
                0,
                height as u32,
                raw_pixels.as_mut_ptr() as *mut _,
                &mut bmi as *mut _ as *mut _,
                DIB_RGB_COLORS,
            );
            ReleaseDC(null_hwnd, hdc_screen2);
            DeleteObject(hbitmap);

            if lines == 0 {
                return Err("GetDIBits failed to extract screen pixels".into());
            }

            // Convert BGRA to RGBA and ensure alpha is 255
            for chunk in raw_pixels.chunks_exact_mut(4) {
                let b = chunk[0];
                let r = chunk[2];
                chunk[0] = r;
                chunk[2] = b;
                chunk[3] = 255;
            }

            Ok((width as u32, height as u32, raw_pixels))
        }
    }
}

#[cfg(not(windows))]
mod gdi_capture {
    pub fn capture_rgba() -> Result<(u32, u32, Vec<u8>), String> {
        Err("In-game screen capture is currently supported on Windows".into())
    }
}

#[cfg(not(windows))]
mod gdi_capture {
    use std::path::Path;
    pub fn capture_desktop(_dest: &Path) -> Result<(u32, u32), String> {
        Err("In-game screen capture is currently supported on Windows".into())
    }
}

pub fn get_captures_dir(game_title: &str) -> std::path::PathBuf {
    let sanitized: String = game_title
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            other => other,
        })
        .collect();
    let sanitized = sanitized.trim();
    let folder_name = if sanitized.is_empty() {
        "GameIndex"
    } else {
        sanitized
    };

    #[cfg(windows)]
    {
        if let Ok(userprofile) = std::env::var("USERPROFILE") {
            return std::path::PathBuf::from(userprofile)
                .join("Videos")
                .join("Captures")
                .join(folder_name);
        }
    }

    #[cfg(not(windows))]
    {
        if let Ok(home) = std::env::var("HOME") {
            return std::path::PathBuf::from(home)
                .join("Videos")
                .join("Captures")
                .join(folder_name);
        }
    }

    std::path::PathBuf::from("Captures").join(folder_name)
}

/// Resolve the folder a screenshot or clip should be written to. A custom
/// `folder` (from settings) wins and is used verbatim; otherwise it falls back
/// to the per-game `Videos\Captures\<Game>` tree.
pub fn resolve_capture_dir(folder: Option<&str>, game_title: &str) -> std::path::PathBuf {
    match folder.map(str::trim).filter(|f| !f.is_empty()) {
        Some(folder) => std::path::PathBuf::from(folder),
        None => get_captures_dir(game_title),
    }
}

/// Encode raw top-down RGBA pixels as a baseline JPEG. `quality` is 1..=100.
pub fn encode_jpeg(width: u32, height: u32, rgba: &[u8], quality: u8) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let encoder = jpeg_encoder::Encoder::new(&mut out, quality.clamp(1, 100));
    // `rgba` is RGBA8; jpeg-encoder wants RGB8.
    let mut rgb = Vec::with_capacity((width * height * 3) as usize);
    for px in rgba.chunks_exact(4) {
        rgb.push(px[0]);
        rgb.push(px[1]);
        rgb.push(px[2]);
    }
    encoder
        .encode(&rgb, width as u16, height as u16, jpeg_encoder::ColorType::Rgb)
        .map_err(|e| format!("jpeg encode failed: {e}"))?;
    Ok(out)
}

/// Encode a captured frame in the requested format. Unknown formats fall back
/// to PNG so a bad persisted value can never fail a capture.
pub fn encode_capture(
    format: &str,
    width: u32,
    height: u32,
    rgba: &[u8],
) -> (Vec<u8>, &'static str) {
    if format.eq_ignore_ascii_case("jpg") || format.eq_ignore_ascii_case("jpeg") {
        match encode_jpeg(width, height, rgba, 92) {
            Ok(bytes) => (bytes, "jpg"),
            // Fall back to PNG rather than losing the capture.
            Err(_) => (encode_uncompressed_png(width, height, rgba), "png"),
        }
    } else {
        (encode_uncompressed_png(width, height, rgba), "png")
    }
}

/// Capture the desktop/game screen to the Windows Captures folder, auto-indexed by GameIndex.
#[tauri::command]
pub async fn overlay_capture_screenshot(
    app: AppHandle,
    game_title: Option<String>,
) -> Result<ScreenshotResult, String> {
    // Snapshot the capture-relevant settings up front so the hot path doesn't
    // hold the runtime lock while the capture runs.
    let (hide_overlay, delay_ms, format, folder) = match app.try_state::<OverlayState>() {
        Some(state) => {
            let rt = lock(state.inner());
            (
                !rt.settings.screenshot_include_overlay,
                rt.settings.screenshot_delay_ms,
                rt.settings.screenshot_format.clone(),
                rt.settings.screenshot_folder.clone(),
            )
        }
        None => (true, 60, "png".to_string(), None),
    };

    // 1. Temporarily hide the overlay so it doesn't photograph itself, unless
    //    the user asked for the HUD to appear in their captures.
    if hide_overlay {
        if let Some(win) = app.get_webview_window(OVERLAY_WINDOW_LABEL) {
            let _ = win.hide();
        }
        tokio::time::sleep(Duration::from_millis(delay_ms.max(20))).await;
    }

    let title = game_title.unwrap_or_else(|| {
        if let Some(state) = app.try_state::<OverlayState>() {
            let rt = lock(state.inner());
            if let Some(ref session) = rt.session {
                let db = app.state::<db::Db>().inner().clone();
                if let Ok(Some(g)) = db::games::get(&db, &session.game_id) {
                    return g.name;
                }
            }
        }
        "GameIndex".to_string()
    });

    let dir = resolve_capture_dir(folder.as_deref(), &title);
    if !dir.exists() {
        let _ = std::fs::create_dir_all(&dir);
    }

    let timestamp = now_ms();
    let date_str = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
    let stem = format!("Capture_{}_{}", date_str, timestamp % 1000);

    let capture_result = gdi_capture::capture_rgba();
    let (width, height, rgba) = match capture_result {
        Ok(frame) => frame,
        Err(e) => {
            if hide_overlay {
                if let Some(win) = app.get_webview_window(OVERLAY_WINDOW_LABEL) {
                    let _ = win.show();
                }
            }
            return Err(e);
        }
    };

    let (bytes, ext) = encode_capture(&format, width, height, &rgba);
    let file_name = format!("{stem}.{ext}");
    let dest_path = dir.join(&file_name);
    if let Err(e) = std::fs::write(&dest_path, bytes) {
        if hide_overlay {
            if let Some(win) = app.get_webview_window(OVERLAY_WINDOW_LABEL) {
                let _ = win.show();
            }
        }
        return Err(format!("Failed to write screenshot file: {e}"));
    }

    // 2. Restore overlay window
    if hide_overlay {
        if let Some(win) = app.get_webview_window(OVERLAY_WINDOW_LABEL) {
            let _ = win.show();
        }
    }

    let result = ScreenshotResult {
        file_path: dest_path.to_string_lossy().to_string(),
        file_name,
        game_title: title,
        timestamp,
        width,
        height,
    };

    let _ = app.emit(EVENT_SCREENSHOT, &result);
    let _ = app.emit_to(OVERLAY_WINDOW_LABEL, EVENT_SCREENSHOT, &result);
    let _ = app.emit_to(MAIN_WINDOW_LABEL, EVENT_SCREENSHOT, &result);

    Ok(result)
}

/// Return recent screenshots saved for the specified game in the Captures folder.
#[tauri::command]
pub fn overlay_get_recent_screenshots(
    app: AppHandle,
    game_title: Option<String>,
) -> Result<Vec<String>, String> {
    let title = game_title.unwrap_or_else(|| {
        if let Some(state) = app.try_state::<OverlayState>() {
            let rt = lock(state.inner());
            if let Some(ref session) = rt.session {
                let db = app.state::<db::Db>().inner().clone();
                if let Ok(Some(g)) = db::games::get(&db, &session.game_id) {
                    return g.name;
                }
            }
        }
        "GameIndex".to_string()
    });

    let dir = get_captures_dir(&title);
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut entries = Vec::new();
    if let Ok(read) = std::fs::read_dir(&dir) {
        for entry in read.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                    let ext_lower = ext.to_lowercase();
                    if matches!(ext_lower.as_str(), "png" | "jpg" | "jpeg" | "bmp" | "webp") {
                        let mtime = entry.metadata().and_then(|m| m.modified()).ok();
                        entries.push((path.to_string_lossy().to_string(), mtime));
                    }
                }
            }
        }
    }

    entries.sort_by(|a, b| b.1.cmp(&a.1));
    Ok(entries.into_iter().map(|(p, _)| p).collect())
}

/// Open the screenshots folder or select the specific file in File Explorer.
#[tauri::command]
pub fn overlay_open_screenshot_folder(file_or_dir_path: Option<String>) -> Result<(), String> {
    let target = if let Some(path) = file_or_dir_path {
        std::path::PathBuf::from(path)
    } else {
        #[cfg(windows)]
        {
            if let Ok(profile) = std::env::var("USERPROFILE") {
                std::path::PathBuf::from(profile).join("Videos").join("Captures")
            } else {
                std::path::PathBuf::from(".")
            }
        }
        #[cfg(not(windows))]
        {
            std::path::PathBuf::from(".")
        }
    };

    #[cfg(windows)]
    {
        use std::process::Command;
        if target.is_file() {
            let _ = Command::new("explorer")
                .arg(format!("/select,{}", target.to_string_lossy()))
                .spawn();
        } else {
            let _ = Command::new("explorer")
                .arg(target.to_string_lossy().as_ref())
                .spawn();
        }
        Ok(())
    }

    #[cfg(not(windows))]
    {
        Ok(())
    }
}

/// Delete a screenshot file from the filesystem.
#[tauri::command]
pub fn overlay_delete_screenshot(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Ok(());
    }
    if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
        let ext_lower = ext.to_lowercase();
        if matches!(ext_lower.as_str(), "png" | "jpg" | "jpeg" | "bmp" | "webp") {
            std::fs::remove_file(p).map_err(|e| format!("failed to delete screenshot: {e}"))?;
            return Ok(());
        }
    }
    Err("Invalid file type to delete".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn corner_rect_places_each_corner_inside_the_work_area() {
        let work = (0.0, 0.0, 1920.0, 1080.0);
        let size = (560.0, 420.0);
        let margin = 16.0;

        assert_eq!(corner_rect("top-left", work, size, margin).unwrap(), (16.0, 16.0));
        assert_eq!(
            corner_rect("top-right", work, size, margin).unwrap(),
            (1920.0 - 560.0 - 16.0, 16.0)
        );
        assert_eq!(
            corner_rect("bottom-left", work, size, margin).unwrap(),
            (16.0, 1080.0 - 420.0 - 16.0)
        );
        assert_eq!(
            corner_rect("bottom-right", work, size, margin).unwrap(),
            (1920.0 - 560.0 - 16.0, 1080.0 - 420.0 - 16.0)
        );
    }

    #[test]
    fn corner_rect_honours_monitor_offset() {
        // A second monitor to the right of the primary still anchors the
        // overlay to that monitor's own work area.
        let work = (1920.0, 0.0, 1280.0, 720.0);
        let size = (560.0, 420.0);
        let (x, y) = corner_rect("bottom-right", work, size, 10.0).unwrap();
        assert_eq!(x, 1920.0 + 1280.0 - 560.0 - 10.0);
        assert_eq!(y, 720.0 - 420.0 - 10.0);
    }

    #[test]
    fn corner_rect_clamps_to_work_area_origin_when_too_large() {
        let work = (100.0, 50.0, 400.0, 300.0);
        let size = (800.0, 600.0);
        assert_eq!(corner_rect("bottom-right", work, size, 8.0).unwrap(), (100.0, 50.0));
    }

    #[test]
    fn corner_rect_rejects_unknown_corner() {
        let work = (0.0, 0.0, 1920.0, 1080.0);
        let err = corner_rect("middle", work, (560.0, 420.0), 16.0).unwrap_err();
        assert!(err.contains("middle"));
    }

    #[test]
    fn settings_default_matches_the_design_contract() {
        let settings = OverlaySettings::default();
        assert!(settings.enabled);
        assert_eq!(settings.hotkey, "Shift+F1");
        assert_eq!(settings.corner, "bottom-right");
        assert!((settings.opacity - 0.9).abs() < f64::EPSILON);
        assert_eq!(
            settings.ticker_widgets,
            vec![
                "fps", "cpu", "gpu", "cpuTemp", "gpuTemp", "ram", "sparkline", "session", "mic",
                "record", "replay", "screenshot"
            ]
        );
        assert_eq!(settings.poll_interval_ms, 1000);
        assert_eq!(settings.panel_widgets.len(), 10);
        // Capture defaults
        assert_eq!(settings.screenshot_format, "png");
        assert_eq!(settings.screenshot_hotkey, "F12");
        assert!(settings.screenshot_copy_to_clipboard);
        assert_eq!(settings.video_hotkey, "Shift+F2");
        assert_eq!(settings.replay_hotkey, "Shift+F3");
        assert_eq!(settings.video_fps, 60);
        assert_eq!(settings.video_bitrate_kbps, 12_000);
        assert_eq!(settings.replay_buffer_seconds, 60);
        assert!(settings.video_game_audio);
        assert!(!settings.video_microphone);
    }

    #[test]
    fn settings_deserialize_partial_payload_keeps_defaults() {
        // Missing fields fall back to defaults; unknown fields are ignored.
        let parsed: OverlaySettings =
            serde_json::from_str(r#"{"hotkey":"Ctrl+F8","futureField":true}"#).unwrap();
        assert_eq!(parsed.hotkey, "Ctrl+F8");
        assert_eq!(parsed.corner, "bottom-right");
        assert_eq!(parsed.poll_interval_ms, 1000);
        assert_eq!(parsed.ticker_widgets.len(), 12);
    }

    #[test]
    fn settings_serialize_uses_camel_case_keys() {
        let value = serde_json::to_value(OverlaySettings::default()).unwrap();
        assert!(value.get("tickerWidgets").is_some());
        assert!(value.get("panelWidgets").is_some());
        assert!(value.get("pollIntervalMs").is_some());
        assert!(value.get("ticker_widgets").is_none());
        // Capture fields round-trip as camelCase too.
        assert!(value.get("screenshotFormat").is_some());
        assert!(value.get("replayBufferSeconds").is_some());
        assert!(value.get("videoBitrateKbps").is_some());
    }

    #[test]
    fn settings_partial_capture_payload_keeps_defaults() {
        // A payload saved before capture settings existed must still load.
        let parsed: OverlaySettings =
            serde_json::from_str(r#"{"videoFps":30}"#).unwrap();
        assert_eq!(parsed.video_fps, 30);
        assert_eq!(parsed.screenshot_format, "png");
        assert_eq!(parsed.video_bitrate_kbps, 12_000);
        assert!(parsed.video_enabled);
    }

    #[test]
    fn parse_accelerator_accepts_valid_and_rejects_invalid() {
        assert!(parse_accelerator("Shift+F1").is_ok());
        assert!(parse_accelerator("Ctrl+Alt+O").is_ok());
        let err = parse_accelerator("NotAKey").unwrap_err();
        assert!(err.contains("NotAKey"));
    }

    #[test]
    fn test_encode_uncompressed_png_header_and_structure() {
        let width = 2u32;
        let height = 2u32;
        let rgba = vec![
            255, 0, 0, 255,   0, 255, 0, 255,
            0, 0, 255, 255,   255, 255, 0, 255,
        ];
        let bytes = encode_uncompressed_png(width, height, &rgba);
        assert!(bytes.starts_with(b"\x89PNG\r\n\x1a\n"));
        assert!(bytes.len() > 30);
    }

    #[test]
    fn resolve_capture_dir_prefers_a_custom_folder() {
        let custom = resolve_capture_dir(Some("D:/clips"), "Hollow Knight");
        assert_eq!(custom, std::path::PathBuf::from("D:/clips"));

        // Blank/whitespace folds back to the per-game Captures tree.
        let blank = resolve_capture_dir(Some("   "), "Hollow Knight");
        assert!(blank.ends_with("Hollow Knight"));
    }

    #[test]
    fn encode_capture_emits_a_jpeg_signature_for_jpg() {
        let rgba = vec![
            255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 10, 10, 10, 255,
        ];
        let (bytes, ext) = encode_capture("jpg", 2, 2, &rgba);
        assert_eq!(ext, "jpg");
        assert_eq!(&bytes[..2], &[0xFF, 0xD8]);
    }

    #[test]
    fn encode_capture_falls_back_to_png_for_unknown_formats() {
        let rgba = vec![0u8; 2 * 2 * 4];
        let (bytes, ext) = encode_capture("tiff", 2, 2, &rgba);
        assert_eq!(ext, "png");
        assert!(bytes.starts_with(b"\x89PNG"));
    }
}

