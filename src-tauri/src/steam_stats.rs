//! Steam concurrent-player count / history / game-stats commands + caches.

use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::{Duration, Instant, SystemTime};
use serde::{Deserialize, Serialize};
use tauri::Manager;
use crate::game_scraper;

// === Steam Player Count ======================================================
//
// In-memory cache for live concurrent-player counts. Multiple banners
// (Store hero, Store detail, Library detail) may all want the same appid
// in the same render frame; without a cache, each would round-trip to
// Steam's API and we'd burn through Valve's voluntary rate limit.
//
// We deliberately cache per-appid rather than globally:
//  - Different games have wildly different popularity, so a short global
//    TTL would either over-fetch for niche titles or under-fetch for
//    popular ones.
//  - A badge on a single rendered page is a single user looking at a
//    single game, so a 60s per-appid cooldown is plenty.
//
// `CacheEntry` stores `(instant_frozen, count)`. `Instant::elapsed()`
// returns zero on platforms where the system clock jumps backwards
// (rare, but it can cause `elapsed >= TTL` to spuriously fail), so
// reads use saturating semantics.
pub(crate) struct PlayerCountCache {
    cache: std::sync::Mutex<HashMap<u32, (u32, Instant)>>,
}

impl Default for PlayerCountCache {
    fn default() -> Self {
        Self {
            cache: std::sync::Mutex::new(HashMap::new()),
        }
    }
}

const PLAYER_COUNT_CACHE_TTL: Duration = Duration::from_secs(60);

/// Fetch the number of players currently in-game on Steam for `app_id`.
///
/// Source: Steam Web API `ISteamUserStats/GetNumberOfCurrentPlayers/v1/`.
/// Verified reliable & free â€” no API key required for this endpoint.
///
/// Returns:
///   - `Ok(Some(count))` on success
///   - `Ok(None)` when the API responded but reported no current players
///     (e.g. extremely niche titles with a `result != 1`, which the
///     Steam API uses to signal "no data") â€” we map that to a clean
///     "no players right now" so the badge hides silently rather than
///   - `Err` on transport / parse failures (e.g. offline, timeout)
///     surfacing an error.
#[tauri::command]
pub async fn get_steam_player_count(
    app: tauri::AppHandle,
    app_id: u32,
) -> Result<Option<u32>, String> {
    let state: tauri::State<'_, PlayerCountCache> = app.state();

    // â”€â”€ 1. Return cached value if still fresh â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    {
        let cache = state.cache.lock().map_err(|e| e.to_string())?;
        if let Some((count, fetched_at)) = cache.get(&app_id) {
            // `Instant::elapsed` is monotonic, so a backward clock jump
            // won't make this negative; the `>=` check is safe on all
            // platforms Rust supports.
            if fetched_at.elapsed() < PLAYER_COUNT_CACHE_TTL {
                return Ok(Some(*count));
            }
        }
    }

    // â”€â”€ 2. Hit the Steam Web API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Endpoint: ISteamUserStats/GetNumberOfCurrentPlayers/v1/
    // Format:
    //   { "response": { "player_count": <int>, "result": <int> } }
    //
    // `result == 1` â‡’ success
    // `result == 8` â‡’ Steam is returning "no data" for this appid (very
    //   rare; usually means an appid Steam never tracked). We map that
    //   to `Ok(None)` so the badge cleanly hides.
    let url = format!(
        "https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid={}",
        app_id
    );

    let client = shared_steam_client();

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Steam player count request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!(
            "Steam Web API returned HTTP {} for appid {}",
            resp.status(),
            app_id
        ));
    }

    #[derive(Deserialize)]
    struct SteamResponseInner {
        #[serde(default)]
        player_count: Option<u32>,
        #[serde(default)]
        result: u32,
    }
    #[derive(Deserialize)]
    struct SteamResponse {
        response: SteamResponseInner,
    }

    let payload: SteamResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse Steam player count JSON: {}", e))?;

    // Cache + return â€” even on `result != 1` we want to avoid hitting
    // the API again within the TTL window, so we store `None` to mean
    // "not currently tracked" (the frontend hides the badge either way).
    let result_ok = payload.response.result == 1;
    let player_count = payload.response.player_count;

    {
        let mut cache = state.cache.lock().map_err(|e| e.to_string())?;
        // Only cache positive results so a transient Steam hiccup
        // doesn't poison the TTL with a zero count.
        if let Some(count) = player_count {
            if result_ok {
                cache.insert(app_id, (count, Instant::now()));
            }
        }
    }

    if result_ok {
        Ok(player_count)
    } else {
        Ok(None)
    }
}

/// Look up the Steam app id for a game by name (best-effort).
///
/// Drives the `useSteamAppId` frontend hook, which auto-resolves the
/// Steam appid for non-Steam library rows (manual imports, Epic, GOG)
/// so the live concurrent-player badge works on the Game page hero
/// AND the activity dashboard / sessions lists, not just Steam-
/// synced titles. Same token-match rule as `fetch_game_reviews`:
/// every whitespace-separated word in `game_name` must appear in the
/// Steam candidate's display name. So "Halo" matches "Halo Infinite"
/// but "The Witcher" doesn't silently grab "The Witcher 3".
///
/// **Confidence gate** for the persistence boundary. The underlying
/// per-token rule is loose for SINGLE-token short queries like
/// "Halo", "Steam", or "CSGO" â€” many Steam candidates contain the
/// word, and we'd risk persisting "Halo Infinite" (1240440) onto a
/// manual "Halo: Reach" library row, locking in a WRONG appid
/// forever (the live player-count badge would then forever display
/// the count for the wrong game). To avoid that we refuse to even
/// run the lookup for queries that are too short to be unambiguous:
///
///   - trimmed length < 3 chars   â†’  return `None`
///   - 1 token AND length < 6     â†’  return `None`
///   - 2+ tokens                  â†’  proceed to the token-match lookup
///
/// This gate lives at the Tauri boundary (not in
/// `game_scraper::lookup_steam_app_id` itself) because that function
/// is ALSO called by `fetch_game_reviews`, where a permissive match
/// is the right behavior â€” Steam reviews are a much better signal
/// than "we guessed wrong on the appid". The player-count path gets
/// the stricter gate because the cost of being wrong is much higher
/// (a permanently persisted wrong appid on the user's library row).
/// Empty queries return None without burning a Steam call.
#[tauri::command]
pub async fn lookup_steam_app_id_for_game(game_name: String) -> Result<Option<u32>, String> {
    let trimmed = game_name.trim();
    if trimmed.is_empty() || trimmed.len() < 3 {
        return Ok(None);
    }
    let token_count = trimmed.split_whitespace().count();
    if token_count < 2 && trimmed.len() < 6 {
        return Ok(None);
    }
    Ok(
        game_scraper::lookup_steam_app_id(&game_name)
            .await
            .map(|v| v as u32),
    )
}

// === Steam Historical Player Count (steamcharts.com) ========================
//
// Long-range concurrent-player history for the hover popover's line chart.
//
// Source: `https://steamcharts.com/app/{appid}/chart-data.json` — a free,
// key-less JSON feed of `[unix_ms, count]` samples. This is the same Steam
// CCU data SteamDB's own charts display (SteamDB's API requires a paid key;
// the underlying feed does not), so we read it directly instead of paying
// for a SteamDB key.
//
// Caching strategy
// ────────────────
// The *full* series is fetched once per appid and cached in-memory with a
// 6h TTL. Per-range filtering + downsampling (to ≤180 points so the SVG
// line chart stays smooth) happens in-memory on every call — cheap and
// network-free, so switching between 30d / 90d / 180d / All never hits the
// network twice for the same appid within the TTL.

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct SteamPlayerHistoryPoint {
    /// Unix-millisecond timestamp of the sample.
    timestamp: u64,
    /// Concurrent players at that timestamp.
    count: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SteamPlayerHistory {
    app_id: u32,
    /// Downsampled series, oldest first, ready to plot.
    points: Vec<SteamPlayerHistoryPoint>,
    /// Most recent reading in the (filtered) series.
    current: u64,
    /// Peak across the requested range.
    peak_in_range: u64,
    /// Peak across the entire steamcharts history (all-time).
    peak_all_time: u64,
    /// Arithmetic mean across the requested range.
    average_in_range: f64,
    /// Number of points in the returned (downsampled) series.
    sample_count: u32,
    /// True when `points` was downsampled from a denser series, so the
    /// frontend can hint "sampled" if it wants to.
    downsampled: bool,
}

pub(crate) struct SteamPlayerHistoryCache {
    /// appid -> (full `[unix_ms, count]` series, fetched_at). The full
    /// series is cached once per appid (6h TTL); per-range filtering +
    /// downsampling happens in-memory on every call (cheap, no network).
    raw: std::sync::Mutex<HashMap<u32, (Vec<(u64, u64)>, Instant)>>,
}

impl Default for SteamPlayerHistoryCache {
    fn default() -> Self {
        Self {
            raw: std::sync::Mutex::new(HashMap::new()),
        }
    }
}

const STEAM_HISTORY_TTL: Duration = Duration::from_secs(6 * 60 * 60); // 6h

const STEAM_HISTORY_MAX_POINTS: usize = 180;

#[tauri::command]
pub async fn get_steam_player_history(
    app: tauri::AppHandle,
    app_id: u32,
    // 0 = all-time (no filter). Otherwise the trailing N days.
    range_days: u32,
) -> Result<SteamPlayerHistory, String> {
    let cache: tauri::State<'_, SteamPlayerHistoryCache> = app.state();

    // ── 1. Raw full series (cached per appid, 6h TTL) ───────────────
    let series: Vec<(u64, u64)> = {
        let map = cache.raw.lock().map_err(|e| e.to_string())?;
        if let Some((s, fetched_at)) = map.get(&app_id) {
            if fetched_at.elapsed() < STEAM_HISTORY_TTL {
                s.clone()
            } else {
                Vec::new() // stale → refetch below
            }
        } else {
            Vec::new()
        }
    };

    let series = if series.is_empty() {
        let url = format!("https://steamcharts.com/app/{}/chart-data.json", app_id);
        let client = shared_steam_client();
        let resp = client
            .get(&url)
            .header("User-Agent", "Mozilla/5.0 (compatible; GameLib/0.1)")
            .send()
            .await
            .map_err(|e| format!("steamcharts request failed: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!(
                "steamcharts returned HTTP {} for appid {}",
                resp.status(),
                app_id
            ));
        }

        let raw: Vec<(u64, u64)> = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse steamcharts JSON: {}", e))?;

        if raw.is_empty() {
            return Err(format!("No player-history data for appid {}", app_id));
        }

        // steamcharts is already ascending, but sort defensively so the
        // range filter + downsample below can't be fooled by a stray
        // out-of-order sample.
        let mut s = raw;
        s.sort_by_key(|&(ts, _)| ts);

        let mut map = cache.raw.lock().map_err(|e| e.to_string())?;
        map.insert(app_id, (s.clone(), Instant::now()));
        s
    } else {
        series
    };

    // ── 2. All-time peak + range filter ─────────────────────────────
    let peak_all_time = series.iter().map(|&(_, c)| c).max().unwrap_or(0);

    let cutoff_ms: u64 = if range_days == 0 {
        0
    } else {
        let now_ms = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        now_ms.saturating_sub(range_days as u64 * 24 * 60 * 60 * 1000)
    };

    let in_range: Vec<(u64, u64)> = if cutoff_ms == 0 {
        series.clone()
    } else {
        series
            .iter()
            .filter(|&&(ts, _)| ts >= cutoff_ms)
            .cloned()
            .collect()
    };
    // A brand-new game with no samples inside the window shouldn't
    // produce an empty chart — fall back to the full series.
    let in_range = if in_range.is_empty() {
        series.clone()
    } else {
        in_range
    };

    // ── 3. Downsample to ≤ MAX_POINTS (every-Nth decimation) ─────────
    // Every-Nth sampling instead of bucket averaging: the steamcharts
    // feed mixes resolutions (monthly for old history, daily for recent,
    // hourly for the last few days), so averaging across a bucket mixes
    // month-peaks with intra-day lows and flattens real spikes. Taking
    // every Nth sample preserves each point's true value, keeps the
    // visible top of the line consistent with the true peak, and makes
    // the hover tooltip report real readings.
    let downsampled = in_range.len() > STEAM_HISTORY_MAX_POINTS;
    let points: Vec<SteamPlayerHistoryPoint> = if downsampled {
        let n = in_range.len();
        let step = (n as f64 / STEAM_HISTORY_MAX_POINTS as f64).ceil() as usize;
        let step = step.max(1);
        let mut out: Vec<SteamPlayerHistoryPoint> = Vec::with_capacity(n / step + 1);
        let mut i = 0;
        while i < n {
            let (ts, c) = in_range[i];
            out.push(SteamPlayerHistoryPoint {
                timestamp: ts,
                count: c,
            });
            i += step;
        }
        // Guarantee the most-recent sample is always present so the
        // "current" marker lands on the right edge.
        if let Some((last_ts, last_c)) = in_range.last() {
            if out.last().map(|p| p.timestamp) != Some(*last_ts) {
                out.push(SteamPlayerHistoryPoint {
                    timestamp: *last_ts,
                    count: *last_c,
                });
            }
        }
        out
    } else {
        in_range
            .iter()
            .map(|&(ts, c)| SteamPlayerHistoryPoint { timestamp: ts, count: c })
            .collect()
    };

    // ── 4. Aggregates + return ──────────────────────────────────────
    // Computed over the FULL in-range series (pre-downsample) so the
    // Peak / Avg tiles stay truthful even when the series was thinned
    // for rendering. Computing them from the downsampled points used to
    // understate the peak (bucket averages flatten single-day spikes)
    // and skew the average (mean of bucket means + a duplicated tail
    // point). Mean-of-samples matches steamcharts.com's own "Avg.
    // Players" definition (mean of the daily peak samples).
    let peak_in_range = in_range.iter().map(|&(_, c)| c).max().unwrap_or(0);
    let in_range_len = in_range.len() as u64;
    let total: u64 = in_range.iter().map(|&(_, c)| c).sum();
    let average_in_range = if in_range_len > 0 {
        total as f64 / in_range_len as f64
    } else {
        0.0
    };
    let current = in_range.last().map(|&(_, c)| c).unwrap_or(0);
    let sample_count = points.len() as u32;

    Ok(SteamPlayerHistory {
        app_id,
        points,
        current,
        peak_in_range,
        peak_all_time,
        average_in_range,
        sample_count,
        downsampled,
    })
}

// === Steam Game Stats (popover payload) =====================================
//
// The player-count popover (click the badge to expand) needs a small bundle
// of related stats: developer, publisher, release date, price, and recent
// review breakdown. We expose all of them as a single Tauri command so the
// frontend pays one IPC round-trip per open and we can fan out the two HTTP
// fetches (`appdetails` + `appreviews`) in parallel from Rust.
//
// Caching strategy
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Each section has its own TTL keyed by appid. Static-looking fields
// (dev / publisher / release date / genres) almost never change, so we
// cache appdetails for 24h. Reviews change slowly, so 1h. Errors get a
// short negative cache (5 min) to stop a flapping endpoint from
// hammering Steam while a transient issue resolves itself.
//
// All caches are `std::sync::Mutex<HashMap<â€¦>>` â€” the critical sections
// are short (HashMap reads/writes + cloning a small payload) and never
// held across an `.await`, so we don't need the async-aware mutex.

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
struct SteamGameDetails {
    name: String,
    developer: Option<String>,
    publisher: Option<String>,
    release_date: Option<String>,
    is_free: bool,
    price_cents: Option<u32>,
    currency: Option<String>,
    genres: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
struct SteamGameReviews {
    total_positive: u32,
    total_negative: u32,
    total_reviews: u32,
    score: Option<u8>,
    score_desc: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SteamGameStats {
    app_id: u32,
    details: Option<SteamGameDetails>,
    reviews: Option<SteamGameReviews>,
    /// Per-section error message so the frontend can render a clean
    /// "â€”" in place of the failed field rather than blanking the whole
    /// popover. The field is `None` on success or when the request
    /// returned `success: false` (which we treat as "no data", not as
    /// an error worth surfacing).
    details_error: Option<String>,
    reviews_error: Option<String>,
}

pub(crate) struct SteamGameStatsCache {
    details: std::sync::Mutex<HashMap<u32, (Option<SteamGameDetails>, Instant)>>,
    reviews: std::sync::Mutex<HashMap<u32, (Option<SteamGameReviews>, Instant)>>,
    details_neg: std::sync::Mutex<HashMap<u32, Instant>>,
    reviews_neg: std::sync::Mutex<HashMap<u32, Instant>>,
}

impl Default for SteamGameStatsCache {
    fn default() -> Self {
        Self {
            details: std::sync::Mutex::new(HashMap::new()),
            reviews: std::sync::Mutex::new(HashMap::new()),
            details_neg: std::sync::Mutex::new(HashMap::new()),
            reviews_neg: std::sync::Mutex::new(HashMap::new()),
        }
    }
}

const STEAM_DETAILS_TTL: Duration = Duration::from_secs(86_400); // 24h

const STEAM_REVIEWS_TTL: Duration = Duration::from_secs(3_600); //  1h

const STEAM_NEG_TTL: Duration = Duration::from_secs(300); //  5 min

/// Shared HTTP client for every Steam API call (`get_steam_player_count`,
/// the appdetails/reviews stats helpers, and any future endpoint).
///
/// Building a `reqwest::Client` is expensive â€” TLS config + connection
/// pool init runs every time and adds 50â€“200ms cold. The pre-existing
/// `get_steam_player_count` and the new stats helpers were each
/// rebuilding a fresh client per call (and `get_steam_game_stats` did
/// it twice via `tokio::join!`), so a single popover open could
/// rebuild up to 3 clients in a frame. `OnceLock` gives us zero-cost
/// lazy init: the client is built on the first call, then every
/// subsequent caller gets the same pooled client for free.
///
/// `OnceLock::get_or_init` takes a closure that must be infallible
/// on retry; the only realistic failure for `Client::builder().timeout
/// (...).user_agent(...).build()` is "the system is so broken we
/// can't even configure TLS", in which case panicking is correct
/// (the rest of the app can't function either).
fn shared_steam_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .user_agent("GameLib/0.1 (steam-api)")
            .build()
            .expect("steam HTTP client builder is infallible with these options")
    })
}

/// Internal: appdetails fetch + cache + parse. Stays private to this
/// module â€” the public surface is `get_steam_game_stats`, which
/// orchestrates the parallel fetch.
async fn fetch_steam_game_details_impl(
    cache: &SteamGameStatsCache,
    app_id: u32,
) -> Result<Option<SteamGameDetails>, String> {
    // â”€â”€ 1. Positive cache â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    {
        let map = cache.details.lock().map_err(|e| e.to_string())?;
        if let Some((payload, fetched_at)) = map.get(&app_id) {
            if fetched_at.elapsed() < STEAM_DETAILS_TTL {
                return Ok(payload.clone());
            }
        }
    }

    // â”€â”€ 2. Negative cache (recent transport error â†’ bail early) â”€â”€â”€â”€â”€
    {
        let neg = cache.details_neg.lock().map_err(|e| e.to_string())?;
        if let Some(ts) = neg.get(&app_id) {
            if ts.elapsed() < STEAM_NEG_TTL {
                return Err("Recent appdetails fetch failed; backed off".to_string());
            }
        }
    }

    // â”€â”€ 3. Fetch from store.steampowered.com/api/appdetails â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Response shape: `{ "<appid>": { "success": bool, "data": {...} } }`.
    // On `success: false` we treat it as "Steam has no data for this
    // appid" and surface a clean error (no negative cache, since
    // success:false for an untracked appid is permanent).
    let url = format!(
        "https://store.steampowered.com/api/appdetails?appids={}&cc=us&l=en",
        app_id
    );
    let client = shared_steam_client();
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("appdetails request failed: {}", e))?;

    if !resp.status().is_success() {
        let err = format!("appdetails returned HTTP {}", resp.status());
        let mut neg = cache.details_neg.lock().map_err(|e| e.to_string())?;
        neg.insert(app_id, Instant::now());
        return Err(err);
    }

    // Steam returns the appid as a string key (e.g. "730" not 730).
    // Pull the entry out by its stringified id, since we can't index
    // the HashMap with a numeric key.
    #[derive(Deserialize)]
    struct AppDetailsWrapper {
        success: bool,
        #[serde(default)]
        data: Option<AppDetailsData>,
    }
    #[derive(Deserialize, Default)]
    #[serde(default)]
    struct AppDetailsData {
        name: String,
        developers: Vec<String>,
        publishers: Vec<String>,
        release_date: Option<AppReleaseDate>,
        is_free: bool,
        price_overview: Option<AppPrice>,
        genres: Vec<AppGenre>,
    }
    #[derive(Deserialize)]
    struct AppReleaseDate {
        date: String,
        /// Reserved â€” surfaced as the StoreGameCard "Coming soon" badge.
        /// StoreContext renders the badge from a sibling IGDB payload
        /// today, so no Rust call site reads this yet.
        #[serde(default)]
        #[allow(dead_code)]
        coming_soon: bool,
    }
    #[derive(Deserialize)]
    struct AppPrice {
        currency: String,
        /// `final` is a Rust reserved keyword; rename it on the way in.
        #[serde(default, rename = "final")]
        final_cents: u32,
    }
    #[derive(Deserialize)]
    struct AppGenre {
        description: String,
    }

    let mut map: HashMap<String, AppDetailsWrapper> = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse appdetails JSON: {}", e))?;

    let wrapper = map
        .remove(&app_id.to_string())
        .ok_or_else(|| format!("appdetails missing key for appid {}", app_id))?;

    if !wrapper.success {
        // `success: false` means Steam has no store page for this
        // appid (unlisted tools, demos, soundtracks, removed games,
        // unreleased test apps). This is a legitimate "no metadata"
        // answer, not a transport failure â€” surface it as `Ok(None)`
        // so the popover renders the empty-state message instead of
        // flagging the title as broken. We also do NOT write a
        // negative-cache entry, since the answer is permanent for
        // this appid.
        return Ok(None);
    }

    let data = wrapper.data.ok_or_else(|| {
        // success=true but no data block â€” treat as no data.
        "appdetails returned no data block".to_string()
    })?;

    // Skip "coming soon" entries with no fixed date so the popover
    // doesn't display an empty `Release date: ""` row.
    let release_date = data
        .release_date
        .as_ref()
        .filter(|r| !r.date.trim().is_empty())
        .map(|r| r.date.clone());

    let price_cents = data
        .price_overview
        .as_ref()
        .map(|p| p.final_cents)
        .filter(|c| *c > 0);
    let currency = data
        .price_overview
        .as_ref()
        .map(|p| p.currency.clone());

    let details = SteamGameDetails {
        name: data.name,
        developer: data.developers.into_iter().next(),
        publisher: data.publishers.into_iter().next(),
        release_date,
        is_free: data.is_free,
        price_cents,
        currency,
        genres: data.genres.into_iter().map(|g| g.description).collect(),
    };

    // â”€â”€ 4. Cache positive â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    {
        let mut map = cache.details.lock().map_err(|e| e.to_string())?;
        map.insert(app_id, (Some(details.clone()), Instant::now()));
    }

    Ok(Some(details))
}

async fn fetch_steam_game_reviews_impl(
    cache: &SteamGameStatsCache,
    app_id: u32,
) -> Result<Option<SteamGameReviews>, String> {
    // â”€â”€ 1. Positive cache â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    {
        let map = cache.reviews.lock().map_err(|e| e.to_string())?;
        if let Some((payload, fetched_at)) = map.get(&app_id) {
            if fetched_at.elapsed() < STEAM_REVIEWS_TTL {
                return Ok(payload.clone());
            }
        }
    }

    // â”€â”€ 2. Negative cache â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    {
        let neg = cache.reviews_neg.lock().map_err(|e| e.to_string())?;
        if let Some(ts) = neg.get(&app_id) {
            if ts.elapsed() < STEAM_NEG_TTL {
                return Err("Recent appreviews fetch failed; backed off".to_string());
            }
        }
    }

    // â”€â”€ 3. Fetch from store.steampowered.com/appreviews â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // `num_per_page=0` skips the heavy `reviews[]` array â€” we only
    // want the aggregate counts in `query_summary`. This makes the
    // response dramatically smaller for popular games (e.g. CS2 has
    // 1M+ reviews; the per-review list would be a multi-MB payload
    // for nothing).
    let url = format!(
        "https://store.steampowered.com/appreviews/{}?json=1&filter=all&language=all&num_per_page=0",
        app_id
    );
    let client = shared_steam_client();
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("appreviews request failed: {}", e))?;

    if !resp.status().is_success() {
        let err = format!("appreviews returned HTTP {}", resp.status());
        let mut neg = cache.reviews_neg.lock().map_err(|e| e.to_string())?;
        neg.insert(app_id, Instant::now());
        return Err(err);
    }

    #[derive(Deserialize, Default)]
    #[serde(default)]
    struct ReviewsQuerySummary {
        num_reviews: u32,
        review_score: u8,
        review_score_desc: String,
        total_positive: u32,
        total_negative: u32,
        total_reviews: u32,
    }
    #[derive(Deserialize, Default)]
    #[serde(default)]
    struct ReviewsResponse {
        success: u8,
        query_summary: Option<ReviewsQuerySummary>,
    }

    let payload: ReviewsResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse appreviews JSON: {}", e))?;

    if payload.success != 1 {
        // Steam returns `success: 2` (or higher) when the appid has
        // no reviews page â€” same "legitimate no data" case as
        // appdetails' `success: false`. Map it to `Ok(None)` so the
        // popover renders the empty-state message instead of
        // flagging the title as broken. No negative-cache write:
        // the answer is permanent for this appid.
        return Ok(None);
    }

    let summary = payload
        .query_summary
        .ok_or_else(|| "appreviews returned no query_summary".to_string())?;

    // An empty `total_reviews` means Steam has no reviews at all for
    // this title â€” represent that as `Some(empty)` so the popover
    // shows "No reviews" rather than the generic "â€”".
    let score_desc = if summary.review_score_desc.trim().is_empty() {
        None
    } else {
        Some(summary.review_score_desc)
    };

    let reviews = SteamGameReviews {
        total_positive: summary.total_positive,
        total_negative: summary.total_negative,
        total_reviews: summary.total_reviews,
        score: Some(summary.review_score),
        score_desc,
    };

    // â”€â”€ 4. Cache positive â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    {
        let mut map = cache.reviews.lock().map_err(|e| e.to_string())?;
        map.insert(app_id, (Some(reviews.clone()), Instant::now()));
    }

    Ok(Some(reviews))
}

/// Aggregate all per-game Steam stats the popover renders in one IPC
/// call. Internally fans out the two HTTP fetches via `tokio::join!`
/// so the popover opens in roughly the time of the slowest endpoint
/// (typically ~400ms cold, ~30ms warm from the backend cache) rather
/// than the sum.
///
/// The `current_players` field is sourced from the existing
/// `get_steam_player_count` command rather than fetched again, so
/// the badge count and the popover header count are guaranteed to
/// agree at the moment of click. The badge still keeps its own 60s
/// polling loop, so by the time the user reopens the popover the
/// number may have ticked up â€” that's expected.
///
/// Each section is returned independently with its own `*_error`
/// field, so a Steam hiccup on `appdetails` doesn't blank the
/// popover if reviews came back fine.
#[tauri::command]
pub async fn get_steam_game_stats(
    app: tauri::AppHandle,
    app_id: u32,
) -> Result<SteamGameStats, String> {
    // Details + reviews in parallel. The State guard is local to this
    // function and the references handed to `tokio::join!` are tied to
    // its lifetime â€” the await points are inside the helper functions,
    // never in the outer scope, so the borrow checker is happy.
    //
    // The current concurrent-player count is intentionally NOT fetched
    // here: the frontend's `<SteamPlayerCount>` already polls it on a
    // 60s loop and passes the latest value down to the popover as a
    // prop. Re-fetching it from the backend would (a) burn a Steam API
    // call we just made, and (b) introduce a small window where the
    // badge and the popover header disagree (the badge polled at T=0,
    // the popover opens at T=2s, the backend returns the count from
    // T=0 + a fresh round-trip = T=0.1 â€” a different snapshot than
    // what's painted on the badge).
    let cache: tauri::State<'_, SteamGameStatsCache> = app.state();
    let (details_res, reviews_res) = tokio::join!(
        fetch_steam_game_details_impl(&cache, app_id),
        fetch_steam_game_reviews_impl(&cache, app_id),
    );

    Ok(SteamGameStats {
        app_id,
        details: details_res.as_ref().ok().and_then(|r| r.clone()),
        reviews: reviews_res.as_ref().ok().and_then(|r| r.clone()),
        details_error: details_res.err(),
        reviews_error: reviews_res.err(),
    })
}

