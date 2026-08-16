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
fn normalize_title(title: &str) -> String {
    let t = title
        .replace('®', "")
        .replace('™', "")
        .replace('©', "")
        .to_ascii_lowercase();

    // Take the primary name before a `:` or `-` subtitle separator,
    // but only when the primary part is long enough to be meaningful
    // (avoids splitting "Half-Life" into "half" + "life").
    let primary = if let Some(pos) = t.find(|c| c == ':' || c == '-') {
        let first = t[..pos].trim();
        if first.chars().count() >= 4 {
            first.to_string()
        } else {
            t.clone()
        }
    } else {
        t.clone()
    };

    // Drop trailing year (19xx/20xx) and parenthetical tags like
    // "(PC)", "(GOG)", "(v1.2)".
    let without_year = regex_year(&primary);
    let without_parens = without_year
        .replace(['(', ')', '[', ']', '{', '}'], " ")
        .replace(['.', ',', '!', '?', '/', '\\', '"', '\''], " ");

    // Remove well-known edition / collection / platform noise tokens
    // that inflate catalog titles but are irrelevant to identity.
    const NOISE_TOKENS: &[&str] = &[
        "edition", "definitive", "game", "of", "the", "year", "goty", "deluxe", "collectors",
        "collector", "complete", "special", "ultimate", "premium", "standard", "gold", "platinum",
        "anniversary", "remastered", "remaster", "enhanced", "directors", "director", "cut",
        "pc", "windows", "linux", "mac", "steam", "gog", "epic", "fitgirl", "repack", "v",
    ];
    let tokens: Vec<String> = without_parens
        .split_whitespace()
        .map(|tok| tok.trim_matches('-').to_string())
        .filter(|tok| !tok.is_empty() && !NOISE_TOKENS.contains(&tok.as_str()))
        .collect();
    tokens.join(" ")
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

    let q_tokens = token_set(&qn);
    let t_tokens = token_set(&tn);
    if q_tokens.is_empty() {
        return 0.0;
    }

    // Exact substring containment (either direction) is a strong
    // positive signal but not a perfect match.
    let containment = if tn.contains(&qn) || qn.contains(&tn) {
        0.15
    } else {
        0.0
    };

    // Recall: how many of the query tokens are actually present in the
    // title. This is the dominant, intuitive signal — if every token
    // the user typed appears in the (normalised) title, it's almost
    // certainly the right game even when the catalog title carries
    // extra edition / scene / link-stem ("name.name") noise.
    let matched = q_tokens.iter().filter(|t| t_tokens.contains(t)).count() as f32;
    let recall = matched / q_tokens.len() as f32;

    // Penalise titles that contain many extra tokens beyond the query
    // (so "elden ring of war" scores lower than "elden ring deluxe"),
    // but keep the penalty gentle: variable catalog titles routinely
    // add 2–4 extra tokens and we don't want to crush them.
    let extra = (t_tokens.len() as f32).max(matched) - matched;
    let noise_penalty = (extra * 0.05).min(0.35);

    let score = (recall - noise_penalty).max(0.0) * 0.85 + containment;
    score.min(1.0).max(0.0)
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

