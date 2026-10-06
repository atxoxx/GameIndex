//! OS-keychain wrapper.
//!
//! Phase 4 migrates the OAuth tokens and debrid API key out of
//! plaintext JSON files into the OS keychain:
//!
//! - **Windows**: Credential Manager (`wincred`)
//! - **macOS**: Keychain Access (login keychain by default)
//! - **Linux**: Secret Service (`gnome-keyring`, `kwallet`,
//!   `KeePassXC` Secret Service plugin, etc.)
//!
//! Wrapped with a thin `SecretStore` that exposes typed get/set/delete
//! so callers don't need to drop down to `keyring::Entry`. Errors
//! are mapped to `String` matching the rest of the commands' style.
//!
//! Account names we use today:
//! - `epic_tokens`
//! - `steam_session`
//! - `steam_config`
//! - `debrid_api_key`
//!
//! The service name is `gamelib/gamelib-app` (kept as-is to keep
//! existing OS-keychain credentials accessible after the rename to
//! GameIndex). On Windows this groups entries
//! under "Generic Credentials → gamelib/gamelib-app"; on macOS the
//! user sees them as "Gamelib" in Keychain Access; on Linux a
//! single secret-service collection per service name.

use keyring::Entry;

const SERVICE: &str = "gamelib/gamelib-app";
#[allow(dead_code)] // reserved for future use
pub const SERVICE_FOR_DIAGNOSTICS: &str = SERVICE;

/// One-stop wrapper. Cloning is cheap (only holds a `&str`).
#[derive(Clone)]
pub struct SecretStore;

impl SecretStore {
    pub fn new() -> Self {
        Self
    }

    pub fn get(&self, account: &str) -> Result<Option<String>, String> {
        let entry = Entry::new(SERVICE, account)
            .map_err(|e| format!("keyring entry new: {e}"))?;
        match entry.get_password() {
            Ok(s) => Ok(Some(s)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("keyring get: {e}")),
        }
    }

    pub fn set(&self, account: &str, secret: &str) -> Result<(), String> {
        let entry = Entry::new(SERVICE, account)
            .map_err(|e| format!("keyring entry new: {e}"))?;
        entry
            .set_password(secret)
            .map_err(|e| format!("keyring set: {e}"))
    }

    pub fn delete(&self, account: &str) -> Result<(), String> {
        let entry = Entry::new(SERVICE, account)
            .map_err(|e| format!("keyring entry new: {e}"))?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("keyring delete: {e}")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::SecretStore;

    /// A secret written by one [`SecretStore`] must be readable by a
    /// fresh one, i.e. it must actually reach the OS keystore.
    ///
    /// This is the regression guard for the mock-store trap: `keyring`
    /// 3 has no default features, so if the platform backend
    /// (`windows-native` / `apple-native` / `sync-secret-service`) is not
    /// enabled the crate silently falls back to an in-memory mock whose
    /// secrets never leave the `Entry` that set them. Writes report
    /// success, then a new `Entry` reads `NoEntry` — the exact symptoms
    /// behind "Nexus key saved" followed by "API key not set".
    ///
    /// Skips (rather than fails) where no keychain backend is reachable,
    /// e.g. a headless Linux box without a Secret Service daemon.
    #[test]
    fn secret_round_trips_across_entries() {
        let account = "gamelib_secret_store_test_roundtrip";
        let store = SecretStore::new();
        let _ = store.delete(account);

        if store.set(account, "roundtrip-value").is_err() {
            eprintln!("skipping: no OS keychain backend available");
            return;
        }
        let read = SecretStore::new()
            .get(account)
            .expect("keyring get should not error");
        assert_eq!(
            read.as_deref(),
            Some("roundtrip-value"),
            "secret did not persist across entries — keyring is using the mock store"
        );
        store.delete(account).expect("cleanup test secret");
    }

    #[test]
    fn missing_secret_reads_as_none() {
        let account = "gamelib_secret_store_test_missing";
        let store = SecretStore::new();
        let _ = store.delete(account);
        assert!(store.get(account).expect("get absent secret").is_none());
    }
}
