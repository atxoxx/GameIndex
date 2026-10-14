//! Beta store integrations: Battle.net, EA app, Xbox / Microsoft Store
//! and itch.io.
//!
//! These are spearated from the first-party integrations (Steam, Epic,
//! GOG, Humble) because they are experimental: each relies on an
//! undocumented or unstable login/API surface, so the Settings UI labels
//! them **Beta** and sync is best-effort. The sign-in flow itself is the
//! same WebView-capture model used by the Humble integration — the store
//! hosts the login page, we only snapshot the resulting session.
//!
//! One shared implementation backs all four stores; only the login URLs,
//! success navigation and sync endpoints differ (see `login.rs` and
//! `sync.rs`).

mod battlenet;
mod ea;
mod login;
mod sync;
mod types;

pub use types::{BetaSession, BetaSettings, BetaSyncResult};

use tauri::{AppHandle, Manager};

use crate::db;

// ── Store keys ─────────────────────────────────────────────────────────

pub const BATTLENET: &str = "battlenet";
pub const EA: &str = "ea";
pub const XBOX: &str = "xbox";
pub const ITCH: &str = "itch";

/// The four store keys, in display order.
#[allow(dead_code)]
pub const STORES: &[&str] = &[BATTLENET, EA, XBOX, ITCH];

// ── Login specs ────────────────────────────────────────────────────────

struct StoreLogin {
    window_label: &'static str,
    title: &'static str,
    url: String,
    width: f64,
    height: f64,
    success: login::SuccessMatch,
    cookie_domains: &'static [&'static str],
    /// Let the success page load before snapshotting cookies — its
    /// response is what mints the store session. See `LoginSpec::settle`.
    settle: bool,
}

fn login_spec(key: &str) -> Result<StoreLogin, String> {
    match key {
        BATTLENET => Ok(StoreLogin {
            window_label: "battlenet-login",
            title: "Battle.net Sign In",
            // Start at the account home; logged-out users are bounced to
            // the login form and return to `/overview` only on success.
            url: "https://account.battle.net/".to_string(),
            width: 520.0,
            height: 720.0,
            success: login::SuccessMatch::UrlPrefix("https://account.battle.net/overview"),
            cookie_domains: &["battle.net", "blizzard.com"],
            // The account session cookie is set when `/overview` (and the
            // OAuth2 callback behind it) actually load, not by the
            // redirect that leads there.
            settle: true,
        }),
        EA => Ok(StoreLogin {
            window_label: ea::window_label(),
            title: "EA Sign In",
            // EA's own site login. The old accounts.ea.com ORIGIN_SPA_ID
            // flow now lands on an EA "Service limitations apply" error;
            // the website login is what the current EA app/Playnite use.
            url: ea::EA_LOGIN_URL.to_string(),
            width: 500.0,
            height: 740.0,
            success: login::SuccessMatch::UrlEquals(ea::EA_HOME_URL),
            cookie_domains: &["ea.com"],
            settle: false,
        }),
        XBOX => Ok(StoreLogin {
            window_label: "xbox-login",
            title: "Microsoft Account Sign In",
            url: format!(
                "https://login.live.com/oauth20_authorize.srf?client_id={}&response_type=code&approval_prompt=auto&scope=Xboxlive.signin%20Xboxlive.offline_access&redirect_uri=https%3A%2F%2Flogin.live.com%2Foauth20_desktop.srf",
                XBOX_CLIENT_ID
            ),
            width: 500.0,
            height: 640.0,
            success: login::SuccessMatch::UrlPrefix(
                "https://login.live.com/oauth20_desktop.srf",
            ),
            cookie_domains: &["live.com"],
            settle: false,
        }),
        ITCH => Ok(StoreLogin {
            window_label: "itch-login",
            title: "itch.io Sign In",
            url: "https://itch.io/login".to_string(),
            width: 560.0,
            height: 720.0,
            success: login::SuccessMatch::Any(&[
                login::SuccessMatch::UrlEquals("https://itch.io/"),
                login::SuccessMatch::UrlPrefix("https://itch.io/dashboard"),
                login::SuccessMatch::UrlPrefix("https://itch.io/my-collections"),
            ]),
            cookie_domains: &["itch.io", "itch.zone"],
            settle: false,
        }),
        other => Err(format!("Unknown beta store: {other}")),
    }
}

/// Public Microsoft OAuth client id used by the Playnite Xbox plugin
/// (and originally by the Xbox mobile app). Baked in because there is no
/// user-supplied app registration in this beta.
const XBOX_CLIENT_ID: &str = "38cd2fa8-66fd-4760-afb2-405eb65d5b0c";
const XBOX_REDIRECT: &str = "https://login.live.com/oauth20_desktop.srf";
const XBOX_SCOPE: &str = "Xboxlive.signin Xboxlive.offline_access";

// ── Login orchestration ────────────────────────────────────────────────

async fn begin_login(app: AppHandle, key: &str) -> Result<BetaSession, String> {
    let spec = login_spec(key)?;
    let cookie_domains = spec.cookie_domains;
    let outcome = login::run_login(
        &app,
        login::LoginSpec {
            window_label: spec.window_label,
            title: spec.title,
            url: spec.url,
            width: spec.width,
            height: spec.height,
            settle: spec.settle,
        },
        spec.success,
        cookie_domains,
    )
    .await?;

    if key == XBOX {
        return xbox_finish_login(&app, &outcome.callback_url).await;
    }

    if key == EA {
        persist_cookies(&app, key, &outcome.cookies)?;
        // EA's session is only useful if we can mint the Juno bearer token
        // the GraphQL backend expects. Validate it now so a partial login
        // (or EA's "service limitations" page) fails with a clear message
        // instead of silently on the first sync.
        if let Err(e) = ea::capture_auth_token(&app).await {
            logout(&app, key);
            return Err(e);
        }
        let session = BetaSession {
            username: String::new(),
            logged_in_at: now(),
            beta: true,
        };
        persist_session(&app, key, &session)?;
        return Ok(session);
    }

    persist_cookies(&app, key, &outcome.cookies)?;
    let username = probe_username(key, &outcome.cookies).await;
    let session = BetaSession {
        username,
        logged_in_at: now(),
        beta: true,
    };
    persist_session(&app, key, &session)?;
    Ok(session)
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn persist_cookies(app: &AppHandle, key: &str, records: &[types::CookieRecord]) -> Result<(), String> {
    let db_state = app
        .try_state::<db::Db>()
        .ok_or_else(|| "Database not initialized".to_string())?;
    let cookies = types::StoreCookies {
        captured_at: now(),
        records: records.to_vec(),
    };
    let json = serde_json::to_string(&cookies).map_err(|e| format!("serialize cookies: {e}"))?;
    db::kv::set(db_state.inner(), &format!("{key}_cookies"), &json)
}

fn persist_session(app: &AppHandle, key: &str, session: &BetaSession) -> Result<(), String> {
    let db_state = app
        .try_state::<db::Db>()
        .ok_or_else(|| "Database not initialized".to_string())?;
    let json = serde_json::to_string(session).map_err(|e| format!("serialize session: {e}"))?;
    db::kv::set(db_state.inner(), &format!("{key}_session"), &json)
}

/// Best-effort refresh of the stored display name — used when a later
/// call (a sync) learns the account name after the login probe could not.
/// A missing session is not an error; there is nothing to update.
pub(super) fn update_session_username(
    app: &AppHandle,
    key: &str,
    username: &str,
) -> Result<(), String> {
    let Some(raw) = kv_get(app, &format!("{key}_session")) else {
        return Ok(());
    };
    let Ok(mut session) = serde_json::from_str::<BetaSession>(&raw) else {
        return Ok(());
    };
    if session.username == username {
        return Ok(());
    }
    session.username = username.to_string();
    persist_session(app, key, &session)
}

async fn probe_username(key: &str, cookies: &[types::CookieRecord]) -> String {
    let host = match key {
        BATTLENET => "account.battle.net",
        EA => "accounts.ea.com",
        ITCH => "itch.io",
        _ => return String::new(),
    };
    let Ok(jar) = login::jar_from(cookies, host) else {
        return String::new();
    };
    let Ok(client) = reqwest::Client::builder()
        .user_agent(login::user_agent())
        .cookie_provider(jar)
        .timeout(std::time::Duration::from_secs(15))
        .build()
    else {
        return String::new();
    };

    let url = match key {
        BATTLENET => "https://account.battle.net/api/",
        EA => "https://gateway.ea.com/proxy/identity/pids/me",
        ITCH => "https://itch.io/api/1/session/me",
        _ => return String::new(),
    };

    let Ok(resp) = client.get(url).send().await else {
        return String::new();
    };
    if !resp.status().is_success() {
        return String::new();
    }
    let Ok(json) = resp.json::<serde_json::Value>().await else {
        return String::new();
    };

    match key {
        BATTLENET => json
            .get("battleTag")
            .or_else(|| json.get("accountName"))
            .or_else(|| json.get("displayName"))
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        EA => json
            .pointer("/pid/pidId")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        ITCH => json
            .get("user")
            .and_then(|u| u.get("username"))
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        _ => String::new(),
    }
}

async fn xbox_finish_login(app: &AppHandle, callback_url: &str) -> Result<BetaSession, String> {
    let code = login::query_param(callback_url, "code")
        .ok_or_else(|| "Microsoft sign-in did not return an authorization code".to_string())?;

    let client = reqwest::Client::builder()
        .user_agent(login::user_agent())
        .timeout(std::time::Duration::from_secs(25))
        .build()
        .map_err(|e| format!("http client: {e}"))?;
    let resp = client
        .post("https://login.live.com/oauth20_token.srf")
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code.as_str()),
            ("scope", XBOX_SCOPE),
            ("client_id", XBOX_CLIENT_ID),
            ("redirect_uri", XBOX_REDIRECT),
        ])
        .send()
        .await
        .map_err(|e| format!("Xbox token request failed: {e}"))?;
    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Xbox token parse failed: {e}"))?;
    let access_token = json
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Microsoft sign-in returned no access token".to_string())?;
    let refresh_token = json
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();

    let mut tokens = sync::xbox_authenticate(access_token).await?;
    tokens.access_token = access_token.to_string();
    tokens.refresh_token = refresh_token;
    tokens.gamertag = xbox_gamertag(&tokens).await;

    let db_state = app
        .try_state::<db::Db>()
        .ok_or_else(|| "Database not initialized".to_string())?;
    let token_json =
        serde_json::to_string(&tokens).map_err(|e| format!("serialize xbox tokens: {e}"))?;
    db::kv::set(db_state.inner(), &format!("{XBOX}_tokens"), &token_json)?;

    let session = BetaSession {
        username: tokens.gamertag.clone().unwrap_or_default(),
        logged_in_at: now(),
        beta: true,
    };
    persist_session(app, XBOX, &session)?;
    Ok(session)
}

async fn xbox_gamertag(tokens: &types::XboxAuthTokens) -> Option<String> {
    if tokens.xuid.is_empty() || tokens.token.is_empty() {
        return None;
    }
    let client = reqwest::Client::builder()
        .user_agent(login::user_agent())
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .ok()?;
    let url = format!(
        "https://profile.xboxlive.com/users/xuid({})/profile/settings?settings=Gamertag",
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
        .ok()?;
    let json: serde_json::Value = resp.json().await.ok()?;
    json.pointer("/profileUsers/0/settings/0/value")
        .and_then(|v| v.as_str())
        .map(str::to_string)
}

// ── Auth / settings state ──────────────────────────────────────────────

fn kv_get(app: &AppHandle, key: &str) -> Option<String> {
    let db_state = app.try_state::<db::Db>()?;
    db::kv::get(db_state.inner(), key).ok().flatten()
}

fn kv_delete(app: &AppHandle, key: &str) {
    if let Some(db_state) = app.try_state::<db::Db>() {
        let _ = db::kv::delete(db_state.inner(), key);
    }
}

pub fn is_authenticated(app: &AppHandle, key: &str) -> bool {
    let state_key = if key == XBOX {
        format!("{key}_tokens")
    } else {
        format!("{key}_cookies")
    };
    kv_get(app, &state_key).is_some()
}

pub fn logout(app: &AppHandle, key: &str) {
    for suffix in ["_cookies", "_session", "_tokens"] {
        kv_delete(app, &format!("{key}{suffix}"));
    }
}

pub fn load_settings(app: &AppHandle, key: &str) -> BetaSettings {
    kv_get(app, &format!("{key}_settings"))
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

pub fn save_settings(app: &AppHandle, key: &str, settings: &BetaSettings) -> Result<(), String> {
    let db_state = app
        .try_state::<db::Db>()
        .ok_or_else(|| "Database not initialized".to_string())?;
    let json = serde_json::to_string(settings).map_err(|e| format!("serialize settings: {e}"))?;
    db::kv::set(db_state.inner(), &format!("{key}_settings"), &json)
}

// ── Tauri commands ─────────────────────────────────────────────────────

macro_rules! store_commands {
    ($key:expr, $start:ident, $is_auth:ident, $logout:ident, $get:ident, $save:ident, $sync:ident) => {
        #[tauri::command]
        pub async fn $start(app: AppHandle) -> Result<BetaSession, String> {
            begin_login(app, $key).await
        }

        #[tauri::command]
        pub fn $is_auth(app: AppHandle) -> bool {
            is_authenticated(&app, $key)
        }

        #[tauri::command]
        pub fn $logout(app: AppHandle) -> Result<(), String> {
            logout(&app, $key);
            Ok(())
        }

        #[tauri::command]
        pub fn $get(app: AppHandle) -> BetaSettings {
            load_settings(&app, $key)
        }

        #[tauri::command]
        pub fn $save(app: AppHandle, settings: BetaSettings) -> Result<(), String> {
            save_settings(&app, $key, &settings)
        }

        #[tauri::command]
        pub async fn $sync(app: AppHandle) -> Result<BetaSyncResult, String> {
            sync::sync_store(&app, $key).await
        }
    };
}

store_commands!(
    BATTLENET,
    battlenet_start_login,
    battlenet_is_authenticated,
    battlenet_logout,
    battlenet_get_settings,
    battlenet_save_settings,
    battlenet_sync_library
);

store_commands!(
    EA,
    ea_start_login,
    ea_is_authenticated,
    ea_logout,
    ea_get_settings,
    ea_save_settings,
    ea_sync_library
);

store_commands!(
    XBOX,
    xbox_start_login,
    xbox_is_authenticated,
    xbox_logout,
    xbox_get_settings,
    xbox_save_settings,
    xbox_sync_library
);

store_commands!(
    ITCH,
    itch_start_login,
    itch_is_authenticated,
    itch_logout,
    itch_get_settings,
    itch_save_settings,
    itch_sync_library
);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_store_has_a_login_spec() {
        for key in STORES {
            let spec = login_spec(key).expect("login spec");
            assert!(!spec.url.is_empty());
            assert!(!spec.cookie_domains.is_empty());
        }
    }

    #[test]
    fn unknown_store_is_rejected() {
        assert!(login_spec("nope").is_err());
    }

    #[test]
    fn xbox_uses_token_backed_auth() {
        // The auth probe keys off `_tokens` for Xbox and `_cookies` else.
        assert_eq!("xbox_tokens", format!("{XBOX}_tokens"));
        assert_eq!("ea_cookies", format!("{EA}_cookies"));
    }
}
