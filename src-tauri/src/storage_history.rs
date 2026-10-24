//! Durable maintenance history for the Storage page.
//!
//! Two records live here, both persisted as JSON in the `kv` domain under
//! `storage.history.v1`:
//!
//!   * `ReclaimEvent` — bytes freed by an in-app uninstall or delete.
//!   * `SizeSnapshot` — the library's total footprint at a point in time,
//!     written by the frontend at most once a week so the page can show
//!     growth as well as shrinkage.
//!
//! The history is bounded so it can never grow without limit: 500 events and
//! 260 snapshots (five years of weekly samples). Oldest entries are dropped
//! first.

use serde::{Deserialize, Serialize};
use tauri::Manager;

const KEY: &str = "storage.history.v1";
const MAX_EVENTS: usize = 500;
const MAX_SNAPSHOTS: usize = 260;

/// One in-app removal. `label` is the game name for a single removal and
/// `None` for a batch, where `count` carries the number of games.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReclaimEvent {
    pub id: String,
    /// ISO-8601 timestamp of the removal.
    pub at: String,
    /// `uninstall` | `delete` — kept as a free string so new kinds do not
    /// require a migration on either side of the boundary.
    pub kind: String,
    pub bytes: u64,
    pub count: u32,
    #[serde(default)]
    pub label: Option<String>,
}

/// The library footprint at one point in time.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SizeSnapshot {
    pub at: String,
    pub bytes: u64,
    pub games: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageHistory {
    #[serde(default)]
    pub events: Vec<ReclaimEvent>,
    #[serde(default)]
    pub snapshots: Vec<SizeSnapshot>,
}

fn load(app: &tauri::AppHandle) -> Result<StorageHistory, String> {
    let db = app.state::<crate::db::Db>().inner().clone();
    match crate::db::kv::get(&db, KEY)? {
        Some(raw) => serde_json::from_str(&raw).map_err(|e| format!("Invalid storage history: {e}")),
        None => Ok(StorageHistory::default()),
    }
}

fn save(app: &tauri::AppHandle, history: &StorageHistory) -> Result<StorageHistory, String> {
    let db = app.state::<crate::db::Db>().inner().clone();
    let raw = serde_json::to_string(history).map_err(|e| format!("Could not encode history: {e}"))?;
    crate::db::kv::set(&db, KEY, &raw)?;
    Ok(history.clone())
}

/// Trim to the most recent `limit` entries. Events and snapshots arrive in
/// chronological order, so dropping from the front keeps the newest window.
fn trim<T>(items: &mut Vec<T>, limit: usize) {
    if items.len() > limit {
        let excess = items.len() - limit;
        items.drain(0..excess);
    }
}

/// Read the whole history. Missing history is a valid empty history.
#[tauri::command]
pub fn storage_history_load(app: tauri::AppHandle) -> Result<StorageHistory, String> {
    load(&app)
}

/// Append a reclaim event and return the updated history.
#[tauri::command]
pub fn storage_history_record(
    app: tauri::AppHandle,
    event: ReclaimEvent,
) -> Result<StorageHistory, String> {
    let mut history = load(&app)?;
    // A retried removal must not double-count.
    history.events.retain(|existing| existing.id != event.id);
    history.events.push(event);
    trim(&mut history.events, MAX_EVENTS);
    save(&app, &history)
}

/// Append a footprint sample, collapsing samples taken within the same day so
/// a burst of app launches cannot flood the chart.
#[tauri::command]
pub fn storage_history_snapshot(
    app: tauri::AppHandle,
    snapshot: SizeSnapshot,
) -> Result<StorageHistory, String> {
    let mut history = load(&app)?;
    let day = snapshot.at.get(0..10).unwrap_or(&snapshot.at).to_string();
    history
        .snapshots
        .retain(|existing| existing.at.get(0..10).unwrap_or(&existing.at) != day);
    history.snapshots.push(snapshot);
    trim(&mut history.snapshots, MAX_SNAPSHOTS);
    save(&app, &history)
}

/// Forget everything. Used by the Storage overview's history reset.
#[tauri::command]
pub fn storage_history_clear(app: tauri::AppHandle) -> Result<StorageHistory, String> {
    save(&app, &StorageHistory::default())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trim_keeps_the_newest_entries() {
        let mut items = vec![1, 2, 3, 4, 5];
        trim(&mut items, 3);
        assert_eq!(items, vec![3, 4, 5]);
    }

    #[test]
    fn trim_is_a_no_op_below_the_limit() {
        let mut items = vec![1, 2];
        trim(&mut items, 3);
        assert_eq!(items, vec![1, 2]);
    }

    #[test]
    fn history_defaults_to_empty_when_fields_are_missing() {
        let parsed: StorageHistory = serde_json::from_str("{}").unwrap();
        assert!(parsed.events.is_empty());
        assert!(parsed.snapshots.is_empty());
    }
}
