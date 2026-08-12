//! Manual achievement provider (L1b).
//!
//! Lets the user link a non-Steam library row to a public Steam appid
//! and track its achievements **by hand** — Steam is only used as the
//! schema source (display names / icons / descriptions), never for
//! unlock state. The active source is `"manual"`, the cache row stores
//! `steam_app_id = 0` (the provider identity lives in `provider_id` =
//! the appid as a string), and manual unlock state is persisted in the
//! `achievement_links` table via the links DAO.
//!
//! Steam schema fetch order (all anonymous/public — no auth required):
//!
//! 1. keyless `ISteamUserStats/GetSchemaForGame/v2` (works for public
//!    games),
//! 2. the same keyed call using the stored Steam API key (from the
//!    `steam_session` OS-keychain entry) when present.
//!
//! A schema is only used when it parses AND is non-empty; a failed or
//! empty refresh falls back to the previously-cached payload (mirrors
//! the plugin's "existing data retained on failed refresh" behavior).

use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::achievements::{Achievement, GameAchievementData};
use crate::db;
use crate::db::achievement_links::AchievementLink;

/// User-agent for Steam API requests (mirrors `achievements.rs`).
const USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/// The `source` tag used for manual rows in `achievement_links` and
/// `achievements_cache`.
const MANUAL_SOURCE: &str = "manual";

/// Max candidates returned by `manual_search_steam`.
const MAX_SEARCH_RESULTS: usize = 10;

// ── Serializable types ──────────────────────────────────────────────────

/// One Steam Store search candidate, mirrored to the frontend with
/// camelCase field names.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SteamSearchResult {
    pub appid: u32,
    pub name: String,
}

/// One manual unlock entry sent by the frontend's manual unlock editor.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualUnlock {
    pub api_name: String,
    pub unlock_time: u64,
}

// ── Steam API response types (private, for deserialization only) ──────

/// Shape of `https://store.steampowered.com/api/storesearch/` — the
/// same search endpoint `game_scraper::lookup_steam_app_id` uses.
#[derive(Debug, Deserialize)]
struct SteamSearchResponse {
    #[serde(default)]
    items: Vec<SteamSearchItem>,
}

#[derive(Debug, Deserialize)]
struct SteamSearchItem {
    id: u64,
    name: String,
}

/// Shape of `ISteamUserStats/GetSchemaForGame/v2` (same field layout
/// as `achievements.rs`).
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

// ── Pure helpers (unit-testable, no network / no Tauri) ────────────────

/// Parse a raw `GetSchemaForGame/v2` response body into schema rows.
///
/// Every row comes back `achieved=false`, `unlock_time=0`, and
/// `percent=0.0` — Steam's schema carries no global rarity, and manual
/// sources never display rarity (the frontend skips it). Hidden
/// achievements get the masked description exactly like the Steam
/// path in `achievements.rs` (`hidden == 1 && !achieved`), and every
/// schema row is `!achieved` by definition.
///
/// A parseable-but-empty body (no `game`, or no `availableGameStats`)
/// yields an empty list — callers treat that as "fall through to the
/// next schema source".
pub fn parse_schema_response(json: &str) -> Result<Vec<Achievement>, String> {
    let parsed: SchemaResponse =
        serde_json::from_str(json).map_err(|e| format!("Failed to parse schema response: {e}"))?;
    let achievements = parsed
        .game
        .and_then(|g| g.available_game_stats)
        .map(|s| s.achievements)
        .unwrap_or_default();
    Ok(achievements
        .into_iter()
        .map(|sa| Achievement {
            api_name: sa.name,
            display_name: sa.display_name,
            description: if sa.hidden == 1 {
                "Hidden achievement".to_string()
            } else {
                sa.description
            },
            icon: sa.icon,
            icon_gray: sa.icongray,
            achieved: false,
            unlock_time: 0,
            percent: 0.0,
        })
        .collect())
}

/// Overlay the persisted manual-unlock map onto a fetched schema and
/// recompute the counters.
///
/// Matching uses the **uppercased** api name — the same normalization
/// as `db::achievements::union_achieved_into` — and the earliest known
/// unlock time wins. Stored unlocks whose api name is not in the schema
/// are ignored (not an error).
///
/// The returned payload is tagged `source="manual"` with
/// `steam_app_id=0` (the provider identity is attached separately as
/// `provider_id` by the persistence caller).
pub fn build_payload_from_schema(
    schema: Vec<Achievement>,
    unlocks: &HashMap<String, i64>,
) -> GameAchievementData {
    let mut achievements = schema;
    let mut unlocked_count = 0u32;

    // Normalize the unlock map to UPPERCASE keys up front — the
    // persisted map stores whatever case the frontend sent, while
    // matching happens on the uppercased api name (same dual-side
    // normalization as `db::achievements::union_achieved_into`).
    let normalized: HashMap<String, i64> = unlocks
        .iter()
        .map(|(k, v)| (k.to_uppercase(), *v))
        .collect();

    for ach in achievements.iter_mut() {
        let key = ach.api_name.to_uppercase();
        if let Some(&t) = normalized.get(&key) {
            if t > 0 {
                ach.achieved = true;
                // Earliest unlock time wins (defensive: schema rows are
                // always 0, but a re-sync must never move a timestamp
                // backwards).
                ach.unlock_time = if ach.unlock_time == 0 {
                    t as u64
                } else {
                    ach.unlock_time.min(t as u64)
                };
            }
        }
        if ach.achieved {
            unlocked_count += 1;
        }
    }

    // Unlocked first (newest unlock first), then locked rows ordered by
    // api name. The Steam path sorts locked rows by rarity; manual
    // schemas carry `percent = 0.0` (unknown), so name order is the
    // only meaningful deterministic ordering.
    achievements.sort_by(|a, b| match (a.achieved, b.achieved) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        (true, true) => b.unlock_time.cmp(&a.unlock_time),
        (false, false) => a.api_name.cmp(&b.api_name),
    });

    let total = achievements.len() as u32;
    GameAchievementData {
        steam_app_id: 0,
        achievements,
        total,
        unlocked: unlocked_count,
        locked: total - unlocked_count,
        last_synced: Some(now_secs()),
        source: MANUAL_SOURCE.to_string(),
        provider_id: None,
    }
}

/// Rank Steam Store search candidates: exact (case-insensitive) name
/// match first, then name-prefix matches, then Steam's native
/// relevance order (preserved within each bucket via a stable sort).
/// Truncated to `MAX_SEARCH_RESULTS`.
fn rank_search_results(
    items: Vec<SteamSearchItem>,
    query: &str,
) -> Vec<SteamSearchResult> {
    let q = normalize_for_match(query);
    let mut ranked: Vec<(u8, SteamSearchItem)> = items
        .into_iter()
        .map(|item| {
            let n = normalize_for_match(&item.name);
            let score = if !q.is_empty() && n == q {
                0
            } else if !q.is_empty() && n.starts_with(&q) {
                1
            } else {
                2
            };
            (score, item)
        })
        .collect();
    // `sort_by_key` is stable — Steam's relevance order survives
    // within each score bucket.
    ranked.sort_by_key(|(score, _)| *score);
    ranked
        .into_iter()
        .take(MAX_SEARCH_RESULTS)
        .map(|(_, item)| SteamSearchResult {
            appid: item.id as u32,
            name: item.name,
        })
        .collect()
}

/// Normalize a name for comparison: lowercase, split on whitespace,
/// strip surrounding non-alphanumerics (same rule as
/// `game_scraper::lookup_steam_app_id`).
fn normalize_for_match(s: &str) -> String {
    s.to_lowercase()
        .split_whitespace()
        .map(|t| t.trim_matches(|c: char| !c.is_alphanumeric()))
        .filter(|t| !t.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Simple URL encoding (only safe chars pass through) — mirrors the
/// helper `game_scraper` uses for the same endpoint.
fn url_encode(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    for byte in s.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                result.push(byte as char);
            }
            b' ' => result.push_str("%20"),
            _ => {
                result.push_str(&format!("%{:02X}", byte));
            }
        }
    }
    result
}

fn build_client() -> Result<Client, String> {
    Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))
}

// ── Schema fetch (Steam keyless → Steam keyed) ─────────────────────────

/// Fetch one `GetSchemaForGame/v2` URL and parse it into schema rows.
async fn fetch_schema_once(client: &Client, url: String) -> Result<Vec<Achievement>, String> {
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Schema request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!(
            "Schema API returned HTTP {}",
            resp.status().as_u16()
        ));
    }
    let body = resp.text().await.unwrap_or_else(|_| "{}".to_string());
    parse_schema_response(&body)
}

/// Fetch the public Steam achievement schema for an appid with the
/// fallback chain: keyless `GetSchemaForGame/v2` (public games) →
/// keyed `GetSchemaForGame/v2` via the stored Steam API key (the same
/// call `achievements.rs` builds).
///
/// Each stage is only tried when the previous one failed or returned
/// an empty list; every returned row is `achieved=false` /
/// `unlock_time=0` / `percent=0.0`.
pub async fn fetch_schema_with_fallback(
    client: &Client,
    appid: u32,
) -> Result<Vec<Achievement>, String> {
    let keyless_url = format!(
        "https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/\
         ?appid={appid}&l=english&format=json"
    );
    if let Ok(schema) = fetch_schema_once(client, keyless_url).await {
        if !schema.is_empty() {
            return Ok(schema);
        }
    }

    if let Some(api_key) = crate::achievements::stored_steam_api_key() {
        let keyed_url = format!(
            "https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/\
             ?key={api_key}&appid={appid}&l=english&format=json"
        );
        if let Ok(schema) = fetch_schema_once(client, keyed_url).await {
            if !schema.is_empty() {
                return Ok(schema);
            }
        }
    }

    // Anonymous fallback: the Steam Community achievements page — the
    // keyless GetSchemaForGame/v2 returns HTTP 400, so this page is the
    // no-key source for the manual link flow too.
    crate::achievements::fetch_steam_community_schema(client, appid, "english").await
}

// ── Link DAO helpers (temp-db testable) ─────────────────────────────────

/// Upsert the `manual` link row for a game: `provider_id` = the appid
/// as a string, `display_name` = the game name, and `source_url` = the
/// Steam Community stats page.
///
/// Re-upserting the **same** appid preserves the persisted manual-unlock
/// map (e.g. a display-name edit must not wipe the user's unlock data).
/// Re-linking to a **different** appid starts fresh: api names from the
/// old game are meaningless on the new one, and the links DAO's
/// `update_manual_unlocks` merge is monotonic (stale entries could
/// never be removed otherwise).
pub fn upsert_manual_link(
    db: &db::Db,
    game_id: &str,
    appid: u32,
    name: Option<String>,
) -> Result<AchievementLink, String> {
    let appid_str = appid.to_string();
    let existing = db::achievement_links::get_links_for_game(db, game_id)?
        .into_iter()
        .find(|l| l.source == MANUAL_SOURCE);
    let manual_unlocks = match &existing {
        Some(l) if l.provider_id.as_deref() == Some(appid_str.as_str()) => {
            l.manual_unlocks.clone()
        }
        _ => None,
    };

    let link = AchievementLink {
        game_id: game_id.to_string(),
        source: MANUAL_SOURCE.to_string(),
        provider_id: Some(appid_str),
        display_name: name,
        source_url: Some(format!(
            "https://steamcommunity.com/stats/{appid}/achievements"
        )),
        manual_unlocks,
        created_at: 0,
        updated_at: 0,
    };
    db::achievement_links::upsert_link(db, &link)?;
    db::achievement_links::get_links_for_game(db, game_id)?
        .into_iter()
        .find(|l| l.source == MANUAL_SOURCE)
        .ok_or_else(|| "manual link not found after upsert".to_string())
}

/// Delete the `manual` link row for a game (only the manual source —
/// other sources' links are untouched).
pub fn remove_manual_link(db: &db::Db, game_id: &str) -> Result<(), String> {
    db::achievement_links::delete_link(db, game_id, MANUAL_SOURCE)
}

/// Resolve the appid from the game's `manual` link row.
fn manual_link_appid(db: &db::Db, game_id: &str) -> Result<u32, String> {
    db::achievement_links::get_links_for_game(db, game_id)?
        .iter()
        .find(|l| l.source == MANUAL_SOURCE)
        .and_then(|l| l.provider_id.as_deref())
        .and_then(|p| p.parse::<u32>().ok())
        .ok_or_else(|| {
            format!("No manual achievement link for game '{game_id}' — link it to a Steam app first")
        })
}

/// Build the manual payload from a fetched schema + unlock map and
/// persist it to the cache row (`source="manual"`,
/// `provider_id=<appid>`, `steam_app_id=0`). Returns the payload.
fn persist_manual_payload(
    db: &db::Db,
    game_id: &str,
    appid: u32,
    schema: Vec<Achievement>,
    unlocks: &HashMap<String, i64>,
) -> Result<GameAchievementData, String> {
    let provider_id = appid.to_string();
    let mut data = build_payload_from_schema(schema, unlocks);
    data.provider_id = Some(provider_id.clone());
    let payload = serde_json::to_string(&data).map_err(|e| e.to_string())?;
    db::achievements::upsert(
        db,
        game_id,
        0,
        &payload,
        now_secs(),
        MANUAL_SOURCE,
        Some(&provider_id),
    )?;
    Ok(data)
}

/// Shared save/rebuild step: fetch the schema (fallback chain), reject
/// empty schemas, overlay the unlock map, persist, return the payload.
async fn rebuild_manual_payload(
    db: &db::Db,
    game_id: &str,
    appid: u32,
    unlocks: HashMap<String, i64>,
) -> Result<GameAchievementData, String> {
    let client = build_client()?;
    let schema = fetch_schema_with_fallback(&client, appid).await?;
    if schema.is_empty() {
        return Err("Steam returned no achievements for this appid".to_string());
    }
    persist_manual_payload(db, game_id, appid, schema, &unlocks)
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

// ── Tauri commands ──────────────────────────────────────────────────────

/// Search the Steam Store for candidate games by name (up to
/// `MAX_SEARCH_RESULTS` ranked results), so the user can pick the
/// appid to link a manual game to. Reuses the same
/// `store.steampowered.com/api/storesearch/` endpoint as
/// `game_scraper::lookup_steam_app_id`, but returns ranked candidates
/// instead of a single strict guess.
#[tauri::command]
pub async fn manual_search_steam(query: String) -> Result<Vec<SteamSearchResult>, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    let client = build_client()?;
    let url = format!(
        "https://store.steampowered.com/api/storesearch/?term={}&l=english&cc=us",
        url_encode(trimmed)
    );
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Steam store search request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!(
            "Steam store search returned HTTP {}",
            resp.status().as_u16()
        ));
    }
    let body = resp.text().await.unwrap_or_else(|_| "{}".to_string());
    let data: SteamSearchResponse = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse Steam store search: {e}"))?;
    Ok(rank_search_results(data.items, trimmed))
}

/// Create or update the `manual` achievement link for a game.
#[tauri::command]
pub fn manual_link_create(
    app: tauri::AppHandle,
    game_id: String,
    appid: u32,
    name: Option<String>,
) -> Result<AchievementLink, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    upsert_manual_link(db_state.inner(), &game_id, appid, name)
}

/// Remove the `manual` achievement link for a game.
#[tauri::command]
pub fn manual_link_remove(app: tauri::AppHandle, game_id: String) -> Result<(), String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    remove_manual_link(db_state.inner(), &game_id)
}

/// Fetch the public Steam achievement schema for an appid (no auth
/// needed — keyless Steam first, keyed Steam from the stored API key),
/// mapped to `Achievement` rows with no unlock state.
#[tauri::command]
pub async fn manual_fetch_schema(
    _app: tauri::AppHandle,
    appid: u32,
) -> Result<Vec<Achievement>, String> {
    let client = build_client()?;
    fetch_schema_with_fallback(&client, appid).await
}

/// Save the user's manual unlock editor state: persist the unlock map
/// via the links DAO (monotonic merge — the union never removes an
/// already-unlocked achievement), rebuild the payload from the fetched
/// schema, and return it.
#[tauri::command]
pub async fn manual_save_unlocks(
    app: tauri::AppHandle,
    game_id: String,
    unlocks: Vec<ManualUnlock>,
) -> Result<GameAchievementData, String> {
    let db = {
        let db_state: tauri::State<'_, db::Db> = app.state();
        db_state.inner().clone()
    };

    // The provider identity comes from the persisted manual link.
    let appid = manual_link_appid(&db, &game_id)?;

    // Persist the unlock map. `update_manual_unlocks` merges into the
    // stored map (union semantics) and returns the merged result.
    let map: HashMap<String, i64> = unlocks
        .iter()
        .map(|u| (u.api_name.clone(), u.unlock_time as i64))
        .collect();
    let merged = db::achievement_links::update_manual_unlocks(&db, &game_id, MANUAL_SOURCE, &map)?;

    rebuild_manual_payload(&db, &game_id, appid, merged).await
}

/// Manual-source refresh path: read the manual link + stored unlocks,
/// fetch the schema, overlay, and persist. If the schema fetch fails
/// or comes back empty, the existing cached payload is kept (mirrors
/// the plugin's "existing data retained on failed refresh"); that only
/// applies when the existing row is itself `source="manual"`.
#[tauri::command]
pub async fn manual_sync(
    app: tauri::AppHandle,
    game_id: String,
) -> Result<GameAchievementData, String> {
    let db = {
        let db_state: tauri::State<'_, db::Db> = app.state();
        db_state.inner().clone()
    };

    let appid = manual_link_appid(&db, &game_id)?;
    let unlocks = db::achievement_links::read_manual_unlocks(&db, &game_id, MANUAL_SOURCE)?
        .unwrap_or_default();

    let client = build_client()?;
    match fetch_schema_with_fallback(&client, appid).await {
        Ok(schema) if !schema.is_empty() => {
            persist_manual_payload(&db, &game_id, appid, schema, &unlocks)
        }
        _ => {
            // Keep the existing cached payload on a failed/empty refresh.
            let existing = db::achievements::get(&db, &game_id)?.ok_or_else(|| {
                format!("No cached achievements for game '{game_id}' and the schema refresh failed")
            })?;
            if existing.3 != MANUAL_SOURCE {
                return Err(format!(
                    "Cached achievements for game '{game_id}' are not from the manual source \
                     (source='{}') — refusing to serve them as manual data",
                    existing.3
                ));
            }
            let payload: GameAchievementData = serde_json::from_str(&existing.1)
                .map_err(|e| format!("parse cached payload: {e}"))?;
            Ok(payload)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::{ACHIEVEMENTS_DDL, ACHIEVEMENTS_V2_DDL};

    /// Open a temp achievements DB with both schema migrations applied
    /// (same pattern as `db::achievement_links` tests).
    fn test_db() -> (tempfile::TempDir, db::Db) {
        let dir = tempfile::tempdir().unwrap();
        let db = db::Db::open(dir.path()).unwrap();
        let c = db.achievements().unwrap();
        c.execute_batch(ACHIEVEMENTS_DDL).unwrap();
        c.execute_batch(ACHIEVEMENTS_V2_DDL).unwrap();
        (dir, db)
    }

    fn achievement(api_name: &str, display_name: &str, unlock_time: u64) -> Achievement {
        Achievement {
            api_name: api_name.to_string(),
            display_name: display_name.to_string(),
            description: "desc".to_string(),
            icon: String::new(),
            icon_gray: String::new(),
            achieved: false,
            unlock_time,
            percent: 0.0,
        }
    }

    // ── parse_schema_response ─────────────────────────────────────────

    #[test]
    fn parse_schema_response_maps_steam_schema() {
        let json = r#"{
            "game": {
                "gameName": "Test Game",
                "availableGameStats": {
                    "achievements": [
                        {
                            "name": "KILL_10",
                            "defaultvalue": 0,
                            "displayName": "Kill 10 enemies",
                            "hidden": 0,
                            "description": "Kill ten enemies",
                            "icon": "https://cdn.example/kill.jpg",
                            "icongray": "https://cdn.example/kill_gray.jpg"
                        },
                        {
                            "name": "SECRET",
                            "displayName": "Secret",
                            "hidden": 1,
                            "description": "Should be masked",
                            "icon": "",
                            "icongray": ""
                        }
                    ]
                }
            }
        }"#;
        let list = parse_schema_response(json).unwrap();
        assert_eq!(list.len(), 2);

        let kill = &list[0];
        assert_eq!(kill.api_name, "KILL_10");
        assert_eq!(kill.display_name, "Kill 10 enemies");
        assert_eq!(kill.description, "Kill ten enemies");
        assert_eq!(kill.icon, "https://cdn.example/kill.jpg");
        assert_eq!(kill.icon_gray, "https://cdn.example/kill_gray.jpg");
        assert!(!kill.achieved, "schema rows are never pre-unlocked");
        assert_eq!(kill.unlock_time, 0);
        assert_eq!(kill.percent, 0.0, "manual schemas carry no rarity");

        // Hidden + (always) locked → masked description, same rule as
        // achievements.rs:371.
        assert_eq!(list[1].description, "Hidden achievement");
    }

    #[test]
    fn parse_schema_response_missing_game_is_empty_not_error() {
        assert!(parse_schema_response(r#"{"game":{}}"#).unwrap().is_empty());
        assert!(parse_schema_response(r#"{"error":"Invalid API key"}"#)
            .unwrap()
            .is_empty());
        assert!(parse_schema_response("not json").is_err());
    }

    // ── build_payload_from_schema ─────────────────────────────────────

    #[test]
    fn build_payload_overlay_uses_uppercased_api_name() {
        let schema = vec![
            achievement("Kill", "Kill", 0),
            achievement("kill_x", "Kill X", 0),
            achievement("Achieve_One", "One", 0),
        ];
        let unlocks = HashMap::from([
            ("KILL".to_string(), 1000i64),
            ("achieve_one".to_string(), 2000i64),
            ("no_such_ach".to_string(), 500i64),
        ]);

        let data = build_payload_from_schema(schema, &unlocks);
        let by_name = |n: &str| data.achievements.iter().find(|a| a.api_name == n).unwrap();
        assert!(by_name("Kill").achieved, "uppercase KILL matches lowercase schema name");
        assert_eq!(by_name("Kill").unlock_time, 1000);
        assert!(!by_name("kill_x").achieved, "kill_x has no matching unlock");
        assert!(by_name("Achieve_One").achieved, "uppercase ACHIEVE_ONE matches");
        assert_eq!(data.unlocked, 2);
        assert_eq!(data.locked, 1);
        assert_eq!(data.total, 3);
        assert_eq!(data.source, "manual");
        assert_eq!(data.steam_app_id, 0, "manual payloads always carry steam_app_id=0");
        assert!(data.provider_id.is_none(), "provider_id attached by the persistence step");
    }

    #[test]
    fn build_payload_earliest_unlock_time_wins() {
        // A schema row that somehow carries a prior unlock keeps it over
        // a later manual entry...
        let schema = vec![Achievement {
            api_name: "OLD".into(),
            display_name: "Old".into(),
            description: "d".into(),
            icon: String::new(),
            icon_gray: String::new(),
            achieved: true,
            unlock_time: 1000,
            percent: 0.0,
        }];
        let later = HashMap::from([("OLD".to_string(), 9000i64)]);
        let data = build_payload_from_schema(schema, &later);
        assert_eq!(data.achievements[0].unlock_time, 1000, "later entry does not move the time forward");

        // ...and a freshly-fetched row takes the map's time directly.
        let schema = vec![achievement("NEW", "New", 0)];
        let earlier = HashMap::from([("NEW".to_string(), 500i64)]);
        let data = build_payload_from_schema(schema, &earlier);
        assert_eq!(data.achievements[0].unlock_time, 500);
    }

    #[test]
    fn build_payload_zero_unlock_time_is_ignored() {
        let schema = vec![achievement("ACH", "Ach", 0)];
        let zero = HashMap::from([("ACH".to_string(), 0i64)]);
        let data = build_payload_from_schema(schema, &zero);
        assert!(!data.achievements[0].achieved, "unlock_time 0 means not unlocked");
        assert_eq!(data.unlocked, 0);
    }

    // ── rank_search_results ───────────────────────────────────────────

    #[test]
    fn rank_search_results_prioritizes_exact_and_prefix() {
        let items = vec![
            SteamSearchItem { id: 10, name: "Halo: Combat Evolved".into() },
            SteamSearchItem { id: 20, name: "Halo Wars".into() },
            SteamSearchItem { id: 30, name: "Halo".into() },
            SteamSearchItem { id: 40, name: "Halo Infinite".into() },
        ];
        let ranked = rank_search_results(items, "Halo");
        let names: Vec<&str> = ranked.iter().map(|r| r.name.as_str()).collect();
        // Exact match first; prefix matches keep Steam's relevance order.
        assert_eq!(names, vec!["Halo", "Halo: Combat Evolved", "Halo Wars", "Halo Infinite"]);
        assert_eq!(ranked[0].appid, 30);
    }

    #[test]
    fn rank_search_results_caps_at_ten() {
        let items = (0..20)
            .map(|i| SteamSearchItem { id: i as u64, name: format!("Game {i}") })
            .collect();
        let ranked = rank_search_results(items, "game");
        assert_eq!(ranked.len(), 10);
    }

    // ── link DAO helpers (temp-db) ────────────────────────────────────

    #[test]
    fn manual_link_round_trip() {
        let (_dir, db) = test_db();
        let link = upsert_manual_link(&db, "game-1", 440, Some("Team Fortress 2".into())).unwrap();
        assert_eq!(link.source, "manual");
        assert_eq!(link.provider_id.as_deref(), Some("440"));
        assert_eq!(link.display_name.as_deref(), Some("Team Fortress 2"));
        assert_eq!(
            link.source_url.as_deref(),
            Some("https://steamcommunity.com/stats/440/achievements")
        );
        assert!(link.created_at > 0, "created_at stamped on insert");

        // Re-upsert of the SAME appid preserves persisted unlocks.
        db::achievement_links::update_manual_unlocks(
            &db,
            "game-1",
            "manual",
            &HashMap::from([("WIN_1".to_string(), 1000i64)]),
        )
        .unwrap();
        let again = upsert_manual_link(&db, "game-1", 440, Some("TF2".into())).unwrap();
        assert_eq!(again.manual_unlocks.as_ref().unwrap().get("WIN_1"), Some(&1000i64));

        // Re-link to a DIFFERENT appid starts fresh — stale unlocks drop.
        let relinked = upsert_manual_link(&db, "game-1", 730, None).unwrap();
        assert_eq!(relinked.provider_id.as_deref(), Some("730"));
        assert!(relinked.manual_unlocks.is_none());

        // Only the manual source is removed.
        db::achievement_links::upsert_link(
            &db,
            &AchievementLink {
                game_id: "game-1".into(),
                source: "retro".into(),
                provider_id: Some("other".into()),
                display_name: None,
                source_url: None,
                manual_unlocks: None,
                created_at: 0,
                updated_at: 0,
            },
        )
        .unwrap();
        remove_manual_link(&db, "game-1").unwrap();
        let links = db::achievement_links::get_links_for_game(&db, "game-1").unwrap();
        assert_eq!(links.len(), 1, "non-manual links untouched");
        assert_eq!(links[0].source, "retro");
    }

    #[test]
    fn manual_link_appid_requires_a_manual_link() {
        let (_dir, db) = test_db();
        assert!(manual_link_appid(&db, "no-link").is_err());
        upsert_manual_link(&db, "game-1", 440, None).unwrap();
        assert_eq!(manual_link_appid(&db, "game-1").unwrap(), 440);
    }

    // ── payload persistence ───────────────────────────────────────────

    #[test]
    fn persist_manual_payload_writes_manual_cache_row() {
        let (_dir, db) = test_db();
        let schema = vec![
            achievement("ALPHA", "Alpha", 0),
            achievement("BETA", "Beta", 0),
            achievement("GAMMA", "Gamma", 0),
        ];
        let unlocks = HashMap::from([("alpha".to_string(), 111i64)]);
        let data = persist_manual_payload(&db, "game-1", 440, schema, &unlocks).unwrap();
        assert_eq!(data.unlocked, 1);
        assert_eq!(data.locked, 2);
        assert_eq!(data.total, 3);
        assert_eq!(data.provider_id.as_deref(), Some("440"));
        assert_eq!(data.source, "manual");
        // Unlocked rows sort first; ALPHA is the unlocked one.
        assert!(data.achievements[0].achieved);
        assert_eq!(data.achievements[0].api_name, "ALPHA");
        assert_eq!(data.achievements[0].unlock_time, 111);

        let cached = db::achievements::get(&db, "game-1").unwrap().unwrap();
        assert_eq!(cached.0, 0, "manual cache rows store steam_app_id=0");
        assert_eq!(cached.3, "manual");
        assert_eq!(cached.4.as_deref(), Some("440"));
        let parsed: GameAchievementData = serde_json::from_str(&cached.1).unwrap();
        assert_eq!(parsed.unlocked, 1);
        assert_eq!(parsed.locked, 2);
    }

    #[test]
    fn update_manual_unlocks_merge_semantics_are_monotonic() {
        // Verify the DAO contract `manual_save_unlocks` relies on: the
        // union never removes an already-unlocked achievement, and a
        // later save's value for an existing key wins.
        let (_dir, db) = test_db();
        upsert_manual_link(&db, "game-2", 440, None).unwrap();
        db::achievement_links::update_manual_unlocks(
            &db,
            "game-2",
            "manual",
            &HashMap::from([("A".to_string(), 1000i64), ("B".to_string(), 2000i64)]),
        )
        .unwrap();
        // Frontend sends the full set again; a removed entry must not
        // drop from the store.
        let merged = db::achievement_links::update_manual_unlocks(
            &db,
            "game-2",
            "manual",
            &HashMap::from([("B".to_string(), 3000i64)]),
        )
        .unwrap();
        assert_eq!(merged.len(), 2, "old unlocks never dropped");
        assert_eq!(merged.get("A"), Some(&1000i64));
        assert_eq!(merged.get("B"), Some(&3000i64));
    }
}
