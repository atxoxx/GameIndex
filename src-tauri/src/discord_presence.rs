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

use discord_rich_presence::activity::{
    Activity, ActivityType, Assets, Button, Party, StatusDisplayType, Timestamps,
};
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
    /// `"playing"`, `"browsing"`, `"downloading"` or `"stopped"`; the
    /// listener in `lib.rs` treats `"stopped"` as the clear sentinel and
    /// every other value as an activity payload.
    pub state: String,
    #[serde(default)]
    /// Sent by the frontend as part of the IPC payload contract; not
    /// consumed by the backend yet.
    #[allow(dead_code)]
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
    /// Second button (Discord renders at most two). Frontend uses it for a
    /// platform store link alongside the primary website button.
    #[serde(default)]
    pub button2_label: Option<String>,
    #[serde(default)]
    pub button2_url: Option<String>,
    /// `"playing"` (default) | `"listening"` | `"watching"` | `"competing"`.
    #[serde(default)]
    pub activity_type: Option<String>,
    /// `"name"` | `"state"` | `"details"` — which line Discord shows under
    /// the user's name in the member list. Defaults to `"details"` so
    /// friends see the game/page name instead of the app name.
    #[serde(default)]
    pub status_display: Option<String>,
    /// Makes the `details` line a clickable link when set.
    #[serde(default)]
    pub details_url: Option<String>,
    /// Makes the `state` line a clickable link when set.
    #[serde(default)]
    pub state_url: Option<String>,
    /// Party id + size drive Discord's "(2 of 4)" line. Used for download
    /// queue position. Ignored unless `party_max > 0`.
    #[serde(default)]
    pub party_id: Option<String>,
    #[serde(default)]
    pub party_current: Option<i32>,
    #[serde(default)]
    pub party_max: Option<i32>,
    /// Unix timestamp in milliseconds for a "remaining" countdown. When set
    /// alongside `started_at` Discord shows a progress bar (Listening /
    /// Watching); otherwise it renders "in X".
    #[serde(default)]
    pub ends_at: u64,
}

/// Map the frontend's activity-type string onto the crate enum. Unknown or
/// missing values fall back to `Playing`, the only type a launcher should
/// use by default.
fn activity_type(value: Option<&str>) -> ActivityType {
    match value {
        Some("listening") => ActivityType::Listening,
        Some("watching") => ActivityType::Watching,
        Some("competing") => ActivityType::Competing,
        _ => ActivityType::Playing,
    }
}

/// Map the frontend's member-list preference onto the crate enum. Missing or
/// unknown values default to `Details` (the most informative line).
fn status_display_type(value: Option<&str>) -> StatusDisplayType {
    match value {
        Some("name") => StatusDisplayType::Name,
        Some("state") => StatusDisplayType::State,
        _ => StatusDisplayType::Details,
    }
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
/// line. Timestamps are attached when `started_at` and/or `ends_at` are set
/// (Discord wants unix seconds, the payload carries milliseconds). Assets are
/// only attached when at least one of `large_image` / `small_image` is
/// present. Up to two buttons are attached (primary + secondary), and a party
/// is attached only when `party_id` and a positive `party_max` are present.
fn build_activity(data: &PresenceData) -> Activity<'static> {
    let details = data
        .details
        .clone()
        .unwrap_or_else(|| data.game_name.clone().unwrap_or_default());
    // Only attach a state line when there is one. Browsing has no meaningful
    // second line, and an empty `state` would otherwise render as a duplicate
    // of Discord's own app-name header.
    let state = data
        .state_text
        .clone()
        .filter(|line| !line.trim().is_empty());

    let mut activity = Activity::new()
        .details(details)
        .activity_type(activity_type(data.activity_type.as_deref()))
        .status_display_type(status_display_type(data.status_display.as_deref()));

    if let Some(state) = state {
        activity = activity.state(state);
    }

    if let Some(url) = data.details_url.clone() {
        activity = activity.details_url(url);
    }
    if let Some(url) = data.state_url.clone() {
        activity = activity.state_url(url);
    }

    if data.started_at > 0 || data.ends_at > 0 {
        let mut timestamps = Timestamps::new();
        if data.started_at > 0 {
            timestamps = timestamps.start((data.started_at / 1000) as i64);
        }
        if data.ends_at > 0 {
            timestamps = timestamps.end((data.ends_at / 1000) as i64);
        }
        activity = activity.timestamps(timestamps);
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

    let mut buttons: Vec<Button> = Vec::new();
    if let (Some(label), Some(url)) = (data.button_label.clone(), data.button_url.clone()) {
        buttons.push(Button::new(label, url));
    }
    if let (Some(label), Some(url)) = (data.button2_label.clone(), data.button2_url.clone()) {
        buttons.push(Button::new(label, url));
    }
    if !buttons.is_empty() {
        activity = activity.buttons(buttons);
    }

    if let (Some(id), Some(max)) = (data.party_id.clone(), data.party_max) {
        if max > 0 {
            let current = data.party_current.unwrap_or(1).clamp(0, max);
            activity = activity.party(Party::new().id(id).size([current, max]));
        }
    }

    activity
}

/// Spawn the presence thread and connect to Discord.
///
/// Returns `None` (and does nothing) when `client_id` is empty, so callers
/// can unconditionally call this and just check the returned handle.
///
/// The thread owns the IPC connection and reports connection state to the
/// frontend via `discord-presence-status` events.
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
        let _ = app.emit(
            "discord-presence-status",
            serde_json::json!({ "connected": connected }),
        );

        loop {
            match rx.recv() {
                Ok(PresenceCommand::SetPlaying(data)) => {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> PresenceData {
        PresenceData {
            state: "playing".into(),
            game_id: None,
            game_name: Some("Hollow Knight".into()),
            started_at: 0,
            details: None,
            state_text: None,
            large_image: None,
            large_text: None,
            small_image: None,
            small_text: None,
            button_label: None,
            button_url: None,
            button2_label: None,
            button2_url: None,
            activity_type: None,
            status_display: None,
            details_url: None,
            state_url: None,
            party_id: None,
            party_current: None,
            party_max: None,
            ends_at: 0,
        }
    }

    #[test]
    fn deserializes_full_camel_case_payload() {
        let data: PresenceData = serde_json::from_str(
            r#"{
                "state": "downloading",
                "gameId": "abc",
                "gameName": "Hollow Knight",
                "startedAt": 1700000000000,
                "stateText": "Downloading",
                "largeImage": "https://cdn.example/cover.jpg",
                "button2Label": "View in Store",
                "button2Url": "https://store.steampowered.com/app/367520",
                "activityType": "watching",
                "statusDisplay": "state",
                "detailsUrl": "https://example.com/game",
                "partyId": "queue",
                "partyCurrent": 2,
                "partyMax": 5,
                "endsAt": 1700000300000
            }"#,
        )
        .expect("full payload should deserialize");

        assert_eq!(data.state, "downloading");
        assert_eq!(data.game_id.as_deref(), Some("abc"));
        assert_eq!(data.party_current, Some(2));
        assert_eq!(data.party_max, Some(5));
        assert_eq!(data.button2_label.as_deref(), Some("View in Store"));
        assert_eq!(data.status_display.as_deref(), Some("state"));
        assert_eq!(data.ends_at, 1700000300000);
    }

    #[test]
    fn deserializes_minimal_payload_with_defaults() {
        // Old / minimal payloads must keep working: every new field defaults.
        let data: PresenceData =
            serde_json::from_str(r#"{"state":"stopped"}"#).expect("minimal payload");

        assert_eq!(data.state, "stopped");
        assert_eq!(data.started_at, 0);
        assert_eq!(data.ends_at, 0);
        assert!(data.party_max.is_none());
        assert!(data.activity_type.is_none());
        assert!(data.button2_url.is_none());
    }

    #[test]
    fn rejects_payload_without_state() {
        // `state` is the one required field; a payload missing it is an error.
        assert!(serde_json::from_str::<PresenceData>(r#"{"gameName":"x"}"#).is_err());
    }

    #[test]
    fn activity_type_defaults_to_playing_for_unknown_values() {
        assert!(matches!(activity_type(None), ActivityType::Playing));
        assert!(matches!(activity_type(Some("nonsense")), ActivityType::Playing));
        assert!(matches!(
            activity_type(Some("listening")),
            ActivityType::Listening
        ));
        assert!(matches!(
            activity_type(Some("watching")),
            ActivityType::Watching
        ));
        assert!(matches!(
            activity_type(Some("competing")),
            ActivityType::Competing
        ));
    }

    #[test]
    fn status_display_defaults_to_details() {
        assert!(matches!(
            status_display_type(None),
            StatusDisplayType::Details
        ));
        assert!(matches!(
            status_display_type(Some("unknown")),
            StatusDisplayType::Details
        ));
        assert!(matches!(
            status_display_type(Some("name")),
            StatusDisplayType::Name
        ));
        assert!(matches!(
            status_display_type(Some("state")),
            StatusDisplayType::State
        ));
    }

    #[test]
    fn minimal_activity_omits_optional_objects() {
        let value = serde_json::to_value(build_activity(&base())).unwrap();

        assert_eq!(value["details"], "Hollow Knight");
        assert_eq!(value["type"], 0);
        assert_eq!(value["status_display_type"], 2);
        assert!(value.get("state").is_none());
        assert!(value.get("party").is_none());
        assert!(value.get("buttons").is_none());
        assert!(value.get("timestamps").is_none());
        assert!(value.get("assets").is_none());
    }

    #[test]
    fn rich_activity_maps_buttons_party_and_countdown() {
        let mut data = base();
        data.state_text = Some("Downloading".into());
        data.started_at = 1_700_000_000_000;
        data.ends_at = 1_700_000_300_000;
        data.button_label = Some("View Website".into());
        data.button_url = Some("https://example.com".into());
        data.button2_label = Some("View in Store".into());
        data.button2_url = Some("https://store.steampowered.com/app/1".into());
        data.details_url = Some("https://example.com/game".into());
        data.party_id = Some("queue".into());
        data.party_current = Some(2);
        data.party_max = Some(5);

        let value = serde_json::to_value(build_activity(&data)).unwrap();

        assert_eq!(value["buttons"].as_array().unwrap().len(), 2);
        assert_eq!(value["party"]["id"], "queue");
        assert_eq!(value["party"]["size"], serde_json::json!([2, 5]));
        // Seconds, matching Discord's RPC protocol (see module docs).
        assert_eq!(value["timestamps"]["start"], 1_700_000_000_i64);
        assert_eq!(value["timestamps"]["end"], 1_700_000_300_i64);
        assert_eq!(value["details_url"], "https://example.com/game");
    }

    #[test]
    fn party_is_skipped_when_max_is_not_positive() {
        let mut data = base();
        data.party_id = Some("queue".into());
        data.party_current = Some(1);
        data.party_max = Some(0);

        let value = serde_json::to_value(build_activity(&data)).unwrap();
        assert!(value.get("party").is_none());
    }

    #[test]
    fn second_button_requires_both_label_and_url() {
        let mut data = base();
        data.button2_label = Some("dangling".into());
        // No URL -> the button must be dropped, not sent half-formed.
        let value = serde_json::to_value(build_activity(&data)).unwrap();
        assert!(value.get("buttons").is_none());
    }
}