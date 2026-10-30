//! Store-side install progress.
//!
//! GameIndex never downloads a store game itself — the store client does,
//! and hands nothing back. What each store does leave behind is a file
//! describing what it is doing right now:
//!
//! - Steam rewrites `appmanifest_<appid>.acf` with live byte counters.
//! - Epic writes `*.item` manifests with an "incomplete install" flag,
//!   but no byte counter, so the disk it writes to is measured instead.
//! - On Linux, Heroic's log tail is the only trace Epic leaves.
//!
//! This module watches those files and turns them into one normalized
//! snapshot the UI can draw: percentage, speed and ETA, or a bare "working
//! on it" state when the store doesn't expose enough to say more.
//!
//! Cost control matters more than latency here. The loop runs slowly while
//! nothing is transferring, drops to a fast cadence only while something
//! is, and re-reads a manifest only when its file stamp changed or the app
//! is mid-transfer.

pub mod epic;
pub mod epic_linux;
pub mod speed;
pub mod steam;

use std::collections::{HashMap, HashSet};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::db::games::StoreInstallTarget;
use crate::db::Db;

use speed::TransferSpeed;

/// Cadence while a transfer is running: fast enough that the percentage
/// moves like a download, cheap because only changed manifests are read.
const FAST_POLL: Duration = Duration::from_secs(2);
/// Cadence with nothing in flight. Manifests are only stat'ed at this
/// rate, so an idle library costs a directory listing and no reads.
const SLOW_POLL: Duration = Duration::from_secs(45);
/// How often the library's store identifiers are re-read. Games get added
/// and uninstalled while the app runs, but not often enough to matter.
const TARGET_REFRESH: Duration = Duration::from_secs(60);
/// How long a queued-but-idle transfer may sit at "starting" before the
/// entry is dropped. Steam writes a manifest the moment a download is
/// queued, and Epic writes one for a job it has not begun, so without this
/// a dismissed store dialog would leave a permanent spinner behind.
const PENDING_GIVE_UP: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum InstallState {
    /// Bytes are moving.
    Downloading,
    /// Everything arrived and the store is unpacking / verifying it.
    Installing,
    /// Queued: the store has written state but nothing is moving yet.
    Pending,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreInstall {
    /// Stable identity for speed tracking: `steam:<appid>` / `epic:<app>`.
    pub key: String,
    /// Library game this belongs to. Store installs the library doesn't
    /// know about are never reported.
    pub game_id: String,
    pub source: String,
    pub app_id: String,
    pub title: String,
    pub state: InstallState,
    pub percent: Option<f64>,
    pub downloaded: Option<u64>,
    pub total: Option<u64>,
    pub speed: Option<f64>,
    pub eta: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinishedInstall {
    pub game_id: String,
    pub title: String,
    pub source: String,
}

#[derive(Debug, Default)]
pub struct ScanOutcome {
    pub live: Vec<StoreInstall>,
    pub finished: Vec<FinishedInstall>,
}

/// Shared handle: the poller thread owns the scanning, commands only read
/// the last snapshot or ask for an early pass.
pub struct StoreInstallManager {
    latest: Arc<Mutex<Vec<StoreInstall>>>,
    wake: Mutex<Sender<()>>,
}

impl StoreInstallManager {
    pub fn start(app: AppHandle, db: Db) -> Arc<Self> {
        let (tx, rx) = mpsc::channel();
        let latest = Arc::new(Mutex::new(Vec::new()));
        let manager = Arc::new(Self {
            latest: latest.clone(),
            wake: Mutex::new(tx),
        });

        std::thread::spawn(move || run(app, db, latest, rx));
        manager
    }

    pub fn snapshot(&self) -> Vec<StoreInstall> {
        self.latest.lock().map(|v| v.clone()).unwrap_or_default()
    }

    /// Poll now instead of waiting out the interval. Called when the user
    /// starts an install, so the first progress paint is immediate.
    pub fn nudge(&self) {
        if let Ok(tx) = self.wake.lock() {
            let _ = tx.send(());
        }
    }
}

struct Tracker {
    speed: TransferSpeed,
    last_at: Instant,
    seeded: bool,
    /// When this transfer first looked queued-but-idle, if it still does.
    pending_since: Option<Instant>,
}

fn run(
    app: AppHandle,
    db: Db,
    latest: Arc<Mutex<Vec<StoreInstall>>>,
    wake: Receiver<()>,
) {
    let mut steam_cache = steam::SteamManifestCache::default();
    let mut epic_cache = epic::EpicManifestCache::default();
    let mut trackers: HashMap<String, Tracker> = HashMap::new();
    let mut targets: Vec<StoreInstallTarget> = Vec::new();
    let mut targets_at: Option<Instant> = None;
    let mut previous: Vec<StoreInstall> = Vec::new();
    let mut last_emitted: Option<Vec<StoreInstall>> = None;

    loop {
        let refresh_targets = targets_at
            .map(|at| at.elapsed() >= TARGET_REFRESH)
            .unwrap_or(true);
        if refresh_targets {
            // Keep the last good set on error: a locked database must not
            // blank every card's progress.
            if let Ok(loaded) = crate::db::games::list_store_install_targets(&db) {
                targets = loaded;
            }
            targets_at = Some(Instant::now());
        }

        let mut steam_targets: HashMap<u32, &StoreInstallTarget> = HashMap::new();
        let mut epic_targets: HashMap<String, &StoreInstallTarget> = HashMap::new();
        for target in &targets {
            if let Some(app_id) = target.steam_app_id {
                steam_targets.insert(app_id, target);
            }
            if target.epic_namespace.is_some() {
                epic_targets.insert(target.id.clone(), target);
            }
        }
        let epic_all: Vec<&StoreInstallTarget> = epic_targets.values().copied().collect();

        let previous_keys: HashSet<String> = previous.iter().map(|e| e.key.clone()).collect();
        let mut outcome = ScanOutcome::default();
        steam::collect(&steam_targets, &previous_keys, &mut steam_cache, &mut outcome);
        epic::collect(&epic_targets, &previous_keys, &mut epic_cache, &mut outcome);
        epic_linux::collect(&epic_all, &previous_keys, &mut outcome);

        let now = Instant::now();
        let mut give_up: HashSet<String> = HashSet::new();
        for entry in outcome.live.iter_mut() {
            let tracker = trackers.entry(entry.key.clone()).or_insert_with(|| Tracker {
                speed: TransferSpeed::default(),
                last_at: now,
                seeded: false,
                pending_since: None,
            });
            let elapsed = now.saturating_duration_since(tracker.last_at);
            if let Some(bytes) = entry.downloaded {
                if !tracker.seeded {
                    tracker.speed.seed(bytes);
                    tracker.seeded = true;
                } else {
                    tracker.speed.observe(bytes, elapsed);
                }
            }
            tracker.last_at = now;
            entry.speed = tracker.speed.rate();
            entry.eta = match (entry.total, entry.downloaded) {
                (Some(total), Some(done)) if entry.state == InstallState::Downloading => {
                    tracker.speed.eta(total, done)
                }
                _ => None,
            };

            if entry.state == InstallState::Pending {
                let since = *tracker.pending_since.get_or_insert(now);
                if now.saturating_duration_since(since) >= PENDING_GIVE_UP {
                    give_up.insert(entry.key.clone());
                }
            } else {
                tracker.pending_since = None;
            }
        }
        outcome.live.retain(|entry| !give_up.contains(&entry.key));

        let live_keys: HashSet<&String> = outcome.live.iter().map(|e| &e.key).collect();
        trackers.retain(|key, _| live_keys.contains(key));

        outcome.live.sort_by(|a, b| a.key.cmp(&b.key));
        let snapshot = outcome.live;
        if last_emitted.as_ref() != Some(&snapshot) {
            if let Ok(mut slot) = latest.lock() {
                *slot = snapshot.clone();
            }
            let _ = app.emit("store-install-progress", &snapshot);
            last_emitted = Some(snapshot.clone());
        }

        for finished in &outcome.finished {
            let _ = app.emit("store-install-finished", finished);
        }

        previous = snapshot;

        let interval = if previous.is_empty() { SLOW_POLL } else { FAST_POLL };
        match wake.recv_timeout(interval) {
            Ok(()) | Err(RecvTimeoutError::Timeout) => {}
            // Only the manager holds the sender; if it is gone the app is
            // shutting down.
            Err(RecvTimeoutError::Disconnected) => return,
        }
    }
}

/// Current snapshot of every store transfer. Seeds the UI on mount; the
/// `store-install-progress` event keeps it current after that.
#[tauri::command]
pub fn store_installs_list(manager: State<'_, Arc<StoreInstallManager>>) -> Vec<StoreInstall> {
    manager.snapshot()
}

/// Ask for a scan right away — fired when the user starts an install, so
/// the button turns into a progress bar without waiting for the slow pass.
#[tauri::command]
pub fn store_installs_scan_now(manager: State<'_, Arc<StoreInstallManager>>) {
    manager.nudge();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_serializes_lowercase_for_the_ui() {
        assert_eq!(
            serde_json::to_value(InstallState::Downloading).unwrap(),
            serde_json::json!("downloading")
        );
        assert_eq!(
            serde_json::to_value(InstallState::Installing).unwrap(),
            serde_json::json!("installing")
        );
        assert_eq!(
            serde_json::to_value(InstallState::Pending).unwrap(),
            serde_json::json!("pending")
        );
    }

    #[test]
    fn snapshot_payload_is_camel_case() {
        let entry = StoreInstall {
            key: "steam:440".into(),
            game_id: "g1".into(),
            source: "steam".into(),
            app_id: "440".into(),
            title: "Team Fortress 2".into(),
            state: InstallState::Downloading,
            percent: Some(12.5),
            downloaded: Some(100),
            total: Some(800),
            speed: None,
            eta: Some(9),
        };
        let json = serde_json::to_value(&entry).unwrap();
        assert_eq!(json["gameId"], "g1");
        assert_eq!(json["appId"], "440");
        assert_eq!(json["state"], "downloading");
        assert_eq!(json["eta"], 9);
    }
}
