//! System tray icon + right-click menu with a live status line,
//! recent-game shortcuts, download progress, and page navigation.
//!
//! Built with Tauri's first-party `tauri::tray` API (available because
//! the `unstable` feature is enabled in Cargo.toml). No third-party
//! plugin required — the same surface ships with Tauri 2 itself.
//!
//! ## Menu shape
//!
//! ```text
//!   Status line (disabled): "GameIndex — idle"  or  "Playing: <name>"
//!   ─────────────────
//!   Show GameIndex
//!   Hide to tray                (disabled when window is already hidden)
//!   ─────────────────
//!   Recent Games ▸             (up to 8 games from the sessions table)
//!   Downloads ▸                (live rows + "Open Downloads")
//!   ─────────────────
//!   Library / Store / Activity / Friends / Mods / Settings
//!   ─────────────────
//!   Quit GameIndex
//! ```
//!
//! Left-click on the tray icon is **not** a menu trigger — it acts as
//! "Show GameIndex" so the user can dismiss the menu without an extra
//! click. Right-click opens the context menu (built-in behaviour when
//! `show_menu_on_left_click(false)` is set).
//!
//! ## Rebuild strategy
//!
//! The whole menu is rebuilt via [`rebuild_menu`] whenever its inputs
//! change. `game-started` / `game-exited` rebuild immediately;
//! `download-progress` (emitted ~1/s) is throttled to at most one
//! rebuild per 2s and only when the download signature (count +
//! per-download status/progress) actually changed. One `on_menu_event`
//! handler stays attached to the tray for the lifetime of the app —
//! menu events route through the tray regardless of which `Menu`
//! instance is currently set.
//!
//! ## Lifecycle
//!
//! `build_tray` is called once from `lib.rs::run` inside `.setup(...)`
//! after `GameWatcher` is registered. Returns `tauri::Result<()>` so
//! failures surface — but the caller wraps the call with
//! `unwrap_or_else(|e| eprintln!(...))` because a missing tray
//! (eg. headless Linux without a system tray) must not abort startup;
//! the launcher body still works, the user just can't reach the tray.
//!
//! ## State propagation
//!
//! `game-started` / `game-exited` payloads are read directly (never
//! via `GameWatcher` — see the deadlock note in `build_tray`) and
//! `download-progress` payloads are snapshotted into `TrayHandles`.
//! Windows-only extras: taskbar progress bar, taskbar overlay badge,
//! and a green-dot variant of the tray icon while a game is running.
//!
//! ## Localization
//!
//! Every user-facing string lives in [`TrayStrings`], which the
//! frontend emits as the `tray-strings` event in the active UI
//! language. Until the first emission the English `Default` is in
//! effect (the app starts in English, so the swap is seamless);
//! `{key}` placeholders are substituted via [`fill`].

use std::collections::HashSet;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::Value;
use tauri::image::Image;
use tauri::menu::{IsMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Emitter, Listener, Manager, Wry};
#[cfg(target_os = "windows")]
use tauri::window::{ProgressBarState, ProgressBarStatus};

use crate::db;
use crate::db::games::GameRow;

/// Managed state: the tray handle plus the inputs `rebuild_menu`
/// renders from. `TrayIcon<Wry>` is a cheap clone (Arc-backed), so
/// listeners grab it back from `app.state::<TrayHandles>()` (keyed by
/// `TypeId`, not generics — pinning `Wry` keeps every consumer simple).
pub struct TrayHandles {
    pub tray: TrayIcon<Wry>,
    /// Currently running game name, from `game-started`/`game-exited`.
    pub playing: Mutex<Option<String>>,
    /// Raw snapshot of the last `download-progress` payload.
    pub downloads: Mutex<Vec<Value>>,
    /// When the menu was last rebuilt (download throttle clock).
    pub last_rebuild: Mutex<Instant>,
    /// Signature of the downloads the menu was last rebuilt with.
    pub dl_signature: Mutex<String>,
    /// Localized menu/tooltip strings in the active UI language.
    pub strings: Mutex<TrayStrings>,
}

/// Every user-facing tray string, emitted by the frontend as the
/// `tray-strings` event in the active UI language. `Default` is the
/// English fallback used until the first emission — the app starts in
/// English, so the swap is seamless.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayStrings {
    pub idle: String,
    /// "Playing: {game}"
    pub playing: String,
    pub show: String,
    pub hide: String,
    pub quit: String,
    pub recent: String,
    pub no_recent: String,
    pub downloads: String,
    /// "Downloads: {count} active"
    pub downloads_active: String,
    pub no_downloads: String,
    /// "{name} — {pct}% ({downloaded} / {total})"
    pub download_row: String,
    /// "{name} — starting…"
    pub download_starting: String,
    pub open_downloads: String,
    pub library: String,
    pub store: String,
    pub activity: String,
    pub friends: String,
    pub mods: String,
    pub settings: String,
}

impl Default for TrayStrings {
    fn default() -> Self {
        Self {
            idle: "GameIndex — idle".into(),
            playing: "Playing: {game}".into(),
            show: "Show GameIndex".into(),
            hide: "Hide to tray".into(),
            quit: "Quit GameIndex".into(),
            recent: "Recent Games".into(),
            no_recent: "No recent games".into(),
            downloads: "Downloads".into(),
            downloads_active: "Downloads: {count} active".into(),
            no_downloads: "No active downloads".into(),
            download_row: "{name} — {pct}% ({downloaded} / {total})".into(),
            download_starting: "{name} — starting…".into(),
            open_downloads: "Open Downloads".into(),
            library: "Library".into(),
            store: "Store".into(),
            activity: "Activity".into(),
            friends: "Friends".into(),
            mods: "Mods".into(),
            settings: "Settings".into(),
        }
    }
}

/// Substitute every `{key}` occurrence in a template with its value
/// (keys: game, count, name, pct, downloaded, total).
fn fill(template: &str, pairs: &[(&str, &str)]) -> String {
    let mut out = template.to_string();
    for (key, value) in pairs {
        out = out.replace(&format!("{{{key}}}"), value);
    }
    out
}

/// Build the system tray icon, attach the menu, register event
/// listeners, and manage the state struct.
///
/// Called from `lib.rs::run` inside `.setup(...)` after `GameWatcher`
/// has been registered and its background poll loop has started.
/// Returns `tauri::Result<()>` — callers log-and-continue on error
/// because the absence of a tray mustn't abort app startup
/// (headless Linux launches won't have one).
pub fn build_tray(app: &App<Wry>) -> tauri::Result<()> {
    let handle = app.handle();

    // Use the bundled app icon — already configured as the default
    // window icon by tauri.conf.json so we don't need to load a
    // separate file from disk. `default_window_icon()` returns
    // `Option<&Image>`; cloning yields `Option<Image>` so the
    // builder takes ownership.
    let icon = handle
        .default_window_icon()
        .cloned()
        .ok_or_else(|| tauri::Error::AssetNotFound("default-window-icon".into()))?;

    // Placeholder menu; `rebuild_menu` below installs the real one.
    // The menu-event handler stays attached to the tray for the app's
    // lifetime — Tauri routes every menu event through it no matter
    // which `Menu` instance is currently set.
    let tray = TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .menu(&Menu::new(handle)?)
        // Show the menu on right-click only; left-click is "Show
        // GameIndex" via the on_tray_icon_event handler below. This
        // matches Discord / Steam / Spotify behaviour.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| handle_menu_event(app, event))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, .. } = event {
                show_window(tray.app_handle());
            }
        })
        .build(handle)?;

    app.manage(TrayHandles {
        tray: tray.clone(),
        playing: Mutex::new(None),
        downloads: Mutex::new(Vec::new()),
        // Backdated so the first `download-progress` tick rebuilds
        // immediately instead of waiting out the 2s throttle.
        last_rebuild: Mutex::new(Instant::now() - Duration::from_secs(3)),
        dl_signature: Mutex::new(String::new()),
        strings: Mutex::new(TrayStrings::default()),
    });

    rebuild_menu(handle)?;

    // Live update subscribers that read the game name DIRECTLY from
    // each event payload — deliberately avoiding any call to
    // `GameWatcher.current_session_name()` because Tauri's emit is
    // synchronous: when `launch_game` or the background poll thread
    // emits "game-started"/"game-exited" while holding
    // `watcher.lock()`, re-locking from this listener would deadlock.
    //
    // On game-started we stamp "Playing: <name>". On game-exited we
    // inspect `remainingGameName` (populated by `finish_session` while
    // it still held the lock) — if another session is still active we
    // show that name, otherwise we flip back to idle.
    let app_handle_started = handle.clone();
    handle.listen("game-started", move |event| {
        let app = app_handle_started.clone();
        let Ok(val) = serde_json::from_str::<Value>(event.payload()) else {
            return;
        };
        let Some(name) = val.get("gameName").and_then(|v| v.as_str()) else {
            return;
        };
        let state = app.state::<TrayHandles>();
        *state.playing.lock().unwrap() = Some(name.to_string());
        let s = state.strings.lock().unwrap().clone();
        let _ = state
            .tray
            .set_tooltip(Some(fill(&s.playing, &[("game", name)])));
        if let Some(icon) = playing_icon(&app) {
            let _ = state.tray.set_icon(Some(icon));
        }
        #[cfg(target_os = "windows")]
        update_overlay(&app, &state);
        let _ = rebuild_menu(&app);
    });

    let app_handle_exited = handle.clone();
    handle.listen("game-exited", move |event| {
        let app = app_handle_exited.clone();
        let Ok(val) = serde_json::from_str::<Value>(event.payload()) else {
            return;
        };
        let state = app.state::<TrayHandles>();
        let remaining = val
            .get("remainingGameName")
            .and_then(|v| v.as_str())
            .map(str::to_string);
        *state.playing.lock().unwrap() = remaining.clone();
        let s = state.strings.lock().unwrap().clone();
        match remaining {
            Some(name) => {
                let _ = state
                    .tray
                    .set_tooltip(Some(fill(&s.playing, &[("game", &name)])));
                if let Some(icon) = playing_icon(&app) {
                    let _ = state.tray.set_icon(Some(icon));
                }
            }
            None => {
                let _ = state.tray.set_tooltip(Some(s.idle));
                if let Some(icon) = app.default_window_icon().cloned() {
                    let _ = state.tray.set_icon(Some(icon));
                }
            }
        }
        #[cfg(target_os = "windows")]
        update_overlay(&app, &state);
        let _ = rebuild_menu(&app);
    });

    // `download-progress` fires ~1/s with the full download list. We
    // always refresh the snapshot + Windows taskbar/overlay, but only
    // rebuild the menu when the throttle window has passed AND the
    // signature changed — the menu content is derived from the
    // snapshot, so a rebuild on every tick would be pure churn.
    let app_handle_downloads = handle.clone();
    handle.listen("download-progress", move |event| {
        let app = app_handle_downloads.clone();
        let Ok(snapshot) = serde_json::from_str::<Vec<Value>>(event.payload()) else {
            return;
        };
        let state = app.state::<TrayHandles>();

        let signature = dl_signature(&snapshot);
        let mut rebuild = false;
        {
            let mut last = state.last_rebuild.lock().unwrap();
            let mut stored = state.dl_signature.lock().unwrap();
            if last.elapsed() > Duration::from_secs(2) && *stored != signature {
                *stored = signature;
                *last = Instant::now();
                rebuild = true;
            }
        }
        *state.downloads.lock().unwrap() = snapshot;

        #[cfg(target_os = "windows")]
        update_taskbar_progress(&app, &state);
        #[cfg(target_os = "windows")]
        update_overlay(&app, &state);

        if rebuild {
            let _ = rebuild_menu(&app);
        }
    });

    // The frontend emits the full string set whenever the UI language
    // changes. Until the first emission the English `Default` above is
    // in effect, so a rebuild here is only needed once strings arrive.
    let app_handle_strings = handle.clone();
    handle.listen("tray-strings", move |event| {
        let app = app_handle_strings.clone();
        let Ok(strings) = serde_json::from_str::<TrayStrings>(event.payload()) else {
            return;
        };
        let state = app.state::<TrayHandles>();
        *state.strings.lock().unwrap() = strings;
        let _ = rebuild_menu(&app);
    });

    Ok(())
}

/// Rebuild the full menu from the current state: playing name,
/// downloads snapshot, recent sessions joined against the games
/// table, and window visibility. Installs the result on the tray.
fn rebuild_menu(app: &AppHandle) -> tauri::Result<()> {
    let state = app.state::<TrayHandles>();
    let playing = state.playing.lock().unwrap().clone();
    let downloads = state.downloads.lock().unwrap().clone();
    let s = state.strings.lock().unwrap().clone();
    let visible = app
        .get_webview_window("main")
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false);

    let status_text = match &playing {
        Some(name) => fill(&s.playing, &[("game", name)]),
        None => s.idle.clone(),
    };
    let status = MenuItem::with_id(app, "status", status_text, false, None::<&str>)?;
    let show = MenuItem::with_id(app, "show", &s.show, true, None::<&str>)?;
    // Hide is pointless when the window is already hidden.
    let hide = MenuItem::with_id(app, "hide", &s.hide, !visible, None::<&str>)?;
    let recent = build_recent_submenu(app)?;
    let downloads_sub = build_downloads_submenu(app, &downloads)?;

    let nav_items: Vec<MenuItem<Wry>> = ["/library", "/store", "/activity", "/friends", "/mods", "/settings"]
        .iter()
        .map(|path| {
            let label = match *path {
                "/library" => &s.library,
                "/store" => &s.store,
                "/activity" => &s.activity,
                "/friends" => &s.friends,
                "/mods" => &s.mods,
                "/settings" => &s.settings,
                other => other,
            };
            MenuItem::with_id(app, format!("nav:{path}"), label, true, None::<&str>)
        })
        .collect::<tauri::Result<_>>()?;
    let quit = MenuItem::with_id(app, "quit", &s.quit, true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let sep3 = PredefinedMenuItem::separator(app)?;
    let sep4 = PredefinedMenuItem::separator(app)?;

    let mut items: Vec<&dyn IsMenuItem<Wry>> = Vec::new();
    items.push(&status);
    items.push(&sep1);
    items.push(&show);
    items.push(&hide);
    items.push(&sep2);
    items.push(&recent);
    items.push(&downloads_sub);
    items.push(&sep3);
    for item in &nav_items {
        items.push(item);
    }
    items.push(&sep4);
    items.push(&quit);

    let menu = Menu::with_items(app, &items)?;
    state.tray.set_menu(Some(menu))?;
    Ok(())
}

/// "Recent Games" submenu: up to 8 distinct games from the sessions
/// table (newest first), joined against the games table so each entry
/// carries the full launch data. Sessions whose game was deleted are
/// skipped.
fn build_recent_submenu(app: &AppHandle) -> tauri::Result<Submenu<Wry>> {
    let db = app.state::<db::Db>();
    let games = db::games::list_all(&db).unwrap_or_default();
    let by_id: std::collections::HashMap<&str, &GameRow> =
        games.iter().map(|g| (g.id.as_str(), g)).collect();
    let sessions = db::sessions::list_recent(&db, 8).unwrap_or_default();
    let s = app.state::<TrayHandles>().strings.lock().unwrap().clone();

    let mut rows: Vec<MenuItem<Wry>> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for session in sessions {
        if rows.len() >= 8 {
            break;
        }
        if !seen.insert(session.game_id.clone()) {
            continue;
        }
        let Some(row) = by_id.get(session.game_id.as_str()) else {
            continue;
        };
        rows.push(MenuItem::with_id(
            app,
            format!("recent:{}", row.id),
            &row.name,
            true,
            None::<&str>,
        )?);
    }
    if rows.is_empty() {
        rows.push(MenuItem::with_id(
            app,
            "recent-none",
            &s.no_recent,
            false,
            None::<&str>,
        )?);
    }
    let refs: Vec<&dyn IsMenuItem<Wry>> = rows.iter().map(|r| r as &dyn IsMenuItem<Wry>).collect();
    Submenu::with_items(app, &s.recent, true, &refs)
}

/// "Downloads" submenu: a status header, one disabled row per
/// in-flight download, and an "Open Downloads" shortcut.
fn build_downloads_submenu(app: &AppHandle, downloads: &[Value]) -> tauri::Result<Submenu<Wry>> {
    let active: Vec<&Value> = downloads.iter().filter(|d| !is_finished(d)).collect();
    let s = app.state::<TrayHandles>().strings.lock().unwrap().clone();

    let mut rows: Vec<MenuItem<Wry>> = Vec::new();
    let header = if active.is_empty() {
        s.no_downloads.clone()
    } else {
        fill(&s.downloads_active, &[("count", &active.len().to_string())])
    };
    rows.push(MenuItem::with_id(app, "dl-header", header, false, None::<&str>)?);

    for d in active {
        let name = d.get("name").and_then(|v| v.as_str()).unwrap_or("Download");
        let id = d.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let text = match (
            d.get("progress").and_then(|v| v.as_f64()),
            d.get("totalSize").and_then(|v| v.as_u64()),
        ) {
            (Some(p), Some(t)) if t > 0 => {
                let downloaded = d.get("downloaded").and_then(|v| v.as_u64()).unwrap_or(0);
                fill(
                    &s.download_row,
                    &[
                        ("name", name),
                        ("pct", &((p * 100.0).round() as u64).to_string()),
                        ("downloaded", &human_size(downloaded)),
                        ("total", &human_size(t)),
                    ],
                )
            }
            _ => fill(&s.download_starting, &[("name", name)]),
        };
        rows.push(MenuItem::with_id(app, format!("dl-row:{id}"), text, false, None::<&str>)?);
    }

    let sep = PredefinedMenuItem::separator(app)?;
    let open = MenuItem::with_id(app, "open-downloads", &s.open_downloads, true, None::<&str>)?;
    let mut refs: Vec<&dyn IsMenuItem<Wry>> = rows.iter().map(|r| r as &dyn IsMenuItem<Wry>).collect();
    refs.push(&sep);
    refs.push(&open);

    Submenu::with_items(app, &s.downloads, true, &refs)
}

/// Single menu-event handler for every menu the tray ever shows.
/// Menu ids encode their action: `recent:<gameId>` launches a game,
/// `nav:<path>` navigates the frontend, the rest are fixed actions.
fn handle_menu_event(app: &AppHandle, event: MenuEvent) {
    let id = event.id().as_ref();
    match id {
        "show" => show_window(app),
        "hide" => {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.hide();
            }
        }
        "quit" => app.exit(0),
        "open-downloads" => {
            show_window(app);
            navigate(app, "/downloads");
        }
        id if id.starts_with("nav:") => {
            show_window(app);
            navigate(app, &id[4..]);
        }
        id if id.starts_with("recent:") => launch_recent(app, &id[7..]),
        _ => {}
    }
}

/// Show, unminimize, and focus the main window.
fn show_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

/// Tell the frontend to switch pages (the frontend listens for the
/// `navigate` event; handled in a separate lane).
fn navigate(app: &AppHandle, path: &str) {
    let _ = app.emit("navigate", serde_json::json!({ "path": path }));
}

/// Launch a game from the Recent Games submenu using the full launch
/// data stored on its `GameRow`.
fn launch_recent(app: &AppHandle, game_id: &str) {
    let db = app.state::<db::Db>();
    let Ok(games) = db::games::list_all(&db) else {
        return;
    };
    let Some(row) = games.into_iter().find(|g| g.id == game_id) else {
        return;
    };
    let companion_apps = row.companion_apps.as_ref().map(|apps| {
        apps.iter()
            .filter_map(|v| serde_json::from_value::<crate::CompanionApp>(v.clone()).ok())
            .collect()
    });
    if let Err(e) = crate::launch_game(
        app.clone(),
        row.id,
        row.name,
        row.path,
        row.platform,
        row.steam_app_id,
        None,
        None,
        row.launch_arguments,
        row.run_as_admin,
        row.pre_launch_script,
        row.pre_launch_admin,
        row.post_exit_script,
        row.post_exit_admin,
        companion_apps,
        row.show_steam_launch_selection,
    ) {
        eprintln!("[gameindex] tray recent-game launch failed: {e}");
    }
}

/// Tray icon with a green dot painted in the bottom-right corner,
/// signalling an active game session.
fn playing_icon(app: &AppHandle) -> Option<Image<'static>> {
    let base = app.default_window_icon()?.clone();
    let (w, h) = (base.width(), base.height());
    let mut rgba = base.rgba().to_vec();
    let fw = w as f32;
    let fh = h as f32;
    let r = (fw * 0.12).max(2.5);
    paint_badge(
        &mut rgba,
        w,
        h,
        fw - r - (fw * 0.04).max(1.0),
        fh - r - (fh * 0.04).max(1.0),
        r,
        (r * 0.25).max(0.75),
        [74, 222, 128],
        [22, 163, 74],
    );
    Some(Image::new_owned(rgba, w, h))
}

/// Draw an anti-aliased status badge with a dark contrast border and
/// vertical gradient shine onto an RGBA buffer.
fn paint_badge(
    rgba: &mut [u8],
    w: u32,
    h: u32,
    cx: f32,
    cy: f32,
    r_outer: f32,
    border_width: f32,
    top_color: [u8; 3],
    bottom_color: [u8; 3],
) {
    let r_inner = (r_outer - border_width).max(0.5);
    let border_color: [u8; 3] = [11, 18, 30];

    let min_x = ((cx - r_outer - 1.5).floor() as i64).max(0) as u32;
    let max_x = (((cx + r_outer + 1.5).ceil() as i64).max(0) as u32).min(w);
    let min_y = ((cy - r_outer - 1.5).floor() as i64).max(0) as u32;
    let max_y = (((cy + r_outer + 1.5).ceil() as i64).max(0) as u32).min(h);

    for y in min_y..max_y {
        for x in min_x..max_x {
            let px = x as f32 + 0.5;
            let py = y as f32 + 0.5;
            let dx = px - cx;
            let dy = py - cy;
            let dist = (dx * dx + dy * dy).sqrt();

            if dist >= r_outer + 0.75 {
                continue;
            }

            let outer_alpha = ((r_outer + 0.5 - dist) / 1.0).clamp(0.0, 1.0);
            if outer_alpha <= 0.0 {
                continue;
            }

            let inner_t = ((r_inner + 0.5 - dist) / 1.0).clamp(0.0, 1.0);
            let grad_y = ((py - (cy - r_inner)) / (2.0 * r_inner)).clamp(0.0, 1.0);

            let hx = px - (cx - r_inner * 0.3);
            let hy = py - (cy - r_inner * 0.3);
            let h_dist = (hx * hx + hy * hy).sqrt();
            let shine = ((r_inner * 0.6 - h_dist) / (r_inner * 0.6)).clamp(0.0, 1.0) * 0.35;

            let fill_r = (top_color[0] as f32 + grad_y * (bottom_color[0] as f32 - top_color[0] as f32) + shine * 255.0).clamp(0.0, 255.0);
            let fill_g = (top_color[1] as f32 + grad_y * (bottom_color[1] as f32 - top_color[1] as f32) + shine * 255.0).clamp(0.0, 255.0);
            let fill_b = (top_color[2] as f32 + grad_y * (bottom_color[2] as f32 - top_color[2] as f32) + shine * 255.0).clamp(0.0, 255.0);

            let r = inner_t * fill_r + (1.0 - inner_t) * (border_color[0] as f32);
            let g = inner_t * fill_g + (1.0 - inner_t) * (border_color[1] as f32);
            let b = inner_t * fill_b + (1.0 - inner_t) * (border_color[2] as f32);

            let idx = ((y * w + x) * 4) as usize;
            let src_a = outer_alpha;
            let dst_a = (rgba[idx + 3] as f32) / 255.0;

            let out_a = src_a + dst_a * (1.0 - src_a);
            if out_a > 0.0 {
                let dst_r = rgba[idx] as f32;
                let dst_g = rgba[idx + 1] as f32;
                let dst_b = rgba[idx + 2] as f32;

                let out_r = (r * src_a + dst_r * dst_a * (1.0 - src_a)) / out_a;
                let out_g = (g * src_a + dst_g * dst_a * (1.0 - src_a)) / out_a;
                let out_b = (b * src_a + dst_b * dst_a * (1.0 - src_a)) / out_a;

                rgba[idx] = out_r.round() as u8;
                rgba[idx + 1] = out_g.round() as u8;
                rgba[idx + 2] = out_b.round() as u8;
                rgba[idx + 3] = (out_a * 255.0).round() as u8;
            }
        }
    }
}

/// True when the download is still in flight (not completed/errored).
fn is_finished(d: &Value) -> bool {
    let kind = d
        .get("status")
        .and_then(|s| s.get("kind"))
        .and_then(|k| k.as_str())
        .unwrap_or("");
    kind == "completed" || kind == "error"
}

/// Throttle signature: download count + per-download status kind and
/// rounded progress, order-independent.
fn dl_signature(downloads: &[Value]) -> String {
    let mut parts: Vec<String> = downloads
        .iter()
        .map(|d| {
            let kind = d
                .get("status")
                .and_then(|s| s.get("kind"))
                .and_then(|k| k.as_str())
                .unwrap_or("");
            let pct = d
                .get("progress")
                .and_then(|v| v.as_f64())
                .map(|p| (p * 100.0).round() as u64)
                .unwrap_or(u64::MAX);
            format!("{kind}:{pct}")
        })
        .collect();
    parts.sort();
    format!("{}|{}", parts.len(), parts.join(","))
}

/// Human-readable byte count: B / KB / MB / GB.
fn human_size(bytes: u64) -> String {
    const UNITS: [&str; 4] = ["B", "KB", "MB", "GB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{bytes} B")
    } else {
        format!("{value:.1} {}", UNITS[unit])
    }
}

/// True when any download is in flight (drives the overlay badge).
#[cfg(target_os = "windows")]
fn has_active_downloads(state: &TrayHandles) -> bool {
    state
        .downloads
        .lock()
        .unwrap()
        .iter()
        .any(|d| !is_finished(d))
}

/// Taskbar progress bar: aggregate the active downloads' bytes into a
/// single 0-100 percentage; Paused when only paused downloads remain;
/// cleared when nothing is in flight.
#[cfg(target_os = "windows")]
fn update_taskbar_progress(app: &AppHandle, state: &TrayHandles) {
    let downloads = state.downloads.lock().unwrap();
    let mut sum_downloaded = 0u64;
    let mut sum_total = 0u64;
    let mut any_active = false;
    let mut any_paused = false;
    for d in downloads.iter() {
        let kind = d
            .get("status")
            .and_then(|s| s.get("kind"))
            .and_then(|k| k.as_str())
            .unwrap_or("");
        match kind {
            "downloading" | "fetchingMetadata" | "queued" => {
                if d.get("progress").and_then(|v| v.as_f64()).is_some() {
                    if let (Some(dl), Some(total)) = (
                        d.get("downloaded").and_then(|v| v.as_u64()),
                        d.get("totalSize").and_then(|v| v.as_u64()),
                    ) {
                        if total > 0 {
                            any_active = true;
                            sum_downloaded += dl;
                            sum_total += total;
                        }
                    }
                }
            }
            "paused" => any_paused = true,
            _ => {}
        }
    }
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    if any_active && sum_total > 0 {
        let pct = ((sum_downloaded as f64 / sum_total as f64) * 100.0).round() as u64;
        let _ = win.set_progress_bar(ProgressBarState {
            status: Some(ProgressBarStatus::Normal),
            progress: Some(pct),
        });
    } else if any_paused {
        let _ = win.set_progress_bar(ProgressBarState {
            status: Some(ProgressBarStatus::Paused),
            progress: None,
        });
    } else {
        let _ = win.set_progress_bar(ProgressBarState {
            status: None,
            progress: None,
        });
    }
}

/// Taskbar overlay badge: green while a game runs, blue while
/// downloads are in flight, none otherwise.
#[cfg(target_os = "windows")]
fn update_overlay(app: &AppHandle, state: &TrayHandles) {
    let playing = state.playing.lock().unwrap().is_some();
    let active = has_active_downloads(state);
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    let icon = if playing {
        Some(badge_image([74, 222, 128], [22, 163, 74]))
    } else if active {
        Some(badge_image([56, 189, 248], [37, 99, 235]))
    } else {
        None
    };
    let _ = win.set_overlay_icon(icon);
}

/// Compact, anti-aliased RGBA badge image for the taskbar overlay badge.
#[cfg(target_os = "windows")]
fn badge_image(top_color: [u8; 3], bottom_color: [u8; 3]) -> Image<'static> {
    const SIZE: u32 = 16;
    let mut rgba = vec![0u8; (SIZE * SIZE * 4) as usize];
    paint_badge(
        &mut rgba,
        SIZE,
        SIZE,
        (SIZE as f32) / 2.0,
        (SIZE as f32) / 2.0,
        3.75,
        0.85,
        top_color,
        bottom_color,
    );
    Image::new_owned(rgba, SIZE, SIZE)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_paint_badge_renders_smoothly_within_bounds() {
        let size = 16u32;
        let mut rgba = vec![0u8; (size * size * 4) as usize];
        paint_badge(
            &mut rgba,
            size,
            size,
            8.0,
            8.0,
            3.75,
            0.85,
            [74, 222, 128],
            [22, 163, 74],
        );

        // Corner pixels must be transparent (dot is compact, leaving padding)
        let corners = [(0, 0), (15, 0), (0, 15), (15, 15), (1, 1), (14, 14)];
        for (x, y) in corners {
            let idx = ((y * size + x) * 4) as usize;
            assert_eq!(rgba[idx + 3], 0, "corner pixel at ({x},{y}) should be transparent");
        }

        // Center pixel must be fully opaque with green tint
        let center_idx = ((8 * size + 8) * 4) as usize;
        assert!(rgba[center_idx + 3] > 200, "center pixel should be opaque");
        assert!(rgba[center_idx + 1] > rgba[center_idx], "green channel should dominate");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn test_badge_image_dimensions() {
        let img = badge_image([74, 222, 128], [22, 163, 74]);
        assert_eq!(img.width(), 16);
        assert_eq!(img.height(), 16);
        assert_eq!(img.rgba().len(), 16 * 16 * 4);
    }
}