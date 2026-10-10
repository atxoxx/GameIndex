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
const DEFAULT_TICKER_WIDTH: f64 = 360.0;
const DEFAULT_TICKER_HEIGHT: f64 = 56.0;
const DEFAULT_PANEL_WIDTH: f64 = 480.0;
const DEFAULT_PANEL_HEIGHT: f64 = 540.0;
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
}

impl Default for OverlaySettings {
    fn default() -> Self {
        Self {
            enabled: true,
            hotkey: "Shift+F1".to_string(),
            corner: "bottom-right".to_string(),
            opacity: 0.9,
            ticker_widgets: ["fps", "cpu", "gpu", "session"]
                .iter()
                .map(|s| s.to_string())
                .collect(),
            panel_widgets: [
                "session",
                "performance",
                "achievements",
                "downloads",
                "notifications",
                "notes",
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
        (settings.panel_width, settings.panel_height)
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
    let work_area = match target_monitor(app) {
        Some(monitor) => {
            let pos = monitor.position();
            let msize = monitor.size();
            (
                pos.x as f64,
                pos.y as f64,
                msize.width as f64,
                msize.height as f64,
            )
        }
        None => (0.0, 0.0, 1920.0, 1080.0),
    };
    let (ax, ay, aw, ah) = work_area;

    // An explicit user position (from dragging) wins, clamped so the window
    // always stays on the monitor; otherwise anchor to the configured corner.
    let (x, y) = match (settings.pos_x, settings.pos_y) {
        (Some(x), Some(y)) => (
            (x as f64).clamp(ax, (ax + aw - size.0).max(ax)),
            (y as f64).clamp(ay, (ay + ah - size.1).max(ay)),
        ),
        _ => corner_rect(&settings.corner, work_area, size, OVERLAY_MARGIN)?,
    };

    window
        .set_size(PhysicalSize::new(size.0 as u32, size.1 as u32))
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
    let collapsed = lock(state.inner()).collapsed;

    let settings = {
        let mut rt = lock(state.inner());
        rt.settings.pos_x = Some(pos.x);
        rt.settings.pos_y = Some(pos.y);
        if collapsed {
            rt.settings.ticker_width = size.width as f64;
            rt.settings.ticker_height = size.height as f64;
        } else {
            rt.settings.panel_width = size.width as f64;
            rt.settings.panel_height = size.height as f64;
        }
        rt.settings.clone()
    };
    persist_settings(&app, &settings)
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

/// Register `accelerator` as the global toggle hotkey, replacing any previous
/// binding. On failure the previous binding is restored and the error returned.
fn register_hotkey(
    app: &AppHandle,
    state: &OverlayState,
    accelerator: &str,
) -> Result<(), String> {
    let previous = lock(state).accelerator.clone();
    let shortcut = parse_accelerator(accelerator)?;

    let global = app.global_shortcut();
    if let Some(ref previous) = previous {
        if let Ok(old) = Shortcut::from_str(previous) {
            let _ = global.unregister(old);
        }
    }

    if let Err(e) = global.register(shortcut) {
        // Roll back to the binding that was working before.
        if let Some(ref previous) = previous {
            if let Ok(old) = Shortcut::from_str(previous) {
                let _ = global.register(old);
            }
        }
        return Err(format!("failed to register '{accelerator}': {e}"));
    }

    lock(state).accelerator = Some(accelerator.to_string());
    Ok(())
}

/// Register the persisted default hotkey at boot. Failures are logged, never
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
}

/// Global-shortcut handler. Toggles the HUD on/off: it reveals the compact
/// ticker when hidden and hides the overlay when visible. Runs on the main
/// thread so the window can be built/repositioned safely.
pub fn handle_hotkey(app: &AppHandle, shortcut: &Shortcut, event: ShortcutEvent) {
    if event.state != ShortcutState::Pressed {
        return;
    }
    let Some(state) = app.try_state::<OverlayState>() else {
        return;
    };

    // Ignore any shortcut that is not the overlay's current binding.
    let bound = lock(state.inner()).accelerator.clone();
    let Some(bound) = bound else {
        return;
    };
    if Shortcut::from_str(&bound)
        .map(|s| s.id() != shortcut.id())
        .unwrap_or(true)
    {
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
            // Tear the HUD down when the last game exits; the Destroyed
            // handler stops telemetry and emits `overlay:closed`.
            if let Some(window) = exited.get_webview_window(OVERLAY_WINDOW_LABEL) {
                let _ = window.close();
            }
        }
    });
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
        assert_eq!(settings.ticker_widgets, vec!["fps", "cpu", "gpu", "session"]);
        assert_eq!(settings.poll_interval_ms, 1000);
        assert_eq!(settings.panel_widgets.len(), 6);
    }

    #[test]
    fn settings_deserialize_partial_payload_keeps_defaults() {
        // Missing fields fall back to defaults; unknown fields are ignored.
        let parsed: OverlaySettings =
            serde_json::from_str(r#"{"hotkey":"Ctrl+F8","futureField":true}"#).unwrap();
        assert_eq!(parsed.hotkey, "Ctrl+F8");
        assert_eq!(parsed.corner, "bottom-right");
        assert_eq!(parsed.poll_interval_ms, 1000);
        assert_eq!(parsed.ticker_widgets, vec!["fps", "cpu", "gpu", "session"]);
    }

    #[test]
    fn settings_serialize_uses_camel_case_keys() {
        let value = serde_json::to_value(OverlaySettings::default()).unwrap();
        assert!(value.get("tickerWidgets").is_some());
        assert!(value.get("panelWidgets").is_some());
        assert!(value.get("pollIntervalMs").is_some());
        assert!(value.get("ticker_widgets").is_none());
    }

    #[test]
    fn parse_accelerator_accepts_valid_and_rejects_invalid() {
        assert!(parse_accelerator("Shift+F1").is_ok());
        assert!(parse_accelerator("Ctrl+Alt+O").is_ok());
        let err = parse_accelerator("NotAKey").unwrap_err();
        assert!(err.contains("NotAKey"));
    }
}
