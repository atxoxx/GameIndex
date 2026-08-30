//! Store catalogue, wishlist, source-cache and language commands.

use tauri::Manager;
use crate::db;
use crate::game_scraper;
use crate::game_scraper::{GameMetadataResult, IgdbPlatformInfo, IgdbReview, PcRequirementsPayload, ReviewFetchResult, StoreGameSummary};

/// Phase-1 wrapper around the store_cache DAO. The frontend used to
/// ship a single JSON blob under `<app_data_dir>/store_cache.json`
/// for the IGDB catalog cache; that data now lives in the
/// `store_cache` + `store_detail` SQLite tables. To preserve the
/// existing Tauri command shape (the React hook invokes
/// `save_store_cache` with a pre-serialized payload), we round-trip
/// the JSON into rows here.
#[tauri::command]
pub fn save_store_cache(app: tauri::AppHandle, data: String) -> Result<(), String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let parsed: serde_json::Value =
        serde_json::from_str(&data).map_err(|e| format!("parse: {e}"))?;
    // Old shape: `{ "categories": { "<category>": <obj> },
    //   "detailCache": { "<slug>": <obj> } }`.
    if let Some(cats) = parsed.get("categories").and_then(|v| v.as_object()) {
        for (category, payload) in cats {
            let wrapped =
                serde_json::to_string(payload).map_err(|e| format!("wrap category: {e}"))?;
            db::store_cache::upsert_category_page(
                db_state.inner(),
                category,
                0,
                &wrapped,
            )?;
        }
    }
    if let Some(detail) = parsed.get("detailCache").and_then(|v| v.as_object()) {
        for (slug, payload) in detail {
            let wrapped =
                serde_json::to_string(payload).map_err(|e| format!("wrap detail: {e}"))?;
            db::store_cache::upsert_detail(db_state.inner(), slug, &wrapped)?;
        }
    }
    Ok(())
}

/// Read the most recent store cache blob. Combines all known
/// `(category, page=0)` rows plus every `store_detail` row into the
/// same JSON shape the React frontend already understands.
#[tauri::command]
pub fn load_store_cache(app: tauri::AppHandle) -> Result<String, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let mut out = serde_json::Map::new();
    out.insert(
        "categories".to_string(),
        serde_json::Value::Object(serde_json::Map::new()),
    );
    out.insert(
        "detailCache".to_string(),
        serde_json::Value::Object(serde_json::Map::new()),
    );

    // Categories â€” list every (category, page=0) row. We don't currently
    // paginate beyond 0; if future code adds higher pages this JSON
    // shape will need a `pages` sub-object.
    let conn = db_state.store_cache().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT category, payload_json FROM store_cache WHERE page = 0")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    let cats = out
        .get_mut("categories")
        .and_then(|v| v.as_object_mut())
        .unwrap();
    for row in rows {
        let (cat, payload) = row.map_err(|e| e.to_string())?;
        let value: serde_json::Value =
            serde_json::from_str(&payload).unwrap_or(serde_json::Value::Null);
        cats.insert(cat, value);
    }
    let mut stmt = conn
        .prepare("SELECT slug, payload_json FROM store_detail")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    let details = out
        .get_mut("detailCache")
        .and_then(|v| v.as_object_mut())
        .unwrap();
    for row in rows {
        let (slug, payload) = row.map_err(|e| e.to_string())?;
        let value: serde_json::Value =
            serde_json::from_str(&payload).unwrap_or(serde_json::Value::Null);
        details.insert(slug, value);
    }

    serde_json::to_string(&out).map_err(|e| e.to_string())
}

/// Phase-1 wrapper around the wishlist DAO. The frontend sends a
/// serialised `{entries: {<slug>: <entry>}}` blob; we split it into
/// one row per slug.
#[tauri::command]
pub fn save_wishlist(app: tauri::AppHandle, data: String) -> Result<(), String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let parsed: serde_json::Value = serde_json::from_str(&data)
        .map_err(|e| format!("parse wishlist: {e}"))?;
    let entries = parsed
        .get("entries")
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    for (slug, entry) in &entries {
        let payload =
            serde_json::to_string(entry).map_err(|e| format!("serialize entry: {e}"))?;
        let added_at = entry
            .get("addedAt")
            .and_then(|v| v.as_u64())
            .unwrap_or(now_ms);
        db::wishlist::upsert(db_state.inner(), slug, &payload, added_at)?;
    }
    Ok(())
}

/// Read the wishlist back as the same `{entries: {<slug>: <entry>}}`
/// shape the frontend expects.
#[tauri::command]
pub fn load_wishlist(app: tauri::AppHandle) -> Result<String, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let rows = db::wishlist::list(db_state.inner()).map_err(|e| e.to_string())?;
    let mut entries = serde_json::Map::new();
    for (slug, payload, _added_at) in rows {
        let value: serde_json::Value =
            serde_json::from_str(&payload).unwrap_or(serde_json::Value::Null);
        entries.insert(slug, value);
    }
    Ok(serde_json::json!({ "entries": entries }).to_string())
}

/// Persist the per-(game, source) download-availability map to disk so
/// the Store's source filter doesn't have to re-query every source on
/// every browse session. The frontend owns the in-memory map and calls
/// this with the full `Record<slug, Record<sourceId, boolean>>` JSON.
/// Availability is only computed when the user actually enables a source
/// filter, so this file mostly stays small.
#[tauri::command]
pub fn save_source_cache(app: tauri::AppHandle, data: String) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("source_cache.json");
    std::fs::write(&path, data).map_err(|e| e.to_string())
}

/// Load the persisted source-availability map (empty string if none yet).
#[tauri::command]
pub fn load_source_cache(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = dir.join("source_cache.json");
    if !path.exists() {
        return Ok(String::new());
    }
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Fetch a page of store games from IGDB, optionally narrowed by genre /
/// platform / release-year / rating filters. All filter facets are optional
/// and combine onto the IGDB `where` clause with AND semantics inside
/// `fetch_store_games`. An empty `Vec` is treated the same as `None`.
#[tauri::command]
pub async fn fetch_store_games(
    category: String,
    offset: u32,
    limit: u32,
    genres: Option<Vec<String>>,
    platforms: Option<Vec<u32>>,
    year_min: Option<i32>,
    year_max: Option<i32>,
    rating_min: Option<f64>,
    sort: Option<String>,
) -> Result<Vec<StoreGameSummary>, String> {
    game_scraper::fetch_store_games(
        &category,
        offset,
        limit,
        genres,
        platforms,
        year_min,
        year_max,
        rating_min,
        sort,
    )
    .await
}

/// Search IGDB games live by name query. Accepts the same optional facet
/// filters as `fetch_store_games` (genre / platform / release-year /
/// rating) plus a sort override. All extra args are optional so callers
/// that only pass `query`/`offset`/`limit` keep working (defaults to None).
#[tauri::command]
pub async fn search_store_games(
    query: String,
    offset: u32,
    limit: u32,
    genres: Option<Vec<String>>,
    platforms: Option<Vec<u32>>,
    year_min: Option<i32>,
    year_max: Option<i32>,
    rating_min: Option<f64>,
    sort: Option<String>,
) -> Result<Vec<StoreGameSummary>, String> {
    game_scraper::search_store_games(
        &query,
        offset,
        limit,
        genres,
        platforms,
        year_min,
        year_max,
        rating_min,
        sort,
    )
    .await
}

/// Fetch the full IGDB platform list for the Store filter sidebar.
#[tauri::command]
pub async fn get_igdb_platforms() -> Result<Vec<IgdbPlatformInfo>, String> {
    game_scraper::fetch_igdb_platforms().await
}

/// Fetch full metadata for a single IGDB game by its slug.
#[tauri::command]
pub async fn get_store_game_detail(slug: String) -> Option<GameMetadataResult> {
    game_scraper::get_store_game_detail(&slug).await
}

/// Return a batch of genuinely-random store games for the "Surprise me" modal.
#[tauri::command]
pub async fn get_random_store_games(limit: u32) -> Result<Vec<StoreGameSummary>, String> {
    game_scraper::get_random_store_games(limit).await
}

/// Fetch every game that belongs to a given IGDB collection, sorted
/// by release date ascending. Used by the frontend Game Relations
/// card to populate the "Other in Collection" group on the Store
/// game detail page. `limit` is clamped to 50 internally (IGDB's
/// per-request max) so callers can pass a higher ceiling without
/// worrying about silent truncation.
#[tauri::command]
pub async fn get_collection_games(
    collection_id: u64,
    limit: Option<u32>,
) -> Result<Vec<StoreGameSummary>, String> {
    game_scraper::get_collection_games(collection_id, limit.unwrap_or(50)).await
}

/// Fetch reviews for a game from the best available source (Steam first, IGDB fallback).
/// Returns the reviews and a `source` string ("steam" | "igdb" | "none") so the UI
/// can label them correctly.
///
/// New (post-ReviewViewer-parity) optional filter args, all `None` for "no filter":
///   - `filter_type`        â€” "all" (default) | "recent" | "funny"
///   - `purchase_type`      â€” "all" (default) | "steam" | "other"
///   - `playtime_min_hours` â€” minimum author playtime (client-side filter)
///   - `playtime_max_hours` â€” maximum author playtime (client-side filter)
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn fetch_game_reviews(
    game_name: String,
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
    game_scraper::fetch_game_reviews(
        &game_name,
        steam_app_id,
        cursor,
        language,
        filter_type,
        purchase_type,
        playtime_min_hours,
        playtime_max_hours,
        review_type,
        playtime_device,
        use_helpful_system,
    )
    .await
}

/// Fetch reviews from an external source (metacritic, opencritic, or rawg).
/// Uses web scraping with DDG HTML search fallback for URL resolution.
#[tauri::command]
pub async fn fetch_external_reviews(
    game_name: String,
    source: String,
) -> Result<Vec<IgdbReview>, String> {
    game_scraper::fetch_external_reviews(&game_name, &source).await
}

/// Read the user's chosen UI display language. Returns `None` when unset
/// (the frontend treats that as the `en` default). The same `language`
/// kv key is read by the achievements sync paths via
/// `resolve_language`, so this is the single source of truth.
#[tauri::command]
pub fn get_language(app: tauri::AppHandle) -> Option<String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    db::kv::get(db_state.inner(), "language").ok().flatten()
}

/// Persist the user's chosen UI display language (e.g. "en", "fr",
/// "zh-CN"). Shared with the achievements sync paths.
#[tauri::command]
pub fn set_language(app: tauri::AppHandle, language: String) -> Result<(), String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    db::kv::set(db_state.inner(), "language", &language)
}

/// Fetch the localized "About" payload for every configured language
/// (see `game_scraper::ABOUT_LANGUAGES`) and return them as a bundle.
/// The frontend picks `by_language[uiLang]`, falling back to
/// `by_language[default_language]`, then the first available entry.
#[tauri::command]
pub async fn get_about_bundle(
    steam_app_id: Option<u32>,
    game_name: Option<String>,
) -> game_scraper::AboutBundle {
    game_scraper::fetch_about_bundle(steam_app_id, game_name.as_deref()).await
}

/// Fetch Steam's `pc_requirements` (minimum + recommended) for a
/// game. The backend hits Steam's `appdetails` endpoint, parses
/// the variable HTML into a structured `RequirementsSpec` per
/// tier, and caches the parsed result for 24h per appid. Returns
/// `None` when the game has no Steam appid (the frontend hides
/// the section entirely in that case); returns
/// `Some(PcRequirementsPayload { source: "steam", minimum: None,
/// recommended: None })` when Steam is reachable but hasn't
/// published requirements for the title — the frontend renders a
/// friendly empty state in that branch.
#[tauri::command]
pub async fn get_recommended_config(steam_app_id: Option<u32>) -> Option<PcRequirementsPayload> {
    game_scraper::fetch_system_requirements(steam_app_id).await
}

