//! Per-hoster URL resolvers for direct HTTP downloads.
//!
//! Many "direct" links in Hydra-format sources are actually portal / redirect
//! pages (or API stubs) that must be resolved into a real file URL before the
//! bytes can be streamed. This mirrors Hydra's `getXxxDownloadOptions`
//! resolvers (`src/main/services/hosters/*`): each hoster has a small routine
//! that turns the raw `uri` into a downloadable URL (and, where required, the
//! `Referer`/`Cookie` headers the hoster expects).
//!
//! `resolve()` is called once per download before streaming. Hosters not
//! listed here fall through to `Passthrough` (the original URL is used as-is).

use reqwest::header::{ACCEPT, REFERER, USER_AGENT};
use reqwest::Client;
use regex::Regex;
use serde_json::Value;
use std::sync::OnceLock;
use std::time::Duration;

const HOSTER_UA: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0";

pub struct ResolvedTarget {
    pub url: String,
    pub headers: Vec<(String, String)>,
}

pub enum ResolveOutcome {
    /// No resolver for this hoster — download the original URL as-is.
    Passthrough,
    /// Resolved to a real file URL (plus optional request headers).
    Resolved(ResolvedTarget),
    /// A resolver matched but failed (e.g. file deleted, rate limited).
    Error(String),
}

fn http_client() -> Client {
    Client::builder()
        .user_agent(HOSTER_UA)
        .cookie_store(true)
        .timeout(Duration::from_secs(30))
        .build()
        .unwrap_or_default()
}

pub async fn resolve(url: &str) -> ResolveOutcome {
    let host = match url::Url::parse(url).ok().and_then(|u| u.host_str().map(|s| s.to_lowercase())) {
        Some(h) => h,
        None => return ResolveOutcome::Passthrough,
    };

    if host.contains("datanodes.to") {
        match datanodes_get_download_url(url).await {
            Ok(u) => ResolveOutcome::Resolved(ResolvedTarget { url: u, headers: vec![] }),
            Err(e) => ResolveOutcome::Error(e),
        }
    } else if host.contains("fuckingfast.co") {
        match fuckingfast_get_direct_link(url).await {
            Ok(u) => ResolveOutcome::Resolved(ResolvedTarget { url: u, headers: vec![] }),
            Err(e) => ResolveOutcome::Error(e),
        }
    } else if host.contains("mediafire.com") {
        match mediafire_get_download_url(url).await {
            Ok(u) => ResolveOutcome::Resolved(ResolvedTarget { url: u, headers: vec![] }),
            Err(e) => ResolveOutcome::Error(e),
        }
    } else if host.contains("pixeldrain.com") {
        match pixeldrain_unlock(url).await {
            Ok(u) => ResolveOutcome::Resolved(ResolvedTarget { url: u, headers: vec![] }),
            Err(e) => ResolveOutcome::Error(e),
        }
    } else if host.contains("rootz.so") {
        match rootz_get_download_url(url).await {
            Ok(u) => ResolveOutcome::Resolved(ResolvedTarget { url: u, headers: vec![] }),
            Err(e) => ResolveOutcome::Error(e),
        }
    } else if host.contains("vikingfile") {
        match vikingfile_get_download_url(url).await {
            Ok(u) => ResolveOutcome::Resolved(ResolvedTarget { url: u, headers: vec![] }),
            Err(e) => ResolveOutcome::Error(e),
        }
    } else if host.contains("buzzheavier.com") || host.contains("buzzheavier") {
        // Buzzheavier (a common AnkerGames mirror) hotlink-protects its files:
        // a plain GET returns an HTML/404 page unless a `Referer` to the site
        // origin is sent. Mirrors the behaviour Hydra sources rely on.
        ResolveOutcome::Resolved(ResolvedTarget {
            url: url.to_string(),
            headers: vec![("Referer".to_string(), "https://buzzheavier.com/".to_string())],
        })
    } else if host.contains("gofile.io") || host.contains("gofilecdn") {
        // Gofile requires executing its obfuscated `wt.obf.js` to derive a
        // "website token" (Hydra uses Node's `vm`). Not implemented here
        // without a JS runtime — falls through to a direct attempt.
        ResolveOutcome::Passthrough
    } else {
        ResolveOutcome::Passthrough
    }
}

/// Read a response body as text and parse it as JSON, logging a snippet of
/// the body on failure so non-JSON replies (HTML error / captcha pages) are
/// diagnosable instead of surfacing a cryptic "error decoding response body".
async fn response_json(resp: reqwest::Response) -> Result<Value, String> {
    let status = resp.status();
    let body = resp.text().await.map_err(|e| e.to_string())?;
    match serde_json::from_str::<Value>(&body) {
        Ok(v) => Ok(v),
        Err(e) => {
            let snippet = if body.len() > 600 { &body[..600] } else { &body };
            Err(format!(
                "Failed to parse JSON (status {}): {} | body: {}",
                status, e, snippet
            ))
        }
    }
}

// ── Datanodes ────────────────────────────────────────────────────────────────
async fn datanodes_get_download_url(download_url: &str) -> Result<String, String> {
    let client = http_client();
    let parsed = url::Url::parse(download_url).map_err(|e| e.to_string())?;
    let file_code = parsed
        .path_segments()
        .and_then(|s| s.filter(|p| !p.is_empty()).next())
        .ok_or("Invalid datanodes URL")?
        .to_string();

    // Establish a session (sets the PHP session cookie) by first visiting the
    // file page. Without it the `download2` POST is treated as a plain page
    // request and returns the HTML page instead of the JSON download link.
    let _ = client
        .get(download_url)
        .header(USER_AGENT, HOSTER_UA)
        .header("Cookie", "lang=english")
        .send()
        .await;

    // Datanodes' `op=download2` handler only parses `application/x-www-form-urlencoded`
    // (not multipart), so send the form urlencoded.
    let params = [
        ("op", "download2"),
        ("id", file_code.as_str()),
        ("rand", ""),
        ("referer", "https://datanodes.to/download"),
        ("method_free", "Free Download >>"),
        ("method_premium", ""),
        ("__dl", "1"),
        ("g_captch__a", "1"),
    ];

    let resp = client
        .post("https://datanodes.to/download")
        .form(&params)
        .header(USER_AGENT, HOSTER_UA)
        .header(REFERER, "https://datanodes.to/download")
        .header("X-Requested-With", "XMLHttpRequest")
        .header("Cookie", "lang=english")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let json: Value = response_json(resp).await?;
    let url = json
        .get("url")
        .and_then(|v| v.as_str())
        .ok_or("Failed to get the download link")?;
    let decoded = urlencoding::decode(url).map_err(|e| e.to_string())?;
    Ok(decoded.into_owned())
}

// ── FuckingFast ──────────────────────────────────────────────────────────────
fn fuckingfast_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"window\.open\("(https://fuckingfast\.co/dl/[^"]*)"\)"#).unwrap())
}

async fn fuckingfast_get_direct_link(url: &str) -> Result<String, String> {
    let client = http_client();
    let resp = client
        .get(url)
        .header(USER_AGENT, HOSTER_UA)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let html = resp.text().await.map_err(|e| e.to_string())?;

    if html.to_lowercase().contains("rate limit") {
        return Err(
            "Rate limit exceeded. Please wait a few minutes and try again.".to_string(),
        );
    }
    if html.contains("File Not Found Or Deleted") {
        return Err("File not found or deleted".to_string());
    }

    let m = fuckingfast_re()
        .captures(&html)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
        .ok_or("Could not extract download link from page")?;
    Ok(m)
}

// ── Mediafire ────────────────────────────────────────────────────────────────
fn mediafire_ident_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^[a-zA-Z0-9]+$").unwrap())
}
fn mediafire_pre_dl_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            "(https?://)?(//)?(www\\.)?mediafire\\.com/(file|view|download)/[^'\"\\s?]+\\?dkey=[^'\"]+",
        )
        .unwrap()
    })
}
fn mediafire_dl_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new("https?://download\\d+\\.mediafire\\.com/[^'\"]+").unwrap()
    })
}

fn process_mediafire_url(url: &str) -> String {
    let mut processed = url.replace("http://", "https://");
    if mediafire_ident_re().is_match(&processed) {
        processed = format!("https://mediafire.com/?{}", processed);
    }
    if !processed.starts_with("http://") && !processed.starts_with("https://") {
        if processed.starts_with("//") {
            processed = format!("https:{}", processed);
        } else {
            processed = format!("https://{}", processed);
        }
    }
    processed
}

fn extract_mediafire_direct_url(html: &str) -> Result<String, String> {
    if let Some(c) = mediafire_pre_dl_re().captures(html) {
        let mut m = c.get(0).unwrap().as_str().to_string();
        m = m.trim_matches(|c| c == '"' || c == '\'').to_string();
        if m.starts_with("//") {
            return Ok(format!("https:{}", m));
        }
        return Ok(m);
    }
    if let Some(c) = mediafire_dl_re().captures(html) {
        let mut m = c.get(0).unwrap().as_str().to_string();
        m = m.trim_matches(|c| c == '"' || c == '\'').to_string();
        return Ok(m);
    }
    Err("No valid download links found".to_string())
}

async fn mediafire_get_download_url(mediafire_url: &str) -> Result<String, String> {
    let client = http_client();
    let processed = process_mediafire_url(mediafire_url);
    let resp = client
        .get(&processed)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err("Failed to fetch Mediafire page".to_string());
    }
    let html = resp.text().await.map_err(|e| e.to_string())?;
    extract_mediafire_direct_url(&html)
}

// ── PixelDrain ───────────────────────────────────────────────────────────────
async fn pixeldrain_unlock(url: &str) -> Result<String, String> {
    let client = http_client();
    let parsed = url::Url::parse(url).map_err(|e| e.to_string())?;
    let segments: Vec<&str> = parsed
        .path_segments()
        .map(|s| s.filter(|p| !p.is_empty()).collect())
        .unwrap_or_default();
    if segments.first().copied() != Some("u") || segments.get(1).is_none() {
        return Err(format!("Invalid pixeldrain URL: {}", url));
    }
    let id = segments[1];

    let bypass = format!("https://cdn.pixeldrain.eu.cc/{}", id);
    if let Ok(r) = client
        .head(&bypass)
        .timeout(Duration::from_secs(5))
        .send()
        .await
    {
        if r.status().is_success() {
            return Ok(bypass);
        }
    }

    let avail = client
        .head(format!("https://pixeldrain.com/u/{}", id))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if avail.status() == reqwest::StatusCode::NOT_FOUND {
        return Err("File not found".to_string());
    }

    Ok(format!("https://pixeldrain.com/api/file/{}?download", id))
}

// ── Rootz ─────────────────────────────────────────────────────────────────────
fn rootz_page_token_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"pageToken"\s*:\s*"([^"\\]+)"#).unwrap())
}

async fn rootz_get_download_url(uri: &str) -> Result<String, String> {
    let client = http_client();
    let url = url::Url::parse(uri).map_err(|e| e.to_string())?;
    let segments: Vec<&str> = url
        .path_segments()
        .map(|s| s.filter(|p| !p.is_empty()).collect())
        .unwrap_or_default();
    if segments.first().copied() != Some("d") || segments.get(1).is_none() {
        return Err("Invalid rootz URL format".to_string());
    }
    let id = segments[1];

    let page_url = format!("https://www.rootz.so/d/{}", id);
    let page = client
        .get(&page_url)
        .header(USER_AGENT, HOSTER_UA)
        .header(ACCEPT, "text/html")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let html = page.text().await.map_err(|e| e.to_string())?;
    let token = rootz_page_token_re()
        .captures(&html)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
        .ok_or("Rootz page token not found")?;

    let api = format!(
        "https://www.rootz.so/api/files/download-by-short?shortId={}",
        urlencoding::encode(id)
    );
    let resp = client
        .get(&api)
        .header(USER_AGENT, HOSTER_UA)
        .header(ACCEPT, "application/json")
        .header(REFERER, &page_url)
        .header("X-Page-Token", &token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let json: Value = response_json(resp).await?;

    if json.get("success").and_then(|v| v.as_bool()) != Some(true) {
        return Err(
            json.get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("Failed to get download URL from rootz API")
                .to_string(),
        );
    }
    let data = json.get("data").ok_or("Failed to get download URL from rootz API")?;
    if let Some(s) = data.get("status").and_then(|v| v.as_str()) {
        if s != "active" {
            return Err(format!("Rootz file is {}", s));
        }
    }
    if data.get("downloadAllowed").and_then(|v| v.as_bool()) == Some(false) {
        return Err("Rootz download is not allowed".to_string());
    }
    if data.get("passwordProtected").and_then(|v| v.as_bool()) == Some(true) {
        return Err("Rootz file is password protected".to_string());
    }
    let file_id = data
        .get("fileId")
        .and_then(|v| v.as_str())
        .ok_or("Failed to get download URL from rootz API")?;

    Ok(format!("https://www.rootz.so/api/files/proxy-download/{}", file_id))
}

// ── VikingFile ────────────────────────────────────────────────────────────────
async fn vikingfile_get_download_url(uri: &str) -> Result<String, String> {
    let base = match std::env::var("MAIN_VITE_NIMBUS_API_URL") {
        Ok(v) if !v.is_empty() => v,
        _ => {
            return Err(
                "VikingFile resolver requires MAIN_VITE_NIMBUS_API_URL".to_string(),
            )
        }
    };
    let client = http_client();
    let resp = client
        .post(format!("{}/hosters/unlock", base.trim_end_matches('/')))
        .json(&serde_json::json!({ "url": uri }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let json: Value = response_json(resp).await?;
    let link = json
        .get("link")
        .and_then(|v| v.as_str())
        .ok_or("Failed to unlock VikingFile URL")?;
    let redirect_url = link.to_string();

    // The downloader already follows redirects, so returning the unlocked
    // link (which may itself 301/302 to the CDN) is sufficient.
    Ok(redirect_url)
}
