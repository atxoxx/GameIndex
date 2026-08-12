//! GOG Galaxy achievements (L1c) — `gameplay.gog.com` achievements sync.
//!
//! Auth: OAuth access tokens live in the SQLite `kv_store` under key
//! `gog_tokens` (written by `gog::auth`). Every request carries
//! `Authorization: Bearer <access_token>` via the shared `GogClient`.
//! There is NO token-refresh flow here — an expired token surfaces as
//! a "reconnect your GOG account" error (out of scope for this lane).
//!
//! Flow per batch (mirrors `gog::sync::gog_sync_library` auth assembly):
//!   1. Load tokens once via `auth::load_tokens` (no refresh).
//!   2. Build the shared `GogClient` from the access token (+ optional
//!      session-cookie jar, exactly as `gog_sync_library` does).
//!   3. Probe `menu.gog.com/v1/account/basic` once for the numeric
//!      `user_id` used in the achievements URL.
//!   4. Per game: GET
//!      `https://gameplay.gog.com/clients/{gameId}/users/{userId}/achievements`
//!      (first page only; 401 / access_denied → 5s sleep + one retry),
//!      map items to the shared `Achievement` shape, persist a cache row
//!      (`source="gog"`, `provider_id=gameId`, `steam_app_id=0`).
//!      Per-game failures are tolerated — the batch keeps going.
//!
//! Endpoint + response shape are verbatim from the CommonPluginsStores
//! plugin. Counts derive from the item list, never from `total_count`.

use std::time::Duration;

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

use super::auth;
use super::client::GogClient;
use super::cookies;
use crate::achievements::{Achievement, GameAchievementData};
use crate::db;

/// Browser UA for the achievements endpoint — verbatim from the
/// CommonPluginsStores plugin (Chrome/131 desktop profile). Overrides
/// the shared client's default UA per-request.
const GOG_ACHIEVEMENTS_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/// How long to wait before the single retry after a 401 / access_denied.
const RETRY_DELAY: Duration = Duration::from_secs(5);

// ── Serializable types ──────────────────────────────────────────────────

/// Per-game result of a GOG achievements fetch. `data` is present on
/// success; a hard failure (auth, HTTP error, delisted game, cache
/// write) returns `data = None` plus the error text. Auth failures
/// fill every game with the same error.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GogAchievementResult {
    pub game_id: String,
    pub data: Option<GameAchievementData>,
    pub error: Option<String>,
}

// ── Response types (private, for deserialization only) ─────────────────
//
// The endpoint returns snake_case keys (`image_url_unlocked`,
// `date_unlocked`, ...). GOG's API ships a camelCase variant elsewhere
// but the authoritative plugin reads snake_case, so we parse that.

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct GogAchievementsResponse {
    /// Gate: we only consume the response when this is > 0.
    total_count: u32,
    #[serde(default)]
    items: Vec<GogAchievementItem>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct GogAchievementItem {
    #[serde(default)]
    achievement_key: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    image_url_unlocked: Option<String>,
    #[serde(default)]
    image_url_locked: Option<String>,
    /// Global unlock percentage (0–100). Tolerant deserializer — GOG
    /// has shipped numbers, strings, and nulls for rarity-ish fields
    /// across endpoints; null/missing/malformed becomes 0.0.
    #[serde(default, deserialize_with = "deserialize_percent")]
    rarity: f64,
    /// Null for locked achievements; RFC3339 (`2024-01-01T12:00:00Z`)
    /// for unlocked ones.
    #[serde(default)]
    date_unlocked: Option<String>,
}

// ── Pure parse helpers (unit-tested, no network) ────────────────────────

/// Parse the achievements endpoint response into the shared `Achievement`
/// shape. Gates on `total_count > 0` — a valid response with zero
/// achievements yields an empty list (the caller still persists a
/// "no achievements" row instead of failing the batch).
///
/// Mapping (verbatim from the plugin):
/// `api_name=achievement_key`, `display_name=name.trim()`,
/// `description=description.trim()`, `icon=image_url_unlocked`,
/// `icon_gray=image_url_locked`, `achieved=date_unlocked.is_some()`,
/// `unlock_time=epoch(date_unlocked)` (0 when locked),
/// `percent=rarity`. Empty-string icons are stored as-is.
fn parse_achievements_response(json: &str) -> Result<Vec<Achievement>, String> {
    let response: GogAchievementsResponse = serde_json::from_str(json)
        .map_err(|e| format!("Failed to parse GOG achievements response: {e}"))?;
    if response.total_count == 0 {
        return Ok(Vec::new());
    }
    Ok(response
        .items
        .into_iter()
        .map(|item| {
            let achieved = item.date_unlocked.is_some();
            let unlock_time = if achieved {
                item.date_unlocked
                    .as_deref()
                    .and_then(parse_unlock_date)
                    .unwrap_or(0)
            } else {
                0
            };
            Achievement {
                api_name: item.achievement_key.unwrap_or_default(),
                display_name: item.name.unwrap_or_default().trim().to_string(),
                description: item.description.unwrap_or_default().trim().to_string(),
                icon: item.image_url_unlocked.unwrap_or_default(),
                icon_gray: item.image_url_locked.unwrap_or_default(),
                achieved,
                unlock_time,
                percent: item.rarity,
            }
        })
        .collect())
}

/// Assemble the `GameAchievementData` cache payload for one game.
/// Counts are derived from the item list (never `total_count`).
fn build_data(game_id: &str, mut achievements: Vec<Achievement>, now: u64) -> GameAchievementData {
    sort_achievements(&mut achievements);
    let total = achievements.len() as u32;
    let unlocked = achievements.iter().filter(|a| a.achieved).count() as u32;
    GameAchievementData {
        steam_app_id: 0,
        achievements,
        total,
        unlocked,
        locked: total - unlocked,
        last_synced: Some(now),
        source: "gog".to_string(),
        provider_id: Some(game_id.to_string()),
    }
}

/// Tolerant percent deserializer: number, string, or anything else
/// (null / missing) → a finite f64 in 0–100 (non-finite coerced to 0.0).
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
        _ => Ok(0.0),
    }?;
    Ok(if n.is_finite() { n } else { 0.0 })
}

/// Parse GOG's RFC3339 unlock date (`2024-01-01T12:00:00Z`, with or
/// without fractional seconds / numeric offsets) into a unix timestamp
/// in seconds. Fully defensive: any malformed input returns `None` so
/// the caller keeps the achievement unlocked with time 0.
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

/// Sort: unlocked first (newest first), then locked by rarity (rarest
/// first) — mirrors the Steam/local/epic sort so the frontend gets a
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

// ── HTTP plumbing (reuses the shared GogClient — no second client) ─────

/// Load persisted GOG session cookies and build a reqwest jar, mirroring
/// `gog::sync::load_cookie_jar` (the achievements endpoint is Bearer-auth
/// only, but carrying the jar is harmless and keeps the assembly
/// identical to `gog_sync_library`).
fn load_cookie_jar(app: &AppHandle) -> Option<std::sync::Arc<reqwest::cookie::Jar>> {
    let db_state = app.try_state::<db::Db>()?;
    let cookies = cookies::load(db_state.inner())?;
    match cookies::arc_jar_from(&cookies) {
        Ok(jar) => {
            eprintln!(
                "[gog-achievements] built cookie jar from {} records",
                cookies.records.len()
            );
            Some(jar)
        }
        Err(e) => {
            eprintln!("[gog-achievements] failed to build cookie jar: {e}");
            None
        }
    }
}

/// Truncate an error/HTML body for log messages without risking a
/// mid-UTF8 panic from byte-slicing.
fn body_preview(body: &str) -> String {
    body.chars().take(200).collect()
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

// ── Per-game orchestration ─────────────────────────────────────────────

/// Fetch + persist achievements for a single GOG game.
///
/// First page only (no pagination). 401 / access_denied → sleep 5s and
/// retry once — still failing becomes a per-game error. Delisted games
/// return 404 (often with an HTML error page); deserialization fails
/// and the batch stays alive via the per-game error. A valid response
/// with `total_count == 0` yields empty data (persisted as a "no
/// achievements" row), not an error.
async fn fetch_game_achievements(
    client: &GogClient,
    app: &AppHandle,
    user_id: &str,
    game_id: &str,
) -> Result<GameAchievementData, String> {
    let url = format!(
        "https://gameplay.gog.com/clients/{}/users/{}/achievements",
        urlencoding::encode(game_id),
        urlencoding::encode(user_id),
    );

    let mut attempts = 0u32;
    let body = loop {
        let resp = client
            .get(&url)
            .header(reqwest::header::USER_AGENT, GOG_ACHIEVEMENTS_USER_AGENT)
            .send()
            .await
            .map_err(|e| format!("GET {url}: {e}"))?;
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        let auth_issue = status == reqwest::StatusCode::UNAUTHORIZED
            || body.contains("access_denied");
        if auth_issue && attempts == 0 {
            eprintln!(
                "[gog-achievements] game {game_id}: HTTP {} / access_denied — sleeping 5s and retrying once",
                status.as_u16()
            );
            attempts += 1;
            tokio::time::sleep(RETRY_DELAY).await;
            continue;
        }
        if !status.is_success() {
            return Err(format!(
                "GOG achievements API returned HTTP {} for game {}: {}",
                status.as_u16(),
                game_id,
                body_preview(&body)
            ));
        }
        break body;
    };

    let data = build_data(game_id, parse_achievements_response(&body)?, now_secs());

    // Persist the cache row: source="gog", provider_id=gameId, steam_app_id=0.
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
        "gog",
        Some(game_id),
    )?;

    Ok(data)
}

// ── Tauri command ───────────────────────────────────────────────────────

/// Batch result shape helper: map a per-game outcome to a
/// `GogAchievementResult`. A hard error ships `data = None`.
fn result_from_outcome(
    game_id: String,
    outcome: Result<GameAchievementData, String>,
) -> GogAchievementResult {
    match outcome {
        Ok(data) => GogAchievementResult {
            game_id,
            data: Some(data),
            error: None,
        },
        Err(e) => GogAchievementResult {
            game_id,
            data: None,
            error: Some(e),
        },
    }
}

/// Every game id gets the same error — used for auth / client failures
/// so a broken session surfaces consistently across the whole batch.
fn error_for_all(game_ids: Vec<String>, error: String) -> Vec<GogAchievementResult> {
    game_ids
        .into_iter()
        .map(|game_id| result_from_outcome(game_id, Err(error.clone())))
        .collect()
}

/// Fetch GOG achievements for one or more games (game ids are GOG
/// numeric product ids). Auth is assembled once for the whole batch
/// (load tokens → build `GogClient` → probe account/basic for the
/// user id), mirroring `gog_sync_library`. Auth failure fails every
/// game with the same error; per-game failures are tolerated and
/// reported individually.
#[tauri::command]
pub async fn gog_fetch_achievements(
    app: AppHandle,
    game_ids: Vec<String>,
) -> Vec<GogAchievementResult> {
    // 1. Load OAuth tokens. No refresh flow — an expired token is a
    //    clear "reconnect" error.
    let tokens = match auth::load_tokens(&app) {
        Ok(t) => t,
        Err(e) => {
            let msg = format!(
                "Not authenticated with GOG — reconnect your GOG account in Settings. Detail: {e}"
            );
            return error_for_all(game_ids, msg);
        }
    };
    if tokens.expires_at <= now_secs() {
        return error_for_all(
            game_ids,
            "GOG access token has expired — reconnect your GOG account in Settings".to_string(),
        );
    }

    // 2. Build the bearer-authenticated client (+ cookie jar, mirroring
    //    gog_sync_library's assembly).
    let cookie_jar = load_cookie_jar(&app);
    let client = match GogClient::from_token(&tokens.access_token, cookie_jar) {
        Ok(c) => c,
        Err(e) => return error_for_all(game_ids, format!("build GOG HTTP client: {e}")),
    };

    // 3. Probe account/basic once for the numeric user id.
    let probe = match client.get_account_basic().await {
        Ok(p) => p,
        Err(e) => {
            return error_for_all(
                game_ids,
                format!("GOG session expired — reconnect your GOG account. Detail: {e}"),
            )
        }
    };
    if !probe.is_logged_in {
        return error_for_all(
            game_ids,
            "GOG session expired — reconnect your GOG account".to_string(),
        );
    }
    let user_id = probe.user_id;
    if user_id.is_empty() {
        return error_for_all(
            game_ids,
            "GOG account probe returned no user id — reconnect your GOG account".to_string(),
        );
    }

    // 4. Per-game fetch — failures are tolerated individually.
    let mut results = Vec::with_capacity(game_ids.len());
    for game_id in &game_ids {
        let outcome = fetch_game_achievements(&client, &app, &user_id, game_id).await;
        results.push(result_from_outcome(game_id.clone(), outcome));
    }
    results
}

// ── Unit tests (hermetic — no network) ──────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// Canned endpoint response: one unlocked (snake_case fields,
    /// padded display strings, RFC3339 date) + one locked (null
    /// `date_unlocked`, empty-string icons).
    const RESPONSE_JSON: &str = r#"{
      "total_count": 2,
      "limit": 100,
      "page_token": null,
      "items": [
        {
          "id": "0f6ba1",
          "achievement_id": "0f6ba1",
          "achievement_key": "0f6ba1",
          "visible": true,
          "name": "  First Steps  ",
          "description": "  Complete the tutorial.  ",
          "image_url_unlocked": "https://images.gog.com/a/unlocked.png",
          "image_url_locked": "https://images.gog.com/a/locked.png",
          "rarity": 47.0,
          "date_unlocked": "2024-01-01T12:00:00Z",
          "rarity_level_description": "Common",
          "rarity_level_slug": "common"
        },
        {
          "id": "0f6ba2",
          "achievement_id": "0f6ba2",
          "achievement_key": "0f6ba2",
          "visible": true,
          "name": "Locked Secret",
          "description": "You will see.",
          "image_url_unlocked": "",
          "image_url_locked": "",
          "rarity": 5.0,
          "date_unlocked": null,
          "rarity_level_description": "Legendary",
          "rarity_level_slug": "legendary"
        }
      ],
      "achievements_mode": "classic"
    }"#;

    /// Same list but with `total_count: 0` — the gate must drop it.
    const ZERO_COUNT_JSON: &str = r#"{
      "total_count": 0,
      "limit": 100,
      "page_token": null,
      "items": [
        {
          "achievement_key": "0f6ba1",
          "name": "First Steps",
          "description": "Complete the tutorial.",
          "image_url_unlocked": "https://images.gog.com/a/unlocked.png",
          "image_url_locked": "https://images.gog.com/a/locked.png",
          "rarity": 47.0,
          "date_unlocked": "2024-01-01T12:00:00Z"
        }
      ],
      "achievements_mode": "classic"
    }"#;

    /// A single item with `rarity: null` — the tolerant deserializer
    /// must coerce it to 0.0 instead of failing the whole parse.
    const NULL_RARITY_JSON: &str = r#"{
      "total_count": 1,
      "items": [
        {
          "achievement_key": "k1",
          "name": "Null Rarity",
          "description": "d",
          "image_url_unlocked": "u.png",
          "image_url_locked": "l.png",
          "rarity": null,
          "date_unlocked": null
        }
      ]
    }"#;

    #[test]
    fn parse_maps_unlocked_vs_locked_items() {
        let parsed = parse_achievements_response(RESPONSE_JSON).unwrap();
        assert_eq!(parsed.len(), 2);

        let unlocked = &parsed[0];
        assert_eq!(unlocked.api_name, "0f6ba1");
        assert_eq!(unlocked.display_name, "First Steps");
        assert_eq!(unlocked.description, "Complete the tutorial.");
        assert_eq!(unlocked.icon, "https://images.gog.com/a/unlocked.png");
        assert_eq!(unlocked.icon_gray, "https://images.gog.com/a/locked.png");
        assert!(unlocked.achieved);
        assert_eq!(unlocked.unlock_time, 1_704_110_400); // 2024-01-01T12:00:00Z
        assert!((unlocked.percent - 47.0).abs() < f64::EPSILON);

        let locked = &parsed[1];
        assert_eq!(locked.api_name, "0f6ba2");
        assert!(!locked.achieved, "null date_unlocked must stay locked");
        assert_eq!(locked.unlock_time, 0);
        assert!((locked.percent - 5.0).abs() < f64::EPSILON);
    }

    #[test]
    fn parse_keeps_empty_string_icons_as_is() {
        let parsed = parse_achievements_response(RESPONSE_JSON).unwrap();
        let locked = &parsed[1];
        assert_eq!(locked.icon, "");
        assert_eq!(locked.icon_gray, "");
    }

    #[test]
    fn parse_gates_on_total_count_zero() {
        let parsed = parse_achievements_response(ZERO_COUNT_JSON).unwrap();
        assert!(
            parsed.is_empty(),
            "total_count == 0 must gate the response out"
        );
    }

    #[test]
    fn parse_returns_err_on_malformed_json() {
        assert!(parse_achievements_response("not json").is_err());
        assert!(parse_achievements_response("<html>404</html>").is_err());
        assert!(parse_achievements_response("").is_err());
    }

    #[test]
    fn parse_coerces_null_rarity_to_zero() {
        let parsed = parse_achievements_response(NULL_RARITY_JSON).unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].percent, 0.0);
    }

    #[test]
    fn build_data_derives_counts_from_items() {
        let achievements = parse_achievements_response(RESPONSE_JSON).unwrap();
        let data = build_data("1207658925", achievements, 1_700_000_000);
        assert_eq!(data.steam_app_id, 0);
        assert_eq!(data.total, 2);
        assert_eq!(data.unlocked, 1);
        assert_eq!(data.locked, 1);
        assert_eq!(data.source, "gog");
        assert_eq!(data.provider_id.as_deref(), Some("1207658925"));
        assert_eq!(data.last_synced, Some(1_700_000_000));
        // Sort: unlocked first.
        assert!(data.achievements[0].achieved);
        assert!(!data.achievements[1].achieved);
    }

    #[test]
    fn parse_unlock_date_handles_valid_and_malformed() {
        assert_eq!(
            parse_unlock_date("2024-01-01T12:00:00Z"),
            Some(1_704_110_400)
        );
        assert_eq!(
            parse_unlock_date("2024-01-01T12:00:00.789Z"),
            Some(1_704_110_400)
        );
        assert_eq!(parse_unlock_date("not-a-date"), None);
        assert_eq!(parse_unlock_date(""), None);
        assert_eq!(parse_unlock_date("2024-01-01"), None);
        assert_eq!(parse_unlock_date("2024-13-01T00:00:00Z"), None);
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
            source: "gog".to_string(),
            provider_id: Some("1207658925".to_string()),
        };

        let ok_entry = result_from_outcome("gog-1".to_string(), Ok(data.clone()));
        let err_entry = result_from_outcome("gog-2".to_string(), Err("boom".to_string()));

        assert_eq!(ok_entry.game_id, "gog-1");
        assert!(ok_entry.data.is_some());
        assert!(ok_entry.error.is_none());

        assert!(err_entry.data.is_none());
        assert_eq!(err_entry.error.as_deref(), Some("boom"));

        // Wire shape: camelCase keys (gameId/data/error).
        let json = serde_json::to_value(&ok_entry).unwrap();
        assert_eq!(json["gameId"].as_str(), Some("gog-1"));
        assert!(json.get("data").is_some());
        assert!(json.get("error").is_some());
    }

    #[test]
    fn error_for_all_replicates_the_same_message() {
        let results = error_for_all(
            vec!["a".to_string(), "b".to_string(), "c".to_string()],
            "session expired — reconnect".to_string(),
        );
        assert_eq!(results.len(), 3);
        for r in &results {
            assert!(r.data.is_none());
            assert_eq!(r.error.as_deref(), Some("session expired — reconnect"));
        }
        assert_eq!(results[0].game_id, "a");
        assert_eq!(results[2].game_id, "c");
    }
}
