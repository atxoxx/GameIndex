//! HowLongToBeat scraper.
//!
//! HLTB has no public API. Its own frontend bootstraps a short-lived
//! token from `/api/search/site/init`, POSTs the search body to
//! `/api/search/site`, and renders each game page with the full stat
//! payload embedded in the Next.js `__NEXT_DATA__` script tag. This
//! module mirrors exactly that flow:
//!
//!   1. fetch (and cache) the search token — `token`, `hpKey`, `hpVal`
//!   2. POST the search body, pick the best title match
//!   3. GET `/game/<id>` and parse `__NEXT_DATA__` for the detailed stats
//!
//! Requests are paced and results cached in memory so a library-wide
//! enrichment sweep doesn't hammer the site. Everything degrades to
//! `None` on failure — HLTB is enrichment, never a hard dependency.

use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const BASE: &str = "https://howlongtobeat.com";
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const TOKEN_TTL: Duration = Duration::from_secs(20 * 60);
const CACHE_TTL: Duration = Duration::from_secs(12 * 60 * 60);
const MIN_REQUEST_GAP: Duration = Duration::from_millis(600);
/// Minimum fuzzy-match score required before we trust a HLTB search hit.
const MIN_MATCH_SCORE: i32 = 200;
/// Upper bound on cached name→result entries (one per game, ~hundreds).
const CACHE_MAX_ENTRIES: usize = 2000;

// ── Public data model ────────────────────────────────────────────────────────

/// Unified "time to beat" payload stored on a game. The three legacy
/// IGDB fields are kept so manually-entered values and pre-HLTB rows
/// still deserialize; `hltb` carries the richer HowLongToBeat stats.
#[derive(Debug, Default, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TimeToBeat {
    /// Seconds spent rushing through the game (legacy IGDB "hastily").
    /// The legacy `hastly` typo is accepted as an alias for backward
    /// compatibility with games.json saved before the fix.
    #[serde(alias = "hastly", default, skip_serializing_if = "Option::is_none")]
    pub hastily: Option<u64>,
    /// Main story, in seconds (IGDB `normally`, HLTB `comp_main`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub normally: Option<u64>,
    /// Completionist, in seconds (IGDB `completely`, HLTB `comp_100`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completely: Option<u64>,
    /// Main + extra, in seconds (HLTB `comp_plus`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub main_extra: Option<u64>,
    /// All play styles, in seconds (HLTB `comp_all`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub all_styles: Option<u64>,
    /// Full HowLongToBeat stats for the details modal.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hltb: Option<HltbStats>,
}

impl TimeToBeat {
    pub fn has_any_time(&self) -> bool {
        [self.normally, self.main_extra, self.completely, self.all_styles, self.hastily]
            .into_iter()
            .flatten()
            .any(|v| v > 0)
    }
}

#[derive(Debug, Default, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HltbStats {
    pub game_id: u64,
    pub game_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub game_alias: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub game_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub developer: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub publisher: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub platforms: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub genres: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub steam_app_id: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub release_world: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub release_na: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub release_eu: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub release_jp: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rating_esrb: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rating_pegi: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rating_cero: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub main_story: Option<HltbTimeStat>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub main_extra: Option<HltbTimeStat>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completionist: Option<HltbTimeStat>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub all_styles: Option<HltbTimeStat>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speedrun: Option<HltbTimeStat>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completionist_speedrun: Option<HltbTimeStat>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub invested_co: Option<HltbTimeStat>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub invested_mp: Option<HltbTimeStat>,
    #[serde(default)]
    pub levels: HltbLevels,
    #[serde(default)]
    pub community: HltbCommunity,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub platform_stats: Vec<HltbPlatformStat>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub related: Vec<HltbRelatedGame>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub review_histogram: Vec<HltbReviewBucket>,
}

/// One timing bucket (average / median / fastest / slowest + submissions).
#[derive(Debug, Default, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HltbTimeStat {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub average: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub median: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub low: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub high: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub count: Option<u64>,
}

#[derive(Debug, Default, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HltbLevels {
    #[serde(default)]
    pub single_player: bool,
    #[serde(default)]
    pub single_player_difficulty: bool,
    #[serde(default)]
    pub co_op: bool,
    #[serde(default)]
    pub multiplayer: bool,
    #[serde(default)]
    pub combined: bool,
}

#[derive(Debug, Default, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HltbCommunity {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub playing: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backlog: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub replays: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retired: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reviews: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub review_score: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total: Option<u64>,
}

#[derive(Debug, Default, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HltbPlatformStat {
    pub platform: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub main_story: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub main_extra: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completionist: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub all_styles: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub low: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub high: Option<u64>,
}

#[derive(Debug, Default, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HltbRelatedGame {
    pub game_id: u64,
    pub game_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub game_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub main_story: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub main_extra: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completionist: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub all_styles: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub all_styles_count: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backlog: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub review_score: Option<u64>,
}

#[derive(Debug, Default, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HltbReviewBucket {
    pub score: u32,
    pub count: u64,
}

// ── Internal wire types ──────────────────────────────────────────────────────

#[derive(Debug, Clone)]
struct SearchToken {
    token: String,
    hp_key: String,
    hp_val: String,
    fetched_at: Instant,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct SearchItem {
    game_id: u64,
    game_name: String,
    #[serde(default)]
    game_alias: Option<String>,
    #[serde(default)]
    game_type: Option<String>,
    #[serde(default)]
    game_image: Option<String>,
    #[serde(default)]
    profile_platform: Option<String>,
    #[serde(default)]
    release_world: Option<Value>,
    #[serde(default)]
    review_score: Option<u64>,
    #[serde(default)]
    comp_main: Option<u64>,
    #[serde(default)]
    comp_plus: Option<u64>,
    #[serde(default)]
    comp_100: Option<u64>,
    #[serde(default)]
    comp_all: Option<u64>,
    #[serde(default)]
    comp_main_count: Option<u64>,
    #[serde(default)]
    comp_plus_count: Option<u64>,
    #[serde(default)]
    comp_100_count: Option<u64>,
    #[serde(default)]
    comp_all_count: Option<u64>,
    #[serde(default)]
    invested_co: Option<u64>,
    #[serde(default)]
    invested_co_count: Option<u64>,
    #[serde(default)]
    invested_mp: Option<u64>,
    #[serde(default)]
    invested_mp_count: Option<u64>,
    #[serde(default)]
    count_comp: Option<u64>,
    #[serde(default)]
    count_backlog: Option<u64>,
    #[serde(default)]
    count_playing: Option<u64>,
    #[serde(default)]
    count_retired: Option<u64>,
    #[serde(default)]
    count_review: Option<u64>,
    #[serde(default)]
    comp_lvl_sp: Option<u64>,
    #[serde(default)]
    comp_lvl_spd: Option<u64>,
    #[serde(default)]
    comp_lvl_co: Option<u64>,
    #[serde(default)]
    comp_lvl_mp: Option<u64>,
    #[serde(default)]
    comp_lvl_combine: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct SearchResponse {
    #[serde(default)]
    data: Vec<SearchItem>,
}

// ── Entry point ──────────────────────────────────────────────────────────────

/// Look up HowLongToBeat stats for a game.
///
/// When `hltb_id` is known the game page is fetched directly; otherwise
/// the name is searched and the best match's page is fetched for detail.
/// Results (including misses) are cached for [`CACHE_TTL`].
pub async fn fetch_time_to_beat(name: &str, hltb_id: Option<u64>) -> Option<TimeToBeat> {
    let key = match hltb_id {
        Some(id) => format!("id:{}", id),
        None => normalize_name(name),
    };
    if key.is_empty() {
        return None;
    }
    if let Some(hit) = cache_get(&key) {
        return hit;
    }
    let result = fetch_uncached(name, hltb_id).await;
    cache_put(key, result.clone());
    result
}

async fn fetch_uncached(name: &str, hltb_id: Option<u64>) -> Option<TimeToBeat> {
    let mut item: Option<SearchItem> = None;
    let mut detail: Option<Value> = None;

    if let Some(id) = hltb_id {
        detail = fetch_detail(id).await;
    }
    if detail.is_none() {
        if let Some(found) = search(name).await {
            detail = fetch_detail(found.game_id).await;
            item = Some(found);
        }
    }
    build_time_to_beat(item.as_ref(), detail.as_ref())
}

// ── HTTP plumbing ────────────────────────────────────────────────────────────

fn http_client() -> reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .user_agent(USER_AGENT)
                .timeout(Duration::from_secs(20))
                .redirect(reqwest::redirect::Policy::limited(5))
                .build()
                .unwrap_or_else(|_| reqwest::Client::new())
        })
        .clone()
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn token_cache() -> &'static Mutex<Option<SearchToken>> {
    static CACHE: OnceLock<Mutex<Option<SearchToken>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

/// Serialize requests to one every [`MIN_REQUEST_GAP`] so enrichment
/// sweeps stay polite; the site's own client debounces the same way.
async fn pace() {
    static GATE: OnceLock<tokio::sync::Mutex<Option<Instant>>> = OnceLock::new();
    let gate = GATE.get_or_init(|| tokio::sync::Mutex::new(None));
    let mut last = gate.lock().await;
    if let Some(at) = *last {
        let elapsed = at.elapsed();
        if elapsed < MIN_REQUEST_GAP {
            tokio::time::sleep(MIN_REQUEST_GAP - elapsed).await;
        }
    }
    *last = Some(Instant::now());
}

async fn get_token(force: bool) -> Option<SearchToken> {
    if !force {
        if let Ok(guard) = token_cache().lock() {
            if let Some(cached) = guard.as_ref() {
                if cached.fetched_at.elapsed() < TOKEN_TTL {
                    return Some(cached.clone());
                }
            }
        }
    }
    let url = format!("{}/api/search/site/init?t={}", BASE, now_millis());
    let resp = http_client()
        .get(&url)
        .header("Referer", format!("{}/", BASE))
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let value: Value = resp.json().await.ok()?;
    let cached = SearchToken {
        token: value.get("token")?.as_str()?.to_string(),
        hp_key: value.get("hpKey")?.as_str()?.to_string(),
        hp_val: value.get("hpVal")?.as_str()?.to_string(),
        fetched_at: Instant::now(),
    };
    if let Ok(mut guard) = token_cache().lock() {
        *guard = Some(cached.clone());
    }
    Some(cached)
}

async fn search_items(name: &str, token: &SearchToken) -> Option<Vec<SearchItem>> {
    let terms = search_terms(name);
    if terms.is_empty() {
        return None;
    }
    let mut body = json!({
        "searchType": "games",
        "searchTerms": terms,
        "searchPage": 1,
        "size": 20,
        "searchOptions": {
            "games": {
                "userId": 0,
                "platform": "",
                "sortCategory": "popular",
                "rangeCategory": "main",
                "rangeTime": { "min": 0, "max": 0 },
                "gameplay": { "perspective": "", "flow": "", "genre": "", "difficulty": "" },
                "year": "",
                "modifier": ""
            },
            "users": { "sortCategory": "postcount" },
            "lists": { "sortCategory": "follows" },
            "filter": "",
            "sort": 0,
            "randomizer": 0
        },
        "useCache": true
    });
    if let Some(obj) = body.as_object_mut() {
        obj.insert(token.hp_key.clone(), Value::String(token.hp_val.clone()));
    }

    pace().await;
    let resp = http_client()
        .post(format!("{}/api/search/site", BASE))
        .header("Content-Type", "application/json")
        .header("x-auth-token", &token.token)
        .header("x-hp-key", &token.hp_key)
        .header("x-hp-val", &token.hp_val)
        .header("Referer", format!("{}/", BASE))
        .json(&body)
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let parsed: SearchResponse = resp.json().await.ok()?;
    Some(parsed.data)
}

async fn search(name: &str) -> Option<SearchItem> {
    let token = get_token(false).await?;
    if let Some(items) = search_items(name, &token).await {
        return pick_best(name, items);
    }
    // Forbidden / transient: refresh the token once and retry.
    let fresh = get_token(true).await?;
    let items = search_items(name, &fresh).await?;
    pick_best(name, items)
}

async fn fetch_detail(id: u64) -> Option<Value> {
    pace().await;
    let resp = http_client()
        .get(format!("{}/game/{}", BASE, id))
        .header("Referer", format!("{}/", BASE))
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let html = resp.text().await.ok()?;
    parse_next_data(&html)
}

/// Extract and parse the Next.js `__NEXT_DATA__` JSON blob.
fn parse_next_data(html: &str) -> Option<Value> {
    const MARKER: &str = "id=\"__NEXT_DATA__\"";
    let marker = html.find(MARKER)?;
    let open = html[marker..].find('>')? + marker + 1;
    let close = html[open..].find("</script>")? + open;
    serde_json::from_str(html[open..close].trim()).ok()
}

// ── Matching ─────────────────────────────────────────────────────────────────

fn normalize_name(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut pending_space = false;
    for c in s.chars() {
        if c.is_alphanumeric() {
            if pending_space && !out.is_empty() {
                out.push(' ');
            }
            out.extend(c.to_lowercase());
            pending_space = false;
        } else {
            pending_space = true;
        }
    }
    out
}

fn match_score(query: &str, candidate: &str) -> i32 {
    let q = normalize_name(query);
    let c = normalize_name(candidate);
    if q.is_empty() || c.is_empty() {
        return 0;
    }
    if q == c {
        return 1000;
    }
    if c.starts_with(&q) || q.starts_with(&c) {
        let ratio = q.len().min(c.len()) as f32 / q.len().max(c.len()) as f32;
        return 600 + (ratio * 150.0) as i32;
    }
    let q_tokens: HashSet<&str> = q.split_whitespace().collect();
    let c_tokens: HashSet<&str> = c.split_whitespace().collect();
    let intersection = q_tokens.intersection(&c_tokens).count() as f32;
    let union = q_tokens.union(&c_tokens).count() as f32;
    if union == 0.0 {
        return 0;
    }
    ((intersection / union) * 500.0) as i32
}

fn release_year(item: &SearchItem) -> Option<i32> {
    let value = item.release_world.as_ref()?;
    if let Some(year) = value.as_i64() {
        return i32::try_from(year).ok();
    }
    let text = value.as_str()?;
    text.get(0..4)?.parse().ok()
}

fn extract_year(name: &str) -> Option<i32> {
    name.split(|c: char| !c.is_ascii_digit())
        .find_map(|token| {
            if token.len() == 4 {
                let year: i32 = token.parse().ok()?;
                (1970..=2100).contains(&year).then_some(year)
            } else {
                None
            }
        })
}

/// Strip parenthesised years ("Prototype (2009)") before searching —
/// HLTB's token search treats them as literal terms.
fn search_terms(name: &str) -> Vec<String> {
    let mut cleaned = String::with_capacity(name.len());
    let mut depth = 0usize;
    for c in name.chars() {
        match c {
            '(' | '[' => depth += 1,
            ')' | ']' => depth = depth.saturating_sub(1),
            _ if depth == 0 => cleaned.push(c),
            _ => {}
        }
    }
    cleaned
        .split_whitespace()
        .map(|t| t.trim_matches(|c: char| !c.is_alphanumeric()).to_string())
        .filter(|t| !t.is_empty() && !is_year_token(t))
        .collect()
}

/// True for bare 4-digit years ("2009") that should not be sent as
/// search terms (HLTB search treats them as literal title words).
fn is_year_token(token: &str) -> bool {
    token.len() == 4
        && token.chars().all(|c| c.is_ascii_digit())
        && token
            .parse::<i32>()
            .map(|year| (1970..=2100).contains(&year))
            .unwrap_or(false)
}

fn pick_best(query: &str, items: Vec<SearchItem>) -> Option<SearchItem> {
    let year = extract_year(query);
    let mut best: Option<(i32, SearchItem)> = None;
    for item in items {
        let mut score = match_score(query, &item.game_name);
        if let Some(alias) = item.game_alias.as_deref() {
            score = score.max(match_score(query, alias));
        }
        if item.game_type.as_deref() == Some("dlc") {
            score -= 50;
        }
        if let (Some(wanted), Some(found)) = (year, release_year(&item)) {
            if wanted == found {
                score += 100;
            }
        }
        if score < MIN_MATCH_SCORE {
            continue;
        }
        if best.as_ref().map(|(s, _)| score > *s).unwrap_or(true) {
            best = Some((score, item));
        }
    }
    best.map(|(_, item)| item)
}

// ── Cache ────────────────────────────────────────────────────────────────────

struct CacheEntry {
    value: Option<TimeToBeat>,
    stored_at: Instant,
}

fn cache() -> &'static Mutex<HashMap<String, CacheEntry>> {
    static CACHE: OnceLock<Mutex<HashMap<String, CacheEntry>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cache_get(key: &str) -> Option<Option<TimeToBeat>> {
    let mut guard = cache().lock().ok()?;
    let entry = guard.get(key)?;
    if entry.stored_at.elapsed() > CACHE_TTL {
        guard.remove(key);
        return None;
    }
    Some(entry.value.clone())
}

fn cache_put(key: String, value: Option<TimeToBeat>) {
    if let Ok(mut guard) = cache().lock() {
        if guard.len() >= CACHE_MAX_ENTRIES {
            let now = Instant::now();
            guard.retain(|_, entry| now.duration_since(entry.stored_at) < CACHE_TTL);
        }
        guard.insert(
            key,
            CacheEntry {
                value,
                stored_at: Instant::now(),
            },
        );
    }
}

// ── Mapping ──────────────────────────────────────────────────────────────────

fn value_u64(value: &Value, key: &str) -> Option<u64> {
    value.get(key).and_then(|v| v.as_u64())
}

fn nonzero(value: Option<u64>) -> Option<u64> {
    value.filter(|v| *v > 0)
}

fn detail_game<'a>(detail: Option<&'a Value>) -> Option<&'a Value> {
    detail?
        .get("props")?
        .get("pageProps")?
        .get("game")?
        .get("data")?
        .get("game")?
        .as_array()?
        .first()
}

fn detail_data<'a>(detail: Option<&'a Value>) -> Option<&'a Value> {
    detail?.get("props")?.get("pageProps")?.get("game")?.get("data")
}

fn build_time_stat(
    prefix: &str,
    game: Option<&Value>,
    fallback_average: Option<u64>,
    fallback_count: Option<u64>,
) -> HltbTimeStat {
    let field = |suffix: &str| -> Option<u64> {
        game.and_then(|g| {
            let key = if suffix.is_empty() {
                prefix.to_string()
            } else {
                format!("{}_{}", prefix, suffix)
            };
            value_u64(g, &key)
        })
    };
    HltbTimeStat {
        average: nonzero(field("")).or(nonzero(field("avg"))).or(fallback_average),
        median: nonzero(field("med")),
        // Regular buckets use `_l` / `_h`; speedruns use `_min` / `_max`.
        low: nonzero(field("l")).or(nonzero(field("min"))),
        high: nonzero(field("h")).or(nonzero(field("max"))),
        count: nonzero(field("count")).or(fallback_count),
    }
}

fn has_stat(stat: &HltbTimeStat) -> bool {
    stat.average.is_some() || stat.median.is_some() || stat.low.is_some() || stat.high.is_some()
}

fn detail_string(game: Option<&Value>, key: &str) -> Option<String> {
    game.and_then(|g| g.get(key))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn build_time_to_beat(
    fallback: Option<&SearchItem>,
    detail: Option<&Value>,
) -> Option<TimeToBeat> {
    let game = detail_game(detail);
    let dataset = detail_data(detail);
    let game_id = game
        .and_then(|g| value_u64(g, "game_id"))
        .or_else(|| fallback.map(|s| s.game_id))?;

    let stat = |prefix: &str, avg: Option<u64>, count: Option<u64>| {
        build_time_stat(prefix, game, nonzero(avg), nonzero(count))
    };

    let main_story = stat(
        "comp_main",
        fallback.and_then(|s| s.comp_main),
        fallback.and_then(|s| s.comp_main_count),
    );
    let main_extra = stat(
        "comp_plus",
        fallback.and_then(|s| s.comp_plus),
        fallback.and_then(|s| s.comp_plus_count),
    );
    let completionist = stat(
        "comp_100",
        fallback.and_then(|s| s.comp_100),
        fallback.and_then(|s| s.comp_100_count),
    );
    let all_styles = stat(
        "comp_all",
        fallback.and_then(|s| s.comp_all),
        fallback.and_then(|s| s.comp_all_count),
    );
    let speedrun = build_time_stat("comp_speed", game, None, None);
    let completionist_speedrun = build_time_stat("comp_speed100", game, None, None);
    let invested_co = stat(
        "invested_co",
        fallback.and_then(|s| s.invested_co),
        fallback.and_then(|s| s.invested_co_count),
    );
    let invested_mp = stat(
        "invested_mp",
        fallback.and_then(|s| s.invested_mp),
        fallback.and_then(|s| s.invested_mp_count),
    );

    let time_to_beat = TimeToBeat {
        hastily: None,
        normally: main_story.average.or(nonzero(fallback.and_then(|s| s.comp_main))),
        main_extra: main_extra.average.or(nonzero(fallback.and_then(|s| s.comp_plus))),
        completely: completionist.average.or(nonzero(fallback.and_then(|s| s.comp_100))),
        all_styles: all_styles.average.or(nonzero(fallback.and_then(|s| s.comp_all))),
        hltb: None,
    };
    if !time_to_beat.has_any_time() {
        return None;
    }

    let levels = HltbLevels {
        single_player: level_flag(game, "comp_lvl_sp", fallback.and_then(|s| s.comp_lvl_sp)),
        single_player_difficulty: level_flag(
            game,
            "comp_lvl_spd",
            fallback.and_then(|s| s.comp_lvl_spd),
        ),
        co_op: level_flag(game, "comp_lvl_co", fallback.and_then(|s| s.comp_lvl_co)),
        multiplayer: level_flag(game, "comp_lvl_mp", fallback.and_then(|s| s.comp_lvl_mp)),
        combined: level_flag(
            game,
            "comp_lvl_combine",
            fallback.and_then(|s| s.comp_lvl_combine),
        ),
    };

    let number = |key: &str, fallback_value: Option<u64>| {
        nonzero(game.and_then(|g| value_u64(g, key))).or(nonzero(fallback_value))
    };
    let community = HltbCommunity {
        completed: number("count_comp", fallback.and_then(|s| s.count_comp)),
        playing: number("count_playing", fallback.and_then(|s| s.count_playing)),
        backlog: number("count_backlog", fallback.and_then(|s| s.count_backlog)),
        replays: number("count_replay", None),
        retired: number("count_retired", fallback.and_then(|s| s.count_retired)),
        reviews: number("count_review", fallback.and_then(|s| s.count_review)),
        review_score: number("review_score", fallback.and_then(|s| s.review_score)),
        total: number("count_total", None),
    };

    let game_name = detail_string(game, "game_name")
        .or_else(|| fallback.map(|s| s.game_name.clone()))?;
    let image_file = detail_string(game, "game_image")
        .or_else(|| fallback.and_then(|s| s.game_image.clone()));
    let image_url = image_file.map(|file| {
        if file.starts_with("http") {
            file
        } else {
            format!("{}/games/{}", BASE, file)
        }
    });

    let release_world = detail_string(game, "release_world").or_else(|| {
        fallback.and_then(|s| {
            s.release_world.as_ref().map(|v| match v {
                Value::Number(n) => n.to_string(),
                Value::String(s) => s.clone(),
                other => other.to_string(),
            })
        })
    });

    let stats = HltbStats {
        game_id,
        game_name,
        game_alias: detail_string(game, "game_alias")
            .or_else(|| fallback.and_then(|s| s.game_alias.clone())),
        game_type: detail_string(game, "game_type")
            .or_else(|| fallback.and_then(|s| s.game_type.clone())),
        url: Some(format!("{}/game/{}", BASE, game_id)),
        image_url,
        description: detail_string(game, "profile_summary"),
        developer: detail_string(game, "profile_dev"),
        publisher: detail_string(game, "profile_pub"),
        platforms: detail_string(game, "profile_platform")
            .or_else(|| fallback.and_then(|s| s.profile_platform.clone())),
        genres: detail_string(game, "profile_genre"),
        steam_app_id: nonzero(game.and_then(|g| value_u64(g, "profile_steam"))),
        release_world,
        release_na: detail_string(game, "release_na"),
        release_eu: detail_string(game, "release_eu"),
        release_jp: detail_string(game, "release_jp"),
        rating_esrb: detail_string(game, "rating_esrb"),
        rating_pegi: detail_string(game, "rating_pegi"),
        rating_cero: detail_string(game, "rating_cero"),
        main_story: has_stat(&main_story).then_some(main_story),
        main_extra: has_stat(&main_extra).then_some(main_extra),
        completionist: has_stat(&completionist).then_some(completionist),
        all_styles: has_stat(&all_styles).then_some(all_styles),
        speedrun: has_stat(&speedrun).then_some(speedrun),
        completionist_speedrun: has_stat(&completionist_speedrun)
            .then_some(completionist_speedrun),
        invested_co: has_stat(&invested_co).then_some(invested_co),
        invested_mp: has_stat(&invested_mp).then_some(invested_mp),
        levels,
        community,
        platform_stats: parse_platform_stats(dataset),
        related: parse_related(dataset),
        review_histogram: parse_review_histogram(dataset),
    };

    Some(TimeToBeat {
        hltb: Some(stats),
        ..time_to_beat
    })
}

fn level_flag(game: Option<&Value>, key: &str, fallback: Option<u64>) -> bool {
    nonzero(game.and_then(|g| value_u64(g, key))).or(nonzero(fallback)).is_some()
}

fn parse_platform_stats(dataset: Option<&Value>) -> Vec<HltbPlatformStat> {
    let Some(data) = dataset else {
        return Vec::new();
    };
    let all_styles_by_platform: HashMap<String, u64> = data
        .get("individuality")
        .and_then(|v| v.as_array())
        .map(|rows| {
            rows.iter()
                .filter_map(|row| {
                    let platform = row.get("platform")?.as_str()?.to_string();
                    let all = row.get("comp_all").and_then(|v| match v {
                        Value::String(s) => s.parse::<u64>().ok(),
                        Value::Number(n) => n.as_u64(),
                        _ => None,
                    });
                    all.filter(|v| *v > 0).map(|v| (platform, v))
                })
                .collect()
        })
        .unwrap_or_default();

    data.get("platformData")
        .and_then(|v| v.as_array())
        .map(|rows| {
            rows.iter()
                .filter_map(|row| {
                    let platform = row.get("platform")?.as_str()?.to_string();
                    let num = |key: &str| nonzero(row.get(key).and_then(|v| v.as_u64()));
                    Some(HltbPlatformStat {
                        all_styles: all_styles_by_platform.get(&platform).copied(),
                        platform,
                        completed: num("count_comp"),
                        total: num("count_total"),
                        main_story: num("comp_main"),
                        main_extra: num("comp_plus"),
                        completionist: num("comp_100"),
                        low: num("comp_low"),
                        high: num("comp_high"),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn parse_related(dataset: Option<&Value>) -> Vec<HltbRelatedGame> {
    dataset
        .and_then(|d| d.get("relationships"))
        .and_then(|v| v.as_array())
        .map(|rows| {
            rows.iter()
                .filter_map(|row| {
                    Some(HltbRelatedGame {
                        game_id: row.get("game_id")?.as_u64()?,
                        game_name: row.get("game_name")?.as_str()?.to_string(),
                        game_type: row
                            .get("game_type")
                            .and_then(|v| v.as_str())
                            .map(str::to_string),
                        main_story: nonzero(row.get("comp_main").and_then(|v| v.as_u64())),
                        main_extra: nonzero(row.get("comp_plus").and_then(|v| v.as_u64())),
                        completionist: nonzero(row.get("comp_100").and_then(|v| v.as_u64())),
                        all_styles: nonzero(row.get("comp_all").and_then(|v| v.as_u64())),
                        all_styles_count: nonzero(
                            row.get("comp_all_count").and_then(|v| v.as_u64()),
                        ),
                        backlog: nonzero(row.get("count_backlog").and_then(|v| v.as_u64())),
                        review_score: nonzero(row.get("review_score").and_then(|v| v.as_u64())),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn parse_review_histogram(dataset: Option<&Value>) -> Vec<HltbReviewBucket> {
    let Some(reviews) = dataset
        .and_then(|d| d.get("userReviews"))
        .and_then(|v| v.as_object())
    else {
        return Vec::new();
    };
    let mut buckets: Vec<HltbReviewBucket> = reviews
        .iter()
        .filter(|(key, _)| key.as_str() != "review_count")
        .filter_map(|(key, value)| {
            let score: u32 = key.parse().ok()?;
            let count = match value {
                Value::String(s) => s.parse::<u64>().ok()?,
                Value::Number(n) => n.as_u64()?,
                _ => return None,
            };
            (count > 0).then_some(HltbReviewBucket { score, count })
        })
        .collect();
    buckets.sort_by_key(|b| b.score);
    buckets
}

#[cfg(test)]
mod tests {
    use super::*;

    const DETAIL_HTML: &str = r#"
<!DOCTYPE html><html><head></head><body>
<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"game":{"data":{
"game":[{"game_id":94122,"game_name":"Crimson Desert","game_alias":"Crimson Desert Enhanced","game_image":"94122_Crimson_Desert.jpg","game_type":"game","count_playing":258,"count_backlog":1103,"count_replay":6,"count_comp":314,"count_retired":109,"count_review":215,"review_score":78,"profile_summary":"War-torn realm","profile_dev":"Pearl Abyss","profile_pub":"Pearl Abyss","profile_platform":"PC, PlayStation 5","profile_genre":"Action, RPG","profile_steam":3321460,"release_world":"2026-03-19","release_na":"2026-03-19","release_eu":"2026-03-19","release_jp":"","rating_esrb":"","rating_pegi":"16","rating_cero":"","comp_lvl_sp":1,"comp_lvl_spd":1,"comp_lvl_co":0,"comp_lvl_mp":0,"comp_lvl_combine":0,"comp_all_count":173,"comp_all":483146,"comp_all_l":298273,"comp_all_h":1394053,"comp_all_avg":516291,"comp_all_med":450000,"comp_main_count":42,"comp_main":244249,"comp_main_l":178825,"comp_main_h":321925,"comp_main_avg":245497,"comp_main_med":243000,"comp_plus_count":104,"comp_plus":507418,"comp_plus_l":311399,"comp_plus_h":865709,"comp_plus_avg":514436,"comp_plus_med":500400,"comp_100_count":27,"comp_100":924135,"comp_100_l":784088,"comp_100_h":1614548,"comp_100_avg":944670,"comp_100_med":903600,"comp_speed_count":0,"comp_speed":0,"comp_speed100_count":0,"comp_speed100":0,"count_total":2488,"invested_co_count":0,"invested_co":0,"invested_mp_count":0,"invested_mp":0}],
"individuality":[{"platform":"PC","count_comp":"119","comp_main":"253808","comp_plus":"520734","comp_100":"984573","comp_all":"529744"}],
"relationships":[{"game_id":190788,"game_name":"Charting the Unknown","game_type":"dlc","comp_main":0,"comp_plus":0,"comp_100":0,"comp_all":0,"comp_all_count":0,"count_backlog":4,"review_score":0}],
"userReviews":{"5":"1","50":"5","100":"21","review_count":208},
"platformData":[{"platform":"PC","count_comp":119,"count_total":230,"comp_main":253808,"comp_plus":520734,"comp_100":984573,"comp_low":100000,"comp_high":900000}]
}}}}}</script>
</body></html>"#;

    #[test]
    fn parses_next_data_payload() {
        let parsed = parse_next_data(DETAIL_HTML).expect("payload parses");
        let ttb = build_time_to_beat(None, Some(&parsed)).expect("stats map");
        assert_eq!(ttb.normally, Some(244249));
        assert_eq!(ttb.main_extra, Some(507418));
        assert_eq!(ttb.completely, Some(924135));
        assert_eq!(ttb.all_styles, Some(483146));
        let stats = ttb.hltb.expect("detail stats");
        assert_eq!(stats.game_id, 94122);
        assert_eq!(stats.developer.as_deref(), Some("Pearl Abyss"));
        assert_eq!(stats.community.review_score, Some(78));
        assert_eq!(stats.community.replays, Some(6));
        assert!(stats.levels.single_player);
        assert!(!stats.levels.multiplayer);
        assert_eq!(stats.platform_stats.len(), 1);
        assert_eq!(stats.platform_stats[0].all_styles, Some(529744));
        assert_eq!(stats.related.len(), 1);
        assert_eq!(stats.review_histogram.len(), 3);
        assert_eq!(
            stats.image_url.as_deref(),
            Some("https://howlongtobeat.com/games/94122_Crimson_Desert.jpg")
        );
        assert_eq!(
            stats.url.as_deref(),
            Some("https://howlongtobeat.com/game/94122")
        );
    }

    #[test]
    fn missing_next_data_returns_none() {
        assert!(parse_next_data("<html><body>nope</body></html>").is_none());
        assert!(build_time_to_beat(None, None).is_none());
    }

    #[test]
    fn detail_without_times_is_rejected() {
        let html = r#"<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"game":{"data":{"game":[{"game_id":1,"game_name":"Empty","comp_main":0,"comp_plus":0,"comp_100":0,"comp_all":0}]}}}}}</script>"#;
        let parsed = parse_next_data(html).unwrap();
        assert!(build_time_to_beat(None, Some(&parsed)).is_none());
    }

    #[test]
    fn scoring_prefers_exact_and_penalises_dlc() {
        assert!(match_score("Elden Ring", "Elden Ring") > match_score("Elden Ring", "Elden Ring - Shadow of the Erdtree"));
        let game = SearchItem {
            game_id: 1,
            game_name: "Crimson Desert".into(),
            ..Default::default()
        };
        let dlc = SearchItem {
            game_id: 2,
            game_name: "Crimson Desert - Charting the Unknown".into(),
            game_type: Some("dlc".into()),
            ..Default::default()
        };
        let picked = pick_best("Crimson Desert", vec![dlc, game]).expect("match");
        assert_eq!(picked.game_id, 1);
        assert!(pick_best("Totally Unrelated Query", vec![]).is_none());
    }

    #[test]
    fn search_terms_strip_years_and_punctuation() {
        assert_eq!(search_terms("Prototype (2009)"), vec!["Prototype"]);
        assert_eq!(search_terms("Half-Life 2"), vec!["Half-Life", "2"]);
    }
}
