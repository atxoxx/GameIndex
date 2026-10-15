//! First-run setup wizard state.
//!
//! The frontend wizard auto-opens once per install; its completion is
//! recorded here — in the shared `kv_store` rather than localStorage — so
//! it survives a "wipe all" from Settings → Privacy. Re-opening the
//! wizard from Settings never clears the flag; it only displays it.

use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::db::{self, kv};

/// kv key holding the wizard state envelope.
const SETUP_KV_KEY: &str = "setup.wizard.v1";

/// On-disk envelope. Every field is defaulted so a payload written by an
/// older or newer build still deserializes here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupState {
    /// True once the user finished *or* skipped the wizard.
    #[serde(default)]
    pub completed: bool,
    /// True when the user dismissed the wizard with Skip.
    #[serde(default)]
    pub skipped: bool,
    /// Envelope version, for future migrations.
    #[serde(default = "default_version")]
    pub version: u32,
    /// Unix epoch ms when the wizard was completed, if known.
    #[serde(default)]
    pub completed_at_ms: Option<u64>,
}

fn default_version() -> u32 {
    1
}

impl Default for SetupState {
    fn default() -> Self {
        Self {
            completed: false,
            skipped: false,
            version: default_version(),
            completed_at_ms: None,
        }
    }
}

/// Read the persisted wizard state. A missing key reads as the default
/// (not completed), so a fresh install shows the wizard.
#[tauri::command]
pub fn setup_get_state(app: tauri::AppHandle) -> Result<SetupState, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    match kv::get(db_state.inner(), SETUP_KV_KEY)? {
        Some(raw) => serde_json::from_str(&raw).map_err(|e| format!("setup state parse: {e}")),
        None => Ok(SetupState::default()),
    }
}

/// Persist the wizard state.
#[tauri::command]
pub fn setup_set_state(app: tauri::AppHandle, state: SetupState) -> Result<(), String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let json = serde_json::to_string(&state).map_err(|e| format!("setup state encode: {e}"))?;
    kv::set(db_state.inner(), SETUP_KV_KEY, &json)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_state_is_not_completed() {
        let state = SetupState::default();
        assert!(!state.completed);
        assert!(!state.skipped);
        assert_eq!(state.version, 1);
        assert_eq!(state.completed_at_ms, None);
    }

    #[test]
    fn empty_payload_deserializes_to_defaults() {
        let state: SetupState = serde_json::from_str("{}").unwrap();
        assert_eq!(state, SetupState::default());
    }

    #[test]
    fn camel_case_round_trip_preserves_fields() {
        let state = SetupState {
            completed: true,
            skipped: false,
            version: 1,
            completed_at_ms: Some(1_700_000_000_000),
        };
        let json = serde_json::to_string(&state).unwrap();
        assert!(json.contains("completedAtMs"));
        let decoded: SetupState = serde_json::from_str(&json).unwrap();
        assert_eq!(decoded, state);
    }

    #[test]
    fn malformed_payload_is_an_error() {
        assert!(serde_json::from_str::<SetupState>("{ not json").is_err());
    }
}
