//! EA app authentication + library access via EA's current "Juno"
//! backend.
//!
//! EA retired the old `accounts.ea.com/connect/auth?client_id=ORIGIN_SPA_ID`
//! web login: opening it now lands on an EA error page ("Service
//! limitations apply"). The EA website itself signs in at `ea.com/login`
//! and then talks to its GraphQL backend at
//! `service-aggregation-layer.juno.ea.com/graphql`, attaching a bearer
//! token as an `authorization` header.
//!
//! Because that token never appears in a cookie, we capture it the same
//! way Playnite's EA plugin does: load the site in a WebView with an
//! injected hook that mirrors the `authorization` header off the app's
//! own GraphQL request. The hook hands the bearer back by navigating to a
//! sentinel URL that the login runner watches, so the handoff does not
//! depend on the remote page having Tauri IPC access. The captured bearer
//! is then replayed against the persisted "owned games" query.

use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::Value;
use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};

use super::types::BetaSyncedGame;

/// Where the interactive sign-in happens.
pub const EA_LOGIN_URL: &str = "https://www.ea.com/login";
/// The URL the site lands on once signed in.
pub const EA_HOME_URL: &str = "https://www.ea.com/";
/// A page the signed-in app loads that issues a GraphQL request — used to
/// passively capture the bearer token.
const EA_TOKEN_URL: &str = "https://www.ea.com/sales/deals";

const EA_WINDOW_LABEL: &str = "ea-login";
const EA_TOKEN_LABEL: &str = "ea-token";

const EA_GRAPHQL_URL: &str = "https://service-aggregation-layer.juno.ea.com/graphql";
const OWNED_GAMES_HASH: &str =
    "779f1cd1355699752e20c0b3877847f4e3010ef5de131c248e98f8eff84f0718";

/// URL the injected script navigates to once it has the bearer token. The
/// token rides in the path and the navigation is cancelled, so the handoff
/// never depends on the remote page being able to reach Tauri's IPC.
const EA_TOKEN_SENTINEL: &str = "https://www.ea.com/__gi_ea_token__/";
/// URL the script navigates to with a short summary if it never finds a
/// token, so a failed capture reports what it actually saw.
const EA_DEBUG_SENTINEL: &str = "https://www.ea.com/__gi_ea_debug__/";

/// How long we wait for the page to surface a bearer token.
const EA_CAPTURE_TIMEOUT_SECS: u64 = 25;

/// Mirror the `authorization` header off the page's own fetch/XHR calls to
/// the Juno GraphQL endpoint, then hand the token back by navigating to a
/// sentinel URL (see [`EA_TOKEN_SENTINEL`]). Navigating works even though the
/// page is remote and cannot use Tauri's IPC.
fn init_script() -> String {
    r#"
(function () {
    if (window.__GI_EA_HOOKED__) return;
    window.__GI_EA_HOOKED__ = true;

    var GRAPHQL = 'service-aggregation-layer.juno.ea.com';
    var TOKEN_URL = 'https://www.ea.com/__gi_ea_token__/';
    var DEBUG_URL = 'https://www.ea.com/__gi_ea_debug__/';

    var seen = 0, withAuth = 0, reported = false, hosts = {};

    function isGraphql(url) {
        return url && String(url).indexOf(GRAPHQL) >= 0;
    }

    function note(url) {
        seen++;
        try {
            var h = String(url).split('/')[2] || '';
            hosts[h] = (hosts[h] || 0) + 1;
        } catch (e) {}
    }

    function report(header) {
        if (reported) return;
        var token = header ? String(header).replace(/^Bearer\s+/i, '').trim() : '';
        if (!token) return;
        reported = true;
        try { window.location.href = TOKEN_URL + token; } catch (e) {}
    }

    function pick(headers) {
        try {
            if (!headers) return null;
            if (typeof headers.get === 'function') {
                return headers.get('authorization') || headers.get('Authorization');
            }
            if (Array.isArray(headers)) {
                for (var i = 0; i < headers.length; i++) {
                    if (String(headers[i][0]).toLowerCase() === 'authorization') return headers[i][1];
                }
                return null;
            }
            for (var k in headers) {
                try { if (String(k).toLowerCase() === 'authorization') return headers[k]; } catch (e) {}
            }
        } catch (e) {}
        return null;
    }

    var origFetch = window.fetch;
    if (origFetch) {
        window.fetch = function (input, init) {
            try {
                var url = typeof input === 'string' ? input : (input && input.url);
                if (isGraphql(url)) {
                    note(url);
                    var header = pick((init && init.headers) || (input && input.headers));
                    if (header) { withAuth++; report(header); }
                }
            } catch (e) {}
            return origFetch.apply(this, arguments);
        };
    }

    var origOpen = XMLHttpRequest.prototype.open;
    var origSet = XMLHttpRequest.prototype.setRequestHeader;
    var origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
        try { this.__giUrl = url; } catch (e) {}
        return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
        try { if (String(name).toLowerCase() === 'authorization') this.__giAuth = value; } catch (e) {}
        return origSet.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
        try {
            if (isGraphql(this.__giUrl)) {
                note(this.__giUrl);
                if (this.__giAuth) { withAuth++; report(this.__giAuth); }
            }
        } catch (e) {}
        return origSend.apply(this, arguments);
    };

    setTimeout(function () {
        if (reported) return;
        try {
            window.location.href = DEBUG_URL + encodeURIComponent(
                'graphql requests=' + seen + ', with auth=' + withAuth + ', hosts=' + JSON.stringify(hosts)
            );
        } catch (e) {}
    }, 15000);
})();
"#
    .to_string()
}

/// Load the EA site in a hidden WebView and capture the bearer token its
/// app sends to the Juno GraphQL backend. Cookies are shared with the
/// login window through the WebView2 profile, so an existing session is
/// reused.
pub async fn capture_auth_token(app: &AppHandle) -> Result<String, String> {
    let (tx, rx) = mpsc::channel::<String>();
    let debug: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let debug_slot = Arc::clone(&debug);

    let url: url::Url = EA_TOKEN_URL
        .parse()
        .map_err(|e| format!("invalid EA token url: {e}"))?;
    let webview = WebviewWindowBuilder::new(app, EA_TOKEN_LABEL, WebviewUrl::External(url))
        .title("EA")
        .inner_size(640.0, 480.0)
        .visible(false)
        .initialization_script(&init_script())
        .on_navigation(move |url| {
            let current = url.as_str();
            if let Some(token) = token_from_sentinel(current) {
                let _ = tx.send(token.to_string());
                return false;
            }
            if let Some(report) = debug_from_sentinel(current) {
                if let Ok(mut guard) = debug_slot.lock() {
                    *guard = Some(report);
                }
                return false;
            }
            true
        })
        .build()
        .map_err(|e| format!("Failed to open EA session window: {e}"))?;

    let result = tokio::task::spawn_blocking(move || {
        rx.recv_timeout(Duration::from_secs(EA_CAPTURE_TIMEOUT_SECS))
    })
    .await
    .map_err(|e| format!("join error: {e}"))?;

    let _ = webview.close();

    match result {
        Ok(token) if !token.is_empty() => Ok(token),
        _ => {
            let detail = debug.lock().ok().and_then(|guard| guard.clone());
            Err(match detail {
                Some(d) if !d.is_empty() => format!(
                    "Could not read an EA session token ({d}). Sign in to ea.com in the login window, then try again."
                ),
                _ => "Could not read an EA session token. Sign in to ea.com in the login window, then try again."
                    .to_string(),
            })
        }
    }
}

/// The bearer token carried by an [`EA_TOKEN_SENTINEL`] navigation, if any.
fn token_from_sentinel(url: &str) -> Option<&str> {
    url.strip_prefix(EA_TOKEN_SENTINEL).filter(|t| !t.is_empty())
}

/// The decoded diagnostic summary carried by an [`EA_DEBUG_SENTINEL`]
/// navigation, if any.
fn debug_from_sentinel(url: &str) -> Option<String> {
    url.strip_prefix(EA_DEBUG_SENTINEL)
        .filter(|report| !report.is_empty())
        .map(percent_decode)
}

/// Percent-decode a sentinel payload (the injected script URL-encodes the
/// debug summary).
fn percent_decode(raw: &str) -> String {
    urlencoding::decode(raw)
        .map(|cow| cow.into_owned())
        .unwrap_or_else(|_| raw.to_string())
}

/// Build the persisted "owned games" GraphQL URL for one page of results.
pub fn owned_games_url(offset: &str) -> String {
    let variables = serde_json::json!({
        "isMac": false,
        "addFieldsToPreloadGames": true,
        "locale": "en",
        "limit": 500,
        "next": offset,
        "type": ["DIGITAL_FULL_GAME", "PACKAGED_FULL_GAME"],
        "entitlementEnabled": true,
        "storefronts": ["EA", "STEAM", "EPIC"],
        "ownershipMethods": [
            "UNKNOWN", "ASSOCIATION", "PURCHASE", "REDEMPTION", "GIFT_RECEIPT",
            "ENTITLEMENT_GRANT", "DIRECT_ENTITLEMENT", "PRE_ORDER_PURCHASE",
            "VAULT", "XGP_VAULT", "STEAM", "STEAM_VAULT", "STEAM_SUBSCRIPTION",
            "EPIC", "EPIC_VAULT", "EPIC_SUBSCRIPTION"
        ],
        "platforms": ["PC"]
    });
    let variables_json = variables.to_string();
    let variables_enc = urlencoding::encode(&variables_json);
    let extensions_json =
        format!(r#"{{"persistedQuery":{{"version":1,"sha256Hash":"{OWNED_GAMES_HASH}"}}}}"#);
    let extensions_enc = urlencoding::encode(&extensions_json);
    format!(
        "{EA_GRAPHQL_URL}?operationName=getPreloadedOwnedGames&variables={variables_enc}&extensions={extensions_enc}"
    )
}

/// Map one `ownedGameProducts.items[]` entry to a library game.
pub fn owned_game_to_synced(item: &Value) -> Option<BetaSyncedGame> {
    let offer_id = item
        .get("originOfferId")
        .and_then(|v| v.as_str())
        .or_else(|| item.get("offerId").and_then(|v| v.as_str()))?;
    let product = item.get("product");
    let title = product
        .and_then(|p| p.get("name"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or(offer_id);
    Some(BetaSyncedGame {
        id: format!("ea-{}", super::sync::slug(offer_id)),
        title: title.to_string(),
        store_game_id: Some(offer_id.to_string()),
        is_installed: false,
        install_path: None,
        cover_url: None,
        playtime_minutes: None,
        last_played: None,
    })
}

/// Window label used by the interactive EA login WebView.
pub fn window_label() -> &'static str {
    EA_WINDOW_LABEL
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn owned_game_maps_offer_and_title() {
        let item = serde_json::json!({
            "originOfferId": "Origin.OFR:12345",
            "product": { "name": "Mass Effect", "gameSlug": "mass-effect" }
        });
        let game = owned_game_to_synced(&item).expect("should map");
        assert_eq!(game.id, "ea-origin-ofr-12345");
        assert_eq!(game.title, "Mass Effect");
        assert_eq!(game.store_game_id.as_deref(), Some("Origin.OFR:12345"));
    }

    #[test]
    fn owned_game_falls_back_to_offer_id_when_nameless() {
        let item = serde_json::json!({ "originOfferId": "OFB-EAST:99", "product": {} });
        let game = owned_game_to_synced(&item).expect("should map");
        assert_eq!(game.title, "OFB-EAST:99");
    }

    #[test]
    fn owned_game_rejects_entries_without_offer_id() {
        assert!(owned_game_to_synced(&serde_json::json!({ "product": {} })).is_none());
    }

    #[test]
    fn owned_games_url_contains_persisted_hash() {
        let url = owned_games_url("0");
        assert!(url.starts_with("https://service-aggregation-layer.juno.ea.com/graphql?"));
        assert!(url.contains("operationName=getPreloadedOwnedGames"));
        assert!(url.contains(OWNED_GAMES_HASH));
    }

    #[test]
    fn sentinel_urls_carry_the_token_and_diagnostics() {
        assert_eq!(
            token_from_sentinel("https://www.ea.com/__gi_ea_token__/eyJhbGciOiJIUzI1NiJ9"),
            Some("eyJhbGciOiJIUzI1NiJ9")
        );
        assert_eq!(token_from_sentinel("https://www.ea.com/sales/deals"), None);
        assert_eq!(token_from_sentinel("https://www.ea.com/__gi_ea_token__/"), None);

        assert_eq!(
            debug_from_sentinel("https://www.ea.com/__gi_ea_debug__/requests%3D3%2C%20with%20auth%3D1")
                .as_deref(),
            Some("requests=3, with auth=1")
        );
        assert_eq!(debug_from_sentinel("https://www.ea.com/"), None);
    }
}
