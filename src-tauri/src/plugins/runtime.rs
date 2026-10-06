//! Sandboxed JavaScript plugin runtime.
//!
//! Search plugins are plain `.js` files evaluated in an embedded
//! QuickJS engine (via `rquickjs`, binding `quickjs-ng`). Each
//! evaluation happens in a **fresh** [`Runtime`] + [`Context`] so a
//! plugin can never retain state between calls, and every sandbox is
//! hard-capped:
//!
//! - **Memory**: `JS_MEMORY_LIMIT` bytes (a runaway `JSON.parse` of a
//!   huge response cannot exhaust the app).
//! - **Instructions**: an interrupt handler decrements an atomic budget
//!   every 10,000 interpreter instructions (quickjs-ng calls the
//!   handler per `JS_INTERRUPT_COUNTER`); when the budget hits zero the
//!   interpreter raises an uncatchable "interrupted" exception.
//! - **Wall-clock**: `crate::plugins::search_plugin` additionally wraps
//!   the whole evaluation in a 20-second `tokio::time::timeout`, so
//!   even a plugin that blocks forever in a `while(true){}` loop (the
//!   interrupt budget cannot fire while no JS is executing — e.g. a
//!   plugin busy-waiting inside an injected closure's network call) can
//!   only stall its own `spawn_blocking` thread, never the app.
//!
//! ## The plugin API
//!
//! Every sandbox pre-declares four globals before the plugin source
//! runs:
//!
//! - `httpGet(url, referer?) -> String` — blocking GET, throws a JS
//!   error on failure. Only `http://` / `https://` schemes are allowed
//!   (something like `file://` is rejected up front). Transport errors
//!   and HTTP 5xx are retried twice (500 ms / 1 s backoff) because
//!   torrent-index hosts are historically flaky; HTTP 4xx fails fast.
//!   The optional `referer` string, when present, is sent as the HTTP
//!   `Referer` header — some torrent hosts 401 requests without it.
//! - `httpGetJson(url, referer?) -> any` — `JSON.parse(httpGet(url,
//!   referer))`. Defined in JS so error surfaces are ordinary JS
//!   exceptions.
//! - `httpGetXml(url, referer?) -> object` — `httpGet(url, referer)` +
//!   a quick-xml pass that converts an RSS 2.0 / Torznab feed into a
//!   plain JS object (see [`parse_torznab_xml`]). Deliberate capability:
//!   JS cannot parse XML, and regex-parsing it inside plugins is
//!   fragile, so the runtime owns the parser.
//! - `httpGetAll(urls) -> Array<String>` — parallel GET of many URLs
//!   (concurrency-capped), returning bodies aligned with the input and
//!   empty strings for failures. Lets catalog plugins pull dozens of
//!   small index files inside one search budget.
//! - `definePlugin(descriptor)` — **must be called exactly once** per
//!   evaluation. The descriptor carries the manifest fields
//!   (`id`, `name`, `version`, `author`, `description`, `sourceUrl`)
//!   plus the `search(query) -> Array` function.
//!
//! ## Why the search function is not held in the descriptor
//!
//! rquickjs `Function` values are tied to their [`Context`] lifetime
//! and are not `Send`; holding one across our per-query
//! `spawn_blocking` boundary is impossible. [`PluginDescriptor`]
//! therefore keeps the **source text** and `run_search` re-evaluates
//! it in a fresh sandbox per call — the plugin's `definePlugin` closure
//! stashes the `search` function on a private `__pluginSearch` global
//! which the query wrapper then invokes. Re-evaluation is cheap
//! (no network runs during `definePlugin`), guarantees zero shared
//! mutable state, and resets every limit for every call.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use quick_xml::events::{BytesStart, Event};
use quick_xml::name::QName;
use rquickjs::prelude::{Coerced, Opt};
use rquickjs::{Context, Ctx, Exception, Function, Object, Runtime, Value};
use serde::{Deserialize, Serialize};

/// Per-sandbox memory ceiling (QuickJS counts all JS heap allocations).
pub const JS_MEMORY_LIMIT: usize = 64 * 1024 * 1024;

/// How many interrupt-handler invocations a single search is allowed.
/// The handler fires every 10,000 instructions, so this budgets
/// ~20M instructions — far more than a legitimate search loop needs,
/// but small enough to stop `while(true){}` within milliseconds.
const INTERRUPT_BUDGET: u64 = 2000;

/// Transport error or HTTP 5xx → retry (hosts are historically flaky);
/// everything else fails fast.
const HTTP_MAX_ATTEMPTS: usize = 3;
const HTTP_RETRY_BACKOFF_MS: [u64; 2] = [500, 1000];

/// Hard cap on a `httpGetBytes` body (base64 inflates it ~33%).
const HTTP_BYTES_MAX: usize = 4 * 1024 * 1024;

/// Hard cap on a `httpGetTorrent` body — generous enough for a real
/// multi-file torrent's metadata, small enough that a hostile host
/// cannot exhaust the sandbox heap.
const HTTP_TORRENT_MAX: usize = 16 * 1024 * 1024;

/// Default (and hard maximum) number of nodes `parseHtml` returns.
const PARSE_HTML_DEFAULT_LIMIT: usize = 100;

// ─── Plugin descriptor ──────────────────────────────────────────────────────

/// The manifest a plugin declares via `definePlugin`. All fields are
/// plain owned data so a [`PluginDescriptor`] can be moved across
/// threads into `spawn_blocking`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub description: String,
    pub source_url: String,
    /// Broad platform class the plugin searches: "pc", "console", or
    /// "hybrid" (both). Absent/unknown values are normalised to "pc"
    /// by [`crate::plugins::normalize_platform_category`] at the
    /// command boundary; the sandbox stores the raw declared string.
    pub platform_category: String,
    /// Host allowlist declared as `allowedHosts`. Empty means the
    /// plugin may reach any host; a non-empty list restricts every
    /// network call to those hosts (or their subdomains).
    pub allowed_hosts: Vec<String>,
    /// Minimum spacing between requests to the same host, from the
    /// `rateLimitMs` manifest field. `0` disables throttling.
    pub rate_limit_ms: u64,
    /// How long this plugin's raw results stay cached, from the
    /// `cacheTtlSecs` manifest field. `None` falls back to the global
    /// `PLUGIN_CACHE_TTL`; the value is clamped by the manager.
    #[serde(default)]
    pub cache_ttl_secs: Option<u64>,
    /// Optional icon URL / data URI shown in the plugins UI.
    #[serde(default)]
    pub icon: Option<String>,
    /// Optional project homepage shown in the plugins UI.
    #[serde(default)]
    pub homepage: Option<String>,
    /// Free-form capability tags a plugin advertises (e.g. "search",
    /// "direct"). Defaults to empty for legacy plugins.
    #[serde(default)]
    pub capabilities: Vec<String>,
    /// User-configurable settings declared by the plugin. Rendered as a
    /// form in the plugins UI; values are stored separately.
    #[serde(default)]
    pub config: Vec<PluginConfigField>,
}

/// One user-configurable manifest field (`config` array entry).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginConfigField {
    /// Stable machine key used to store/read the value.
    #[serde(default)]
    pub key: String,
    /// Human-readable label shown above the input.
    #[serde(default)]
    pub label: String,
    /// True when the value is a secret and must go to the keychain
    /// rather than the plugin config store.
    #[serde(default)]
    pub secret: bool,
    /// True when the field must be filled before the plugin can run.
    #[serde(default)]
    pub required: bool,
    /// Optional input placeholder text.
    #[serde(default)]
    pub placeholder: Option<String>,
    /// Optional helper text rendered under the input.
    #[serde(default)]
    pub description: Option<String>,
}

/// A validated plugin: its manifest plus the raw source text.
///
/// `source` is retained (not the live JS function — see the module
/// docs) because every `run_search` call gets a brand-new sandbox.
#[derive(Debug, Clone)]
pub struct PluginDescriptor {
    pub manifest: PluginManifest,
    source: String,
}

/// One file inside a plugin result's `fileList` (multi-file torrents /
/// repacks). Name plus byte size; both tolerant to missing input.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PluginFile {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub size: u64,
}

/// One checksum entry (`checksums` array): algorithm name plus value.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PluginChecksum {
    #[serde(default)]
    pub algo: String,
    #[serde(default)]
    pub value: String,
}

/// One torrent result returned by a plugin's `search()`.
///
/// Tolerant deserialization is the contract here: plugins are third
/// party, so every field is optional / defaulted and `size` accepts
/// either a human-readable string ("1.5 GB") or a raw number.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PluginRawResult {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default, deserialize_with = "de_string_or_number")]
    pub size: String,
    #[serde(default)]
    pub size_bytes: Option<u64>,
    #[serde(default)]
    pub infohash: Option<String>,
    #[serde(default)]
    pub magnet: Option<String>,
    #[serde(default)]
    pub torrent_url: Option<String>,
    #[serde(default)]
    pub seeds: Option<u32>,
    #[serde(default)]
    pub peers: Option<u32>,
    #[serde(default)]
    pub upload_date: Option<i64>,
    #[serde(default)]
    pub upload_date_iso: Option<String>,
    #[serde(default)]
    pub verified: Option<bool>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    /// The platform / console a game targets (e.g. "Nintendo Switch",
    /// "PlayStation 2", "NES"). Shown in the download modal so ROM /
    /// repack hits are distinguishable per system.
    #[serde(default)]
    pub platform: Option<String>,
    /// Direct HTTP download URLs (non-torrent, e.g. a ROM served over
    /// plain http(s) or a hoster link). Merged into the result's
    /// `uris` mirror list so the app's direct downloader streams them
    /// instead of the torrent engine.
    #[serde(default)]
    pub direct_urls: Option<Vec<String>>,
    /// The upstream site a meta-search hit was cached from (e.g.
    /// "RuTracker.org" for a knaben hit). Surfaced in the download
    /// modal as result provenance; absent for single-site plugins.
    #[serde(default)]
    pub provenance: Option<String>,
    /// Optional `Referer` header value the downloader must send when
    /// it fetches `torrentUrl`. Anti-hotlink hosts (e.g. nginx
    /// `valid_referers`) reject the `.torrent` request with 401 unless
    /// the Referer matches. Generic — any plugin may set it; it flows
    /// through to `torrent_add` untouched.
    #[serde(default)]
    pub referer: Option<String>,
    /// Optional title the match score should be computed against when
    /// it differs from the display `title` (e.g. a clean release name
    /// while `title` carries a noisy suffix). Trimmed; empty is ignored.
    #[serde(default)]
    pub match_title: Option<String>,
    /// Optional list of files contained in the release.
    #[serde(default)]
    pub file_list: Option<Vec<PluginFile>>,
    /// Optional checksums (md5/sha1/sha256/...) for the release.
    #[serde(default)]
    pub checksums: Option<Vec<PluginChecksum>>,
    /// Optional release version string.
    #[serde(default)]
    pub version: Option<String>,
    /// Optional region code (e.g. "USA", "EUR", "JPN") for ROMs.
    #[serde(default)]
    pub region: Option<String>,
    /// Optional cover art URL.
    #[serde(default)]
    pub cover_url: Option<String>,
    /// Optional long description.
    #[serde(default)]
    pub description: Option<String>,
    /// Optional release group / repacker name.
    #[serde(default)]
    pub release_group: Option<String>,
    /// Plugin's own recommendation flag (e.g. verified repacker).
    #[serde(default)]
    pub recommended: Option<bool>,
}

/// `size` accepts `"1.5 GB"` (string) or `12345` (number) — plugins
/// disagree on which one their index API returns.
fn de_string_or_number<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de::Error;
    let v = serde_json::Value::deserialize(deserializer)?;
    match v {
        serde_json::Value::String(s) => Ok(s),
        serde_json::Value::Number(n) => Ok(n.to_string()),
        serde_json::Value::Null => Ok(String::new()),
        _ => Err(D::Error::custom("size must be a string or a number")),
    }
}

// ─── Sandbox setup ──────────────────────────────────────────────────────────

/// Build a fresh runtime with the memory cap and the instruction
/// budget armed. Called once per evaluate / search.
fn new_sandbox_runtime() -> Result<Runtime, String> {
    let runtime = Runtime::new().map_err(|e| format!("create JS runtime: {e}"))?;
    runtime.set_memory_limit(JS_MEMORY_LIMIT);
    let budget = Arc::new(AtomicU64::new(INTERRUPT_BUDGET));
    let budget_f = budget.clone();
    runtime.set_interrupt_handler(Some(Box::new(move || {
        // Return `true` (interrupt) once the budget is spent.
        budget_f.fetch_sub(1, Ordering::Relaxed) <= 1
    })));
    Ok(runtime)
}

// ─── Egress policy ──────────────────────────────────────────────────────────

/// Per-run network policy shared between the HTTP globals and
/// `definePlugin`. The allowlist is only known *after* the plugin source
/// runs (it declares `allowedHosts` inside `definePlugin`), so both
/// sides share one slot the manifest fills in; every egress call consults
/// it live.
#[derive(Clone, Default)]
struct HttpPolicy {
    allowlist: Arc<Mutex<Option<Vec<String>>>>,
    rate_limit_ms: Arc<AtomicU64>,
}

/// Process-global last-request timestamps, keyed by host. Shared across
/// every plugin and search so a plugin cannot sidestep its own rate
/// limit by re-evaluating, and different plugins hitting the same host
/// still queue behind each other.
static RATE_LIMIT: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();

fn rate_limit_map() -> &'static Mutex<HashMap<String, Instant>> {
    RATE_LIMIT.get_or_init(|| Mutex::new(HashMap::new()))
}

impl HttpPolicy {
    fn new() -> Self {
        Self::default()
    }

    /// Record the manifest's allowlist. An empty list means "no
    /// restriction" (the field is optional and most plugins omit it).
    fn set_allowlist(&self, hosts: Vec<String>) {
        if let Ok(mut slot) = self.allowlist.lock() {
            *slot = if hosts.is_empty() { None } else { Some(hosts) };
        }
    }

    fn set_rate_limit_ms(&self, ms: u64) {
        self.rate_limit_ms.store(ms, Ordering::Relaxed);
    }

    /// Reject a URL whose host is neither an exact allowlist entry nor a
    /// subdomain of one. No allowlist → everything passes.
    fn check_host(&self, url: &str) -> Result<(), String> {
        let list = match self.allowlist.lock() {
            Ok(slot) => slot.clone(),
            Err(_) => None,
        };
        let Some(list) = list else { return Ok(()) };
        let host = host_of(url).ok_or_else(|| format!("blocked URL (no host): {url}"))?;
        let host = host.to_ascii_lowercase();
        let allowed = list.iter().any(|entry| {
            let entry = entry.trim().trim_start_matches('.').to_ascii_lowercase();
            !entry.is_empty() && (host == entry || host.ends_with(&format!(".{entry}")))
        });
        if allowed {
            Ok(())
        } else {
            Err(format!("host {host} is not in the plugin's allowedHosts"))
        }
    }

    /// Block until this host may be hit again. The next slot is reserved
    /// while the lock is held so concurrent callers queue in order
    /// instead of all sleeping for the same interval.
    fn wait_for_rate_limit(&self, url: &str) {
        let ms = self.rate_limit_ms.load(Ordering::Relaxed);
        if ms == 0 {
            return;
        }
        let Some(host) = host_of(url) else { return };
        let host = host.to_ascii_lowercase();
        let now = Instant::now();
        let interval = Duration::from_millis(ms);
        let mut map = match rate_limit_map().lock() {
            Ok(map) => map,
            Err(_) => return,
        };
        let wait = match map.get(&host) {
            Some(last) => {
                let elapsed = now.saturating_duration_since(*last);
                if elapsed < interval {
                    interval - elapsed
                } else {
                    Duration::ZERO
                }
            }
            None => Duration::ZERO,
        };
        map.insert(host, now + wait);
        drop(map);
        if !wait.is_zero() {
            std::thread::sleep(wait);
        }
    }
}

/// Lowercased host component of an absolute URL, if it parses.
fn host_of(url: &str) -> Option<String> {
    url::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(str::to_string))
}

/// How one request attempt ended, from the retry loop's point of view.
enum AttemptOutcome<T> {
    /// Succeeded — stop.
    Ok(T),
    /// Deterministic failure (e.g. HTTP 4xx) — stop, retrying won't help.
    FailFast(String),
    /// Transient failure (transport error / HTTP 5xx) — retry.
    Retry(String),
}

/// The single egress chokepoint: scheme + allowlist + rate limit, then
/// the shared retry policy. Every HTTP global funnels through here so a
/// policy cannot be bypassed by choosing a different global.
fn with_retry<T>(
    policy: &HttpPolicy,
    label: &str,
    url: &str,
    mut attempt: impl FnMut() -> AttemptOutcome<T>,
) -> Result<T, String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(format!("{label}: blocked non-http(s) URL: {url}"));
    }
    policy.check_host(url)?;
    policy.wait_for_rate_limit(url);

    let mut last_err = String::new();
    for attempt_index in 0..HTTP_MAX_ATTEMPTS {
        if attempt_index > 0 {
            let backoff = HTTP_RETRY_BACKOFF_MS
                [(attempt_index - 1).min(HTTP_RETRY_BACKOFF_MS.len() - 1)];
            std::thread::sleep(Duration::from_millis(backoff));
        }
        match attempt() {
            AttemptOutcome::Ok(value) => return Ok(value),
            AttemptOutcome::FailFast(err) => return Err(format!("{label}: {url} -> {err}")),
            AttemptOutcome::Retry(err) => last_err = err,
        }
    }
    Err(format!(
        "{label}: {url} failed after {HTTP_MAX_ATTEMPTS} attempts: {last_err}"
    ))
}

/// Classify a text-response attempt the way `httpGet` always has:
/// success → body, 5xx / transport → retry, everything else → fail fast.
fn text_attempt(
    response: Result<reqwest::blocking::Response, reqwest::Error>,
) -> AttemptOutcome<String> {
    match response {
        Ok(resp) => {
            let status = resp.status();
            if status.is_success() {
                match resp.text() {
                    Ok(text) => AttemptOutcome::Ok(text),
                    Err(e) => AttemptOutcome::Retry(e.to_string()),
                }
            } else if status.is_server_error() {
                AttemptOutcome::Retry(format!("HTTP {}", status.as_u16()))
            } else {
                AttemptOutcome::FailFast(format!("HTTP {}", status.as_u16()))
            }
        }
        Err(e) => AttemptOutcome::Retry(e.to_string()),
    }
}

/// Reject header names/values that could smuggle a second request (CRLF
/// injection) and validate them against the HTTP grammar up front.
fn validate_headers(headers: Vec<(String, String)>) -> Result<Vec<(String, String)>, String> {
    for (name, value) in &headers {
        if name.is_empty() {
            return Err("header name must not be empty".to_string());
        }
        if name.contains('\r') || name.contains('\n') || value.contains('\r') || value.contains('\n')
        {
            return Err(format!("header {name:?} contains CR or LF"));
        }
        reqwest::header::HeaderName::from_bytes(name.as_bytes())
            .map_err(|e| format!("invalid header name {name:?}: {e}"))?;
        reqwest::header::HeaderValue::from_str(value)
            .map_err(|e| format!("invalid value for header {name:?}: {e}"))?;
    }
    Ok(headers)
}

fn build_request(
    client: &reqwest::blocking::Client,
    method: &reqwest::Method,
    url: &str,
    referer: Option<&str>,
    headers: &[(String, String)],
    body: Option<&str>,
) -> reqwest::blocking::RequestBuilder {
    let mut req = client.request(method.clone(), url);
    if let Some(referer) = referer {
        req = req.header(reqwest::header::REFERER, referer);
    }
    for (name, value) in headers {
        req = req.header(name.as_str(), value.as_str());
    }
    if let Some(body) = body {
        req = req.body(body.to_string());
    }
    req
}

/// GET with optional extra headers, used by both `httpGet` (no headers)
/// and `httpGetAll` (per-URL headers).
fn http_get_with(
    client: &reqwest::blocking::Client,
    policy: &HttpPolicy,
    url: &str,
    referer: Option<&str>,
    headers: &[(String, String)],
) -> Result<String, String> {
    with_retry(policy, "httpGet", url, || {
        let request = build_request(client, &reqwest::Method::GET, url, referer, headers, None);
        text_attempt(request.send())
    })
}

/// `httpRequest` — arbitrary method/body/headers, same retry policy.
fn http_request(
    client: &reqwest::blocking::Client,
    policy: &HttpPolicy,
    method: &reqwest::Method,
    url: &str,
    referer: Option<&str>,
    headers: &[(String, String)],
    body: Option<&str>,
) -> Result<String, String> {
    with_retry(policy, "httpRequest", url, || {
        let request = build_request(client, method, url, referer, headers, body);
        text_attempt(request.send())
    })
}

/// GET a binary body, capped at `max_bytes`. `httpGetBytes` and
/// `httpGetTorrent` share this; only the cap and post-processing differ.
fn http_get_bytes(
    client: &reqwest::blocking::Client,
    policy: &HttpPolicy,
    url: &str,
    referer: Option<&str>,
    max_bytes: usize,
) -> Result<Vec<u8>, String> {
    with_retry(policy, "httpGetBytes", url, || {
        let request = build_request(client, &reqwest::Method::GET, url, referer, &[], None);
        match request.send() {
            Ok(resp) => {
                let status = resp.status();
                if status.is_success() {
                    if let Some(len) = resp.content_length() {
                        if len as usize > max_bytes {
                            return AttemptOutcome::FailFast(format!(
                                "body too large: {len} bytes (max {max_bytes})"
                            ));
                        }
                    }
                    match resp.bytes() {
                        Ok(bytes) if bytes.len() > max_bytes => AttemptOutcome::FailFast(format!(
                            "body too large: {} bytes (max {max_bytes})",
                            bytes.len()
                        )),
                        Ok(bytes) => AttemptOutcome::Ok(bytes.to_vec()),
                        Err(e) => AttemptOutcome::Retry(e.to_string()),
                    }
                } else if status.is_server_error() {
                    AttemptOutcome::Retry(format!("HTTP {}", status.as_u16()))
                } else {
                    AttemptOutcome::FailFast(format!("HTTP {}", status.as_u16()))
                }
            }
            Err(e) => AttemptOutcome::Retry(e.to_string()),
        }
    })
}

/// Result of `httpHead`: enough to decide whether a URL is worth
/// downloading without transferring its body.
struct HeadInfo {
    status: u16,
    final_url: String,
    content_type: Option<String>,
    content_length: Option<u64>,
}

fn http_head(
    client: &reqwest::blocking::Client,
    policy: &HttpPolicy,
    url: &str,
    referer: Option<&str>,
) -> Result<HeadInfo, String> {
    with_retry(policy, "httpHead", url, || {
        let request = build_request(client, &reqwest::Method::HEAD, url, referer, &[], None);
        match request.send() {
            // A HEAD probe reports the status even for 4xx/5xx — that is
            // the point of the call — so only transport errors retry.
            Ok(resp) => AttemptOutcome::Ok(HeadInfo {
                status: resp.status().as_u16(),
                final_url: resp.url().as_str().to_string(),
                content_type: resp
                    .headers()
                    .get(reqwest::header::CONTENT_TYPE)
                    .and_then(|v| v.to_str().ok())
                    .map(str::to_string),
                content_length: resp.content_length(),
            }),
            Err(e) => AttemptOutcome::Retry(e.to_string()),
        }
    })
}

/// Options object accepted by `httpRequest` / `httpRequestJson`.
struct RequestOptions {
    method: String,
    headers: Vec<(String, String)>,
    body: Option<String>,
    referer: Option<String>,
}

fn parse_request_options<'js>(options: Option<Object<'js>>) -> Result<RequestOptions, String> {
    let mut parsed = RequestOptions {
        method: "GET".to_string(),
        headers: Vec::new(),
        body: None,
        referer: None,
    };
    let Some(object) = options else {
        return Ok(parsed);
    };
    if let Some(method) = object
        .get::<_, Option<String>>("method")
        .map_err(|e| e.to_string())?
    {
        if !method.trim().is_empty() {
            parsed.method = method;
        }
    }
    parsed.referer = object
        .get::<_, Option<String>>("referer")
        .map_err(|e| e.to_string())?;
    parsed.body = object
        .get::<_, Option<String>>("body")
        .map_err(|e| e.to_string())?;
    if let Some(headers) = object
        .get::<_, Option<HashMap<String, String>>>("headers")
        .map_err(|e| e.to_string())?
    {
        parsed.headers = validate_headers(headers.into_iter().collect())?;
    }
    Ok(parsed)
}

/// One entry of a `httpGetAll` input.
#[derive(Clone)]
struct FetchSpec {
    url: String,
    referer: Option<String>,
    headers: Vec<(String, String)>,
}

/// `httpGetAll` accepts either `string[]` (the original shape) or
/// `{ url, referer?, headers? }[]` so callers can mix sources.
fn parse_fetch_specs<'js>(value: Value<'js>) -> Result<Vec<FetchSpec>, String> {
    let array = value
        .as_array()
        .ok_or_else(|| "httpGetAll: expected an array".to_string())?;
    let mut specs = Vec::with_capacity(array.len());
    for item in array.iter::<Value>() {
        let item = item.map_err(|e| e.to_string())?;
        if item.is_string() {
            let url = item
                .as_string()
                .and_then(|s| s.to_string().ok())
                .ok_or_else(|| "httpGetAll: invalid URL string".to_string())?;
            specs.push(FetchSpec {
                url,
                referer: None,
                headers: Vec::new(),
            });
        } else if item.is_object() {
            let object = item
                .as_object()
                .ok_or_else(|| "httpGetAll: invalid request object".to_string())?;
            let url = object
                .get::<_, String>("url")
                .map_err(|e| e.to_string())?;
            let referer = object
                .get::<_, Option<String>>("referer")
                .map_err(|e| e.to_string())?;
            let headers = match object
                .get::<_, Option<HashMap<String, String>>>("headers")
                .map_err(|e| e.to_string())?
            {
                Some(headers) => validate_headers(headers.into_iter().collect())?,
                None => Vec::new(),
            };
            specs.push(FetchSpec {
                url,
                referer,
                headers,
            });
        } else {
            return Err(
                "httpGetAll: array items must be strings or { url, ... } objects".to_string(),
            );
        }
    }
    Ok(specs)
}

/// Standard base64 (with padding). Implemented inline rather than pulling
/// a crate in for the one `httpGetBytes` return path.
fn base64_encode(data: &[u8]) -> String {
    const TABLE: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((n >> 18) & 63) as usize] as char);
        out.push(TABLE[((n >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[((n >> 6) & 63) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[(n & 63) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

/// Give a sandbox the HTTP globals. `httpGet` / `httpGetXml` /
/// `httpRequest` / `httpHead` / `httpGetBytes` / `httpGetTorrent` are
/// Rust closures; `httpGetJson` / `httpRequestJson` are one-line JS
/// wrappers so parse errors are regular JS exceptions with a stack;
/// `httpGetXml` runs the quick-xml feed parser (see
/// [`parse_torznab_xml`]).
///
/// `policy` is the per-run allowlist / rate-limit slot shared with
/// `definePlugin`: it is injected empty and filled in once the plugin's
/// manifest runs, so every later network call is governed by it.
fn inject_http_globals<'js>(
    ctx: &Ctx<'js>,
    http: &reqwest::blocking::Client,
    policy: &HttpPolicy,
) -> Result<(), String> {
    let http_get_owned = http.clone();
    let policy_get = policy.clone();
    let http_get = Function::new(
        ctx.clone(),
        move |ctx: Ctx<'js>, url: String, referer: Opt<Option<String>>| -> Result<String, rquickjs::Error> {
            let ref_str = referer.0.flatten();
            http_get_with(&http_get_owned, &policy_get, &url, ref_str.as_deref(), &[])
                .map_err(|e| Exception::throw_message(&ctx, &e))
        },
    )
    .map_err(|e| format!("create httpGet closure: {e}"))?;
    ctx.globals()
        .set("httpGet", http_get)
        .map_err(|e| format!("inject httpGet: {e}"))?;

    let http_get_xml_owned = http.clone();
    let policy_xml = policy.clone();
    let http_get_xml = Function::new(
        ctx.clone(),
        move |ctx: Ctx<'js>, url: String, referer: Opt<Option<String>>| -> Result<Value<'js>, rquickjs::Error> {
            let ref_str = referer.0.flatten();
            let text = http_get_with(&http_get_xml_owned, &policy_xml, &url, ref_str.as_deref(), &[])
                .map_err(|e| Exception::throw_message(&ctx, &e))?;
            let parsed = parse_torznab_xml(&text)
                .map_err(|e| Exception::throw_message(&ctx, &e))?;
            let json = serde_json::to_string(&parsed).map_err(|e| {
                Exception::throw_message(&ctx, &format!("httpGetXml: serialize feed: {e}"))
            })?;
            ctx.json_parse(json).map_err(|e| {
                Exception::throw_message(&ctx, &format!("httpGetXml: materialize object: {e}"))
            })
        },
    )
    .map_err(|e| format!("create httpGetXml closure: {e}"))?;
    ctx.globals()
        .set("httpGetXml", http_get_xml)
        .map_err(|e| format!("inject httpGetXml: {e}"))?;

    let http_request_owned = http.clone();
    let policy_request = policy.clone();
    let http_request_fn = Function::new(
        ctx.clone(),
        move |ctx: Ctx<'js>, url: String, options: Opt<Option<Object<'js>>>| -> Result<String, rquickjs::Error> {
            let parsed = parse_request_options(options.0.flatten())
                .map_err(|e| Exception::throw_message(&ctx, &e))?;
            let method = reqwest::Method::from_bytes(parsed.method.trim().to_uppercase().as_bytes())
                .map_err(|e| {
                    Exception::throw_message(
                        &ctx,
                        &format!("httpRequest: invalid method {:?}: {e}", parsed.method),
                    )
                })?;
            http_request(
                &http_request_owned,
                &policy_request,
                &method,
                &url,
                parsed.referer.as_deref(),
                &parsed.headers,
                parsed.body.as_deref(),
            )
            .map_err(|e| Exception::throw_message(&ctx, &e))
        },
    )
    .map_err(|e| format!("create httpRequest closure: {e}"))?;
    ctx.globals()
        .set("httpRequest", http_request_fn)
        .map_err(|e| format!("inject httpRequest: {e}"))?;

    let http_head_owned = http.clone();
    let policy_head = policy.clone();
    let http_head_fn = Function::new(
        ctx.clone(),
        move |ctx: Ctx<'js>, url: String, referer: Opt<Option<String>>| -> Result<Value<'js>, rquickjs::Error> {
            let ref_str = referer.0.flatten();
            let info = http_head(&http_head_owned, &policy_head, &url, ref_str.as_deref())
                .map_err(|e| Exception::throw_message(&ctx, &e))?;
            let json = serde_json::json!({
                "status": info.status,
                "finalUrl": info.final_url,
                "contentType": info.content_type,
                "contentLength": info.content_length,
            });
            let json = serde_json::to_string(&json).map_err(|e| {
                Exception::throw_message(&ctx, &format!("httpHead: serialize: {e}"))
            })?;
            ctx.json_parse(json).map_err(|e| {
                Exception::throw_message(&ctx, &format!("httpHead: materialize object: {e}"))
            })
        },
    )
    .map_err(|e| format!("create httpHead closure: {e}"))?;
    ctx.globals()
        .set("httpHead", http_head_fn)
        .map_err(|e| format!("inject httpHead: {e}"))?;

    let http_bytes_owned = http.clone();
    let policy_bytes = policy.clone();
    let http_get_bytes_fn = Function::new(
        ctx.clone(),
        move |ctx: Ctx<'js>, url: String, referer: Opt<Option<String>>| -> Result<String, rquickjs::Error> {
            let ref_str = referer.0.flatten();
            let data = http_get_bytes(
                &http_bytes_owned,
                &policy_bytes,
                &url,
                ref_str.as_deref(),
                HTTP_BYTES_MAX,
            )
            .map_err(|e| Exception::throw_message(&ctx, &e))?;
            Ok(base64_encode(&data))
        },
    )
    .map_err(|e| format!("create httpGetBytes closure: {e}"))?;
    ctx.globals()
        .set("httpGetBytes", http_get_bytes_fn)
        .map_err(|e| format!("inject httpGetBytes: {e}"))?;

    let http_torrent_owned = http.clone();
    let policy_torrent = policy.clone();
    let http_get_torrent_fn = Function::new(
        ctx.clone(),
        move |ctx: Ctx<'js>, url: String, referer: Opt<Option<String>>| -> Result<Value<'js>, rquickjs::Error> {
            let ref_str = referer.0.flatten();
            let data = http_get_bytes(
                &http_torrent_owned,
                &policy_torrent,
                &url,
                ref_str.as_deref(),
                HTTP_TORRENT_MAX,
            )
            .map_err(|e| Exception::throw_message(&ctx, &e))?;
            let parsed = crate::plugins::bencode::parse_torrent(&data)
                .map_err(|e| Exception::throw_message(&ctx, &e))?;
            let json = serde_json::to_string(&parsed).map_err(|e| {
                Exception::throw_message(&ctx, &format!("httpGetTorrent: serialize: {e}"))
            })?;
            ctx.json_parse(json).map_err(|e| {
                Exception::throw_message(&ctx, &format!("httpGetTorrent: materialize object: {e}"))
            })
        },
    )
    .map_err(|e| format!("create httpGetTorrent closure: {e}"))?;
    ctx.globals()
        .set("httpGetTorrent", http_get_torrent_fn)
        .map_err(|e| format!("inject httpGetTorrent: {e}"))?;

    let parse_html_fn = Function::new(
        ctx.clone(),
        move |ctx: Ctx<'js>, html: String, selector: String, limit: Opt<Option<u64>>| -> Result<Value<'js>, rquickjs::Error> {
            let limit = limit
                .0
                .flatten()
                .unwrap_or(PARSE_HTML_DEFAULT_LIMIT as u64)
                .min(usize::MAX as u64) as usize;
            let value = crate::plugins::html::query(&html, &selector, limit)
                .map_err(|e| Exception::throw_message(&ctx, &e))?;
            let json = serde_json::to_string(&value).map_err(|e| {
                Exception::throw_message(&ctx, &format!("parseHtml: serialize: {e}"))
            })?;
            ctx.json_parse(json).map_err(|e| {
                Exception::throw_message(&ctx, &format!("parseHtml: materialize array: {e}"))
            })
        },
    )
    .map_err(|e| format!("create parseHtml closure: {e}"))?;
    ctx.globals()
        .set("parseHtml", parse_html_fn)
        .map_err(|e| format!("inject parseHtml: {e}"))?;

    let sleep_fn = Function::new(
        ctx.clone(),
        move |_ctx: Ctx<'js>, ms: u64| -> Result<(), rquickjs::Error> {
            std::thread::sleep(Duration::from_millis(ms.min(3000)));
            Ok(())
        },
    )
    .map_err(|e| format!("create sleep closure: {e}"))?;
    ctx.globals()
        .set("sleep", sleep_fn)
        .map_err(|e| format!("inject sleep: {e}"))?;

    ctx.eval::<(), _>(
        "function httpGetJson(url, referer) { return JSON.parse(httpGet(url, referer)); }\n\
         function httpRequestJson(url, options) { return JSON.parse(httpRequest(url, options)); }",
    )
    .map_err(|e| format!("inject JSON wrappers: {e}"))?;

    inject_http_get_all(ctx, http, policy)
}

/// Give a sandbox the `httpGetAll(urls)` global: fetches many URLs in
/// parallel and returns an array of bodies aligned with the input
/// (failed fetches become empty strings). The input is either a
/// `string[]` or a `{ url, referer?, headers? }[]`. Used by catalog-style
/// plugins (e.g. romheaven) that must pull a couple dozen small index
/// files in one search — fetching them sequentially would blow the 20 s
/// search budget. Concurrency is capped so a public gateway is not
/// hammered.
fn inject_http_get_all<'js>(
    ctx: &Ctx<'js>,
    http: &reqwest::blocking::Client,
    policy: &HttpPolicy,
) -> Result<(), String> {
    let http_owned = http.clone();
    let policy_owned = policy.clone();
    let get_all = Function::new(
        ctx.clone(),
        move |ctx: Ctx<'js>, urls: Value<'js>| -> Result<Value<'js>, rquickjs::Error> {
            let specs =
                parse_fetch_specs(urls).map_err(|e| Exception::throw_message(&ctx, &e))?;
            // Chunked so at most CONCURRENT_FETCHES requests are in
            // flight at once; each thread returns its own body and the
            // chunk joins before the next starts, so there is no shared
            // mutable state to synchronise.
            const CONCURRENT_FETCHES: usize = 8;
            let mut results: Vec<String> = Vec::with_capacity(specs.len());
            for chunk in specs.chunks(CONCURRENT_FETCHES) {
                let chunk_results = std::thread::scope(|scope| {
                    let handles: Vec<_> = chunk
                        .iter()
                        .map(|spec| {
                            let client = http_owned.clone();
                            let policy = policy_owned.clone();
                            let spec = spec.clone();
                            scope.spawn(move || {
                                http_get_with(
                                    &client,
                                    &policy,
                                    &spec.url,
                                    spec.referer.as_deref(),
                                    &spec.headers,
                                )
                                .unwrap_or_default()
                            })
                        })
                        .collect();
                    handles
                        .into_iter()
                        .map(|h| h.join().unwrap_or_default())
                        .collect::<Vec<String>>()
                });
                results.extend(chunk_results);
            }
            let json = serde_json::to_string(&results).map_err(|e| {
                Exception::throw_message(&ctx, &format!("httpGetAll: serialize results: {e}"))
            })?;
            ctx.json_parse(json).map_err(|e| {
                Exception::throw_message(&ctx, &format!("httpGetAll: materialize array: {e}"))
            })
        },
    )
    .map_err(|e| format!("create httpGetAll closure: {e}"))?;
    ctx.globals()
        .set("httpGetAll", get_all)
        .map_err(|e| format!("inject httpGetAll: {e}"))
}

/// Give a sandbox the `definePlugin` global. The closure:
///
/// 1. rejects a second call (exactly-once contract),
/// 2. pulls the manifest fields out of the descriptor object,
/// 3. publishes the `allowedHosts` / `rateLimitMs` policy for the HTTP
///    globals (which already exist by now),
/// 4. stashes the `search` function on the private `__pluginSearch`
///    global for the query wrapper to call,
/// 5. records the manifest in the Rust `slot` for the caller.
fn inject_define_plugin<'js>(
    ctx: &Ctx<'js>,
    count: &Arc<AtomicU32>,
    slot: &Arc<Mutex<Option<PluginManifest>>>,
    policy: &HttpPolicy,
) -> Result<(), String> {
    let count_f = count.clone();
    let slot_f = slot.clone();
    let policy_f = policy.clone();
    let define = Function::new(
        ctx.clone(),
        move |ctx: Ctx<'js>, descriptor: Object<'js>| -> Result<(), rquickjs::Error> {
            if count_f.load(Ordering::Relaxed) > 0 {
                return Err(Exception::throw_message(
                    &ctx,
                    "definePlugin may only be called once",
                ));
            }
            count_f.store(1, Ordering::Relaxed);
            // Missing / malformed required fields surface as JS
            // "TypeError: cannot read..." style exceptions.
            let id: String = descriptor.get("id")?;
            let name: String = descriptor.get("name")?;
            let version: String = descriptor.get("version")?;
            let author: String = descriptor.get("author")?;
            let description: String = descriptor.get("description").unwrap_or_default();
            let source_url: String = descriptor.get("sourceUrl").unwrap_or_default();
            let platform_category: String = descriptor.get("platformCategory").unwrap_or_default();
            let allowed_hosts: Vec<String> = descriptor.get("allowedHosts").unwrap_or_default();
            let rate_limit_ms: u64 = descriptor.get("rateLimitMs").unwrap_or_default();
            let cache_ttl_secs: Option<u64> =
                descriptor.get("cacheTtlSecs").unwrap_or_default();
            let icon: Option<String> = descriptor.get("icon").unwrap_or_default();
            let homepage: Option<String> = descriptor.get("homepage").unwrap_or_default();
            let capabilities: Vec<String> = descriptor.get("capabilities").unwrap_or_default();
            // `config` is an array of objects, which rquickjs cannot
            // convert directly — round-trip it through JSON so unknown
            // extra keys are ignored by serde and a malformed entry
            // degrades to an empty config rather than failing the whole
            // plugin evaluation.
            let config: Vec<PluginConfigField> = match descriptor
                .get::<_, Option<Value>>("config")
            {
                Ok(Some(value)) => ctx
                    .json_stringify(value)?
                    .and_then(|json| json.to_string().ok())
                    .and_then(|json| serde_json::from_str(&json).ok())
                    .unwrap_or_default(),
                _ => Vec::new(),
            };
            let search: Function = descriptor.get("search")?;
            ctx.globals().set("__pluginSearch", search)?;
            // Publish the policy before storing the manifest: the
            // plugin's search() runs only after definePlugin returns, and
            // it must already see the allowlist.
            policy_f.set_allowlist(allowed_hosts.clone());
            policy_f.set_rate_limit_ms(rate_limit_ms);
            let manifest = PluginManifest {
                id,
                name,
                version,
                author,
                description,
                source_url,
                platform_category,
                allowed_hosts,
                rate_limit_ms,
                cache_ttl_secs,
                icon,
                homepage,
                capabilities,
                config,
            };
            if let Ok(mut slot) = slot_f.lock() {
                *slot = Some(manifest);
            }
            Ok(())
        },
    )
    .map_err(|e| format!("create definePlugin closure: {e}"))?;
    ctx.globals()
        .set("definePlugin", define)
        .map_err(|e| format!("inject definePlugin: {e}"))
}

// ─── Public API ─────────────────────────────────────────────────────────────

/// Evaluate a plugin source in a fresh sandbox and extract its
/// manifest. This is the validation step for import/install/toggle —
/// it proves the file parses, calls `definePlugin` exactly once, and
/// declares a `search` function, without running any search.
pub fn evaluate_plugin(source: &str, http: &reqwest::blocking::Client) -> Result<PluginDescriptor, String> {
    let runtime = new_sandbox_runtime()?;
    let ctx = Context::full(&runtime).map_err(|e| format!("create JS context: {e}"))?;
    let count = Arc::new(AtomicU32::new(0));
    let slot = Arc::new(Mutex::new(None));
    // Validation never performs a network call, so the policy only needs
    // to exist for `definePlugin` to populate; it is never enforced here.
    let policy = HttpPolicy::new();

    ctx.with(|ctx| -> Result<(), String> {
        inject_http_globals(&ctx, http, &policy)?;
        inject_define_plugin(&ctx, &count, &slot, &policy)?;
        if let Err(e) = ctx.eval::<(), _>(source) {
            return Err(describe_js_error(&ctx, "eval plugin", e));
        }
        // The plugin may have declared the search function; a bare
        // manifest without one is rejected now so installs never
        // succeed on a file that would only fail at search time.
        let has_search = ctx
            .globals()
            .get::<_, Function>("__pluginSearch")
            .is_ok();
        if !has_search {
            return Err(
                "plugin descriptor is missing a callable `search` function".to_string(),
            );
        }
        Ok(())
    })?;

    let locked = slot
        .lock()
        .map_err(|e| format!("plugin manifest slot lock: {e}"))?
        .clone();
    let manifest =
        locked.ok_or_else(|| "plugin did not call definePlugin".to_string())?;
    Ok(PluginDescriptor {
        manifest,
        source: source.to_string(),
    })
}

/// Run a plugin's `search(query)` inside a fresh sandbox and return the
/// raw results. Callers run this on a blocking thread under a wall-clock
/// timeout (see `crate::plugins::search_plugin`).
pub fn run_search(
    descriptor: &PluginDescriptor,
    query: &str,
    config_json: &str,
    _http: &reqwest::blocking::Client,
) -> Result<Vec<PluginRawResult>, String> {
    // One client per search. The cookie store lets a plugin carry a
    // session / CSRF cookie across the sequential requests of a single
    // search, while a fresh client per call keeps those cookies out of
    // every other search and plugin.
    let http = reqwest::blocking::Client::builder()
        .user_agent(crate::plugins::PLUGIN_HTTP_UA)
        .timeout(Duration::from_secs(15))
        .use_rustls_tls()
        .cookie_store(true)
        .build()
        .map_err(|e| format!("build plugin search client: {e}"))?;

    let runtime = new_sandbox_runtime()?;
    let ctx = Context::full(&runtime).map_err(|e| format!("create JS context: {e}"))?;
    let count = Arc::new(AtomicU32::new(0));
    let slot = Arc::new(Mutex::new(None));
    let policy = HttpPolicy::new();
    // Arm the policy from the manifest captured at validation time. The
    // source re-declares the same values when it calls definePlugin below,
    // but arming up front means the allowlist is in force even if that
    // call is somehow skipped.
    policy.set_allowlist(descriptor.manifest.allowed_hosts.clone());
    policy.set_rate_limit_ms(descriptor.manifest.rate_limit_ms);

    ctx.with(|ctx| -> Result<Vec<PluginRawResult>, String> {
        inject_http_globals(&ctx, &http, &policy)?;
        inject_define_plugin(&ctx, &count, &slot, &policy)?;
        if let Err(e) = ctx.eval::<(), _>(descriptor.source.as_str()) {
            return Err(describe_js_error(&ctx, "eval plugin", e));
        }
        let _search: Function = ctx.globals().get("__pluginSearch").map_err(|e| {
            describe_js_error(&ctx, "plugin did not expose a search function", e)
        })?;
        // Inject the query as a plain JS string *value*. rquickjs copies
        // the bytes verbatim into a JS string (no source evaluation), so
        // arbitrary user input is safe. Previously this passed the
        // `serde_json::to_string` output through `.set`, which stored the
        // JSON-quoted text (`"everrail"`) as the value — so every plugin
        // received a query with literal surrounding quote characters and
        // exact-match search engines (e.g. online-fix) returned nothing.
        ctx.globals()
            .set("__pluginQuery", query.to_string())
            .map_err(|e| format!("inject query: {e}"))?;
        // Inject the config as a parsed JS object *value*. `config_json`
        // is always a JSON object string ("{}" when the user configured
        // nothing), so legacy plugins that ignore the second argument
        // keep working. Parsing in the runtime (rather than pasting the
        // string into source) keeps arbitrary secret values inert.
        let config = ctx
            .json_parse(config_json.to_string())
            .map_err(|e| describe_js_error(&ctx, "inject config", e))?;
        ctx.globals()
            .set("__pluginConfig", config)
            .map_err(|e| format!("inject config: {e}"))?;
        let wrapper = r#"(function () {
            var r = __pluginSearch(__pluginQuery, __pluginConfig);
            if (r == null) r = [];
            if (!Array.isArray(r)) throw new Error("plugin search() must return an array");
            return JSON.stringify(r);
        })()"#;
        let json: String = ctx
            .eval(wrapper)
            .map_err(|e| describe_js_error(&ctx, "run search", e))?;
        serde_json::from_str::<Vec<PluginRawResult>>(&json)
            .map_err(|e| format!("parse plugin results: {e}"))
    })
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/// Parse an RSS 2.0 / Torznab feed into the fixed JSON shape handed to
/// JS by `httpGetXml`:
///
/// ```text
/// { title, link, description,                       // channel-level, null when absent
///   items: [ { title, link, guid, pubDate,          // item child elements, first wins
///              description, size,
///              enclosure: { url, length, type } | null,
///              attrs: { <attrName>: <attrValue> }   // torznab:attr / bare <attr>
///            } ] }
/// ```
///
/// Implementation notes:
/// - Built with `quick_xml::Reader` events (`Event::Start` / `Empty` /
///   `Text` / `CData` / `End`) — deliberately NOT serde-xml-rs, keeping
///   the parsing explicit and auditable (quick-xml 0.41 is already in
///   the tree via librqbit-upnp).
/// - Element names are matched by *local* name (`QName::local_name`),
///   so `<torznab:attr …/>` and `<attr …/>` are the same thing.
/// - Every field is first-occurrence-wins; duplicate child elements
///   (some feeds repeat `<title>`) are ignored after the first.
/// - Text is entity-unescaped (`&amp;` → `&`, …) and trimmed; CDATA
///   sections are decoded and appended to the surrounding text.
fn parse_torznab_xml(xml: &str) -> Result<serde_json::Value, String> {
    let mut reader = quick_xml::Reader::from_reader(xml.as_bytes());

    let mut top: serde_json::Map<String, serde_json::Value> = serde_json::Map::new();
    let mut items: Vec<serde_json::Map<String, serde_json::Value>> = Vec::new();
    // Index into `items` while inside an `<item>` element.
    let mut current_item: Option<usize> = None;
    // Text accumulated for the element being read (cleared on Start/End).
    let mut pending_text = String::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                pending_text.clear();
                let name = local_name_str(e.name());
                if name == "item" {
                    items.push(serde_json::Map::new());
                    current_item = Some(items.len() - 1);
                }
            }
            Ok(Event::Empty(e)) => {
                // Self-closing element — the only ones we care about
                // inside items are `<torznab:attr …/>` and `<enclosure …/>`.
                if let Some(idx) = current_item {
                    let name = local_name_str(e.name());
                    if name == "attr" {
                        if let (Some(n), Some(v)) = (attr_str(&e, "name"), attr_str(&e, "value")) {
                            let attrs = items[idx]
                                .entry("attrs")
                                .or_insert_with(|| {
                                    serde_json::Value::Object(serde_json::Map::new())
                                })
                                .as_object_mut()
                                .expect("attrs entry is the object we just created");
                            if !attrs.contains_key(&n) {
                                attrs.insert(n, serde_json::Value::String(v));
                            }
                        }
                    } else if name == "enclosure" {
                        let mut enc = serde_json::Map::new();
                        for (k, v) in [
                            ("url", attr_str(&e, "url")),
                            ("length", attr_str(&e, "length")),
                            ("type", attr_str(&e, "type")),
                        ] {
                            if let Some(v) = v {
                                enc.insert(k.to_string(), serde_json::Value::String(v));
                            }
                        }
                        let entry = items[idx]
                            .entry("enclosure")
                            .or_insert_with(|| serde_json::Value::Null);
                        if entry.is_null() {
                            *entry = serde_json::Value::Object(enc);
                        }
                    }
                }
            }
            Ok(Event::Text(t)) => {
                if let Ok(text) = t.xml_content(quick_xml::XmlVersion::Implicit1_0) {
                    let unescaped = quick_xml::escape::unescape(&text)
                        .unwrap_or_else(|_| std::borrow::Cow::Borrowed(&text));
                    pending_text.push_str(&unescaped);
                }
            }
            Ok(Event::CData(t)) => {
                if let Ok(text) = t.decode() {
                    pending_text.push_str(&text);
                }
            }
            Ok(Event::GeneralRef(r)) => {
                if let Ok(entity) = r.decode() {
                    match entity.as_ref() {
                        "amp" => pending_text.push('&'),
                        "lt" => pending_text.push('<'),
                        "gt" => pending_text.push('>'),
                        "quot" => pending_text.push('"'),
                        "apos" => pending_text.push('\''),
                        _ => {}
                    }
                }
            }
            Ok(Event::End(e)) => {
                let name = local_name_str(e.name());
                let text = pending_text.trim().to_string();
                if name == "item" {
                    if let Some(idx) = current_item {
                        items[idx]
                            .entry("enclosure".to_string())
                            .or_insert(serde_json::Value::Null);
                        items[idx]
                            .entry("attrs".to_string())
                            .or_insert(serde_json::Value::Null);
                    }
                    current_item = None;
                } else if !text.is_empty() {
                    if let Some(idx) = current_item {
                        // Item child element → item field (first wins).
                        let entry = items[idx]
                            .entry(name.clone())
                            .or_insert_with(|| serde_json::Value::Null);
                        if entry.is_null() {
                            *entry = serde_json::Value::String(text);
                        }
                    } else if matches!(name.as_str(), "title" | "link" | "description") {
                        // Channel-level field (first wins).
                        let entry = top
                            .entry(name.clone())
                            .or_insert_with(|| serde_json::Value::Null);
                        if entry.is_null() {
                            *entry = serde_json::Value::String(text);
                        }
                    }
                }
                pending_text.clear();
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("httpGetXml: XML parse error: {e}")),
            // Decl / PI / Comment / DocType / GeneralRef — ignored.
            _ => {}
        }
    }

    let mut obj = serde_json::Map::with_capacity(4);
    for key in ["title", "link", "description"] {
        obj.insert(
            key.to_string(),
            top.remove(key).unwrap_or(serde_json::Value::Null),
        );
    }
    obj.insert(
        "items".to_string(),
        serde_json::Value::Array(
            items
                .into_iter()
                .map(serde_json::Value::Object)
                .collect(),
        ),
    );
    Ok(serde_json::Value::Object(obj))
}

/// Local (prefix-stripped) element name: `torznab:attr` → `attr`.
fn local_name_str(name: QName<'_>) -> String {
    String::from_utf8_lossy(name.local_name().as_ref()).into_owned()
}

/// Value of the first attribute of `e` whose local name matches `key`.
fn attr_str(e: &BytesStart<'_>, key: &str) -> Option<String> {
    for attr in e.attributes().flatten() {
        let k =
            String::from_utf8_lossy(attr.key.local_name().as_ref()).into_owned();
        if k == key {
            return attr
                .normalized_value(quick_xml::XmlVersion::Implicit1_0)
                .ok()
                .map(|v| v.trim().to_string());
        }
    }
    None
}

/// Turn a `rquickjs::Error` into a human-readable message, pulling the
/// actual JS exception text (e.g. an `httpGet` failure thrown by our
/// own closure) out of the context when it's the generic
/// `Error::Exception` variant.
fn describe_js_error(ctx: &Ctx, prefix: &str, e: rquickjs::Error) -> String {
    let msg = ctx
        .catch()
        .as_object()
        .and_then(|obj| obj.get::<_, Option<Coerced<String>>>("message").ok().flatten())
        .map(|m| m.to_string())
        .unwrap_or_else(|| e.to_string());
    format!("{prefix}: {msg}")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Torznab-style feed exercising every parser rule: channel-level
    /// fields, item child elements, a namespaced `attr`, a bare `attr`,
    /// an `enclosure`, entity escaping, and duplicate-child ignoring.
    const SAMPLE_FEED: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed">
  <channel>
    <title>Sample Index</title>
    <link>https://example.com</link>
    <description>Feed &amp; channel</description>
    <item>
      <title>Elden Ring &amp; Co</title>
      <guid isPermaLink="true">https://example.com/torrent/42</guid>
      <pubDate>Wed, 12 Aug 2026 14:30:00 +0000</pubDate>
      <link>https://example.com/torrent/42/</link>
      <description><![CDATA[Some <b>description</b>]]></description>
      <torznab:attr name="seeders" value="1226"/>
      <torznab:attr name="peers" value="10"/>
      <torznab:attr name="infohash" value="4cc8e331e699748269f6ac1b98b802684f5ac97a"/>
      <attr name="magneturl" value="magnet:?xt=urn:btih:4cc8e331e699748269f6ac1b98b802684f5ac97a"/>
      <enclosure url="https://example.com/dl/42.torrent" length="12345678" type="application/x-bittorrent"/>
    </item>
    <item>
      <title>Second Result</title>
      <title>Ignored Duplicate Title</title>
      <guid>43</guid>
    </item>
  </channel>
</rss>"#;

    #[test]
    fn parse_torznab_feed_builds_expected_shape() {
        let value = parse_torznab_xml(SAMPLE_FEED).expect("parse");
        let obj = value.as_object().expect("root object");

        assert_eq!(obj["title"], "Sample Index");
        assert_eq!(obj["link"], "https://example.com");
        assert_eq!(obj["description"], "Feed & channel");

        let items = obj["items"].as_array().expect("items array");
        assert_eq!(items.len(), 2);

        let first = items[0].as_object().expect("item 0");
        // Entity-unescaped text.
        assert_eq!(first["title"], "Elden Ring & Co");
        assert_eq!(first["guid"], "https://example.com/torrent/42");
        assert_eq!(first["pubDate"], "Wed, 12 Aug 2026 14:30:00 +0000");
        assert_eq!(first["link"], "https://example.com/torrent/42/");
        // CDATA decoded, entity-safe.
        assert_eq!(first["description"], "Some <b>description</b>");

        // torznab:attr + bare attr both land in attrs by name.
        let attrs = first["attrs"].as_object().expect("attrs");
        assert_eq!(attrs["seeders"], "1226");
        assert_eq!(attrs["peers"], "10");
        assert_eq!(attrs["infohash"], "4cc8e331e699748269f6ac1b98b802684f5ac97a");
        assert_eq!(
            attrs["magneturl"],
            "magnet:?xt=urn:btih:4cc8e331e699748269f6ac1b98b802684f5ac97a"
        );

        let enc = first["enclosure"].as_object().expect("enclosure");
        assert_eq!(enc["url"], "https://example.com/dl/42.torrent");
        assert_eq!(enc["length"], "12345678");
        assert_eq!(enc["type"], "application/x-bittorrent");

        // Second item: first child element wins, duplicate ignored.
        let second = items[1].as_object().expect("item 1");
        assert_eq!(second["title"], "Second Result");
        assert_eq!(second["guid"], "43");
        assert!(second["enclosure"].is_null());
        assert!(second["attrs"].is_null());
    }

    #[test]
    fn parse_torznab_malformed_xml_is_an_error() {
        // Mismatched end tags trip the reader's `check_end_names`
        // validation (truncation can surface as plain `Eof`).
        let err = parse_torznab_xml("<rss><channel><item><title>unterminated</item></channel></rss>")
            .unwrap_err();
        assert!(err.contains("XML parse error"), "unexpected: {err}");
    }
}
