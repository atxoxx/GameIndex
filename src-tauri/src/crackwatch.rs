//! CrackWatch status service for gamestatus.info.
//!
//! Fetches crack status, crack date, DRM protection, and scene group
//! information by scraping gamestatus.info game pages. The site is a
//! Nuxt.js SPA with SSR, so game data is embedded in a
//! `<script id="__NUXT_DATA__" type="application/json">` payload.
//!
//! The service:
//! - A dedicated `CrackWatchServiceClass` struct owns the HTTP client(s);
//!   the singleton also keeps the Anubis auth cookie in its jar, so
//!   consecutive lookups skip the anti-bot gate.
//! - `get_status_by_title_and_app_id(title, app_id)` matches games by
//!   slug, verifying against the page's `steam_prod_id` when both an
//!   app id and a page value are available (the old code assumed the
//!   site didn't expose it — it does, on the per-game row).
//! - Results (including explicit "no data" negatives) are cached in the
//!   SQLite KV store with a 24h TTL, keyed by slug (+ app id when
//!   available).
//! - The returned `CrackWatchStatus` uses an `is_cracked` boolean rather
//!   than a string status, matching the frontend contract.
//!
//! Anti-bot gate: gamestatus.info runs Anubis proof-of-work, and in
//! 2026 the site moved to the time-based `metarefresh` challenge
//! (wait `difficulty * 800ms` after `issuedAt`, then echo the challenge
//! string to `pass-challenge`). The old SHA-256 `fast` PoW is kept as a
//! fallback for sites that still issue it.

use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::db::Db;
use tauri::Manager;

/// Parsed CrackWatch status from gamestatus.info.
///
/// An `is_cracked` boolean plus the supporting detail fields. `null` detail
/// fields mean "unknown" (the field simply isn't shown on the card).
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CrackWatchStatus {
    /// Whether the game has been cracked. Drives the CRACKED/UNCRACKED badge.
    pub is_cracked: bool,
    /// Crack date (YYYY-MM-DD) or null when uncracked / unknown.
    pub crack_date: Option<String>,
    /// Scene group or bypass method (e.g. "RUNE", "EMPRESS") or null.
    pub crack_group: Option<String>,
    /// DRM protection (e.g. "Denuvo", "STEAM") or null.
    pub protection: Option<String>,
}

/// Cache envelope stored in the KV store: the status plus a freshness stamp.
///
/// `status: None` is an explicit negative — the site was reachable but no
/// matching game exists. It's cached the same as a hit so failed names
/// (demo entries, non-games, slugs the site doesn't have) don't re-trigger
/// an Anubis-gated scrape on every render.
#[derive(Debug, Serialize, Deserialize, Clone)]
struct CachedCrackWatchStatus {
    status: Option<CrackWatchStatus>,
    /// Unix-millisecond timestamp of the cache write. Used for TTL checks.
    updated_at: u64,
}

/// 24-hour cache TTL.
const CACHE_TTL_MS: u64 = 1000 * 60 * 60 * 24;

/// KV key prefix for cached CrackWatch status.
const CACHE_KEY_PREFIX: &str = "crackwatch:";

fn cache_key(slug: &str, app_id: Option<&str>) -> String {
    match app_id {
        Some(id) => format!("{}{}:{}", CACHE_KEY_PREFIX, slug, id),
        None => format!("{}{}", CACHE_KEY_PREFIX, slug),
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Convert a game name into a URL-friendly slug matching gamestatus.info's patterns.
///
/// Handles common special cases (verified against live slugs in 2026):
/// - Apostrophes are removed (not replaced with hyphens): "Baldur's Gate 3" → `baldurs-gate-3`
/// - Trademark/copyright symbols are transliterated: ™ → tm, ® → r, © → c
/// - Roman numerals are kept as-is: "Hades II" → `hades-ii`, "Crusader Kings III" → `crusader-kings-iii`
/// - All other non-alphanumeric characters become hyphens; runs collapse
fn slugify(name: &str) -> String {
    let normalized = name
        .to_lowercase()
        .replace('\'', "")
        .replace('\u{2019}', "") // right single quotation mark (smart quote)
        .replace('™', "tm")
        .replace('®', "r")
        .replace('©', "c");

    normalized
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

/// Split a title into normalized slug tokens (lowercased, apostrophes removed).
fn normalize_tokens(name: &str) -> Vec<String> {
    slugify(name)
        .split('-')
        .map(str::to_string)
        .collect::<Vec<_>>()
}

/// Possessive publisher/corporate prefixes gamestatus.info drops from its
/// page titles ("Marvel's Spider-Man" is listed as "Spider-Man ...").
const STRIP_PREFIX_TOKENS: &[&str] = &["marvels", "sonys", "ubisofts", "eas"];

/// Edition/qualifier words that don't identify a game and are sometimes
/// omitted (or rearranged) in gamestatus.info page titles.
const EDITION_WORDS: &[&str] = &[
    "edition",
    "deluxe",
    "ultimate",
    "complete",
    "gold",
    "enhanced",
    "remastered",
    "remaster",
    "remake",
    "definitive",
    "anniversary",
    "collectors",
    "collector",
    "standard",
    "goty",
    "game-of-the-year",
    "premium",
    "digital",
];

/// Drop leading fillers ("the") and possessive publisher prefixes ("marvels").
fn strip_lead_ins(title: &str) -> String {
    let mut toks = normalize_tokens(title);
    while toks.first().map(String::as_str) == Some("the") {
        toks.remove(0);
    }
    if let Some(first) = toks.first().map(String::as_str) {
        if STRIP_PREFIX_TOKENS.contains(&first) {
            toks.remove(0);
        }
    }
    toks.join("-")
}

/// Drop edition/qualifier words that don't change which game this is.
fn strip_edition_words(title: &str) -> String {
    normalize_tokens(title)
        .into_iter()
        .filter(|t| !EDITION_WORDS.contains(&t.as_str()))
        .collect::<Vec<_>>()
        .join("-")
}

/// Ordered slug candidates for a title, most-specific first.
///
/// 1. Exact slug (matches the site's own URL convention).
/// 2. Lead-ins stripped — fixes "Marvel's Spider-Man Remastered" →
///    `spider-man-remastered` (the site's actual slug).
/// 3. Edition words also stripped — deepest fallback (only trusted when
///    the Steam app id can verify the page, or the title match is strong).
fn candidate_slugs(title: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut push = |s: String| {
        if !s.is_empty() && !out.contains(&s) {
            out.push(s);
        }
    };
    push(slugify(title));
    push(strip_lead_ins(title));
    push(strip_edition_words(&strip_lead_ins(title)));
    out.truncate(3);
    out
}

/// Whether two titles plausibly refer to the same game.
///
/// Token-set containment in either direction (input ⊆ page title or
/// page title ⊆ input), mirroring `game_scraper::lookup_steam_app_id`'s
/// word-containment rule. An empty token set on either side never matches.
fn is_strong_title_match(input: &str, page_title: &str) -> bool {
    let a = normalize_tokens(input);
    let b = normalize_tokens(page_title);
    if a.is_empty() || b.is_empty() {
        return false;
    }
    let subset = |x: &[String], y: &[String]| x.iter().all(|t| y.iter().any(|u| u == t));
    subset(&a, &b) || subset(&b, &a)
}

/// Resolve a Nuxt payload value (public entry point).
fn resolve_nuxt_ref(val: &Value, arr: &[Value]) -> Value {
    resolve_nuxt_ref_inner(val, arr, &mut HashMap::new())
}

/// Resolve a Nuxt payload value with a resolution cache.
///
/// Nuxt's `__NUXT_DATA__` uses a deduplication scheme where numeric
/// values in objects/arrays are indices into the top-level array.
/// This function recursively resolves those references into their
/// actual values.
///
/// Uses a `HashMap<usize, Value>` cache so that:
/// - Shared references (multiple fields pointing to the same index)
///   are resolved once and cached, allowing all fields to receive
///   the resolved value.
/// - Circular references are detected when an index appears in the
///   cache before its value has been fully resolved (a placeholder
///   `Value::Null` is inserted before recursing).
///
/// Nuxt also wraps data in marker arrays:
/// - `["ShallowReactive", idx]` / `["Reactive", idx]` — follow idx
/// - `["Set"]` — empty set, return empty array
/// - `["EmptyRef", "_"]` — null ref, return null
fn resolve_nuxt_ref_inner(val: &Value, arr: &[Value], cache: &mut HashMap<usize, Value>) -> Value {
    match val {
        Value::Number(n) => {
            if let Some(idx) = n.as_u64() {
                let i = idx as usize;
                if i < arr.len() {
                    // Already cached - return clone
                    if let Some(cached) = cache.get(&i) {
                        return cached.clone();
                    }
                    // Insert placeholder before recursing to detect cycles
                    cache.insert(i, Value::Null);
                    let resolved = resolve_nuxt_ref_inner(&arr[i], arr, cache);
                    cache.insert(i, resolved.clone());
                    return resolved;
                }
            }
            val.clone()
        }
        Value::Object(map) => {
            let mut resolved = serde_json::Map::new();
            for (k, v) in map {
                resolved.insert(k.clone(), resolve_nuxt_ref_inner(v, arr, cache));
            }
            Value::Object(resolved)
        }
        Value::Array(items) => {
            // Handle Nuxt wrapper arrays like ["ShallowReactive", idx]
            if let Some(first) = items.first().and_then(|v| v.as_str()) {
                match first {
                    "ShallowReactive" | "Reactive" => {
                        if let Some(second) = items.get(1) {
                            return resolve_nuxt_ref_inner(second, arr, cache);
                        }
                    }
                    "Set" => {
                        return Value::Array(vec![]);
                    }
                    "EmptyRef" => {
                        return Value::Null;
                    }
                    _ => {}
                }
            }
            Value::Array(
                items
                    .iter()
                    .map(|v| resolve_nuxt_ref_inner(v, arr, cache))
                    .collect(),
            )
        }
        _ => val.clone(),
    }
}

/// Extract a string field from a resolved game data object.
fn get_str(obj: &serde_json::Map<String, Value>, key: &str) -> Option<String> {
    obj.get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
}

/// Extract the content of `<script id="__NUXT_DATA__" type="application/json">`.
fn extract_nuxt_data(html: &str) -> Option<String> {
    let start_marker = "id=\"__NUXT_DATA__\"";
    let start = html.find(start_marker)?;
    // Find the closing `>` of the script tag after the id attribute
    let tag_end = html[start..].find('>')?;
    let content_start = start + tag_end + 1;

    let end = html[content_start..].find("</script>")?;
    Some(html[content_start..content_start + end].to_string())
}

/// The subset of a gamestatus.info game row the card needs.
struct GamePayload {
    title: String,
    steam_prod_id: Option<u64>,
    crack_date: Option<String>,
    protections: Option<String>,
    hacked_groups_en: Option<String>,
}

/// Parse a fetched game page into the fields we use.
///
/// Returns `None` when the HTML isn't a real game page (404 pages, the
/// Anubis challenge page, parse failures).
fn parse_game_payload(html: &str) -> Option<GamePayload> {
    let json_str = extract_nuxt_data(html)?;
    let arr: Vec<Value> = serde_json::from_str(&json_str).ok()?;
    if arr.len() < 2 {
        return None;
    }

    // arr[1] is the main payload object with a "data" key
    let payload = arr[1].as_object()?;
    let data_ref = payload.get("data")?;
    let data_obj = resolve_nuxt_ref(data_ref, &arr);
    let data_map = data_obj.as_object()?;

    // Find the first key matching "game-*-en"
    let game_key = data_map
        .keys()
        .find(|k| k.starts_with("game-") && k.ends_with("-en"));
    let game_val = game_key.and_then(|k| data_map.get(k))?;

    let game_obj = resolve_nuxt_ref(game_val, &arr);
    let game = game_obj.as_object()?;

    let title = get_str(game, "title")?;

    // `steam_prod_id` is present on the per-game row (sometimes as a
    // number, occasionally as a stringified number). It's `null` for
    // games without a Steam product (DRM-free originals etc.).
    let steam_prod_id = game.get("steam_prod_id").and_then(|v| match v {
        Value::Number(n) => n.as_u64(),
        Value::String(s) => s.trim().parse::<u64>().ok(),
        _ => None,
    });

    Some(GamePayload {
        title,
        steam_prod_id,
        crack_date: get_str(game, "crack_date"),
        protections: get_str(game, "protections"),
        hacked_groups_en: get_str(game, "hacked_groups_en"),
    })
}

fn status_from_payload(p: &GamePayload) -> CrackWatchStatus {
    let scene_group = p.hacked_groups_en.as_deref().map(|s| {
        s.split(" — ")
            .next()
            .unwrap_or(s)
            .trim()
            .to_string()
    });
    CrackWatchStatus {
        is_cracked: p.crack_date.is_some(),
        crack_date: p.crack_date.clone(),
        crack_group: scene_group,
        protection: p.protections.clone(),
    }
}

/// Parsed Anubis challenge payload (`<script id="anubis_challenge">`).
#[derive(Debug, Deserialize)]
struct AnubisChallenge {
    #[serde(default)]
    rules: AnubisRules,
    challenge: AnubisChallengeInner,
}

#[derive(Debug, Deserialize, Default)]
struct AnubisRules {
    #[serde(default)]
    algorithm: Option<String>,
    #[serde(default)]
    difficulty: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct AnubisChallengeInner {
    id: String,
    #[serde(rename = "randomData")]
    random_data: String,
    #[serde(rename = "issuedAt")]
    #[serde(default)]
    issued_at: Option<String>,
    #[serde(default)]
    method: Option<String>,
    #[serde(default)]
    difficulty: Option<u64>,
}

/// Outcome of a look-up attempt — distinguishes "site said no such game"
/// (cachable) from "site couldn't be reached" (don't cache, don't guess).
#[derive(Debug)]
enum LookupOutcome {
    Found(CrackWatchStatus),
    NotFound,
    Unavailable,
}

/// Dedicated CrackWatch service.
struct CrackWatchServiceClass {
    /// Normal page-fetch client (follows redirects).
    client: reqwest::Client,
    /// No-redirect client used for the Anubis `pass-challenge` call, so a
    /// 302 (cookie granted) is observable even when the redirect target
    /// (an invalid slug) would 404.
    pass_client: reqwest::Client,
}

impl CrackWatchServiceClass {
    fn new() -> Self {
        // A cookie jar is required: gamestatus.info sits behind the "Anubis"
        // proof-of-work anti-bot gate. Solving the challenge yields a session
        // cookie that must be presented on the follow-up page fetch. Both
        // clients share the jar so the pass call sees the verification
        // cookie and the auth cookie set by the pass response.
        let jar = std::sync::Arc::new(reqwest::cookie::Jar::default());
        let client = reqwest::Client::builder()
            .user_agent(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            )
            .timeout(std::time::Duration::from_secs(20))
            .cookie_provider(jar.clone())
            .build()
            .expect("failed to build CrackWatch HTTP client");
        let pass_client = reqwest::Client::builder()
            .user_agent(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            )
            .timeout(std::time::Duration::from_secs(20))
            .cookie_provider(jar)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("failed to build CrackWatch pass client");
        Self { client, pass_client }
    }

    /// Look up crack status for a game by title (and optionally Steam app id).
    ///
    /// Tries progressively looser slug candidates (exact → lead-ins
    /// stripped → editions stripped) and accepts a page only when the
    /// Steam app id matches or the titles align.
    async fn get_status_by_title_and_app_id(
        &self,
        title: &str,
        app_id: Option<&str>,
    ) -> LookupOutcome {
        let appid = app_id.and_then(|a| a.trim().parse::<u64>().ok());

        for slug in candidate_slugs(title) {
            let page_url = format!("https://gamestatus.info/{}/en", slug);

            // Fetch the page, transparently solving the Anubis gate if the
            // site presents one. Returns the SSR HTML containing the
            // `__NUXT_DATA__` payload.
            let html = match self.fetch_page_html(&page_url).await {
                Some(h) => h,
                // Gate/network failure — don't guess, don't cache a negative.
                None => return LookupOutcome::Unavailable,
            };

            let Some(payload) = parse_game_payload(&html) else {
                // Not a game page (404 etc.) — try the next candidate.
                continue;
            };

            // Steam app id is the strongest signal when the page exposes one.
            if let (Some(want), Some(got)) = (appid, payload.steam_prod_id) {
                if want == got {
                    return LookupOutcome::Found(status_from_payload(&payload));
                }
                // The slug resolved to a *different* game — keep looking.
                continue;
            }

            if is_strong_title_match(title, &payload.title) {
                return LookupOutcome::Found(status_from_payload(&payload));
            }
        }

        LookupOutcome::NotFound
    }

    /// Fetch a gamestatus.info page, transparently solving the Anubis
    /// anti-bot gate when it's presented.
    ///
    /// Returns the SSR HTML (which embeds the `__NUXT_DATA__` payload).
    /// Returns `None` on network/parse failure or if the challenge can't
    /// be solved.
    async fn fetch_page_html(&self, page_url: &str) -> Option<String> {
        let resp = self.client.get(page_url).send().await.ok()?;
        let html = resp.text().await.ok()?;

        // Not gated — return the real page directly.
        if !html.contains("anubis_challenge") {
            return Some(html);
        }

        // Gated: solve the challenge, redeem the session cookie, retry.
        let solved = self.solve_gate(&html, page_url).await?;
        if !solved {
            return None;
        }

        let resp2 = self.client.get(page_url).send().await.ok()?;
        resp2.text().await.ok()
    }

    /// Parse the Anubis challenge embedded in a bot-check page and solve it
    /// with the algorithm the site issued:
    ///
    /// - `metarefresh` (current): wait `difficulty * 800ms` after
    ///   `issuedAt`, then GET `pass-challenge` echoing the challenge string.
    /// - `fast`/`slow` (legacy): brute-force a SHA-256 proof of work.
    ///
    /// Returns `Some(true)` on success, `Some(false)` if the challenge
    /// couldn't be solved, `None` on submission failure.
    async fn solve_gate(&self, html: &str, page_url: &str) -> Option<bool> {
        let marker = "id=\"anubis_challenge\" type=\"application/json\">";
        let start = html.find(marker)?;
        let content_start = start + marker.len();
        let end = html[content_start..].find("</script>")?;
        let json = &html[content_start..content_start + end];

        let ch: AnubisChallenge = serde_json::from_str(json).ok()?;

        let algorithm = ch
            .rules
            .algorithm
            .as_deref()
            .or(ch.challenge.method.as_deref())
            .unwrap_or("fast");

        match algorithm {
            "metarefresh" => self.solve_metarefresh(&ch, page_url).await,
            _ => self.solve_pow_fast(&ch, page_url).await,
        }
    }

    /// Solve the current Anubis `metarefresh` challenge: wait out the
    /// time gate, then submit the challenge string to `pass-challenge`.
    ///
    /// The server only accepts the submission once
    /// `issuedAt + difficulty * 800ms` has elapsed, so we sleep until then
    /// (with a small buffer for clock skew) before calling the endpoint.
    async fn solve_metarefresh(&self, ch: &AnubisChallenge, page_url: &str) -> Option<bool> {
        let difficulty = ch
            .rules
            .difficulty
            .or(ch.challenge.difficulty)
            .unwrap_or(1);

        let wait_ms = match ch.challenge.issued_at.as_deref() {
            Some(issued) => {
                let issued_utc = chrono::DateTime::parse_from_rfc3339(issued)
                    .ok()
                    .map(|dt| dt.with_timezone(&chrono::Utc));
                match issued_utc {
                    Some(issued_utc) => {
                        let want = issued_utc
                            + chrono::Duration::milliseconds(difficulty as i64 * 800);
                        let remaining = (want - chrono::Utc::now()).num_milliseconds();
                        remaining.max(0) as u64 + 1000 // 1s buffer for clock skew
                    }
                    None => difficulty * 800 + 1000,
                }
            }
            None => difficulty * 800 + 1000,
        };
        tokio::time::sleep(std::time::Duration::from_millis(wait_ms)).await;

        let pass_url = format!(
            "https://gamestatus.info/.within.website/x/cmd/anubis/api/pass-challenge?redir={}&challenge={}&id={}",
            urlencoding::encode(page_url),
            ch.challenge.random_data,
            ch.challenge.id
        );

        let resp = self.pass_client.get(&pass_url).send().await.ok()?;
        // A 200 (cookie set) or a 302 redirect to the target both count.
        Some(resp.status().is_success() || resp.status().is_redirection())
    }

    /// Solve a legacy Anubis `fast`/`slow` SHA-256 proof-of-work challenge.
    async fn solve_pow_fast(&self, ch: &AnubisChallenge, page_url: &str) -> Option<bool> {
        let difficulty = ch
            .rules
            .difficulty
            .or(ch.challenge.difficulty)
            .unwrap_or(4) as usize;

        let (nonce, hash) = solve_pow(&ch.challenge.random_data, difficulty)?;

        let pass_url = format!(
            "https://gamestatus.info/.within.website/x/cmd/anubis/api/pass-challenge?id={}&response={}&nonce={}&redir={}&elapsedTime=1234",
            ch.challenge.id, hash, nonce, urlencoding::encode(page_url)
        );

        let resp = self.pass_client.get(&pass_url).send().await.ok()?;
        Some(resp.status().is_success() || resp.status().is_redirection())
    }
}

/// Solve an Anubis "fast" proof-of-work challenge.
///
/// The worker hashes `random_data + nonce` (as UTF-8 bytes) with SHA-256.
/// The digest is valid when its leading `difficulty / 2` bytes are zero, and
/// — when `difficulty` is odd — the high nibble of the next byte is also zero.
/// `difficulty` is small (typically 2–4), so brute force is trivial.
fn solve_pow(random_data: &str, difficulty: usize) -> Option<(u64, String)> {
    let zero_bytes = difficulty / 2;
    let odd = difficulty % 2 != 0;

    for nonce in 0u64..50_000_000 {
        let input = format!("{}{}", random_data, nonce);
        let digest = Sha256::digest(input.as_bytes());
        let mut ok = digest[..zero_bytes].iter().all(|b| *b == 0);
        if ok && odd && (digest[zero_bytes] & 0xF0) != 0 {
            ok = false;
        }
        if ok {
            let hash = digest.iter().map(|b| format!("{:02x}", b)).collect();
            return Some((nonce, hash));
        }
    }
    None
}

/// Process-wide singleton.
static CRACKWATCH_SERVICE: std::sync::OnceLock<CrackWatchServiceClass> = std::sync::OnceLock::new();

fn service() -> &'static CrackWatchServiceClass {
    CRACKWATCH_SERVICE.get_or_init(CrackWatchServiceClass::new)
}

/// Persist a lookup result (positive or negative) in the KV cache.
fn persist_status(db: &Db, key: &str, status: Option<&CrackWatchStatus>) {
    let envelope = CachedCrackWatchStatus {
        status: status.cloned(),
        updated_at: now_ms(),
    };
    if let Ok(json) = serde_json::to_string(&envelope) {
        if let Err(e) = crate::db::kv::set(db, key, &json) {
            eprintln!("[crackwatch] cache write failed for {key}: {e}");
        }
    }
}

/// Fetch CrackWatch status for a game from gamestatus.info.
///
/// The status is cached in the KV store keyed by slug (and app id when
/// available) with a 24h TTL, so the same game isn't re-scraped on every
/// page render. A fresh cache hit returns immediately; a miss (or expired
/// entry) triggers a scrape and writes the result back — including an
/// explicit negative, so names the site doesn't have stop being re-scraped.
/// `None` is returned when the title couldn't be resolved, signalling the
/// frontend to hide the card.
#[tauri::command]
pub async fn fetch_crackwatch_status(
    app: tauri::AppHandle,
    game_name: String,
    app_id: Option<String>,
) -> Option<CrackWatchStatus> {
    let slug = slugify(&game_name);
    if slug.is_empty() {
        return None;
    }

    let app_id_str = app_id.as_deref();
    let key = cache_key(&slug, app_id_str);

    let db_state: tauri::State<'_, Db> = app.state();

    // ── Cache lookup ──────────────────────────────────────────────
    if let Some(raw) = crate::db::kv::get(db_state.inner(), &key).ok().flatten() {
        if let Ok(cached) = serde_json::from_str::<CachedCrackWatchStatus>(&raw) {
            if cached.updated_at + CACHE_TTL_MS > now_ms() {
                return cached.status;
            }
        }
    }

    // ── Cache miss / expired → scrape ────────────────────────────
    let outcome = service()
        .get_status_by_title_and_app_id(&game_name, app_id_str)
        .await;

    match outcome {
        LookupOutcome::Found(status) => {
            persist_status(db_state.inner(), &key, Some(&status));
            Some(status)
        }
        LookupOutcome::NotFound => {
            // Negative cache — don't re-scrape a name the site has no page for.
            persist_status(db_state.inner(), &key, None);
            None
        }
        LookupOutcome::Unavailable => None,
    }
}

/// Batch variant of [`fetch_crackwatch_status`]. Accepts a list of game
/// names and returns a `{ name -> status }` map (only entries with a
/// resolved status are included). This exists so a store grid of 20 cards
/// makes a single Tauri round-trip instead of 20 concurrent invokes — the
/// per-card self-fetch pattern was a real rate-limit / connection-pool
/// risk against gamestatus.info's anti-bot gate.
///
/// Cache lookups happen per-name (same 24h TTL and KV keys as the single
/// command), so warm names return instantly. Cold names are scraped
/// sequentially with a small concurrency cap to stay polite; resolved
/// negatives are cached so they don't resurface on the next render.
#[tauri::command]
pub async fn fetch_crackwatch_status_batch(
    app: tauri::AppHandle,
    game_names: Vec<String>,
) -> HashMap<String, CrackWatchStatus> {
    use futures::stream::{self, StreamExt};

    // Cap concurrency so we never fan out 20 gated scrapes at once.
    const MAX_CONCURRENT: usize = 3;

    let db_state: tauri::State<'_, Db> = app.state();

    // Split into cache hits (resolved synchronously) and cold names.
    let mut resolved: HashMap<String, CrackWatchStatus> = HashMap::new();
    let mut cold: Vec<String> = Vec::new();

    for name in game_names {
        let slug = slugify(&name);
        if slug.is_empty() {
            continue;
        }
        let key = cache_key(&slug, None);
        if let Some(raw) = crate::db::kv::get(db_state.inner(), &key).ok().flatten() {
            if let Ok(cached) = serde_json::from_str::<CachedCrackWatchStatus>(&raw) {
                if cached.updated_at + CACHE_TTL_MS > now_ms() {
                    if let Some(status) = cached.status {
                        resolved.insert(name, status);
                    }
                    continue;
                }
            }
        }
        cold.push(name);
    }

    // Scrape cold names with bounded concurrency, then persist each result.
    let scraped: Vec<(String, LookupOutcome)> = stream::iter(cold)
        .map(|name| async move {
            let outcome = service()
                .get_status_by_title_and_app_id(&name, None)
                .await;
            (name, outcome)
        })
        .buffer_unordered(MAX_CONCURRENT)
        .collect()
        .await;

    for (name, outcome) in scraped {
        let slug = slugify(&name);
        let key = cache_key(&slug, None);
        match outcome {
            LookupOutcome::Found(status) => {
                persist_status(db_state.inner(), &key, Some(&status));
                resolved.insert(name, status);
            }
            LookupOutcome::NotFound => {
                persist_status(db_state.inner(), &key, None);
            }
            LookupOutcome::Unavailable => {}
        }
    }

    resolved
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Test slug generation for known gamestatus.info game slugs.
    #[test]
    fn test_slugify_accuracy() {
        let cases = vec![
            ("Cyberpunk 2077", "cyberpunk-2077"),
            (
                "Assassin's Creed Black Flag Resynced",
                "assassins-creed-black-flag-resynced",
            ),
            (
                "EA SPORTS™ College Football 27",
                "ea-sportstm-college-football-27",
            ),
            (
                "Monopoly: Star Wars™ Heroes vs. Villains",
                "monopoly-star-warstm-heroes-vs-villains",
            ),
            ("007 First Light", "007-first-light"),
            ("Forza Horizon 6", "forza-horizon-6"),
            // Roman numerals are kept — verified against live slugs.
            ("Hades II", "hades-ii"),
            ("Crusader Kings III", "crusader-kings-iii"),
        ];
        for (input, expected) in cases {
            let got = slugify(input);
            assert_eq!(
                got, expected,
                "slugify(\"{}\") = \"{}\", expected \"{}\"",
                input, got, expected
            );
        }
    }

    /// Test that loose-title candidates are generated in the right order.
    #[test]
    fn test_candidate_slugs() {
        // "Marvel's Spider-Man Remastered" is listed on the site as
        // "Spider-Man Remastered" — exact slug 404s, lead-ins-stripped hits.
        let c = candidate_slugs("Marvel's Spider-Man Remastered");
        assert_eq!(
            c,
            vec![
                "marvels-spider-man-remastered",
                "spider-man-remastered",
                "spider-man"
            ]
        );

        // Plain names only produce the exact slug (deduped).
        let c = candidate_slugs("Elden Ring");
        assert_eq!(c, vec!["elden-ring"]);

        // Leading "the" is dropped in the fallbacks.
        let c = candidate_slugs("The Witcher 3: Wild Hunt");
        assert_eq!(c, vec!["the-witcher-3-wild-hunt", "witcher-3-wild-hunt"]);

        // Editions survive in the first fallback, are stripped in the last.
        let c = candidate_slugs("God of War Ragnarök Deluxe Edition");
        assert_eq!(c.last().unwrap(), "god-of-war-ragnarok");
    }

    #[test]
    fn test_strong_title_match() {
        assert!(is_strong_title_match("Cyberpunk 2077", "Cyberpunk 2077"));
        // Sub-edition: input is a superset of the page title.
        assert!(is_strong_title_match(
            "Marvel's Spider-Man Remastered",
            "Spider-Man Remastered"
        ));
        // Input is a subset of the page title.
        assert!(is_strong_title_match("Hades", "Hades II"));
        // Unrelated games never match.
        assert!(!is_strong_title_match("Cyberpunk 2077", "Elden Ring"));
        // Empty token sets never match (guards against short junk names).
        assert!(!is_strong_title_match("!!!", "Elden Ring"));
    }

    /// Test parsing the Anubis challenge JSON as served by gamestatus.info.
    #[test]
    fn test_parse_anubis_challenge() {
        let json = r#"{
            "rules": {"algorithm": "metarefresh", "difficulty": 1},
            "challenge": {
                "issuedAt": "2026-08-31T21:31:08.924892922Z",
                "id": "01a059bb-b4fc-7d7a-b84d-cb3ca414d57c",
                "method": "metarefresh",
                "randomData": "37e6fa88e3e68895b29c9704475306aaaeb63c10b4c38fab59b8c9799722e7bf",
                "policyRuleHash": "ac980f49c4d35fab",
                "difficulty": 1,
                "spent": false
            }
        }"#;
        let ch: AnubisChallenge = serde_json::from_str(json).expect("challenge parses");
        assert_eq!(ch.rules.algorithm.as_deref(), Some("metarefresh"));
        assert_eq!(ch.rules.difficulty, Some(1));
        assert_eq!(ch.challenge.id, "01a059bb-b4fc-7d7a-b84d-cb3ca414d57c");
        assert!(ch.challenge.issued_at.is_some());
        assert_eq!(
            ch.challenge.method.as_deref(),
            Some("metarefresh"),
            "method should default to the fast PoW when absent"
        );
    }

    #[test]
    fn test_parse_anubis_challenge_defaults_to_fast() {
        // Legacy servers omit `rules.algorithm`; the solver falls back.
        let json = r#"{
            "rules": {"difficulty": 4},
            "challenge": {
                "id": "abc",
                "randomData": "deadbeef",
                "spent": false
            }
        }"#;
        let ch: AnubisChallenge = serde_json::from_str(json).expect("challenge parses");
        assert_eq!(ch.rules.algorithm, None);
        assert_eq!(ch.challenge.difficulty, None);
        assert_eq!(ch.challenge.method, None);
    }

    /// Cache envelope must round-trip a positive and a negative entry.
    #[test]
    fn test_cache_envelope_roundtrip() {
        let pos = CachedCrackWatchStatus {
            status: Some(CrackWatchStatus {
                is_cracked: true,
                crack_date: Some("2026-07-09".into()),
                crack_group: Some("RUNE".into()),
                protection: Some("Denuvo".into()),
            }),
            updated_at: 1234,
        };
        let json = serde_json::to_string(&pos).unwrap();
        let back: CachedCrackWatchStatus = serde_json::from_str(&json).unwrap();
        assert!(back.status.is_some());
        assert_eq!(back.status.unwrap().crack_group.as_deref(), Some("RUNE"));

        let neg = CachedCrackWatchStatus {
            status: None,
            updated_at: 5678,
        };
        let json = serde_json::to_string(&neg).unwrap();
        let back: CachedCrackWatchStatus = serde_json::from_str(&json).unwrap();
        assert!(back.status.is_none());
    }

    /// Test a well-known cracked game to verify scrape + parse + gate.
    #[tokio::test]
    async fn test_cyberpunk_2077_crackwatch() {
        let result = service()
            .get_status_by_title_and_app_id("Cyberpunk 2077", None)
            .await;
        println!("Cyberpunk 2077 => {:?}", result);
        let LookupOutcome::Found(status) = result else {
            panic!("Expected a crack status for Cyberpunk 2077");
        };
        assert!(status.is_cracked, "Expected Cyberpunk 2077 to be cracked");
    }

    /// Test a Denuvo-protected game to verify scene group extraction.
    #[tokio::test]
    async fn test_denuvo_game() {
        let result = service()
            .get_status_by_title_and_app_id("Assassin's Creed Black Flag Resynced", None)
            .await;
        println!("Assassin's Creed => {:?}", result);
        let LookupOutcome::Found(status) = result else {
            panic!("Expected crack status for Assassin's Creed");
        };
        assert!(
            status.crack_group.is_some(),
            "Expected scene group for a Denuvo game"
        );
    }
}