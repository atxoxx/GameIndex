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
//! own GraphQL request, then hand it back to Rust. The captured bearer
//! is then replayed against the persisted "owned games" query.

use std::sync::mpsc;
use std::sync::{Mutex, OnceLock};
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

/// Single-slot handoff for the injected script's captured token.
static TOKEN_SLOT: OnceLock<Mutex<Option<mpsc::Sender<String>>>> = OnceLock::new();

fn slot() -> &'static Mutex<Option<mpsc::Sender<String>>> {
    TOKEN_SLOT.get_or_init(|| Mutex::new(None))
}

/// Invoked by the injected script when the EA web app attaches an
/// `authorization` header to a Juno GraphQL request. Stores the raw
/// bearer value for the awaiting `capture_auth_token` call.
#[tauri::command]
pub fn ea_callback(token: String) -> Result<(), String> {
    let sender = slot()
        .lock()
        .map_err(|e| format!("EA token slot mutex: {e}"))?
        .take();
    match sender {
        Some(tx) => tx
            .send(token)
            .map_err(|_| "EA token receiver already dropped".to_string()),
        None => Err("No pending EA token capture".to_string()),
    }
}

/// Mirror the `authorization` header off the page's own fetch/XHR calls
/// to the Juno GraphQL endpoint.
fn init_script() -> String {
    r#"
(function () {
    if (window.__GI_EA_HOOKED__) return;
    window.__GI_EA_HOOKED__ = true;
    var TARGET = 'service-aggregation-layer.juno.ea.com/graphql';

    function report(header) {
        if (!header) return;
        var token = String(header).replace(/^Bearer\s+/i, '').trim();
        if (!token) return;
        try {
            var invoke = (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke)
                || window.__TAURI_INTERNALS__.invoke;
            invoke('ea_callback', { token: token });
        } catch (e) {}
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
                if (url && String(url).indexOf(TARGET) >= 0) report(pick(init && init.headers));
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
            if (this.__giUrl && String(this.__giUrl).indexOf(TARGET) >= 0) report(this.__giAuth);
        } catch (e) {}
        return origSend.apply(this, arguments);
    };
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
    {
        let mut guard = slot().lock().map_err(|e| format!("EA token slot mutex: {e}"))?;
        *guard = Some(tx);
    }

    let url: url::Url = EA_TOKEN_URL
        .parse()
        .map_err(|e| format!("invalid EA token url: {e}"))?;
    let webview = WebviewWindowBuilder::new(app, EA_TOKEN_LABEL, WebviewUrl::External(url))
        .title("EA")
        .inner_size(640.0, 480.0)
        .visible(false)
        .initialization_script(&init_script())
        .build()
        .map_err(|e| format!("Failed to open EA session window: {e}"))?;

    let result = tokio::task::spawn_blocking(move || rx.recv_timeout(Duration::from_secs(25)))
        .await
        .map_err(|e| format!("join error: {e}"))?;

    let _ = webview.close();
    // Ensure a late callback can't leak into a future capture.
    if let Ok(mut guard) = slot().lock() {
        *guard = None;
    }

    match result {
        Ok(token) if !token.is_empty() => Ok(token),
        _ => Err(
            "Could not read an EA session token. Sign in to ea.com in the login window, then try again."
                .to_string(),
        ),
    }
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
}
