use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use super::*;
use super::title_match::{MIN_TITLE_SIMILARITY, title_similarity};

// ─── Source: IGDB Twitch API ──────────────────────────────────────────────────


pub(crate) struct TokenCache {
    pub(crate) token: String,
    pub(crate) expires_at: Instant,
}

pub(crate) static TOKEN_CACHE: OnceLock<Mutex<Option<TokenCache>>> = OnceLock::new();

// Cooldown cache for token fetch failures — prevents a single credential
// error from spamming the console on every concurrent IGDB call.
pub(crate) static TOKEN_FAILURE_UNTIL: OnceLock<Mutex<Option<Instant>>> = OnceLock::new();

// ── IGDB Rate Limiter ────────────────────────────────────────────────────────
// IGDB free tier: 4 req/s, max 8 concurrent.
// https://api-docs.igdb.com/#rate-limits

pub(crate) static IGDB_SEM: OnceLock<tokio::sync::Semaphore> = OnceLock::new();
pub(crate) static IGDB_LAST: OnceLock<Mutex<Instant>> = OnceLock::new();

/// Acquire a rate-limit slot for an IGDB API call.
///
/// Two layers of throttling, both required to coexist safely with IGDB's
/// free-tier caps:
///
/// 1. **Local concurrency.** A `Semaphore::new(16)` caps the number of
///    in-flight IGDB POSTs to 16. IGDB's documented cap is 8 concurrent
///    per docs; we permit 16 locally so React StrictMode's dev-mode
///    double-mount burst (5 Discover rails x -  2 mounts = 10 simultaneous
///    `invoke("fetch_store_games", ...)` calls) doesn't deadlock on
///    `sem.acquire().await`. The frontend Promise cache in
///    `SnapRail.tsx` dedups identical in-flight requests so the IGDB
///    layer typically only sees 5 simultaneous calls per session.
///
/// 2. **Global request rate.** A `Mutex<Instant>` (`IGDB_LAST`) enforces
///    a minimum 250 ms gap between IGDB POST *starts*. With concurrent
///    calls, each caller reserves a *future* timestamp
///    `max(now, last_req + 250 ms)` so the cumulative spacing drains
///    smoothly rather than bunching on the next interval. This honors
///    IGDB's 4 req/sec global cap regardless of how many parallel
///    executors are waiting on a permit.
///
/// The `SemaphorePermit<'static>` returned by this function is bound to
/// the `IGDB_SEM` tokio Semaphore inside a `OnceLock`, so the lifetime
/// extends for the process lifetime  -  drop the permit when the HTTP
/// call completes (Rust's RAII does this).
pub(crate) async fn igdb_acquire() -> tokio::sync::SemaphorePermit<'static> {
    let sem = IGDB_SEM.get_or_init(|| tokio::sync::Semaphore::new(16));
    let permit = sem.acquire().await.unwrap();

    let last = IGDB_LAST.get_or_init(|| Mutex::new(Instant::now()));
    // Cumulative scheduling: each caller reserves a future time slot
    // 250 ms after the previous caller. This prevents multiple tasks
    // from seeing the same old timestamp, sleeping together, and then
    // all firing simultaneously — which would trip IGDB's server-side
    // 4 req/s rate limit (HTTP 429).
    let sleep_dur = {
        let mut last_req = last.lock().unwrap();
        let now = Instant::now();
        let next_allowed = *last_req + Duration::from_millis(250);
        let scheduled = if now < next_allowed { next_allowed } else { now };
        *last_req = scheduled; // advance for the NEXT caller
        if scheduled > now { Some(scheduled - now) } else { None }
    }; // MutexGuard dropped before .await

    if let Some(dur) = sleep_dur {
        tokio::time::sleep(dur).await;
    }

    permit
}


// ── Shared HTTP client ──────────────────────────────────────────────────────
// A single reqwest::Client reused across all functions avoids creating
// a fresh connection pool per request, which would exhaust OS sockets
// and TLS session tickets when 100+ concurrent calls are spawned during
// Steam sync / batch metadata imports.
pub(crate) static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

pub(crate) fn http_client() -> reqwest::Client {
    HTTP_CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .user_agent("Mozilla/5.0 (compatible; GameLib/1.0)")
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .expect("Failed to build shared HTTP client")
        })
        .clone() // reqwest::Client wraps an Arc internally
}

pub(crate) async fn get_twitch_token() -> Result<String, String> {
    let client_id = crate::config::get_twitch_client_id();
    if client_id.is_empty() {
        return Err("Missing TWITCH_CLIENT_ID — set it at build time or in your .env file.".to_string());
    }
    let client_secret = crate::config::get_twitch_client_secret();
    if client_secret.is_empty() {
        return Err("Missing TWITCH_CLIENT_SECRET — set it at build time or in your .env file.".to_string());
    }

    let failure_mutex = TOKEN_FAILURE_UNTIL.get_or_init(|| Mutex::new(None));
    let cache_mutex = TOKEN_CACHE.get_or_init(|| Mutex::new(None));

    // ── Check success cache FIRST — a valid token beats cooldown ─────
    {
        let cache = cache_mutex.lock().map_err(|e| e.to_string())?;
        if let Some(ref c) = *cache {
            if Instant::now() < c.expires_at {
                return Ok(c.token.clone());
            }
        }
    }

    // ── Check failure cooldown — only if no valid token is cached ────
    {
        let failure = failure_mutex.lock().map_err(|e| e.to_string())?;
        if let Some(until) = *failure {
            if Instant::now() < until {
                return Err("Twitch token fetch skipped — cooling down after previous failure".to_string());
            }
        }
    }

    let client = http_client();
    let url = format!(
        "https://id.twitch.tv/oauth2/token?client_id={}&client_secret={}&grant_type=client_credentials",
        client_id, client_secret
    );

    #[derive(Deserialize)]
    struct TokenResponse {
        access_token: String,
        expires_in: u64,
    }

    let resp = client.post(&url)
        .header("Content-Length", "0")
        .send()
        .await
        .map_err(|e| {
            if let Ok(mut f) = failure_mutex.lock() {
                *f = Some(Instant::now() + Duration::from_secs(30));
            }
            format!("Failed to send Twitch token request: {}", e)
        })?;

    // ── Check HTTP status before deserializing ───────────────────────
    //     Must capture status BEFORE consuming the body with .text()
    let http_status = resp.status();
    if !http_status.is_success() {
        let err_text = resp.text().await.unwrap_or_default();
        if let Ok(mut f) = failure_mutex.lock() {
            *f = Some(Instant::now() + Duration::from_secs(30));
        }
        return Err(format!(
            "Twitch token request failed with HTTP {}: {}",
            http_status, err_text
        ));
    }

    let data = resp.json::<TokenResponse>()
        .await
        .map_err(|e| {
            if let Ok(mut f) = failure_mutex.lock() {
                *f = Some(Instant::now() + Duration::from_secs(30));
            }
            format!("Failed to parse Twitch token response: {}", e)
        })?;

    let expires_in_secs = if data.expires_in > 60 { data.expires_in - 60 } else { data.expires_in };
    let expires_at = Instant::now() + Duration::from_secs(expires_in_secs);

    let token = data.access_token.clone();
    {
        let mut cache = cache_mutex.lock().map_err(|e| e.to_string())?;
        *cache = Some(TokenCache {
            token: token.clone(),
            expires_at,
        });
    }

    // ── Clear failure cooldown on success ────────────────────────────
    if let Ok(mut f) = failure_mutex.lock() {
        *f = None;
    }

    Ok(token)
}

#[derive(Debug, Deserialize)]
pub(crate) struct IgdbGame {
    pub(crate) id: u64,
    pub(crate) name: String,
    pub(crate) slug: String,
    pub(crate) summary: Option<String>,
    pub(crate) storyline: Option<String>,
    pub(crate) first_release_date: Option<i64>,
    pub(crate) rating: Option<f64>,
    pub(crate) aggregated_rating: Option<f64>,
    pub(crate) cover: Option<IgdbCover>,
    pub(crate) genres: Option<Vec<IgdbName>>,
    pub(crate) themes: Option<Vec<IgdbName>>,
    pub(crate) game_modes: Option<Vec<IgdbName>>,
    pub(crate) player_perspectives: Option<Vec<IgdbName>>,
    pub(crate) involved_companies: Option<Vec<IgdbInvolvedCompany>>,
    pub(crate) screenshots: Option<Vec<IgdbImage>>,
    pub(crate) artworks: Option<Vec<IgdbImage>>,
    pub(crate) videos: Option<Vec<IgdbVideo>>,
    pub(crate) websites: Option<Vec<IgdbWebsite>>,
    pub(crate) similar_games: Option<Vec<IgdbSimilarGameRaw>>,
    pub(crate) release_dates: Option<Vec<IgdbReleaseDateRaw>>,
    pub(crate) game_type: Option<u32>,
    pub(crate) status: Option<u32>,
    /// IGDB collections: each collection has both an ID and a name.
    /// We only use the first one for the GameMetadataResult, but
    /// keeping the full list lets future "in N collections" UI work
    /// without re-querying IGDB.
    pub(crate) collections: Option<Vec<IgdbCollection>>,
    pub(crate) franchises: Option<Vec<IgdbName>>,
    pub(crate) alternative_names: Option<Vec<IgdbName>>,
    pub(crate) language_supports: Option<Vec<IgdbLanguageSupport>>,
    /// IGDB platforms the game shipped on. Used only for VR detection —
    /// the list is not persisted on the game itself.
    pub(crate) platforms: Option<Vec<IgdbName>>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct IgdbSimilarGameRaw {
    pub(crate) id: u64,
    pub(crate) name: String,
    pub(crate) cover: Option<IgdbCover>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct IgdbReleaseDateRaw {
    pub(crate) platform: Option<IgdbPlatformRaw>,
    pub(crate) human: Option<String>,
    pub(crate) region: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct IgdbPlatformRaw {
    pub(crate) name: String,
}


#[derive(Debug, Deserialize)]
pub(crate) struct IgdbCover {
    pub(crate) url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct IgdbName {
    pub(crate) name: String,
}

/// IGDB collection reference with both id and name. Used by the
/// `IgdbGame.collections` field and by the `get_collection_games`
/// command to identify a collection unambiguously. The `id` is
/// what we forward to the frontend; the `name` is what we display.
#[derive(Debug, Deserialize)]
pub(crate) struct IgdbCollection {
    pub(crate) id: u64,
    pub(crate) name: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct IgdbInvolvedCompany {
    pub(crate) company: IgdbName,
    pub(crate) developer: bool,
    pub(crate) publisher: bool,
}

#[derive(Debug, Deserialize)]
pub(crate) struct IgdbImage {
    pub(crate) url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct IgdbVideo {
    pub(crate) video_id: Option<String>,
    #[allow(dead_code)]
    pub(crate) name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct IgdbWebsite {
    pub(crate) url: Option<String>,
    #[allow(dead_code)]
    pub(crate) category: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct IgdbLanguageSupport {
    pub(crate) language: Option<IgdbName>,
    pub(crate) language_support_type: Option<IgdbName>,
}

pub(crate) fn format_unix_timestamp(ts: i64) -> String {
    if ts < 0 {
        return String::new();
    }
    let seconds_in_day = 86400;
    let days = ts / seconds_in_day;
    let rem_seconds = ts % seconds_in_day;
    
    let mut year = 1970;
    let mut day_count = days;
    
    loop {
        let is_leap = (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0);
        let days_in_year = if is_leap { 366 } else { 365 };
        if day_count < days_in_year {
            break;
        }
        day_count -= days_in_year;
        year += 1;
    }
    
    let is_leap = (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0);
    let month_lengths = if is_leap {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };
    
    let mut month = 1;
    for &length in month_lengths.iter() {
        if day_count < length {
            break;
        }
        day_count -= length;
        month += 1;
    }
    
    let day = day_count + 1;
    if rem_seconds > 0 {
        let hours = rem_seconds / 3600;
        let minutes = (rem_seconds % 3600) / 60;
        let seconds = rem_seconds % 60;
        format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", year, month, day, hours, minutes, seconds)
    } else {
        format!("{:04}-{:02}-{:02}", year, month, day)
    }
}

pub(crate) fn map_game_category(game_type: u32) -> String {
    match game_type {
        0 => "Main Game",
        1 => "DLC / Add-on",
        2 => "Expansion",
        3 => "Bundle",
        4 => "Standalone Expansion",
        5 => "Mod",
        6 => "Episode",
        7 => "Season",
        8 => "Remake",
        9 => "Remaster",
        10 => "Expanded Game",
        11 => "Port",
        12 => "Fork",
        13 => "Pack",
        14 => "Playable Prototype",
        _ => "Unknown",
    }.to_string()
}

pub(crate) fn map_release_status(status: u32) -> String {
    match status {
        0 => "Released",
        2 => "Alpha",
        3 => "Beta",
        4 => "Early Access",
        5 => "Offline",
        6 => "Cancelled",
        _ => "Unknown",
    }.to_string()
}

/// Apicalypse `fields` list shared by the name search and the appid-pinned
/// by-id lookup so both paths return identically-shaped results.
pub(crate) const IGDB_GAME_FIELDS: &str = "name, slug, summary, storyline, first_release_date, rating, aggregated_rating, \
       cover.url, screenshots.url, artworks.url, videos.video_id, videos.name, \
       genres.name, themes.name, game_modes.name, player_perspectives.name, platforms.name, \
       involved_companies.developer, involved_companies.publisher, involved_companies.company.name, \
       websites.url, websites.category, \
       similar_games.name, similar_games.cover.url, \
       release_dates.platform.name, release_dates.human, release_dates.region, \
       game_type, status, collections.id, collections.name, franchises.name, alternative_names.name, \
       language_supports.language.name, language_supports.language_support_type.name";

/// Extract a 4-digit year from a game name when present (e.g. "Prototype
/// (2009)" → Some("2009")). Used to prefer the matching release among
/// same-name IGDB results so a local folder like "Prototype (2009)" resolves
/// to the 2009 Prototype instead of an unrelated game that shares the name.
pub(crate) fn extract_year_hint(name: &str) -> Option<String> {
    let re = regex::Regex::new(r"\b(?:19|20)\d{2}\b").ok()?;
    re.find(name).map(|m| m.as_str().to_string())
}

/// Remove a parenthesised year marker ("(2009)") from a cleaned search name
/// so IGDB's relevance ranking isn't skewed by the suffix; the year is kept
/// as a tie-break hint in `igdb_quality_key`.
pub(crate) fn strip_year_marker(name: &str) -> String {
    let Some(re) = regex::Regex::new(r"\(\s*(?:19|20)\d{2}\s*\)").ok() else {
        return name.to_string();
    };
    re.replace_all(name, " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Rank an IGDB result for same-name tie-breaking. Higher tuple = better:
/// (release year matches the query's year hint, released over cancelled /
/// alpha / beta, main game over DLC / bundle / expansion, has cover, has a
/// release date, higher IGDB rating). The similarity score is compared
/// BEFORE this key, so it only decides ties between identically-named
/// entries.
pub(crate) fn igdb_quality_key(year_hint: Option<&str>, r: &GameMetadataResult) -> (bool, bool, bool, bool, bool, f64) {
    let year_match = match (year_hint, r.release_date.as_deref()) {
        (Some(h), Some(d)) => d.starts_with(h),
        _ => false,
    };
    let released = r.release_status.as_deref() == Some("Released");
    let main_game = r.game_category.as_deref() == Some("Main Game");
    let has_cover = r.images.cover.is_some();
    let has_date = r.release_date.is_some();
    let rating = r.igdb_rating.unwrap_or(0.0);
    (year_match, released, main_game, has_cover, has_date, rating)
}

/// POST an Apicalypse body to IGDB `/v4/games` and parse the rows. Handles
/// token acquisition, the shared rate-limit gate, and parse errors by
/// returning an empty vec so callers degrade gracefully.
pub(crate) async fn igdb_query_games(body: &str) -> Vec<IgdbGame> {
    let token = match get_twitch_token().await {
        Ok(t) => t,
        Err(e) => {
            eprintln!("IGDB token error: {}", e);
            return Vec::new();
        }
    };
    let client = http_client();
    let client_id = crate::config::get_twitch_client_id();
    let _guard = igdb_acquire().await;
    let resp = match client
        .post("https://api.igdb.com/v4/games")
        .header("Client-ID", &client_id)
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "text/plain")
        .body(body.to_string())
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            eprintln!("IGDB request error: {}", e);
            return Vec::new();
        }
    };
    let status = resp.status();
    if !status.is_success() {
        let err_text = resp.text().await.unwrap_or_default();
        eprintln!("IGDB request failed with status {}: {}", status, err_text);
        return Vec::new();
    }
    let text = match resp.text().await {
        Ok(t) => t,
        Err(e) => {
            eprintln!("Failed to read IGDB response text: {}", e);
            return Vec::new();
        }
    };
    match serde_json::from_str(&text) {
        Ok(games) => games,
        Err(e) => {
            eprintln!("IGDB parse error: {}, body was: {}", e, text);
            Vec::new()
        }
    }
}

/// Map a single IGDB row into the unified `GameMetadataResult` shape.
/// Shared by the name search and the appid-pinned by-id lookup so both
/// paths produce identical metadata. Time-to-beat is filled in later
/// from HowLongToBeat (see `crate::hltb`).
pub(crate) fn map_igdb_game(game: IgdbGame) -> GameMetadataResult {
    let mut developers = Vec::new();
    let mut publishers = Vec::new();
    if let Some(ref companies) = game.involved_companies {
        for comp in companies {
            if comp.developer {
                developers.push(comp.company.name.clone());
            }
            if comp.publisher {
                publishers.push(comp.company.name.clone());
            }
        }
    }

    let developer = if developers.is_empty() { None } else { Some(developers.join("; ")) };
    let publisher = if publishers.is_empty() { None } else { Some(publishers.join("; ")) };

    let release_date = game.first_release_date.map(format_unix_timestamp);

    let genres = game.genres
        .unwrap_or_default()
        .into_iter()
        .map(|g| g.name)
        .collect::<Vec<_>>();

    let platform_names = game.platforms
        .as_ref()
        .map(|list| list.iter().map(|p| p.name.clone()).collect::<Vec<_>>())
        .unwrap_or_default();
    let is_vr = Some(crate::vr::detect_vr(&game.name, &genres, &platform_names));

    let themes = game.themes
        .map(|list| list.into_iter().map(|item| item.name).collect::<Vec<_>>());

    let game_modes = game.game_modes
        .map(|list| list.into_iter().map(|item| item.name).collect::<Vec<_>>());

    let player_perspectives = game.player_perspectives
        .map(|list| list.into_iter().map(|item| item.name).collect::<Vec<_>>());

    let cover_url = game.cover
        .and_then(|c| c.url)
        .map(|url| {
            let clean = if url.starts_with("//") { format!("https:{}", url) } else { url };
            clean.replace("t_thumb", "t_cover_big")
        });

    let mut screenshot_urls = Vec::new();
    if let Some(screenshots) = game.screenshots {
        for scr in screenshots {
            if let Some(ref url) = scr.url {
                let clean = if url.starts_with("//") { format!("https:{}", url) } else { url.clone() };
                screenshot_urls.push(clean.replace("t_thumb", "t_720p"));
            }
        }
    }

    let mut artwork_urls = Vec::new();
    if let Some(ref artworks) = game.artworks {
        for art in artworks {
            if let Some(ref url) = art.url {
                let clean = if url.starts_with("//") { format!("https:{}", url) } else { url.clone() };
                artwork_urls.push(clean.replace("t_thumb", "t_720p"));
            }
        }
    }

    let hero = artwork_urls.first()
        .or_else(|| screenshot_urls.first())
        .cloned();

    let banner = screenshot_urls.first()
        .or_else(|| artwork_urls.first())
        .cloned();

    let logo_url = game.artworks.as_ref().and_then(|list| {
        list.iter()
            .filter(|a| a.url.as_ref().map(|u| u.contains("/t_logo")).unwrap_or(false))
            .find_map(|a| a.url.as_ref())
            .map(|url| {
                let clean = if url.starts_with("//") {
                    format!("https:{}", url)
                } else {
                    url.clone()
                };
                clean.replace("t_thumb", "t_logo_med")
            })
    }).or_else(|| {
        game.websites.as_ref().and_then(|list| {
            for w in list {
                if let Some(ref url) = w.url {
                    if let Some(pos) = url.find("store.steampowered.com/app/") {
                        let rest = &url[pos + "store.steampowered.com/app/".len()..];
                        let id_str: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
                        if let Ok(id) = id_str.parse::<u32>() {
                            return Some(format!("https://cdn.cloudflare.steamstatic.com/steam/apps/{}/logo.png", id));
                        }
                    }
                }
            }
            None
        })
    });

    let images = GameImages {
        icon: None,
        cover: cover_url,
        hero,
        banner,
        logo: logo_url,
    };

    let videos = game.videos
        .map(|list| {
            list.into_iter()
                .filter_map(|v| v.video_id.map(|id| format!("https://www.youtube.com/watch?v={}", id)))
                .collect::<Vec<_>>()
        });

    let websites = game.websites
        .map(|list| {
            let mut unique_urls = Vec::new();
            let mut seen = std::collections::HashSet::new();
            for w in list {
                if let Some(url) = w.url {
                    if seen.insert(url.clone()) {
                        unique_urls.push(url);
                    }
                }
            }
            unique_urls
        });

    // Time-to-beat is sourced from HowLongToBeat by the caller, not IGDB.
    let time_to_beat = None;

    // Map Similar Games
    let similar_games = game.similar_games.map(|list| {
        list.into_iter()
            .map(|g| {
                let cover_url = g.cover.and_then(|c| c.url).map(|url| {
                    let clean = if url.starts_with("//") { format!("https:{}", url) } else { url };
                    clean.replace("t_thumb", "t_cover_big")
                });
                SimilarGame {
                    id: g.id,
                    name: g.name,
                    cover_url,
                }
            })
            .collect::<Vec<_>>()
    });

    // Map Releases
    let releases = game.release_dates.map(|list| {
        list.into_iter()
            .map(|r| {
                let platform = r.platform.map(|p| p.name).unwrap_or_else(|| "Unknown".to_string());
                let date_str = r.human.unwrap_or_else(|| "Unknown".to_string());
                let region = match r.region {
                    Some(1) => "Europe",
                    Some(2) => "North America",
                    Some(3) => "Australia",
                    Some(4) => "New Zealand",
                    Some(5) => "Japan",
                    Some(6) => "China",
                    Some(7) => "Asia",
                    Some(8) => "Worldwide",
                    Some(9) => "Korea",
                    Some(10) => "Brazil",
                    _ => "Global",
                }.to_string();
                ReleaseDateInfo {
                    platform,
                    date_str,
                    region,
                }
            })
            .collect::<Vec<_>>()
    });

    let igdb_reviews: Option<Vec<IgdbReview>> = None;

    let alternative_names = game.alternative_names.as_ref()
        .map(|list| list.iter().map(|a| a.name.clone()).collect::<Vec<_>>());

    let collection = game.collections.as_ref()
        .and_then(|list| list.first().map(|c| c.name.clone()));

    let collection_id = game.collections.as_ref()
        .and_then(|list| list.first().map(|c| c.id));

    let franchise = game.franchises.as_ref()
        .and_then(|list| {
            if list.is_empty() { None }
            else { Some(list.iter().map(|f| f.name.clone()).collect::<Vec<_>>().join("; ")) }
        });

    let game_category = Some(map_game_category(game.game_type.unwrap_or(0)));
    let release_status = Some(map_release_status(game.status.unwrap_or(0)));

    let language_supports = game.language_supports.as_ref().map(|list| {
        list.iter()
            .filter_map(|ls| {
                let lang = ls.language.as_ref()?.name.clone();
                let support_type = ls.language_support_type.as_ref()?.name.clone();
                Some(LanguageSupportInfo {
                    language: lang,
                    support_type,
                })
            })
            .collect::<Vec<_>>()
    });

    GameMetadataResult {
        title: game.name,
        description: game.summary,
        developer,
        publisher,
        release_date,
        genres,
        images,
        source_url: format!("https://www.igdb.com/games/{}", game.slug),
        source_name: "IGDB".to_string(),
        storyline: game.storyline,
        igdb_rating: game.rating,
        critic_rating: game.aggregated_rating,
        themes,
        game_modes,
        player_perspectives,
        screenshots: if screenshot_urls.is_empty() { None } else { Some(screenshot_urls) },
        videos,
        websites,
        time_to_beat,
        similar_games,
        releases,
        igdb_reviews,
        alternative_names,
        collection,
        collection_id,
        // Stable identity key: the numeric IGDB game id, persisted by
        // the frontend so deleted games stay identifiable.
        igdb_id: Some(game.id),
        franchise,
        game_category,
        release_status,
        language_supports,
        is_vr,
    }
}

/// Fetch a single IGDB game by numeric id (e.g. resolved from a Steam appid
/// via `resolve_steam_to_igdb`). Returns None when the id doesn't exist.
/// Exposed as the `get_igdb_game_by_id` Tauri command so the frontend can
/// re-fetch metadata/images for games that carry a persisted `igdbId`
/// but no artwork.
pub async fn fetch_igdb_game_by_id(id: u64) -> Option<GameMetadataResult> {
    let body = format!("fields {}; where id = {}; limit 1;", IGDB_GAME_FIELDS, id);
    let mut games = igdb_query_games(&body).await;
    let game = games.pop()?;
    let mut result = map_igdb_game(game);
    // IGDB no longer provides time-to-beat data; HowLongToBeat does.
    if let Some(ttb) = crate::hltb::fetch_time_to_beat(&result.title, None).await {
        result.time_to_beat = Some(ttb);
    }
    Some(result)
}

/// Resolve a Steam appid to its exact IGDB game via IGDB's `external_games`
/// bridge (category 1 = Steam) and return the mapped metadata. This is the
/// authoritative, collision-free path for Steam-synced titles — the appid is
/// an exact key, so a name that happens to be shared by several games (e.g.
/// "Prototype" 2009 vs another same-named title) can never pick the wrong
/// entry.
pub(crate) async fn fetch_igdb_game_by_steam_appid(appid: u32) -> Option<GameMetadataResult> {
    let map = resolve_steam_to_igdb(&[appid]).await.ok()?;
    let igdb_id = *map.get(&appid)?;
    fetch_igdb_game_by_id(igdb_id).await
}

pub async fn search_igdb(game_name: &str) -> Vec<GameMetadataResult> {
    let cleaned_query = clean_game_name_for_search(game_name);
    let year_hint = extract_year_hint(game_name);
    // Search with any parenthesised year stripped ("Prototype (2009)" →
    // "Prototype") so IGDB's relevance ranking isn't skewed by the suffix;
    // the year is reapplied as a tie-break in `igdb_quality_key`.
    let stripped_query = strip_year_marker(&cleaned_query);
    let search_term = if stripped_query.is_empty() { cleaned_query.as_str() } else { stripped_query.as_str() };

    let escaped_name = search_term.replace('"', "\\\"");
    let body = format!(
        r#"search "{}"; fields {}; limit 8;"#,
        escaped_name, IGDB_GAME_FIELDS
    );

    let igdb_games = igdb_query_games(&body).await;

    let mut results: Vec<GameMetadataResult> = igdb_games
        .into_iter()
        .map(map_igdb_game)
        .collect();

    // Rank by title similarity first; ties (same-name games like "Prototype"
    // 2009 vs an unrelated same-named title) are broken by release-year
    // match + entry quality so the canonical release wins instead of
    // whichever IGDB happened to return first.
    results.sort_by(|a, b| {
        let sa = title_similarity(game_name, &a.title)
            .max(title_similarity(&cleaned_query, &a.title))
            .max(title_similarity(&stripped_query, &a.title));
        let sb = title_similarity(game_name, &b.title)
            .max(title_similarity(&cleaned_query, &b.title))
            .max(title_similarity(&stripped_query, &b.title));
        let ka = (sa, igdb_quality_key(year_hint.as_deref(), a));
        let kb = (sb, igdb_quality_key(year_hint.as_deref(), b));
        kb.partial_cmp(&ka).unwrap_or(std::cmp::Ordering::Equal)
    });

    results.retain(|r| {
        title_similarity(game_name, &r.title) >= MIN_TITLE_SIMILARITY
            || title_similarity(&cleaned_query, &r.title) >= MIN_TITLE_SIMILARITY
            || title_similarity(&stripped_query, &r.title) >= MIN_TITLE_SIMILARITY
    });

    // Drop exact same-title duplicates (the same IGDB entry fetched twice,
    // or a port/remaster that shares the exact display name) — keep the
    // top-ranked one.
    let mut seen = std::collections::HashSet::new();
    results.retain(|r| seen.insert(r.title.to_lowercase()));

    results
}

// ─── Store: Browse & Search IGDB Catalog ──────────────────────────────────────
// (post-fix) IGDB results are similarity-sorted above.

/// Fetch a page of store games by category from IGDB.
///
/// Categories:
/// - "trending"  → sorted by hypes descending (recent buzz)
/// - "popular"   → sorted by total_rating_count descending (most rated)
/// - "top"       → sorted by rating descending (highest rated)
/// - "all"        → sorted by total_rating_count (browse everything)
// ─── IGDB facet → where-clause mapping ─────────────────────────────────
//
// Genres are filtered by name: the frontend sends `StoreFilterSidebar.GENRES`
// strings and we resolve them to stable IGDB IDs here. Platforms are filtered
// by ID: the frontend fetches the live `/platforms` list (see
// `fetch_igdb_platforms`) and sends the ids back directly, so there's no
// static platform table to keep in sync. Unknown names silently drop out —
// that way a typo'd facet on the frontend doesn't crash the catalog browse.

/// IGDB genre IDs (https://api.igdb.com/v4/genres). Names match
/// the frontend filter sidebar verbatim. Ids are the live `/genres`
/// endpoint values — the sequence is NOT contiguous (e.g. Fighting is 4,
/// Tactical is 24, and ids 1/3/6/17–23/27–29 don't exist), so entries
/// must mirror what the endpoint actually returns or the IGDB `where`
/// clause matches zero games.
pub(crate) fn genre_name_to_id(name: &str) -> Option<u32> {
    Some(match name {
        "Point-and-click" => 2,
        "Fighting" => 4,
        "Shooter" => 5,
        "Music" => 7,
        "Platform" => 8,
        "Puzzle" => 9,
        "Racing" => 10,
        "Real Time Strategy (RTS)" => 11,
        "Role-playing (RPG)" => 12,
        "Simulator" => 13,
        "Sport" => 14,
        "Strategy" => 15,
        "Turn-based strategy (TBS)" => 16,
        "Tactical" => 24,
        "Hack and slash/Beat 'em up" => 25,
        "Quiz/Trivia" => 26,
        "Pinball" => 30,
        "Adventure" => 31,
        "Indie" => 32,
        "Arcade" => 33,
        "Visual Novel" => 34,
        "Card & Board Game" => 35,
        "MOBA" => 36,
        _ => return None,
    })
}

/// A single IGDB platform (id + name) for the Store filter sidebar.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IgdbPlatformInfo {
    pub id: u32,
    pub name: String,
}

/// Internal deserialization type for the IGDB `/platforms` endpoint.
#[derive(Debug, Deserialize)]
pub(crate) struct IgdbPlatform {
    pub(crate) id: u64,
    pub(crate) name: String,
}

/// Fetch the full IGDB platform list (`/platforms` endpoint) so the
/// Store filter sidebar always reflects every platform IGDB knows
/// about — no hardcoded mirror that can drift out of date. Sorted by
/// name. The returned ids are what the frontend sends back to
/// `fetch_store_games` / `search_store_games` for platform filtering.
pub async fn fetch_igdb_platforms() -> Result<Vec<IgdbPlatformInfo>, String> {
    let token = get_twitch_token().await?;
    let client = http_client();
    let client_id = crate::config::get_twitch_client_id();

    let _guard = igdb_acquire().await;
    let resp = client
        .post("https://api.igdb.com/v4/platforms")
        .header("Client-ID", &client_id)
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "text/plain")
        .body("fields name; sort name asc; limit 500;")
        .send()
        .await
        .map_err(|e| format!("IGDB platforms request failed: {}", e))?;

    let status = resp.status();
    if !status.is_success() {
        let err_text = resp.text().await.unwrap_or_default();
        return Err(format!(
            "IGDB platforms request failed with status {}: {}",
            status, err_text
        ));
    }

    let text = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read IGDB platforms response: {}", e))?;

    let rows: Vec<IgdbPlatform> =
        serde_json::from_str(&text).map_err(|e| format!("IGDB platforms parse error: {}", e))?;

    Ok(rows
        .into_iter()
        .map(|p| IgdbPlatformInfo {
            id: p.id as u32,
            name: p.name,
        })
        .collect())
}

/// Map a `(year_min, year_max)` pair to IGDB `first_release_date`
/// Unix timestamp bounds. Returns `(None, None)` when both inputs
/// are null; otherwise missing bounds stay open (∞ in that direction).

pub(crate) fn normalize_igdb_cover_url(url: String) -> String {
    let clean = if url.starts_with("//") {
        format!("https:{}", url)
    } else {
        url
    };
    clean.replace("t_thumb", "t_cover_big")
}

pub(crate) async fn igdb_games_post(token: &str, body: &str) -> Result<String, String> {
    let client = http_client();
    let client_id = crate::config::get_twitch_client_id();

    let _guard = igdb_acquire().await;
    let resp = client
        .post("https://api.igdb.com/v4/games")
        .header("Client-ID", &client_id)
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "text/plain")
        .body(body.to_string())
        .send()
        .await
        .map_err(|e| format!("IGDB relations request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let err_text = resp.text().await.unwrap_or_default();
        return Err(format!(
            "IGDB relations failed with status {}: {}",
            status, err_text
        ));
    }

    resp.text()
        .await
        .map_err(|e| format!("Failed to read IGDB response: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Full IGDB round-trip: OAuth token + Apicalypse search.
    ///
    /// Ignored: it needs `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` and
    /// outbound network. A CI runner has neither — `get_twitch_token` bails
    /// out on the missing credentials and the search degrades to an empty
    /// vec — so this only ever passes on a machine with a populated `.env`.
    /// Run it with `cargo test -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn test_search_igdb() {
        // The app loads .env at startup; tests don't get that path, so
        // load the credentials here (no-op when .env is absent).
        crate::config::load_env_file();
        let results = search_igdb("Portal 2").await;
        println!("IGDB results count: {}", results.len());
        assert!(!results.is_empty());
    }

    #[test]
    fn igdb_cover_url_normalizes_protocol_and_size() {
        assert_eq!(
            normalize_igdb_cover_url("//images.igdb.com/igdb/image/upload/t_thumb/x.jpg".into()),
            "https://images.igdb.com/igdb/image/upload/t_cover_big/x.jpg"
        );
        assert_eq!(
            normalize_igdb_cover_url("https://x/t_thumb/y.jpg".into()),
            "https://x/t_cover_big/y.jpg"
        );
    }
}
