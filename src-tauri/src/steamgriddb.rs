//! SteamGridDB artwork service (steamgriddb.com).
//!
//! Fetches community grid (poster) and hero (wide banner) artwork for a
//! Steam AppID, preferring ANIMATED assets (APNG / animated WebP) when the
//! community has uploaded them, and falling back to static art otherwise.
//!
//! The service:
//! - Requires a free SteamGridDB API key, supplied via the
//!   `STEAMGRIDDB_API_KEY` environment variable (`.env` in dev, baked into
//!   the binary at build time in production — see `crate::config`). When no
//!   key is present the service is a silent no-op and games keep their
//!   existing art.
//! - Queries the v2 API per kind (`/grids/steam/{appid}`,
//!   `/heroes/steam/{appid}`) with `types=animated` first, then
//!   `types=static`, so "animated when possible" is decided by the API
//!   rather than sniffed from file extensions.
//! - Caches per-AppID results (including negatives — games with no
//!   community art) in the SQLite KV store with a 7-day TTL, keyed
//!   `sgdb:v1:{appid}`, so a large library is only fetched once per week.
//! - The batch command coalesces a store/library grid's many per-card
//!   requests into a single round-trip with bounded concurrency (same
//!   pattern as `crackwatch`'s batch command).

use std::collections::{HashMap, HashSet};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::db::Db;

/// Base URL of the SteamGridDB v2 API.
const API_BASE: &str = "https://www.steamgriddb.com/api/v2";
/// KV key prefix for cached per-AppID results.
///
/// Bumped from `v1` to `v2` because the old version cached negatives from a
/// period when the API rejected the `nsfw=no` filter values (the correct
/// values are `false`); bumping the prefix discards those stale "no art"
/// entries so fixed lookups actually run again.
const CACHE_KEY_PREFIX: &str = "sgdb:v2:";
/// Cache TTL for both hits and negatives (7 days — community art rarely churns).
const CACHE_TTL_MS: u64 = 7 * 24 * 60 * 60 * 1000;

/// The artwork kinds we consume. `path()` maps to the v2 API route.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SgdbKind {
    Grid,
    Hero,
}

impl SgdbKind {
    fn path(self) -> &'static str {
        match self {
            SgdbKind::Grid => "grids/steam",
            SgdbKind::Hero => "heroes/steam",
        }
    }
}

/// Combined artwork for one Steam AppID. Every field is optional: the
/// community may have grids but no heroes (or vice versa), and a game may
/// have no artwork at all (everything `None`).
///
/// Each kind is split into a **static** version (the poster/banner shown by
/// default) and an **animated** version (WebP/APNG, used on hover / in the
/// hero backdrop). A game typically has either both or only one of the two.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SgdbAssets {
    /// Best static vertical grid / poster (600×900-style community art).
    pub grid_url: Option<String>,
    pub grid_mime: Option<String>,
    /// Best animated grid (APNG / animated WebP) — shown on card hover.
    pub grid_animated_url: Option<String>,
    pub grid_animated_mime: Option<String>,
    /// Best static wide hero / banner (460×215-style community art).
    pub hero_url: Option<String>,
    pub hero_mime: Option<String>,
    /// Best animated hero — shown as the hero background.
    pub hero_animated_url: Option<String>,
    pub hero_animated_mime: Option<String>,
}

/// One artwork item from the v2 API `data` array. Unknown fields are
/// ignored; optional fields degrade gracefully if the API shape drifts.
#[derive(Debug, Deserialize, Clone, Default)]
struct SgdbArtwork {
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    mime: Option<String>,
    #[serde(default)]
    score: Option<f64>,
    #[serde(default)]
    downloads: Option<u64>,
}

#[derive(Debug, Deserialize, Default)]
struct SgdbApiResponse {
    #[serde(default)]
    success: bool,
    #[serde(default)]
    data: Vec<SgdbArtwork>,
    #[serde(default)]
    errors: Vec<String>,
}

/// Cache envelope stored in the KV store.
#[derive(Debug, Serialize, Deserialize, Clone)]
struct CachedSgdbAssets {
    #[serde(default)]
    data: Option<SgdbAssets>,
    /// Unix-millisecond timestamp of the cache write (TTL checks).
    updated_at: u64,
}

/// Pick the highest-quality artwork from a kind's returned list: score
/// (community votes) first, then download count. Keeps the item's mime so
/// the frontend can tell whether it is animated (APNG / WebP) vs static.
fn pick_best(mut items: Vec<SgdbArtwork>) -> Option<SgdbArtwork> {
    items.sort_by(|a, b| {
        b.score
            .unwrap_or(0.0)
            .partial_cmp(&a.score.unwrap_or(0.0))
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(b.downloads.unwrap_or(0).cmp(&a.downloads.unwrap_or(0)))
    });
    items.into_iter().next()
}

struct SgdbService {
    client: reqwest::Client,
}

impl SgdbService {
    fn new() -> Self {
        let client = reqwest::Client::builder()
            .user_agent(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
                 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
            )
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .expect("failed to build SteamGridDB HTTP client");
        Self { client }
    }

    /// Fetch the best static AND animated artwork of a kind for an AppID in
    /// parallel, so the frontend can show the static version by default and
    /// swap in the animated one on hover / in the hero.
    ///
    /// NSFW / humor / epilepsy-tagged uploads are excluded so posters stay
    /// family-friendly. Returns `(animated, static)`.
    async fn fetch_kind(
        &self,
        api_key: &str,
        app_id: u32,
        kind: SgdbKind,
    ) -> (Option<SgdbArtwork>, Option<SgdbArtwork>) {
        tokio::join!(
            self.fetch_kind_with_types(api_key, app_id, kind, "animated"),
            self.fetch_kind_with_types(api_key, app_id, kind, "static"),
        )
    }

    async fn fetch_kind_with_types(
        &self,
        api_key: &str,
        app_id: u32,
        kind: SgdbKind,
        types: &str,
    ) -> Option<SgdbArtwork> {
        let url = format!(
            "{API_BASE}/{}/{}?types={types}&nsfw=false&humor=false&epilepsy=false",
            kind.path(),
            app_id
        );
        let resp = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {api_key}"))
            .send()
            .await
            .ok()?;
        if !resp.status().is_success() {
            return None;
        }
        let body: SgdbApiResponse = resp.json().await.ok()?;
        if !body.success {
            if let Some(err) = body.errors.first() {
                eprintln!("[steamgriddb] API error for app {app_id} ({types}): {err}");
            }
            return None;
        }
        if body.data.is_empty() {
            return None;
        }
        pick_best(body.data)
    }
}

/// Process-wide singleton (same pattern as `crackwatch`'s service).
static SGDB_SERVICE: std::sync::OnceLock<SgdbService> = std::sync::OnceLock::new();

fn service() -> &'static SgdbService {
    SGDB_SERVICE.get_or_init(SgdbService::new)
}

/// Whether a SteamGridDB API key is configured (compile-time bake or `.env`).
fn has_api_key() -> bool {
    !crate::config::get_steamgriddb_api_key().is_empty()
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn cache_key(app_id: u32) -> String {
    format!("{CACHE_KEY_PREFIX}{app_id}")
}

fn persist(db: &Db, app_id: u32, assets: &SgdbAssets) {
    let envelope = CachedSgdbAssets {
        data: Some(assets.clone()),
        updated_at: now_ms(),
    };
    if let Ok(json) = serde_json::to_string(&envelope) {
        let key = cache_key(app_id);
        if let Err(e) = crate::db::kv::set(db, &key, &json) {
            eprintln!("[steamgriddb] cache write failed for {key}: {e}");
        }
    }
}

/// Fetch grid + hero artwork (both animated and static variants) for one
/// AppID in parallel.
async fn fetch_assets(api_key: &str, app_id: u32) -> SgdbAssets {
    let (grid, hero) = tokio::join!(
        service().fetch_kind(api_key, app_id, SgdbKind::Grid),
        service().fetch_kind(api_key, app_id, SgdbKind::Hero),
    );
    let (grid_animated, grid_static) = grid;
    let (hero_animated, hero_static) = hero;
    SgdbAssets {
        grid_url: grid_static.as_ref().and_then(|g| g.url.clone()),
        grid_mime: grid_static.and_then(|g| g.mime),
        grid_animated_url: grid_animated.as_ref().and_then(|g| g.url.clone()),
        grid_animated_mime: grid_animated.and_then(|g| g.mime),
        hero_url: hero_static.as_ref().and_then(|h| h.url.clone()),
        hero_mime: hero_static.and_then(|h| h.mime),
        hero_animated_url: hero_animated.as_ref().and_then(|h| h.url.clone()),
        hero_animated_mime: hero_animated.and_then(|h| h.mime),
    }
}

/// Whether a stored result carries any artwork (negatives are cached too).
fn has_art(assets: &SgdbAssets) -> bool {
    assets.grid_url.is_some()
        || assets.grid_animated_url.is_some()
        || assets.hero_url.is_some()
        || assets.hero_animated_url.is_some()
}

/// Read a fresh cache entry for an AppID, if present and unexpired.
fn read_cache(db: &Db, app_id: u32) -> Option<Option<SgdbAssets>> {
    let raw = crate::db::kv::get(db, &cache_key(app_id)).ok().flatten()?;
    let cached = serde_json::from_str::<CachedSgdbAssets>(&raw).ok()?;
    (cached.updated_at + CACHE_TTL_MS > now_ms()).then_some(cached.data)
}

/// Fetch SteamGridDB grid + hero artwork for a single Steam AppID.
///
/// Returns `None` when no API key is configured, the game has no community
/// artwork, or the request failed. Results (including negatives) are cached
/// in the KV store with a 7-day TTL.
#[tauri::command]
pub async fn sgdb_get_assets(app: tauri::AppHandle, steam_app_id: u32) -> Option<SgdbAssets> {
    let db = app.state::<Db>().inner().clone();

    if let Some(cached) = read_cache(&db, steam_app_id) {
        return cached.filter(has_art);
    }

    if !has_api_key() {
        return None;
    }
    let api_key = crate::config::get_steamgriddb_api_key();

    let assets = fetch_assets(&api_key, steam_app_id).await;
    persist(&db, steam_app_id, &assets);
    has_art(&assets).then_some(assets)
}

/// Batch variant of [`sgdb_get_assets`]: a store/library grid of many cards
/// makes a single Tauri round-trip instead of one invoke per card.
///
/// Cache hits resolve synchronously; cold AppIDs are fetched with bounded
/// concurrency and persisted (same per-AppID KV keys and TTL as the single
/// command). AppIDs without any artwork are omitted from the returned map.
#[tauri::command]
pub async fn sgdb_get_assets_batch(
    app: tauri::AppHandle,
    steam_app_ids: Vec<u32>,
) -> HashMap<u32, SgdbAssets> {
    use futures::stream::{self, StreamExt};

    const MAX_CONCURRENT: usize = 6;

    let db = app.state::<Db>().inner().clone();

    // Dedupe + split cache hits from cold AppIDs.
    let mut resolved: HashMap<u32, SgdbAssets> = HashMap::new();
    let mut cold: Vec<u32> = Vec::new();
    let mut seen: HashSet<u32> = HashSet::new();
    for app_id in steam_app_ids {
        if !seen.insert(app_id) {
            continue;
        }
        match read_cache(&db, app_id) {
            Some(Some(assets)) if has_art(&assets) => {
                resolved.insert(app_id, assets);
            }
            Some(_) => continue, // fresh negative — nothing to fetch
            None => cold.push(app_id),
        }
    }

    if cold.is_empty() {
        return resolved;
    }

    if !has_api_key() {
        return resolved;
    }
    let api_key = crate::config::get_steamgriddb_api_key();

    let fetched: Vec<(u32, SgdbAssets)> = stream::iter(cold)
        .map(|app_id| {
            let api_key = api_key.clone();
            async move {
                let assets = fetch_assets(&api_key, app_id).await;
                (app_id, assets)
            }
        })
        .buffer_unordered(MAX_CONCURRENT)
        .collect()
        .await;

    for (app_id, assets) in fetched {
        persist(&db, app_id, &assets);
        if has_art(&assets) {
            resolved.insert(app_id, assets);
        }
    }

    resolved
}

#[cfg(test)]
mod tests {
    use super::*;

    fn art(url: &str, mime: &str, score: f64, downloads: u64) -> SgdbArtwork {
        SgdbArtwork {
            url: Some(url.to_string()),
            mime: Some(mime.to_string()),
            score: Some(score),
            downloads: Some(downloads),
        }
    }

    #[test]
    fn pick_best_prefers_highest_score_then_downloads() {
        let items = vec![
            art("low.png", "image/png", 0.2, 10),
            art("top.webp", "image/webp", 5.0, 3),
            art("mid.apng", "image/apng", 1.0, 999),
        ];
        let best = pick_best(items).expect("should pick one");
        assert_eq!(best.url.as_deref(), Some("top.webp"));
        assert_eq!(best.mime.as_deref(), Some("image/webp"));
    }

    #[test]
    fn pick_best_ties_break_by_downloads() {
        let items = vec![
            art("a.png", "image/png", 2.0, 5),
            art("b.png", "image/png", 2.0, 50),
        ];
        let best = pick_best(items).expect("should pick one");
        assert_eq!(best.url.as_deref(), Some("b.png"));
    }

    #[test]
    fn pick_best_empty_returns_none() {
        assert!(pick_best(vec![]).is_none());
    }

    #[test]
    fn pick_best_handles_missing_metadata() {
        let best = pick_best(vec![SgdbArtwork::default()]);
        assert!(best.is_some());
    }

    #[test]
    fn assets_serialize_camel_case() {
        let assets = SgdbAssets {
            grid_url: Some("https://cdn/grid.png".into()),
            grid_mime: Some("image/png".into()),
            grid_animated_url: Some("https://cdn/grid.webp".into()),
            grid_animated_mime: Some("image/webp".into()),
            hero_url: Some("https://cdn/hero.png".into()),
            hero_mime: Some("image/png".into()),
            hero_animated_url: None,
            hero_animated_mime: None,
        };
        let json = serde_json::to_value(&assets).unwrap();
        assert!(json.get("gridUrl").is_some());
        assert!(json.get("grid_animated_url").is_none());
        assert!(json.get("gridAnimatedUrl").is_some());
        assert!(json.get("heroUrl").is_some());
        assert!(json.get("heroAnimatedUrl").is_some());
        assert_eq!(json.get("heroAnimatedUrl").unwrap().as_str(), None);
    }

    #[test]
    fn has_art_detects_any_variant() {
        let none = SgdbAssets {
            grid_url: None,
            grid_mime: None,
            grid_animated_url: None,
            grid_animated_mime: None,
            hero_url: None,
            hero_mime: None,
            hero_animated_url: None,
            hero_animated_mime: None,
        };
        assert!(!has_art(&none));

        let animated_grid_only = SgdbAssets {
            grid_animated_url: Some("https://cdn/g.webp".into()),
            ..none.clone()
        };
        assert!(has_art(&animated_grid_only));

        let static_hero_only = SgdbAssets {
            hero_url: Some("https://cdn/h.png".into()),
            ..none
        };
        assert!(has_art(&static_hero_only));
    }

    #[test]
    fn response_deserializes_with_missing_fields() {
        let raw = r#"{"success":true,"data":[{"id":1,"url":"https://cdn/a.png","mime":"image/png"}]}"#;
        let resp: SgdbApiResponse = serde_json::from_str(raw).unwrap();
        assert!(resp.success);
        assert_eq!(resp.data.len(), 1);
        assert_eq!(resp.data[0].score, None);
    }
}
