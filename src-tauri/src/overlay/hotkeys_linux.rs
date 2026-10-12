//! Wayland global shortcuts for the in-game overlay.
//!
//! The overlay's hotkeys are normally registered through
//! `tauri-plugin-global-shortcut`, which has no Wayland equivalent: Wayland
//! compositors do not expose global key grabs to clients. The sanctioned route
//! is the XDG Desktop Portal `GlobalShortcuts` interface, where the user
//! explicitly binds a shortcut through a compositor dialog and the portal
//! pushes activation events back to us.
//!
//! This module owns that portal session on its own thread (the portal client is
//! async; the caller is sync), forwards activations to
//! [`crate::overlay::dispatch_portal_binding`], and exposes a non-blocking
//! `stop` so the session can be torn down when the overlay is disabled.
//! X11 keeps using the existing plugin path; [`is_supported`] reports whether
//! this portal path applies.

use std::str::FromStr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

use ashpd::desktop::global_shortcuts::{GlobalShortcuts, NewShortcut};
use ashpd::zbus::Connection;
use ashpd::AppID;
use futures::StreamExt;
use tauri::AppHandle;

/// Poll interval for the activation stream, so the stop flag is observed even
/// when no shortcut fires.
const POLL_MS: u64 = 500;

/// How many times to retry the host app-id registration while the portal picks
/// up the freshly written desktop entry, and how long to wait between tries.
const PORTAL_REGISTER_ATTEMPTS: u32 = 5;
const PORTAL_REGISTER_RETRY: Duration = Duration::from_millis(250);

/// Whether the portal global-shortcuts backend applies to this session.
pub fn is_supported() -> bool {
    crate::linux_desktop::is_wayland()
}

/// A running portal shortcut listener.
pub struct PortalHotkeys {
    stop: Arc<AtomicBool>,
    // Held so the thread stays owned for the handle's lifetime; never joined
    // on `stop` to keep teardown non-blocking.
    _handle: JoinHandle<()>,
}

impl PortalHotkeys {
    /// Ask the listener thread to stop. Returns immediately; the thread exits on
    /// its next poll and the handle is detached when this struct drops.
    pub fn stop(&self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

/// Start listening for `bindings` (a list of `(id, accelerator)` where `id` is
/// one of `toggle` / `screenshot` / `record` / `replay`). Returns as soon as the
/// thread is spawned; portal setup failures are logged inside the thread and
/// leave the overlay usable without hotkeys.
pub fn start(app: AppHandle, bindings: Vec<(String, String)>) -> Result<PortalHotkeys, String> {
    let stop = Arc::new(AtomicBool::new(false));
    let thread_stop = Arc::clone(&stop);
    let handle = std::thread::Builder::new()
        .name("portal-hotkeys".into())
        .spawn(move || run(app, bindings, thread_stop))
        .map_err(|e| format!("failed to spawn portal-hotkeys thread: {e}"))?;

    Ok(PortalHotkeys {
        stop,
        _handle: handle,
    })
}

/// Thread body: build a private current-thread runtime and drive the portal
/// session on it. Any error is logged, never propagated (the caller has already
/// returned its handle).
fn run(app: AppHandle, bindings: Vec<(String, String)>, stop: Arc<AtomicBool>) {
    let runtime = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(e) => {
            eprintln!("[overlay] wayland global shortcuts unavailable: {e}");
            return;
        }
    };

    runtime.block_on(async move {
        if let Err(e) = listen(&app, &bindings, &stop).await {
            eprintln!("[overlay] wayland global shortcuts unavailable: {e}");
        }
    });
}

/// Bind the shortcuts and pump activation events until `stop` is set.
async fn listen(
    app: &AppHandle,
    bindings: &[(String, String)],
    stop: &AtomicBool,
) -> Result<(), String> {
    let shortcuts = build_shortcuts(bindings);
    if shortcuts.is_empty() {
        return Ok(());
    }

    // The portal refuses a global-shortcuts session from a process without an
    // app id, and keys the id by D-Bus sender/connection. Register ours on the
    // very connection the session will use, before any other portal call.
    let connection = Connection::session().await.map_err(|e| e.to_string())?;
    crate::linux_desktop::ensure_portal_desktop_entry();
    register_portal_app_id(&connection).await;

    let proxy = GlobalShortcuts::with_connection(connection)
        .await
        .map_err(|e| e.to_string())?;
    let session = proxy
        .create_session(Default::default())
        .await
        .map_err(|e| e.to_string())?;

    proxy
        .bind_shortcuts(&session, &shortcuts, None, Default::default())
        .await
        .map_err(|e| e.to_string())?
        .response()
        .map_err(|e| e.to_string())?;

    // Box the portal stream so it is `Unpin` — the opaque `impl Stream` return
    // type is not guaranteed to be, and `StreamExt::next` needs `Unpin`.
    let mut activated = Box::pin(proxy.receive_activated().await.map_err(|e| e.to_string())?);

    while !stop.load(Ordering::Relaxed) {
        match tokio::time::timeout(Duration::from_millis(POLL_MS), activated.next()).await {
            Ok(Some(event)) => crate::overlay::dispatch_portal_binding(app, event.shortcut_id()),
            // Timeout (keep polling) or the stream ended.
            _ => {}
        }
    }

    Ok(())
}

/// Register this process's app id with the portal on `connection`.
///
/// `xdg-desktop-portal` only accepts the registration once the matching desktop
/// entry is visible to it, and [`ensure_portal_desktop_entry`] may have just
/// written it, so retry briefly before giving up.
async fn register_portal_app_id(connection: &Connection) {
    let app_id = match AppID::from_str(crate::linux_desktop::PORTAL_APP_ID) {
        Ok(app_id) => app_id,
        Err(e) => {
            eprintln!("[overlay] invalid portal app id: {e}");
            return;
        }
    };

    for attempt in 1..=PORTAL_REGISTER_ATTEMPTS {
        match ashpd::register_host_app_with_connection(connection.clone(), app_id.clone()).await {
            Ok(()) => return,
            Err(e) if attempt == PORTAL_REGISTER_ATTEMPTS => {
                eprintln!("[overlay] portal app id registration failed: {e}");
            }
            Err(_) => tokio::time::sleep(PORTAL_REGISTER_RETRY).await,
        }
    }
}

/// Convert the overlay's `(id, accelerator)` pairs into portal shortcuts,
/// dropping any accelerator that can't be translated to a portal trigger.
fn build_shortcuts(bindings: &[(String, String)]) -> Vec<NewShortcut> {
    let mut shortcuts = Vec::with_capacity(bindings.len());
    for (id, accel) in bindings {
        match to_portal_trigger(accel) {
            Some(trigger) => shortcuts.push(
                NewShortcut::new(id.clone(), id.clone()).preferred_trigger(Some(trigger.as_str())),
            ),
            None => {
                eprintln!("[overlay] cannot map '{accel}' to a portal shortcut; skipping '{id}'")
            }
        }
    }
    shortcuts
}

/// Translate a Tauri-style accelerator into the XDG "shortcuts" trigger syntax:
/// every part but the last becomes a `<Modifier>`, the last is the key. Returns
/// `None` for an empty accelerator or an unrecognised modifier.
///
/// `"Ctrl+Shift+F1"` -> `"<Control><Shift>F1"`, `"F12"` -> `"F12"`.
fn to_portal_trigger(accel: &str) -> Option<String> {
    let parts: Vec<&str> = accel
        .split('+')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect();
    if parts.is_empty() {
        return None;
    }

    let (modifiers, key) = parts.split_at(parts.len() - 1);
    let mut trigger = String::new();
    for modifier in modifiers {
        trigger.push('<');
        trigger.push_str(normalize_modifier(modifier)?);
        trigger.push('>');
    }
    trigger.push_str(&normalize_key(key[0]));
    Some(trigger)
}

/// Map a Tauri modifier name to its portal spelling.
fn normalize_modifier(modifier: &str) -> Option<&'static str> {
    match modifier.to_ascii_lowercase().as_str() {
        "ctrl" | "control" | "cmdorctrl" | "commandorcontrol" => Some("Control"),
        "alt" | "option" => Some("Alt"),
        "shift" => Some("Shift"),
        "super" | "meta" | "cmd" | "command" | "win" => Some("Super"),
        _ => None,
    }
}

/// Portal triggers use XKB keysym names, where a plain letter is lower-case;
/// Tauri accelerators spell those letters upper-case (`Ctrl+S` -> `S`).
fn normalize_key(key: &str) -> String {
    let mut chars = key.chars();
    match (chars.next(), chars.next()) {
        (Some(c), None) if c.is_ascii_alphabetic() => c.to_ascii_lowercase().to_string(),
        _ => key.to_string(),
    }
}
