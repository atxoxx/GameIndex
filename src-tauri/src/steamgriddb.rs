//! SteamGridDB artwork service (steamgriddb.com).
//!
//! Fetches community grid (poster), hero (wide banner), icon (square) and
//! logo (clear logo) artwork for a Steam AppID, preferring ANIMATED assets
//! (APNG / animated WebP) for grid/hero when the community has uploaded
//! them, and falling back to static art otherwise. Icons and logos are
//! fetched static-only (flat art — animated uploads are rare).
//!
//! The service:
//! - Requires a free SteamGridDB API key, supplied via the
//!   `STEAMGRIDDB_API_KEY` environment variable (`.env` in dev, baked into
//!   the binary at build time in production — see `crate::config`). When no
//!   key is present the service is a silent no-op and games keep their
//!   existing art.
//! - Queries the v2 API per kind (`/grids/steam/{appid}`,
//!   `/heroes/steam/{appid}`, `/icons/steam/{appid}`, `/logos/steam/{appid}`)
//!   with `types=animated` first, then `types=static`, so "animated when
//!   possible" is decided by the API rather than sniffed from file
//!   extensions.
//! - Caches per-AppID results (including negatives — games with no
//!   community art) in the SQLite KV store with a 7-day TTL, keyed
//!   `sgdb:v3:{appid}`, so a large library is only fetched once per week.
//! - The batch command coalesces a store/library grid's many per-card
//!   requests into a single round-trip with bounded concurrency (same
//!   pattern as `crackwatch`'s batch command).

use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::db::Db;

/// Base URL of the SteamGridDB v2 API.
const API_BASE: &str = "https://www.steamgriddb.com/api/v2";
/// KV key prefix for cached per-AppID results.
///
/// Bumped `v1` → `v2` because the old version cached negatives from a
/// period when the API rejected the `nsfw=no` filter values (the correct
/// values are `false`); `v2` → `v3` because the payload schema grew
/// icon/logo fields. Each bump discards stale entries so fixed lookups
/// actually run again.
const CACHE_KEY_PREFIX: &str = "sgdb:v3:";
/// Cache TTL for both hits and negatives (7 days — community art rarely churns).
const CACHE_TTL_MS: u64 = 7 * 24 * 60 * 60 * 1000;

/// The artwork kinds we consume. `path()` maps to the v2 API route.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SgdbKind {
    Grid,
    Hero,
    Icon,
    Logo,
}

impl SgdbKind {
    fn path(self) -> &'static str {
        match self {
            SgdbKind::Grid => "grids/steam",
            SgdbKind::Hero => "heroes/steam",
            SgdbKind::Icon => "icons/steam",
            SgdbKind::Logo => "logos/steam",
        }
    }
}

/// One image item returned to the media picker for a single kind.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SgdbArtworkItem {
    pub url: String,
    pub mime: String,
    pub width: u32,
    pub height: u32,
    pub score: f64,
}

/// All artwork SteamGridDB has for one AppID, grouped by kind. The media
/// picker shows every item (not just the single "best" one from
/// [`SgdbAssets`]), so the user can choose any community upload.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SgdbAllAssets {
    pub grids: Vec<SgdbArtworkItem>,
    pub heroes: Vec<SgdbArtworkItem>,
    pub icons: Vec<SgdbArtworkItem>,
    pub logos: Vec<SgdbArtworkItem>,
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
    /// Best square icon (flat community icon art).
    pub icon_url: Option<String>,
    pub icon_mime: Option<String>,
    /// Best clear logo (flat transparent logo art).
    pub logo_url: Option<String>,
    pub logo_mime: Option<String>,
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
    width: Option<u32>,
    #[serde(default)]
    height: Option<u32>,
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

/// MIME types the frontend can render in an `<img>` tag. The icon endpoint
/// mixes `.ico` uploads (image/vnd.microsoft.icon) with png/webp; those
/// aren't displayed by the media picker (it only shows jpg/jpeg/png/webp),
/// so we prefer web-renderable art whenever the community uploaded any.
fn is_renderable_mime(mime: Option<&str>) -> bool {
    let Some(m) = mime else { return true; };
    m.starts_with("image/png")
        || m.starts_with("image/apng")
        || m.starts_with("image/jpeg")
        || m.starts_with("image/webp")
        || m.starts_with("image/gif")
        || m.starts_with("image/avif")
        || m.starts_with("image/svg+xml")
}

/// Pick the highest-quality artwork from a kind's returned list: score
/// (community votes) first, then download count. Items whose MIME the
/// frontend can't render (e.g. `.ico`) are deprioritized so a best-pick
/// icon/logo is always displayable. Keeps the item's mime so the frontend
/// can tell whether it is animated (APNG / WebP) vs static.
fn pick_best(mut items: Vec<SgdbArtwork>) -> Option<SgdbArtwork> {
    items.sort_by(|a, b| {
        // Renderable art (png/jpg/webp) outranks unrenderable (ico), then
        // score, then download count — a single stable ordering so a
        // best-pick icon/logo is always displayable in the media picker.
        is_renderable_mime(b.mime.as_deref())
            .cmp(&is_renderable_mime(a.mime.as_deref()))
            .then(
                b.score
                    .unwrap_or(0.0)
                    .partial_cmp(&a.score.unwrap_or(0.0))
                    .unwrap_or(std::cmp::Ordering::Equal),
            )
            .then(b.downloads.unwrap_or(0).cmp(&a.downloads.unwrap_or(0)))
    });
    items.into_iter().next()
}

/// Minimum gap between SteamGridDB request starts. The free tier rate-limits
/// hard, so the media picker's "fetch ALL images" pagination throttles page
/// requests through this global lock instead of firing a burst.
const MIN_REQUEST_GAP_MS: u64 = 300;
/// Max pages fetched per kind in the "all images" path (50/page → 300 max).
const MAX_ALL_PAGES: u32 = 6;
/// Items per page returned by the v2 API (also the "last page" signal).
const PAGE_SIZE: usize = 50;

/// Process-wide request throttle shared by every SGDB HTTP call.
static SGDB_RATE_LOCK: OnceLock<Mutex<Instant>> = OnceLock::new();

/// Sleep only as long as needed to keep `MIN_REQUEST_GAP_MS` between request
/// starts. The wait is computed under the lock but the lock is dropped before
/// the sleep so the future stays `Send` (a `std::sync::Mutex` guard must not
/// cross an `.await`). A `tokio::sync::Mutex` would be cleaner but drags in a
/// tokio feature; the small race (two callers both sleeping once) is harmless.
async fn throttle_request() {
    let lock = SGDB_RATE_LOCK.get_or_init(|| Mutex::new(Instant::now()));
    let mut wait_ms = 0u64;
    {
        let mut last = lock.lock().unwrap();
        let elapsed = last.elapsed().as_millis() as u64;
        if elapsed < MIN_REQUEST_GAP_MS {
            wait_ms = MIN_REQUEST_GAP_MS - elapsed;
        }
        *last = Instant::now();
    }
    if wait_ms > 0 {
        tokio::time::sleep(Duration::from_millis(wait_ms)).await;
    }
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

    /// Fetch just the static variant of a kind (used for icons/logos,
    /// which are flat art where animated uploads are rare).
    async fn fetch_kind_static(
        &self,
        api_key: &str,
        app_id: u32,
        kind: SgdbKind,
    ) -> Option<SgdbArtwork> {
        self.fetch_kind_with_types(api_key, app_id, kind, "static").await
    }

    /// Fetch ALL pages of a kind/types combo, throttled to respect the API's
    /// rate limit. Stops at the first short page (fewer than `PAGE_SIZE`
    /// items) or `MAX_ALL_PAGES`, whichever comes first — so a game with
    /// hundreds of community uploads still resolves within a bounded number
    /// of requests instead of hammering the endpoint.
    async fn fetch_kind_all_pages(
        &self,
        api_key: &str,
        app_id: u32,
        kind: SgdbKind,
        types: &str,
    ) -> Vec<SgdbArtwork> {
        let mut all = Vec::new();
        for page in 0..MAX_ALL_PAGES {
            let url = format!(
                "{API_BASE}/{}/{}?types={types}&nsfw=false&humor=false&epilepsy=false&page={page}",
                kind.path(),
                app_id
            );
            throttle_request().await;
            let resp = match self
                .client
                .get(&url)
                .header("Authorization", format!("Bearer {api_key}"))
                .send()
                .await
            {
                Ok(r) => r,
                Err(_) => break,
            };
            if !resp.status().is_success() {
                break;
            }
            let body: SgdbApiResponse = match resp.json().await {
                Ok(b) => b,
                Err(_) => break,
            };
            if !body.success {
                break;
            }
            let n = body.data.len();
            all.extend(body.data);
            if n < PAGE_SIZE {
                break; // last page
            }
        }
        all
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

/// Fetch all four artwork kinds for one AppID in parallel. Grid + hero pull
/// both animated and static variants (the animated art plays on hover / as
/// the hero backdrop); icon + logo are fetched static-only.
async fn fetch_assets(api_key: &str, app_id: u32) -> SgdbAssets {
    let (grid, hero, icon, logo) = tokio::join!(
        service().fetch_kind(api_key, app_id, SgdbKind::Grid),
        service().fetch_kind(api_key, app_id, SgdbKind::Hero),
        service().fetch_kind_static(api_key, app_id, SgdbKind::Icon),
        service().fetch_kind_static(api_key, app_id, SgdbKind::Logo),
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
        icon_url: icon.as_ref().and_then(|i| i.url.clone()),
        icon_mime: icon.and_then(|i| i.mime),
        logo_url: logo.as_ref().and_then(|l| l.url.clone()),
        logo_mime: logo.and_then(|l| l.mime),
    }
}

/// Convert raw API items into picker items, keeping only renderable MIMEs
/// (png/jpg/webp) and sorting by community score so the best uploads lead.
fn to_all_artwork_items(mut items: Vec<SgdbArtwork>) -> Vec<SgdbArtworkItem> {
    items.sort_by(|a, b| {
        b.score
            .unwrap_or(0.0)
            .partial_cmp(&a.score.unwrap_or(0.0))
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(b.downloads.unwrap_or(0).cmp(&a.downloads.unwrap_or(0)))
    });
    items
        .into_iter()
        .filter(|a| is_renderable_mime(a.mime.as_deref()))
        .filter_map(|a| {
            let url = a.url?;
            Some(SgdbArtworkItem {
                url,
                mime: a.mime.unwrap_or_default(),
                width: a.width.unwrap_or(0),
                height: a.height.unwrap_or(0),
                score: a.score.unwrap_or(0.0),
            })
        })
        .collect()
}

/// Fetch EVERY upload SteamGridDB has for an AppID — every page of every
/// kind — so the media picker can show the full gallery instead of just the
/// single best grid/hero. Pages are throttled via [`throttle_request`].
async fn fetch_all_assets(api_key: &str, app_id: u32) -> SgdbAllAssets {
    let (grids, heroes, icons, logos) = tokio::join!(
        async {
            let mut v = service()
                .fetch_kind_all_pages(api_key, app_id, SgdbKind::Grid, "static")
                .await;
            v.extend(
                service()
                    .fetch_kind_all_pages(api_key, app_id, SgdbKind::Grid, "animated")
                    .await,
            );
            to_all_artwork_items(v)
        },
        async {
            let mut v = service()
                .fetch_kind_all_pages(api_key, app_id, SgdbKind::Hero, "static")
                .await;
            v.extend(
                service()
                    .fetch_kind_all_pages(api_key, app_id, SgdbKind::Hero, "animated")
                    .await,
            );
            to_all_artwork_items(v)
        },
        async {
            let v = service()
                .fetch_kind_all_pages(api_key, app_id, SgdbKind::Icon, "static")
                .await;
            to_all_artwork_items(v)
        },
        async {
            let v = service()
                .fetch_kind_all_pages(api_key, app_id, SgdbKind::Logo, "static")
                .await;
            to_all_artwork_items(v)
        },
    );
    SgdbAllAssets {
        grids,
        heroes,
        icons,
        logos,
    }
}

/// Whether a stored result carries any artwork (negatives are cached too).
fn has_art(assets: &SgdbAssets) -> bool {
    assets.grid_url.is_some()
        || assets.grid_animated_url.is_some()
        || assets.hero_url.is_some()
        || assets.hero_animated_url.is_some()
        || assets.icon_url.is_some()
        || assets.logo_url.is_some()
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

/// Cache envelope for the full-gallery payload (kept separate from the
/// best-art cache so the two shapes never collide).
#[derive(Debug, Serialize, Deserialize, Clone)]
struct CachedSgdbAllAssets {
    #[serde(default)]
    data: Option<SgdbAllAssets>,
    updated_at: u64,
}

const ALL_CACHE_KEY_PREFIX: &str = "sgdb:all:v1:";

fn all_cache_key(app_id: u32) -> String {
    format!("{ALL_CACHE_KEY_PREFIX}{app_id}")
}

/// Fetch every SteamGridDB upload for a Steam AppID (all pages of grids,
/// heroes, icons and logos), for the edit-modal media picker. Returns `None`
/// when no API key is configured or the game has no community artwork.
///
/// Unlike [`sgdb_get_assets`] (which returns one best grid + hero), this
/// returns the full gallery so the user can browse every community upload.
/// The paginated fetch is throttled to respect the API's rate limit, and the
/// result is cached for 7 days under its own key.
#[tauri::command]
pub async fn sgdb_get_all_assets(
    app: tauri::AppHandle,
    steam_app_id: u32,
) -> Option<SgdbAllAssets> {
    let db = app.state::<Db>().inner().clone();

    // Cache hit? Return the full gallery (or None if the cached negative).
    if let Ok(Some(raw)) = crate::db::kv::get(&db, &all_cache_key(steam_app_id)) {
        if let Ok(cached) = serde_json::from_str::<CachedSgdbAllAssets>(&raw) {
            if cached.updated_at + CACHE_TTL_MS > now_ms() {
                return cached.data.filter(|a| {
                    !(a.grids.is_empty()
                        && a.heroes.is_empty()
                        && a.icons.is_empty()
                        && a.logos.is_empty())
                });
            }
        }
    }

    if !has_api_key() {
        return None;
    }
    let api_key = crate::config::get_steamgriddb_api_key();

    let assets = fetch_all_assets(&api_key, steam_app_id).await;
    let envelope = CachedSgdbAllAssets {
        data: Some(assets.clone()),
        updated_at: now_ms(),
    };
    if let Ok(json) = serde_json::to_string(&envelope) {
        let key = all_cache_key(steam_app_id);
        if let Err(e) = crate::db::kv::set(&db, &key, &json) {
            eprintln!("[steamgriddb] all-assets cache write failed for {key}: {e}");
        }
    }

    let has_any = !(assets.grids.is_empty()
        && assets.heroes.is_empty()
        && assets.icons.is_empty()
        && assets.logos.is_empty());
    has_any.then_some(assets)
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
            width: Some(600),
            height: Some(900),
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
    fn pick_best_prefers_renderable_mime_over_ico() {
        // The icon endpoint mixes .ico (image/vnd.microsoft.icon) with
        // png; the picker can't render .ico, so png must win even with a
        // lower score.
        let items = vec![
            art("icon.ico", "image/vnd.microsoft.icon", 9.0, 500),
            art("icon.png", "image/png", 1.0, 10),
        ];
        let best = pick_best(items).expect("should pick one");
        assert_eq!(best.url.as_deref(), Some("icon.png"));
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
            icon_url: Some("https://cdn/icon.png".into()),
            icon_mime: Some("image/png".into()),
            logo_url: None,
            logo_mime: None,
        };
        let json = serde_json::to_value(&assets).unwrap();
        assert!(json.get("gridUrl").is_some());
        assert!(json.get("grid_animated_url").is_none());
        assert!(json.get("gridAnimatedUrl").is_some());
        assert!(json.get("heroUrl").is_some());
        assert!(json.get("heroAnimatedUrl").is_some());
        assert_eq!(json.get("heroAnimatedUrl").unwrap().as_str(), None);
        assert!(json.get("iconUrl").is_some());
        assert_eq!(json.get("iconUrl").unwrap().as_str(), Some("https://cdn/icon.png"));
        assert!(json.get("logoUrl").is_some());
        assert_eq!(json.get("logoUrl").unwrap().as_str(), None);
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
            icon_url: None,
            icon_mime: None,
            logo_url: None,
            logo_mime: None,
        };
        assert!(!has_art(&none));

        let animated_grid_only = SgdbAssets {
            grid_animated_url: Some("https://cdn/g.webp".into()),
            ..none.clone()
        };
        assert!(has_art(&animated_grid_only));

        let static_hero_only = SgdbAssets {
            hero_url: Some("https://cdn/h.png".into()),
            ..none.clone()
        };
        assert!(has_art(&static_hero_only));

        let icon_only = SgdbAssets {
            icon_url: Some("https://cdn/i.png".into()),
            ..none
        };
        assert!(has_art(&icon_only));
    }

    #[test]
    fn response_deserializes_with_missing_fields() {
        let raw = r#"{"success":true,"data":[{"id":1,"url":"https://cdn/a.png","mime":"image/png"}]}"#;
        let resp: SgdbApiResponse = serde_json::from_str(raw).unwrap();
        assert!(resp.success);
        assert_eq!(resp.data.len(), 1);
        assert_eq!(resp.data[0].score, None);
    }

    #[test]
    fn all_artwork_items_keep_every_renderable_upload() {
        let items = vec![
            art("low.png", "image/png", 0.2, 10),
            art("top.webp", "image/webp", 5.0, 3),
            art("bad.ico", "image/vnd.microsoft.icon", 9.0, 500),
        ];
        let converted = to_all_artwork_items(items);
        // The picker shows the FULL gallery: both renderable uploads survive
        // (unlike pick_best, which collapses to one), and ico is dropped.
        assert_eq!(converted.len(), 2);
        // Highest score leads.
        assert_eq!(converted[0].url, "top.webp");
        assert_eq!(converted[0].width, 600);
        assert_eq!(converted[0].height, 900);
    }

    #[test]
    fn all_artwork_items_drops_unrenderable_uploads() {
        let converted = to_all_artwork_items(vec![art("a.ico", "image/vnd.microsoft.icon", 1.0, 1)]);
        assert!(converted.is_empty());
    }
}
