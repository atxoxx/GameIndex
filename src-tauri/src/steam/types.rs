use serde::{Deserialize, Serialize};

/// Steam API configuration stored locally.
///
/// Deprecated struct kept for one major-version migration window so
/// the keyring blob loader recognises the legacy `{ steamId, apiKey }`
/// shape and warns the user before swapping to `SteamSession`. New
/// code paths use `SteamSession` directly through
/// `steam/auth::load_or_init_session`; no current call site
/// constructs a `SteamApiConfig` literal — silence the dead-code
/// lint while keeping the type exported.
#[deprecated(since = "0.2.0", note = "Use SteamSession instead — web-token-based auth via WebView login")]
#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SteamApiConfig {
    /// Steam Web API key from https://steamcommunity.com/dev/apikey
    pub api_key: String,
    /// 64-bit Steam ID
    pub steam_id: String,
}

/// Steam session: a Steam Web API key + the 64-bit SteamID of the
/// account it belongs to, plus an optional display name pulled from
/// `ISteamUser/GetPlayerSummaries/v2/` at connect time.
///
/// The API key is obtained by the user from
/// https://steamcommunity.com/dev/apikey and paste-pasted into the
/// Settings UI. It's then passed as the `key=` query parameter on
/// every subsequent Steam Web API call (`IPlayerService/GetOwnedGames`,
/// `ISteamUserStats/GetPlayerAchievements`, etc.).
///
/// `#[serde(alias = "webApiToken")]` preserves backward-compat
/// reads of stale keychain blobs from before the Phase-5 refactor —
/// pre-existing `{ steamId, webApiToken }` JSON decodes cleanly into
/// `{ steamId, apiKey }`. Outbound serialisation still emits
/// `apiKey` so newly written blobs stay canonical.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SteamSession {
    /// 64-bit SteamID the API key was registered against.
    pub steam_id: String,
    /// Steam Web API key. Sent as `key=` to every Steam Web API.
    #[serde(alias = "webApiToken")]
    pub api_key: String,
    /// Display name from `GetPlayerSummaries/v2`. Optional: missing
    /// `displayName` JSON key deserialises to `None` so a stub or
    /// older session blob round-trips through the keychain without
    /// throwing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
}

/// Result of a Steam library sync operation.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamSyncResult {
    pub success: bool,
    pub games_synced: u32,
    pub playtime_updated: u32,
    pub achievements_synced: u32,
    pub error: Option<String>,
    /// Mapped game entries ready to be added to the library.
    pub synced_games: Vec<SyncedGameEntry>,
    /// Steam AppIDs that are currently installed on disk.
    pub installed_appids: Vec<u32>,
    /// Steam AppIDs that have an `appmanifest_<appid>.acf` on disk right
    /// now — installed **or** mid-download/update. Presence of the
    /// manifest is what distinguishes "uninstalled via Steam" (manifest
    /// deleted) from "just updating" (manifest present, `StateFlags`
    /// temporarily not fully-installed). The frontend uses this to
    /// remove uninstalled games from the library without nuking entries
    /// for games that are merely applying an update.
    #[serde(default)]
    pub manifest_appids: Vec<u32>,
}

/// A single game entry from a Steam sync, ready to be mapped to GameData.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SyncedGameEntry {
    pub appid: u32,
    pub name: String,
    pub playtime_forever: u32,
    /// Resolved path to the main game executable (if installed locally).
    pub exe_path: Option<String>,
    /// Total disk footprint of the install dir, measured by
    /// `size::measure_folder_size` after the smart exe resolver returns.
    /// `None` when the game is uninstalled, exe resolution failed, or
    /// the disk walk errored out (folder gone, permission denied, etc.).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
    /// Folder the size was measured against (= parent of `exe_path`).
    /// Auditable from the Storage tab so users can see and re-link the
    /// root we summed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size_root_path: Option<String>,
    /// Unix timestamp (seconds) of the last time the user played this
    /// game on Steam. Passed through to the frontend so the Library
    /// page's "Continue Playing" rail can surface recently-active titles.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rtime_last_played: Option<u64>,
    /// Family sharing details if this installed game belongs to another family member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub family_shared_by: Option<String>,
}

/// A member of a Steam Family group.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SteamFamilyMember {
    pub steam_id: String,
    pub account_id: u32,
    pub role: u32,
    pub persona_name: Option<String>,
    pub avatar_url: Option<String>,
    pub profile_url: Option<String>,
    pub is_current_user: bool,
}

/// Steam Family group configuration detected locally or via API.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SteamFamilyGroup {
    pub group_id: String,
    pub name: String,
    pub role: u32,
    pub members: Vec<SteamFamilyMember>,
}

/// Information about a game's family sharing ownership.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SteamFamilyShareInfo {
    pub is_shared: bool,
    pub owner_steam_id: Option<String>,
    pub owner_name: Option<String>,
    pub owner_avatar_url: Option<String>,
    pub family_group_name: Option<String>,
}

/// Details for an individual DLC item.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SteamDlcItem {
    pub app_id: u32,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub header_image: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub price_formatted: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub initial_price_formatted: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub discount_percent: Option<u32>,
    pub is_free: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub release_date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub short_description: Option<String>,
    pub is_owned: bool,
    pub is_installed: bool,
}

/// Full DLCs result for a game, including family sharing status.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SteamGameDlcsResult {
    pub app_id: u32,
    pub total_dlcs: u32,
    /// Number of DLC AppIDs discovered after dedupe but before the
    /// 100-item cap. Lets the UI flag catalogs it is only partially
    /// showing, and survives old payloads/caches via `serde(default)`.
    #[serde(default)]
    pub total_available: u32,
    pub owned_count: u32,
    pub installed_count: u32,
    pub dlcs: Vec<SteamDlcItem>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub family_share: Option<SteamFamilyShareInfo>,
}

