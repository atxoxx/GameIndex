use serde::{Deserialize, Deserializer, Serialize};
use reqwest::Client;
use regex::Regex;
use serde_json::Value;
use tauri::Manager;

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use crate::db;
use crate::local_achievements::{self, UnlockedAchievement};

/// User-agent for Steam API requests.
const USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// ── Serializable types ──────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Achievement {
    pub api_name: String,
    pub display_name: String,
    pub description: String,
    pub icon: String,
    pub icon_gray: String,
    pub achieved: bool,
    pub unlock_time: u64,
    pub percent: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GameAchievementData {
    pub steam_app_id: u32,
    pub achievements: Vec<Achievement>,
    pub total: u32,
    pub unlocked: u32,
    pub locked: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_synced: Option<u64>,
    /// Active source of the cached data — the cache row's `source`
    /// column is the canonical copy (legacy Steam data defaults to
    /// "steam").
    #[serde(default = "default_source")]
    pub source: String,
    /// Provider-side id for the source (Steam appid for "steam",
    /// provider game id for retro/manual/gog/epic).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_id: Option<String>,
}

/// Serde default for `GameAchievementData::source` — legacy payloads
/// written before multi-source support are Steam data.
fn default_source() -> String {
    "steam".to_string()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AchievementsCache {
    pub games: std::collections::HashMap<String, GameAchievementData>,
}

// ── Steam API response types (private, for deserialization only) ─────

#[derive(Debug, Deserialize)]
struct SchemaResponse {
    game: Option<SchemaGame>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SchemaGame {
    #[serde(default, rename = "availableGameStats")]
    available_game_stats: Option<AvailableGameStats>,
}

#[derive(Debug, Deserialize)]
struct AvailableGameStats {
    #[serde(default)]
    achievements: Vec<SchemaAchievement>,
}

#[derive(Debug, Deserialize)]
struct SchemaAchievement {
    name: String,
    #[serde(default, rename = "displayName")]
    display_name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    icon: String,
    #[serde(default)]
    icongray: String,
    #[serde(default)]
    hidden: u8,
}

#[derive(Debug, Deserialize)]
struct PlayerAchievementsResponse {
    playerstats: Option<PlayerStats>,
}

#[derive(Debug, Deserialize)]
struct PlayerStats {
    #[serde(default)]
    achievements: Vec<PlayerAchievement>,
    #[serde(default)]
    #[allow(dead_code)]
    success: bool,
}

#[derive(Debug, Deserialize)]
struct PlayerAchievement {
    apiname: String,
    achieved: u8,
    #[serde(default)]
    unlocktime: u64,
}

#[derive(Debug, Deserialize)]
struct GlobalPercentResponse {
    achievementpercentages: Option<GlobalPercentBody>,
}

#[derive(Debug, Deserialize)]
struct GlobalPercentBody {
    #[serde(default)]
    achievements: Vec<GlobalAchievementPercent>,
}

#[derive(Debug, Deserialize)]
struct GlobalAchievementPercent {
    name: String,
    /// Steam's `GetGlobalAchievementPercentagesForApp/v2` returns the
    /// unlock **percentage** as a JSON **string** (e.g. `"48.234"`),
    /// not a JSON number. `serde_json` will not coerce a string into
    /// `f64` by default, so we use a custom deserializer that accepts
    /// both shapes — Steam has historically returned the string form,
    /// but we keep the numeric path as forward-compat in case they
    /// ever change it. Without this, parse of the whole
    /// `GlobalPercentResponse` fails, the error is swallowed by the
    /// `.unwrap_or(...)` upstream, every achievement's `percent`
    /// defaults to `0.0`, and the achievement tab renders "0.0%" for
    /// every row.
    #[serde(deserialize_with = "deserialize_percent")]
    percent: f64,
}

/// Custom deserializer for `GlobalAchievementPercent.percent`. Accepts
/// either a JSON string (Steam's actual response shape) or a JSON
/// number (defensive — easier than chasing a regression if Valve ever
/// switches the wire format). Returns the value as `f64` 0–100.
fn deserialize_percent<'de, D>(deserializer: D) -> Result<f64, D::Error>
where
    D: Deserializer<'de>,
{
    let v = Value::deserialize(deserializer)?;
    let n = match v {
        Value::Number(n) => n
            .as_f64()
            .ok_or_else(|| serde::de::Error::custom("percent is not a valid f64")),
        Value::String(s) => s
            .trim()
            .parse::<f64>()
            .map_err(serde::de::Error::custom),
        _ => Err(serde::de::Error::custom(
            "percent must be a JSON string or number",
        )),
    }?;
    // Steam doesn't return NaN/Inf, but `parse::<f64>` silently
    // accepts "NaN" / "Infinity" — Rust would serialize those as JSON
    // `null`, which would then crash the frontend's `.toFixed(1)`.
    // Coerce non-finite values to 0.0 so one bad row can't blank
    // the whole rarity distribution.
    Ok(if n.is_finite() { n } else { 0.0 })
}

fn build_client() -> Result<Client, String> {
    Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))
}

/// GET a Steam Web API endpoint, retrying on HTTP 429 (rate limit) with
/// exponential backoff. A bulk sync fans out up to 6 games × 3 endpoints
/// concurrently with no pacing, and Steam throttles that burst — without
/// a retry the affected games silently failed and never landed in the
/// cache, so the tail of a large sync was missing. Transport errors
/// propagate; a permanently-429ing endpoint returns its final response
/// so the caller surfaces the HTTP status.
async fn get_with_429_retry(
    client: &Client,
    url: String,
    label: &str,
) -> Result<reqwest::Response, String> {
    let mut attempts = 0u32;
    loop {
        let resp = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("{label} request failed: {e}"))?;
        if resp.status().as_u16() == 429 && attempts < 3 {
            attempts += 1;
            tokio::time::sleep(std::time::Duration::from_millis(1000 * 2u64.pow(attempts))).await;
            continue;
        }
        return Ok(resp);
    }
}

// ── Tauri commands ──────────────────────────────────────────────────────

/// Fetch achievements for a single game from Steam. The three Steam API
/// endpoints are queried concurrently (schema, player unlocks, global
/// rarity) so the sync takes ~one round-trip instead of three.
pub async fn fetch_achievements_with_client(
    client: &Client,
    steam_app_id: u32,
    steam_id: &str,
    api_token: &str,
) -> Result<GameAchievementData, String> {
    let schema_url = format!(
        "https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/\
         ?key={}&appid={}&l=english&format=json",
        api_token, steam_app_id
    );
    let player_url = format!(
        "https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/\
         ?key={}&steamid={}&appid={}&format=json",
        api_token, steam_id, steam_app_id
    );
    let global_url = format!(
        "https://api.steampowered.com/ISteamUserStats/\
         GetGlobalAchievementPercentagesForApp/v2/\
         ?gameid={}&format=json",
        steam_app_id
    );

    // The schema, player unlock state, and global rarity endpoints are
    // fully independent — running them sequentially turned every sync
    // into three back-to-back round-trips. Fire them concurrently so
    // the sync latency is the slowest response, not the sum of all
    // three.
    let (schema_res, player_res, global_percents) = tokio::join!(
        async {
            let resp = get_with_429_retry(client, schema_url, "Schema").await?;
            if !resp.status().is_success() {
                return Err(format!(
                    "Schema API returned HTTP {}",
                    resp.status().as_u16()
                ));
            }
            let body = resp.text().await.unwrap_or_else(|_| "{}".to_string());
            serde_json::from_str::<SchemaResponse>(&body)
                .map_err(|e| format!("Failed to parse schema response: {e}"))
        },
        async {
            let resp =
                get_with_429_retry(client, player_url, "Player achievements").await?;
            if !resp.status().is_success() {
                return Err(format!(
                    "Steam player-achievements API returned HTTP {} — your profile or this \
                     game's details may be private",
                    resp.status().as_u16()
                ));
            }
            let body = resp.text().await.unwrap_or_else(|_| "{}".to_string());
            let parsed: PlayerAchievementsResponse =
                serde_json::from_str(&body).unwrap_or(PlayerAchievementsResponse {
                    playerstats: None,
                });
            match parsed.playerstats {
                // Steam signals "unlock state unavailable" (private profile,
                // restricted game details) with `success: false` and an empty
                // list. Falling back to an empty list here would make every
                // achievement render as locked while the sync reports
                // success — so fail loudly instead and let the caller
                // surface the real reason.
                Some(ps) if ps.success || !ps.achievements.is_empty() => Ok(ps.achievements),
                _ => Err(
                    "Steam could not return your achievement unlocks for this game — \
                     your profile or this game's details may be private"
                        .to_string(),
                ),
            }
        },
        async {
            let Ok(resp) = get_with_429_retry(client, global_url, "Global achievement").await
            else {
                return Vec::new();
            };
            if !resp.status().is_success() {
                return Vec::new();
            }
            let body = resp.text().await.unwrap_or_else(|_| "{}".to_string());
            match serde_json::from_str::<GlobalPercentResponse>(&body) {
                Ok(parsed) => parsed
                    .achievementpercentages
                    .map(|ap| ap.achievements)
                    .unwrap_or_default(),
                Err(e) => {
                    // Log instead of silently swallowing — the
                    // string-as-percent schema mismatch bit us
                    // once already; a future wire-format change
                    // should be loud, not invisible.
                    eprintln!(
                        "[achievements] failed to parse GetGlobalAchievementPercentagesForApp \
                         response for appid {steam_app_id}: {e}"
                    );
                    Vec::new()
                }
            }
        },
    );

    let schema: SchemaResponse = schema_res?;
    let schema_achievements = schema
        .game
        .and_then(|g| g.available_game_stats)
        .map(|s| s.achievements)
        .unwrap_or_default();

    if schema_achievements.is_empty() {
        return Ok(GameAchievementData {
            steam_app_id,
            achievements: Vec::new(),
            total: 0,
            unlocked: 0,
            locked: 0,
            last_synced: None,
            source: default_source(),
            provider_id: None,
        });
    }

    let player_achievements: Vec<PlayerAchievement> = player_res?;

    let player_map: std::collections::HashMap<String, &PlayerAchievement> = player_achievements
        .iter()
        .map(|a| (a.apiname.clone(), a))
        .collect();
    let percent_map: std::collections::HashMap<String, f64> = global_percents
        .iter()
        .map(|a| (a.name.clone(), a.percent))
        .collect();

    let mut achievements: Vec<Achievement> = Vec::with_capacity(schema_achievements.len());
    let mut unlocked_count: u32 = 0;

    for sa in &schema_achievements {
        let player = player_map.get(&sa.name);
        let achieved = player.map(|p| p.achieved == 1).unwrap_or(false);
        let unlock_time = player.map(|p| p.unlocktime).unwrap_or(0);
        let percent = percent_map.get(&sa.name).copied().unwrap_or(0.0);

        if achieved {
            unlocked_count += 1;
        }

        achievements.push(Achievement {
            api_name: sa.name.clone(),
            display_name: sa.display_name.clone(),
            description: if sa.hidden == 1 && !achieved {
                "Hidden achievement".to_string()
            } else {
                sa.description.clone()
            },
            icon: sa.icon.clone(),
            icon_gray: sa.icongray.clone(),
            achieved,
            unlock_time,
            percent,
        });
    }

    achievements.sort_by(|a, b| {
        match (a.achieved, b.achieved) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            (true, true) => b.unlock_time.cmp(&a.unlock_time),
            (false, false) => b.percent.partial_cmp(&a.percent).unwrap_or(std::cmp::Ordering::Equal),
        }
    });

    let total = achievements.len() as u32;
    Ok(GameAchievementData {
        steam_app_id,
        achievements,
        total,
        unlocked: unlocked_count,
        locked: total - unlocked_count,
        last_synced: None,
        source: default_source(),
        provider_id: None,
    })
}

#[tauri::command]
pub async fn fetch_achievements(
    steam_app_id: u32,
    steam_id: String,
    api_token: String,
) -> Result<GameAchievementData, String> {
    let client = build_client()?;
    fetch_achievements_with_client(&client, steam_app_id, &steam_id, &api_token).await
}

/// Save the achievements cache to the `achievements_cache` SQLite
/// table. The frontend still ships a single JSON blob (the
/// `AchievementsCache` shape); we parse it and upsert one row per
/// game inside a transaction.
#[tauri::command]
pub fn save_achievements_cache(app: tauri::AppHandle, data: String) -> Result<(), String> {
    let parsed: Value = serde_json::from_str(&data)
        .map_err(|e| format!("parse: {e}"))?;
    let games = parsed
        .get("games")
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();
    let db_state: tauri::State<'_, db::Db> = app.state();
    db::achievements::upsert_many_from_payload(db_state.inner(), &games)
}

/// Load the achievements cache. Returns the same JSON shape the
/// frontend expects: `{ "games": { "<gameId>": <GameAchievementData> } }`.
#[tauri::command]
pub fn load_achievements_cache(app: tauri::AppHandle) -> Result<String, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    db::achievements::read_all_as_payload_json(db_state.inner())
}

/// Internal helper: read the achievements cache as a Rust struct.
pub fn load_cache_internal(app: &tauri::AppHandle) -> Result<AchievementsCache, String> {
    let payload = load_achievements_cache_inner(app)?;
    serde_json::from_str(&payload).map_err(|e| format!("parse payload: {e}"))
}

/// Internal helper: save the achievements cache from a struct.
pub fn save_cache_internal(
    app: &tauri::AppHandle,
    cache: &AchievementsCache,
) -> Result<(), String> {
    let json = serde_json::to_string(cache).map_err(|e| e.to_string())?;
    save_achievements_cache(app.clone(), json)
}

fn load_achievements_cache_inner(app: &tauri::AppHandle) -> Result<String, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    db::achievements::read_all_as_payload_json(db_state.inner())
}

// ── Local (crack / emulator) achievements ───────────────────────────────
//
// The achievement *schema* (display names, icons, descriptions, rarity)
// comes from Steam's own Web API — keyless `GetSchemaForGame/v2` for
// public games, with a keyed fallback via the stored Steam API key, plus
// `GetGlobalAchievementPercentagesForApp/v2` for rarity. The *unlock
// state* comes from crack/emulator files on disk (see
// `local_achievements`). The two are merged into the same
// `GameAchievementData` shape the Steam path produces, keyed by the
// local library game id.

/// The Steam Web API key stored in the OS keychain, if the user has a
/// `steam_session` entry with one (same entry `steam::auth` reads).
pub(crate) fn stored_steam_api_key() -> Option<String> {
    let store = db::secrets::SecretStore::new();
    let secret = store.get("steam_session").ok().flatten()?;
    let session: crate::steam::types::SteamSession = serde_json::from_str(&secret).ok()?;
    if session.api_key.is_empty() {
        None
    } else {
        Some(session.api_key)
    }
}

// ── Steam schema cache ─────────────────────────────────────────────────
//
// Schemas are effectively static per (appid, language), but the
// background watcher re-syncs a game on every on-disk change — without a
// cache every dirty pass issued one HTTP round-trip per game (each with a
// 20s client timeout, so an offline startup pre-search serialized N full
// timeouts). Cache fetched schemas in-process with a 1h TTL; the mutex is
// only ever held for short clone/insert operations, never across an await.

/// TTL for cached Steam schema entries (~1h).
const STEAM_SCHEMA_TTL: Duration = Duration::from_secs(60 * 60);

/// One cached schema: the parsed achievement list plus when it was
/// fetched, so stale entries can be refreshed on demand.
struct CachedSteamSchema {
    schema: Vec<Achievement>,
    fetched_at: Instant,
}

/// `(steam_app_id, language)` -> cached schema.
static STEAM_SCHEMA_CACHE: OnceLock<Mutex<HashMap<(u32, String), CachedSteamSchema>>> =
    OnceLock::new();

fn steam_schema_cache() -> &'static Mutex<HashMap<(u32, String), CachedSteamSchema>> {
    STEAM_SCHEMA_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Fetch the achievement schema for a Steam appid from Steam's own
/// services — the keyed `GetSchemaForGame/v2` when a Steam API key is
/// stored (real api names, gray icons, hidden flags), otherwise the
/// anonymous Steam Community achievements page (no key required), plus
/// global unlock percentages for rarity. Returns achievements with
/// `achieved=false` / `unlock_time=0` (unlock state is merged in
/// separately from local files).
///
/// Results are cached in-process keyed by `(steam_app_id, language)`
/// with a ~1h TTL, so repeated syncs of the same game (e.g. every dirty
/// pass of the background watcher) don't re-download the schema. Only
/// successes are cached — a failed/offline fetch stays uncached so the
/// next pass retries, and `merge_into_cache` already falls back to the
/// persisted cache when no schema is available.
pub async fn fetch_steam_schema(
    client: &Client,
    steam_app_id: u32,
    language: &str,
) -> Result<Vec<Achievement>, String> {
    let key = (steam_app_id, language.to_string());

    // Fast path: serve a fresh cached schema without any network I/O.
    // The mutex is only held for this short lookup + clone — the actual
    // fetch below happens outside the lock.
    {
        let cache = steam_schema_cache().lock().unwrap_or_else(|e| e.into_inner());
        if let Some(entry) = cache.get(&key) {
            if entry.fetched_at.elapsed() < STEAM_SCHEMA_TTL {
                return Ok(entry.schema.clone());
            }
        }
    }

    let schema = fetch_steam_schema_uncached(client, steam_app_id, language).await?;

    // Cache successes only.
    let mut cache = steam_schema_cache().lock().unwrap_or_else(|e| e.into_inner());
    cache.insert(
        key,
        CachedSteamSchema {
            schema: schema.clone(),
            fetched_at: Instant::now(),
        },
    );

    Ok(schema)
}

/// The raw HTTP fetch behind `fetch_steam_schema` (no caching).
async fn fetch_steam_schema_uncached(
    client: &Client,
    steam_app_id: u32,
    language: &str,
) -> Result<Vec<Achievement>, String> {
    // Keyed GetSchemaForGame first — best quality (real api names, gray
    // icons, hidden flags). The keyless variant of this endpoint returns
    // HTTP 400, so anonymous access goes through the Steam Community page
    // below instead.
    if let Some(api_key) = stored_steam_api_key() {
        let keyed_url = format!(
            "https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/\
             ?key={api_key}&appid={steam_app_id}&l={language}&format=json"
        );
        if let Ok(schema) = fetch_schema_from_url(client, &keyed_url).await {
            if !schema.is_empty() {
                return Ok(enrich_schema_with_rarity(client, steam_app_id, schema).await);
            }
        }
    }

    // Anonymous fallback: the Steam Community achievements page — no API
    // key required (e.g. locally-added games). Rows carry their own
    // global unlock percentages.
    fetch_steam_community_schema(client, steam_app_id, language).await
}

/// Attach global unlock percentages (keyless, public) to a
/// keyed-schema row list — Steam's own rarity.
async fn enrich_schema_with_rarity(
    client: &Client,
    steam_app_id: u32,
    schema: Vec<SchemaAchievement>,
) -> Vec<Achievement> {
    let global_url = format!(
        "https://api.steampowered.com/ISteamUserStats/\
         GetGlobalAchievementPercentagesForApp/v2/\
         ?gameid={steam_app_id}&format=json"
    );
    let percent_map: HashMap<String, f64> = match client.get(&global_url).send().await {
        Ok(resp) if resp.status().is_success() => {
            let body = resp.text().await.unwrap_or_else(|_| "{}".to_string());
            match serde_json::from_str::<GlobalPercentResponse>(&body) {
                Ok(parsed) => parsed
                    .achievementpercentages
                    .map(|ap| ap.achievements)
                    .unwrap_or_default()
                    .into_iter()
                    .map(|a| (a.name.clone(), a.percent))
                    .collect(),
                Err(_) => HashMap::new(),
            }
        }
        _ => HashMap::new(),
    };

    schema
        .into_iter()
        .map(|a| {
            let display_name = if a.display_name.is_empty() {
                a.name.clone()
            } else {
                a.display_name
            };
            let description = if a.hidden == 1 && a.description.is_empty() {
                "Hidden achievement".to_string()
            } else {
                a.description
            };
            Achievement {
                api_name: a.name.clone(),
                display_name,
                description,
                icon: a.icon,
                icon_gray: a.icongray,
                achieved: false,
                unlock_time: 0,
                percent: percent_map.get(&a.name).copied().unwrap_or(0.0),
            }
        })
        .collect()
}

/// Fetch the achievement list from the anonymous Steam Community page
/// (`steamcommunity.com/stats/{appid}/achievements`) — no API key
/// required. This is the keyless schema source for locally-added games:
/// Steam's `GetSchemaForGame/v2` needs a key (HTTP 400 without one).
/// Returns rows with `achieved=false` / `unlock_time=0`; the page's
/// global unlock percentage becomes `percent`.
pub(crate) async fn fetch_steam_community_schema(
    client: &Client,
    steam_app_id: u32,
    language: &str,
) -> Result<Vec<Achievement>, String> {
    let url = format!(
        "https://steamcommunity.com/stats/{steam_app_id}/achievements?l={language}"
    );
    let resp = get_with_429_retry(client, url, "Steam Community achievements").await?;
    if !resp.status().is_success() {
        return Err(format!(
            "Steam Community achievements page returned HTTP {}",
            resp.status().as_u16()
        ));
    }
    let body = resp.text().await.unwrap_or_default();
    Ok(parse_community_achievements(&body))
}

/// Parse the Steam Community achievements page HTML (`achieveRow`
/// blocks) into schema rows. The page's structure per row:
/// an icon `<img>`, a `achievePercent` div, and `h3`/`h5` for the
/// display name + description. `api_name` is derived from the icon
/// filename hash (the page carries no API names) so it stays stable
/// across fetches for manual-unlock matching.
fn parse_community_achievements(html: &str) -> Vec<Achievement> {
    let row_re = match Regex::new(
        r#"(?s)<div class="achieveRow[^"]*">.*?<img src="([^"]+)"[^>]*>.*?<div class="achievePercent">\s*([0-9.]+)\s*%</div>.*?<h3>(.*?)</h3>\s*<h5>(.*?)</h5>"#,
    ) {
        Ok(re) => re,
        Err(_) => return Vec::new(),
    };
    let hash_re = match Regex::new(r#"([^/]+)\.(?:jpg|png|gif)$"#) {
        Ok(re) => re,
        Err(_) => return Vec::new(),
    };

    let mut out = Vec::new();
    for (i, caps) in row_re.captures_iter(html).enumerate() {
        let icon = strip_html(&caps[1]).trim().to_string();
        let api_name = hash_re
            .captures(&icon)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string())
            .unwrap_or_else(|| format!("ach-{i}"));
        out.push(Achievement {
            api_name,
            display_name: unescape_html(strip_html(&caps[3]).trim().to_string()),
            description: unescape_html(strip_html(&caps[4]).trim().to_string()),
            icon: icon.clone(),
            icon_gray: icon,
            achieved: false,
            unlock_time: 0,
            percent: caps[2].parse::<f64>().unwrap_or(0.0),
        });
    }
    out
}

/// Strip any inline HTML tags from a captured fragment.
fn strip_html(s: &str) -> String {
    let tag_re = match Regex::new(r"(?s)<[^>]+>") {
        Ok(re) => re,
        Err(_) => return s.to_string(),
    };
    tag_re.replace_all(s, "").into_owned()
}

/// Decode the common HTML entities Steam's page uses.
fn unescape_html(s: String) -> String {
    s.replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
}

/// GET one `GetSchemaForGame/v2` URL and parse the schema rows.
async fn fetch_schema_from_url(
    client: &Client,
    url: &str,
) -> Result<Vec<SchemaAchievement>, String> {
    let resp = get_with_429_retry(client, url.to_string(), "Schema").await?;
    if !resp.status().is_success() {
        return Err(format!(
            "Schema API returned HTTP {}",
            resp.status().as_u16()
        ));
    }
    let body = resp.text().await.unwrap_or_else(|_| "{}".to_string());
    let parsed: SchemaResponse = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse schema response: {e}"))?;
    Ok(parsed
        .game
        .and_then(|g| g.available_game_stats)
        .map(|s| s.achievements)
        .unwrap_or_default())
}

/// Sort achievements: unlocked first (newest unlock first), then locked
/// by rarity (rarest first). Shared by the Steam + local paths.
fn sort_achievements(achievements: &mut [Achievement]) {
    achievements.sort_by(|a, b| match (a.achieved, b.achieved) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        (true, true) => b.unlock_time.cmp(&a.unlock_time),
        (false, false) => b
            .percent
            .partial_cmp(&a.percent)
            .unwrap_or(std::cmp::Ordering::Equal),
    });
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Merge locally-unlocked achievements into the cache for one game.
///
/// Reads the existing cached row (if any), overlays the freshly-fetched
/// `schema` (falling back to the cached achievements when no schema is
/// available, e.g. offline), applies the on-disk unlock state, and
/// persists the result. Never relocks a previously-unlocked
/// achievement — Steam and local unlocks are unioned. Returns the merged
/// data and the count of *newly* unlocked achievements.
pub fn merge_into_cache(
    app: &tauri::AppHandle,
    game_id: &str,
    steam_app_id: u32,
    schema: Option<Vec<Achievement>>,
    unlocked: &[UnlockedAchievement],
) -> Result<(GameAchievementData, usize), String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let db = db_state.inner();

    // Existing cached data (from a prior Steam sync or local scan).
    let existing: Option<GameAchievementData> = db::achievements::get(db, game_id)?
        .and_then(|(_, payload, _, _, _)| serde_json::from_str(&payload).ok());

    // Previously-achieved lookup (uppercased api name -> unlock secs).
    let prev_achieved: std::collections::HashMap<String, u64> = existing
        .as_ref()
        .map(|d| {
            d.achievements
                .iter()
                .filter(|a| a.achieved)
                .map(|a| (a.api_name.to_uppercase(), a.unlock_time))
                .collect()
        })
        .unwrap_or_default();

    // Base achievement list: prefer the fresh schema, else the cached
    // list, else nothing (nothing to merge against).
    let mut base: Vec<Achievement> = match schema {
        Some(s) if !s.is_empty() => s,
        _ => existing.as_ref().map(|d| d.achievements.clone()).unwrap_or_default(),
    };

    if base.is_empty() {
        return Ok((
            existing.unwrap_or(GameAchievementData {
                steam_app_id,
                achievements: Vec::new(),
                total: 0,
                unlocked: 0,
                locked: 0,
                last_synced: Some(now_secs()),
                source: default_source(),
                provider_id: None,
            }),
            0,
        ));
    }

    // Local unlock map: uppercased api name -> unlock secs (ms/1000).
    let local_unlocked: std::collections::HashMap<String, u64> = unlocked
        .iter()
        .map(|u| (u.name.to_uppercase(), u.unlock_time / 1000))
        .collect();

    let mut new_count = 0usize;
    let mut unlocked_count = 0u32;

    for ach in base.iter_mut() {
        let key = ach.api_name.to_uppercase();
        let was_achieved = prev_achieved.contains_key(&key);
        let now_local = local_unlocked.contains_key(&key);
        let achieved = was_achieved || now_local;

        if achieved {
            unlocked_count += 1;
            // Preserve the earliest known unlock time.
            let prev_time = prev_achieved.get(&key).copied().unwrap_or(0);
            let local_time = local_unlocked.get(&key).copied().unwrap_or(0);
            ach.unlock_time = match (prev_time, local_time) {
                (0, t) | (t, 0) => t,
                (a, b) => a.min(b),
            };
            if !was_achieved {
                new_count += 1;
            }
        }
        ach.achieved = achieved;
    }

    sort_achievements(&mut base);

    let total = base.len() as u32;
    let data = GameAchievementData {
        steam_app_id,
        achievements: base,
        total,
        unlocked: unlocked_count,
        locked: total - unlocked_count,
        last_synced: Some(now_secs()),
        source: default_source(),
        provider_id: None,
    };

    let payload = serde_json::to_string(&data).map_err(|e| e.to_string())?;
    db::achievements::upsert(db, game_id, steam_app_id, &payload, now_secs(), "steam", None)?;

    Ok((data, new_count))
}

/// Resolve the UI language stored in the kv table (defaults to "en").
fn resolve_language(app: &tauri::AppHandle) -> String {
    let db_state: tauri::State<'_, db::Db> = app.state();
    db::kv::get(db_state.inner(), "language")
        .ok()
        .flatten()
        .map(|s| s.trim_matches('"').to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "en".to_string())
}

/// Shared worker: fetch the Steam schema, scan + parse local crack
/// files, and merge into the cache. Used by both the manual command and
/// the background watcher. Returns the merged data and new-unlock count.
pub async fn sync_local_for_game(
    app: &tauri::AppHandle,
    client: &Client,
    game_id: &str,
    steam_app_id: u32,
    exe_path: Option<String>,
    language: &str,
) -> Result<(GameAchievementData, usize), String> {
    // Fetch the schema (best-effort — merge can fall back to cache).
    let schema = fetch_steam_schema(client, steam_app_id, language).await.ok();

    // Find + parse all local crack/emulator files for this appid.
    let files = local_achievements::find_achievement_files(steam_app_id, exe_path.as_deref());
    let mut unlocked: Vec<UnlockedAchievement> = Vec::new();
    for file in &files {
        unlocked.extend(local_achievements::parse_achievement_file(file));
    }

    merge_into_cache(app, game_id, steam_app_id, schema, &unlocked)
}

/// Manual per-game local achievement sync (frontend "Sync" button for
/// non-Steam / cracked games). Fetches schema from Steam + reads local
/// crack files, merges, and returns the updated data.
#[tauri::command]
pub async fn sync_local_achievements(
    app: tauri::AppHandle,
    game_id: String,
    steam_app_id: Option<u32>,
) -> Result<GameAchievementData, String> {
    let (steam_app_id, exe_path) = {
        let db_state: tauri::State<'_, db::Db> = app.state();
        let game = db::games::get(db_state.inner(), &game_id)?;
        let exe_path = game.as_ref().map(|g| g.path.clone());
        // Prefer an explicit appid override (e.g. one the frontend just
        // resolved), then the persisted game row's appid.
        let appid = steam_app_id
            .or_else(|| game.and_then(|g| g.steam_app_id))
            .ok_or_else(|| "Game has no Steam AppID — cannot locate achievements".to_string())?;
        (appid, exe_path)
    };

    let language = resolve_language(&app);
    let client = build_client()?;
    let (data, _new) =
        sync_local_for_game(&app, &client, &game_id, steam_app_id, exe_path, &language).await?;
    Ok(data)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Fixture mirrors the real Steam Community achievements page
    /// (`steamcommunity.com/stats/{appid}/achievements`) row structure:
    /// `.achieveRow` → `.achieveImgHolder img` + `.achievePercent` +
    /// `.achieveTxt` h3/h5.
    const SAMPLE_PAGE: &str = r#"
<div class="achieveRow ">
    <div class="achieveImgHolder">
        <img src="https://shared.akamai.steamstatic.com/community_assets/images/apps/782330/2c5d76d44e950aa2eaca0872836de853f6a86da3.jpg" width="64" height="64" border="0" />
    </div>
    <div class="achieveTxtHolder">
        <div class="achieveFill" style="width: 77%"></div>
        <div class="achievePercent">77.3%</div>
        <div class="achieveTxt">
            <h3>Darn It, They Keep BREAKING</h3>
            <h5>Perform 33 Unique Glory Kills in a single save slot</h5>
        </div>
    </div>
    <div style="clear: both;"></div>
</div>
<div class="achieveRow ">
    <div class="achieveImgHolder">
        <img src="https://shared.akamai.steamstatic.com/community_assets/images/apps/782330/11e5d362c82ff2b0ec48fcb91c2ca7f3849a454e.jpg" width="64" height="64" border="0" />
    </div>
    <div class="achieveTxtHolder">
        <div class="achieveFill" style="width: 73%"></div>
        <div class="achievePercent">73.7%</div>
        <div class="achieveTxt">
            <h3>Crystal &amp; Craving</h3>
            <h5>Upgrade Health, Armor, or Ammo</h5>
        </div>
    </div>
    <div style="clear: both;"></div>
</div>
"#;

    #[test]
    fn parses_community_achievements_rows() {
        let rows = parse_community_achievements(SAMPLE_PAGE);
        assert_eq!(rows.len(), 2);

        assert_eq!(rows[0].display_name, "Darn It, They Keep BREAKING");
        assert_eq!(
            rows[0].description,
            "Perform 33 Unique Glory Kills in a single save slot"
        );
        assert_eq!(rows[0].percent, 77.3);
        assert!(!rows[0].achieved);
        assert_eq!(rows[0].unlock_time, 0);
        assert_eq!(
            rows[0].icon,
            "https://shared.akamai.steamstatic.com/community_assets/images/apps/782330/2c5d76d44e950aa2eaca0872836de853f6a86da3.jpg"
        );
        assert_eq!(rows[0].icon_gray, rows[0].icon);
        // api_name is derived from the icon filename hash (page carries no API names).
        assert_eq!(rows[0].api_name, "2c5d76d44e950aa2eaca0872836de853f6a86da3");

        // HTML entities are decoded.
        assert_eq!(rows[1].display_name, "Crystal & Craving");
        assert_eq!(rows[1].percent, 73.7);
    }

    #[test]
    fn community_parse_handles_empty_description() {
        let html = r#"<div class="achieveRow ">
<div class="achieveImgHolder"><img src="https://shared.akamai.steamstatic.com/community_assets/images/apps/782330/df8994bdc1ff5d8f83e77d8025c2a2a3c113d158.jpg" /></div>
<div class="achieveTxtHolder">
<div class="achievePercent">76.3%</div>
<div class="achieveTxt"><h3>Doomsday</h3><h5></h5></div>
</div>
<div style="clear: both;"></div>
</div>"#;
        let rows = parse_community_achievements(html);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].display_name, "Doomsday");
        assert_eq!(rows[0].description, "");
        assert_eq!(rows[0].api_name, "df8994bdc1ff5d8f83e77d8025c2a2a3c113d158");
    }

    #[test]
    fn community_parse_ignores_non_row_markup() {
        assert!(parse_community_achievements("<!DOCTYPE html><html></html>").is_empty());
        assert!(parse_community_achievements("").is_empty());
    }
}
