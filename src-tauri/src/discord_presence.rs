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
//! The Discord application (client) ID is read from
//! [`config::get_discord_client_id`] — i.e. the `DISCORD_CLIENT_ID` env var
//! (loaded from `.env` in dev, or baked in at build time). It is never
//! hardcoded here.

use discord_rich_presence::activity::{Activity, Timestamps};
use discord_rich_presence::{DiscordIpc, DiscordIpcClient};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::Mutex;

use crate::config;

/// Commands forwarded to the presence thread.
pub enum PresenceCommand {
    /// Show "Playing <game_name>" with an elapsed-time timestamp.
    SetPlaying { game_name: String, started_at_ms: u64 },
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
    pub fn ensure_started(&self) {
        let already = self.tx.lock().unwrap().is_some();
        if !already {
            if let Some(tx) = start(config::get_discord_client_id()) {
                self.set_sender(tx);
            }
        }
    }

    /// Push a "now playing" update to the thread (no-op when disabled).
    pub fn set_playing(&self, game_name: &str, started_at_ms: u64) {
        if !self.enabled.load(Ordering::SeqCst) {
            return;
        }
        if let Some(tx) = self.tx.lock().unwrap().as_ref() {
            let _ = tx.send(PresenceCommand::SetPlaying {
                game_name: game_name.to_string(),
                started_at_ms,
            });
        }
    }

    /// Push a "stopped" update to the thread (always sent, so an active
    /// presence is cleared even if the toggle is flipped off afterwards).
    pub fn clear(&self) {
        if let Some(tx) = self.tx.lock().unwrap().as_ref() {
            let _ = tx.send(PresenceCommand::Clear);
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

/// Spawn the presence thread and connect to Discord.
///
/// Returns `None` (and does nothing) when `client_id` is empty, so callers
/// can unconditionally call this and just check the returned handle.
pub fn start(client_id: String) -> Option<Sender<PresenceCommand>> {
    if client_id.is_empty() {
        return None;
    }
    let (tx, rx) = mpsc::channel::<PresenceCommand>();
    std::thread::spawn(move || {
        let mut client = SendClient(DiscordIpcClient::new(&client_id));
        let mut connected = client.0.connect().is_ok();
        if !connected {
            eprintln!("[discord] not connected (is the Discord desktop app running?)");
        }
        loop {
            match rx.recv() {
                Ok(PresenceCommand::SetPlaying { game_name, started_at_ms }) => {
                    if !connected {
                        connected = client.0.connect().is_ok();
                    }
                    if connected {
                        let activity = Activity::new()
                            .details(game_name)
                            .state("Playing via GameIndex")
                            .timestamps(Timestamps::new().start(started_at_ms as i64));
                        if client.0.set_activity(activity).is_err() {
                            // Connection dropped (Discord restarted, etc.) —
                            // reconnect on the next update rather than dying.
                            connected = false;
                        }
                    }
                }
                Ok(PresenceCommand::Clear) => {
                    if connected {
                        let _ = client.0.clear_activity();
                    }
                }
                Ok(PresenceCommand::Shutdown) | Err(_) => {
                    let _ = client.0.close();
                    break;
                }
            }
        }
    });
    Some(tx)
}
