//! In-game overlay HUD.
//!
//! A transparent, always-on-top window that floats over a borderless-windowed
//! game. It is built lazily on first show (never at boot), positioned in a
//! configured corner of the monitor under the cursor, and toggled between a
//! click-through ticker and an interactive panel by a global hotkey.
//!
//! The overlay is a pure view: this module owns the window lifecycle, the
//! toggle hotkey, the corner geometry, the settings persistence and the live
//! telemetry bridge. Windows and Linux are both supported; macOS builds stay
//! green but the HUD is inert there. On Linux the platform-specific work lives
//! in the `linux` child module (window traits) and the `linux_desktop` display
//! server probe, because X11 and Wayland need different mechanisms.

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

/// Linux-only window helpers (X11 focus hints + Wayland layer-shell).
#[cfg(target_os = "linux")]
mod linux;
/// Wayland global shortcuts via the XDG portal — the global-shortcut plugin
/// cannot bind on Wayland.
#[cfg(target_os = "linux")]
#[path = "overlay/hotkeys_linux.rs"]
pub(crate) mod hotkeys_linux;

/// Window label of the overlay webview. Mirrored in `tauri.conf.json` and
/// `capabilities/overlay.json`.
pub const OVERLAY_WINDOW_LABEL: &str = "overlay";
const MAIN_WINDOW_LABEL: &str = "main";

/// Single `kv_store` row holding the serialized [`OverlaySettings`].
const SETTINGS_KEY: &str = "overlay.settings.v1";

/// Single `kv_store` row holding the overlay's persisted telemetry history as
/// an opaque JSON blob. The backend never interprets it — the frontend owns the
/// shape and only round-trips it so the HUD's history survives a restart.
const HISTORY_KEY: &str = "overlay.history.v1";

/// Default window footprints in physical pixels. The user can drag/resize the
/// HUD; the resulting bounds are persisted per presentation (see
/// `overlay_save_bounds`).
const DEFAULT_TICKER_WIDTH: f64 = 480.0;
const DEFAULT_TICKER_HEIGHT: f64 = 72.0;
const DEFAULT_PANEL_WIDTH: f64 = 540.0;
const DEFAULT_PANEL_HEIGHT: f64 = 620.0;
/// Clamps so a bad persisted size can't produce an unusable window. The
/// expanded panel needs room for the labeled rail plus a readable column.
const MIN_TICKER_WIDTH: f64 = 180.0;
const MIN_TICKER_HEIGHT: f64 = 44.0;
const MIN_PANEL_WIDTH: f64 = 460.0;
const MIN_PANEL_HEIGHT: f64 = 400.0;
const MAX_OVERLAY_DIM: f64 = 4000.0;
/// Gap between the overlay edge and the monitor work-area edge.
const OVERLAY_MARGIN: f64 = 16.0;

/// Ceiling on the recent-captures list returned to the frontend. The gallery
/// only ever renders the newest handful (page size 40, limit 60), so a large
/// folder must not ship its whole listing over IPC on every poll — this cap
/// keeps the payload bounded even for a capture folder with thousands of
/// files, while still backing the wider `Captures`-style gallery grids.
const MAX_RECENT_CAPTURES: usize = 100;

/// Events (kept as consts so the frontend contract has one source of truth).
pub const EVENT_METRICS: &str = "overlay:metrics";
pub const EVENT_TOGGLE: &str = "overlay:toggle";
pub const EVENT_SESSION: &str = "overlay:session";
pub const EVENT_CLOSED: &str = "overlay:closed";
/// Full settings payload broadcast to the overlay window whenever the main
/// window (or the overlay itself) persists a change, so an already-open HUD
/// updates live instead of on next show.
pub const EVENT_SETTINGS: &str = "overlay:settings";
/// Theme id broadcast to the overlay window when the app theme changes.
pub const EVENT_THEME: &str = "theme:changed";
/// Emitted to the main window when a capture hotkey fails to bind, so the
/// settings UI can surface the conflict. Non-fatal: the previous binding (if
/// any) stays registered.
pub const EVENT_HOTKEY_ERROR: &str = "overlay:hotkey-error";

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
    /// Reduced-HUD presentation preset: `strip` | `gauges`.
    pub ticker_layout: String,
    /// Expanded-panel spacing preset: `comfortable` | `compact`.
    pub panel_density: String,
    /// Last panel section the user opened, so the next open resumes there.
    pub last_panel_section: String,
    /// Surface background: `glass` (blurred), `solid` (opaque) or `dim`.
    pub background_style: String,
    /// Backdrop blur radius in px (glass only).
    pub background_blur: f64,
    /// Background tint opacity, 0.2–1.0.
    pub background_opacity: f64,
    /// Drop the costly backdrop-filter and animated glows for performance.
    pub reduce_effects: bool,
    /// Accessibility: force the high-contrast HUD palette.
    pub high_contrast: bool,
    /// Accessibility: text/UI scale multiplier (`1.0` = default).
    pub text_scale: f64,
    /// Let clicks pass through the collapsed ticker so it never steals input
    /// from the game. The global hotkey still expands it to the panel.
    pub ticker_click_through: bool,
    /// Dim the collapsed ticker after this many seconds since it was last
    /// shown/interacted with. `0` disables.
    pub ticker_auto_dim_seconds: u32,
    /// Hide the collapsed ticker entirely after this many seconds since it was
    /// last shown/interacted with. `0` disables; the toggle hotkey peeks it
    /// back. Should be ≥ the dim timeout to make sense, but is not forced.
    pub ticker_auto_hide_seconds: u32,
    pub poll_interval_ms: u64,
    /// Show CPU/GPU temperatures in the performance widget.
    pub show_temps: bool,
    /// Adopt a library game that is running but wasn't launched through
    /// GameIndex (detected from live processes) as the HUD's current session.
    pub detect_current_game: bool,
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

    // ── Native window backdrop ─────────────────────────────────────────
    /// Whether the glass background should use the OS-native backdrop
    /// (Windows acrylic). The frontend computes the tint and applies it via
    /// `overlay_set_window_effect`; this field persists the preference so
    /// older payloads and restarts keep the choice.
    #[serde(default = "default_true")]
    pub native_blur: bool,
    /// Last native-backdrop tint applied, persisted so a rebuilt window
    /// replays the same glass before the frontend re-syncs. `None` clears it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effect_color: Option<[u8; 4]>,
}

fn default_true() -> bool {
    true
}

impl Default for OverlaySettings {
    fn default() -> Self {
        Self {
            enabled: false,
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
            ticker_layout: "strip".to_string(),
            panel_density: "comfortable".to_string(),
            last_panel_section: "session".to_string(),
            background_style: "glass".to_string(),
            background_blur: 14.0,
            background_opacity: 0.72,
            reduce_effects: false,
            high_contrast: false,
            text_scale: 1.0,
            ticker_click_through: false,
            ticker_auto_dim_seconds: 0,
            ticker_auto_hide_seconds: 0,
            poll_interval_ms: 1000,
            show_temps: true,
            detect_current_game: true,
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

            native_blur: true,
            effect_color: None,
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
    /// Native window backdrop currently applied (Windows acrylic tint), or
    /// `None` when the CSS background is in charge. Replayed on every show so
    /// a rebuilt window keeps its glass even before the frontend re-syncs.
    pub effect_color: Option<[u8; 4]>,
    /// Whether the collapsed ticker still resizes itself to its content. A
    /// manual resize turns it off so the user's size sticks; a settings change
    /// turns it back on (the widget set is what the auto-fit follows).
    pub ticker_auto_fit: bool,
    /// Bumped on every `present` so at most one monitor-follow loop owns the
    /// re-anchoring at a time (a stale loop exits on a generation mismatch).
    pub follow_generation: u64,
    /// Wayland-only: the running XDG GlobalShortcuts portal session, if any.
    #[cfg(target_os = "linux")]
    pub portal_hotkeys: Option<hotkeys_linux::PortalHotkeys>,
    /// Wayland-only: whether a portal-session refresh is already queued, so a
    /// burst of binding registrations rebuilds the session just once.
    #[cfg(target_os = "linux")]
    pub portal_refresh_pending: bool,
}

impl OverlayRuntime {
    pub fn new(settings: OverlaySettings) -> Self {
        Self {
            settings: settings.clone(),
            accelerator: None,
            screenshot_accelerator: None,
            record_accelerator: None,
            replay_accelerator: None,
            live: None,
            session: None,
            collapsed: true,
            effect_color: settings.effect_color,
            ticker_auto_fit: true,
            follow_generation: 0,
            #[cfg(target_os = "linux")]
            portal_hotkeys: None,
            #[cfg(target_os = "linux")]
            portal_refresh_pending: false,
        }
    }
}

/// Managed state type. `Arc<Mutex<..>>` per repo convention for shared state
/// beyond the `Db` pool.
pub type OverlayState = Arc<Mutex<OverlayRuntime>>;

fn lock(state: &OverlayState) -> MutexGuard<'_, OverlayRuntime> {
    state.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Clear the session-scoped flags that must never survive a restart. They sit
/// inside the settings blob only so the frontend can mirror them; the actual
/// recorder state lives in `capture::CaptureState` and starts idle on boot, so
/// loading a persisted `video_recording: true` would leave the settings
/// mirror claiming a recording is running when nothing is.
pub fn clear_session_scoped_flags(settings: &mut OverlaySettings) {
    settings.video_recording = false;
    settings.replay_buffer_active = false;
}

/// Read persisted settings from kv, falling back cleanly when the row is
/// absent, unreadable or written by an older schema.
pub fn load_settings(db: &db::Db) -> OverlaySettings {
    match db::kv::get(db, SETTINGS_KEY) {
        Ok(Some(raw)) => {
            let mut settings: OverlaySettings = serde_json::from_str(&raw).unwrap_or_default();
            // A quit/crash mid-recording persisted the session-scoped flags;
            // the recorder itself starts idle, so reset them on every boot.
            clear_session_scoped_flags(&mut settings);
            settings
        }
        _ => OverlaySettings::default(),
    }
}

fn persist_settings(app: &AppHandle, settings: &OverlaySettings) -> Result<(), String> {
    let db = app.state::<db::Db>().inner().clone();
    let json = serde_json::to_string(settings).map_err(|e| format!("overlay settings: {e}"))?;
    db::kv::set(&db, SETTINGS_KEY, &json)
}

/// Mirror the current settings to every window so a live HUD picks up edits
/// made in the main window (or from its own controls) without a reopen, AND
/// the Settings → Overlay tab can rebase its snapshot on edits made from the
/// HUD itself (`OverlayTab` holds a full-settings snapshot that otherwise
/// goes stale the moment the HUD's own settings widget saves).
fn emit_settings(app: &AppHandle, settings: &OverlaySettings) {
    // `emit` broadcasts to every window/webview, including `main`.
    let _ = app.emit(EVENT_SETTINGS, settings);
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

/// Whether the overlay window should pass mouse input through to whatever is
/// behind it. Only the collapsed ticker can be click-through, and only when the
/// user opted in — the expanded panel always needs the mouse.
fn should_ignore_cursor(settings: &OverlaySettings, collapsed: bool) -> bool {
    collapsed && settings.ticker_click_through
}

/// Minimum usable window size for the given presentation.
fn min_overlay_size(collapsed: bool) -> (f64, f64) {
    if collapsed {
        (MIN_TICKER_WIDTH, MIN_TICKER_HEIGHT)
    } else {
        (MIN_PANEL_WIDTH, MIN_PANEL_HEIGHT)
    }
}

/// Window size for the ticker (`collapsed`) vs the expanded panel, clamped to
/// a usable range so a stale persisted value can't produce a broken window.
fn overlay_size(settings: &OverlaySettings, collapsed: bool) -> (f64, f64) {
    let (w, h) = if collapsed {
        (settings.ticker_width, settings.ticker_height)
    } else {
        // Honour a user-saved smaller panel footprint; the outer clamp below
        // still guards against an unusable persisted size.
        (settings.panel_width, settings.panel_height)
    };
    let (min_w, min_h) = min_overlay_size(collapsed);
    (
        w.clamp(min_w, MAX_OVERLAY_DIM),
        h.clamp(min_h, MAX_OVERLAY_DIM),
    )
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Whether the overlay window is currently visible. `false` when there is no
/// window, so a capture taken while the HUD is hidden never re-shows it.
fn overlay_visible(app: &AppHandle) -> bool {
    app.get_webview_window(OVERLAY_WINDOW_LABEL)
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false)
}

/// Resolve the active game's display title for capture commands: the live
/// session's library-game name, or `GameIndex` when idle / untracked.
fn current_game_title(app: &AppHandle) -> String {
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
}

/// Center of the foreground window in physical pixels, or `None` when there is
/// none. The HUD is a non-activating tool window, so the foreground window is
/// the game (or another app) rather than the overlay itself — this lets the HUD
/// follow the display the game is actually on instead of wherever the cursor
/// happens to rest.
#[cfg(windows)]
fn foreground_window_center() -> Option<(f64, f64)> {
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowRect};

    unsafe {
        let hwnd: HWND = GetForegroundWindow();
        if hwnd.0.is_null() {
            return None;
        }
        let mut rect = RECT::default();
        if GetWindowRect(hwnd, &mut rect).is_err() {
            return None;
        }
        Some((
            (rect.left + rect.right) as f64 / 2.0,
            (rect.top + rect.bottom) as f64 / 2.0,
        ))
    }
}

#[cfg(not(windows))]
fn foreground_window_center() -> Option<(f64, f64)> {
    None
}

/// The monitor the overlay should target. There is no portable "monitor of the
/// game window" API, so we approximate it with the monitor under the foreground
/// window (the running game), then the monitor under the cursor, then the
/// primary monitor, then the first available one.
fn target_monitor(app: &AppHandle) -> Option<tauri::Monitor> {
    if let Some((x, y)) = foreground_window_center() {
        if let Ok(Some(monitor)) = app.monitor_from_point(x, y) {
            return Some(monitor);
        }
    }
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

#[cfg(target_os = "linux")]
fn make_non_activating(window: &WebviewWindow) {
    linux::make_non_activating(window);
}

#[cfg(not(any(windows, target_os = "linux")))]
fn make_non_activating(_window: &WebviewWindow) {}

/// Toggle the `WS_EX_NOACTIVATE` extended style so the expanded panel can take
/// keyboard focus (Notes, the hotkey recorder) while the collapsed ticker stays
/// non-activating and never steals foreground from the game. `WS_EX_TOOLWINDOW`
/// is always kept set so the HUD never appears in the taskbar/alt-tab list.
#[cfg(windows)]
fn set_activation_style(window: &WebviewWindow, activating: bool) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
    };

    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    let raw = hwnd.0 as isize;
    unsafe {
        let hwnd = HWND(raw as *mut std::ffi::c_void);
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let mut next = ex | (WS_EX_TOOLWINDOW.0 as isize);
        if activating {
            next &= !(WS_EX_NOACTIVATE.0 as isize);
        } else {
            next |= WS_EX_NOACTIVATE.0 as isize;
        }
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next);
    }
}

#[cfg(target_os = "linux")]
fn set_activation_style(window: &WebviewWindow, activating: bool) {
    linux::set_activation_style(window, activating);
}

#[cfg(not(any(windows, target_os = "linux")))]
fn set_activation_style(_window: &WebviewWindow, _activating: bool) {}

/// Apply (or clear) the native window backdrop that gives the HUD real,
/// behind-the-game blur. CSS `backdrop-filter` cannot sample the desktop from a
/// transparent webview, so on Windows we ask DWM for an acrylic material and
/// tint it with the frontend-computed surface colour + opacity. `None` clears
/// the effect (solid / dim / performance mode).
#[cfg(windows)]
fn apply_native_effect(window: &WebviewWindow, color: Option<[u8; 4]>) {
    use tauri::window::{Color, Effect, EffectsBuilder};
    use tauri::utils::config::WindowEffectsConfig;

    match color {
        Some([r, g, b, a]) => {
            let acrylic = EffectsBuilder::new()
                .effect(Effect::Acrylic)
                .color(Color(r, g, b, a))
                .build();
            if window.set_effects(acrylic).is_err() {
                // Older Windows builds reject acrylic; the legacy Aero blur is
                // a reasonable fallback (also tinted).
                let blur = EffectsBuilder::new()
                    .effect(Effect::Blur)
                    .color(Color(r, g, b, a))
                    .build();
                let _ = window.set_effects(blur);
            }
        }
        None => {
            let _ = window.set_effects(None::<WindowEffectsConfig>);
        }
    }
}

#[cfg(target_os = "linux")]
fn apply_native_effect(window: &WebviewWindow, color: Option<[u8; 4]>) {
    linux::apply_native_effect(window, color);
}

#[cfg(not(any(windows, target_os = "linux")))]
fn apply_native_effect(_window: &WebviewWindow, _color: Option<[u8; 4]>) {}

/// Apply platform-specific window traits right after the overlay window is
/// built. Wayland's layer-shell must be initialised before the first show.
#[cfg(target_os = "linux")]
fn configure_platform_window(window: &WebviewWindow) {
    linux::configure_window(window);
}

#[cfg(not(target_os = "linux"))]
fn configure_platform_window(_window: &WebviewWindow) {}

/// Kick the layer surface after a show.
///
/// gtk-layer-shell can leave a surface configured but never presented when its
/// synchronous wait for the initial configure times out on a busy compositor —
/// the HUD then reports visible but draws nothing. Queue a resize/redraw and
/// force a commit once control returns to the main loop.
#[cfg(target_os = "linux")]
fn commit_layer_surface(window: &WebviewWindow, app: &AppHandle) {
    let kick = window.clone();
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let _ = handle.run_on_main_thread(move || {
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                if let Ok(gtk_window) = kick.gtk_window() {
                    use gtk::prelude::*;
                    gtk_window.queue_resize();
                    gtk_window.queue_draw();
                    linux::try_force_commit(&gtk_window);
                }
            }));
        });
    });
}

#[cfg(not(target_os = "linux"))]
fn commit_layer_surface(_window: &WebviewWindow, _app: &AppHandle) {}

/// The target monitor's work area `(x, y, width, height)` in physical pixels
/// and its scale factor, with a 1920×1080 fallback when none is available.
fn monitor_geometry(app: &AppHandle) -> ((f64, f64, f64, f64), f64) {
    match target_monitor(app) {
        Some(monitor) => {
            let pos = monitor.position();
            let size = monitor.size();
            (
                (
                    pos.x as f64,
                    pos.y as f64,
                    size.width as f64,
                    size.height as f64,
                ),
                monitor.scale_factor(),
            )
        }
        None => ((0.0, 0.0, 1920.0, 1080.0), 1.0),
    }
}

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
    let (work_area, scale_factor) = monitor_geometry(app);
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

    // Wayland layer-shell positions by anchor + margin, not by pixel origin, so
    // hand it the corner + size, or a monitor-local free position after a drag.
    #[cfg(target_os = "linux")]
    if crate::linux_desktop::is_wayland() {
        let free_pos = match (settings.pos_x, settings.pos_y) {
            (Some(_), Some(_)) => Some((x - ax, y - ay)),
            _ => None,
        };
        linux::set_geometry(
            window,
            &settings.corner,
            phys_size.0,
            phys_size.1,
            phys_margin,
            free_pos,
        );
        return Ok(());
    }

    // Skip the move/resize round-trip when the window already sits exactly
    // where the geometry wants it: the monitor-follow loop re-evaluates this
    // every few seconds and each native call would otherwise churn the window
    // (visible flicker on some compositors) for a no-op.
    if let (Ok(cur_pos), Ok(cur_size)) = (window.outer_position(), window.inner_size()) {
        let target_pos = (
            x.round() as i32,
            y.round() as i32,
        );
        let target_size = (
            phys_size.0.round() as i32,
            phys_size.1.round() as i32,
        );
        if (cur_pos.x - target_pos.0).abs() <= 2
            && (cur_pos.y - target_pos.1).abs() <= 2
            && (cur_size.width as i32 - target_size.0).abs() <= 2
            && (cur_size.height as i32 - target_size.1).abs() <= 2
        {
            return Ok(());
        }
    }

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

    if let Some(webview) = app.get_webview(OVERLAY_WINDOW_LABEL) {
        crate::webkit_memory::tune_webview(&webview);
    }

    // Wayland layer-shell (and any future platform traits) must be applied
    // before the window is first shown.
    configure_platform_window(&window);

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
        rt.follow_generation += 1;
        rt.settings.clone()
    };

    let window = ensure_window(app)?;
    apply_geometry(&window, app, &settings, collapsed)?;
    window.show().map_err(|e| format!("failed to show overlay: {e}"))?;
    commit_layer_surface(&window, app);
    // Deliberately no `set_focus()`: yanking focus from a running game can drop
    // its input. The HUD is always-on-top; clicking the ticker focuses and
    // expands it.
    // The collapsed ticker is click-through only when the user opted in (so it
    // never steals input from the game); the expanded panel always takes the
    // mouse. The window is sized to its content so the game stays clickable
    // everywhere else.
    window
        .set_ignore_cursor_events(should_ignore_cursor(&settings, collapsed))
        .map_err(|e| e.to_string())?;
    // The panel needs keyboard focus for its inputs; the ticker stays
    // non-activating so it never steals foreground from the game.
    set_activation_style(&window, !collapsed);

    // Replay the native backdrop so a freshly rebuilt window keeps its glass
    // even before the frontend re-syncs its background settings.
    let effect = lock(state.inner()).effect_color;
    apply_native_effect(&window, effect);

    // Replay the current session so a freshly built overlay renders the
    // session widget without waiting for the next game lifecycle event.
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
    // Keep following the display the game lives on: a fullscreen game moved to
    // another monitor (or a second session starting there) re-anchors the HUD
    // to it, as long as the user hasn't dragged the HUD to a manual position.
    spawn_monitor_follow(app);
    // Telemetry is kicked off by a spawned task (same contract as
    // `spawn_live_refresh`): `present` is also called from `run_on_main_thread`
    // on the global-hotkey path, and `resolve_pid`/`start_live` lock the
    // GameWatcher mutex — `apply_poll` can hold that lock for a full PID
    // liveness sweep, and running it inline on the main thread stalled the
    // whole UI ("GameIndex Overlay — Ne répond pas").
    spawn_live_refresh(app);
    Ok(())
}

/// Re-anchor the overlay when the game's monitor changes.
///
/// A background loop (one per `present`; the generation counter retires the
/// previous one) re-evaluates the target monitor every few seconds while the
/// HUD is visible. It exits as soon as the window is gone/hidden, the user
/// dragged the HUD to a manual position, or a newer `present` superseded it.
/// Must be spawned, never inlined: it sleeps and locks the overlay state.
fn spawn_monitor_follow(app: &AppHandle) {
    let state = app.state::<OverlayState>();
    let generation = lock(state.inner()).follow_generation;
    let app = app.clone();
    let state = state.inner().clone();
    tauri::async_runtime::spawn(async move {
        let mut last_monitor: Option<(i32, i32)> = None;
        loop {
            tokio::time::sleep(Duration::from_secs(5)).await;
            let Some(window) = app.get_webview_window(OVERLAY_WINDOW_LABEL) else {
                return;
            };
            if !window.is_visible().unwrap_or(false) {
                return;
            }
            let (manual_pos, collapsed, gen) = {
                let rt = lock(&state);
                (
                    rt.settings.pos_x.is_some() || rt.settings.pos_y.is_some(),
                    rt.collapsed,
                    rt.follow_generation,
                )
            };
            if manual_pos || gen != generation {
                return;
            }
            let origin = target_monitor(&app).map(|m| (m.position().x, m.position().y));
            match origin {
                None => continue,
                Some(o) if last_monitor == Some(o) => continue,
                Some(o) => {
                    let settings = lock(&state).settings.clone();
                    if apply_geometry(&window, &app, &settings, collapsed).is_ok() {
                        last_monitor = Some(o);
                    }
                }
            }
        }
    });
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

/// Jump from the HUD to the full overlay settings page. The HUD is
/// always-on-top, so hide it first, raise the main window, and let the app
/// shell route itself through the `app:navigate` event.
#[tauri::command]
pub async fn overlay_open_settings(app: AppHandle) -> Result<(), String> {
    overlay_hide(app.clone())?;
    if let Some(main) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
        let _ = app.emit_to(MAIN_WINDOW_LABEL, "app:navigate", "/settings/overlay");
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

/// Whether the platform supports a native window backdrop (real behind-the-
/// window blur). Windows only; the frontend falls back to the CSS glass
/// otherwise.
#[tauri::command]
pub fn overlay_native_blur_supported() -> bool {
    cfg!(windows)
}

/// Enable/disable the native window backdrop and set its tint. The frontend
/// computes `color` (surface RGB + the user's opacity) so the acrylic matches
/// the active theme. The choice is mirrored into the runtime for instant
/// replay on a rebuilt window AND persisted into settings (`effect_color` /
/// `native_blur`), so the glass survives an app restart without waiting for
/// the frontend's first settings sync.
#[tauri::command]
pub fn overlay_set_window_effect(
    app: AppHandle,
    state: tauri::State<'_, OverlayState>,
    enabled: bool,
    color: Vec<u8>,
) -> Result<(), String> {
    let value = if enabled && color.len() == 4 {
        Some([color[0], color[1], color[2], color[3]])
    } else {
        None
    };
    let settings = {
        let mut rt = lock(state.inner());
        rt.effect_color = value;
        rt.settings.native_blur = enabled;
        rt.settings.effect_color = value;
        rt.settings.clone()
    };
    persist_settings(&app, &settings).ok();
    if let Some(window) = app.get_webview_window(OVERLAY_WINDOW_LABEL) {
        apply_native_effect(&window, value);
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
        let _ = window.set_ignore_cursor_events(should_ignore_cursor(&settings, collapsed));
        set_activation_style(&window, !collapsed);
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
    // On Wayland the layer surface exposes no client-readable position/size;
    // move/resize already recorded the result in the runtime mirror, so persist
    // that directly.
    #[cfg(target_os = "linux")]
    if crate::linux_desktop::is_wayland() {
        let settings = lock(state.inner()).settings.clone();
        return persist_settings(&app, &settings);
    }

    let Some(window) = app.get_webview_window(OVERLAY_WINDOW_LABEL) else {
        return Ok(());
    };
    let pos = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.inner_size().map_err(|e| e.to_string())?;
    let scale = window.scale_factor().unwrap_or(1.0);
    let collapsed = lock(state.inner()).collapsed;

    let settings = {
        let mut rt = lock(state.inner());
        // A programmatic resize (content auto-fit, a ticker/panel switch) fires
        // the same move/resize events as a manual drag. Keep the overlay
        // corner-anchored while it still sits exactly where the corner math puts
        // it, so those events can't silently pin an absolute position.
        //
        // The comparison runs against the monitor the window is ON, never the
        // monitor `target_monitor` picks (foreground window / cursor): if the
        // game hops to another display during the frontend's debounced save,
        // the target's corner rect no longer matches the window anywhere and a
        // programmatic resize would be misread as a user drag — pinning the HUD
        // and permanently killing monitor-follow (`spawn_monitor_follow` exits
        // on `manual_pos` until the user re-picks a corner).
        let keep_anchored = match (rt.settings.pos_x, rt.settings.pos_y) {
            (None, None) => {
                let on_screen = window
                    .current_monitor()
                    .ok()
                    .flatten()
                    .map(|monitor| {
                        let mpos = monitor.position();
                        let msize = monitor.size();
                        (
                            (
                                mpos.x as f64,
                                mpos.y as f64,
                                msize.width as f64,
                                msize.height as f64,
                            ),
                            monitor.scale_factor(),
                        )
                    })
                    .unwrap_or_else(|| monitor_geometry(&app));
                let size = overlay_size(&rt.settings, collapsed);
                let phys = (size.0 * on_screen.1, size.1 * on_screen.1);
                corner_rect(
                    &rt.settings.corner,
                    on_screen.0,
                    phys,
                    OVERLAY_MARGIN * on_screen.1,
                )
                .map(|(ax, ay)| {
                    ((pos.x as f64) - ax).abs() < 2.0 && ((pos.y as f64) - ay).abs() < 2.0
                })
                .unwrap_or(false)
            }
            _ => false,
        };
        if !keep_anchored {
            rt.settings.pos_x = Some(pos.x);
            rt.settings.pos_y = Some(pos.y);
        }
        if collapsed {
            rt.settings.ticker_width = ((size.width as f64) / scale).round();
            rt.settings.ticker_height = ((size.height as f64) / scale).round();
        } else {
            rt.settings.panel_width = ((size.width as f64) / scale).round();
            rt.settings.panel_height = ((size.height as f64) / scale).round();
        }
        let (min_w, min_h) = min_overlay_size(collapsed);
        if collapsed {
            rt.settings.ticker_width = rt.settings.ticker_width.max(min_w);
            rt.settings.ticker_height = rt.settings.ticker_height.max(min_h);
        } else {
            rt.settings.panel_width = rt.settings.panel_width.max(min_w);
            rt.settings.panel_height = rt.settings.panel_height.max(min_h);
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
        if !rt.collapsed || !rt.ticker_auto_fit {
            return Ok(());
        }
        let w = width.clamp(MIN_TICKER_WIDTH, MAX_OVERLAY_DIM);
        let h = height.clamp(MIN_TICKER_HEIGHT, MAX_OVERLAY_DIM);
        // Ignore sub-pixel churn so the ResizeObserver can't ping-pong. The
        // frontend adds a 2 px content kernel per measurement, so a 1 px
        // tolerance re-triggers a resize on every mixed-DPI layout pass
        // (resize → fit → resize loop); the window must lag content growth
        // slightly instead of chasing it.
        if (rt.settings.ticker_width - w).abs() < 3.0
            && (rt.settings.ticker_height - h).abs() < 3.0
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

/// Move the overlay by a physical-pixel delta (a drag on Wayland, where layer
/// surfaces cannot use the native move path). The first move seeds an explicit
/// position from the current corner; later moves are clamped to the monitor and
/// the window is re-anchored there.
#[tauri::command]
pub fn overlay_move_by(
    app: AppHandle,
    state: tauri::State<'_, OverlayState>,
    dx: f64,
    dy: f64,
) -> Result<(), String> {
    let (settings, collapsed) = {
        let rt = lock(state.inner());
        (rt.settings.clone(), rt.collapsed)
    };
    let (work_area, scale) = monitor_geometry(&app);
    let (ax, ay, aw, ah) = work_area;
    let size = overlay_size(&settings, collapsed);
    let phys_size = (size.0 * scale, size.1 * scale);

    let (cx, cy) = match (settings.pos_x, settings.pos_y) {
        (Some(x), Some(y)) => (x as f64, y as f64),
        _ => corner_rect(&settings.corner, work_area, phys_size, OVERLAY_MARGIN * scale)?,
    };
    let nx = (cx + dx).clamp(ax, (ax + aw - phys_size.0).max(ax));
    let ny = (cy + dy).clamp(ay, (ay + ah - phys_size.1).max(ay));

    let settings = {
        let mut rt = lock(state.inner());
        rt.settings.pos_x = Some(nx.round() as i32);
        rt.settings.pos_y = Some(ny.round() as i32);
        rt.settings.clone()
    };
    if let Some(window) = app.get_webview_window(OVERLAY_WINDOW_LABEL) {
        apply_geometry(&window, &app, &settings, collapsed)?;
    }
    Ok(())
}

/// Resize the overlay to `width` × `height` logical pixels (a drag on the
/// resize handles under Wayland). Applies to the active presentation.
#[tauri::command]
pub fn overlay_resize_to(
    app: AppHandle,
    state: tauri::State<'_, OverlayState>,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let (settings, collapsed) = {
        let mut rt = lock(state.inner());
        let (min_w, min_h) = min_overlay_size(rt.collapsed);
        let w = width.clamp(min_w, MAX_OVERLAY_DIM);
        let h = height.clamp(min_h, MAX_OVERLAY_DIM);
        if rt.collapsed {
            rt.settings.ticker_width = w;
            rt.settings.ticker_height = h;
            // The user sized the ticker directly; stop the content auto-fit
            // from snapping it back until the widget set changes again.
            rt.ticker_auto_fit = false;
        } else {
            rt.settings.panel_width = w;
            rt.settings.panel_height = h;
        }
        (rt.settings.clone(), rt.collapsed)
    };
    if let Some(window) = app.get_webview_window(OVERLAY_WINDOW_LABEL) {
        apply_geometry(&window, &app, &settings, collapsed)?;
    }
    Ok(())
}

/// The display-server token ("wayland" / "x11" / "other") so the frontend can
/// pick its window drag/resize strategy.
#[tauri::command]
pub fn overlay_desktop_server() -> String {
    #[cfg(target_os = "linux")]
    {
        crate::linux_desktop::server().to_string()
    }
    #[cfg(not(target_os = "linux"))]
    {
        "other".to_string()
    }
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
    emit_settings(&app, &settings);
    if let Some(window) = app.get_webview_window(OVERLAY_WINDOW_LABEL) {
        apply_geometry(&window, &app, &settings, collapsed)?;
    }
    // Clearing the dragged position re-arms corner anchoring, but the
    // monitor-follow loop exits as soon as a manual position exists and
    // nothing respawns it — so respawn it here or the HUD stops following the
    // game's monitor until the next hotkey toggle.
    if settings.pos_x.is_none() && settings.pos_y.is_none() {
        spawn_monitor_follow(&app);
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

/// Persist the overlay's telemetry history. The payload is an opaque JSON blob
/// owned by the frontend; the backend only stores it in the kv table so the
/// HUD's graphs survive a restart.
#[tauri::command]
pub fn overlay_save_history(app: AppHandle, json: String) -> Result<(), String> {
    let db = app.state::<db::Db>().inner().clone();
    db::kv::set(&db, HISTORY_KEY, &json)
}

/// Load the persisted overlay telemetry history, or `None` when nothing has
/// been saved yet (first run / fresh install).
#[tauri::command]
pub fn overlay_load_history(app: AppHandle) -> Result<Option<String>, String> {
    let db = app.state::<db::Db>().inner().clone();
    db::kv::get(&db, HISTORY_KEY)
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

    // The overlay is disabled: every global binding must be dropped, right
    // now and from here on. Rebinding on every save (previously unconditional)
    // meant nudging any other field while the master switch was off brought
    // Shift+F1 / F12 / Shift+F2 / Shift+F3 back to life.
    if !settings.enabled {
        unregister_all_hotkeys(&app, state.inner());
    } else {
        // Surfaces an invalid/conflicting binding as an error and keeps the
        // previous one, so a bad save never leaves the overlay unreachable.
        register_hotkey(&app, state.inner(), &settings.hotkey)?;
    }

    {
        let mut rt = lock(state.inner());
        rt.settings = settings.clone();
        // A settings change alters the ticker's widget set, so let the content
        // auto-fit take over again even if the user had resized manually.
        rt.ticker_auto_fit = true;
    }
    if settings.enabled {
        // Capture bindings are best-effort; a conflict there is logged, not
        // fatal. Registered after the settings swap so the video_enabled gate
        // inside reads the NEW value — disabling video capture unbinds the
        // record/replay hotkeys immediately instead of on the next boot.
        register_capture_hotkeys(&app, state.inner());
    }

    persist_settings(&app, &settings)?;
    emit_settings(&app, &settings);

    if let Some(window) = app.get_webview_window(OVERLAY_WINDOW_LABEL) {
        let collapsed = lock(state.inner()).collapsed;
        apply_geometry(&window, &app, &settings, collapsed)?;
        // A click-through preference change must take effect immediately for
        // the currently displayed presentation.
        let _ = window.set_ignore_cursor_events(should_ignore_cursor(&settings, collapsed));
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
    // While the overlay is disabled the accelerator is recorded but NOT bound:
    // every global binding stays down (see `overlay_save_settings`).
    if lock(state.inner()).settings.enabled {
        // `register_hotkey` restores the previous binding itself when the new
        // one fails, so we simply propagate the error.
        register_hotkey(&app, state.inner(), &accelerator)?;
    }

    let settings = {
        let mut rt = lock(state.inner());
        rt.settings.hotkey = accelerator;
        rt.settings.clone()
    };
    persist_settings(&app, &settings)?;
    emit_settings(&app, &settings);
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

/// Start (or restart) the live telemetry sampler for `pid`. Only one sampler
/// runs at a time; any previous one is stopped first. Reuses the user's
/// telemetry gating exactly as the session collector does.
///
/// `gpu_id`/`gpu_name` target the adapter to sample; when omitted the
/// watcher's last-launch GPU is used. Passing `None` for both would sample GPU
/// index 0, which on multi-adapter systems can be a virtual/other GPU — hence
/// the fallback rather than a hardcoded `None`.
///
/// `interval_override_ms` replaces the persisted poll interval (used by the
/// performance deep-dive, which wants a much finer sample rate while open);
/// `None` uses `settings.poll_interval_ms`.
fn start_live(
    app: &AppHandle,
    pid: u32,
    gpu_id: Option<String>,
    gpu_name: Option<String>,
    interval_override_ms: Option<u64>,
) -> Result<(), String> {
    let state = app.state::<OverlayState>();

    let previous = lock(state.inner()).live.take();
    if let Some(previous) = previous {
        previous.stop();
    }

    // The telemetry config and the launch-scoped GPU both live on the watcher;
    // read them under one lock. An explicit selection (the detected-game path,
    // which has no launch record) wins over the watcher's last-launch value.
    let (config, watcher_gpu_id, watcher_gpu_name) = match app
        .state::<Arc<Mutex<GameWatcher>>>()
        .lock()
    {
        Ok(w) => {
            let (id, name) = w.gpu();
            (w.metrics_config(), id, name)
        }
        Err(_) => (metrics_collector::MetricsConfig::default(), None, None),
    };
    let gpu_id = gpu_id.or(watcher_gpu_id);
    let gpu_name = gpu_name.or(watcher_gpu_name);

    // FPS is the overlay's headline metric, so always attempt the RTSS/
    // Afterburner read here even if the user turned FPS off for session
    // recording. Everything else honours the session gating.
    let mut config = config;
    config.capture_fps = true;
    // Clamp so a misconfigured tiny/zero interval can't spin the sampler. The
    // deep-dive override may go as low as 100 ms (RTSS/MAHM reads are cheap
    // shared-memory maps; the expensive WMI fan-out is gated by the capture
    // flags, and the focus gate skips it when the game is backgrounded).
    let interval_ms = interval_override_ms
        .unwrap_or_else(|| lock(state.inner()).settings.poll_interval_ms)
        .max(100);
    let interval = Duration::from_millis(interval_ms);

    let emit_app = app.clone();
    let handle = metrics_collector::start_live_collection(
        config,
        pid,
        gpu_id,
        gpu_name,
        interval,
        move |sample| {
            let _ = emit_app.emit_to(OVERLAY_WINDOW_LABEL, EVENT_METRICS, sample);
        },
    );

    lock(state.inner()).live = Some(handle);
    Ok(())
}

/// Start the live telemetry sampler for `pid`, optionally targeting an
/// explicit GPU. The overlay frontend passes the user's selected GPU (shared
/// localStorage) so a game adopted via detection samples the same adapter as
/// an app-launched session; omitting them falls back to the watcher's GPU.
///
/// `intervalMs` optionally overrides the persisted poll interval — the
/// performance deep-dive passes a small value (e.g. 100) while it is open and
/// re-calls without it when closed, so the ordinary ticker rate is restored.
#[tauri::command]
pub fn overlay_start_live_metrics(
    app: AppHandle,
    pid: u32,
    gpu_id: Option<String>,
    gpu_name: Option<String>,
    interval_ms: Option<u64>,
) -> Result<(), String> {
    start_live(&app, pid, gpu_id, gpu_name, interval_ms)
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

    // The global-shortcut plugin cannot bind on Wayland (there is no protocol);
    // the XDG GlobalShortcuts portal is the only supported path there. Validate
    // the accelerator, record it, then reconcile the whole set through the
    // portal (it registers all bindings in one session).
    #[cfg(target_os = "linux")]
    if hotkeys_linux::is_supported() {
        if !trimmed.is_empty() {
            parse_accelerator(&trimmed)?;
        }
        which.set(
            &mut lock(state),
            if trimmed.is_empty() { None } else { Some(trimmed) },
        );
        reconcile_portal_hotkeys(app, state);
        return Ok(());
    }

    let global = app.global_shortcut();
    // Validate BEFORE unregistering the previous binding: a parse failure at
    // this point must leave the old accelerator registered (the Wayland
    // branch above has always validated in this order — this path used to
    // unregister first, so a rejected string killed the working hotkey while
    // the UI kept showing it).
    let shortcut = if trimmed.is_empty() {
        None
    } else {
        Some(parse_accelerator(&trimmed)?)
    };

    if let Some(ref previous) = previous {
        if let Ok(old) = Shortcut::from_str(previous) {
            let _ = global.unregister(old);
        }
    }

    let Some(shortcut) = shortcut else {
        which.set(&mut lock(state), None);
        return Ok(());
    };

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

/// Drop every global binding (toggle + all capture bindings) and clear the
/// runtime mirrors. Called when the overlay is disabled so a stray
/// Shift+F1 / F12 / Shift+F2 / Shift+F3 can never pop or act on a HUD the
/// user turned off.
fn unregister_all_hotkeys(app: &AppHandle, state: &OverlayState) {
    for which in [
        Binding::Toggle,
        Binding::Screenshot,
        Binding::Record,
        Binding::Replay,
    ] {
        // An empty accelerator takes the unregister path through
        // `register_binding`, so the portal reconciliation (Wayland) and the
        // runtime mirror are kept in step with the bound state.
        let _ = register_binding(app, state, which, "");
    }
}

/// (Re)register every global capture binding (screenshot / record / replay).
/// Best-effort: a bad or conflicting capture binding is logged, never fatal.
///
/// When video capture is disabled (`video_enabled`), the record/replay
/// bindings are **unregistered** instead — the toggle must actually keep the
/// recorder out of reach, not just hide its UI. The screenshot binding is
/// unaffected (screenshots are not gated by `video_enabled`).
fn register_capture_hotkeys(app: &AppHandle, state: &OverlayState) {
    let (screenshot, record, replay, video_enabled) = {
        let rt = lock(state);
        (
            rt.settings.screenshot_hotkey.clone(),
            rt.settings.video_hotkey.clone(),
            rt.settings.replay_hotkey.clone(),
            rt.settings.video_enabled,
        )
    };
    let record_replay: Option<(String, String)> = if video_enabled {
        Some((record, replay))
    } else {
        // Pass an empty accelerator through the normal path: it unregisters
        // the current binding and records `None` in the runtime mirror.
        None
    };
    let bindings: Vec<(Binding, &'static str, String)> = match record_replay {
        Some((record, replay)) => vec![
            (Binding::Screenshot, "screenshot", screenshot),
            (Binding::Record, "record", record),
            (Binding::Replay, "replay", replay),
        ],
        None => vec![
            (Binding::Screenshot, "screenshot", screenshot),
            (Binding::Record, "record", String::new()),
            (Binding::Replay, "replay", String::new()),
        ],
    };
    for (which, name, accel) in bindings {
        if let Err(e) = register_binding(app, state, which, &accel) {
            eprintln!("[overlay] capture hotkey registration failed: {e}");
            // Non-fatal, but the settings UI should know the binding was
            // rejected (conflict/invalid accelerator) so it can warn the user.
            let _ = app.emit_to(
                MAIN_WINDOW_LABEL,
                EVENT_HOTKEY_ERROR,
                serde_json::json!({
                    "binding": name,
                    "accelerator": accel,
                    "error": e,
                }),
            );
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

/// Queue a rebuild of the Wayland GlobalShortcuts portal session.
///
/// On boot and on each settings save the toggle and the three capture bindings
/// are registered in quick succession. Each registration would rebuild the
/// whole session, opening several KDE shortcut prompts back to back, so the
/// rebuild is deferred and coalesced: the first call schedules it and the rest
/// in the same burst are no-ops.
#[cfg(target_os = "linux")]
fn reconcile_portal_hotkeys(app: &AppHandle, state: &OverlayState) {
    {
        let mut rt = lock(state);
        if rt.portal_refresh_pending {
            return;
        }
        rt.portal_refresh_pending = true;
    }

    let app = app.clone();
    let state = state.clone();
    tauri::async_runtime::spawn(async move {
        // Give the other registrations in this batch time to land first.
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        lock(&state).portal_refresh_pending = false;
        rebuild_portal_hotkeys(&app, &state);
    });
}

/// Rebuild the Wayland GlobalShortcuts portal session from the current
/// bindings. The portal registers the whole set in one session, so any change
/// replaces the previous one.
#[cfg(target_os = "linux")]
fn rebuild_portal_hotkeys(app: &AppHandle, state: &OverlayState) {
    let bindings = {
        let rt = lock(state);
        [
            ("toggle", &rt.accelerator),
            ("screenshot", &rt.screenshot_accelerator),
            ("record", &rt.record_accelerator),
            ("replay", &rt.replay_accelerator),
        ]
        .into_iter()
        .filter_map(|(id, accel)| {
            accel
                .as_ref()
                .filter(|a| !a.is_empty())
                .map(|a| (id.to_string(), a.clone()))
        })
        .collect::<Vec<_>>()
    };

    if let Some(previous) = lock(state).portal_hotkeys.take() {
        previous.stop();
    }
    if bindings.is_empty() {
        return;
    }
    match hotkeys_linux::start(app.clone(), bindings) {
        Ok(service) => lock(state).portal_hotkeys = Some(service),
        Err(e) => eprintln!("[overlay] wayland global shortcuts unavailable: {e}"),
    }
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

    let (enabled, is_toggle, is_shot, is_rec, is_replay) = {
        let rt = lock(state.inner());
        (
            rt.settings.enabled,
            matches(&rt.accelerator),
            matches(&rt.screenshot_accelerator),
            matches(&rt.record_accelerator),
            matches(&rt.replay_accelerator),
        )
    };

    // Every dispatch is gated on the master switch: bindings can only exist
    // while the overlay is enabled, but this belt-and-braces check keeps a
    // stale/binding conflict from acting on a HUD the user turned off.
    if !enabled {
        return;
    }

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
            let _ = crate::capture::capture_toggle_recording(handle).await;
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

/// Dispatch an action triggered by a Wayland GlobalShortcuts portal binding.
/// `id` is one of `toggle` | `screenshot` | `record` | `replay` — the same
/// actions [`handle_hotkey`] maps accelerators to.
#[cfg(target_os = "linux")]
pub(crate) fn dispatch_portal_binding(app: &AppHandle, id: &str) {
    match id {
        "screenshot" => {
            let handle = app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = overlay_capture_screenshot(handle, None).await;
            });
        }
        "record" => {
            let handle = app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = crate::capture::capture_toggle_recording(handle).await;
            });
        }
        "replay" => {
            let handle = app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = crate::capture::save_replay_impl(&handle);
            });
        }
        "toggle" => {
            let handle = app.clone();
            let _ = app.run_on_main_thread(move || {
                if let Err(e) = show_or_toggle(&handle) {
                    eprintln!("[overlay] hotkey toggle failed: {e}");
                }
            });
        }
        other => eprintln!("[overlay] unknown portal binding: {other}"),
    }
}

/// Hotkey behaviour: a three-state cycle over the HUD — hidden → compact
/// ticker → expanded panel → hidden. Stepping through the ticker lets a
/// click-through ticker (which ignores the mouse) still be expanded, since the
/// hotkey is the only way in.
fn show_or_toggle(app: &AppHandle) -> Result<(), String> {
    let Some(state) = app.try_state::<OverlayState>() else {
        return Ok(());
    };
    // The hotkey must never pop a HUD the user turned off (binds are gated on
    // `enabled`; this covers a stale mirror too).
    if !lock(state.inner()).settings.enabled {
        return Ok(());
    }
    let visible = app
        .get_webview_window(OVERLAY_WINDOW_LABEL)
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false);

    if !visible {
        return present(app, true);
    }
    if lock(state.inner()).collapsed {
        return present(app, false);
    }

    // Visible panel → hide the HUD and stop telemetry. The window is kept warm
    // so the next show is instant.
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

/// Restart the live sampler after a `game-started` event.
///
/// CONTRACT — must be **spawned**, never called inline on the emitting thread.
/// `launch_game` emits `game-started` while holding the `GameWatcher` mutex
/// and Tauri runs event listeners synchronously on the emitting thread; when
/// that thread is the main thread, `run_on_main_thread` would execute the
/// closure INLINE (see `send_user_message`) so the first
/// `resolve_pid`/`start_live` call re-locks the same non-reentrant watcher
/// mutex and deadlocks the whole app ("GameIndex Overlay — Ne répond pas").
/// Spawning onto the async runtime simply waits until the lock is released,
/// matching the downloads `game-started` listener. Any new code that reacts
/// to events emitted under the GameWatcher lock must follow this pattern.
fn spawn_live_refresh(app: &AppHandle) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        if handle.try_state::<OverlayState>().is_none() {
            return;
        }
        let visible = handle
            .get_webview_window(OVERLAY_WINDOW_LABEL)
            .and_then(|w| w.is_visible().ok())
            .unwrap_or(false);
        if !visible {
            return;
        }
        let session = handle
            .try_state::<OverlayState>()
            .and_then(|state| lock(state.inner()).session.clone());
        if let Some(session) = session {
            let pid = resolve_pid(&handle, &session);
            if pid != 0 {
                let _ = start_live(&handle, pid, None, None, None);
            }
        }
    });
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

        // See `spawn_live_refresh` for why this must be a spawned task.
        spawn_live_refresh(&started);
    });

    let exited = app.clone();
    app.listen("game-exited", move |event| {
        // Only clear the overlay session once the last game has quit; if
        // another session remains, keep showing it. `remainingGameName` comes
        // from the launch/watcher bookkeeping, but the force-close path admits
        // it cannot always recover the value — it emits `null` even while
        // other sessions are alive. So `null` alone must never tear the HUD
        // down: the spawned check below asks the watcher (the source of truth)
        // instead, and `Some(name)` short-circuits without touching it.
        let remaining = serde_json::from_str::<serde_json::Value>(event.payload())
            .ok()
            .and_then(|v| {
                v.get("remainingGameName")
                    .and_then(|name| name.as_str())
                    .map(str::to_string)
            });
        if remaining.is_some() {
            return;
        }
        spawn_exit_teardown(exited.clone());
    });
}

/// Verify with the GameWatcher that no session is left, then stop the HUD
/// telemetry/capture and close the overlay window.
///
/// CONTRACT — must be **spawned**, never called inline on the emitting thread:
/// the poll loop emits `game-exited` while holding the GameWatcher mutex (the
/// same shape `launch_game`'s `game-started` emit is, see
/// `spawn_live_refresh`), so `has_active_sessions` inline would deadlock. The
/// re-check loop tidies the racy window where the exited session has not been
/// reaped from the watcher yet.
fn spawn_exit_teardown(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut still_tracked = false;
        for delay_ms in [0u64, 1500] {
            if delay_ms > 0 {
                tokio::time::sleep(Duration::from_millis(delay_ms)).await;
            }
            still_tracked = app
                .try_state::<Arc<Mutex<GameWatcher>>>()
                .and_then(|watcher| watcher.lock().ok().map(|w| w.has_active_sessions()))
                .unwrap_or(false);
            if !still_tracked {
                break;
            }
        }
        // A session is still being tracked (another game runs, or the
        // re-check timing lost a race): leave the HUD exactly as it is.
        if still_tracked {
            return;
        }
        set_session(&app, None);
        // A recording/replay buffer makes no sense once the game is gone.
        crate::capture::stop_all(&app);
        // Tear the HUD down; the Destroyed handler stops telemetry and emits
        // `overlay:closed`.
        if let Some(window) = app.get_webview_window(OVERLAY_WINDOW_LABEL) {
            let _ = window.close();
        }
    });
}

pub const EVENT_SCREENSHOT: &str = "overlay:screenshot-captured";

/// Serialized capture flag. Every capture hides the HUD, waits and restores
/// it, so two overlapping captures (a rapid F12 double-press, or the hotkey
/// firing while the panel button is already capturing — the frontend's
/// `isCapturing` guard can't see backend-driven captures) interleave their
/// hide/show cycles and duplicate gallery events. Backend-side serialization
/// makes the second press a no-op instead.
static CAPTURE_IN_FLIGHT: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// RAII reset for [`CAPTURE_IN_FLIGHT`] so every error return re-arms it.
struct CaptureGuard;

impl CaptureGuard {
    /// `Err` when a capture is already running.
    fn acquire() -> Result<Self, String> {
        use std::sync::atomic::Ordering;
        CAPTURE_IN_FLIGHT
            .compare_exchange(
                false,
                true,
                Ordering::SeqCst,
                Ordering::SeqCst,
            )
            .map(|_| CaptureGuard)
            .map_err(|_| "another screen capture is already in progress".to_string())
    }
}

impl Drop for CaptureGuard {
    fn drop(&mut self) {
        CAPTURE_IN_FLIGHT.store(false, std::sync::atomic::Ordering::SeqCst);
    }
}

/// Re-show the HUD after a capture with the presentation invariants intact.
/// The hide/show round-trip must not regress click-through or the
/// non-activating style, and a window destroyed mid-capture must not be
/// resurrected (`win.show()` on a `None` lookup is skipped naturally).
fn restore_overlay_after_capture(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(OVERLAY_WINDOW_LABEL) {
        let (collapsed, click_through) = app
            .try_state::<OverlayState>()
            .map(|state| {
                let rt = lock(state.inner());
                (rt.collapsed, rt.settings.ticker_click_through)
            })
            .unwrap_or((true, false));
        let _ = win.set_ignore_cursor_events(click_through && collapsed);
        set_activation_style(&win, !collapsed);
        let _ = win.show();
    }
}

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

/// Encode raw top-down RGBA8 pixels as a compressed PNG via the `png` crate.
/// This is a fraction of the size of the stored-block writer it replaced for
/// large (1440p/4K) captures. If the encoder ever rejects the frame it falls
/// back to [`encode_stored_png`], so a capture is never lost.
pub fn encode_png(width: u32, height: u32, rgba: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    let encoded = {
        let mut encoder = png::Encoder::new(&mut out, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        match encoder.write_header() {
            Ok(mut writer) => {
                writer.write_image_data(rgba).is_ok() && writer.finish().is_ok()
            }
            Err(_) => false,
        }
    };
    if encoded {
        out
    } else {
        encode_stored_png(width, height, rgba)
    }
}

/// Standalone, dependency-free PNG encoder that stores raw pixels as
/// uncompressed deflate blocks (RFC 2083 / RFC 1950). Fallback for
/// [`encode_png`].
fn encode_stored_png(width: u32, height: u32, rgba: &[u8]) -> Vec<u8> {
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
        fn GetForegroundWindow() -> *mut std::ffi::c_void;
        fn MonitorFromWindow(hwnd: *mut std::ffi::c_void, dw_flags: u32) -> *mut std::ffi::c_void;
        fn GetMonitorInfoW(hmonitor: *mut std::ffi::c_void, lpmi: *mut MonitorInfo) -> i32;
    }

    const SM_CXSCREEN: i32 = 0;
    const SM_CYSCREEN: i32 = 1;
    const SRCCOPY: u32 = 0x00CC0020;
    const DIB_RGB_COLORS: u32 = 0;
    const BI_RGB: u32 = 0;
    const MONITOR_DEFAULTTOPRIMARY: u32 = 0x1;

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct Rect {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }

    #[repr(C)]
    struct MonitorInfo {
        cb_size: u32,
        rc_monitor: Rect,
        rc_work: Rect,
        dw_flags: u32,
    }

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
            let null_hwnd = std::ptr::null_mut();

            // Target the monitor the foreground (game) window lives on so a
            // game on a secondary display is grabbed from the right origin
            // instead of the primary monitor's (0, 0). Any failure along the
            // way falls back to the primary monitor, matching the old
            // behaviour.
            let mut left = 0i32;
            let mut top = 0i32;
            let mut width = GetSystemMetrics(SM_CXSCREEN);
            let mut height = GetSystemMetrics(SM_CYSCREEN);

            let foreground = GetForegroundWindow();
            if !foreground.is_null() {
                let monitor = MonitorFromWindow(foreground, MONITOR_DEFAULTTOPRIMARY);
                if !monitor.is_null() {
                    let mut info = MonitorInfo {
                        cb_size: std::mem::size_of::<MonitorInfo>() as u32,
                        rc_monitor: Rect::default(),
                        rc_work: Rect::default(),
                        dw_flags: 0,
                    };
                    if GetMonitorInfoW(monitor, &mut info) != 0 {
                        let rc = info.rc_monitor;
                        let w = rc.right - rc.left;
                        let h = rc.bottom - rc.top;
                        if w > 0 && h > 0 {
                            left = rc.left;
                            top = rc.top;
                            width = w;
                            height = h;
                        }
                    }
                }
            }

            if width <= 0 || height <= 0 {
                return Err("Invalid desktop screen dimensions".into());
            }

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
            let blt_res = BitBlt(hdc_mem, 0, 0, width, height, hdc_screen, left, top, SRCCOPY);

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

#[cfg(target_os = "linux")]
#[path = "overlay/screenshot_linux.rs"]
mod gdi_capture;

#[cfg(not(any(windows, target_os = "linux")))]
mod gdi_capture {
    use std::path::Path;

    pub fn capture_rgba() -> Result<(u32, u32, Vec<u8>), String> {
        Err("In-game screen capture is currently supported on Windows and Linux".into())
    }

    pub fn capture_desktop(_dest: &Path) -> Result<(u32, u32), String> {
        Err("In-game screen capture is currently supported on Windows and Linux".into())
    }
}

/// The user's Videos shell folder, honouring library redirection (OneDrive /
/// "Move" folder changes store the real location in the Explorer Shell Folders
/// key) — a plain `%USERPROFILE%\Videos` join would silently miss it and the
/// i18n promise "captures go to your Videos folder" would be wrong.
#[cfg(windows)]
fn videos_dir() -> Option<std::path::PathBuf> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    // `{374DE290-123F-4565-9164-39C4925E467B}` is the "My Video" shell folder
    // GUID.
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu
        .open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders")
        .ok()?;
    key.get_value("{374DE290-123F-4565-9164-39C4925E467B}")
        .ok()
        .map(|value: String| std::path::PathBuf::from(value).join("Captures"))
}

#[cfg(not(windows))]
fn videos_dir() -> Option<std::path::PathBuf> {
    std::env::var("HOME")
        .ok()
        .map(|home| std::path::PathBuf::from(home).join("Videos").join("Captures"))
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

    if let Some(captures) = videos_dir() {
        return captures.join(folder_name);
    }

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
            Err(_) => (encode_png(width, height, rgba), "png"),
        }
    } else {
        (encode_png(width, height, rgba), "png")
    }
}

/// Capture the desktop/game screen to the Windows Captures folder, auto-indexed by GameIndex.
#[tauri::command]
pub async fn overlay_capture_screenshot(
    app: AppHandle,
    game_title: Option<String>,
) -> Result<ScreenshotResult, String> {
    // Snapshot the capture-relevant settings up front so the hot path doesn't
    // hold the runtime lock while the capture runs. The active game's title is
    // resolved in the same pass (session + DB) — `current_game_title` would
    // re-lock the runtime and hit the games table again further down, and the
    // capture delay between the two passes could observe a different session.
    let (title, hide_overlay, delay_ms, format, folder) = match app.try_state::<OverlayState>() {
        Some(state) => {
            let rt = lock(state.inner());
            let game_title = rt
                .session
                .as_ref()
                .map(|session| {
                    let db = app.state::<db::Db>().inner().clone();
                    db::games::get(&db, &session.game_id)
                        .ok()
                        .flatten()
                        .map(|g| g.name)
                })
                .unwrap_or(None);
            (
                game_title,
                !rt.settings.screenshot_include_overlay,
                rt.settings.screenshot_delay_ms,
                rt.settings.screenshot_format.clone(),
                rt.settings.screenshot_folder.clone(),
            )
        }
        None => (None, true, 60, "png".to_string(), None),
    };
    let title = game_title.or(title);

    // Serialize overlapping captures before anything touches the window.
    let _capture_guard = CaptureGuard::acquire()?;

    // Remember whether the HUD was on screen before this capture. A snapshot
    // taken while it is hidden (or auto-hidden after idle) must leave it
    // hidden: re-showing here would pop the ticker back up mid-game.
    let was_visible = overlay_visible(&app);

    // 1. Temporarily hide the overlay so it doesn't photograph itself, unless
    //    the user asked for the HUD to appear in their captures.
    if hide_overlay && was_visible {
        if let Some(win) = app.get_webview_window(OVERLAY_WINDOW_LABEL) {
            let _ = win.hide();
        }
        tokio::time::sleep(Duration::from_millis(delay_ms.max(20))).await;
    }

    let title = title.unwrap_or_else(|| current_game_title(&app));

    let dir = resolve_capture_dir(folder.as_deref(), &title);
    if !dir.exists() {
        let _ = std::fs::create_dir_all(&dir);
    }

    let timestamp = now_ms();
    let date_str = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
    let stem = format!("Capture_{}_{}", date_str, timestamp % 1000);

    // Grab the frame off the async worker: the Wayland path drives a portal
    // round-trip (and possibly an interactive user prompt) that must not stall
    // the runtime.
    let capture_result =
        match tauri::async_runtime::spawn_blocking(gdi_capture::capture_rgba).await {
            Ok(result) => result,
            Err(e) => Err(format!("screen capture task failed: {e}")),
        };
    let (width, height, rgba) = match capture_result {
        Ok(frame) => frame,
        Err(e) => {
            if hide_overlay && was_visible {
                restore_overlay_after_capture(&app);
            }
            return Err(e);
        }
    };

    let (bytes, ext) = encode_capture(&format, width, height, &rgba);
    let file_name = format!("{stem}.{ext}");
    let dest_path = dir.join(&file_name);
    if let Err(e) = std::fs::write(&dest_path, bytes) {
        if hide_overlay && was_visible {
            restore_overlay_after_capture(&app);
        }
        return Err(format!("Failed to write screenshot file: {e}"));
    }

    // 2. Restore overlay window (only if the HUD was visible before the
    //    capture; a hidden/auto-hidden HUD stays hidden).
    if hide_overlay && was_visible {
        restore_overlay_after_capture(&app);
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
    state: tauri::State<'_, OverlayState>,
    game_title: Option<String>,
) -> Result<Vec<String>, String> {
    let title = game_title.unwrap_or_else(|| current_game_title(&app));

    // Honour a custom screenshot folder, matching where `capture_screenshot`
    // actually wrote the files; otherwise fall back to the per-game tree.
    let folder = lock(state.inner()).settings.screenshot_folder.clone();
    let dir = resolve_capture_dir(folder.as_deref(), &title);
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
    // Newest-first, capped: a folder that has accumulated thousands of
    // captures must not push its whole listing through IPC.
    entries.truncate(MAX_RECENT_CAPTURES);
    Ok(entries.into_iter().map(|(p, _)| p).collect())
}

/// Open the screenshots folder or select the specific file in File Explorer.
#[tauri::command]
pub fn overlay_open_screenshot_folder(
    state: tauri::State<'_, OverlayState>,
    file_or_dir_path: Option<String>,
) -> Result<(), String> {
    let _ = &state;

    #[cfg(windows)]
    let target = if let Some(path) = file_or_dir_path {
        std::path::PathBuf::from(path)
    } else if let Some(folder) = lock(state.inner())
        .settings
        .screenshot_folder
        .clone()
        .filter(|f| !f.trim().is_empty())
    {
        // Open the configured folder rather than the default tree, so the
        // button lands where the captures actually are.
        std::path::PathBuf::from(folder)
    } else if let Some(captures) = videos_dir() {
        // Same resolution as `get_captures_dir` (registry/OneDrive aware), just
        // without the per-game leaf.
        captures
    } else {
        std::path::PathBuf::from(".")
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
        let _ = file_or_dir_path;
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
        assert!(!settings.enabled);
        assert_eq!(settings.hotkey, "Shift+F1");
        assert_eq!(settings.corner, "bottom-right");
        assert!((settings.opacity - 0.9).abs() < f64::EPSILON);
        assert!(!settings.ticker_click_through);
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
    fn should_ignore_cursor_only_for_a_click_through_ticker() {
        let mut settings = OverlaySettings::default();
        // The expanded panel is always interactive; the ticker only passes
        // clicks through when the user opted in.
        assert!(!should_ignore_cursor(&settings, false));
        assert!(!should_ignore_cursor(&settings, true));

        settings.ticker_click_through = true;
        assert!(!should_ignore_cursor(&settings, false));
        assert!(should_ignore_cursor(&settings, true));
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
        assert!(value.get("tickerClickThrough").is_some());
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
    fn session_scoped_flags_never_survive_a_load() {
        // A quit/crash mid-recording persists the session-scoped flags inside
        // the settings blob; clearing them must leave everything else intact.
        let parsed: OverlaySettings =
            serde_json::from_str(r#"{"videoRecording":true,"replayBufferActive":true}"#).unwrap();
        assert!(parsed.video_recording && parsed.replay_buffer_active);
        let mut cleared = parsed;
        clear_session_scoped_flags(&mut cleared);
        assert!(!cleared.video_recording);
        assert!(!cleared.replay_buffer_active);
        assert_eq!(cleared.video_fps, 60);
        assert!(cleared.video_enabled);
    }

    #[test]
    fn parse_accelerator_accepts_valid_and_rejects_invalid() {
        assert!(parse_accelerator("Shift+F1").is_ok());
        assert!(parse_accelerator("Ctrl+Alt+O").is_ok());
        let err = parse_accelerator("NotAKey").unwrap_err();
        assert!(err.contains("NotAKey"));
    }

    #[test]
    fn encode_png_round_trips_the_pixels() {
        let width = 2u32;
        let height = 2u32;
        let rgba = vec![
            255, 0, 0, 255,   0, 255, 0, 255,
            0, 0, 255, 255,   255, 255, 0, 255,
        ];
        let bytes = encode_png(width, height, &rgba);
        assert!(bytes.starts_with(b"\x89PNG\r\n\x1a\n"));

        let decoder = png::Decoder::new(std::io::Cursor::new(bytes));
        let mut reader = decoder.read_info().unwrap();
        let mut buf = vec![0u8; reader.output_buffer_size()];
        let info = reader.next_frame(&mut buf).unwrap();
        assert_eq!((info.width, info.height), (width, height));
        assert_eq!(&buf[..info.buffer_size()], rgba.as_slice());
    }

    #[test]
    fn encode_png_compresses_larger_than_stored_blocks() {
        // A flat image deflates far below the stored-block fallback, proving the
        // compressed path is actually in use.
        let rgba = vec![120u8; 256 * 256 * 4];
        let compressed = encode_png(256, 256, &rgba);
        let stored = encode_stored_png(256, 256, &rgba);
        assert!(compressed.len() < stored.len());
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

