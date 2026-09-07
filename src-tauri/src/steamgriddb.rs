//! SteamGridDB artwork service (steamgriddb.com).
//!
//! Fetches community grid (poster), hero (wide banner), icon (square) and
//! logo (clear logo) artwork for a Steam AppID or game name, preferring
//! ANIMATED assets (APNG / animated WebP) for grid/hero when the community has
//! uploaded them, and falling back to static art otherwise. Icons and logos are
//! fetched static-only (flat art — animated uploads are rare).
//!
//! The service:
//! - Requires a free SteamGridDB API key, supplied via the
//!   `STEAMGRIDDB_API_KEY` environment variable (`.env` in dev, baked into
//!   the binary at build time in production — see `crate::config`). When no
//!   key is present the service is a silent no-op and games keep their
//!   existing art.
//! - Queries the v2 API per kind (`/grids/...`, `/heroes/...`, `/icons/...`,
//!   `/logos/...`) by Steam AppID or resolved SteamGridDB game ID.
//!   Uses `types=animated` first, then `types=static`, so "animated when
//!   possible" is decided by the API rather than sniffed from file
//!   extensions.
//! - Supports .ico artwork across icons and media picker candidates.
//! - Caches per-target results (including negatives — games with no
//!   community art) in the SQLite KV store with a 7-day TTL,
//!   keyed `sgdb:v3:{target}`, so library artwork is only fetched once per week.

use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::db::Db;

/// Base URL of the SteamGridDB v2 API.
const API_BASE: &str = "https://www.steamgriddb.com/api/v2";
/// KV key prefix for cached per-target results.
const CACHE_KEY_PREFIX: &str = "sgdb:v3:";
/// KV key prefix for full gallery results.
const ALL_CACHE_KEY_PREFIX: &str = "sgdb:all:v1:";
/// KV key prefix for resolved game IDs from autocomplete search.
const SEARCH_CACHE_PREFIX: &str = "sgdb:gameid:v1:";
/// Cache TTL for hits and negatives (7 days — community art rarely churns).
const CACHE_TTL_MS: u64 = 7 * 24 * 60 * 60 * 1000;

/// The artwork kinds we consume. `path_prefix()` maps to the v2 API route.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SgdbKind {
    Grid,
    Hero,
    Icon,
    Logo,
}

impl SgdbKind {
    fn path_prefix(self) -> &'static str {
        match self {
            SgdbKind::Grid => "grids",
            SgdbKind::Hero => "heroes",
            SgdbKind::Icon => "icons",
            SgdbKind::Logo => "logos",
        }
    }
}

/// Lookup target: either a Steam AppID or an internal SteamGridDB game ID.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SgdbTarget {
    Steam(u32),
    Game(u64),
}

impl SgdbTarget {
    fn endpoint_path(self, kind: SgdbKind) -> String {
        match self {
            SgdbTarget::Steam(id) => format!("{}/steam/{id}", kind.path_prefix()),
            SgdbTarget::Game(id) => format!("{}/game/{id}", kind.path_prefix()),
        }
    }

    fn best_cache_key(self) -> String {
        match self {
            SgdbTarget::Steam(id) => format!("{CACHE_KEY_PREFIX}{id}"),
            SgdbTarget::Game(id) => format!("{CACHE_KEY_PREFIX}game:{id}"),
        }
    }

    fn all_cache_key(self) -> String {
        match self {
            SgdbTarget::Steam(id) => format!("{ALL_CACHE_KEY_PREFIX}{id}"),
            SgdbTarget::Game(id) => format!("{ALL_CACHE_KEY_PREFIX}game:{id}"),
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

/// All artwork SteamGridDB has for one target, grouped by kind. The media
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

/// Combined artwork for one game. Every field is optional: the
/// community may have grids but no heroes (or vice versa), and a game may
/// have no artwork at all (everything `None`).
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
    /// Best animated hero — shown as the hero backdrop.
    pub hero_animated_url: Option<String>,
    pub hero_animated_mime: Option<String>,
    /// Best square icon (flat community icon art, supports png/webp/ico).
    pub icon_url: Option<String>,
    pub icon_mime: Option<String>,
    /// Best clear logo (flat transparent logo art).
    pub logo_url: Option<String>,
    pub logo_mime: Option<String>,
}

/// One artwork item from the v2 API `data` array.
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

#[derive(Debug, Deserialize, Clone, Default)]
struct SgdbSearchItem {
    id: u64,
    name: String,
}

#[derive(Debug, Deserialize, Default)]
struct SgdbSearchResponse {
    #[serde(default)]
    success: bool,
    #[serde(default)]
    data: Vec<SgdbSearchItem>,
}

/// Cache envelope stored in the KV store.
#[derive(Debug, Serialize, Deserialize, Clone)]
struct CachedSgdbAssets {
    #[serde(default)]
    data: Option<SgdbAssets>,
    /// Unix-millisecond timestamp of the cache write (TTL checks).
    updated_at: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct CachedGameId {
    id: Option<u64>,
    updated_at: u64,
}

fn normalize_title(title: &str) -> String {
    title
        .to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn search_cache_key(norm_name: &str) -> String {
    format!("{SEARCH_CACHE_PREFIX}{norm_name}")
}

/// MIME types the frontend can render in an `<img>` tag or download as artwork.
/// Includes png, webp, jpeg, gif, avif, svg, and ico (vnd.microsoft.icon / x-icon).
fn is_renderable_mime(mime: Option<&str>) -> bool {
    let Some(m) = mime else { return true; };
    m.starts_with("image/png")
        || m.starts_with("image/apng")
        || m.starts_with("image/jpeg")
        || m.starts_with("image/webp")
        || m.starts_with("image/gif")
        || m.starts_with("image/avif")
        || m.starts_with("image/svg+xml")
        || m.starts_with("image/x-icon")
        || m.starts_with("image/vnd.microsoft.icon")
        || m.starts_with("image/ico")
}

fn is_renderable_art(art: &SgdbArtwork) -> bool {
    if is_renderable_mime(art.mime.as_deref()) {
        return true;
    }
    if let Some(u) = art.url.as_deref() {
        let clean = u.split('?').next().unwrap_or(u).to_ascii_lowercase();
        if clean.ends_with(".png")
            || clean.ends_with(".jpg")
            || clean.ends_with(".jpeg")
            || clean.ends_with(".webp")
            || clean.ends_with(".gif")
            || clean.ends_with(".ico")
        {
            return true;
        }
    }
    false
}

/// Pick the highest-quality artwork from a kind's returned list: renderable
/// formats first, then score (community votes), then download count.
fn pick_best(mut items: Vec<SgdbArtwork>) -> Option<SgdbArtwork> {
    items.sort_by(|a, b| {
        is_renderable_art(b)
            .cmp(&is_renderable_art(a))
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

/// Minimum gap between SteamGridDB request starts.
const MIN_REQUEST_GAP_MS: u64 = 300;
/// Max pages fetched per kind in the "all images" path (50/page → 300 max).
const MAX_ALL_PAGES: u32 = 6;
/// Items per page returned by the v2 API (also the "last page" signal).
const PAGE_SIZE: usize = 50;

/// Process-wide request throttle shared by every SGDB HTTP call.
static SGDB_RATE_LOCK: OnceLock<Mutex<Instant>> = OnceLock::new();

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

    async fn fetch_kind(
        &self,
        api_key: &str,
        target: SgdbTarget,
        kind: SgdbKind,
    ) -> (Option<SgdbArtwork>, Option<SgdbArtwork>) {
        tokio::join!(
            self.fetch_kind_with_types(api_key, target, kind, "animated"),
            self.fetch_kind_with_types(api_key, target, kind, "static"),
        )
    }

    async fn fetch_kind_static(
        &self,
        api_key: &str,
        target: SgdbTarget,
        kind: SgdbKind,
    ) -> Option<SgdbArtwork> {
        self.fetch_kind_with_types(api_key, target, kind, "static").await
    }

    async fn fetch_kind_all_pages(
        &self,
        api_key: &str,
        target: SgdbTarget,
        kind: SgdbKind,
        types: &str,
    ) -> Vec<SgdbArtwork> {
        let mut all = Vec::new();
        for page in 0..MAX_ALL_PAGES {
            let url = format!(
                "{API_BASE}/{}?types={types}&nsfw=false&humor=false&epilepsy=false&page={page}",
                target.endpoint_path(kind)
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
        target: SgdbTarget,
        kind: SgdbKind,
        types: &str,
    ) -> Option<SgdbArtwork> {
        let url = format!(
            "{API_BASE}/{}?types={types}&nsfw=false&humor=false&epilepsy=false",
            target.endpoint_path(kind)
        );
        throttle_request().await;
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
                eprintln!("[steamgriddb] API error for {:?} ({types}): {err}", target);
            }
            return None;
        }
        if body.data.is_empty() {
            return None;
        }
        pick_best(body.data)
    }

    async fn search_game_id(&self, api_key: &str, game_name: &str) -> Option<u64> {
        let norm_query = normalize_title(game_name);
        if norm_query.is_empty() {
            return None;
        }

        let encoded = urlencoding::encode(&norm_query);
        let url = format!("{API_BASE}/search/autocomplete/{encoded}");
        throttle_request().await;
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
        let body: SgdbSearchResponse = resp.json().await.ok()?;
        if !body.success || body.data.is_empty() {
            return None;
        }

        // 1. Exact normalized match
        if let Some(m) = body.data.iter().find(|i| normalize_title(&i.name) == norm_query) {
            return Some(m.id);
        }

        // 2. Item starts with query or query starts with item
        if let Some(m) = body.data.iter().find(|i| {
            let n = normalize_title(&i.name);
            n.starts_with(&norm_query) || norm_query.starts_with(&n)
        }) {
            return Some(m.id);
        }

        // 3. Item contains query or query contains item
        if let Some(m) = body.data.iter().find(|i| {
            let n = normalize_title(&i.name);
            n.contains(&norm_query) || norm_query.contains(&n)
        }) {
            return Some(m.id);
        }

        // 4. Default to top result
        body.data.first().map(|i| i.id)
    }
}

static SGDB_SERVICE: std::sync::OnceLock<SgdbService> = std::sync::OnceLock::new();

fn service() -> &'static SgdbService {
    SGDB_SERVICE.get_or_init(SgdbService::new)
}

fn has_api_key() -> bool {
    !crate::config::get_steamgriddb_api_key().is_empty()
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn persist(db: &Db, target: SgdbTarget, assets: &SgdbAssets) {
    let envelope = CachedSgdbAssets {
        data: Some(assets.clone()),
        updated_at: now_ms(),
    };
    if let Ok(json) = serde_json::to_string(&envelope) {
        let key = target.best_cache_key();
        if let Err(e) = crate::db::kv::set(db, &key, &json) {
            eprintln!("[steamgriddb] cache write failed for {key}: {e}");
        }
    }
}

fn read_cache(db: &Db, target: SgdbTarget) -> Option<Option<SgdbAssets>> {
    let raw = crate::db::kv::get(db, &target.best_cache_key()).ok().flatten()?;
    let cached = serde_json::from_str::<CachedSgdbAssets>(&raw).ok()?;
    (cached.updated_at + CACHE_TTL_MS > now_ms()).then_some(cached.data)
}

async fn resolve_game_id(db: &Db, api_key: &str, game_name: &str) -> Option<u64> {
    let norm = normalize_title(game_name);
    if norm.is_empty() {
        return None;
    }
    let key = search_cache_key(&norm);
    if let Ok(Some(raw)) = crate::db::kv::get(db, &key) {
        if let Ok(cached) = serde_json::from_str::<CachedGameId>(&raw) {
            if cached.updated_at + CACHE_TTL_MS > now_ms() {
                return cached.id;
            }
        }
    }

    let resolved_id = service().search_game_id(api_key, game_name).await;
    let envelope = CachedGameId {
        id: resolved_id,
        updated_at: now_ms(),
    };
    if let Ok(json) = serde_json::to_string(&envelope) {
        let _ = crate::db::kv::set(db, &key, &json);
    }
    resolved_id
}

async fn fetch_assets(api_key: &str, target: SgdbTarget) -> SgdbAssets {
    let (grid, hero, icon, logo) = tokio::join!(
        service().fetch_kind(api_key, target, SgdbKind::Grid),
        service().fetch_kind(api_key, target, SgdbKind::Hero),
        service().fetch_kind_static(api_key, target, SgdbKind::Icon),
        service().fetch_kind_static(api_key, target, SgdbKind::Logo),
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
        .filter(is_renderable_art)
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

async fn fetch_all_assets(api_key: &str, target: SgdbTarget) -> SgdbAllAssets {
    let (grids, heroes, icons, logos) = tokio::join!(
        async {
            let mut v = service()
                .fetch_kind_all_pages(api_key, target, SgdbKind::Grid, "static")
                .await;
            v.extend(
                service()
                    .fetch_kind_all_pages(api_key, target, SgdbKind::Grid, "animated")
                    .await,
            );
            to_all_artwork_items(v)
        },
        async {
            let mut v = service()
                .fetch_kind_all_pages(api_key, target, SgdbKind::Hero, "static")
                .await;
            v.extend(
                service()
                    .fetch_kind_all_pages(api_key, target, SgdbKind::Hero, "animated")
                    .await,
            );
            to_all_artwork_items(v)
        },
        async {
            let v = service()
                .fetch_kind_all_pages(api_key, target, SgdbKind::Icon, "static")
                .await;
            to_all_artwork_items(v)
        },
        async {
            let v = service()
                .fetch_kind_all_pages(api_key, target, SgdbKind::Logo, "static")
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

fn has_art(assets: &SgdbAssets) -> bool {
    assets.grid_url.is_some()
        || assets.grid_animated_url.is_some()
        || assets.hero_url.is_some()
        || assets.hero_animated_url.is_some()
        || assets.icon_url.is_some()
        || assets.logo_url.is_some()
}

fn has_any_all_assets(assets: &SgdbAllAssets) -> bool {
    !(assets.grids.is_empty()
        && assets.heroes.is_empty()
        && assets.icons.is_empty()
        && assets.logos.is_empty())
}

/// Fetch SteamGridDB grid + hero + icon + logo artwork for a single game.
/// Looks up by Steam AppID first (if provided) and falls back to searching
/// SteamGridDB by game name (e.g. for Minecraft or non-Steam games).
#[tauri::command]
pub async fn sgdb_get_assets(
    app: tauri::AppHandle,
    steam_app_id: Option<u32>,
    game_name: Option<String>,
) -> Option<SgdbAssets> {
    let db = app.state::<Db>().inner().clone();

    // 1. Try steam_app_id if provided
    if let Some(app_id) = steam_app_id {
        let target = SgdbTarget::Steam(app_id);
        if let Some(cached) = read_cache(&db, target) {
            if let Some(assets) = cached.filter(has_art) {
                return Some(assets);
            }
        } else if has_api_key() {
            let api_key = crate::config::get_steamgriddb_api_key();
            let assets = fetch_assets(&api_key, target).await;
            persist(&db, target, &assets);
            if has_art(&assets) {
                return Some(assets);
            }
        }
    }

    // 2. Fall back to search by game_name if provided
    let name = game_name.as_deref().map(str::trim).filter(|s| !s.is_empty())?;
    if !has_api_key() {
        return None;
    }
    let api_key = crate::config::get_steamgriddb_api_key();

    let game_id = resolve_game_id(&db, &api_key, name).await?;
    let target = SgdbTarget::Game(game_id);

    if let Some(cached) = read_cache(&db, target) {
        return cached.filter(has_art);
    }

    let assets = fetch_assets(&api_key, target).await;
    persist(&db, target, &assets);
    has_art(&assets).then_some(assets)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct CachedSgdbAllAssets {
    #[serde(default)]
    data: Option<SgdbAllAssets>,
    updated_at: u64,
}

fn persist_all(db: &Db, target: SgdbTarget, assets: &SgdbAllAssets) {
    let envelope = CachedSgdbAllAssets {
        data: Some(assets.clone()),
        updated_at: now_ms(),
    };
    if let Ok(json) = serde_json::to_string(&envelope) {
        let key = target.all_cache_key();
        if let Err(e) = crate::db::kv::set(db, &key, &json) {
            eprintln!("[steamgriddb] all-assets cache write failed for {key}: {e}");
        }
    }
}

fn read_all_cache(db: &Db, target: SgdbTarget) -> Option<Option<SgdbAllAssets>> {
    let raw = crate::db::kv::get(db, &target.all_cache_key()).ok().flatten()?;
    let cached = serde_json::from_str::<CachedSgdbAllAssets>(&raw).ok()?;
    (cached.updated_at + CACHE_TTL_MS > now_ms()).then_some(cached.data)
}

/// Fetch every SteamGridDB upload for a Steam AppID or game name (all pages of
/// grids, heroes, icons and logos), for the edit-modal media picker.
#[tauri::command]
pub async fn sgdb_get_all_assets(
    app: tauri::AppHandle,
    steam_app_id: Option<u32>,
    game_name: Option<String>,
) -> Option<SgdbAllAssets> {
    let db = app.state::<Db>().inner().clone();

    // 1. Try steam_app_id if provided
    if let Some(app_id) = steam_app_id {
        let target = SgdbTarget::Steam(app_id);
        if let Some(cached) = read_all_cache(&db, target) {
            if let Some(assets) = cached.filter(has_any_all_assets) {
                return Some(assets);
            }
        } else if has_api_key() {
            let api_key = crate::config::get_steamgriddb_api_key();
            let assets = fetch_all_assets(&api_key, target).await;
            persist_all(&db, target, &assets);
            if has_any_all_assets(&assets) {
                return Some(assets);
            }
        }
    }

    // 2. Fall back to search by game_name if provided
    let name = game_name.as_deref().map(str::trim).filter(|s| !s.is_empty())?;
    if !has_api_key() {
        return None;
    }
    let api_key = crate::config::get_steamgriddb_api_key();

    let game_id = resolve_game_id(&db, &api_key, name).await?;
    let target = SgdbTarget::Game(game_id);

    if let Some(cached) = read_all_cache(&db, target) {
        return cached.filter(has_any_all_assets);
    }

    let assets = fetch_all_assets(&api_key, target).await;
    persist_all(&db, target, &assets);
    has_any_all_assets(&assets).then_some(assets)
}

/// Batch variant of [`sgdb_get_assets`] for store/library grids.
#[tauri::command]
pub async fn sgdb_get_assets_batch(
    app: tauri::AppHandle,
    steam_app_ids: Vec<u32>,
) -> HashMap<u32, SgdbAssets> {
    use futures::stream::{self, StreamExt};

    const MAX_CONCURRENT: usize = 6;

    let db = app.state::<Db>().inner().clone();

    let mut resolved: HashMap<u32, SgdbAssets> = HashMap::new();
    let mut cold: Vec<u32> = Vec::new();
    let mut seen: HashSet<u32> = HashSet::new();
    for app_id in steam_app_ids {
        if !seen.insert(app_id) {
            continue;
        }
        let target = SgdbTarget::Steam(app_id);
        match read_cache(&db, target) {
            Some(Some(assets)) if has_art(&assets) => {
                resolved.insert(app_id, assets);
            }
            Some(_) => continue,
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
                let assets = fetch_assets(&api_key, SgdbTarget::Steam(app_id)).await;
                (app_id, assets)
            }
        })
        .buffer_unordered(MAX_CONCURRENT)
        .collect()
        .await;

    for (app_id, assets) in fetched {
        persist(&db, SgdbTarget::Steam(app_id), &assets);
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
    fn pick_best_prefers_renderable_mime_over_unrenderable() {
        let items = vec![
            art("file.bin", "application/octet-stream", 9.0, 500),
            art("icon.png", "image/png", 1.0, 10),
        ];
        let best = pick_best(items).expect("should pick one");
        assert_eq!(best.url.as_deref(), Some("icon.png"));
    }

    #[test]
    fn pick_best_accepts_ico() {
        let items = vec![
            art("file.bin", "application/octet-stream", 10.0, 500),
            art("icon.ico", "image/vnd.microsoft.icon", 9.0, 500),
            art("icon.png", "image/png", 1.0, 10),
        ];
        let best = pick_best(items).expect("should pick one");
        assert_eq!(best.url.as_deref(), Some("icon.ico"));
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
            icon_url: Some("https://cdn/icon.ico".into()),
            icon_mime: Some("image/vnd.microsoft.icon".into()),
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
        assert_eq!(json.get("iconUrl").unwrap().as_str(), Some("https://cdn/icon.ico"));
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
            icon_url: Some("https://cdn/i.ico".into()),
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
            art("good.ico", "image/vnd.microsoft.icon", 9.0, 500),
            art("bad.bin", "application/octet-stream", 9.0, 500),
        ];
        let converted = to_all_artwork_items(items);
        assert_eq!(converted.len(), 3);
        assert_eq!(converted[0].url, "good.ico");
        assert_eq!(converted[0].width, 600);
        assert_eq!(converted[0].height, 900);
    }

    #[test]
    fn all_artwork_items_drops_unrenderable_uploads() {
        let converted = to_all_artwork_items(vec![art("a.bin", "application/octet-stream", 1.0, 1)]);
        assert!(converted.is_empty());
    }

    #[test]
    fn normalize_title_strips_punctuation_and_spaces() {
        assert_eq!(normalize_title("Minecraft"), "minecraft");
        assert_eq!(normalize_title("Minecraft: Java Edition"), "minecraft java edition");
        assert_eq!(normalize_title("  The   Witcher 3:  Wild Hunt  "), "the witcher 3 wild hunt");
    }
}
