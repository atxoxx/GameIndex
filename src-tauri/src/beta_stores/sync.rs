//! Per-store library sync for the beta integrations.
//!
//! These are deliberately best-effort. Battle.net, EA and Xbox expose
//! real (if unofficial) endpoints that Playnite / GOG Galaxy use; itch.io
//! exposes no public owned-games API at all, so we read the itch desktop
//! app's local butler database instead when it is present.

use std::time::Duration;

use serde_json::Value;
use tauri::{AppHandle, Manager};

use super::login::{jar_from, user_agent};
use super::types::{BetaSyncResult, BetaSyncedGame, CookieRecord, XboxAuthTokens};
use super::{EA, BATTLENET, ITCH, XBOX};
use crate::db;

const CLIENT_ID_XBOX: &str = "38cd2fa8-66fd-4760-afb2-405eb65d5b0c";
const REDIRECT_XBOX: &str = "https://login.live.com/oauth20_desktop.srf";
const SCOPE_XBOX: &str = "Xboxlive.signin Xboxlive.offline_access";

/// Dispatch the sync for one store key.
pub async fn sync_store(app: &AppHandle, key: &str) -> Result<BetaSyncResult, String> {
    match key {
        BATTLENET => battlenet_sync(app).await,
        EA => ea_sync(app).await,
        XBOX => xbox_sync(app).await,
        ITCH => itch_sync(app).await,
        other => Err(format!("Unknown beta store: {other}")),
    }
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn result(games: Vec<BetaSyncedGame>) -> BetaSyncResult {
    BetaSyncResult {
        success: true,
        games_imported: games.len(),
        games_skipped: 0,
        errors: Vec::new(),
        last_sync: now(),
        synced_games: games,
        note: None,
    }
}

/// Lowercase slug used inside the generated game id.
fn slug(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

fn load_cookies(app: &AppHandle, key: &str) -> Result<Vec<CookieRecord>, String> {
    let db_state = app
        .try_state::<db::Db>()
        .ok_or_else(|| "Database not initialized".to_string())?;
    let raw = db::kv::get(db_state.inner(), &format!("{key}_cookies"))
        .map_err(|e| format!("read cookies: {e}"))?
        .ok_or_else(|| "Store is not connected".to_string())?;
    let cookies: super::types::StoreCookies =
        serde_json::from_str(&raw).map_err(|e| format!("parse cookies: {e}"))?;
    if cookies.records.is_empty() {
        return Err("Store is not connected".to_string());
    }
    Ok(cookies.records)
}

fn cookie_client(cookies: &[CookieRecord], default_host: &str) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(user_agent())
        .cookie_provider(jar_from(cookies, default_host)?)
        .timeout(Duration::from_secs(25))
        .build()
        .map_err(|e| format!("http client: {e}"))
}

// ── Battle.net ─────────────────────────────────────────────────────────

/// Battle.net's account website exposes the owned-games list (plus
/// subscriptions) at `account.battle.net/api/games-and-subs` once the
/// `account.battle.net` session cookies are present — this is exactly
/// what Playnite's BattleNetAccountClient scrapes.
async fn battlenet_sync(app: &AppHandle) -> Result<BetaSyncResult, String> {
    let cookies = load_cookies(app, BATTLENET)?;
    let client = cookie_client(&cookies, "account.battle.net")?;

    let resp = client
        .get("https://account.battle.net/api/games-and-subs")
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Battle.net request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!(
            "Battle.net returned HTTP {} — your session may have expired, reconnect the account",
            resp.status().as_u16()
        ));
    }

    let payload: Value = resp
        .json()
        .await
        .map_err(|e| format!("Battle.net response parse failed: {e}"))?;

    let empty = Vec::new();
    let accounts = payload
        .get("gameAccounts")
        .and_then(|v| v.as_array())
        .unwrap_or(&empty);

    let mut games = Vec::new();
    for entry in accounts {
        let Some(title_id) = entry.get("titleId").and_then(|v| v.as_str()) else {
            continue;
        };
        let title = entry
            .get("localizedGameName")
            .and_then(|v| v.as_str())
            .or_else(|| entry.get("gameName").and_then(|v| v.as_str()))
            .unwrap_or(title_id);
        games.push(BetaSyncedGame {
            id: format!("battlenet-{}", slug(title_id)),
            title: title.to_string(),
            store_game_id: Some(title_id.to_string()),
            is_installed: false,
            install_path: None,
            cover_url: None,
            playtime_minutes: None,
            last_played: None,
        });
    }

    Ok(result(games))
}

// ── EA app / Origin ────────────────────────────────────────────────────

/// EA's web stack hands out a bearer token to a client carrying the
/// session cookies (`ORIGIN_JS_SDK`, `prompt=none`, `nucleus:rest`). We
/// then resolve the account pid and read the consolidated entitlements —
/// the same sequence GOG Galaxy's Origin integration uses.
async fn ea_sync(app: &AppHandle) -> Result<BetaSyncResult, String> {
    let cookies = load_cookies(app, EA)?;
    let client = cookie_client(&cookies, "accounts.ea.com")?;

    let token_resp = client
        .get("https://accounts.ea.com/connect/auth")
        .query(&[
            ("client_id", "ORIGIN_JS_SDK"),
            ("response_type", "token"),
            ("redirect_uri", "nucleus:rest"),
            ("prompt", "none"),
        ])
        .send()
        .await
        .map_err(|e| format!("EA token request failed: {e}"))?;

    let token_json: Value = token_resp
        .json()
        .await
        .map_err(|e| format!("EA token parse failed: {e}"))?;

    let access_token = token_json
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            token_json
                .get("error")
                .and_then(|v| v.as_str())
                .map(|e| format!("EA sign-in expired ({e}) — reconnect the account"))
                .unwrap_or_else(|| "EA did not return an access token — reconnect the account".to_string())
        })?;
    let bearer = format!("Bearer {access_token}");

    let pid_resp = client
        .get("https://gateway.ea.com/proxy/identity/pids/me")
        .header("Authorization", &bearer)
        .send()
        .await
        .map_err(|e| format!("EA identity request failed: {e}"))?;
    let pid_json: Value = pid_resp
        .json()
        .await
        .map_err(|e| format!("EA identity parse failed: {e}"))?;
    let pid = pid_json
        .pointer("/pid/pidId")
        .and_then(|v| {
            v.as_str()
                .map(str::to_string)
                .or_else(|| v.as_i64().map(|n| n.to_string()))
        })
        .ok_or_else(|| "EA identity response did not contain a pid".to_string())?;

    let ent_resp = client
        .get(format!(
            "https://api1.origin.com/ecommerce2/consolidatedentitlements/{pid}?machine_hash=1"
        ))
        .header("Authorization", &bearer)
        .header(
            "Accept",
            "application/vnd.origin.v3+json; x-cache/force-write",
        )
        .send()
        .await
        .map_err(|e| format!("EA entitlements request failed: {e}"))?;

    if !ent_resp.status().is_success() {
        return Err(format!(
            "EA returned HTTP {} for entitlements — reconnect the account",
            ent_resp.status().as_u16()
        ));
    }

    let ent_json: Value = ent_resp
        .json()
        .await
        .map_err(|e| format!("EA entitlements parse failed: {e}"))?;

    let empty = Vec::new();
    let entitlements = ent_json
        .get("entitlements")
        .and_then(|v| v.as_array())
        .unwrap_or(&empty);

    let mut games = Vec::new();
    for ent in entitlements {
        if ent.get("offerType").and_then(|v| v.as_str()) != Some("basegame") {
            continue;
        }
        let Some(offer_id) = ent.get("offerId").and_then(|v| v.as_str()) else {
            continue;
        };
        let title = ent
            .get("displayName")
            .and_then(|v| v.as_str())
            .or_else(|| ent.get("productName").and_then(|v| v.as_str()))
            .unwrap_or(offer_id);
        games.push(BetaSyncedGame {
            id: format!("ea-{}", slug(offer_id)),
            title: title.to_string(),
            store_game_id: Some(offer_id.to_string()),
            is_installed: false,
            install_path: None,
            cover_url: None,
            playtime_minutes: None,
            last_played: None,
        });
    }

    Ok(result(games))
}

// ── Xbox / Microsoft Store ─────────────────────────────────────────────

fn load_xbox_tokens(app: &AppHandle) -> Result<XboxAuthTokens, String> {
    let db_state = app
        .try_state::<db::Db>()
        .ok_or_else(|| "Database not initialized".to_string())?;
    let raw = db::kv::get(db_state.inner(), &format!("{XBOX}_tokens"))
        .map_err(|e| format!("read xbox tokens: {e}"))?
        .ok_or_else(|| "Xbox is not connected".to_string())?;
    serde_json::from_str(&raw).map_err(|e| format!("parse xbox tokens: {e}"))
}

fn save_xbox_tokens(app: &AppHandle, tokens: &XboxAuthTokens) -> Result<(), String> {
    let db_state = app
        .try_state::<db::Db>()
        .ok_or_else(|| "Database not initialized".to_string())?;
    let json = serde_json::to_string(tokens).map_err(|e| format!("serialize xbox tokens: {e}"))?;
    db::kv::set(db_state.inner(), &format!("{XBOX}_tokens"), &json)
}

/// Exchange a Microsoft OAuth access token for XBL + XSTS tokens.
pub async fn xbox_authenticate(access_token: &str) -> Result<XboxAuthTokens, String> {
    let client = reqwest::Client::builder()
        .user_agent(user_agent())
        .timeout(Duration::from_secs(25))
        .build()
        .map_err(|e| format!("http client: {e}"))?;

    let auth_body = serde_json::json!({
        "Properties": { "RpsTicket": format!("d={access_token}"), "AuthMethod": "RPS", "SiteName": "user.auth.xboxlive.com" },
        "RelyingParty": "http://auth.xboxlive.com",
        "TokenType": "JWT"
    });
    let auth_resp = client
        .post("https://user.auth.xboxlive.com/user/authenticate")
        .header("x-xbl-contract-version", "1")
        .json(&auth_body)
        .send()
        .await
        .map_err(|e| format!("Xbox user authenticate failed: {e}"))?;
    let auth_json: Value = auth_resp
        .json()
        .await
        .map_err(|e| format!("Xbox user authenticate parse failed: {e}"))?;
    let xbl_token = auth_json
        .get("Token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Xbox user authenticate returned no token".to_string())?;

    let xsts_resp = client
        .post("https://xsts.auth.xboxlive.com/xsts/authorize")
        .header("x-xbl-contract-version", "1")
        .json(&serde_json::json!({
            "Properties": { "UserTokens": [xbl_token], "SandboxId": "RETAIL" },
            "RelyingParty": "http://xboxlive.com",
            "TokenType": "JWT"
        }))
        .send()
        .await
        .map_err(|e| format!("Xbox XSTS authorize failed: {e}"))?;
    let xsts_json: Value = xsts_resp
        .json()
        .await
        .map_err(|e| format!("Xbox XSTS parse failed: {e}"))?;

    let token = xsts_json
        .get("Token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            xsts_json
                .get("XErr")
                .map(|e| format!("Xbox XSTS rejected the sign-in (XErr={e})"))
                .unwrap_or_else(|| "Xbox XSTS authorize returned no token".to_string())
        })?;
    let claim = xsts_json
        .pointer("/DisplayClaims/xui/0")
        .cloned()
        .unwrap_or(Value::Null);
    let xuid = claim
        .get("xid")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let user_hash = claim
        .get("uhs")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();

    Ok(XboxAuthTokens {
        xuid,
        user_hash,
        token: token.to_string(),
        logged_in_at: now(),
        ..Default::default()
    })
}

async fn refresh_xbox(app: &AppHandle, tokens: &XboxAuthTokens) -> Result<XboxAuthTokens, String> {
    if tokens.refresh_token.is_empty() {
        return Err("Xbox session expired — reconnect the account".to_string());
    }
    let client = reqwest::Client::builder()
        .user_agent(user_agent())
        .timeout(Duration::from_secs(25))
        .build()
        .map_err(|e| format!("http client: {e}"))?;
    let resp = client
        .post("https://login.live.com/oauth20_token.srf")
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", tokens.refresh_token.as_str()),
            ("scope", SCOPE_XBOX),
            ("client_id", CLIENT_ID_XBOX),
            ("redirect_uri", REDIRECT_XBOX),
        ])
        .send()
        .await
        .map_err(|e| format!("Xbox token refresh failed: {e}"))?;
    let json: Value = resp
        .json()
        .await
        .map_err(|e| format!("Xbox token refresh parse failed: {e}"))?;
    let access = json
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Xbox token refresh returned no access token — reconnect the account".to_string())?;

    let mut fresh = xbox_authenticate(access).await?;
    fresh.access_token = access.to_string();
    fresh.refresh_token = json
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .unwrap_or(&tokens.refresh_token)
        .to_string();
    fresh.gamertag = tokens.gamertag.clone();
    save_xbox_tokens(app, &fresh)?;
    Ok(fresh)
}

async fn fetch_xbox_title_history(tokens: &XboxAuthTokens) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .user_agent(user_agent())
        .timeout(Duration::from_secs(25))
        .build()
        .map_err(|e| format!("http client: {e}"))?;
    let url = format!(
        "https://titlehub.xboxlive.com/users/xuid({})/titles/titlehistory/decoration/detail",
        tokens.xuid
    );
    let resp = client
        .get(url)
        .header("x-xbl-contract-version", "2")
        .header(
            "Authorization",
            format!("XBL3.0 x={};{}", tokens.user_hash, tokens.token),
        )
        .header("Accept-Language", "en-US")
        .send()
        .await
        .map_err(|e| format!("Xbox title history request failed: {e}"))?;

    let status = resp.status().as_u16();
    if status == 401 || status == 403 {
        return Err("UNAUTHORIZED".to_string());
    }
    if !resp.status().is_success() {
        return Err(format!("Xbox returned HTTP {status}"));
    }
    resp.json()
        .await
        .map_err(|e| format!("Xbox title history parse failed: {e}"))
}

async fn xbox_sync(app: &AppHandle) -> Result<BetaSyncResult, String> {
    let mut tokens = load_xbox_tokens(app)?;

    let payload = match fetch_xbox_title_history(&tokens).await {
        Ok(v) => v,
        Err(e) if e == "UNAUTHORIZED" => {
            tokens = refresh_xbox(app, &tokens).await?;
            fetch_xbox_title_history(&tokens).await?
        }
        Err(e) => return Err(e),
    };

    let empty = Vec::new();
    let titles = payload
        .get("titles")
        .and_then(|v| v.as_array())
        .unwrap_or(&empty);

    let mut games = Vec::new();
    for title in titles {
        if title.get("type").and_then(|v| v.as_str()) != Some("Game") {
            continue;
        }
        let pfn = title.get("pfn").and_then(|v| v.as_str()).unwrap_or("");
        let title_id = title.get("titleId").and_then(|v| v.as_str()).unwrap_or("");
        let stable_id = if !pfn.is_empty() { pfn } else { title_id };
        if stable_id.is_empty() {
            continue;
        }
        let name = title.get("name").and_then(|v| v.as_str()).unwrap_or(stable_id);
        let clean_name = name
            .replace("(PC)", "")
            .replace("(Windows)", "")
            .replace("for Windows 10", "")
            .replace("- Windows 10", "");
        let clean_name = clean_name.trim();

        let playtime_minutes = title
            .get("minutesPlayed")
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<u64>().ok());
        let last_played = title
            .pointer("/titleHistory/lastTimePlayed")
            .and_then(|v| v.as_str())
            .and_then(parse_rfc3339_secs);

        games.push(BetaSyncedGame {
            id: format!("xbox-{}", slug(stable_id)),
            title: clean_name.to_string(),
            store_game_id: Some(stable_id.to_string()),
            is_installed: false,
            install_path: None,
            cover_url: None,
            playtime_minutes,
            last_played,
        });
    }

    Ok(result(games))
}

/// Minimal RFC-3339 → Unix seconds converter for the `lastTimePlayed`
/// timestamps Xbox returns. Only the `YYYY-MM-DDTHH:MM:SS` prefix is
/// parsed; fractional seconds and the offset are ignored.
fn parse_rfc3339_secs(s: &str) -> Option<u64> {
    let date = s.get(0..10)?;
    let time = s.get(11..19).unwrap_or("00:00:00");
    let y: i64 = date.get(0..4)?.parse().ok()?;
    let mo: i64 = date.get(5..7)?.parse().ok()?;
    let d: i64 = date.get(8..10)?.parse().ok()?;
    let h: i64 = time.get(0..2)?.parse().ok()?;
    let mi: i64 = time.get(3..5)?.parse().ok()?;
    let se: i64 = time.get(6..8)?.parse().ok()?;

    // Days since Unix epoch (civil-from-days algorithm).
    let y_adj = if mo <= 2 { y - 1 } else { y };
    let era = if y_adj >= 0 { y_adj } else { y_adj - 399 } / 400;
    let yoe = y_adj - era * 400;
    let doy = (153 * (if mo > 2 { mo - 3 } else { mo + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;

    Some((days * 86400 + h * 3600 + mi * 60 + se).max(0) as u64)
}

// ── itch.io ────────────────────────────────────────────────────────────

/// itch.io has no public owned-games API. The itch desktop app keeps its
/// library in a local SQLite butler database; we read the installed
/// "caves" out of it when present and report a friendly beta caveat
/// otherwise.
async fn itch_sync(app: &AppHandle) -> Result<BetaSyncResult, String> {
    let _ = load_cookies(app, ITCH)?;
    match read_itch_caves() {
        Ok(games) if !games.is_empty() => {
            let mut res = result(games);
            res.note = Some(
                "itch.io beta import lists games installed via the itch app — reconnect or re-run after installing new games."
                    .to_string(),
            );
            Ok(res)
        }
        Ok(_) => Err(
            "No itch.io games found. Install games with the itch desktop app, then sync again. (itch.io does not expose a public owned-games API.)"
                .to_string(),
        ),
        Err(e) => Err(format!("itch.io import needs the itch desktop app: {e}")),
    }
}

/// Read installed itch.io games out of `%APPDATA%\itch\db\butler.db`.
///
/// The schema is internal to the itch app and has changed over time, so
/// we introspect the `caves` table's columns and pick sensible ones
/// instead of hard-coding a query that may break.
fn read_itch_caves() -> Result<Vec<BetaSyncedGame>, String> {
    use rusqlite::{Connection, OpenFlags};

    let appdata = std::env::var("APPDATA")
        .map_err(|_| "APPDATA environment variable is not set".to_string())?;
    let db_path = std::path::Path::new(&appdata)
        .join("itch")
        .join("db")
        .join("butler.db");
    if !db_path.exists() {
        return Err("the itch app database was not found".to_string());
    }

    let conn = Connection::open_with_flags(&db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("could not open butler.db: {e}"))?;

    let has_caves: bool = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='caves'",
            [],
            |_| Ok(true),
        )
        .unwrap_or(false);
    if !has_caves {
        return Err("the itch app database has no library table".to_string());
    }

    let mut cols: Vec<String> = Vec::new();
    {
        let mut stmt = conn
            .prepare("PRAGMA table_info(caves)")
            .map_err(|e| format!("pragma failed: {e}"))?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(1))
            .map_err(|e| format!("pragma read failed: {e}"))?;
        for r in rows.flatten() {
            cols.push(r);
        }
    }

    let pick = |candidates: &[&str]| -> Option<String> {
        for c in candidates {
            if cols.iter().any(|x| x.eq_ignore_ascii_case(c)) {
                return cols
                    .iter()
                    .find(|x| x.eq_ignore_ascii_case(c))
                    .cloned();
            }
        }
        None
    };

    let id_col = pick(&["game_id", "gameId", "id"])
        .ok_or_else(|| "unrecognised itch app database layout".to_string())?;
    let title_col = pick(&["game_title", "gameTitle", "title"]);
    let folder_col = pick(&["install_folder", "installFolder", "folder", "path"]);

    let title_expr = match &title_col {
        Some(c) => format!("COALESCE(\"{c}\", '')"),
        None => "''".to_string(),
    };
    let folder_expr = match &folder_col {
        Some(c) => format!("\"{c}\""),
        None => "NULL".to_string(),
    };
    let sql = format!("SELECT \"{id_col}\", {title_expr}, {folder_expr} FROM caves");

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("itch query failed: {e}"))?;
    let mapped = stmt
        .query_map([], |r| {
            let id: String = r.get::<_, String>(0).unwrap_or_default();
            let title: String = r.get::<_, String>(1).unwrap_or_default();
            let folder: Option<String> = r.get(2).ok();
            Ok((id, title, folder))
        })
        .map_err(|e| format!("itch query failed: {e}"))?;

    let mut out = Vec::new();
    for row in mapped.flatten() {
        let (id, title, folder) = row;
        if id.is_empty() {
            continue;
        }
        let title = if title.trim().is_empty() {
            format!("itch.io game {id}")
        } else {
            title
        };
        let install_path = folder
            .filter(|f| !f.is_empty() && std::path::Path::new(f).exists());
        out.push(BetaSyncedGame {
            id: format!("itch-{}", slug(&id)),
            title,
            store_game_id: Some(id),
            is_installed: true,
            install_path,
            cover_url: None,
            playtime_minutes: None,
            last_played: None,
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slug_normalises_ids() {
        assert_eq!(slug("Battle.net:123"), "battle-net-123");
        assert_eq!(slug("--ABC--"), "abc");
    }

    #[test]
    fn parse_rfc3339_parses_known_timestamp() {
        // 2021-01-01T00:00:00Z
        assert_eq!(parse_rfc3339_secs("2021-01-01T00:00:00Z"), Some(1609459200));
        assert_eq!(parse_rfc3339_secs("2021-01-01T00:00:00.123Z"), Some(1609459200));
    }

    #[test]
    fn parse_rfc3339_rejects_garbage() {
        assert_eq!(parse_rfc3339_secs("not-a-date"), None);
        assert_eq!(parse_rfc3339_secs(""), None);
    }

    #[test]
    fn result_marks_success_and_counts() {
        let games = vec![BetaSyncedGame {
            id: "xbox-1".into(),
            title: "Halo".into(),
            store_game_id: None,
            is_installed: false,
            install_path: None,
            cover_url: None,
            playtime_minutes: None,
            last_played: None,
        }];
        let r = result(games);
        assert!(r.success);
        assert_eq!(r.games_imported, 1);
        assert_eq!(r.synced_games.len(), 1);
    }
}
