//! Multi-source review fetching (Steam, IGDB, Metacritic, OpenCritic, RAWG).

use serde::{Deserialize, Serialize};

use super::*;
use self::igdb::fetch_igdb_reviews;
use self::metacritic::fetch_metacritic_reviews;
use self::opencritic::fetch_opencritic_reviews;
use self::rawg::fetch_rawg_reviews;
use self::steam::fetch_steam_reviews;
use super::text_util::url_encode;

mod igdb;
mod metacritic;
mod opencritic;
mod rawg;
mod steam;

pub use self::metacritic::*;
pub use self::steam::*;

// ─── Reviews Fetcher (multi-source with fallback) ─────────────────────────────

/// Result of a reviews fetch attempt. `source` is "steam" | "igdb" | "none".
/// The frontend uses `source` to label the reviews correctly in the UI.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReviewFetchResult {
    pub reviews: Vec<IgdbReview>,
    pub source: String,
    pub error: Option<String>,
    /// Total number of reviews returned by Steam (query_summary.total_reviews).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_reviews: Option<u64>,
    /// Cursor for fetching the next page of reviews (Steam cursor-based pagination).
    /// None when there are no more pages.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub steam_review_score: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub steam_review_score_desc: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub steam_total_positive: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub steam_total_negative: Option<u64>,
}

/// Fetch reviews for a game from the best available source.
///
/// If `cursor` is provided (non-empty), fetches the next page from Steam.
/// Otherwise starts from the beginning.
#[allow(clippy::too_many_arguments)]
pub async fn fetch_game_reviews(
    game_name: &str,
    steam_app_id: Option<u64>,
    cursor: Option<String>,
    language: Option<String>,
    filter_type: Option<String>,
    purchase_type: Option<String>,
    playtime_min_hours: Option<u32>,
    playtime_max_hours: Option<u32>,
    review_type: Option<String>,
    playtime_device: Option<String>,
    use_helpful_system: Option<bool>,
) -> ReviewFetchResult {
    // ── 1. Steam ──────────────────────────────────────────────────────────
    let app_id_to_try: Option<u64> = match steam_app_id {
        Some(id) => Some(id),
        None => lookup_steam_app_id(game_name).await,
    };

    if let Some(app_id) = app_id_to_try {
        let opts = SteamReviewQuery {
            cursor: cursor.unwrap_or_default(),
            language,
            filter_type,
            review_type,
            purchase_type,
            playtime_min_hours,
            playtime_max_hours,
            playtime_device,
            use_helpful_system: use_helpful_system.unwrap_or(false),
        };
        match fetch_steam_reviews(app_id, &opts).await
        {
            Ok((reviews, total, next_cursor, summary)) if !reviews.is_empty() => {
                return ReviewFetchResult {
                    reviews,
                    source: "steam".to_string(),
                    error: None,
                    total_reviews: Some(total),
                    cursor: next_cursor,
                    steam_review_score: summary.as_ref().map(|s| s.review_score),
                    steam_review_score_desc: summary.as_ref().and_then(|s| s.review_score_desc.clone()),
                    steam_total_positive: summary.as_ref().map(|s| s.total_positive),
                    steam_total_negative: summary.as_ref().map(|s| s.total_negative),
                };
            }
            Ok(_) => {
                // Steam returned 0 reviews — try IGDB before giving up.
            }
            Err(e) => {
                eprintln!("Steam reviews fetch failed for app {}: {}", app_id, e);
            }
        }
    }

    // ── 2. IGDB (best-effort) ─────────────────────────────────────────────
    match fetch_igdb_reviews(game_name).await {
        Ok(reviews) if !reviews.is_empty() => {
            return ReviewFetchResult {
                reviews,
                source: "igdb".to_string(),
                error: None,
                total_reviews: None,
                cursor: None,
                steam_review_score: None,
                steam_review_score_desc: None,
                steam_total_positive: None,
                steam_total_negative: None,
            };
        }
        Ok(_) => {}
        Err(e) => {
            // The endpoint is known to be dead upstream; treat as expected.
            eprintln!("IGDB reviews fetch failed: {}", e);
        }
    }

    ReviewFetchResult {
        reviews: Vec::new(),
        source: "none".to_string(),
        error: Some("No reviews available from any source".to_string()),
        total_reviews: None,
        cursor: None,
        steam_review_score: None,
        steam_review_score_desc: None,
        steam_total_positive: None,
        steam_total_negative: None,
    }
}

/// Look up a Steam app id for a given game name. Returns `None` if no
/// confident match is found. We require a token-based name match: every
/// whitespace-separated word in the query must appear in the result name.
/// This prevents fetching reviews for the wrong game when queries are
/// ambiguous (e.g. "The Witcher" should not silently return reviews for
/// "The Witcher 3" when the user actually has "The Witcher 2").

/// Pre-formatted suffix (with leading separator) that callers append to
/// user-visible errors whenever the OpenCritic HTML-scraping path fails
/// for reasons a RapidAPI key would work around (Cloudflare 403/429/503,
/// missing page, etc.). Always concatenate, never format-interpolate
/// alone. Keep in sync with the docs in `.env` setup.
// ─── External Reviews: Metacritic, OpenCritic, RAWG ─────────────────────────

const OPENCRITIC_RAPIDAPI_HINT_SUFFIX: &str =
    " - hint: set OPENCRITIC_RAPIDAPI_KEY at build time or in .env for reliable results";

/// Fetch reviews from an external source (metacritic, opencritic, or rawg).
///
/// Uses direct-slug-first URL resolution with DuckDuckGo HTML search fallback
/// when the direct guess returns 404.
pub async fn fetch_external_reviews(
    game_name: &str,
    source: &str,
) -> Result<Vec<IgdbReview>, String> {
    match source {
        "metacritic" => fetch_metacritic_reviews(game_name).await,
        "opencritic" => fetch_opencritic_reviews(game_name).await,
        "rawg" => fetch_rawg_reviews(game_name).await,
        _ => Err(format!("Unknown review source: {}", source)),
    }
}

/// Convert a game name into a URL-friendly slug.
fn slugify_rust(name: &str) -> String {
    name.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

/// Parse a date string like "Jun 20, 2026" to a Unix timestamp (seconds).
fn parse_date_to_timestamp(date_str: &str) -> Option<u64> {
    let trimmed = date_str.trim();
    let months: &[(&str, u32)] = &[
        ("jan", 1), ("feb", 2), ("mar", 3), ("apr", 4),
        ("may", 5), ("jun", 6), ("jul", 7), ("aug", 8),
        ("sep", 9), ("oct", 10), ("nov", 11), ("dec", 12),
    ];

    // Try "Mon DD, YYYY" format
    let parts: Vec<&str> = trimmed.split_whitespace().collect();
    if parts.len() >= 3 {
        let month_str = parts[0].to_lowercase();
        let day_str = parts[1].trim_end_matches(',');
        let year_str = parts[2];

        if let (Ok(day), Ok(year)) = (day_str.parse::<u32>(), year_str.parse::<i32>()) {
            for (name, num) in months {
                if month_str.starts_with(name) {
                    use chrono::{NaiveDate, TimeZone, Utc};
                    if let Some(date) = NaiveDate::from_ymd_opt(year, *num, day) {
                        if let Some(dt) = date.and_hms_opt(0, 0, 0) {
                            return Some(Utc.from_utc_datetime(&dt).timestamp() as u64);
                        }
                    }
                    return None;
                }
            }
        }
    }

    // Try "DD Mon YYYY" format (European)
    if parts.len() >= 3 {
        let day_str = parts[0].trim_end_matches(',');
        let month_str = parts[1].to_lowercase();
        let year_str = parts[2];

        if let (Ok(day), Ok(year)) = (day_str.parse::<u32>(), year_str.parse::<i32>()) {
            for (name, num) in months {
                if month_str.starts_with(name) {
                    use chrono::{NaiveDate, TimeZone, Utc};
                    if let Some(date) = NaiveDate::from_ymd_opt(year, *num, day) {
                        if let Some(dt) = date.and_hms_opt(0, 0, 0) {
                            return Some(Utc.from_utc_datetime(&dt).timestamp() as u64);
                        }
                    }
                    return None;
                }
            }
        }
    }

    None
}

/// Build a shared reqwest client for external review scraping.
/// Build a shared reqwest client for external review scraping.
///
/// Includes browser-like `Accept` and `Accept-Language` headers so we
/// don't get rejected by Cloudflare bot challenges on sites like OpenCritic.
fn external_reviews_client() -> Option<reqwest::Client> {
    use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, ACCEPT_LANGUAGE};
    let mut headers = HeaderMap::new();
    headers.insert(
        ACCEPT,
        HeaderValue::from_static(
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        ),
    );
    headers.insert(ACCEPT_LANGUAGE, HeaderValue::from_static("en-US,en;q=0.5"));

    reqwest::Client::builder()
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        )
        .default_headers(headers)
        .timeout(std::time::Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .ok()
}

/// Resolve a game page URL on a given site by trying the direct slug first,
/// then falling back to a DuckDuckGo HTML search.
async fn resolve_game_url(
    client: &reqwest::Client,
    direct_url: &str,
    site_domain: &str,
    game_name: &str,
) -> Result<String, String> {
    // Step 1: Try direct slug URL
    let resp = client.get(direct_url).send().await.map_err(|e| e.to_string())?;
    if resp.status().is_success() {
        return Ok(direct_url.to_string());
    }

    // Step 2: Fall back to DuckDuckGo HTML search
    let query = format!("site:{} {}", site_domain, game_name);
    let ddg_url = format!(
        "https://html.duckduckgo.com/html/?q={}",
        url_encode(&query)
    );

    let ddg_resp = client
        .get(&ddg_url)
        .send()
        .await
        .map_err(|e| format!("DDG search failed: {}", e))?;

    if !ddg_resp.status().is_success() {
        return Err(format!("DDG search returned {}", ddg_resp.status()));
    }

    let html = ddg_resp
        .text()
        .await
        .map_err(|e| format!("Failed to read DDG response: {}", e))?;

    let doc = scraper::Html::parse_document(&html);

    // Extract the first result link (`.result__a` or `.result__url`)
    let link_sel = scraper::Selector::parse("a.result__a")
        .map_err(|e| e.to_string())?;

    for link in doc.select(&link_sel) {
        if let Some(href) = link.value().attr("href") {
            // DDG result links are wrapped — extract the actual URL
            let decoded = href
                .split("uddg=")
                .nth(1)
                .and_then(|s| s.split('&').next())
                .and_then(|s| {
                    urlencoding::decode(s).ok().map(|d| d.into_owned())
                })
                .unwrap_or_else(|| href.to_string());

            if decoded.contains(site_domain) {
                return Ok(decoded);
            }
        }
    }

    Err(format!(
        "Could not find {} page for '{}'",
        site_domain, game_name
    ))
}
