//! Source link management for the download feature.
//!
//! "Sources" are JSON files hosted on a third-party URL that list
//! available downloads for various games. The most common shape is
//! a single object with a `name` and a
//! `downloads` array, where each entry has `title`, `fileSize`,
//! magnet / .torrent URIs, and `uploadDate`.
//!
//! ## Persistence (Phase 2 of the storage-migration plan)
//!
//! `<app_data_dir>/sources.json` and `<app_data_dir>/sources_cache/{id}.json`
//! are gone. Source metadata now lives in the `sources` SQLite
//! table; cached payload blobs live in `sources_cache`; every
//! download title is its own row in `downloads` and is mirrored
//! into the FTS5 virtual table `downloads_fts` by SQL triggers.
//!
//! The local fuzzy search (`source_manager::search`) now hits that
//! FTS5 index with `bm25` ranking — sub-millisecond on catalogs in
//! the six-figure-title range, where the old in-memory
//! O(N)-over-titles scan took hundreds of milliseconds and
//! consumed tens of MB of `HashMap` memory at startup.
//!
//! ## Concurrency
//!
//! `SourceManager` no longer needs a `tokio::sync::Mutex` — the
//! underlying SQLite pool serialises one writer at a time and
//! concurrent readers are cheap. The Tauri `State` binding has
//! changed from `Arc<tokio::sync::Mutex<SourceManager>>` to
//! `Arc<SourceManager>`. Each method takes `&self` (read paths) or
//! `&mut self` only where a `reqwest::Client::post(...).send()`
//! forces it (the client itself is `Send + !Sync`-friendly when
//! borrowed by `&self` for a single request).
//!
//! All public signatures (`SourceLink`, `CachedSource`,
//! `GameSource`, `SourceDownload`, `MatchedDownload`,
//! etc.) are unchanged so
//! the frontend can keep its existing types in
//! `src/types/source.ts` and the Tauri command names are
//! unchanged in `lib.rs`.

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use unicode_normalization::UnicodeNormalization;

use crate::db::{self, Db};

// ─── JSON schema ────────────────────────────────────────────────────────────

/// A single download entry inside a source.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SourceDownload {
    pub title: String,
    #[serde(default, alias = "filesize", alias = "file_size")]
    pub file_size: String,
    /// Magnet links, .torrent URLs, or both. Treated as opaque
    /// URIs by this module — `torrent_engine` validates the scheme
    /// before handing off.
    #[serde(default)]
    pub uris: Vec<String>,
    #[serde(default, alias = "uploaddate", alias = "upload_date")]
    pub upload_date: Option<String>,
    /// Optional pre-parsed magnet — some sources populate
    /// this as a convenience for clients that can't parse a magnet
    /// URI themselves. We use it as a fallback when the `uris`
    /// array is missing or empty.
    #[serde(default)]
    pub magnet: Option<String>,
}

/// A full source: name + a list of downloads.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GameSource {
    pub name: String,
    pub downloads: Vec<SourceDownload>,
}

// ─── User-facing records ────────────────────────────────────────────────────

/// Metadata for a single source the user has added. Persisted to
/// the `sources` SQLite table.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SourceLink {
    pub id: String,
    pub url: String,
    pub name: String,
    pub enabled: bool,
    /// Unix seconds of the last successful fetch, or `None` if
    /// the source has never been fetched.
    pub last_fetched: Option<u64>,
    /// Number of download entries in the most recent successful
    /// fetch.
    pub game_count: usize,
}

/// Cached source payload. Persisted to the `sources_cache`
/// SQLite table (compact JSON of `GameSource`).
///
/// Reserved type — the DAO in `db::sources::read_cached_source`
/// constructs it on read, but no Rust caller today consumes that
/// path (the planned `SourceContext` migration will). Kept
/// exported so the upcoming migration can attach the cache
/// alongside `SourceLink` metadata without a type-shape change.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct CachedSource {
    pub source_id: String,
    pub data: GameSource,
    /// Unix seconds of when this was fetched.
    pub fetched_at: u64,
}

/// A single failed URL from a bulk add, with the error message.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BulkAddError {
    pub url: String,
    pub error: String,
}

/// Aggregated result of a bulk source add. Lets the frontend show a
/// summary ("added N, skipped M, failed K") instead of failing the
/// whole batch on a single bad link.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BulkAddResult {
    pub added: Vec<SourceLink>,
    pub skipped: Vec<String>,
    pub failed: Vec<BulkAddError>,
}

/// A matched download for the DownloadModal. The frontend renders
/// these directly; `match_score` is a 0–1 value the UI uses to
/// sort / dim sub-matches.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MatchedDownload {
    pub source_name: String,
    pub source_id: String,
    pub title: String,
    pub file_size: String,
    pub uris: Vec<String>,
    /// Resolved magnet URI (if the source provided one explicitly,
    /// OR if we found a `magnet:` URI inside the `uris` array).
    pub magnet: Option<String>,
    pub upload_date: Option<String>,
    /// 0.0 (no match) – 1.0 (perfect match). The FTS5 `bm25`
    /// ranker returns a negative value (more negative = closer
    /// match); we map to [0, 1] for the frontend.
    pub match_score: f32,
    /// True when the owning source was first fetched (added) within
    /// the last `NEW_SOURCE_WINDOW_SECS` seconds. Frontend shows a
    /// stylised "NEW" badge so freshly-added sources stand out.
    pub is_new: bool,
}

// ─── SourceManager ──────────────────────────────────────────────────────────

pub struct SourceManager {
    db: Db,
    /// Shared HTTP client. Cheap to clone; we hold one for the
    /// lifetime of the app.
    client: reqwest::Client,
}

impl SourceManager {
    /// Build the manager. The DB must already be open (Phase 1's
    /// `db::init` does this).
    pub fn new(db: Db) -> Self {
        Self {
            db,
            client: reqwest::Client::builder()
                .user_agent("GameIndex/1.0")
                .timeout(std::time::Duration::from_secs(15))
                .build()
                .expect("HTTP client build is infallible with these settings"),
        }
    }

    // ── Public API ─────────────────────────────────────────────────────

    /// Add a new source. Fetches and parses the source JSON locally,
    /// persists the metadata, and returns the new `SourceLink`.
    pub async fn add_source(
        &self,
        url: String,
        name: String,
    ) -> Result<SourceLink, String> {
        let trimmed = url.trim().to_string();
        if trimmed.is_empty() {
            return Err("Source URL is empty".to_string());
        }
        if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
            return Err("Source URL must start with http:// or https://".to_string());
        }
        if self.url_exists(&trimmed)? {
            return Err("This source URL has already been added".to_string());
        }

        // Fetch and parse the raw source JSON. A failure here (HTTP 403,
        // Cloudflare challenge, malformed JSON) surfaces to the caller so
        // the UI can explain why the source couldn't be added.
        let game_source = self.fetch_source_json(&trimmed).await?;

        let now_secs = unix_now();
        let local_id = format!("src_{}_{}", unix_now_nanos(), SOURCE_ID_COUNTER.fetch_add(1, Ordering::Relaxed));
        let display_name = if name.trim().is_empty() {
            derive_name_from_url(&trimmed)
        } else {
            name.trim().to_string()
        };

        let source = SourceLink {
            id: local_id.clone(),
            url: trimmed.clone(),
            name: display_name.clone(),
            enabled: true,
            last_fetched: Some(now_secs),
            game_count: game_source.downloads.len(),
        };
        db::sources::upsert_source(&self.db, &source)?;

        // Cache the payload (also writes into downloads_fts).
        let game_count = db::sources::commit_cached_source(
            &self.db,
            &local_id,
            &game_source,
            now_secs,
        )?;

        Ok(SourceLink {
            id: local_id,
            url: trimmed,
            name: display_name,
            enabled: true,
            last_fetched: Some(now_secs),
            game_count,
        })
    }

    /// Add multiple sources at once. Each URL is
    /// processed independently; failures are reported per-URL so a
    /// single bad link doesn't abort the whole batch. Already-added
    /// URLs (duplicate) are reported as skipped rather than errored.
    pub async fn add_sources_bulk(
        &self,
        urls: Vec<String>,
        names: Vec<String>,
    ) -> Result<BulkAddResult, String> {
        let mut added: Vec<SourceLink> = Vec::new();
        let mut skipped: Vec<String> = Vec::new();
        let mut failed: Vec<BulkAddError> = Vec::new();

        for (i, raw_url) in urls.into_iter().enumerate() {
            let url = raw_url.trim().to_string();
            if url.is_empty() {
                continue;
            }
            let name = names.get(i).cloned().unwrap_or_default();
            let url_clone = url.clone();
            match self.add_source(url, name).await {
                Ok(source) => added.push(source),
                Err(e) => {
                    if e.contains("already been added") {
                        skipped.push(url_clone);
                    } else {
                        failed.push(BulkAddError { url: url_clone, error: e });
                    }
                }
            }
        }

        Ok(BulkAddResult {
            added,
            skipped,
            failed,
        })
    }

    /// Remove a source by id. Idempotent — returns Ok even if the
    /// id never existed, so the frontend can be optimistic.
    pub fn remove_source(&self, id: &str) -> Result<(), String> {
        db::sources::remove_source(&self.db, id)
    }

    /// Toggle a source's enabled flag.
    pub fn toggle_source(&self, id: &str) -> Result<(), String> {
        db::sources::toggle_source(&self.db, id)
    }

    /// Snapshot of the current source list.
    pub fn list_sources(&self) -> Result<Vec<SourceLink>, String> {
        db::sources::list_sources(&self.db)
    }

    /// Snapshot of the current source list, optionally with each
    /// source's cached payload. Cheap because `read_cached_source`
    /// is a single indexed SELECT.
    ///
    /// Reserved public method — the planned `SourceContext`
    /// warm-start path is the future caller; today the frontend
    /// keeps its own copy. Silence the dead-code lint while the
    /// API surface stabilises.
    #[allow(dead_code)]
    pub fn list_sources_with_cache(
        &self,
    ) -> Result<Vec<(SourceLink, Option<CachedSource>)>, String> {
        db::sources::list_sources_with_cache(&self.db)
    }

    /// Refresh one source.
    pub async fn refresh_source(&self, id: &str) -> Result<(), String> {
        self.refresh_source_inner(id, false).await
    }

    /// Refresh every enabled source.
    pub async fn refresh_all(&self) -> Result<(), String> {
        self.refresh_all_inner().await
    }

    /// FTS5-backed offline search. Crucially this is now a single
    /// `MATCH ... ORDER BY bm25(downloads_fts) LIMIT N` query — the
    /// in-memory `score_match` O(N) scan is gone.
    ///
    /// bm25 only guarantees the *best within the indexed corpus*; it
    /// does not know whether that best hit is actually the game the
    /// user clicked. After fetching the bm25-ranked candidates we
    /// re-score each title against the *normalised* query with
    /// [`title_similarity`] and drop any that fall below a
    /// confidence floor — this is what stops "search for X, get an
    /// unrelated-but-similar Y" from ever reaching the modal.
    pub fn search(&self, query: &str) -> Vec<MatchedDownload> {
        let q = query.trim();
        if q.is_empty() {
            return Vec::new();
        }
        // Pull a large candidate pool from FTS5 before re-scoring.
        // Game download titles are highly variable (editions, scene
        // tags, "name.name" link stems, subtitles), so the bm25 pass
        // must surface many candidates and let `title_similarity`
        // rank them rather than hard-dropping most of them.
        match db::sources::search(&self.db, q, 200) {
            Ok(results) => {
                let filtered: Vec<MatchedDownload> = results
                    .into_iter()
                    .map(|mut m| {
                        // Re-score against the real query (bm25's raw
                        // value has no absolute scale and cannot tell a
                        // 0.4 match from a 0.9 match on its own).
                        m.match_score = title_similarity(q, &m.title);
                        m
                    })
                    // Lower floor (0.2) keeps variable-but-relevant
                    // names while still dropping unrelated noise.
                    .filter(|m| m.match_score >= 0.2)
                    .collect();
                // Keep a stable, similarity-sorted order (highest
                // confidence first). rescale_scores is intentionally
                // NOT used here: it would re-inflate a single weak hit
                // to 0.5 and mislabel it as "Good match".
                let mut out = filtered;
                out.sort_by(|a, b| {
                    b.match_score
                        .partial_cmp(&a.match_score)
                        .unwrap_or(std::cmp::Ordering::Equal)
                });
                out
            }
            Err(e) => {
                eprintln!("[source_manager] FTS search failed: {e}");
                Vec::new()
            }
        }
    }

    /// Search every enabled source's cached downloads via the local FTS5
    /// index. `steam_app_id` is accepted for command-signature
    /// compatibility but unused — the local index is the single source
    /// of truth for matching.
    pub async fn search_online(
        &self,
        query: &str,
        _steam_app_id: Option<u32>,
    ) -> Result<Vec<MatchedDownload>, String> {
        Ok(self.search(query))
    }

    // ── Refresh helpers (private) ─────────────────────────────────────

    async fn refresh_source_inner(
        &self,
        id: &str,
        is_bulk: bool,
    ) -> Result<(), String> {
        let sources = db::sources::list_sources(&self.db)?;
        let Some(source) = sources.iter().find(|s| s.id == id).cloned() else {
            return Err(format!("Source not found: {id}"));
        };
        let now = unix_now();

        // Direct fetch from the source URL.
        match self.fetch_source_json(&source.url).await {
            Ok(game_source) => {
                db::sources::commit_cached_source(
                    &self.db,
                    &source.id,
                    &game_source,
                    now,
                )?;
                Ok(())
            }
            Err(e) => {
                if is_bulk {
                    eprintln!(
                        "[source_manager] refresh {} failed: {e}",
                        source.id
                    );
                    Ok(())
                } else {
                    Err(format!("Refresh failed: {e}"))
                }
            }
        }
    }

    async fn refresh_all_inner(&self) -> Result<(), String> {
        let sources = db::sources::list_sources(&self.db)?;
        let enabled: Vec<SourceLink> =
            sources.into_iter().filter(|s| s.enabled).collect();
        if enabled.is_empty() {
            return Ok(());
        }

        let mut refreshed = 0usize;
        for source in &enabled {
            if self.refresh_source_inner(&source.id, true).await.is_ok() {
                refreshed += 1;
            }
        }

        if refreshed == 0 {
            Err(format!(
                "Failed to refresh any of {} enabled source(s)",
                enabled.len()
            ))
        } else {
            Ok(())
        }
    }

    fn url_exists(&self, url: &str) -> Result<bool, String> {
        let all = db::sources::list_sources(&self.db)?;
        Ok(all.iter().any(|s| s.url == url))
    }

    async fn fetch_source_json(&self, url: &str) -> Result<GameSource, String> {
        let response = self
            .client
            .get(url)
            .header(
                "User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
            )
            .send()
            .await
            .map_err(|e| format!("Failed to fetch source JSON: {e}"))?;
        if !response.status().is_success() {
            return Err(format!("HTTP {} from source URL", response.status().as_u16()));
        }
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        if content_type.contains("text/html") {
            return Err("Source URL returned HTML (likely Cloudflare challenge)".to_string());
        }
        let bytes = response
            .bytes()
            .await
            .map_err(|e| format!("Body read failed: {e}"))?;
        serde_json::from_slice::<GameSource>(&bytes)
            .map_err(|e| format!("Source JSON parse failed: {e}"))
    }

}

// ─── Helpers ────────────────────────────────────────────────────────────────

static SOURCE_ID_COUNTER: AtomicU64 = AtomicU64::new(0);

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn unix_now_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
}

fn derive_name_from_url(url: &str) -> String {
    let path = url
        .split('?')
        .next()
        .unwrap_or(url)
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or("Source")
        .to_string();
    let stem = if path.is_empty() {
        "Source".to_string()
    } else {
        path.trim_end_matches(".json").replace(['-', '_'], " ")
    };
    stem.split_whitespace()
        .map(|w| {
            let mut chars = w.chars();
            match chars.next() {
                Some(c) => c.to_ascii_uppercase().to_string() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Normalise a game title for matching. Strips punctuation and
/// registered/trademark/copyright glyphs, lowercases, and removes
/// common "edition" / platform / subtitle noise so "Hollow Knight:
/// Voidheart Edition", "HOLLOW KNIGHT™", and "Hollow Knight (PC)"
/// all collapse to the same token set as the bare query.
///
/// We deliberately keep subtitle separators (`-` / `:`) only long
/// enough to split the title into a primary name + optional
/// subtitle; the subtitle is dropped so a search for "Elden Ring"
/// doesn't get dragged down by a "Shadow of the Erdtree" repack
/// whose primary name is still "Elden Ring".
pub(crate) fn normalize_title(title: &str) -> String {
    // 1. Insert spaces at camelCase / letter-digit boundaries so
    //    "Cyberpunk2077", "cyberpunk.2077" and "cyberpunk_2077" all
    //    tokenise identically.
    let mut spaced = String::with_capacity(title.len() + 8);
    let chars: Vec<char> = title.chars().collect();
    for (i, &c) in chars.iter().enumerate() {
        if i > 0 {
            let prev = chars[i - 1];
            let boundary = (prev.is_lowercase() && c.is_uppercase())
                || (prev.is_alphabetic() && c.is_ascii_digit())
                || (prev.is_ascii_digit() && c.is_alphabetic());
            if boundary {
                spaced.push(' ');
            }
        }
        spaced.push(c);
    }

    // 2. Drop trademark glyphs, fold diacritics to ASCII, lowercase.
    let t: String = spaced
        .replace(['®', '™', '©'], "")
        .nfd()
        .filter(|c| !is_combining_mark(*c))
        .collect::<String>()
        .to_lowercase();

    // 3. Keep the primary name before a subtitle separator. Only `:` and
    //    spaced dashes count — bare hyphens stay so "Half-Life" and
    //    "Spider-Man" don't get sliced into fragments.
    let primary = split_primary(&t).to_string();

    // 4. Drop the trailing year and expand remaining punctuation.
    let without_year = regex_year(&primary);
    let without_parens = without_year
        .replace(['(', ')', '[', ']', '{', '}'], " ")
        .replace(
            [
                '.', ',', '!', '?', '/', '\\', '"', '\'', '_', '|', '+', '&', '=', '~', '*',
            ],
            " ",
        );

    // 5. Remove edition / collection / platform noise that inflates
    //    catalog titles without changing identity.
    let tokens: Vec<String> = without_parens
        .split_whitespace()
        .map(|tok| tok.trim_matches('-').to_string())
        .filter(|tok| !tok.is_empty() && !NOISE_TOKENS.contains(&tok.as_str()))
        .collect();
    tokens.join(" ")
}

/// True for the common Unicode combining-mark ranges produced by NFD.
fn is_combining_mark(c: char) -> bool {
    matches!(
        c as u32,
        0x0300..=0x036F
            | 0x1AB0..=0x1AFF
            | 0x1DC0..=0x1DFF
            | 0x20D0..=0x20FF
            | 0xFE20..=0xFE2F
    )
}

/// Return the primary title, dropping a subtitle after `:` or a spaced
/// dash. Bare hyphens are left alone so hyphenated names survive.
fn split_primary(title: &str) -> &str {
    let mut cut: Option<usize> = title.find(':');
    for sep in [" - ", " – ", " — "] {
        if let Some(i) = title.find(sep) {
            cut = Some(cut.map_or(i, |c| c.min(i)));
        }
    }
    match cut {
        Some(pos) if title[..pos].trim().chars().count() >= 3 => title[..pos].trim(),
        _ => title,
    }
}

/// Strip a trailing 4-digit year (1900–2099) from the end of a title,
/// whether bare ("cyberpunk 2077") or preceded by a space.
fn regex_year(s: &str) -> String {
    // Find a 4-digit token that looks like a year at the very end.
    let trimmed = s.trim_end();
    let last_word = trimmed.split_whitespace().last().unwrap_or("");
    if last_word.len() == 4 && last_word.chars().all(|c| c.is_ascii_digit()) {
        if let Ok(y) = last_word.parse::<u32>() {
            if (1900..=2099).contains(&y) {
                let cut = trimmed.len() - last_word.len();
                return trimmed[..cut].trim_end().to_string();
            }
        }
    }
    s.to_string()
}

/// Tokenise a normalised title into a de-duplicated, sorted set of
/// tokens. Used by [`title_similarity`].
fn token_set(s: &str) -> Vec<String> {
    let mut toks: Vec<String> = s.split_whitespace().map(|t| t.to_string()).collect();
    toks.sort();
    toks.dedup();
    toks
}

/// Ordered, de-duplicated tokens — order is preserved so
/// [`title_similarity`] can weight the leading query terms.
fn token_list(s: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for tok in s.split_whitespace() {
        let owned = tok.to_string();
        if !out.contains(&owned) {
            out.push(owned);
        }
    }
    out
}

/// Parse a token as a plausible release year (1900–2099).
fn parse_year(tok: &str) -> Option<u32> {
    if tok.len() == 4 && tok.chars().all(|c| c.is_ascii_digit()) {
        tok.parse::<u32>()
            .ok()
            .filter(|year| (1900..=2099).contains(year))
    } else {
        None
    }
}

/// First plausible year token in a token list.
fn find_year(tokens: &[String]) -> Option<u32> {
    tokens.iter().find_map(|tok| parse_year(tok))
}

/// Robust similarity between the (normalised) query and a candidate
/// title. Combines a token-set Jaccard overlap with a strong bonus
/// for an exact whole-string match (after normalisation), so a
/// genuinely-correct repack ("elden ring") scores ~1.0 even against
/// a noisier catalog title ("elden ring deluxe edition repack"),
/// while an unrelated game ("elden ring of war") scores low.
///
/// `pub(crate)`: shared by the plugin search pipeline
/// (`crate::plugins::search_downloads` applies the same 0.2 match
/// floor to plugin results that source results get).
pub(crate) fn title_similarity(raw_query: &str, title: &str) -> f32 {
    let qn = normalize_title(raw_query);
    let tn = normalize_title(title);
    if qn.is_empty() || tn.is_empty() {
        return 0.0;
    }
    if qn == tn {
        return 1.0;
    }

    let q_tokens = token_list(&qn);
    let t_tokens_ordered = token_list(&tn);
    let t_tokens = token_set(&tn);
    if q_tokens.is_empty() {
        return 0.0;
    }

    let count = q_tokens.len() as f32;
    let mut weighted_match = 0.0_f32;
    let mut weight_total = 0.0_f32;
    let mut fully_matched = 0usize;
    for (idx, qt) in q_tokens.iter().enumerate() {
        // Leading query terms matter a little more than trailing ones.
        let position_weight = 1.0 + (count - 1.0 - idx as f32).max(0.0) * 0.04;
        weight_total += position_weight;

        if t_tokens.contains(qt) {
            weighted_match += position_weight;
            fully_matched += 1;
        } else if qt.chars().count() >= 3
            && t_tokens_ordered.iter().any(|tt| {
                tt.starts_with(qt.as_str()) || qt.starts_with(tt.as_str())
            })
        {
            // Bounded credit for prefix / truncation (typo tolerance)
            // without pretending it is a full match.
            weighted_match += position_weight * 0.75;
        } else if let Some(fuzzy_credit) =
            fuzzy_token_credit(qt, t_tokens_ordered.iter().map(|s| s.as_str()))
        {
            // Bounded edit-distance tolerance for mid-word typos, which
            // neither the exact nor the prefix branch can rescue
            // ("eldne ring", "cyberpnk 2077"). Credit sits below the
            // prefix tier (0.75) because a 1–2 edit typo may also be a
            // genuinely different word of the same length.
            weighted_match += position_weight * fuzzy_credit;
        }
    }
    let recall = if weight_total > 0.0 {
        (weighted_match / weight_total).clamp(0.0, 1.0)
    } else {
        0.0
    };

    // Penalise titles that carry many extra tokens beyond the query
    // (so "elden ring of war" scores lower than "elden ring deluxe"),
    // but keep the penalty gentle: variable catalog titles routinely
    // add 2–4 extra tokens and we don't want to crush them.
    let extra = t_tokens.len().saturating_sub(fully_matched);
    let noise_penalty = (extra as f32 * 0.05).min(0.35);

    // Exact substring containment (either direction) is a strong
    // positive signal but not a perfect match.
    let containment = if tn.contains(&qn) || qn.contains(&tn) {
        0.15
    } else {
        0.0
    };

    // A year in the query is a strong identity signal; a conflicting year
    // in the title is a meaningful negative signal.
    let year_adj = match (find_year(&q_tokens), find_year(&t_tokens_ordered)) {
        (Some(query_year), Some(title_year)) if query_year == title_year => 0.08,
        (Some(_), Some(_)) => -0.12,
        _ => 0.0,
    };

    // Every query token present exactly (only reordered) is a very strong
    // signal — reward it so word-order differences don't look like noise.
    let all_exact_bonus =
        if fully_matched == q_tokens.len() && t_tokens.len() == q_tokens.len() {
            0.1
        } else {
            0.0
        };

    let score =
        (recall - noise_penalty).max(0.0) * 0.85 + containment + year_adj + all_exact_bonus;
    score.clamp(0.0, 1.0)
}

/// Bounded edit distance between two short strings (Wagner–Fischer with an
/// early-exit band). Returns `Some(distance)` when the distance is `<= max`,
/// `None` otherwise. Titles are short (≤ ~40 chars) so the O(n·m) table is
/// cheap, but `max` is always 2 in practice which keeps the inner loops tiny.
fn bounded_edit_distance(a: &[char], b: &[char], max: usize) -> Option<usize> {
    let (shorter, longer) = if a.len() <= b.len() { (a, b) } else { (b, a) };
    // Distance is at least the length difference; bail before building a table.
    if longer.len() - shorter.len() > max {
        return None;
    }
    let m = shorter.len();
    let mut prev: Vec<usize> = (0..=m).collect();
    for (i, lc) in longer.iter().enumerate() {
        let mut cur = vec![i + 1];
        for (j, sc) in shorter.iter().enumerate() {
            let cost = usize::from(lc != sc);
            let val = (prev[j] + cost).min(cur[j] + 1).min(prev[j + 1] + 1);
            cur.push(val);
        }
        // Row pruning: if every cell of this row is beyond `max`, the final
        // distance cannot come back down.
        if *cur.iter().min().unwrap_or(&usize::MAX) > max {
            return None;
        }
        prev = cur;
    }
    let d = prev[m];
    if d <= max {
        Some(d)
    } else {
        None
    }
}

/// Per-token fuzzy credit for a query token that failed both the exact and
/// the prefix branch. Tokens shorter than 4 characters are skipped — short
/// words collide too easily under edit distance ("war"/"ward"/"earn") — and
/// all-digit tokens never fuzz (years must conflict, not approximately
/// match). A 1-edit match earns the same credit as a prefix match (0.75); a
/// 2-edit match earns less (0.6) because it may well be a different word.
fn fuzzy_token_credit<'a, I: Iterator<Item = &'a str>>(
    query_tok: &str,
    title_tokens: I,
) -> Option<f32> {
    let q_chars: Vec<char> = query_tok.chars().collect();
    if q_chars.len() < 4 || q_chars.iter().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let best = title_tokens
        .filter_map(|tt| {
            let t_chars: Vec<char> = tt.chars().collect();
            if t_chars.len() < 3 {
                return None;
            }
            if single_transposition(&q_chars, &t_chars) {
                return Some(1);
            }
            bounded_edit_distance(&q_chars, &t_chars, 2)
        })
        .min()?;
    match best {
        0 | 1 => Some(0.75),
        _ => Some(0.6),
    }
}

/// True when the two tokens differ by exactly one adjacent pair swap
/// ("elden"/"eldne") — the classic one-keystroke transposition that plain
/// Levenshtein counts as two edits.
fn single_transposition(a: &[char], b: &[char]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut first: Option<usize> = None;
    for (i, (ca, cb)) in a.iter().zip(b.iter()).enumerate() {
        if ca != cb {
            if let Some(prev) = first {
                // Only two mismatches qualify, adjacent and swapped.
                return i == prev + 1 && a[prev] == *cb && *ca == b[prev];
            }
            first = Some(i);
        }
    }
    false
}

/// Edition / platform / repack noise tokens, shared between
/// [`normalize_title`] (matching) and [`clean_search_query`] (query
/// preparation). Case-insensitive comparisons use the lowercase forms here.
static NOISE_TOKENS: &[&str] = &[
    "edition", "definitive", "game", "of", "the", "year", "goty", "deluxe", "collectors",
    "collector", "complete", "special", "ultimate", "premium", "standard", "gold", "platinum",
    "anniversary", "remastered", "remaster", "enhanced", "directors", "director", "cut", "pc",
    "windows", "linux", "mac", "steam", "gog", "epic", "fitgirl", "repack", "v", "for", "and",
    "with", "pack", "iso", "setup", "installer", "portable", "build", "update", "patch",
    "hotfix", "multi", "nintendo", "switch", "playstation", "xbox", "ps4", "ps5",
    // Repack / scene groups. camelCase splitting turns "FitGirl" into two
    // tokens, so both halves are listed; the rest collapse 1:1.
    "fit", "girl", "codex", "plaza", "skidrow", "cpy", "goldberg", "empress", "tenoke",
];

/// Produce the fallback search string for a raw game title: the primary
/// name before a subtitle separator, with edition/platform noise tokens
/// and a trailing year removed, whitespace collapsed. Unlike
/// [`normalize_title`] it preserves the original casing (plugins may
/// render the query on their request URL) and it falls back progressively
/// — primary name, then the raw query — so it never returns a
/// too-short-to-search string.
///
/// Returns `None` when the clean-up would not change anything (the
/// caller then skips the retry rather than duplicating the first pass).
///
/// ```text
/// "Hollow Knight: Voidheart Edition" -> Some("Hollow Knight")
/// "ELDEN RING™ (2022) Deluxe v3"     -> Some("ELDEN RING")
/// "Elden Ring"                       -> None
/// ```
pub fn clean_search_query(query: &str) -> Option<String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return None;
    }

    // Primary name before `:` / spaced dash (case preserved, trademark
    // glyphs stripped so the plugin request URL stays clean).
    let primary = split_primary(trimmed).replace(['®', '™', '©'], "");
    let primary = primary.as_str();

    // Strip parens/brackets content keywords and noise tokens, keeping case.
    let is_versionish = |tok: &str| {
        // "v3", "v1.4" style build markers — not part of the game name.
        let l = tok.to_ascii_lowercase();
        l.len() > 1
            && l.starts_with('v')
            && l[1..].chars().next().map_or(false, |c| c.is_ascii_digit())
    };
    let flattened = primary.replace(['(', ')', '[', ']', '{', '}'], " ");
    let tokens: Vec<&str> = flattened
        .split_whitespace()
        .map(|tok| tok.trim_matches('.').trim_matches('-'))
        .filter(|tok| !tok.is_empty())
        .collect();
    let kept: Vec<&str> = tokens
        .iter()
        .copied()
        .filter(|tok| {
            let last = tok.ends_with(|c: char| c.is_ascii_digit());
            // Drop a trailing 4-digit year token, keep "Cyberpunk2077" (one word).
            !last || tok.len() != 4
        })
        .filter(|tok| !NOISE_TOKENS.contains(&tok.to_ascii_lowercase().as_str()))
        .filter(|tok| !is_versionish(tok))
        .map(|tok| tok.trim())
        .filter(|tok| !tok.is_empty())
        .collect();

    let joined = kept.join(" ");
    let cleaned = {
        let candidate = if joined.chars().count() >= 3 {
            joined
        } else {
            // Prefer the raw primary (may already be noise-free when the
            // tokens collapsed to nothing, e.g. "The Dukes").
            split_primary(trimmed).to_string()
        };
        if candidate.chars().count() >= 3 {
            candidate
        } else {
            trimmed.to_string()
        }
    };

    let same_tokens = cleaned.split_whitespace().eq(trimmed.split_whitespace());
    let differs = !same_tokens && !cleaned.eq_ignore_ascii_case(trimmed);
    if differs {
        Some(cleaned)
    } else {
        None
    }
}

/// Similarity of a title against the best of several query candidates —
/// the raw game name plus optional alternative names (local/IGDB
/// aliases). A hit that matches any alias perfectly is a perfect hit.
pub fn best_title_similarity(query: &str, aliases: &[String], title: &str) -> f32 {
    let mut best = title_similarity(query, title);
    for alias in aliases {
        if alias == query {
            continue;
        }
        let s = title_similarity(alias, title);
        if s > best {
            best = s;
        }
    }
    best
}

/// Adjust a similarity score using an independent release-year signal
/// (game `releaseDate`). Only applies when the title itself contains a
/// 4-digit year: matching year → bonus, conflicting year → penalty.
pub fn apply_release_year_adj(score: f32, title: &str, release_year: i32) -> f32 {
    let tn = normalize_title(title);
    if tn.is_empty() {
        return score;
    }
    let tokens = token_list(&tn);
    match find_year(&tokens) {
        Some(year) if year == release_year.unsigned_abs() => (score + 0.08).clamp(0.0, 1.0),
        Some(_) => (score - 0.12).clamp(0.0, 1.0),
        None => score,
    }
}

/// Count `tr=` parameter occurrences in a magnet URI.
/// Case-insensitive on the parameter name — magnet URI parameter
/// names are nominally case-sensitive per RFC 6230, but real-world
/// sources (older caches, drive-stak dumps) occasionally
/// emit `TR=` or `Tr=`. Both `is_bare_magnet` and
/// `is_tracker_bearing_magnet` route through this so a lowered
/// comparison matches the same source bytes.
fn count_tr_params(uri: &str) -> usize {
    uri.to_ascii_lowercase()
        .split('&')
        .filter(|p| p.starts_with("tr=") && p.len() > 3)
        .count()
}

/// `true` if `uri` is a `magnet:` URI with no `tr=` parameters.
/// Everything else (non-magnet URIs, magnets with at least one
/// `tr=`) returns `false`.
pub(crate) fn is_bare_magnet(uri: &str) -> bool {
    if !uri.starts_with("magnet:") {
        return false;
    }
    count_tr_params(uri) == 0
}

/// `true` if `uri` is a `magnet:` URI carrying at least one `tr=`
/// parameter — i.e. the source has already done the tracker work
/// and we should pass the magnet through unchanged.
pub(crate) fn is_tracker_bearing_magnet(uri: &str) -> bool {
    if !uri.starts_with("magnet:") {
        return false;
    }
    count_tr_params(uri) > 0
}

/// `true` if `uri` looks like an `http(s)://…/.torrent` file URL
/// (with or without query string). librqbit parses the announce-list
/// out of the `.torrent` metadata, so a `.torrent` URL never needs
/// tracker augmentation.
pub(crate) fn is_torrent_file(uri: &str) -> bool {
    uri.ends_with(".torrent") || uri.contains(".torrent?")
}

/// Insert `magnet` at position 0 of `uris` if it isn't already
/// present (exact-string match). `None` and empty strings are
/// no-ops — empty strings would collide with the modal picker
/// chain's `|| match.magnet || match.uris[0]` falsy-string fallback.
pub(crate) fn merge_magnet_into_uris(uris: &mut Vec<String>, magnet: Option<&String>) {
    if let Some(mag) = magnet {
        if !mag.is_empty() && !uris.iter().any(|u| u == mag) {
            uris.insert(0, mag.clone());
        }
    }
}

/// Promote the most tracker-bearing URI in `uris` to position 0.
///
/// ## Why
///
/// The DownloadModal's default mirror pick is
/// `match.uris[selectedMirrorIdx]` where `selectedMirrorIdx = 0`.
/// Many sources return a bare
/// `magnet:?xt=…&dn=…` URI alongside a sibling `.torrent` URL that
/// already carries an embedded announce-list. Without promotion,
/// the modal's default picks the bare magnet and
/// `default_trackers_vec` (injected into every add via
/// `AddTorrentOptions.trackers` in `torrent_engine.rs`) still
/// applies curated public trackers, but a tracker-bearing `.torrent`
/// alternative is preferable when DHT hasn't bootstrapped — so a
/// bare magnet is never the best default.
/// click away in the mirror selector.
///
/// ## What it does — strict `.torrent` over magnet precedence
///
/// 1. If `uris[0]` is already acceptable as-is (a `.torrent` URL or
///    a trackered magnet), do nothing.
/// 2. Otherwise (`uris[0]` is a bare magnet), look at positions
///    1..N in two passes:
///    * First pass: the first `.torrent` URL (preferred — works
///      even when DHT hasn't bootstrapped).
///    * Second pass (only if step 2 found no `.torrent`): the
///      first trackered magnet.
/// 3. Move the chosen URI to position 0; the bare magnet stays in
///    the list (one index later) so the user can still pick it
///    explicitly from the mirror selector.
///
/// The two-pass split matters: a single
/// `position(|u| is_torrent_file(u) || is_tracker_bearing_magnet(u))`
/// would return the FIRST element satisfying EITHER predicate, so a
/// trackered magnet at position 1 would beat a `.torrent` at
/// position 2 — contradicting this function's documented priority.
pub(crate) fn promote_best_uri_to_front(uris: &mut Vec<String>) {
    if uris.is_empty() || !is_bare_magnet(&uris[0]) {
        return;
    }
    // Wrap each predicate in a closure so the compiler can apply
    // `&String → &str` deref coercion — passing the function
    // pointer directly leaves it as `&&String` and skips the
    // coercion Rust would otherwise insert.
    let picked = uris
        .iter()
        .skip(1)
        .position(|u| is_torrent_file(u))
        .or_else(|| uris.iter().skip(1).position(|u| is_tracker_bearing_magnet(u)));
    if let Some(rel_idx) = picked {
        let abs_idx = rel_idx + 1;
        let better = uris.remove(abs_idx);
        let preview = if better.len() > 60 {
            format!("{}…", &better[..60])
        } else {
            better.clone()
        };
        eprintln!(
            "[gameindex] promote_best_uri_to_front: promoted {preview} to uris[0] \
             (was a bare magnet at position 0)"
        );
        uris.insert(0, better);
    }
}

/// Compound helper for callers that don't need to keep the merge
/// and promotion steps separate. `db::sources::search` (FTS5) calls
/// this so the rule set stays in one place. Callers SHOULD re-derive
/// their `match.magnet` from the new `uris` after this returns to
/// avoid pointing at a magnet that just got demoted from position 0.
pub(crate) fn merge_and_pick_best(uris: &mut Vec<String>, magnet: Option<&String>) {
    merge_magnet_into_uris(uris, magnet);
    promote_best_uri_to_front(uris);
}

// ─── Tauri commands ─────────────────────────────────────────────────────────
//
// State binding: `Arc<SourceManager>` directly (no Mutex —
// concurrency is provided by SQLite WAL + the per-method
// `&self`/`&mut self` borrow). All commands extract state via
// `app.state::<Arc<SourceManager>>()` or accept it as a
// `tauri::State<'_, Arc<SourceManager>>` parameter.

#[tauri::command]
pub async fn sources_add(
    state: tauri::State<'_, Arc<SourceManager>>,
    url: String,
    name: String,
) -> Result<SourceLink, String> {
    state.add_source(url, name).await
}

#[tauri::command]
pub async fn sources_add_bulk(
    state: tauri::State<'_, Arc<SourceManager>>,
    urls: Vec<String>,
    names: Vec<String>,
) -> Result<BulkAddResult, String> {
    state.add_sources_bulk(urls, names).await
}

#[tauri::command]
pub async fn sources_remove(
    state: tauri::State<'_, Arc<SourceManager>>,
    id: String,
) -> Result<(), String> {
    state.remove_source(&id)
}

#[tauri::command]
pub async fn sources_toggle(
    state: tauri::State<'_, Arc<SourceManager>>,
    id: String,
) -> Result<(), String> {
    state.toggle_source(&id)
}

#[tauri::command]
pub async fn sources_list(
    state: tauri::State<'_, Arc<SourceManager>>,
) -> Result<Vec<SourceLink>, String> {
    state.list_sources()
}

#[tauri::command]
pub async fn sources_refresh(
    state: tauri::State<'_, Arc<SourceManager>>,
    id: String,
) -> Result<(), String> {
    state.refresh_source(&id).await
}

#[tauri::command]
pub async fn sources_refresh_all(
    state: tauri::State<'_, Arc<SourceManager>>,
) -> Result<(), String> {
    state.refresh_all().await
}

#[tauri::command]
pub async fn sources_search_game(
    state: tauri::State<'_, Arc<SourceManager>>,
    query: String,
) -> Result<Vec<crate::source_manager::MatchedDownload>, String> {
    state.search_online(&query, None).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_folds_diacritics_and_case() {
        assert_eq!(normalize_title("Pokémon"), "pokemon");
    }

    #[test]
    fn normalize_expands_link_stems_and_camel_case() {
        // camelCase and dotted link stems tokenise into separate words.
        assert_eq!(normalize_title("DevilMayCry"), "devil may cry");
        assert_eq!(normalize_title("Elden.Ring"), "elden ring");
    }

    #[test]
    fn normalize_keeps_hyphenated_names() {
        // A bare hyphen is not a subtitle separator, so hyphenated names
        // survive intact (only ":" and spaced dashes cut a subtitle).
        assert_eq!(normalize_title("Half-Life"), "half-life");
        assert_eq!(normalize_title("Spider-Man"), "spider-man");
    }

    #[test]
    fn normalize_drops_subtitle_after_colon() {
        assert_eq!(
            normalize_title("Elden Ring: Shadow of the Erdtree"),
            "elden ring"
        );
    }

    #[test]
    fn exact_match_scores_one() {
        assert_eq!(title_similarity("Elden Ring", "Elden Ring"), 1.0);
    }

    #[test]
    fn noisier_repack_still_scores_high() {
        let score = title_similarity("Elden Ring", "Elden Ring [FitGirl Repack]");
        assert!(score >= 0.9, "expected a high score, got {score}");
    }

    #[test]
    fn diacritics_and_link_stems_match() {
        assert!(title_similarity("Pokemon", "Pokémon.Arceus-CODEX") > 0.7);
    }

    #[test]
    fn unrelated_title_scores_low() {
        assert!(title_similarity("Elden Ring", "Farming Simulator 22") < 0.2);
    }

    #[test]
    fn typo_prefix_is_tolerated() {
        assert!(title_similarity("cyberpun", "Cyberpunk 2077") > 0.5);
    }

    #[test]
    fn conflicting_year_is_penalised() {
        let matching = title_similarity("FIFA 2023 Update", "FIFA 2023 Update");
        let conflicting = title_similarity("FIFA 2022 Update", "FIFA 2023 Update");
        assert!(matching > conflicting);
        assert!(conflicting < 0.5, "expected a low score, got {conflicting}");
    }

    #[test]
    fn word_order_does_not_matter() {
        assert!(title_similarity("ring elden", "Elden Ring") >= 0.9);
    }

    #[test]
    fn typo_mid_word_is_tolerated() {
        // A one-edit typo inside a token now earns credit instead of zero,
        // keeping the hit far above the 0.2 match floor.
        let score = title_similarity("eldne ring", "Elden Ring");
        assert!(score >= 0.6, "expected a strong score, got {score}");
    }

    #[test]
    fn two_edit_typo_stays_above_the_floor() {
        let score = title_similarity("cyberpnk", "Cyberpunk 2077");
        assert!(score >= 0.3, "expected a usable score, got {score}");
    }

    #[test]
    fn short_tokens_are_not_fuzzy_matched() {
        // Edit distance must not rescue unrelated short words.
        let clean = title_similarity("war ii", "Rayman Legends");
        assert!(clean < 0.3, "expected a low score, got {clean}");
    }

    #[test]
    fn fuzzy_does_not_rescue_unrelated_titles() {
        let score = title_similarity("Dark Souls", "Farm Frenzy");
        assert!(score < 0.3, "expected a low score, got {score}");
    }

    #[test]
    fn clean_query_strips_subtitle_and_edition_noise() {
        assert_eq!(
            clean_search_query("Hollow Knight: Voidheart Edition").as_deref(),
            Some("Hollow Knight")
        );
        assert_eq!(
            clean_search_query("ELDEN RING Deluxe v3").as_deref(),
            Some("ELDEN RING")
        );
    }

    #[test]
    fn clean_query_skips_already_clean_titles() {
        assert_eq!(clean_search_query("Elden Ring"), None);
        assert_eq!(clean_search_query("Half-Life 2"), None);
    }

    #[test]
    fn clean_query_falls_back_to_primary() {
        // The primary is kept even when every token looks like noise —
        // a worse fallback would return an empty and useless query.
        let cleaned = clean_search_query("The Dukes: The");
        assert!(cleaned.is_some());
        assert!(cleaned.unwrap().chars().count() >= 3);
    }

    #[test]
    fn alias_match_scores_as_a_perfect_hit() {
        let aliases = vec!["Hollow Knight: Voidheart Edition".to_string()];
        let score = best_title_similarity(
            "hollow knight",
            &aliases,
            "Hollow Knight Voidheart Edition",
        );
        assert!(score >= 0.95, "expected a near-perfect score, got {score}");
    }

    #[test]
    fn release_year_adjusts_score() {
        let same = apply_release_year_adj(0.8, "Elden Ring (2022) Repack", 2022);
        let other = apply_release_year_adj(0.8, "Elden Ring (2019) Trailer", 2022);
        assert!(same > 0.8);
        assert!(other < 0.8);
    }

    #[test]
    fn release_year_ignored_when_title_has_no_year() {
        assert_eq!(apply_release_year_adj(0.7, "Hollow Knight", 2022), 0.7);
    }
}

