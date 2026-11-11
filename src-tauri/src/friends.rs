//! Friends sync — local pieces only.
//!
//! The transport is encrypted Nostr relays, driven entirely from the
//! frontend. Earlier versions opened a raw TCP listener, mapped a port with
//! UPnP and published the resulting address to a public key/value service;
//! all of that is gone (it exposed the user's IP and ran unauthenticated
//! peer-to-peer transfer). The shared sync folder under `<app_data_dir>/sync`
//! and the commands that read and wrote it are gone too, for the same reason:
//! relay transport replaced it.
//!
//! What stays in Rust:
//!
//! - the signing identity (secp256k1 private key, kept in the OS keychain),
//! - the friends database file (`<app_data_dir>/friends_db/database.json`).

use tauri::Manager;

use crate::db;
use crate::db::secrets::{SecretStore, FRIENDS_NOSTR_PRIVKEY_ACCOUNT};

/// kv_store key that used to hold the signing key in plaintext. Only read
/// for the one-shot migration into the OS keychain, then deleted.
const LEGACY_PRIVKEY_KV_KEY: &str = "friends_nostr_privkey";

/// True for a 32-byte secp256k1 secret key written as 64 lowercase hex
/// characters — the shape the frontend mints and the shape we accept.
fn is_valid_privkey_hex(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

/// Where the signing identity came from, and what the caller must do about
/// it. Kept pure so the migration rules are testable without touching the
/// OS keychain.
#[derive(Debug, PartialEq, Eq)]
enum IdentityResolution {
    /// The keychain already holds the key. `clear_legacy` is set when an
    /// obsolete plaintext copy is still sitting in kv_store.
    Keychain { value: String, clear_legacy: bool },
    /// Only the legacy plaintext row exists: write it to the keychain,
    /// verify the read-back, then delete the row.
    Legacy { value: String },
    /// Neither store has a usable key. The frontend may mint a new identity.
    Missing,
}

/// Decide what the identity commands should do.
///
/// A keychain error is propagated — never folded into `Missing` — because the
/// frontend mints a fresh identity when it sees "no key", which would orphan
/// the user's existing friend code.
fn resolve_identity(
    keychain: Result<Option<String>, String>,
    legacy: Option<String>,
) -> Result<IdentityResolution, String> {
    let legacy = legacy.filter(|v| is_valid_privkey_hex(v));
    let keychain_value = keychain?.filter(|v| !v.trim().is_empty());

    match keychain_value {
        Some(value) => {
            if !is_valid_privkey_hex(&value) {
                return Err(
                    "stored friends identity in the OS keychain is not a 64-character hex key"
                        .to_string(),
                );
            }
            Ok(IdentityResolution::Keychain {
                clear_legacy: legacy.is_some(),
                value,
            })
        }
        None => Ok(match legacy {
            Some(value) => IdentityResolution::Legacy { value },
            None => IdentityResolution::Missing,
        }),
    }
}

/// Read the Nostr signing key from the OS keychain.
///
/// `Ok(None)` means "no identity yet" and the frontend may mint one.
/// `Err` means the keychain could not be consulted (locked, unavailable,
/// corrupt entry) — the frontend must show an error instead of minting,
/// otherwise the existing friend code is lost.
///
/// Legacy installations kept the key in the SQLite `kv_store`; when only
/// that copy is present it is moved into the keychain, verified with a
/// read-back, and the plaintext row is deleted.
#[tauri::command]
pub fn get_friends_nostr_privkey(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let db = app.state::<db::Db>();
    let store = SecretStore::new();
    let keychain = store.get(FRIENDS_NOSTR_PRIVKEY_ACCOUNT);
    let legacy = db::kv::get(&db, LEGACY_PRIVKEY_KV_KEY)?;

    match resolve_identity(keychain, legacy)? {
        IdentityResolution::Keychain {
            value,
            clear_legacy,
        } => {
            if clear_legacy {
                // Best effort: the key is already served, so a failed cleanup
                // must not turn a successful read into an error.
                if let Err(e) = db::kv::delete(&db, LEGACY_PRIVKEY_KV_KEY) {
                    eprintln!("[gameindex] friends identity: legacy kv cleanup failed: {e}");
                }
            }
            Ok(Some(value))
        }
        IdentityResolution::Legacy { value } => {
            store.set(FRIENDS_NOSTR_PRIVKEY_ACCOUNT, &value)?;
            let readback = store.get(FRIENDS_NOSTR_PRIVKEY_ACCOUNT)?;
            if readback.as_deref() != Some(value.as_str()) {
                return Err("friends nostr key keychain write failed verification".to_string());
            }
            db::kv::delete(&db, LEGACY_PRIVKEY_KV_KEY)?;
            Ok(Some(value))
        }
        IdentityResolution::Missing => Ok(None),
    }
}

/// Persist the Nostr signing key in the OS keychain.
///
/// The value must be 64 lowercase hex characters. It is written, read back to
/// prove it reached the keystore, and any legacy plaintext `kv_store` row is
/// removed. If the deletion fails the command errors so the caller retries;
/// the next `get_friends_nostr_privkey` also retries the cleanup.
#[tauri::command]
pub fn set_friends_nostr_privkey(app: tauri::AppHandle, hex: String) -> Result<(), String> {
    if !is_valid_privkey_hex(&hex) {
        return Err("friends nostr key must be 64 lowercase hex characters".to_string());
    }

    let store = SecretStore::new();
    store.set(FRIENDS_NOSTR_PRIVKEY_ACCOUNT, &hex)?;
    let readback = store.get(FRIENDS_NOSTR_PRIVKEY_ACCOUNT)?;
    if readback.as_deref() != Some(hex.as_str()) {
        return Err("friends nostr key keychain write failed verification".to_string());
    }

    let db = app.state::<db::Db>();
    db::kv::delete(&db, LEGACY_PRIVKEY_KV_KEY)?;
    Ok(())
}

// ── Friends database file ────────────────────────────────────────────

fn load_friends_db_internal(app: &tauri::AppHandle) -> Result<String, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db_dir = app_data.join("friends_db");
    let db_path = db_dir.join("database.json");
    if !db_path.exists() {
        return Ok(
            "{\"profile\":null,\"friends\":[],\"sessions\":[],\"recommendations\":[]}".to_string(),
        );
    }
    std::fs::read_to_string(db_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_friends_db(app: tauri::AppHandle) -> Result<String, String> {
    load_friends_db_internal(&app)
}

#[tauri::command]
pub fn save_friends_db(app: tauri::AppHandle, content: String) -> Result<(), String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db_dir = app_data.join("friends_db");
    std::fs::create_dir_all(&db_dir).map_err(|e| e.to_string())?;
    let file_path = db_dir.join("database.json");
    let tmp_path = db_dir.join("database.json.tmp");
    std::fs::write(&tmp_path, content.as_bytes()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp_path, &file_path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY_A: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const KEY_B: &str = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

    // ── identity shape ─────────────────────────────────────────────

    #[test]
    fn privkey_must_be_lowercase_64_hex() {
        assert!(is_valid_privkey_hex(KEY_A));
        assert!(!is_valid_privkey_hex(&KEY_A.to_uppercase()));
        assert!(!is_valid_privkey_hex(&KEY_A[..63]));
        assert!(!is_valid_privkey_hex(&format!("{KEY_A}0")));
        assert!(!is_valid_privkey_hex(&format!("{}g", &KEY_A[..63])));
        assert!(!is_valid_privkey_hex(""));
    }

    // ── identity resolution ────────────────────────────────────────

    #[test]
    fn keychain_wins_over_legacy() {
        let got = resolve_identity(Ok(Some(KEY_A.to_string())), Some(KEY_B.to_string())).unwrap();
        assert_eq!(
            got,
            IdentityResolution::Keychain {
                value: KEY_A.to_string(),
                clear_legacy: true,
            }
        );
    }

    #[test]
    fn keychain_only_needs_no_cleanup() {
        let got = resolve_identity(Ok(Some(KEY_A.to_string())), None).unwrap();
        assert_eq!(
            got,
            IdentityResolution::Keychain {
                value: KEY_A.to_string(),
                clear_legacy: false,
            }
        );
    }

    #[test]
    fn empty_keychain_falls_back_to_legacy_and_flags_migration() {
        for empty in [Ok(None), Ok(Some(String::new())), Ok(Some("   ".to_string()))] {
            let got = resolve_identity(empty, Some(KEY_B.to_string())).unwrap();
            assert_eq!(
                got,
                IdentityResolution::Legacy {
                    value: KEY_B.to_string()
                }
            );
        }
    }

    #[test]
    fn nothing_stored_means_missing() {
        assert_eq!(
            resolve_identity(Ok(None), None).unwrap(),
            IdentityResolution::Missing
        );
        // A corrupt legacy row is not a usable identity.
        assert_eq!(
            resolve_identity(Ok(None), Some("not-a-key".to_string())).unwrap(),
            IdentityResolution::Missing
        );
        assert_eq!(
            resolve_identity(Ok(None), Some(KEY_A.to_uppercase())).unwrap(),
            IdentityResolution::Missing
        );
    }

    #[test]
    fn keychain_error_is_propagated_never_falls_back_to_minting() {
        let got = resolve_identity(Err("keyring get: access denied".to_string()), Some(KEY_B.to_string()));
        assert!(
            got.is_err(),
            "a broken keychain must not fall back to the legacy row or to Missing"
        );
    }

    #[test]
    fn corrupt_keychain_entry_is_an_error_not_a_new_identity() {
        let got = resolve_identity(Ok(Some("garbage".to_string())), Some(KEY_B.to_string()));
        assert!(got.is_err());
    }
}
