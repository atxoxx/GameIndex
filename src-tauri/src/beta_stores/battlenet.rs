//! Battle.net library capture through the account site's own session.
//!
//! The account website's API (`account.battle.net/api/…`) only answers
//! as the signed-in user for requests that come from the browser
//! session itself: its SPA calls carry `credentials: include` plus the
//! `X-XSRF-TOKEN` header, and the short-lived account session is
//! silently re-issued through an OAuth2 authorization redirect whenever
//! it goes stale. Replaying captured cookies from a plain HTTP client
//! therefore stops working as soon as that session rotates.
//!
//! This mirrors Playnite's `BattleNetAccountClient` instead: a hidden
//! WebView sharing the app's signed-in profile first walks the
//! `oauth2/authorization/account-settings` redirect to refresh the
//! session, then fetches `/api/` and `/api/games-and-subs` from the
//! page context with the site's own headers. The response is handed
//! back by navigating to a sentinel URL the capture watches — the same
//! remote-page handoff the EA integration uses, so it never depends on
//! the third-party page being able to reach Tauri's IPC.

use std::sync::mpsc;
use std::time::Duration;

use base64::{engine::general_purpose, Engine as _};
use serde_json::Value;
use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};

use super::types::BetaSyncedGame;

/// Playnite's `loginUri`: re-running the authorization redirect renews
/// the account session while the SSO cookie is still valid.
const REFRESH_URL: &str = "https://account.battle.net/oauth2/authorization/account-settings";

const WINDOW_LABEL: &str = "battlenet-sync";

/// URL the injected script navigates to with the base64-encoded account
/// response once it has one. The navigation is cancelled, the payload
/// rides in the path.
const GAMES_SENTINEL: &str = "https://account.battle.net/__gi_bnet_games__/";
/// URL the script navigates to with a percent-encoded failure summary.
const ERROR_SENTINEL: &str = "https://account.battle.net/__gi_bnet_error__/";

const CAPTURE_TIMEOUT_SECS: u64 = 30;

/// Runs in every document the capture window loads. Only the account
/// site itself counts — the OAuth2 refresh chain also visits
/// `oauth.battle.net` and the regional login host.
fn init_script() -> String {
    r#"
(function () {
    if (location.hostname !== 'account.battle.net') return;
    if (window.__GI_BNET_HOOKED__) return;
    window.__GI_BNET_HOOKED__ = true;

    var OK = 'https://account.battle.net/__gi_bnet_games__/';
    var ERR = 'https://account.battle.net/__gi_bnet_error__/';

    function fail(message) {
        try { window.location.href = ERR + encodeURIComponent(String(message).slice(0, 300)); } catch (e) {}
    }

    function toBase64(text) {
        try {
            var bytes = new TextEncoder().encode(text);
            var binary = '';
            for (var i = 0; i < bytes.length; i += 0x8000) {
                binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
            }
            return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        } catch (e) {
            return '';
        }
    }

    function headers() {
        var out = { 'Accept': 'application/json', 'Content-Type': 'application/json' };
        var m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
        if (m) out['X-XSRF-TOKEN'] = decodeURIComponent(m[1]);
        return out;
    }

    function getJson(path) {
        return fetch(path, {
            method: 'GET',
            credentials: 'include',
            keepalive: true,
            headers: headers()
        }).then(function (r) {
            return r.text().then(function (t) { return { status: r.status, text: t }; });
        });
    }

    function fetchGames(info) {
        return getJson('/api/games-and-subs').then(function (games) {
            if (games.status < 200 || games.status >= 300) {
                fail('the account API returned HTTP ' + games.status + ' — reconnect the account');
                return;
            }
            var data = null;
            try { data = JSON.parse(games.text); } catch (e) {}
            if (!data || !Array.isArray(data.gameAccounts)) {
                fail('the account API returned an unexpected response');
                return;
            }
            var slim = data.gameAccounts.map(function (a) {
                return {
                    titleId: a.titleId,
                    localizedGameName: a.localizedGameName,
                    gameName: a.gameName
                };
            });
            var payload = toBase64(JSON.stringify({
                battleTag: info.battleTag || info.accountName || info.displayName || '',
                gameAccounts: slim
            }));
            if (!payload) {
                fail('could not encode the account response');
                return;
            }
            try { window.location.href = OK + payload; } catch (e) {}
        });
    }

    // The refresh chain settles on this document; the session can still
    // be a beat behind it (and an in-flight page navigation aborts the
    // fetch), so check a few times before giving up. A new document
    // restarts the script fresh.
    function attempt(remaining) {
        getJson('/api/')
            .then(function (api) {
                var info = null;
                try { info = JSON.parse(api.text); } catch (e) {}
                if (info && info.authenticated === true) {
                    return fetchGames(info);
                }
                if (remaining > 0) {
                    setTimeout(function () { attempt(remaining - 1); }, 700);
                    return;
                }
                fail('the Battle.net session is not signed in — reconnect the account');
            })
            .catch(function (e) {
                if (remaining > 0) {
                    setTimeout(function () { attempt(remaining - 1); }, 700);
                    return;
                }
                fail('the account request failed: ' + (e && e.message ? e.message : e));
            });
    }

    attempt(6);
})();
"#
    .to_string()
}

/// Open the hidden session window, refresh the account session, and
/// fetch the owned-games payload. Returns the slimmed account response:
/// `{ battleTag, gameAccounts: [{ titleId, localizedGameName, gameName }] }`.
pub async fn capture_library(app: &AppHandle) -> Result<Value, String> {
    let (tx, rx) = mpsc::channel::<Result<String, String>>();

    let url: url::Url = REFRESH_URL
        .parse()
        .map_err(|e| format!("invalid Battle.net session url: {e}"))?;
    let webview = WebviewWindowBuilder::new(app, WINDOW_LABEL, WebviewUrl::External(url))
        .title("Battle.net")
        .inner_size(640.0, 480.0)
        .visible(false)
        .initialization_script(&init_script())
        .on_navigation(move |url| {
            let current = url.as_str();
            if let Some(payload) = payload_from_sentinel(current) {
                let _ = tx.send(Ok(payload.to_string()));
                return false;
            }
            if let Some(report) = error_from_sentinel(current) {
                let _ = tx.send(Err(report));
                return false;
            }
            // The SSO session is gone: the refresh chain landed on a
            // regional login form. Fail now instead of waiting out the
            // timeout on a page nobody can see.
            if is_battlenet_login(url) {
                let _ = tx.send(Err(
                    "the Battle.net session has expired — reconnect the account".to_string(),
                ));
                return false;
            }
            true
        })
        .build()
        .map_err(|e| format!("Failed to open Battle.net session window: {e}"))?;

    let result = tokio::task::spawn_blocking(move || {
        rx.recv_timeout(Duration::from_secs(CAPTURE_TIMEOUT_SECS))
    })
    .await
    .map_err(|e| format!("join error: {e}"))?;

    let _ = webview.close();

    match result {
        Ok(Ok(encoded)) => decode_payload(&encoded),
        Ok(Err(message)) => Err(message),
        Err(_) => Err(
            "Battle.net did not answer in time — reconnect the account and try again".to_string(),
        ),
    }
}

/// The base64 payload carried by a [`GAMES_SENTINEL`] navigation.
fn payload_from_sentinel(url: &str) -> Option<&str> {
    url.strip_prefix(GAMES_SENTINEL).filter(|p| !p.is_empty())
}

/// The decoded failure summary carried by an [`ERROR_SENTINEL`]
/// navigation.
fn error_from_sentinel(url: &str) -> Option<String> {
    url.strip_prefix(ERROR_SENTINEL)
        .filter(|r| !r.is_empty())
        .map(decode_component)
}

/// Percent-decode a sentinel payload (the injected script URL-encodes it).
fn decode_component(raw: &str) -> String {
    urlencoding::decode(raw)
        .map(|cow| cow.into_owned())
        .unwrap_or_else(|_| raw.to_string())
}

/// True for a Battle.net sign-in page (any region host). The refresh
/// chain ends here when the SSO cookie no longer works.
fn is_battlenet_login(url: &url::Url) -> bool {
    let host = url.host_str().unwrap_or("").to_ascii_lowercase();
    let on_battlenet =
        host == "battle.net" || host.ends_with(".battle.net");
    on_battlenet && url.path().starts_with("/login")
}

/// Decode the base64url payload handed over by the sentinel navigation.
fn decode_payload(encoded: &str) -> Result<Value, String> {
    let bytes = general_purpose::URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|e| format!("Battle.net library payload decode failed: {e}"))?;
    let text = String::from_utf8(bytes)
        .map_err(|e| format!("Battle.net library payload was not text: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("Battle.net library payload parse failed: {e}"))
}

/// Map the slimmed account response into library games.
///
/// `titleId` is a JSON number on the wire (Playnite's model types it as
/// a `long`), so both numbers and strings are accepted — reading it as a
/// string only, as this once did, silently skipped every owned game.
/// Entries without a usable id are dropped; the display name falls back
/// to `gameName`, then to the id.
pub fn games_from_payload(payload: &Value) -> Vec<BetaSyncedGame> {
    let empty = Vec::new();
    let accounts = payload
        .get("gameAccounts")
        .and_then(|v| v.as_array())
        .unwrap_or(&empty);

    let mut games = Vec::new();
    for entry in accounts {
        let Some(title_id) = title_id(entry) else {
            continue;
        };
        let title = entry
            .get("localizedGameName")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .or_else(|| {
                entry
                    .get("gameName")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
            })
            .unwrap_or(&title_id);
        games.push(BetaSyncedGame {
            id: format!("battlenet-{}", super::sync::slug(&title_id)),
            title: title.to_string(),
            store_game_id: Some(title_id),
            is_installed: false,
            install_path: None,
            cover_url: None,
            playtime_minutes: None,
            last_played: None,
        });
    }
    games
}

/// The account's `titleId` for a game-account entry, accepting both the
/// numeric form the API actually sends and a string form.
fn title_id(entry: &Value) -> Option<String> {
    let value = entry.get("titleId")?;
    if let Some(s) = value.as_str() {
        return if s.is_empty() {
            None
        } else {
            Some(s.to_string())
        };
    }
    value
        .as_i64()
        .map(|n| n.to_string())
        .or_else(|| value.as_u64().map(|n| n.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn games_from_payload_maps_numeric_title_ids() {
        let payload = serde_json::json!({
            "battleTag": "Player#1234",
            "gameAccounts": [
                { "titleId": 17459, "localizedGameName": "World of Warcraft" },
                { "titleId": 1465140039, "localizedGameName": "Diablo IV" }
            ]
        });
        let games = games_from_payload(&payload);
        assert_eq!(games.len(), 2);
        assert_eq!(games[0].id, "battlenet-17459");
        assert_eq!(games[0].title, "World of Warcraft");
        assert_eq!(games[0].store_game_id.as_deref(), Some("17459"));
        assert_eq!(games[1].id, "battlenet-1465140039");
    }

    #[test]
    fn games_from_payload_accepts_string_title_ids() {
        let payload = serde_json::json!({
            "gameAccounts": [{ "titleId": "WOW", "localizedGameName": "World of Warcraft" }]
        });
        let games = games_from_payload(&payload);
        assert_eq!(games.len(), 1);
        assert_eq!(games[0].id, "battlenet-wow");
    }

    #[test]
    fn games_from_payload_skips_entries_without_a_title_id() {
        let payload = serde_json::json!({
            "gameAccounts": [
                { "localizedGameName": "No id" },
                { "titleId": null, "localizedGameName": "Null id" },
                { "titleId": "", "localizedGameName": "Empty id" },
                { "titleId": 7, "localizedGameName": "Kept" }
            ]
        });
        let games = games_from_payload(&payload);
        assert_eq!(games.len(), 1);
        assert_eq!(games[0].title, "Kept");
    }

    #[test]
    fn games_from_payload_falls_back_to_game_name_then_id() {
        let payload = serde_json::json!({
            "gameAccounts": [
                { "titleId": 1, "localizedGameName": "", "gameName": "Fallback" },
                { "titleId": 2 }
            ]
        });
        let games = games_from_payload(&payload);
        assert_eq!(games[0].title, "Fallback");
        assert_eq!(games[1].title, "2");
    }

    #[test]
    fn games_from_payload_tolerates_a_missing_list() {
        assert!(games_from_payload(&serde_json::json!({})).is_empty());
        assert!(games_from_payload(&serde_json::json!({ "gameAccounts": 3 })).is_empty());
    }

    #[test]
    fn sentinel_urls_carry_the_payload_and_diagnostics() {
        assert_eq!(
            payload_from_sentinel("https://account.battle.net/__gi_bnet_games__/eyJhIjoxfQ"),
            Some("eyJhIjoxfQ")
        );
        assert_eq!(
            payload_from_sentinel("https://account.battle.net/__gi_bnet_games__/"),
            None
        );
        assert_eq!(payload_from_sentinel("https://account.battle.net/overview"), None);

        assert_eq!(
            error_from_sentinel(
                "https://account.battle.net/__gi_bnet_error__/session%20expired"
            )
            .as_deref(),
            Some("session expired")
        );
        assert_eq!(error_from_sentinel("https://account.battle.net/overview"), None);
    }

    #[test]
    fn decode_payload_roundtrips_utf8_json() {
        let json = r#"{"battleTag":"Spieler#1","gameAccounts":[{"titleId":5,"localizedGameName":"Ünïcødé"}]}"#;
        let encoded = general_purpose::URL_SAFE_NO_PAD.encode(json.as_bytes());
        let value = decode_payload(&encoded).expect("should decode");
        let games = games_from_payload(&value);
        assert_eq!(games.len(), 1);
        assert_eq!(games[0].title, "Ünïcødé");

        assert!(decode_payload("not base64!!").is_err());
    }

    #[test]
    fn battlenet_login_pages_are_recognised_per_region() {
        let login = url::Url::parse("https://eu.account.battle.net/login/en-us/password").unwrap();
        assert!(is_battlenet_login(&login));

        let overview = url::Url::parse("https://account.battle.net/overview").unwrap();
        assert!(!is_battlenet_login(&overview));

        let authorize = url::Url::parse("https://oauth.battle.net/authorize?x=1").unwrap();
        assert!(!is_battlenet_login(&authorize));

        let other = url::Url::parse("https://example.com/login").unwrap();
        assert!(!is_battlenet_login(&other));
    }
}
