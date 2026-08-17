//! Per-hoster URL resolvers for direct HTTP downloads.
//!
//! Many "direct" links in community sources are actually portal / redirect
//! pages (or API stubs) that must be resolved into a real file URL before the
//! bytes can be streamed. Each hoster has a small routine
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

    if host.contains("gofile.io") || host.contains("gofilecdn") {
        match gofile_get_download_url(url).await {
            Ok(t) => ResolveOutcome::Resolved(t),
            Err(e) => ResolveOutcome::Error(e),
        }
    } else if host.contains("datanodes.to") {
        match datanodes_get_download_url(url).await {
            Ok(t) => ResolveOutcome::Resolved(t),
            Err(e) => ResolveOutcome::Error(e),
        }
    } else if host.contains("1fichier.com") {
        match fichier_get_download_url(url).await {
            Ok(t) => ResolveOutcome::Resolved(t),
            Err(e) => ResolveOutcome::Error(e),
        }
    } else if host.contains("krakenfiles.com") {
        match krakenfiles_get_download_url(url).await {
            Ok(t) => ResolveOutcome::Resolved(t),
            Err(e) => ResolveOutcome::Error(e),
        }
    } else if host.contains("qiwi.gg") {
        match qiwi_get_download_url(url).await {
            Ok(t) => ResolveOutcome::Resolved(t),
            Err(e) => ResolveOutcome::Error(e),
        }
    } else if host.contains("megaup.net") {
        match megaup_get_download_url(url).await {
            Ok(t) => ResolveOutcome::Resolved(t),
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
        let path = url::Url::parse(url).ok().map(|u| u.path().to_string()).unwrap_or_default();
        if path.starts_with("/f/") {
            match vikingfile_get_download_url(url).await {
                Ok(u) => ResolveOutcome::Resolved(ResolvedTarget { url: u, headers: vec![] }),
                Err(e) => ResolveOutcome::Error(e),
            }
        } else {
            ResolveOutcome::Passthrough
        }
    } else if host.contains("buzzheavier") {
        match buzzheavier_get_download_url(url).await {
            Ok(t) => ResolveOutcome::Resolved(t),
            Err(e) => ResolveOutcome::Error(e),
        }
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

// ── Gofile ───────────────────────────────────────────────────────────────────
async fn gofile_get_download_url(url: &str) -> Result<ResolvedTarget, String> {
    let client = http_client();
    let parsed = url::Url::parse(url).map_err(|e| e.to_string())?;
    let content_id = parsed
        .path_segments()
        .and_then(|mut s| {
            if s.next() == Some("d") {
                s.next()
            } else {
                None
            }
        })
        .or_else(|| parsed.path_segments().and_then(|s| s.last()))
        .ok_or("Invalid Gofile URL format")?;

    // Create guest account/token for Gofile API
    let account_resp = client
        .post("https://api.gofile.io/accounts")
        .header(USER_AGENT, HOSTER_UA)
        .header(ACCEPT, "application/json")
        .send()
        .await;

    let token = if let Ok(resp) = account_resp {
        if let Ok(json) = resp.json::<Value>().await {
            json.pointer("/data/token")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        } else {
            None
        }
    } else {
        None
    };

    let mut req = client
        .get(format!("https://api.gofile.io/contents/{}", content_id))
        .header(USER_AGENT, HOSTER_UA)
        .header(ACCEPT, "application/json");

    if let Some(tok) = &token {
        req = req.header("Authorization", format!("Bearer {}", tok));
    }

    let resp = req
        .send()
        .await
        .map_err(|e| format!("Gofile API request failed: {e}"))?;
    let json: Value = response_json(resp).await?;

    if json.get("status").and_then(|v| v.as_str()) != Some("ok") {
        let err_msg = json
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        return Err(format!("Gofile error: {}", err_msg));
    }

    let data = json.get("data").ok_or("Empty Gofile data")?;
    let direct_link = if let Some(link) = data.get("link").and_then(|v| v.as_str()) {
        link.to_string()
    } else if let Some(children) = data.get("children").and_then(|v| v.as_object()) {
        let first_child = children
            .values()
            .next()
            .ok_or("No files found in Gofile folder")?;
        first_child
            .get("link")
            .and_then(|v| v.as_str())
            .ok_or("No download link in Gofile file object")?
            .to_string()
    } else {
        return Err("Could not extract download link from Gofile API".to_string());
    };

    let mut headers = vec![
        (USER_AGENT.to_string(), HOSTER_UA.to_string()),
        ("Referer".to_string(), "https://gofile.io/".to_string()),
    ];
    if let Some(tok) = token {
        headers.push(("Cookie".to_string(), format!("accountToken={}", tok)));
    }

    Ok(ResolvedTarget {
        url: direct_link,
        headers,
    })
}

// ── Datanodes ────────────────────────────────────────────────────────────────
async fn datanodes_get_download_url(download_url: &str) -> Result<ResolvedTarget, String> {
    let client = http_client();
    let parsed = url::Url::parse(download_url).map_err(|e| e.to_string())?;
    let file_code = parsed
        .path_segments()
        .and_then(|s| s.filter(|p| !p.is_empty()).next())
        .ok_or("Invalid datanodes URL")?
        .to_string();

    // Establish a session (sets PHP session cookie) by first visiting the file page.
    let page_resp = client
        .get(download_url)
        .header(USER_AGENT, HOSTER_UA)
        .header("Cookie", "lang=english")
        .send()
        .await;

    let page_html = if let Ok(resp) = page_resp {
        resp.text().await.unwrap_or_default()
    } else {
        String::new()
    };

    // Check if a countdown timer is indicated on the page
    let wait_secs = if let Some(caps) = Regex::new(r#"(?:countdown|timer|seconds|wait)\s*[:=]\s*(\d+)"#)
        .ok()
        .and_then(|re| re.captures(&page_html))
    {
        caps.get(1)
            .and_then(|m| m.as_str().parse::<u64>().ok())
            .unwrap_or(0)
            .min(15)
    } else {
        0
    };

    if wait_secs > 0 {
        tokio::time::sleep(Duration::from_secs(wait_secs)).await;
    }

    // Datanodes `op=download2` form urlencoded
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
        .ok_or("Failed to get the download link from Datanodes")?;
    let decoded = urlencoding::decode(url).map_err(|e| e.to_string())?;

    Ok(ResolvedTarget {
        url: decoded.into_owned(),
        headers: vec![
            (USER_AGENT.to_string(), HOSTER_UA.to_string()),
            ("Referer".to_string(), "https://datanodes.to/".to_string()),
        ],
    })
}

// ── 1fichier ─────────────────────────────────────────────────────────────────
async fn fichier_get_download_url(url: &str) -> Result<ResolvedTarget, String> {
    let client = http_client();
    let page = client
        .get(url)
        .header(USER_AGENT, HOSTER_UA)
        .header(ACCEPT, "text/html")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let html = page.text().await.map_err(|e| e.to_string())?;

    if html.contains("File not found") || html.contains("The requested file has been deleted") {
        return Err("1fichier: File not found or deleted".to_string());
    }

    let adz_re = Regex::new(r#"name="adz"\s+value="([^"]+)""#).unwrap();
    let adz = adz_re
        .captures(&html)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string());

    let mut params = vec![("submit", "Download")];
    let adz_val;
    if let Some(ref a) = adz {
        adz_val = a.clone();
        params.push(("adz", adz_val.as_str()));
    }

    let post_resp = client
        .post(url)
        .form(&params)
        .header(USER_AGENT, HOSTER_UA)
        .header(REFERER, url)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let post_html = post_resp.text().await.map_err(|e| e.to_string())?;

    let dl_re =
        Regex::new(r#"href="(https?://[a-zA-Z0-9\-_.]+\.1fichier\.com/[^"]+)""#).unwrap();
    if let Some(cap) = dl_re.captures(&post_html) {
        let direct_url = cap.get(1).unwrap().as_str().to_string();
        return Ok(ResolvedTarget {
            url: direct_url,
            headers: vec![
                (USER_AGENT.to_string(), HOSTER_UA.to_string()),
                (REFERER.to_string(), url.to_string()),
            ],
        });
    }

    if let Some(cap) = dl_re.captures(&html) {
        let direct_url = cap.get(1).unwrap().as_str().to_string();
        return Ok(ResolvedTarget {
            url: direct_url,
            headers: vec![
                (USER_AGENT.to_string(), HOSTER_UA.to_string()),
                (REFERER.to_string(), url.to_string()),
            ],
        });
    }

    Err("1fichier: Could not extract download link. Free tier limit or captcha may be active."
        .to_string())
}

// ── KrakenFiles ──────────────────────────────────────────────────────────────
async fn krakenfiles_get_download_url(url: &str) -> Result<ResolvedTarget, String> {
    let client = http_client();
    let resp = client
        .get(url)
        .header(USER_AGENT, HOSTER_UA)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let html = resp.text().await.map_err(|e| e.to_string())?;

    let token_re = Regex::new(r#"name="token"\s+value="([^"]+)""#).unwrap();
    let token = token_re
        .captures(&html)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
        .ok_or("KrakenFiles token not found")?;

    let hash_re = Regex::new(r#"/download/([a-zA-Z0-9]+)"#).unwrap();
    let hash = hash_re
        .captures(&html)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
        .ok_or("KrakenFiles download hash not found")?;

    let post_url = format!("https://krakenfiles.com/download/{}", hash);
    let dl_resp = client
        .post(&post_url)
        .form(&[("token", token.as_str())])
        .header(USER_AGENT, HOSTER_UA)
        .header(REFERER, url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let json: Value = response_json(dl_resp).await?;
    let direct_url = json
        .get("url")
        .and_then(|v| v.as_str())
        .ok_or("No direct URL in KrakenFiles response")?;

    Ok(ResolvedTarget {
        url: direct_url.to_string(),
        headers: vec![
            (USER_AGENT.to_string(), HOSTER_UA.to_string()),
            (REFERER.to_string(), url.to_string()),
        ],
    })
}

// ── Qiwi ─────────────────────────────────────────────────────────────────────
async fn qiwi_get_download_url(url: &str) -> Result<ResolvedTarget, String> {
    let client = http_client();
    let resp = client
        .get(url)
        .header(USER_AGENT, HOSTER_UA)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let html = resp.text().await.map_err(|e| e.to_string())?;

    let dl_re =
        Regex::new(r#"href="(https?://[^"]*qiwi\.gg/(?:extract|download|dl)/[^"]+)""#).unwrap();
    if let Some(cap) = dl_re.captures(&html) {
        return Ok(ResolvedTarget {
            url: cap.get(1).unwrap().as_str().to_string(),
            headers: vec![
                (USER_AGENT.to_string(), HOSTER_UA.to_string()),
                (REFERER.to_string(), url.to_string()),
            ],
        });
    }

    Err("Qiwi: Direct download link not found on page".to_string())
}

// ── MegaUp ───────────────────────────────────────────────────────────────────
async fn megaup_get_download_url(url: &str) -> Result<ResolvedTarget, String> {
    let client = http_client();
    let resp = client
        .get(url)
        .header(USER_AGENT, HOSTER_UA)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let html = resp.text().await.map_err(|e| e.to_string())?;

    let dl_re =
        Regex::new(r#"href="([^"]+)"[^>]*class="[^"]*btn-download[^"]*""#).unwrap();
    if let Some(cap) = dl_re.captures(&html) {
        let dl_url = cap.get(1).unwrap().as_str();
        if dl_url.starts_with("http") {
            return Ok(ResolvedTarget {
                url: dl_url.to_string(),
                headers: vec![
                    (USER_AGENT.to_string(), HOSTER_UA.to_string()),
                    (REFERER.to_string(), url.to_string()),
                ],
            });
        }
    }

    let any_dl =
        Regex::new(r#"(https?://download\d*\.megaup\.net/[^'"\s]+)""#).unwrap();
    if let Some(cap) = any_dl.captures(&html) {
        return Ok(ResolvedTarget {
            url: cap.get(1).unwrap().as_str().to_string(),
            headers: vec![
                (USER_AGENT.to_string(), HOSTER_UA.to_string()),
                (REFERER.to_string(), url.to_string()),
            ],
        });
    }

    tokio::time::sleep(Duration::from_secs(5)).await;
    Err("MegaUp: Direct link not ready or captcha required".to_string())
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
//
// VikingFile free downloads sit behind a Cloudflare Turnstile captcha: the
// landing page (`vikingfile.com/f/<hash>`) only reveals the direct CDN link
// after a `cf-turnstile-response` POST that a headless HTTP client can't
// produce, and the public `/api` endpoints are upload / file-management only
// (there is no captcha-free download API). We surface a clear, actionable
// error instead of depending on an external "unlock" service, so the user
// can fall back to the browser (the download modal's "Open page" action).
async fn vikingfile_get_download_url(uri: &str) -> Result<String, String> {
    Err(format!(
        "VikingFile requires solving a captcha in your browser. \
         Open the page in your browser to download it: {uri}"
    ))
}

// ── Buzzheavier ───────────────────────────────────────────────────────────────
// Buzzheavier (an htmx-driven hoster, a common AnkerGames mirror) hotlink-
// protects everything: a plain GET returns 403. Flow verified live (2026-08):
//   1. GET the landing page with htmx headers (HX-Request, HX-Current-URL)
//      → the HTML embeds a signed token: `hx-get="/<id>/download?t=..."` on
//      the `.download-btn` element.
//   2. GET that path with the same htmx headers and redirects DISABLED
//      → `204` + `Hx-Redirect: https://ts.buzzheavier.com/d/<id>?v=<signed>`
//      (htmx convention; some versions use a `Location` header instead).
//   3. The CDN hop (ts.buzzheavier.com) is Cloudflare-fronted and requires a
//      Chrome UA + Sec-CH-UA client hints — plain/Firefox clients are
//      challenged. We return those headers for the download stream.

/// Chrome UA for the buzzheavier CDN hop (Cloudflare challenges the app's
/// default Firefox UA with a managed challenge).
const BUZZHEAVIER_CDN_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) \
    AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36";

fn buzzheavier_download_btn_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"class="download-btn[^"]*"[^>]*hx-get="([^"]+)""#).unwrap())
}

fn buzzheavier_any_download_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"hx-get="([^"]*download[^"]*)""#).unwrap())
}

async fn buzzheavier_get_download_url(url: &str) -> Result<ResolvedTarget, String> {
    let client = http_client();
    let parsed = url::Url::parse(url).map_err(|e| e.to_string())?;
    let origin = format!(
        "{}://{}",
        parsed.scheme(),
        parsed.host_str().unwrap_or("buzzheavier.com")
    );

    // 1. Landing page — the signed token is generated per page load.
    let page = client
        .get(url)
        .header(USER_AGENT, HOSTER_UA)
        .header(ACCEPT, "text/html")
        .header(REFERER, &origin)
        .header("HX-Current-URL", url)
        .header("HX-Request", "true")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let html = page.text().await.map_err(|e| e.to_string())?;

    let hx_get = buzzheavier_download_btn_re()
        .captures(&html)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
        .or_else(|| {
            buzzheavier_any_download_re()
                .captures(&html)
                .and_then(|c| c.get(1))
                .map(|m| m.as_str().to_string())
        })
        .ok_or("Could not find a download link on the buzzheavier page")?;
    // The HTML may escape the query separator as `&amp;`.
    let hx_get = hx_get.replace("&amp;", "&");
    let dl_url = if hx_get.starts_with("http") {
        hx_get
    } else {
        format!("{}{}", origin, hx_get)
    };

    // 2. Download endpoint with redirects disabled — the CDN link comes
    //    back in the Hx-Redirect header (fallback: Location). Bounded so a
    //    wedged endpoint can't stall the download slot (the C1 worker lock
    //    is held while this resolver runs).
    let no_redirect = reqwest::Client::builder()
        .user_agent(HOSTER_UA)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let dl = no_redirect
        .get(&dl_url)
        .header(USER_AGENT, HOSTER_UA)
        .header(REFERER, url)
        .header("HX-Current-URL", url)
        .header("HX-Request", "true")
        .header("Priority", "u=1, i")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let cdn = dl
        .headers()
        .get("Hx-Redirect")
        .or_else(|| dl.headers().get("Location"))
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .ok_or("Buzzheavier did not return a download link (no Hx-Redirect)")?;
    let cdn = if cdn.starts_with("http") {
        cdn
    } else {
        format!("{}{}", origin, cdn)
    };

    Ok(ResolvedTarget {
        url: cdn,
        // 3. Chrome fingerprint + client hints so the CDN hop passes
        //    Cloudflare's challenge gate.
        headers: vec![
            ("User-Agent".to_string(), BUZZHEAVIER_CDN_UA.to_string()),
            (
                "Sec-CH-UA".to_string(),
                "\"Chromium\";v=\"144\", \"Google Chrome\";v=\"144\", \
                 \"Not.A/Brand\";v=\"24\""
                    .to_string(),
            ),
            ("Sec-CH-UA-Mobile".to_string(), "?0".to_string()),
            ("Sec-CH-UA-Platform".to_string(), "\"Windows\"".to_string()),
            ("Referer".to_string(), format!("{}/", origin)),
        ],
    })
}

// ── Hoster strategy routing ─────────────────────────────────────────────────

/// How the download modal should treat a direct link for a given hoster.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
pub enum HosterStrategy {
    /// `resolve()` can fully handle this hoster headlessly — no browser needed.
    FastPath,
    /// The hoster can only be unlocked in a real browser (gofile, filecrypt).
    WebviewRequired,
    /// `resolve()` may work, but a captcha can force the user into the webview.
    Fallback,
    /// No known hoster — the webview resolver is the universal fallback.
    Unknown,
}

/// Classify a direct-link URI so the frontend can decide whether to surface
/// (and emphasise) the in-app browser resolver.
#[allow(dead_code)]
pub fn hoster_strategy(uri: &str) -> HosterStrategy {
    let parsed = match url::Url::parse(uri) {
        Ok(u) => u,
        Err(_) => return HosterStrategy::Unknown,
    };
    let host = match parsed.host_str() {
        Some(h) => h.to_lowercase(),
        None => return HosterStrategy::Unknown,
    };

    if host.contains("filecrypt.cc") || host.contains("filecrypt.co") {
        return HosterStrategy::WebviewRequired;
    }
    if host.contains("vikingfile") {
        if parsed.path().starts_with("/f/") {
            return HosterStrategy::Fallback;
        }
        return HosterStrategy::Unknown;
    }
    if host.contains("gofile.io")
        || host.contains("gofilecdn")
        || host.contains("datanodes.to")
        || host.contains("1fichier.com")
        || host.contains("krakenfiles.com")
        || host.contains("qiwi.gg")
        || host.contains("megaup.net")
        || host.contains("fuckingfast.co")
        || host.contains("mediafire.com")
        || host.contains("pixeldrain.com")
        || host.contains("rootz.so")
        || host.contains("buzzheavier")
    {
        return HosterStrategy::FastPath;
    }
    HosterStrategy::Unknown
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hoster_strategy_classifies_hosters() {
        assert_eq!(
            hoster_strategy("https://gofile.io/d/abc123"),
            HosterStrategy::FastPath
        );
        assert_eq!(
            hoster_strategy("https://datanodes.to/abc123"),
            HosterStrategy::FastPath
        );
        assert_eq!(
            hoster_strategy("https://1fichier.com/?abc123"),
            HosterStrategy::FastPath
        );
        assert_eq!(
            hoster_strategy("https://filecrypt.cc/Container/abc123"),
            HosterStrategy::WebviewRequired
        );
        assert_eq!(
            hoster_strategy("https://vikingfile.com/f/abc123"),
            HosterStrategy::Fallback
        );
        assert_eq!(
            hoster_strategy("https://www.mediafire.com/file/abc/file.zip"),
            HosterStrategy::FastPath
        );
        assert_eq!(
            hoster_strategy("https://example.com/file.zip"),
            HosterStrategy::Unknown
        );
    }
}

