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

use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

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

// ─── Plugin descriptor ──────────────────────────────────────────────────────

/// The manifest a plugin declares via `definePlugin`. All fields are
/// plain owned data so a [`PluginDescriptor`] can be moved across
/// threads into `spawn_blocking`.
#[derive(Debug, Clone)]
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

/// Give a sandbox the three HTTP globals. `httpGet` is a Rust closure;
/// `httpGetJson` is a one-line JS wrapper so parse errors are regular
/// JS exceptions with a stack; `httpGetXml` runs the quick-xml feed
/// parser (see [`parse_torznab_xml`]) and returns a real JS object.
fn inject_http_globals<'js>(ctx: &Ctx<'js>, http: &reqwest::blocking::Client) -> Result<(), String> {
    let http_get_owned = http.clone();
    let http_get = Function::new(
        ctx.clone(),
        move |ctx: Ctx<'js>, url: String, referer: Opt<String>| -> Result<String, rquickjs::Error> {
            http_get_text(&http_get_owned, &url, referer.as_deref())
                .map_err(|e| Exception::throw_message(&ctx, &e))
        },
    )
    .map_err(|e| format!("create httpGet closure: {e}"))?;
    ctx.globals()
        .set("httpGet", http_get)
        .map_err(|e| format!("inject httpGet: {e}"))?;

    let http_get_xml_owned = http.clone();
    let http_get_xml = Function::new(
        ctx.clone(),
        move |ctx: Ctx<'js>, url: String, referer: Opt<String>| -> Result<Value<'js>, rquickjs::Error> {
            let text = http_get_text(&http_get_xml_owned, &url, referer.as_deref())
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

    ctx.eval::<(), _>(
        "function httpGetJson(url, referer) { return JSON.parse(httpGet(url, referer)); }",
    )
    .map_err(|e| format!("inject httpGetJson: {e}"))?;

    inject_http_get_all(ctx, http)
}

/// Give a sandbox the `httpGetAll(urls)` global: fetches many URLs in
/// parallel and returns an array of bodies aligned with the input
/// (failed fetches become empty strings). Used by catalog-style plugins
/// (e.g. romheaven) that must pull a couple dozen small index files in
/// one search — fetching them sequentially would blow the 20 s search
/// budget. Concurrency is capped so a public gateway is not hammered.
fn inject_http_get_all<'js>(
    ctx: &Ctx<'js>,
    http: &reqwest::blocking::Client,
) -> Result<(), String> {
    let http_owned = http.clone();
    let get_all = Function::new(
        ctx.clone(),
        move |ctx: Ctx<'js>, urls: Vec<String>| -> Result<Value<'js>, rquickjs::Error> {
            // Chunked so at most CONCURRENT_FETCHES requests are in
            // flight at once; each thread returns its own body and the
            // chunk joins before the next starts, so there is no shared
            // mutable state to synchronise.
            const CONCURRENT_FETCHES: usize = 8;
            let mut results: Vec<String> = Vec::with_capacity(urls.len());
            for chunk in urls.chunks(CONCURRENT_FETCHES) {
                let chunk_results = std::thread::scope(|scope| {
                    let handles: Vec<_> = chunk
                        .iter()
                        .map(|url| {
                            let client = http_owned.clone();
                            let url = url.clone();
                            scope.spawn(move || {
                                http_get_text(&client, &url, None).unwrap_or_default()
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
/// 3. stashes the `search` function on the private `__pluginSearch`
///    global for the query wrapper to call,
/// 4. records the manifest in the Rust `slot` for the caller.
fn inject_define_plugin<'js>(
    ctx: &Ctx<'js>,
    count: &Arc<AtomicU32>,
    slot: &Arc<Mutex<Option<PluginManifest>>>,
) -> Result<(), String> {
    let count_f = count.clone();
    let slot_f = slot.clone();
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
            let search: Function = descriptor.get("search")?;
            ctx.globals().set("__pluginSearch", search)?;
            let manifest = PluginManifest {
                id,
                name,
                version,
                author,
                description,
                source_url,
                platform_category,
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

    ctx.with(|ctx| -> Result<(), String> {
        inject_http_globals(&ctx, http)?;
        inject_define_plugin(&ctx, &count, &slot)?;
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
    http: &reqwest::blocking::Client,
) -> Result<Vec<PluginRawResult>, String> {
    let runtime = new_sandbox_runtime()?;
    let ctx = Context::full(&runtime).map_err(|e| format!("create JS context: {e}"))?;
    let count = Arc::new(AtomicU32::new(0));
    let slot = Arc::new(Mutex::new(None));

    ctx.with(|ctx| -> Result<Vec<PluginRawResult>, String> {
        inject_http_globals(&ctx, http)?;
        inject_define_plugin(&ctx, &count, &slot)?;
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
        let wrapper = r#"(function () {
            var r = __pluginSearch(__pluginQuery);
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

/// The blocking GET behind the `httpGet` global.
///
/// Scheme check first: only `http://` / `https://` ever reach the
/// client — `file://`, `ftp://`, etc. are rejected. Then up to three
/// attempts (immediate, +500 ms, +1 s) for transport errors and HTTP
/// 5xx; 4xx fails on the first attempt because retrying a 403/404
/// never helps and only wastes the search budget.
fn http_get_text(
    client: &reqwest::blocking::Client,
    url: &str,
    referer: Option<&str>,
) -> Result<String, String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(format!("httpGet: blocked non-http(s) URL: {url}"));
    }
    let mut last_err = String::new();
    for attempt in 0..HTTP_MAX_ATTEMPTS {
        if attempt > 0 {
            let backoff = HTTP_RETRY_BACKOFF_MS[(attempt - 1).min(HTTP_RETRY_BACKOFF_MS.len() - 1)];
            std::thread::sleep(Duration::from_millis(backoff));
        }
        let mut req = client.get(url);
        if let Some(r) = referer {
            req = req.header(reqwest::header::REFERER, r);
        }
        match req.send() {
            Ok(resp) => {
                let status = resp.status();
                if status.is_success() {
                    return resp
                        .text()
                        .map_err(|e| format!("httpGet: read body of {url}: {e}"));
                }
                last_err = format!("HTTP {}", status.as_u16());
                if !status.is_server_error() {
                    return Err(format!("httpGet: {url} -> {last_err}"));
                }
                // 5xx → fall through to the next attempt.
            }
            Err(e) => last_err = format!("{e}"),
        }
    }
    Err(format!("httpGet: {url} failed after {HTTP_MAX_ATTEMPTS} attempts: {last_err}"))
}

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
///   the dependency tree identical to the vendored `librqbit-upnp`
///   patch and the parsing explicit and auditable.
/// - Element names are matched by *local* name (`QName::local_name`),
///   so `<torznab:attr …/>` and `<attr …/>` are the same thing.
/// - Every field is first-occurrence-wins; duplicate child elements
///   (some feeds repeat `<title>`) are ignored after the first.
/// - Text is entity-unescaped (`&amp;` → `&`, …) and trimmed; CDATA
///   sections are decoded and appended to the surrounding text.
fn parse_torznab_xml(xml: &str) -> Result<serde_json::Value, String> {
    let mut reader = quick_xml::Reader::from_reader(xml.as_bytes());
    reader.config_mut().trim_text(true);

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
                    pending_text.push_str(text.trim());
                }
            }
            Ok(Event::CData(t)) => {
                if let Ok(text) = t.decode() {
                    pending_text.push_str(text.trim());
                }
            }
            Ok(Event::End(e)) => {
                let name = local_name_str(e.name());
                let text = pending_text.trim().to_string();
                if name == "item" {
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
