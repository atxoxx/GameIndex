//! Shared WebView login + cookie-capture helper for the beta stores.
//!
//! All four beta stores authenticate the same way Playnite's library
//! plugins do: drive a Tauri WebView to the store's own login page and
//! watch the navigation until it lands on a post-login URL. What changes
//! per store is only:
//!
//! - the login URL,
//! - the "success" navigation predicate,
//! - which cookie domains to keep,
//! - and what we do with the captured result (Xbox extracts an OAuth
//!   `code` from the callback URL instead of relying on cookies).
//!
//! The actual store logins are third-party pages we do not control; no
//! store password is ever read by GameIndex — we only snapshot the
//! session the store itself establishes.

use std::sync::mpsc;
use std::time::Duration;

use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use super::types::CookieRecord;

/// How `run_login` recognises a successful login navigation.
#[derive(Debug, Clone, Copy)]
pub enum SuccessMatch {
    /// Navigation reached a URL starting with this prefix.
    UrlPrefix(&'static str),
    /// Navigation reached exactly this URL.
    UrlEquals(&'static str),
    /// Any of the nested matchers matched.
    Any(&'static [SuccessMatch]),
}

impl SuccessMatch {
    fn is_match(&self, url: &str) -> bool {
        match self {
            SuccessMatch::UrlPrefix(prefix) => url.starts_with(prefix),
            SuccessMatch::UrlEquals(exact) => url == *exact,
            SuccessMatch::Any(matchers) => matchers.iter().any(|m| m.is_match(url)),
        }
    }
}

/// Everything the generic login runner needs to open one store's window.
pub struct LoginSpec {
    pub window_label: &'static str,
    pub title: &'static str,
    pub url: String,
    pub width: f64,
    pub height: f64,
    /// When true, the success navigation is allowed to complete and the
    /// cookie snapshot waits for that page to finish loading. Stores
    /// whose session is minted by the landing page response itself (or
    /// by the page's own scripts) need this: blocking the navigation
    /// means the response — and any `Set-Cookie` on it — is never
    /// processed, so a snapshot taken right after the match is anonymous.
    pub settle: bool,
}

/// Outcome of a completed login: the URL that triggered the success match
/// plus the cookies captured off the (still-open, until closed) WebView.
pub struct LoginOutcome {
    pub callback_url: String,
    pub cookies: Vec<CookieRecord>,
}

const LOGIN_TIMEOUT_SECS: u64 = 300;

/// How long a `settle` login waits for the success page to finish
/// loading before snapshotting the cookies anyway.
const SETTLE_TIMEOUT_SECS: u64 = 12;

const BROWSER_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/// Open `spec` in a WebView and block until `success` matches a
/// navigation (or the timeout elapses). The matched URL is captured, the
/// store's cookies are snapshotted, and the window is closed before
/// returning.
pub async fn run_login(
    app: &AppHandle,
    spec: LoginSpec,
    success: SuccessMatch,
    cookie_domains: &[&str],
) -> Result<LoginOutcome, String> {
    eprintln!(
        "[beta-stores] opening {} login WebView...",
        spec.window_label
    );

    let url: url::Url = spec
        .url
        .parse()
        .map_err(|e| format!("invalid login url: {e}"))?;
    let (tx, rx) = mpsc::channel::<String>();
    let (page_tx, mut page_rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    let settle = spec.settle;

    let webview = WebviewWindowBuilder::new(app, spec.window_label, WebviewUrl::External(url))
        .title(spec.title)
        .inner_size(spec.width, spec.height)
        .resizable(false)
        .on_navigation(move |url| {
            if success.is_match(url.as_str()) {
                let _ = tx.send(url.as_str().to_string());
                // Normally stop the navigation so the window does not
                // flash a redirect page before we close it. A `settle`
                // store needs the response processed instead — that is
                // where its session cookie comes from.
                return !settle;
            }
            true
        })
        .on_page_load(move |_window, payload| {
            if matches!(payload.event(), PageLoadEvent::Finished) {
                let _ = page_tx.send(payload.url().to_string());
            }
        })
        .build()
        .map_err(|e| format!("Failed to open login window: {e}"))?;

    let callback_url = match tokio::task::spawn_blocking(move || {
        rx.recv_timeout(Duration::from_secs(LOGIN_TIMEOUT_SECS))
    })
    .await
    .map_err(|e| format!("join error: {e}"))?
    {
        Ok(url) => url,
        Err(_) => {
            let _ = webview.close();
            return Err(format!(
                "Login timed out after {LOGIN_TIMEOUT_SECS} seconds — please try again"
            ));
        }
    };

    if settle {
        let _ = tokio::time::timeout(
            Duration::from_secs(SETTLE_TIMEOUT_SECS),
            wait_for_same_origin(&mut page_rx, &callback_url),
        )
        .await;
    }

    // Cookies survive only while the window is alive, so snapshot before
    // closing it.
    let cookies = capture_cookies(app, spec.window_label, cookie_domains)?;
    let _ = webview.close();

    Ok(LoginOutcome {
        callback_url,
        cookies,
    })
}

/// Resolve once a finished page load on the same origin as
/// `callback_url` has been observed. Used by `settle` logins to give the
/// success page time to set its session; the caller bounds the wait.
async fn wait_for_same_origin(
    rx: &mut tokio::sync::mpsc::UnboundedReceiver<String>,
    callback_url: &str,
) {
    let Ok(target) = url::Url::parse(callback_url) else {
        return;
    };
    while let Some(loaded) = rx.recv().await {
        if same_origin(&loaded, &target) {
            return;
        }
    }
}

/// True when both URLs parse and share a scheme/host/port origin.
pub fn same_origin(a: &str, b: &url::Url) -> bool {
    url::Url::parse(a)
        .map(|u| u.origin() == b.origin())
        .unwrap_or(false)
}

/// Snapshot the cookies currently held by `label`, keeping only those
/// whose domain belongs to one of `domains`.
pub fn capture_cookies(
    app: &AppHandle,
    label: &str,
    domains: &[&str],
) -> Result<Vec<CookieRecord>, String> {
    let webview = app
        .get_webview_window(label)
        .ok_or_else(|| format!("{label} WebView not found — may have closed early"))?;
    let raw = webview
        .cookies()
        .map_err(|e| format!("cookies(): {e}"))?;

    let records = raw
        .iter()
        .filter_map(|c| {
            let name = c.name().to_string();
            let domain = c.domain().unwrap_or("").to_string();
            if name.is_empty() || !domain_matches(&domain, domains) {
                return None;
            }
            Some(CookieRecord {
                name,
                value: c.value().to_string(),
                domain: opt_str(c.domain()),
                path: opt_str(c.path()),
            })
        })
        .collect();

    Ok(records)
}

/// Build a `reqwest::cookie::Jar` from a captured cookie set so a fresh
/// client carries the store session on every request. `default_host` is
/// used when a record has no domain attached.
pub fn jar_from(
    cookies: &[CookieRecord],
    default_host: &str,
) -> Result<std::sync::Arc<reqwest::cookie::Jar>, String> {
    let jar = reqwest::cookie::Jar::default();
    for rec in cookies {
        let mut s = format!("{}={}", rec.name, rec.value);
        if let Some(d) = &rec.domain {
            if !d.is_empty() {
                s.push_str(&format!("; Domain={d}"));
            }
        }
        let path = rec.path.as_deref().unwrap_or("/");
        s.push_str(&format!("; Path={path}"));

        let attach_host = rec
            .domain
            .as_deref()
            .map(|d| d.trim_start_matches('.'))
            .filter(|d| !d.is_empty())
            .unwrap_or(default_host);
        let attach_url: url::Url = format!("https://{attach_host}/")
            .parse()
            .map_err(|e| format!("invalid cookie attach url for {}: {e}", rec.name))?;
        jar.add_cookie_str(&s, &attach_url);
    }
    Ok(std::sync::Arc::new(jar))
}

/// Shared browser user-agent so store anti-bot heuristics don't reject the
/// post-login REST calls that replay the captured session.
pub fn user_agent() -> &'static str {
    BROWSER_UA
}

/// Extract a query parameter from a URL (used for the Xbox OAuth `code`).
/// Tolerates a leading `?` and any preceding `#`.
pub fn query_param(url: &str, want: &str) -> Option<String> {
    let after = url.split_once('?').map(|(_, q)| q).unwrap_or("");
    let after = after.split('#').next().unwrap_or(after);
    for pair in after.split('&') {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        if k == want {
            return Some(urlencoding::decode(v).map(|c| c.into_owned()).unwrap_or_else(|_| v.to_string()));
        }
    }
    None
}

fn opt_str(s: Option<&str>) -> Option<String> {
    let v = s.unwrap_or("").to_string();
    if v.is_empty() {
        None
    } else {
        Some(v)
    }
}

/// True when `domain` equals, or is a subdomain of, one of `allowed`.
fn domain_matches(domain: &str, allowed: &[&str]) -> bool {
    let d = domain.trim_start_matches('.').to_ascii_lowercase();
    allowed.iter().any(|a| {
        let a = a.trim_start_matches('.').to_ascii_lowercase();
        d == a || d.ends_with(&format!(".{a}"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_param_extracts_code() {
        let url = "https://login.live.com/oauth20_desktop.srf?code=M.R3_BAY.abc-123&lc=1033";
        assert_eq!(query_param(url, "code").as_deref(), Some("M.R3_BAY.abc-123"));
    }

    #[test]
    fn query_param_handles_percent_encoding() {
        let url = "https://example.com/cb?code=a%20b%2Fc";
        assert_eq!(query_param(url, "code").as_deref(), Some("a b/c"));
    }

    #[test]
    fn query_param_missing_returns_none() {
        assert_eq!(query_param("https://example.com/cb?foo=1", "code"), None);
        assert_eq!(query_param("https://example.com/cb", "code"), None);
    }

    #[test]
    fn domain_matches_subdomains_and_bare_domains() {
        assert!(domain_matches(".battle.net", &["battle.net"]));
        assert!(domain_matches("account.battle.net", &["battle.net"]));
        assert!(domain_matches("ea.com", &["ea.com"]));
        assert!(!domain_matches("notbattle.net", &["battle.net"]));
        assert!(!domain_matches("evil-battle.net", &["battle.net"]));
    }

    #[test]
    fn same_origin_compares_scheme_host_and_port() {
        let target = url::Url::parse("https://account.battle.net/overview").unwrap();
        assert!(same_origin("https://account.battle.net/", &target));
        assert!(same_origin("https://account.battle.net/callback?a=1", &target));
        assert!(!same_origin("https://eu.account.battle.net/", &target));
        assert!(!same_origin("http://account.battle.net/", &target));
        assert!(!same_origin("not a url", &target));
    }
}
