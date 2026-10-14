//! Per-store library sync for the beta integrations.
//!
//! These are deliberately best-effort. Battle.net, EA and Xbox expose
//! real (if unofficial) endpoints that Playnite / GOG Galaxy use; itch.io
//! exposes no public owned-games API at all, so we read the itch desktop
//! app's local butler database instead when it is present.

use std::time::Duration;

use serde_json::Value;
use tauri::{AppHandle, Manager};

use super::login::user_agent;
use super::types::{BetaSyncResult, BetaSyncedGame, CookieRecord, XboxAuthTokens};
use super::{EA, BATTLENET, ITCH, XBOX};
use crate::db;

const CLIENT_ID_XBOX: &str = "38cd2fa8-66fd-4760-afb2-405eb65d5b0c";
const REDIRECT_XBOX: &str = "https://login.live.com/oauth20_desktop.srf";
const SCOPE_XBOX: &str = "Xboxlive.signin Xboxlive.offline_access";

/// Xbox Live RelyingParty the Microsoft Store's services (Collections)
/// expect — as opposed to `http://xboxlive.com`, which the profile and
/// title-history APIs use.
const XSTS_MARKETPLACE_RELYING_PARTY: &str = "http://mp.microsoft.com/";

/// The Microsoft Store collection of the signed-in account: the products it
/// actually holds. This is the ownership source — the Xbox Live
/// title-history endpoint is a *played* list (Game Pass, borrowed and
/// aggregated other-store titles all appear there) and must not be used.
const COLLECTIONS_URL: &str = "https://collections.mp.microsoft.com/v7.0/collections/query";
const COLLECTIONS_PAGE_SIZE: usize = 100;
const COLLECTIONS_MAX_PAGES: usize = 30;
/// Every Game Pass / Gold pass product id starts with this; it is never a
/// game the account owns.
const SUBSCRIPTION_ID_PREFIX: &str = "CFQ7TTC0";

/// Public Store catalog that turns product ids into titles and cover art.
const DISPLAY_CATALOG_URL: &str = "https://displaycatalog.mp.microsoft.com/v7.0/products";
const DISPLAY_CATALOG_BATCH: usize = 40;
const DISPLAY_CATALOG_MARKET: &str = "US";

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
pub(super) fn slug(s: &str) -> String {
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

// ── Battle.net ─────────────────────────────────────────────────────────

/// Battle.net's account website exposes the owned-games list (plus
/// subscriptions) at `account.battle.net/api/games-and-subs` — this is
/// what Playnite's BattleNetAccountClient reads. The API only answers as
/// the signed-in user to requests made from the browser session itself
/// (the site's own SPA sends `credentials: include` plus the
/// `X-XSRF-TOKEN` header, and the account session is re-issued through
/// an OAuth2 redirect as it rotates), so the read runs through a hidden
/// WebView sharing the app's profile — see `super::battlenet` — rather
/// than replaying captured cookies with a plain HTTP client.
async fn battlenet_sync(app: &AppHandle) -> Result<BetaSyncResult, String> {
    let payload = super::battlenet::capture_library(app).await?;
    let games = super::battlenet::games_from_payload(&payload);

    if let Some(battle_tag) = payload
        .get("battleTag")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
    {
        let _ = super::update_session_username(app, BATTLENET, battle_tag);
    }

    eprintln!("[beta-stores] Battle.net imported {} games", games.len());
    Ok(result(games))
}

// ── EA app (Juno GraphQL) ──────────────────────────────────────────────

/// EA moved off the Origin REST API. We capture the site's bearer token
/// from a hidden WebView (see `beta_stores::ea`) and page through the
/// persisted `getPreloadedOwnedGames` GraphQL query.
async fn ea_sync(app: &AppHandle) -> Result<BetaSyncResult, String> {
    let token = super::ea::capture_auth_token(app).await?;
    let client = reqwest::Client::builder()
        .user_agent(user_agent())
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("http client: {e}"))?;
    let bearer = format!("Bearer {token}");

    let mut games: Vec<BetaSyncedGame> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut offset = "0".to_string();
    let mut pages = 0usize;

    loop {
        pages += 1;
        // Safety stop so a bogus `next` value can never loop forever.
        if pages > 25 {
            break;
        }

        let url = super::ea::owned_games_url(&offset);
        let resp = client
            .get(&url)
            .header("Authorization", &bearer)
            .send()
            .await
            .map_err(|e| format!("EA library request failed: {e}"))?;

        let status = resp.status();
        if !status.is_success() {
            return Err(format!(
                "EA returned HTTP {} for the library — reconnect the account",
                status.as_u16()
            ));
        }

        let json: Value = resp
            .json()
            .await
            .map_err(|e| format!("EA library response parse failed: {e}"))?;

        let items = json
            .pointer("/data/me/ownedGameProducts/items")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        for item in &items {
            if let Some(game) = super::ea::owned_game_to_synced(item) {
                if seen.insert(game.id.clone()) {
                    games.push(game);
                }
            }
        }

        match json
            .pointer("/data/me/ownedGameProducts/next")
            .and_then(|v| v.as_str())
        {
            Some(next) if !next.is_empty() && next != offset => offset = next.to_string(),
            _ => break,
        }
    }

    eprintln!("[beta-stores] EA imported {} games", games.len());
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
        xbl_token: xbl_token.to_string(),
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

/// Exchange the XBL user token for an XSTS token the Store's services
/// (`collections.mp.microsoft.com`) accept. Kept separate from the
/// `http://xboxlive.com` XSTS used for profile/title calls, since the two
/// rely on different relying parties.
async fn fetch_xbox_marketplace_xsts(xbl_token: &str) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent(user_agent())
        .timeout(Duration::from_secs(25))
        .build()
        .map_err(|e| format!("http client: {e}"))?;
    let resp = client
        .post("https://xsts.auth.xboxlive.com/xsts/authorize")
        .header("x-xbl-contract-version", "1")
        .json(&serde_json::json!({
            "Properties": { "UserTokens": [xbl_token], "SandboxId": "RETAIL" },
            "RelyingParty": XSTS_MARKETPLACE_RELYING_PARTY,
            "TokenType": "JWT"
        }))
        .send()
        .await
        .map_err(|e| format!("Xbox Store authorize failed: {e}"))?;

    // An expired or rejected XBL token answers 400 with an `XErr` body, not
    // a 401 — both must trigger a chain refresh, not a hard failure.
    let status = resp.status().as_u16();
    let body: Value = resp.json().await.unwrap_or(Value::Null);
    if let Some(token) = body.get("Token").and_then(|v| v.as_str()) {
        return Ok(token.to_string());
    }
    if body.get("XErr").is_some() || matches!(status, 400 | 401 | 403) {
        return Err("UNAUTHORIZED".to_string());
    }
    Err(format!("Xbox Store authorize returned no token (HTTP {status})"))
}

/// A Store correlation vector. The service only logs `MS-CV`, but sending a
/// well-formed one keeps its request shaping happy. A fresh value per sync
/// is enough — uniqueness within a run is not required.
fn xbox_ms_cv() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{nanos:032X}.0")
}

/// True when a Collections item is a game the account owns: `productKind`
/// Game, active, and not a trial, pass or subscription. Games with Gold
/// grants count as owned (they play while the subscription lasts), which is
/// exactly what xbox.com's own "Owned games" list shows.
fn xbox_owned_item(item: &Value) -> bool {
    let pid = item.get("productId").and_then(|v| v.as_str()).unwrap_or("");
    if pid.is_empty() {
        return false;
    }
    if pid.to_ascii_uppercase().starts_with(SUBSCRIPTION_ID_PREFIX)
        || item.get("productKind").and_then(|v| v.as_str()) == Some("Pass")
    {
        return false;
    }
    if item.get("productKind").and_then(|v| v.as_str()) != Some("Game") {
        return false;
    }
    if item.get("status").and_then(|v| v.as_str()) != Some("Active") {
        return false;
    }
    if item.get("isTrial").and_then(|v| v.as_bool()) == Some(true)
        || item.get("skuType").and_then(|v| v.as_str()) == Some("Trial")
    {
        return false;
    }
    true
}

/// Page through the signed-in account's Store collection and return the
/// product ids of the games it owns. A partial list is never returned: any
/// failed page fails the whole read so the caller keeps its last good
/// library rather than acting on half of one.
async fn fetch_xbox_owned_product_ids(
    tokens: &XboxAuthTokens,
    store_token: &str,
) -> Result<(Vec<String>, Value), String> {
    let client = reqwest::Client::builder()
        .user_agent(user_agent())
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("http client: {e}"))?;

    let mut ids: Vec<String> = Vec::new();
    let mut raw_items: Vec<Value> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut continuation: Option<String> = None;

    for page in 1..=COLLECTIONS_MAX_PAGES {
        let mut body = serde_json::json!({
            "maxPageSize": COLLECTIONS_PAGE_SIZE,
            "excludeDuplicates": true,
            "market": DISPLAY_CATALOG_MARKET,
            "validityType": "All",
            "beneficiaries": [{
                "identityType": "xuid",
                "identityValue": tokens.xuid,
                "localTicketReference": "gameindex",
            }],
        });
        if let Some(token) = &continuation {
            body["continuationToken"] = Value::String(token.clone());
        }

        let resp = client
            .post(COLLECTIONS_URL)
            .header(
                "Authorization",
                format!("XBL3.0 x={};{}", tokens.user_hash, store_token),
            )
            .header("MS-CV", xbox_ms_cv())
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Xbox owned-games request failed: {e}"))?;

        let status = resp.status().as_u16();
        if status == 401 || status == 403 {
            return Err("UNAUTHORIZED".to_string());
        }
        if !resp.status().is_success() {
            return Err(format!(
                "Xbox owned-games lookup returned HTTP {status} (page {page})"
            ));
        }

        let json: Value = resp
            .json()
            .await
            .map_err(|e| format!("Xbox owned-games parse failed: {e}"))?;
        let items = json
            .get("items")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        raw_items.extend(items.iter().cloned());

        for item in &items {
            if !xbox_owned_item(item) {
                continue;
            }
            if let Some(pid) = item.get("productId").and_then(|v| v.as_str()) {
                let pid = pid.to_ascii_uppercase();
                if seen.insert(pid.clone()) {
                    ids.push(pid);
                }
            }
        }

        match json.get("continuationToken").and_then(|v| v.as_str()) {
            Some(next) if !next.is_empty() && !items.is_empty() && Some(next) != continuation.as_deref() => {
                continuation = Some(next.to_string());
            }
            _ => return Ok((ids, Value::Array(raw_items))),
        }
    }

    Err(format!(
        "Xbox owned-games lookup returned more than {COLLECTIONS_MAX_PAGES} pages"
    ))
}

/// Titles and cover art for a batch of Store product ids, keyed by
/// upper-case product id. Ids the public catalog does not know are simply
/// absent from the map.
async fn fetch_xbox_product_titles(
    client: &reqwest::Client,
    ids: &[String],
) -> Result<std::collections::HashMap<String, (String, Option<String>)>, String> {
    let mut out = std::collections::HashMap::new();
    for chunk in ids.chunks(DISPLAY_CATALOG_BATCH) {
        let big_ids = chunk.join(",");
        let url = format!(
            "{DISPLAY_CATALOG_URL}?bigIds={}&market={}&languages=en-US&MS-CV=F.1",
            urlencoding::encode(&big_ids),
            DISPLAY_CATALOG_MARKET,
        );
        let resp = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Xbox catalog request failed: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!(
                "Xbox catalog returned HTTP {}",
                resp.status().as_u16()
            ));
        }
        let json: Value = resp
            .json()
            .await
            .map_err(|e| format!("Xbox catalog parse failed: {e}"))?;
        let products = json
            .get("Products")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        for product in &products {
            let Some(pid) = product.get("ProductId").and_then(|v| v.as_str()) else {
                continue;
            };
            let title = product
                .pointer("/LocalizedProperties/0/ProductTitle")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            out.insert(pid.to_ascii_uppercase(), (title, xbox_cover(product)));
        }
    }
    Ok(out)
}

/// Best available cover for a displaycatalog product.
fn xbox_cover(product: &Value) -> Option<String> {
    const PREFERRED: &[&str] = &[
        "Poster",
        "BoxArt",
        "Tile",
        "TitledHeroArt",
        "HeroArt",
        "Screenshot",
    ];
    let images = product.pointer("/LocalizedProperties/0/Images")?.as_array()?;
    for purpose in PREFERRED {
        if let Some(img) = images.iter().find(|i| {
            i.get("ImagePurpose")
                .and_then(|v| v.as_str())
                .map(|p| p.eq_ignore_ascii_case(purpose))
                .unwrap_or(false)
        }) {
            if let Some(uri) = img.get("Uri").and_then(|v| v.as_str()) {
                return xbox_normalize_image(uri);
            }
        }
    }
    images
        .iter()
        .find_map(|i| i.get("Uri").and_then(|v| v.as_str()).and_then(xbox_normalize_image))
}

/// Microsoft returns naked paths like `//store-images.s-microsoft.com/...`;
/// prefix a scheme so the WebView can load them.
fn xbox_normalize_image(raw: &str) -> Option<String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    Some(if raw.starts_with("//") {
        format!("https:{raw}")
    } else if raw.starts_with("http://") || raw.starts_with("https://") {
        raw.to_string()
    } else if raw.starts_with('/') {
        format!("https://store-images.s-microsoft.com{raw}")
    } else {
        format!("https://{raw}")
    })
}

/// One owned Store product → a library game. Products the catalog cannot
/// name are skipped rather than imported as bare ids.
fn xbox_owned_game(
    product_id: &str,
    catalog: &std::collections::HashMap<String, (String, Option<String>)>,
) -> Option<BetaSyncedGame> {
    let (title, cover_url) = catalog.get(product_id)?;
    let title = title.trim();
    if title.is_empty() {
        return None;
    }
    Some(BetaSyncedGame {
        id: format!("xbox-{}", slug(product_id)),
        title: title.to_string(),
        store_game_id: Some(product_id.to_string()),
        is_installed: false,
        install_path: None,
        cover_url: cover_url.clone(),
        playtime_minutes: None,
        last_played: None,
    })
}

/// Xbox Live title history. Used only as a fallback: its titles include the
/// other-store games the Xbox app aggregates, so entries are kept only when
/// they are genuine Microsoft Store PC packages (see
/// [`xbox_store_title_to_game`]).
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
        return Err(format!("Xbox title history returned HTTP {status}"));
    }
    resp.json()
        .await
        .map_err(|e| format!("Xbox title history parse failed: {e}"))
}

/// One played Xbox title → a library game, but only when it is a real
/// Microsoft Store PC package (it has a `pfn`). Titles the Xbox app surfaced
/// from Steam, Epic, Ubisoft or Battle.net have no Store package and are
/// dropped — which is exactly what keeps other-store games out of the Xbox
/// integration.
fn xbox_store_title_to_game(title: &Value) -> Option<BetaSyncedGame> {
    if title.get("type").and_then(|v| v.as_str()) != Some("Game") {
        return None;
    }
    let pfn = title.get("pfn").and_then(|v| v.as_str()).unwrap_or("");
    if pfn.is_empty() {
        return None;
    }
    let name = title.get("name").and_then(|v| v.as_str()).unwrap_or(pfn);
    let clean_name = name
        .replace("(PC)", "")
        .replace("(Windows)", "")
        .replace("for Windows 10", "")
        .replace("- Windows 10", "");
    let playtime_minutes = title
        .get("minutesPlayed")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<u64>().ok());
    let last_played = title
        .pointer("/titleHistory/lastTimePlayed")
        .and_then(|v| v.as_str())
        .and_then(parse_rfc3339_secs);

    Some(BetaSyncedGame {
        id: format!("xbox-{}", slug(pfn)),
        title: clean_name.trim().to_string(),
        store_game_id: Some(pfn.to_string()),
        is_installed: false,
        install_path: None,
        cover_url: None,
        playtime_minutes,
        last_played,
    })
}

/// Fallback source: the played Xbox titles that are Microsoft Store PC
/// packages. Used when the Store collection cannot be read (for example a
/// sign-in client the Store does not recognise), so the integration imports
/// the account's Xbox games instead of nothing.
async fn fetch_xbox_store_titles(
    tokens: &XboxAuthTokens,
) -> Result<(Vec<BetaSyncedGame>, Value), String> {
    let payload = fetch_xbox_title_history(tokens).await?;
    let titles = payload
        .get("titles")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let mut games = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for title in &titles {
        if let Some(game) = xbox_store_title_to_game(title) {
            if seen.insert(game.id.clone()) {
                games.push(game);
            }
        }
    }
    Ok((games, payload))
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

/// Read the games the signed-in Microsoft account owns from the Store.
async fn fetch_xbox_owned(tokens: &XboxAuthTokens) -> Result<(Vec<String>, Value), String> {
    let store_token = fetch_xbox_marketplace_xsts(&tokens.xbl_token).await?;
    fetch_xbox_owned_product_ids(tokens, &store_token).await
}

/// Best-effort dump of the raw Xbox responses so a failed import can be
/// diagnosed. Written into the app data dir; returns the path when it works.
fn write_xbox_debug(app: &AppHandle, collections: &Value, titles: &Value) -> Option<String> {
    let dir = app.path().app_data_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    let path = dir.join("xbox-debug.json");
    let payload = serde_json::json!({
        "collections": collections,
        "titleHistory": titles,
    });
    std::fs::write(&path, serde_json::to_string_pretty(&payload).ok()?).ok()?;
    Some(path.display().to_string())
}

async fn xbox_sync(app: &AppHandle) -> Result<BetaSyncResult, String> {
    let mut tokens = load_xbox_tokens(app)?;

    // Sessions captured before the Store token was kept cannot mint the
    // marketplace XSTS; rebuild the whole chain once.
    if tokens.xbl_token.is_empty() {
        tokens = refresh_xbox(app, &tokens).await?;
    }

    // Ownership, not play history: the Xbox app aggregates Steam, Epic,
    // Ubisoft and Battle.net libraries, and those titles land in the
    // account's *played* list. The Microsoft Store collection is the
    // account's actual Xbox library, so it is the primary source.
    let mut collections_raw = Value::Null;
    let mut owned_ids: Vec<String> = Vec::new();
    match fetch_xbox_owned(&tokens).await {
        Ok((ids, raw)) => {
            owned_ids = ids;
            collections_raw = raw;
        }
        Err(e) if e == "UNAUTHORIZED" => {
            tokens = refresh_xbox(app, &tokens).await?;
            if let Ok((ids, raw)) = fetch_xbox_owned(&tokens).await {
                owned_ids = ids;
                collections_raw = raw;
            }
        }
        Err(e) => eprintln!("[beta-stores] Xbox ownership lookup failed: {e}"),
    }
    eprintln!("[beta-stores] Xbox owned products: {}", owned_ids.len());

    let mut games: Vec<BetaSyncedGame> = Vec::new();
    if !owned_ids.is_empty() {
        let client = reqwest::Client::builder()
            .user_agent(user_agent())
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|e| format!("http client: {e}"))?;
        if let Ok(catalog) = fetch_xbox_product_titles(&client, &owned_ids).await {
            let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
            for pid in &owned_ids {
                if let Some(game) = xbox_owned_game(pid, &catalog) {
                    if seen.insert(game.id.clone()) {
                        games.push(game);
                    }
                }
            }
        }
    }

    // Fallback: the Store collection is empty or unreadable — the sign-in
    // client may be one the Store does not recognise. Import the Store PC
    // titles from the played list instead so the integration is not silently
    // empty; the mapping still requires a Microsoft Store package, so
    // other-store entries stay out.
    let mut titles_raw = Value::Null;
    let mut titles_total = 0usize;
    if games.is_empty() {
        match fetch_xbox_store_titles(&tokens).await {
            Ok((fallback, raw)) => {
                titles_total = raw
                    .get("titles")
                    .and_then(|v| v.as_array())
                    .map(|a| a.len())
                    .unwrap_or(0);
                titles_raw = raw;
                if !fallback.is_empty() {
                    games = fallback;
                }
            }
            Err(e) if e == "UNAUTHORIZED" => {
                tokens = refresh_xbox(app, &tokens).await?;
                if let Ok((fallback, raw)) = fetch_xbox_store_titles(&tokens).await {
                    titles_total = raw
                        .get("titles")
                        .and_then(|v| v.as_array())
                        .map(|a| a.len())
                        .unwrap_or(0);
                    titles_raw = raw;
                    games = fallback;
                }
            }
            Err(e) => eprintln!("[beta-stores] Xbox title history failed: {e}"),
        }
    }

    eprintln!("[beta-stores] Xbox games: {}", games.len());

    let mut res = result(games);
    if res.synced_games.is_empty() {
        let mut note = format!(
            "No Xbox games imported. Store collection: {} owned product(s). Xbox title history: {} title(s).",
            owned_ids.len(),
            titles_total,
        );
        if let Some(path) = write_xbox_debug(app, &collections_raw, &titles_raw) {
            note.push_str(&format!(" Debug data: {path}"));
        }
        res.note = Some(note);
    }
    Ok(res)
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

    #[test]
    fn xbox_owned_item_keeps_purchases_and_gold_only() {
        let owned = |v: serde_json::Value| xbox_owned_item(&v);
        assert!(owned(
            serde_json::json!({ "productId": "9N1", "productKind": "Game", "status": "Active" })
        ));
        // Games with Gold: playable while subscribed, still "owned".
        assert!(owned(serde_json::json!({
            "productId": "9N2", "productKind": "Game", "status": "Active", "licensingRequired": true
        })));
        // Subscriptions, add-ons, expired and trial items are not games.
        assert!(!owned(
            serde_json::json!({ "productId": "CFQ7TTC0KHS0", "productKind": "Pass" })
        ));
        assert!(!owned(serde_json::json!({
            "productId": "9N3", "productKind": "Durable", "status": "Active"
        })));
        assert!(!owned(serde_json::json!({
            "productId": "9N4", "productKind": "Game", "status": "Expired"
        })));
        assert!(!owned(serde_json::json!({
            "productId": "9N5", "productKind": "Game", "status": "Active", "skuType": "Trial"
        })));
        assert!(!owned(
            serde_json::json!({ "productId": "", "productKind": "Game", "status": "Active" })
        ));
    }

    #[test]
    fn xbox_owned_game_needs_a_catalog_title() {
        let mut catalog = std::collections::HashMap::new();
        catalog.insert(
            "9N1".to_string(),
            ("Forza Horizon 4".to_string(), Some("https://img/cover.jpg".to_string())),
        );
        let game = xbox_owned_game("9N1", &catalog).expect("should map");
        assert_eq!(game.id, "xbox-9n1");
        assert_eq!(game.title, "Forza Horizon 4");
        assert_eq!(game.store_game_id.as_deref(), Some("9N1"));
        assert_eq!(game.cover_url.as_deref(), Some("https://img/cover.jpg"));

        assert!(xbox_owned_game("missing", &catalog).is_none());
    }

    #[test]
    fn xbox_normalize_image_adds_a_scheme() {
        assert_eq!(
            xbox_normalize_image("//store-images.s-microsoft.com/a.jpg").as_deref(),
            Some("https://store-images.s-microsoft.com/a.jpg")
        );
        assert_eq!(
            xbox_normalize_image("/image/apps.1/a.jpg").as_deref(),
            Some("https://store-images.s-microsoft.com/image/apps.1/a.jpg")
        );
        assert_eq!(xbox_normalize_image("   "), None);
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
    fn xbox_store_title_keeps_only_store_packages() {
        let store = serde_json::json!({
            "type": "Game",
            "pfn": "Microsoft.HaloInfinite_8wekyb3d8bbwe",
            "name": "Halo Infinite (PC)",
            "minutesPlayed": "120"
        });
        let game = xbox_store_title_to_game(&store).expect("should map");
        assert_eq!(game.id, "xbox-microsoft-haloinfinite-8wekyb3d8bbwe");
        assert_eq!(game.title, "Halo Infinite");
        assert_eq!(game.playtime_minutes, Some(120));

        // A Steam/Ubisoft game the Xbox app surfaced has no Store package.
        let aggregated = serde_json::json!({ "type": "Game", "name": "Some Steam Game" });
        assert!(xbox_store_title_to_game(&aggregated).is_none());

        let app = serde_json::json!({ "type": "Application", "pfn": "Some.App", "name": "App" });
        assert!(xbox_store_title_to_game(&app).is_none());
    }
}
