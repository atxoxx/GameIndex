//! Wire DTOs for the beta store integrations (Battle.net, EA app,
//! Xbox / Microsoft Store, itch.io).
//!
//! Every type round-trips through the Tauri command boundary as
//! camelCase JSON so the React side can consume it without a
//! translation layer. New optional fields must carry `#[serde(default)]`
//! so an older frontend can still deserialize a newer payload.

use serde::{Deserialize, Serialize};

/// Shown on every beta tile in the Settings UI. Kept server-side so the
/// caveat is identical regardless of which locale string is missing.
#[allow(dead_code)]
pub const BETA_WARNING: &str =
    "Beta — experimental. Sign-in and library import may not work for every account.";

// ── Persisted session marker ───────────────────────────────────────────

/// Persistent login marker. For cookie-backed stores this means "we hold
/// a captured cookie blob"; for Xbox it means "we hold OAuth/XSTS
/// tokens". Drives the "Connected as …" status line.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct BetaSession {
    /// Display name when we can scrape one (best-effort).
    #[serde(default)]
    pub username: String,
    /// Unix seconds at which login completed.
    #[serde(default)]
    pub logged_in_at: u64,
    /// True for the four stores handled by this module.
    #[serde(default = "default_true")]
    pub beta: bool,
}

fn default_true() -> bool {
    true
}

// ── User-facing settings ───────────────────────────────────────────────

/// Shared, minimal settings blob. Each store persists its own copy under
/// a `<store>_settings` kv key.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct BetaSettings {
    /// Master switch — when false, sync imports nothing.
    pub connect_account: bool,
    /// Import titles detected as installed on this PC.
    pub import_installed_games: bool,
    /// Import the full owned library, including uninstalled titles.
    pub import_uninstalled_games: bool,
}

impl Default for BetaSettings {
    fn default() -> Self {
        Self {
            connect_account: true,
            import_installed_games: true,
            import_uninstalled_games: true,
        }
    }
}

// ── Cookie capture ─────────────────────────────────────────────────────

/// One captured cookie record — the minimal fields needed to round-trip a
/// `cookie::Cookie` back into a `reqwest::cookie::Jar`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CookieRecord {
    pub name: String,
    pub value: String,
    #[serde(default)]
    pub domain: Option<String>,
    #[serde(default)]
    pub path: Option<String>,
}

/// Persistable set of captured cookies for one store.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreCookies {
    #[serde(default)]
    pub captured_at: u64,
    pub records: Vec<CookieRecord>,
}

// ── Xbox OAuth tokens ──────────────────────────────────────────────────

/// Persisted Xbox Live credentials: the Microsoft OAuth pair plus the
/// derived XSTS token used to sign Xbox Live REST calls.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct XboxAuthTokens {
    #[serde(default)]
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: String,
    /// XUID (numeric Xbox user id) from the XSTS display claims.
    #[serde(default)]
    pub xuid: String,
    /// User hash (`uhs`) from the XSTS display claims.
    #[serde(default)]
    pub user_hash: String,
    /// The XSTS token itself.
    #[serde(default)]
    pub token: String,
    /// The Xbox Live user token (`user.auth.xboxlive.com`). Kept so the
    /// Store (`mp.microsoft.com`) XSTS the Collections API needs can be
    /// minted on demand without a fresh sign-in.
    #[serde(default)]
    pub xbl_token: String,
    /// Gamertag, when we could resolve it (best-effort).
    #[serde(default)]
    pub gamertag: Option<String>,
    #[serde(default)]
    pub logged_in_at: u64,
}

// ── Sync result ────────────────────────────────────────────────────────

/// Single synced game entry handed to the React side, which feeds it into
/// `addGames(...)`. `id` already encodes the store prefix so the
/// frontend can dedup on the persisted game id across restarts.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BetaSyncedGame {
    pub id: String,
    pub title: String,
    /// Store-native identifier (Battle.net titleId, EA offerId, Xbox pfn,
    /// itch game id) — kept for future launch/update wiring.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub store_game_id: Option<String>,
    pub is_installed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub install_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cover_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub playtime_minutes: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_played: Option<u64>,
}

/// Result of one beta store's library sync.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BetaSyncResult {
    pub success: bool,
    pub games_imported: usize,
    pub games_skipped: usize,
    pub errors: Vec<String>,
    pub last_sync: u64,
    pub synced_games: Vec<BetaSyncedGame>,
    /// Non-fatal human-readable caveat (e.g. "installed-only") shown in
    /// the tile's result banner.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}
