//! Discord Rich Presence integration for GameIndex.
//!
//! The IPC connection to the local Discord client is owned by a dedicated
//! background thread. We do that because the `discord-rich-presence` client
//! is `!Send` (its underlying trait object lacks a `Send` bound) — so we
//! move it into a thread behind a `Send` newtype (`SendClient`). The
//! concrete platform impls hold a `File` / `UnixStream`, both of which are
//! `Send`, so the assertion is sound.
//!
//! The rest of the app talks to that thread through an `mpsc::Sender` that
//! lives in [`DiscordPresenceState`] (managed state). The sender is
//! `Send + Sync`, so it is cheap to `manage()` and clone.
//!
//! The frontend drives presence by emitting `discord-presence-update`
//! events with a rich [`PresenceData`] payload (details / stateText /
//! assets / button) on `game-started` / `game-exited`. The listener in
//! `lib.rs` forwards those payloads here. The thread owns the IPC
//! connection: it caches the last payload so a successful reconnect can
//! re-push the activity, retries the initial connect with a bounded loop,
//! and reports connection state back to the frontend via
//! `discord-presence-status` events.
//!
//! The Discord application (client) ID is read from
//! [`config::get_discord_client_id`] — i.e. the `DISCORD_CLIENT_ID` env var
//! (loaded from `.env` in dev, or baked in at build time). It is never
//! hardcoded here.

use discord_rich_presence::activity::{Activity, Assets, Button, Timestamps};
use discord_rich_presence::{DiscordIpc, DiscordIpcClient};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::Mutex;
use std::time::Duration;

use crate::config;
use tauri::Emitter;

/// Rich presence payload emitted by the frontend on `discord-presence-update`.
///
/// `state` is `"playing"`, `"browsing"` or `"stopped"`; the listener in
/// `lib.rs` treats `"stopped"` as the clear sentinel and every other value
/// as an activity payload. Everything else is optional and defaults to
/// `None` / `0` so the frontend can send a minimal payload.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresenceData {
    /// `"playing"` | `"stopped"`.
    pub state: String,
    #[serde(default)]
    pub game_id: Option<String>,
    #[serde(default)]
    pub game_name: Option<String>,
    /// Unix timestamp in milliseconds.
    #[serde(default)]
    pub started_at: u64,
    #[serde(default)]
    pub details: Option<String>,
    #[serde(default)]
    pub state_text: Option<String>,
    #[serde(default)]
    pub large_image: Option<String>,
    #[serde(default)]
    pub large_text: Option<String>,
    #[serde(default)]
    pub small_image: Option<String>,
    #[serde(default)]
    pub small_text: Option<String>,
    #[serde(default)]
    pub button_label: Option<String>,
    #[serde(default)]
    pub button_url: Option<String>,
}

/// Commands forwarded to the presence thread.
pub enum PresenceCommand {
    /// Show a rich "now playing" activity built from the payload.
    SetPlaying(PresenceData),
    /// Clear the current activity (idle / no game running).
    Clear,
    /// Close the IPC connection and stop the thread.
    Shutdown,
}

/// Shared handle used by the rest of the app to drive the presence thread.
///
/// Safe to `manage()` because `Sender` and the atomics are `Send + Sync`.
pub struct DiscordPresenceState {
    tx: Mutex<Option<Sender<PresenceCommand>>>,
    enabled: AtomicBool,
}

impl DiscordPresenceState {
    /// Create the state with presence disabled and no connection.
    pub fn new() -> Self {
        Self {
            tx: Mutex::new(None),
            enabled: AtomicBool::new(false),
        }
    }

    /// Whether the user has opted into Rich Presence in Settings.
    #[allow(dead_code)]
    pub fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::SeqCst)
    }

    /// Enable/disable presence. When disabled, in-flight events are ignored.
    pub fn set_enabled(&self, enabled: bool) {
        self.enabled.store(enabled, Ordering::SeqCst);
    }

    /// Store the sender once the thread has been spawned.
    pub fn set_sender(&self, tx: Sender<PresenceCommand>) {
        *self.tx.lock().unwrap() = Some(tx);
    }

    /// Spawn the connection thread if it isn't already running.
    pub fn ensure_started(&self, app: &tauri::AppHandle) {
        let already = self.tx.lock().unwrap().is_some();
        if !already {
            if let Some(tx) = start(config::get_discord_client_id(), app.clone()) {
                self.set_sender(tx);
            }
        }
    }

    /// Push a "now playing" update to the thread (no-op when disabled).
    pub fn set_playing(&self, data: PresenceData) {
        if !self.enabled.load(Ordering::SeqCst) {
            return;
        }
        if let Some(tx) = self.tx.lock().unwrap().as_ref() {
            let _ = tx.send(PresenceCommand::SetPlaying(data));
        }
    }

    /// Push a "stopped" update to the thread (always sent, so an active
    /// presence is cleared even if the toggle is flipped off afterwards).
    pub fn clear(&self) {
        if let Some(tx) = self.tx.lock().unwrap().as_ref() {
            let _ = tx.send(PresenceCommand::Clear);
        }
    }

    /// Ask the thread to close the IPC pipe and exit. Used on app shutdown
    /// so the pipe is released before the process exits.
    pub fn shutdown(&self) {
        if let Some(tx) = self.tx.lock().unwrap().take() {
            let _ = tx.send(PresenceCommand::Shutdown);
        }
    }
}

impl Default for DiscordPresenceState {
    fn default() -> Self {
        Self::new()
    }
}

/// `DiscordIpcClient` is `!Send` only because the underlying trait object
/// lacks a `Send` bound; the concrete platform impls (`File` /
/// `UnixStream`) are `Send`. This newtype lets us move the client into a
/// background thread soundly.
struct SendClient(DiscordIpcClient);
unsafe impl Send for SendClient {}

/// Try to connect, retrying up to 3 more times with a 500 ms pause between
/// attempts. Returns `true` on the first successful connect.
fn connect_with_retry(client: &mut SendClient) -> bool {
    if client.0.connect().is_ok() {
        return true;
    }
    for _ in 0..3 {
        std::thread::sleep(Duration::from_millis(500));
        if client.0.connect().is_ok() {
            return true;
        }
    }
    false
}

/// Build a Discord `Activity` from a frontend payload.
///
/// `details` falls back to the game name; `state` is the free-form status
/// line. Timestamps are only attached when `started_at > 0` (Discord wants
/// unix seconds, the payload carries milliseconds). Assets are only
/// attached when at least one of `large_image` / `small_image` is present.
/// A button is attached only when both label and URL are present.
fn build_activity(data: &PresenceData) -> Activity<'static> {
    let details = data
        .details
        .clone()
        .unwrap_or_else(|| data.game_name.clone().unwrap_or_default());
    let state = data.state_text.clone().unwrap_or_default();

    let mut activity = Activity::new().details(details).state(state);

    if data.started_at > 0 {
        activity = activity.timestamps(Timestamps::new().start((data.started_at / 1000) as i64));
    }

    let mut assets = Assets::new();
    let mut has_asset = false;
    if let Some(image) = data.large_image.clone() {
        assets = assets.large_image(image);
        has_asset = true;
    }
    if let Some(text) = data.large_text.clone() {
        assets = assets.large_text(text);
    }
    if let Some(image) = data.small_image.clone() {
        assets = assets.small_image(image);
        has_asset = true;
    }
    if let Some(text) = data.small_text.clone() {
        assets = assets.small_text(text);
    }
    if has_asset {
        activity = activity.assets(assets);
    }

    if let (Some(label), Some(url)) = (data.button_label.clone(), data.button_url.clone()) {
        activity = activity.buttons(vec![Button::new(label, url)]);
    }

    activity
}

/// Spawn the presence thread and connect to Discord.
///
/// Returns `None` (and does nothing) when `client_id` is empty, so callers
/// can unconditionally call this and just check the returned handle.
///
/// The thread owns the IPC connection: it caches the last [`PresenceData`]
/// so a reconnect can re-push the activity, and it reports connection state
/// to the frontend via `discord-presence-status` events.
pub fn start(client_id: String, app: tauri::AppHandle) -> Option<Sender<PresenceCommand>> {
    if client_id.is_empty() {
        return None;
    }
    let (tx, rx) = mpsc::channel::<PresenceCommand>();
    std::thread::spawn(move || {
        let mut client = SendClient(DiscordIpcClient::new(&client_id));
        let mut connected = connect_with_retry(&mut client);
        if !connected {
            eprintln!("[discord] not connected (is the Discord desktop app running?)");
        }
        let mut cached: Option<PresenceData> = None;
        let _ = app.emit(
            "discord-presence-status",
            serde_json::json!({ "connected": connected }),
        );

        loop {
            match rx.recv() {
                Ok(PresenceCommand::SetPlaying(data)) => {
                    cached = Some(data.clone());
                    if !connected {
                        connected = connect_with_retry(&mut client);
                        let _ = app.emit(
                            "discord-presence-status",
                            serde_json::json!({ "connected": connected }),
                        );
                    }
                    if connected {
                        if client.0.set_activity(build_activity(&data)).is_err() {
                            // Connection dropped (Discord restarted, etc.) —
                            // reconnect on the next command rather than
                            // looping forever here.
                            connected = false;
                            let _ = app.emit(
                                "discord-presence-status",
                                serde_json::json!({ "connected": false }),
                            );
                        }
                    }
                }
                Ok(PresenceCommand::Clear) => {
                    cached = None;
                    if connected && client.0.clear_activity().is_err() {
                        connected = false;
                        let _ = app.emit(
                            "discord-presence-status",
                            serde_json::json!({ "connected": false }),
                        );
                    }
                }
                Ok(PresenceCommand::Shutdown) | Err(_) => {
                    let _ = client.0.close();
                    let _ = app.emit(
                        "discord-presence-status",
                        serde_json::json!({ "connected": false }),
                    );
                    break;
                }
            }
        }
    });
    Some(tx)
}