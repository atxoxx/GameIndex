//! Epic Games achievements (L1d) — schema + player progress via Epic's
//! internal launcher APIs.
//!
//! Auth: OAuth tokens live in the SQLite `kv_store` under key
//! `epic_tokens` (written by `epic::auth`). Every authenticated call
//! sends `Authorization: {token_type} {access_token}` (literal lowercase
//! type, defaulting to `bearer`). On HTTP 401 we refresh the access
//! token once (OAuth refresh-token grant, persisted back to the kv
//! store) and retry the request once.
//!
//! Flow per game (game ids are Epic AppNames, e.g. "Chickens"):
//!   1. Resolve the game's `namespace` via the library GetAssets API
//!      (paginated; cached in kv ~10 min with a fetched-at timestamp).
//!   2. Fetch the achievement *schema* (display names / icons / rarity)
//!      via the launcher store GraphQL endpoint. Keeps `productId`.
//!   3. Fetch the player's *progress* (unlock state + dates) via the
//!      same endpoint.
//!   4. Merge: schema items annotated with unlock state.
//!   5. Map to the shared `Achievement` shape; counts derived from the
//!      merged list (the API's totalUnlocked/totalAchievements are
//!      ignored).
//!   6. Persist a cache row: `source="epic"`, `provider_id=namespace`,
//!      `steam_app_id=0`, `last_synced=now`.
//!
//! SKIPPED (out of scope for this lane): the GetProductSlug /
//! source-url step the upstream CommonPluginsStores plugin performs
//! after the merge — the store page link is not needed here.

use std::collections::{HashMap, HashSet};
use std::time::Duration;

use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

use super::types::EpicAuthTokens;
use crate::achievements::{Achievement, GameAchievementData};
use crate::db;

// ── Epic OAuth / API constants ──────────────────────────────────────

const EPIC_TOKEN_URL: &str =
    "https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/token";
/// Basic-encoded OAuth client credentials. Same value the rest of the
/// Epic integration uses (`epic::auth::EPIC_AUTH_ENCODED`), duplicated
/// here because that constant is private to its module.
const EPIC_AUTH_ENCODED: &str =
    "MzRhMDJjZjhmNDQxNGUyOWIxNTkyMTg3NmRhMzZmOWE6ZGFhZmJjY2M3Mzc3NDUwMzlkZmZlNTNkOTRmYzc2Y2Y=";
/// Epic library "GetAssets" endpoint — maps an AppName to a namespace.
const ASSETS_URL: &str =
    "https://library-service.live.use1a.on.epicgames.com/library/api/public/items?includeMetadata=true&platform=Windows";
/// Epic launcher store GraphQL endpoint (schema + player progress).
const GRAPHQL_URL: &str = "https://launcher.store.epicgames.com/graphql";
const GRAPHQL_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) EpicGamesLauncher";

// ── Persistence keys ────────────────────────────────────────────────

const EPIC_TOKENS_KV_KEY: &str = "epic_tokens";
/// kv key for the cached GetAssets appName→namespace list.
const ASSETS_CACHE_KV_KEY: &str = "epic_achievements_assets_cache";
/// GetAssets cache TTL (~10 min — the library list is effectively
/// static within a session).
const ASSETS_CACHE_TTL_SECS: u64 = 10 * 60;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

// ── GraphQL queries (verbatim from CommonPluginsStores) ─────────────

const SCHEMA_QUERY: &str = r#"query Achievement($SandboxId: String!, $Locale: String!) {
  Achievement {
    productAchievementsRecordBySandbox(sandboxId: $SandboxId, locale: $Locale) {
      productId
      sandboxId
      totalAchievements
      achievementSets { achievementSetId isBase totalAchievements totalXP }
      achievements {
        achievement {
          sandboxId deploymentId name hidden isBase achievementSetId
          unlockedDisplayName lockedDisplayName
          unlockedDescription lockedDescription
          unlockedIconLink lockedIconLink
          XP flavorText
          rarity { percent }
        }
      }
    }
  }
}"#;

const PROGRESS_QUERY: &str = r#"query playerProfileAchievementsByProductId($EpicAccountId: String!, $ProductId: String!) {
  PlayerProfile {
    playerProfile(epicAccountId: $EpicAccountId) {
      epicAccountId displayName relationship
      avatar { small medium large }
      productAchievements(productId: $ProductId) {
        ... on PlayerProductAchievementsResponseSuccess {
          data {
            epicAccountId sandboxId totalXP totalUnlocked
            playerAchievements {
              playerAchievement {
                achievementName epicAccountId progress sandboxId unlocked unlockDate XP achievementSetId isBase
              }
            }
          }
        }
      }
    }
  }
}"#;

// ── Serializable types ──────────────────────────────────────────────

/// Per-game result of an Epic achievements fetch. `data` is present on
/// success (including the "no achievements found" soft-failure where an
/// empty payload ships alongside a human-readable `error` note); a hard
/// failure returns `data = None` plus the error text.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EpicAchievementResult {
    pub game_id: String,
    pub data: Option<GameAchievementData>,
    pub error: Option<String>,
}

/// Auth bundle for Epic requests: the tokens plus the OAuth
/// `token_type` prefix used in the `Authorization` header (usually
/// "bearer", lowercase).
struct EpicAuth {
    tokens: EpicAuthTokens,
    token_type: String,
}

// ── Response types (private, for deserialization only) ─────────────

#[derive(Debug, Deserialize)]
struct GraphqlEnvelope<T> {
    data: Option<T>,
    #[serde(default)]
    errors: Option<Vec<Value>>,
}

#[derive(Debug, Deserialize)]
struct SchemaData {
    #[serde(rename = "Achievement")]
    achievement: Option<SchemaRoot>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SchemaRoot {
    product_achievements_record_by_sandbox: Option<SchemaRecord>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SchemaRecord {
    #[serde(default)]
    product_id: String,
    #[serde(default)]
    achievements: Option<Vec<SchemaEntry>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SchemaEntry {
    achievement: Option<SchemaAchievementRaw>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SchemaAchievementRaw {
    name: Option<String>,
    #[serde(default)]
    unlocked_display_name: Option<String>,
    #[serde(default)]
    unlocked_description: Option<String>,
    #[serde(default)]
    unlocked_icon_link: Option<String>,
    #[serde(default)]
    locked_icon_link: Option<String>,
    #[serde(default)]
    rarity: Option<Rarity>,
}

#[derive(Debug, Deserialize)]
struct Rarity {
    /// `percent` may be absent or null — coerce both to 0.0. Accepts a
    /// JSON string defensively (Epic has shipped both shapes elsewhere;
    /// mirroring the Steam path's tolerant percent deserializer).
    #[serde(default, deserialize_with = "deserialize_percent")]
    percent: f64,
}

/// Tolerant percent deserializer: number, string, or anything else
/// (null / missing) → a finite f64 in 0–100 (non-finite coerced to 0.0).
fn deserialize_percent<'de, D>(deserializer: D) -> Result<f64, D::Error>
where
    D: serde::Deserializer<'de>,
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
        _ => Ok(0.0),
    }?;
    Ok(if n.is_finite() { n } else { 0.0 })
}

#[derive(Debug, Deserialize)]
struct ProgressData {
    #[serde(rename = "PlayerProfile")]
    player_profile: Option<ProgressRoot>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProgressRoot {
    player_profile: Option<ProgressBody>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProgressBody {
    product_achievements: Option<ProgressUnion>,
}

/// `productAchievements` is a GraphQL union — the successful arm
/// (`PlayerProductAchievementsResponseSuccess`) contributes `data`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProgressUnion {
    data: Option<ProgressInner>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProgressInner {
    player_achievements: Option<Vec<ProgressEntry>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProgressEntry {
    player_achievement: Option<PlayerAchievementRaw>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlayerAchievementRaw {
    achievement_name: Option<String>,
    unlocked: Option<bool>,
    unlock_date: Option<String>,
}

// ── Parsed intermediate types (pure, unit-testable) ─────────────────

/// A single schema achievement extracted from the GraphQL response.
#[derive(Debug, Clone)]
struct SchemaAchievement {
    name: String,
    display_name: String,
    description: String,
    icon: String,
    icon_gray: String,
    percent: f64,
}

/// Parsed schema response: the product id (needed for the progress
/// query) plus the achievement schema.
struct SchemaParsed {
    product_id: String,
    achievements: Vec<SchemaAchievement>,
}

/// A single player-achievement progress entry.
#[derive(Debug, Clone)]
struct ProgressAchievement {
    name: String,
    unlocked: bool,
    unlock_date: Option<String>,
}

/// GetAssets cache row (kv-persisted with a fetched-at timestamp).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AssetRecord {
    app_name: String,
    namespace: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AssetsCacheEntry {
    fetched_at: u64,
    records: Vec<AssetRecord>,
}

// ── Pure parse helpers (unit-tested, no network) ────────────────────

/// Parse the GraphQL schema response body. Returns the product id and
/// the achievement schema. Display strings are trimmed; a `rarity.percent`
/// of null/missing becomes 0.0.
fn parse_schema_response(json: &str) -> Result<SchemaParsed, String> {
    let envelope: GraphqlEnvelope<SchemaData> = serde_json::from_str(json)
        .map_err(|e| format!("failed to parse schema response: {e}"))?;
    if envelope.data.is_none() {
        if let Some(errors) = &envelope.errors {
            if !errors.is_empty() {
                return Err(format!(
                    "Epic GraphQL schema query returned errors: {}",
                    graphql_errors_to_string(errors)
                ));
            }
        }
        return Err("Epic GraphQL schema response is missing data".to_string());
    }

    let record = envelope
        .data
        .and_then(|d| d.achievement)
        .and_then(|r| r.product_achievements_record_by_sandbox);

    let product_id = record
        .as_ref()
        .map(|r| r.product_id.clone())
        .unwrap_or_default();
    let achievements = record
        .and_then(|r| r.achievements)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|e| e.achievement)
        .filter_map(|a| {
            let name = a.name?;
            Some(SchemaAchievement {
                name,
                display_name: a
                    .unlocked_display_name
                    .unwrap_or_default()
                    .trim()
                    .to_string(),
                description: a
                    .unlocked_description
                    .unwrap_or_default()
                    .trim()
                    .to_string(),
                icon: a.unlocked_icon_link.unwrap_or_default(),
                icon_gray: a.locked_icon_link.unwrap_or_default(),
                percent: a.rarity.map(|r| r.percent).unwrap_or(0.0),
            })
        })
        .collect();

    Ok(SchemaParsed {
        product_id,
        achievements,
    })
}

/// Parse the GraphQL player-progress response body. Walks the nested
/// `PlayerProfile.playerProfile.productAchievements.data.playerAchievements`
/// shape; a missing profile or missing list yields an empty progress set.
fn parse_progress_response(json: &str) -> Result<Vec<ProgressAchievement>, String> {
    let envelope: GraphqlEnvelope<ProgressData> = serde_json::from_str(json)
        .map_err(|e| format!("failed to parse progress response: {e}"))?;
    if envelope.data.is_none() {
        if let Some(errors) = &envelope.errors {
            if !errors.is_empty() {
                return Err(format!(
                    "Epic GraphQL progress query returned errors: {}",
                    graphql_errors_to_string(errors)
                ));
            }
        }
        return Err("Epic GraphQL progress response is missing data".to_string());
    }

    let entries = envelope
        .data
        .and_then(|d| d.player_profile)
        .and_then(|r| r.player_profile)
        .and_then(|b| b.product_achievements)
        .and_then(|u| u.data)
        .and_then(|d| d.player_achievements)
        .unwrap_or_default();

    Ok(entries
        .into_iter()
        .filter_map(|e| e.player_achievement)
        .filter_map(|a| {
            let name = a.achievement_name?;
            Some(ProgressAchievement {
                name,
                unlocked: a.unlocked.unwrap_or(false),
                unlock_date: a.unlock_date.filter(|s| !s.is_empty()),
            })
        })
        .collect())
}

/// Merge schema + progress into the shared `Achievement` shape.
///
/// Unlock state comes only from the player's progress list (an absent
/// progress entry stays locked). An unlocked achievement whose
/// `unlockDate` is malformed is treated as unlocked with `unlock_time 0`
/// rather than failing the whole game — a deliberate deviation from the
/// upstream plugin, which throws on a bad date.
fn merge_progress(
    schema: &[SchemaAchievement],
    progress: &[ProgressAchievement],
) -> Vec<Achievement> {
    let progress_map: HashMap<&str, &ProgressAchievement> = progress
        .iter()
        .map(|p| (p.name.as_str(), p))
        .collect();

    schema
        .iter()
        .map(|sa| {
            let matched = progress_map.get(sa.name.as_str()).copied();
            let achieved = matched.map(|p| p.unlocked).unwrap_or(false);
            let unlock_time = if achieved {
                matched
                    .and_then(|p| p.unlock_date.as_deref())
                    .and_then(parse_unlock_date)
                    .unwrap_or(0)
            } else {
                0
            };
            Achievement {
                api_name: sa.name.clone(),
                display_name: sa.display_name.clone(),
                description: sa.description.clone(),
                icon: sa.icon.clone(),
                icon_gray: sa.icon_gray.clone(),
                achieved,
                unlock_time,
                percent: sa.percent,
            }
        })
        .collect()
}

/// Parse Epic's `yyyy-MM-ddTHH:mm:ss.fffK` unlock date (e.g.
/// `"2024-01-01T12:34:56.789Z"`) into a unix timestamp in seconds.
/// Fully defensive: any malformed input returns `None` so the caller
/// can keep the achievement unlocked with time 0.
fn parse_unlock_date(s: &str) -> Option<u64> {
    let s = s.trim();
    let (date_part, rest) = s.split_once('T')?;

    let mut date_it = date_part.split('-');
    let year: i64 = date_it.next()?.parse().ok()?;
    let month: i64 = date_it.next()?.parse().ok()?;
    let day: i64 = date_it.next()?.parse().ok()?;
    if date_it.next().is_some() {
        return None;
    }

    let offset_idx = rest.find(|c: char| c == 'Z' || c == '+' || c == '-');
    let (time_part, offset_part) = match offset_idx {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, ""),
    };

    let mut time_it = time_part.split(':');
    let hour: i64 = time_it.next()?.parse().ok()?;
    let minute: i64 = time_it.next()?.parse().ok()?;
    let sec_frag = time_it.next()?;
    if time_it.next().is_some() {
        return None;
    }
    let sec_str = sec_frag.split('.').next().unwrap_or(sec_frag);
    let sec: i64 = sec_str.parse().ok()?;

    if !(1970..=9999).contains(&year)
        || !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
        || hour > 23
        || minute > 59
        || sec > 60
    {
        return None;
    }

    // Timezone offset: absent or `Z` → UTC; `±HH:MM` → signed seconds.
    let offset_secs = match offset_part {
        "" | "Z" | "z" => 0i64,
        _ => {
            let (sign, hm) = match offset_part.as_bytes().first() {
                Some(b'+') => (1i64, &offset_part[1..]),
                Some(b'-') => (-1i64, &offset_part[1..]),
                _ => return None,
            };
            let (oh, om) = hm.split_once(':')?;
            let oh: i64 = oh.parse().ok()?;
            let om: i64 = om.parse().ok()?;
            sign * (oh * 3600 + om * 60)
        }
    };

    let days = days_from_civil(year, month as u32, day as u32);
    let unix = days * 86_400 + hour * 3600 + minute * 60 + sec - offset_secs;
    if unix < 0 {
        return None;
    }
    Some(unix as u64)
}

/// Days since 1970-01-01 for a proleptic-Gregorian civil date
/// (Howard Hinnant's `days_from_civil`).
fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp as i64 + 2) / 5 + d as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

fn graphql_errors_to_string(errors: &[Value]) -> String {
    errors
        .iter()
        .filter_map(|e| e["message"].as_str())
        .collect::<Vec<_>>()
        .join("; ")
}

// ── HTTP plumbing ───────────────────────────────────────────────────

fn build_client() -> Result<Client, String> {
    Client::builder()
        .user_agent(GRAPHQL_USER_AGENT)
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))
}

/// Send an authenticated request, refreshing the access token once and
/// retrying once on HTTP 401. `build` receives the literal
/// `(token_type, access_token)` pair and returns a request builder
/// (callers attach `Authorization: {token_type} {access_token}` and any
/// endpoint-specific headers/body).
async fn send_authenticated(
    client: &Client,
    app: &AppHandle,
    auth: &mut EpicAuth,
    build: impl Fn(&str, &str) -> reqwest::RequestBuilder,
) -> Result<reqwest::Response, String> {
    let mut attempts = 0u8;
    loop {
        let resp = build(&auth.token_type, &auth.tokens.access_token)
            .send()
            .await
            .map_err(|e| format!("Epic API request failed: {e}"))?;
        if resp.status().as_u16() == 401 && attempts == 0 {
            eprintln!(
                "[epic-achievements] HTTP 401 — refreshing Epic access token and retrying once"
            );
            *auth = refresh_auth(client, app, auth).await?;
            attempts += 1;
            continue;
        }
        return Ok(resp);
    }
}

/// Refresh the Epic access token via the OAuth refresh-token grant and
/// persist the fresh tokens back to the `kv_store` (`epic_tokens`),
/// mirroring `epic::auth::refresh_tokens_if_needed`.
async fn refresh_auth(client: &Client, app: &AppHandle, auth: &EpicAuth) -> Result<EpicAuth, String> {
    let response = client
        .post(EPIC_TOKEN_URL)
        .header("Authorization", format!("basic {EPIC_AUTH_ENCODED}"))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(format!(
            "grant_type=refresh_token&refresh_token={}&token_type=eg1",
            auth.tokens.refresh_token
        ))
        .send()
        .await
        .map_err(|e| format!("Epic token refresh request failed: {e}"))?;

    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("Epic token refresh failed (HTTP {status}): {body}"));
    }

    let json: Value = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse refresh response: {e}"))?;
    let access_token = json["access_token"]
        .as_str()
        .ok_or_else(|| "Missing access_token in refresh response".to_string())?
        .to_string();
    let refresh_token = json["refresh_token"]
        .as_str()
        .unwrap_or(&auth.tokens.refresh_token)
        .to_string();
    let expires_in = json["expires_in"].as_u64().unwrap_or(3600);

    let new_tokens = EpicAuthTokens {
        access_token,
        refresh_token,
        expires_at: now_secs() + expires_in,
        account_id: auth.tokens.account_id.clone(),
        display_name: auth.tokens.display_name.clone(),
    };
    save_tokens_to_kv(app, &new_tokens)?;

    let new_auth = EpicAuth {
        token_type: json["token_type"]
            .as_str()
            .map(|s| s.to_string())
            .unwrap_or_else(|| auth.token_type.clone()),
        tokens: new_tokens,
    };
    Ok(new_auth)
}

// ── Token persistence (kv_store — no OS keychain) ───────────────────

/// Load the stored Epic tokens plus the `token_type` prefix for the
/// `Authorization` header. The persisted blob (`EpicAuthTokens`) does
/// not carry `token_type`, so we peek at the raw JSON and default to
/// `bearer` (lowercase, as Epic's token response sends it).
fn load_auth(app: &AppHandle) -> Result<EpicAuth, String> {
    let db_state = app
        .try_state::<db::Db>()
        .ok_or_else(|| "Database not initialized".to_string())?;
    let raw = db::kv::get(db_state.inner(), EPIC_TOKENS_KV_KEY)
        .map_err(|e| format!("failed to read Epic tokens: {e}"))?
        .ok_or_else(|| {
            "Not logged in to Epic Games. Open Settings → Integrations → Epic Games and click \
             \"Connect Epic Account\" to authenticate before syncing achievements."
                .to_string()
        })?;
    let value: Value =
        serde_json::from_str(&raw).map_err(|e| format!("failed to parse Epic tokens: {e}"))?;
    let tokens: EpicAuthTokens = serde_json::from_value(value.clone())
        .map_err(|e| format!("failed to parse Epic tokens: {e}"))?;
    let token_type = value
        .get("token_type")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "bearer".to_string());
    Ok(EpicAuth { tokens, token_type })
}

fn save_tokens_to_kv(app: &AppHandle, tokens: &EpicAuthTokens) -> Result<(), String> {
    let db_state = app
        .try_state::<db::Db>()
        .ok_or_else(|| "Database not initialized".to_string())?;
    let json = serde_json::to_string(tokens).map_err(|e| format!("serialize tokens: {e}"))?;
    db::kv::set(db_state.inner(), EPIC_TOKENS_KV_KEY, &json)
}

// ── Step 1: GetAssets (namespace mapping, cached) ───────────────────

/// Fetch the full GetAssets list (paginated) into (appName, namespace)
/// records.
async fn fetch_assets(
    client: &Client,
    app: &AppHandle,
    auth: &mut EpicAuth,
) -> Result<Vec<AssetRecord>, String> {
    let mut records: Vec<AssetRecord> = Vec::new();
    let mut cursor: Option<String> = None;
    let mut seen_cursors: HashSet<String> = HashSet::new();
    let mut page: u32 = 0;

    loop {
        page += 1;
        let url = match &cursor {
            Some(c) => format!("{}&cursor={}", ASSETS_URL, urlencoding::encode(c)),
            None => ASSETS_URL.to_string(),
        };

        let resp = send_authenticated(client, app, auth, |token_type, access_token| {
            client
                .get(&url)
                .header("Authorization", format!("{} {}", token_type, access_token))
        })
        .await?;

        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(format!(
                "Epic library assets API returned HTTP {status} (page {page}): {body}"
            ));
        }

        let json: Value = serde_json::from_str(&body)
            .map_err(|e| format!("failed to parse Epic assets response (page {page}): {e}"))?;

        if let Some(arr) = json["records"].as_array() {
            for item in arr {
                if let (Some(app_name), Some(namespace)) =
                    (item["appName"].as_str(), item["namespace"].as_str())
                {
                    records.push(AssetRecord {
                        app_name: app_name.to_string(),
                        namespace: namespace.to_string(),
                    });
                }
            }
        }

        let next_cursor = json["responseMetadata"]["nextCursor"]
            .as_str()
            .map(|s| s.to_string());

        match next_cursor {
            // Only `nextCursor == null/""` terminates; a repeated cursor
            // value is a degenerate-loop guard (mirrors epic/sync.rs).
            Some(c) if !c.is_empty() => {
                if !seen_cursors.insert(c.clone()) {
                    break;
                }
                cursor = Some(c);
            }
            _ => break,
        }
    }

    Ok(records)
}

fn read_assets_cache(app: &AppHandle) -> Option<AssetsCacheEntry> {
    let db_state = app.try_state::<db::Db>()?;
    let raw = db::kv::get(db_state.inner(), ASSETS_CACHE_KV_KEY).ok()??;
    serde_json::from_str(&raw).ok()
}

fn write_assets_cache(app: &AppHandle, records: &[AssetRecord]) {
    let db_state = match app.try_state::<db::Db>() {
        Some(s) => s,
        None => return,
    };
    let entry = AssetsCacheEntry {
        fetched_at: now_secs(),
        records: records.to_vec(),
    };
    if let Ok(json) = serde_json::to_string(&entry) {
        let _ = db::kv::set(db_state.inner(), ASSETS_CACHE_KV_KEY, &json);
    }
}

/// GetAssets with a ~10-min kv cache. Cache misses / stale entries are
/// re-fetched and persisted (successes only).
async fn fetch_or_load_assets(
    client: &Client,
    app: &AppHandle,
    auth: &mut EpicAuth,
) -> Result<Vec<AssetRecord>, String> {
    if let Some(entry) = read_assets_cache(app) {
        if now_secs().saturating_sub(entry.fetched_at) < ASSETS_CACHE_TTL_SECS {
            return Ok(entry.records);
        }
    }
    let records = fetch_assets(client, app, auth).await?;
    write_assets_cache(app, &records);
    Ok(records)
}

/// Map a game id (Epic AppName) to its namespace via GetAssets.
/// Returns `None` when no asset record matches.
async fn resolve_namespace(
    client: &Client,
    app: &AppHandle,
    auth: &mut EpicAuth,
    game_id: &str,
) -> Result<Option<String>, String> {
    let records = fetch_or_load_assets(client, app, auth).await?;
    Ok(records
        .iter()
        .find(|r| r.app_name == game_id)
        .map(|r| r.namespace.clone()))
}

// ── Steps 2–3: GraphQL schema + progress ────────────────────────────

async fn fetch_schema(
    client: &Client,
    app: &AppHandle,
    auth: &mut EpicAuth,
    namespace: &str,
    locale: &str,
) -> Result<SchemaParsed, String> {
    let body = serde_json::json!({
        "query": SCHEMA_QUERY,
        "variables": { "SandboxId": namespace, "Locale": locale },
    })
    .to_string();

    let resp = send_authenticated(client, app, auth, |token_type, access_token| {
        client
            .post(GRAPHQL_URL)
            .header("Content-Type", "application/json")
            .header("User-Agent", GRAPHQL_USER_AGENT)
            .header("Authorization", format!("{} {}", token_type, access_token))
            .body(body.clone())
    })
    .await?;

    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "Epic GraphQL schema query returned HTTP {status}: {text}"
        ));
    }
    parse_schema_response(&text)
}

async fn fetch_progress(
    client: &Client,
    app: &AppHandle,
    auth: &mut EpicAuth,
    account_id: &str,
    product_id: &str,
) -> Result<Vec<ProgressAchievement>, String> {
    let body = serde_json::json!({
        "query": PROGRESS_QUERY,
        "variables": { "EpicAccountId": account_id, "ProductId": product_id },
    })
    .to_string();

    let resp = send_authenticated(client, app, auth, |token_type, access_token| {
        client
            .post(GRAPHQL_URL)
            .header("Content-Type", "application/json")
            .header("User-Agent", GRAPHQL_USER_AGENT)
            .header("Authorization", format!("{} {}", token_type, access_token))
            .body(body.clone())
    })
    .await?;

    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "Epic GraphQL progress query returned HTTP {status}: {text}"
        ));
    }
    parse_progress_response(&text)
}

// ── Per-game orchestration ──────────────────────────────────────────

fn empty_epic_data(provider_id: Option<String>) -> GameAchievementData {
    GameAchievementData {
        steam_app_id: 0,
        achievements: Vec::new(),
        total: 0,
        unlocked: 0,
        locked: 0,
        last_synced: Some(now_secs()),
        source: "epic".to_string(),
        provider_id,
    }
}

/// Fetch + persist achievements for a single Epic game. Returns the
/// data and an optional soft note (set when the game legitimately has
/// no achievements — the UI can render "no achievements found" instead
/// of an error).
async fn fetch_game_achievements(
    client: &Client,
    app: &AppHandle,
    auth: &mut EpicAuth,
    game_id: &str,
) -> Result<(GameAchievementData, Option<String>), String> {
    // ── 1. Namespace mapping (GetAssets) ─────────────────────────────
    let namespace = match resolve_namespace(client, app, auth, game_id).await {
        Ok(Some(ns)) => ns,
        Ok(None) => {
            // No asset record with this AppName. The upstream plugin
            // falls back to `namespace = game_id`, which is almost
            // always wrong — we deliberately DON'T, and instead return
            // empty data + a soft note so the UI can show "no
            // achievements found".
            let note = format!(
                "No achievements found — '{}' is not in the Epic library asset list (AppName \
                 could not be mapped to a namespace).",
                game_id
            );
            eprintln!("[epic-achievements] {note}");
            return Ok((empty_epic_data(None), Some(note)));
        }
        Err(e) => return Err(e),
    };

    // ── 2. Achievement schema (GraphQL) ──────────────────────────────
    let locale = resolve_locale(app);
    let parsed = fetch_schema(client, app, auth, &namespace, &locale).await?;
    if parsed.product_id.is_empty() {
        // No product record at all for this namespace — treat as "no
        // achievements" rather than issuing a doomed progress query.
        let note = format!(
            "No achievements found — Epic returned no product record for namespace '{namespace}'."
        );
        eprintln!("[epic-achievements] {note}");
        return Ok((empty_epic_data(Some(namespace)), Some(note)));
    }

    // ── 3. Player progress (GraphQL) ─────────────────────────────────
    let account_id = auth.tokens.account_id.clone();
    let progress =
        fetch_progress(client, app, auth, &account_id, &parsed.product_id).await?;

    // ── 4 + 5. Merge + map to the shared Achievement shape ───────────
    let mut achievements = merge_progress(&parsed.achievements, &progress);
    sort_achievements(&mut achievements);

    let total = achievements.len() as u32;
    let unlocked = achievements.iter().filter(|a| a.achieved).count() as u32;
    let data = GameAchievementData {
        steam_app_id: 0,
        achievements,
        total,
        unlocked,
        locked: total - unlocked,
        last_synced: Some(now_secs()),
        source: "epic".to_string(),
        provider_id: Some(namespace.clone()),
    };

    // ── 6. Persist the cache row ─────────────────────────────────────
    let payload =
        serde_json::to_string(&data).map_err(|e| format!("serialize achievements: {e}"))?;
    let db_state = app
        .try_state::<db::Db>()
        .ok_or_else(|| "Database not initialized".to_string())?;
    db::achievements::upsert(
        db_state.inner(),
        game_id,
        0,
        &payload,
        now_secs(),
        "epic",
        Some(&namespace),
    )?;

    Ok((data, None))
}

/// Sort: unlocked first (newest first), then locked by rarity (rarest
/// first) — mirrors the Steam/local sort so the frontend gets a
/// consistent ordering across sources.
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

// ── Tauri command ───────────────────────────────────────────────────

/// Batch result shape helper: map a per-game outcome to a
/// `EpicAchievementResult`. A hard error ships `data = None`; a soft
/// note (game has no achievements) ships empty data plus the note.
fn result_from_outcome(
    game_id: String,
    outcome: Result<(GameAchievementData, Option<String>), String>,
) -> EpicAchievementResult {
    match outcome {
        Ok((data, note)) => EpicAchievementResult {
            game_id,
            data: Some(data),
            error: note,
        },
        Err(e) => EpicAchievementResult {
            game_id,
            data: None,
            error: Some(e),
        },
    }
}

/// Fetch Epic achievements for one or more games (game ids are Epic
/// AppNames). Auth failure fails every game with the same error;
/// per-game failures are tolerated and reported individually.
#[tauri::command]
pub async fn epic_fetch_achievements(
    app: AppHandle,
    game_ids: Vec<String>,
) -> Vec<EpicAchievementResult> {
    let client = match build_client() {
        Ok(c) => c,
        Err(e) => return error_for_all(game_ids, e),
    };
    let mut auth = match load_auth(&app) {
        Ok(a) => a,
        Err(e) => return error_for_all(game_ids, e),
    };

    let mut results = Vec::with_capacity(game_ids.len());
    for game_id in &game_ids {
        let outcome = fetch_game_achievements(&client, &app, &mut auth, game_id).await;
        results.push(result_from_outcome(game_id.clone(), outcome));
    }
    results
}

/// Every game id gets the same error (used for auth / client failures).
fn error_for_all(game_ids: Vec<String>, error: String) -> Vec<EpicAchievementResult> {
    game_ids
        .into_iter()
        .map(|game_id| result_from_outcome(game_id, Err(error.clone())))
        .collect()
}

fn resolve_locale(app: &AppHandle) -> String {
    let lang = app
        .try_state::<db::Db>()
        .and_then(|db_state| db::kv::get(db_state.inner(), "language").ok().flatten())
        .map(|s| s.trim_matches('"').to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "en".to_string());
    let short: String = lang.chars().take(2).collect();
    if short.is_empty() { "en".to_string() } else { short }
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

// ── Unit tests (hermetic — no network) ──────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    const SCHEMA_JSON: &str = r#"{
      "data": {
        "Achievement": {
          "productAchievementsRecordBySandbox": {
            "productId": "prod_123",
            "sandboxId": "fn",
            "totalAchievements": 3,
            "achievementSets": [],
            "achievements": [
              {
                "achievement": {
                  "sandboxId": "fn", "deploymentId": "d1", "name": "ach_1",
                  "hidden": false, "isBase": true, "achievementSetId": "base",
                  "unlockedDisplayName": "  First Achievement  ",
                  "lockedDisplayName": "???",
                  "unlockedDescription": "  Complete the first step.  ",
                  "lockedDescription": "Hidden",
                  "unlockedIconLink": "https://cdn.example/1.png",
                  "lockedIconLink": "https://cdn.example/1_gray.png",
                  "XP": 10, "flavorText": "Start here",
                  "rarity": { "percent": 12.5 }
                }
              },
              {
                "achievement": {
                  "sandboxId": "fn", "deploymentId": "d2", "name": "ach_2",
                  "hidden": false, "isBase": true, "achievementSetId": "base",
                  "unlockedDisplayName": "Second Achievement",
                  "lockedDisplayName": "???",
                  "unlockedDescription": "Complete the second step.",
                  "lockedDescription": "Hidden",
                  "unlockedIconLink": "https://cdn.example/2.png",
                  "lockedIconLink": "https://cdn.example/2_gray.png",
                  "XP": 20, "flavorText": "",
                  "rarity": { "percent": 80.0 }
                }
              },
              {
                "achievement": {
                  "sandboxId": "fn", "deploymentId": "d3", "name": "ach_3",
                  "hidden": true, "isBase": true, "achievementSetId": "base",
                  "unlockedDisplayName": "Third Achievement",
                  "lockedDisplayName": "???",
                  "unlockedDescription": "Complete the third step.",
                  "lockedDescription": "Hidden",
                  "unlockedIconLink": "https://cdn.example/3.png",
                  "lockedIconLink": "https://cdn.example/3_gray.png",
                  "XP": 30, "flavorText": "",
                  "rarity": { "percent": null }
                }
              }
            ]
          }
        }
      }
    }"#;

    const PROGRESS_JSON: &str = r#"{
      "data": {
        "PlayerProfile": {
          "playerProfile": {
            "epicAccountId": "acc_1",
            "displayName": "Tester",
            "relationship": "Self",
            "avatar": { "small": "s", "medium": "m", "large": "l" },
            "productAchievements": {
              "data": {
                "epicAccountId": "acc_1",
                "sandboxId": "fn",
                "totalXP": 30,
                "totalUnlocked": 2,
                "playerAchievements": [
                  {
                    "playerAchievement": {
                      "achievementName": "ach_1", "epicAccountId": "acc_1",
                      "progress": 100, "sandboxId": "fn", "unlocked": true,
                      "unlockDate": "2024-01-01T12:34:56.789Z",
                      "XP": 10, "achievementSetId": "base", "isBase": true
                    }
                  },
                  {
                    "playerAchievement": {
                      "achievementName": "ach_2", "epicAccountId": "acc_1",
                      "progress": 40, "sandboxId": "fn", "unlocked": false,
                      "unlockDate": null,
                      "XP": 20, "achievementSetId": "base", "isBase": true
                    }
                  },
                  {
                    "playerAchievement": {
                      "achievementName": "ach_3", "epicAccountId": "acc_1",
                      "progress": 100, "sandboxId": "fn", "unlocked": true,
                      "unlockDate": "garbage-date",
                      "XP": 30, "achievementSetId": "base", "isBase": true
                    }
                  }
                ]
              }
            }
          }
        }
      }
    }"#;

    fn schema_fixture() -> Vec<SchemaAchievement> {
        parse_schema_response(SCHEMA_JSON).unwrap().achievements
    }

    fn progress_fixture() -> Vec<ProgressAchievement> {
        parse_progress_response(PROGRESS_JSON).unwrap()
    }

    #[test]
    fn parse_schema_response_extracts_multi_achievement_schema() {
        let parsed = parse_schema_response(SCHEMA_JSON).unwrap();
        assert_eq!(parsed.product_id, "prod_123");
        assert_eq!(parsed.achievements.len(), 3);

        let first = &parsed.achievements[0];
        assert_eq!(first.name, "ach_1");
        assert_eq!(first.display_name, "First Achievement");
        assert_eq!(first.description, "Complete the first step.");
        assert_eq!(first.icon, "https://cdn.example/1.png");
        assert_eq!(first.icon_gray, "https://cdn.example/1_gray.png");
        assert!((first.percent - 12.5).abs() < f64::EPSILON);

        let third = &parsed.achievements[2];
        assert_eq!(third.percent, 0.0, "null rarity percent must map to 0.0");
    }

    #[test]
    fn parse_progress_response_extracts_nested_player_profile() {
        let progress = parse_progress_response(PROGRESS_JSON).unwrap();
        assert_eq!(progress.len(), 3);

        assert_eq!(progress[0].name, "ach_1");
        assert!(progress[0].unlocked);
        assert_eq!(
            progress[0].unlock_date.as_deref(),
            Some("2024-01-01T12:34:56.789Z")
        );

        assert!(!progress[1].unlocked);
        assert!(progress[1].unlock_date.is_none());

        assert!(progress[2].unlocked);
        assert_eq!(progress[2].unlock_date.as_deref(), Some("garbage-date"));
    }

    #[test]
    fn merge_marks_unlocked_with_valid_date() {
        let merged = merge_progress(&schema_fixture(), &progress_fixture());
        let ach1 = merged.iter().find(|a| a.api_name == "ach_1").unwrap();
        assert!(ach1.achieved);
        assert_eq!(ach1.unlock_time, 1_704_112_496);
        assert_eq!(ach1.display_name, "First Achievement");
        assert_eq!(ach1.percent, 12.5);
    }

    #[test]
    fn merge_treats_malformed_date_as_unlocked_at_zero() {
        let merged = merge_progress(&schema_fixture(), &progress_fixture());
        let ach3 = merged.iter().find(|a| a.api_name == "ach_3").unwrap();
        assert!(ach3.achieved);
        assert_eq!(ach3.unlock_time, 0);
    }

    #[test]
    fn merge_drops_unlocked_achievements_absent_from_schema() {
        let mut progress = progress_fixture();
        progress.push(ProgressAchievement {
            name: "ghost_ach".to_string(),
            unlocked: true,
            unlock_date: Some("2024-02-02T00:00:00.000Z".to_string()),
        });
        let merged = merge_progress(&schema_fixture(), &progress);
        assert_eq!(
            merged.len(),
            3,
            "unlocked-but-absent entries must not create rows"
        );
        assert!(merged.iter().all(|a| a.api_name != "ghost_ach"));
    }

    #[test]
    fn merge_keeps_locked_achievements_locked() {
        let merged = merge_progress(&schema_fixture(), &progress_fixture());
        let ach2 = merged.iter().find(|a| a.api_name == "ach_2").unwrap();
        assert!(!ach2.achieved);
        assert_eq!(ach2.unlock_time, 0);
    }

    #[test]
    fn parse_unlock_date_handles_valid_and_malformed() {
        assert_eq!(
            parse_unlock_date("2024-01-01T12:34:56.789Z"),
            Some(1_704_112_496)
        );
        assert_eq!(
            parse_unlock_date("2024-01-01T12:34:56Z"),
            Some(1_704_112_496)
        );
        assert_eq!(parse_unlock_date("2024-01-01T12:34:56"), Some(1_704_112_496));
        assert_eq!(
            parse_unlock_date("2024-01-01T12:34:56.789+02:00"),
            Some(1_704_105_296)
        );
        assert_eq!(parse_unlock_date("not-a-date"), None);
        assert_eq!(parse_unlock_date(""), None);
        assert_eq!(parse_unlock_date("2024-01-01"), None);
        assert_eq!(parse_unlock_date("2024-13-01T00:00:00Z"), None);
        assert_eq!(parse_unlock_date("2024-01-32T00:00:00Z"), None);
    }

    #[test]
    fn batch_result_shape_is_camel_case_on_the_wire() {
        let data = GameAchievementData {
            steam_app_id: 0,
            achievements: Vec::new(),
            total: 0,
            unlocked: 0,
            locked: 0,
            last_synced: Some(1234),
            source: "epic".to_string(),
            provider_id: Some("fn".to_string()),
        };

        let ok_entry = result_from_outcome("game_a".to_string(), Ok((data.clone(), None)));
        let noted_entry = result_from_outcome(
            "game_b".to_string(),
            Ok((data, Some("no achievements found".to_string()))),
        );
        let err_entry = result_from_outcome("game_c".to_string(), Err("boom".to_string()));

        assert_eq!(ok_entry.game_id, "game_a");
        assert!(ok_entry.data.is_some());
        assert!(ok_entry.error.is_none());

        assert_eq!(noted_entry.error.as_deref(), Some("no achievements found"));
        assert!(noted_entry.data.is_some());

        assert!(err_entry.data.is_none());
        assert_eq!(err_entry.error.as_deref(), Some("boom"));

        // Wire shape: camelCase keys (gameId/data/error).
        let json = serde_json::to_value(&ok_entry).unwrap();
        assert_eq!(json["gameId"].as_str(), Some("game_a"));
        assert!(json.get("data").is_some());
        assert!(json.get("error").is_some());
    }
}
