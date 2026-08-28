//! Sandboxed JS search plugins.
//!
//! Plugins are user-installed `.js` files that add torrent search
//! sources to the download pipeline. Each file lives at
//! `<app_data_dir>/plugins/<id>.js` with one metadata row in the
//! `plugins` SQLite table (see [`crate::db::plugins`]); the *code*
//! runs inside the QuickJS sandbox in [`runtime`].
//!
//! ## Lifecycle
//!
//! - `plugins_import_file` — read + sha256 + evaluate a candidate file
//!   and return a [`PluginCandidate`]. Nothing is persisted.
//! - `plugins_install` — re-read the file, re-verify the hash, copy it
//!   into `plugins_dir`, upsert the DB row (enabled), load it into the
//!   in-memory source map.
//! - `plugins_remove` / `plugins_toggle` — the obvious bookkeeping.
//! - [`PluginManager::load_enabled`] — startup hook (called from
//!   `lib.rs::setup`): loads every enabled plugin's source into the
//!   in-memory map so searches never touch disk, setting `last_error`
//!   for files that fail to read or evaluate.
//!
//! ## Search pipeline (`search_downloads`)
//!
//! The merged search first runs the built-in sources
//! ([`crate::source_manager::search_online`]), then runs every enabled
//! plugin's `search(query)` in the sandbox. Plugin raw results are
//! cached per `(plugin_id, query)` for 15 minutes (the site policy of
//! the bundled yourbittorrent plugin); the cache holds *raw* results
//! and the match-score / merge pass re-runs per query so cache entries
//! stay small and policy-independent. Plugin failures never fail the
//! whole command — the error is recorded in `last_error` and the other
//! plugins continue.
//!
//! ## Safety model
//!
//! Every plugin search runs on a `spawn_blocking` thread inside a
//! 20-second `tokio::time::timeout`, and the sandbox itself enforces a
//! memory cap plus an instruction budget (see [`runtime`] module docs).
//! A malicious or buggy plugin can at worst stall its own thread until
//! the timeout fires — it cannot hang the app, read files, or touch
//! the network outside the scheme-checked `httpGet` proxy.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{Emitter, Manager};

use crate::db::{self, Db};
use crate::source_manager::{self, MatchedDownload};

mod runtime;

pub use runtime::PluginRawResult;

/// How long raw plugin search results stay fresh (yourbittorrent's
/// documented search-fresh policy).
const PLUGIN_CACHE_TTL: Duration = Duration::from_secs(15 * 60);

/// Outer wall-clock cap for one plugin's sandboxed search.
const PLUGIN_SEARCH_TIMEOUT: Duration = Duration::from_secs(20);

/// Same match floor the built-in source search applies (see
/// `source_manager::search_online`).
const MIN_MATCH_SCORE: f32 = 0.2;

/// Blocking HTTP client User-Agent. Matches the UA the frontend's
/// browser sends so torrent-index APIs don't 403 the plugin calls.
const PLUGIN_HTTP_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// ─── Frontend-facing records ────────────────────────────────────────────────

/// Serialized plugin row for the plugins UI.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub description: String,
    pub source_url: String,
    pub file_hash: String,
    pub enabled: bool,
    pub imported_at: u64,
    pub last_error: Option<String>,
    /// Broad platform class: "pc" | "console" | "hybrid".
    pub platform_category: String,
}

impl From<db::plugins::PluginRow> for PluginInfo {
    fn from(r: db::plugins::PluginRow) -> Self {
        PluginInfo {
            id: r.id,
            name: r.name,
            version: r.version,
            author: r.author,
            description: r.description,
            source_url: r.source_url,
            file_hash: r.file_hash,
            enabled: r.enabled,
            imported_at: r.imported_at,
            last_error: r.last_error,
            platform_category: normalize_platform_category(&r.platform_category),
        }
    }
}

/// Import result for a file that has NOT been installed yet.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PluginCandidate {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub description: String,
    pub source_url: String,
    pub file_hash: String,
    pub file_path: String,
}

/// Result of a bulk enable/disable-all operation: how many plugins
/// changed state, plus the ids (with reasons) that failed to load when
/// enabling so the UI can show a precise warning.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PluginBulkToggleResult {
    pub changed: usize,
    pub failed: Vec<String>,
}

/// One row of the merged download search returned to the frontend.
/// Built-in source results have `provider = "source"` and null plugin
/// fields; plugin results have `provider = "plugin"` plus `pluginId`
/// and their torrent metadata.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DownloadSearchResult {
    pub id: String,
    pub source_name: String,
    pub source_id: String,
    pub title: String,
    pub file_size: String,
    pub uris: Vec<String>,
    pub magnet: Option<String>,
    pub upload_date: Option<String>,
    pub match_score: f32,
    pub is_new: bool,
    pub provider: String,
    pub plugin_id: Option<String>,
    pub infohash: Option<String>,
    pub seeds: Option<u32>,
    pub peers: Option<u32>,
    pub torrent_url: Option<String>,
    pub verified: Option<bool>,
    pub detail_url: Option<String>,
    /// Platform / console a game targets (e.g. "Nintendo Switch",
    /// "NES"). Plugins populate it so the download modal can show
    /// which system a ROM / repack hit belongs to.
    #[serde(default)]
    pub platform: Option<String>,
    /// Upstream site a meta-search result was cached from (e.g.
    /// "RuTracker.org" for a knaben hit). Null for source matches and
    /// for plugins that don't report provenance.
    #[serde(default)]
    pub provenance: Option<String>,
    /// Optional `Referer` header the downloader sends when fetching a
    /// `.torrent` URL. Plugins set it for anti-hotlink hosts.
    #[serde(default)]
    pub referer: Option<String>,
    /// Broad platform class of the hit: "pc" | "console" | "hybrid".
    /// Built-in sources are "pc"; plugin hits inherit their plugin's
    /// declared category (normalised to "pc" when absent).
    #[serde(default)]
    pub platform_category: String,
}

// ─── PluginManager ──────────────────────────────────────────────────────────

/// Owns plugin state: the DB, the plugins directory, the in-memory
/// source map, the raw-result cache, and the shared blocking HTTP
/// client handed to every sandbox.
pub struct PluginManager {
    db: Db,
    plugins_dir: PathBuf,
    /// id -> plugin source text (enabled plugins only). Populated by
    /// [`load_enabled`](PluginManager::load_enabled) and kept in sync
    /// by install/toggle/remove.
    sources: Mutex<HashMap<String, String>>,
    /// (plugin_id, query) -> (cached-at, raw results).
    cache: Mutex<HashMap<(String, String), (Instant, Vec<PluginRawResult>)>>,
    http: reqwest::blocking::Client,
}

impl PluginManager {
    /// `plugins_dir` = `<app_data_dir>/plugins`, created if missing.
    pub fn new(db: Db, app_data_dir: PathBuf) -> Self {
        let plugins_dir = app_data_dir.join("plugins");
        if let Err(e) = std::fs::create_dir_all(&plugins_dir) {
            eprintln!(
                "[plugins] create {} failed: {e}",
                plugins_dir.display()
            );
        }
        // rustls (not the default native-tls/Schannel): Cloudflare-fronted
        // hosts such as ankergames.net fingerprint Schannel's ClientHello and
        // answer every request with a 403 "managed challenge", while curl and
        // rustls pass. rustls over HTTP/2 is the combination those sites
        // accept, so the plugin client opts into rustls explicitly.
        let http = reqwest::blocking::Client::builder()
            .user_agent(PLUGIN_HTTP_UA)
            .timeout(Duration::from_secs(15))
            .use_rustls_tls()
            .build()
            .expect("blocking client build is infallible with these settings");
        Self {
            db,
            plugins_dir,
            sources: Mutex::new(HashMap::new()),
            cache: Mutex::new(HashMap::new()),
            http,
        }
    }

    /// Startup hook: load every *enabled* plugin's source into the
    /// in-memory map. Files that can't be read or no longer evaluate
    /// are flagged with `last_error` (and skipped) rather than
    /// crashing startup.
    pub fn load_enabled(&self) {
        let rows = match db::plugins::list_plugins(&self.db) {
            Ok(rows) => rows,
            Err(e) => {
                eprintln!("[plugins] load_enabled: list failed: {e}");
                return;
            }
        };
        for row in rows.into_iter().filter(|r| r.enabled) {
            match std::fs::read_to_string(&row.file_path) {
                Ok(source) => match runtime::evaluate_plugin(&source, &self.http) {
                    Ok(descriptor) => {
                        if let Ok(mut map) = self.sources.lock() {
                            map.insert(row.id.clone(), source);
                        }
                        // Backfill the platform category for rows that
                        // predate the v2 column.
                        let category = normalize_platform_category(
                            &descriptor.manifest.platform_category,
                        );
                        if category != row.platform_category {
                            let _ = db::plugins::set_plugin_category(
                                &self.db,
                                &row.id,
                                &category,
                            );
                        }
                    }
                    Err(e) => {
                        eprintln!("[plugins] {} failed validation: {e}", row.id);
                        let _ = db::plugins::set_plugin_error(&self.db, &row.id, Some(&e));
                    }
                },
                Err(e) => {
                    eprintln!("[plugins] read {} failed: {e}", row.file_path);
                    let _ = db::plugins::set_plugin_error(
                        &self.db,
                        &row.id,
                        Some(&format!("read {}: {e}", row.file_path)),
                    );
                }
            }
        }
    }

    /// Run one plugin's `search(query)`: cache-first, then evaluate in
    /// a fresh sandbox on a blocking thread under the 20s timeout.
    /// Results (raw, unsorted, unfiltered) are cached for `PLUGIN_CACHE_TTL`.
    async fn search_plugin(
        &self,
        row: &db::plugins::PluginRow,
        source: &str,
        query: &str,
    ) -> Result<Vec<PluginRawResult>, String> {
        let key = (row.id.clone(), query.to_string());
        {
            let cache = self
                .cache
                .lock()
                .map_err(|e| format!("plugin cache lock: {e}"))?;
            if let Some((at, results)) = cache.get(&key) {
                if at.elapsed() < PLUGIN_CACHE_TTL {
                    return Ok(results.clone());
                }
            }
        }

        let descriptor = runtime::evaluate_plugin(source, &self.http)
            .map_err(|e| format!("evaluate {}: {e}", row.id))?;
        let http = self.http.clone();
        let query_owned = query.to_string();
        let joined = tokio::time::timeout(
            PLUGIN_SEARCH_TIMEOUT,
            tokio::task::spawn_blocking(move || {
                runtime::run_search(&descriptor, &query_owned, &http)
            }),
        )
        .await
        .map_err(|_| {
            format!(
                "plugin {} search timed out after {}s",
                row.id,
                PLUGIN_SEARCH_TIMEOUT.as_secs()
            )
        })?
        .map_err(|e| format!("plugin search task failed: {e}"))?;
        let results = joined?;

        let mut cache = self
            .cache
            .lock()
            .map_err(|e| format!("plugin cache lock: {e}"))?;
        cache.insert(key, (Instant::now(), results.clone()));
        Ok(results)
    }

    /// Drop every cache entry belonging to `id` (used by remove).
    fn drop_cache_for(&self, id: &str) {
        if let Ok(mut cache) = self.cache.lock() {
            cache.retain(|(plugin_id, _), _| plugin_id != id);
        }
    }
}

// ─── Tauri commands ─────────────────────────────────────────────────────────

/// List every installed plugin (DB rows → `PluginInfo`).
#[tauri::command]
pub async fn plugins_list(
    state: tauri::State<'_, Arc<PluginManager>>,
) -> Result<Vec<PluginInfo>, String> {
    let rows = db::plugins::list_plugins(&state.db)?;
    Ok(rows.into_iter().map(PluginInfo::from).collect())
}

/// Validate a plugin file without installing it. Reads the file at
/// `path`, hashes it, evaluates it in the sandbox, and validates the
/// manifest id/name/version. Does NOT persist anything.
#[tauri::command]
pub async fn plugins_import_file(
    state: tauri::State<'_, Arc<PluginManager>>,
    path: String,
) -> Result<PluginCandidate, String> {
    let source = std::fs::read_to_string(&path)
        .map_err(|e| format!("read plugin file {path}: {e}"))?;
    let file_hash = sha256_hex(source.as_bytes());
    let descriptor = runtime::evaluate_plugin(&source, &state.http)
        .map_err(|e| format!("plugin evaluation failed: {e}"))?;
    let m = &descriptor.manifest;

    let id_valid = !m.id.is_empty()
        && m.id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && m.id
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit());
    if !id_valid {
        return Err("Plugin id must match ^[a-z0-9-]+$".to_string());
    }
    if m.name.trim().is_empty() {
        return Err("Plugin name is required".to_string());
    }
    if m.version.trim().is_empty() {
        return Err("Plugin version is required".to_string());
    }
    if db::plugins::get_plugin(&state.db, &m.id)?.is_some() {
        return Err("Plugin already installed".to_string());
    }

    Ok(PluginCandidate {
        id: m.id.clone(),
        name: m.name.clone(),
        version: m.version.clone(),
        author: m.author.clone(),
        description: m.description.clone(),
        source_url: m.source_url.clone(),
        file_hash,
        file_path: path,
    })
}

/// Install an imported candidate: re-read + re-hash + re-evaluate the
/// file, copy it to `<app_data_dir>/plugins/<id>.js`, upsert the DB
/// row (enabled, now), and load the source into memory.
#[tauri::command]
pub async fn plugins_install(
    state: tauri::State<'_, Arc<PluginManager>>,
    _app: tauri::AppHandle,
    candidate: PluginCandidate,
) -> Result<PluginInfo, String> {
    let source = std::fs::read_to_string(&candidate.file_path)
        .map_err(|e| format!("re-read plugin file {}: {e}", candidate.file_path))?;
    // Hash must match what the frontend was shown at import time —
    // the file may have been edited (or swapped) in between.
    if sha256_hex(source.as_bytes()) != candidate.file_hash {
        return Err("Plugin file changed since it was imported (sha256 mismatch)".to_string());
    }
    // Re-evaluate: the file must still be valid at install time.
    let descriptor = runtime::evaluate_plugin(&source, &state.http)
        .map_err(|e| format!("plugin re-evaluation failed: {e}"))?;
    let m = &descriptor.manifest;
    if m.id != candidate.id {
        return Err("Plugin id changed since it was imported".to_string());
    }
    if db::plugins::get_plugin(&state.db, &candidate.id)?.is_some() {
        return Err("Plugin already installed".to_string());
    }

    let dest = state.plugins_dir.join(format!("{}.js", candidate.id));
    std::fs::write(&dest, &source)
        .map_err(|e| format!("write plugin file {}: {e}", dest.display()))?;

    let row = db::plugins::PluginRow {
        id: candidate.id,
        name: m.name.clone(),
        version: m.version.clone(),
        author: m.author.clone(),
        description: m.description.clone(),
        source_url: m.source_url.clone(),
        file_hash: sha256_hex(source.as_bytes()),
        file_path: dest.to_string_lossy().into_owned(),
        enabled: true,
        imported_at: unix_now_secs(),
        last_error: None,
        platform_category: normalize_platform_category(&m.platform_category),
    };
    db::plugins::upsert_plugin(&state.db, &row)?;
    if let Ok(mut map) = state.sources.lock() {
        map.insert(row.id.clone(), source);
    }
    Ok(PluginInfo::from(row))
}

/// Uninstall a plugin: delete the DB row, delete its file (missing
/// file is fine), drop it from the memory map and the cache.
#[tauri::command]
pub async fn plugins_remove(
    state: tauri::State<'_, Arc<PluginManager>>,
    _app: tauri::AppHandle,
    id: String,
) -> Result<(), String> {
    db::plugins::remove_plugin(&state.db, &id)?;
    let _ = std::fs::remove_file(state.plugins_dir.join(format!("{id}.js")));
    if let Ok(mut map) = state.sources.lock() {
        map.remove(&id);
    }
    state.drop_cache_for(&id);
    Ok(())
}

/// Flip a plugin's enabled bit. Enabling validates the source on disk
/// and loads it into memory (failures are recorded as `last_error`);
/// disabling just evicts it from memory.
#[tauri::command]
pub async fn plugins_toggle(
    state: tauri::State<'_, Arc<PluginManager>>,
    _app: tauri::AppHandle,
    id: String,
) -> Result<(), String> {
    let row = db::plugins::get_plugin(&state.db, &id)?
        .ok_or_else(|| format!("Plugin not found: {id}"))?;
    let new_enabled = !row.enabled;
    db::plugins::set_plugin_enabled(&state.db, &id, new_enabled)?;

    if new_enabled {
        match std::fs::read_to_string(&row.file_path) {
            Ok(source) => match runtime::evaluate_plugin(&source, &state.http) {
                Ok(descriptor) => {
                    if let Ok(mut map) = state.sources.lock() {
                        map.insert(id.clone(), source);
                    }
                    let _ = db::plugins::set_plugin_error(&state.db, &id, None);
                    let category =
                        normalize_platform_category(&descriptor.manifest.platform_category);
                    if category != row.platform_category {
                        let _ = db::plugins::set_plugin_category(&state.db, &id, &category);
                    }
                }
                Err(e) => {
                    let _ = db::plugins::set_plugin_error(&state.db, &id, Some(&e));
                    return Err(format!("Plugin failed validation: {e}"));
                }
            },
            Err(e) => {
                let msg = format!("read plugin file {}: {e}", row.file_path);
                let _ = db::plugins::set_plugin_error(&state.db, &id, Some(&msg));
                return Err(msg);
            }
        }
    } else if let Ok(mut map) = state.sources.lock() {
        map.remove(&id);
    }
    Ok(())
}

/// Set every plugin's enabled bit in one go. Enabling validates each
/// plugin's source on disk and loads it into memory — failures are
/// recorded as `last_error` and reported back in the result while the
/// rest still enable; disabling just evicts every plugin from memory.
#[tauri::command]
pub async fn plugins_set_all_enabled(
    state: tauri::State<'_, Arc<PluginManager>>,
    enabled: bool,
) -> Result<PluginBulkToggleResult, String> {
    let rows = db::plugins::list_plugins(&state.db)?;
    let mut changed = 0usize;
    let mut failed: Vec<String> = Vec::new();

    if enabled {
        for row in rows {
            if row.enabled {
                continue;
            }
            db::plugins::set_plugin_enabled(&state.db, &row.id, true)?;
            changed += 1;
            match std::fs::read_to_string(&row.file_path) {
                Ok(source) => match runtime::evaluate_plugin(&source, &state.http) {
                    Ok(descriptor) => {
                        if let Ok(mut map) = state.sources.lock() {
                            map.insert(row.id.clone(), source);
                        }
                        let _ = db::plugins::set_plugin_error(&state.db, &row.id, None);
                        let category = normalize_platform_category(
                            &descriptor.manifest.platform_category,
                        );
                        if category != row.platform_category {
                            let _ =
                                db::plugins::set_plugin_category(&state.db, &row.id, &category);
                        }
                    }
                    Err(e) => {
                        let _ = db::plugins::set_plugin_error(&state.db, &row.id, Some(&e));
                        failed.push(format!("{}: {e}", row.id));
                    }
                },
                Err(e) => {
                    let msg = format!("read plugin file {}: {e}", row.file_path);
                    let _ = db::plugins::set_plugin_error(&state.db, &row.id, Some(&msg));
                    failed.push(format!("{}: {msg}", row.id));
                }
            }
        }
    } else {
        for row in rows {
            if !row.enabled {
                continue;
            }
            db::plugins::set_plugin_enabled(&state.db, &row.id, false)?;
            changed += 1;
        }
        if let Ok(mut map) = state.sources.lock() {
            map.clear();
        }
    }

    Ok(PluginBulkToggleResult { changed, failed })
}

/// Merged download search: built-in sources first, then every enabled
/// plugin's sandboxed search (newest-first by upload date), applying
/// the same 0.2 match floor to both kinds of results.
#[tauri::command]
pub async fn search_downloads(
    app: tauri::AppHandle,
    query: String,
    steam_app_id: Option<u32>,
) -> Result<Vec<DownloadSearchResult>, String> {
    let source_manager = app.state::<Arc<source_manager::SourceManager>>();
    let plugin_manager = app.state::<Arc<PluginManager>>();

    // 1. Built-in sources (local FTS5 search).
    let mut out: Vec<DownloadSearchResult> = source_manager
        .search_online(&query, steam_app_id)
        .await
        .unwrap_or_default()
        .into_iter()
        .map(source_to_download_search_result)
        .collect();

    // 2. Enabled plugins that actually have a loaded source.
    let plugin_rows = db::plugins::list_plugins(&plugin_manager.db)?;
    let enabled: Vec<(db::plugins::PluginRow, String)> = {
        let sources = plugin_manager
            .sources
            .lock()
            .map_err(|e| format!("plugin sources lock: {e}"))?;
        plugin_rows
            .into_iter()
            .filter(|r| r.enabled)
            .filter_map(|r| sources.get(&r.id).cloned().map(|s| (r, s)))
            .collect()
    };

    // 3. Run each plugin; collect raw results with their owning row.
    let mut raw_all: Vec<(db::plugins::PluginRow, PluginRawResult)> = Vec::new();
    for (row, source) in &enabled {
        match plugin_manager.search_plugin(row, source, &query).await {
            Ok(results) => raw_all.extend(results.into_iter().map(|r| (row.clone(), r))),
            Err(e) => {
                eprintln!("[plugins] search {} failed: {e}", row.id);
                let _ = db::plugins::set_plugin_error(&plugin_manager.db, &row.id, Some(&e));
            }
        }
    }

    // 4. Newest first by raw unix upload date (None sorts last).
    raw_all.sort_by(|(_, a), (_, b)| {
        b.upload_date
            .unwrap_or(i64::MIN)
            .cmp(&a.upload_date.unwrap_or(i64::MIN))
    });

    // 5. Convert + apply the match floor, append after source results.
    for (row, raw) in raw_all {
        if let Some(result) = raw_to_download_search_result(&row, &raw, &query) {
            out.push(result);
        }
    }
    Ok(out)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchProgressEvent {
    pub search_id: String,
    pub source_name: String,
    pub completed_sources: usize,
    pub total_sources: usize,
    pub new_results: Vec<DownloadSearchResult>,
    pub is_done: bool,
}

/// Streaming parallel search: queries built-in sources and every enabled plugin
/// concurrently, emitting `search-downloads-progress` events in real time as each
/// source finishes so the UI can render files live and display an incremental progress bar.
#[tauri::command]
pub async fn search_downloads_stream(
    app: tauri::AppHandle,
    query: String,
    steam_app_id: Option<u32>,
    search_id: String,
) -> Result<Vec<DownloadSearchResult>, String> {
    let source_manager = app.state::<Arc<source_manager::SourceManager>>();
    let plugin_manager = app.state::<Arc<PluginManager>>();

    let plugin_rows = db::plugins::list_plugins(&plugin_manager.db)?;
    let enabled: Vec<(db::plugins::PluginRow, String)> = {
        let sources = plugin_manager
            .sources
            .lock()
            .map_err(|e| format!("plugin sources lock: {e}"))?;
        plugin_rows
            .into_iter()
            .filter(|r| r.enabled)
            .filter_map(|r| sources.get(&r.id).cloned().map(|s| (r, s)))
            .collect()
    };

    let total_sources = 1 + enabled.len();
    let completed_counter = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let all_results = Arc::new(tokio::sync::Mutex::new(Vec::new()));

    // Task 1: Built-in sources
    let sm = Arc::clone(&source_manager);
    let app_handle = app.clone();
    let query_sm = query.clone();
    let search_id_sm = search_id.clone();
    let counter_sm = Arc::clone(&completed_counter);
    let all_results_sm = Arc::clone(&all_results);

    let builtin_task = tokio::spawn(async move {
        let source_results: Vec<DownloadSearchResult> = sm
            .search_online(&query_sm, steam_app_id)
            .await
            .unwrap_or_default()
            .into_iter()
            .map(source_to_download_search_result)
            .collect();

        let completed = counter_sm.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
        let is_done = completed == total_sources;

        {
            let mut guard = all_results_sm.lock().await;
            guard.extend(source_results.clone());
        }

        let _ = app_handle.emit(
            "search-downloads-progress",
            SearchProgressEvent {
                search_id: search_id_sm,
                source_name: "Sources".to_string(),
                completed_sources: completed,
                total_sources,
                new_results: source_results,
                is_done,
            },
        );
    });

    // Task 2..N: Run each enabled plugin in parallel
    let mut plugin_tasks = Vec::new();
    for (row, source) in enabled {
        let pm = Arc::clone(&plugin_manager);
        let app_handle = app.clone();
        let query_p = query.clone();
        let search_id_p = search_id.clone();
        let counter_p = Arc::clone(&completed_counter);
        let all_results_p = Arc::clone(&all_results);

        let t = tokio::spawn(async move {
            let plugin_raw = match pm.search_plugin(&row, &source, &query_p).await {
                Ok(mut results) => {
                    results.sort_by(|a, b| {
                        b.upload_date
                            .unwrap_or(i64::MIN)
                            .cmp(&a.upload_date.unwrap_or(i64::MIN))
                    });
                    results
                }
                Err(e) => {
                    eprintln!("[plugins] search {} failed: {e}", row.id);
                    let _ = db::plugins::set_plugin_error(&pm.db, &row.id, Some(&e));
                    Vec::new()
                }
            };

            let plugin_results: Vec<DownloadSearchResult> = plugin_raw
                .into_iter()
                .filter_map(|raw| raw_to_download_search_result(&row, &raw, &query_p))
                .collect();

            let completed = counter_p.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
            let is_done = completed == total_sources;

            {
                let mut guard = all_results_p.lock().await;
                guard.extend(plugin_results.clone());
            }

            let _ = app_handle.emit(
                "search-downloads-progress",
                SearchProgressEvent {
                    search_id: search_id_p,
                    source_name: row.name.clone(),
                    completed_sources: completed,
                    total_sources,
                    new_results: plugin_results,
                    is_done,
                },
            );
        });
        plugin_tasks.push(t);
    }

    // Wait for all tasks to complete
    let _ = builtin_task.await;
    for t in plugin_tasks {
        let _ = t.await;
    }

    let out = all_results.lock().await.clone();
    Ok(out)
}

// ─── Mapping helpers ────────────────────────────────────────────────────────

fn source_to_download_search_result(m: MatchedDownload) -> DownloadSearchResult {
    DownloadSearchResult {
        id: m.source_id.clone(),
        source_name: m.source_name,
        source_id: m.source_id,
        title: m.title,
        file_size: m.file_size,
        uris: m.uris,
        magnet: m.magnet,
        upload_date: m.upload_date,
        match_score: m.match_score,
        is_new: m.is_new,
        provider: "source".to_string(),
        plugin_id: None,
        infohash: None,
        seeds: None,
        peers: None,
        torrent_url: None,
        verified: None,
        detail_url: None,
        platform: None,
        provenance: None,
        referer: None,
        platform_category: "pc".to_string(),
    }
}

/// Convert a raw plugin result into the merged shape, dropping entries
/// below the match floor. The `uris` array is built from the magnet,
/// torrent URL and any direct download URLs (deduped, non-empty only);
/// `magnet` falls back to the first `magnet:` URI inside `uris`.
fn raw_to_download_search_result(
    row: &db::plugins::PluginRow,
    raw: &PluginRawResult,
    query: &str,
) -> Option<DownloadSearchResult> {
    let match_score = source_manager::title_similarity(query, &raw.title);
    if match_score < MIN_MATCH_SCORE {
        return None;
    }

    let mut uris: Vec<String> = Vec::with_capacity(4);
    for u in raw
        .magnet
        .clone()
        .into_iter()
        .chain(raw.torrent_url.clone())
        .chain(raw.direct_urls.clone().into_iter().flatten())
    {
        if !u.is_empty() && !uris.contains(&u) {
            uris.push(u);
        }
    }
    let magnet = raw
        .magnet
        .clone()
        .filter(|m| !m.is_empty())
        .or_else(|| uris.iter().find(|u| u.starts_with("magnet:")).cloned());

    // Prefer the plugin's ISO date; fall back to formatting its unix
    // timestamp.
    let upload_date = raw
        .upload_date_iso
        .clone()
        .filter(|s| !s.is_empty())
        .or_else(|| raw.upload_date.map(format_upload_date));

    Some(DownloadSearchResult {
        id: format!("{}:{}", row.id, raw.id),
        source_name: row.name.clone(),
        source_id: row.id.clone(),
        title: raw.title.clone(),
        file_size: raw.size.clone(),
        uris,
        magnet,
        upload_date,
        match_score,
        is_new: false,
        provider: "plugin".to_string(),
        plugin_id: Some(row.id.clone()),
        infohash: raw.infohash.clone(),
        seeds: raw.seeds,
        peers: raw.peers,
        torrent_url: raw.torrent_url.clone(),
        verified: raw.verified,
        detail_url: raw.url.clone(),
        platform: raw.platform.clone().filter(|p| !p.is_empty()),
        provenance: raw.provenance.clone(),
        referer: raw.referer.clone(),
        platform_category: normalize_platform_category(&row.platform_category),
    })
}

fn format_upload_date(unix_secs: i64) -> String {
    chrono::DateTime::from_timestamp(unix_secs, 0)
        .unwrap_or_else(|| chrono::DateTime::from_timestamp(0, 0).unwrap())
        .format("%Y-%m-%dT%H:%M:%SZ")
        .to_string()
}

fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    format!("{:x}", hasher.finalize())
}

fn unix_now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Normalise a plugin's declared platform class to one of the three
/// canonical values. Anything that isn't "console" or "hybrid" —
/// including an empty/absent manifest field from legacy plugins — is
/// treated as "pc" (the default assumption for a game-download plugin).
fn normalize_platform_category(raw: &str) -> String {
    match raw.trim().to_ascii_lowercase().as_str() {
        "console" => "console".to_string(),
        "hybrid" | "both" => "hybrid".to_string(),
        _ => "pc".to_string(),
    }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// Live smoke test of the sandbox against every plugin shipped in
    /// the repo `plugins/` directory (network required). `#[ignore]` so
    /// normal test runs skip it.
    ///
    /// For each `*.js` file: evaluate it, run `search("elden ring")`,
    /// and require at least one result carrying BOTH a non-empty
    /// infohash AND a non-empty magnet (torrentUrl is optional).
    ///
    /// Everything that touches the blocking client runs inside
    /// `spawn_blocking`: a `reqwest::blocking::Client` owns an internal
    /// tokio runtime whose drop must never happen inside an async
    /// context (tokio panics on that), and the real search path uses
    /// exactly this shape.
    #[tokio::test]
    #[ignore]
    async fn live_plugin_search_smoke() {
        let plugins_dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../plugins");
        // The shipped set — a missing file should fail the test loudly
        // rather than silently testing fewer plugins.
        let expected_ids = [
            "ankergames",
            "axekin",
            "byxatab",
            "dodirepacks",
            "fitgirl",
            "freegogpcgames",
            "freetp",
            "gamerepack",
            "gogarchive",
            "gogrev",
            "internetarchive",
            "knaben",
            "onlinefix",
            "vimm",
            "yourbittorrent",
            "zeigames",
        ];

        let (summary, _failures) = tokio::time::timeout(
            Duration::from_secs(600),
            tokio::task::spawn_blocking(move || {
                let http = reqwest::blocking::Client::builder()
                    .user_agent(PLUGIN_HTTP_UA)
                    .timeout(Duration::from_secs(20))
                    .use_rustls_tls()
                    .build()
                    .expect("client");

                let mut paths: Vec<_> = std::fs::read_dir(plugins_dir)
                    .expect("read plugins dir")
                    .filter_map(|e| e.ok())
                    .map(|e| e.path())
                    .filter(|p| p.extension().and_then(|x| x.to_str()) == Some("js"))
                    .collect();
                paths.sort();

                let mut summary: Vec<(String, usize, String)> = Vec::new();
                let mut failures: Vec<String> = Vec::new();

                for path in &paths {
                    let source = match std::fs::read_to_string(path) {
                        Ok(s) => s,
                        Err(e) => {
                            failures.push(format!("{}: read: {e}", path.display()));
                            continue;
                        }
                    };
                    let descriptor = match runtime::evaluate_plugin(&source, &http) {
                        Ok(d) => d,
                        Err(e) => {
                            failures.push(format!("{}: eval: {e}", path.display()));
                            continue;
                        }
                    };
                    let results = match runtime::run_search(&descriptor, "elden ring", &http) {
                        Ok(r) => r,
                        Err(e) => {
                            failures.push(format!("{}: search: {e}", path.display()));
                            continue;
                        }
                    };
                    // A result is "usable" when it carries a magnet pair
                    // (infohash + magnet), a direct `.torrent` URL
                    // (anti-hotlink sources like online-fix ship
                    // `torrentUrl` + `referer`), or a plain page `url`
                    // (search-only plugins like gamedirect resolve to an
                    // open-in-browser link).
                    let is_valid = |r: &PluginRawResult| {
                        let has_magnet = r
                            .infohash
                            .as_deref()
                            .is_some_and(|h| !h.is_empty())
                            && r.magnet.as_deref().is_some_and(|m| !m.is_empty());
                        let has_torrent_url = r
                            .torrent_url
                            .as_deref()
                            .is_some_and(|t| !t.is_empty());
                        let has_direct_url = r
                            .direct_urls
                            .as_deref()
                            .is_some_and(|u| u.iter().any(|d| !d.is_empty()));
                        let has_url = r.url.as_deref().is_some_and(|u| !u.is_empty());
                        has_magnet || has_torrent_url || has_direct_url || has_url
                    };
                    let has_valid = results.iter().any(|r| is_valid(r));
                    eprintln!(
                        "[plugins] {}: {} results (downloadable ok: {})",
                        descriptor.manifest.id,
                        results.len(),
                        has_valid
                    );
                    if let Some(s) = results.iter().find(|r| is_valid(r)) {
                        eprintln!(
                            "[plugins]   sample: title={:?} infohash={:?} torrentUrl={:?} seeds={:?}",
                            s.title, s.infohash, s.torrent_url, s.seeds
                        );
                    } else if let Some(s) = results.first() {
                        eprintln!(
                            "[plugins]   (no valid sample; first: title={:?} infohash={:?} magnet={:?} torrentUrl={:?})",
                            s.title, s.infohash, s.magnet, s.torrent_url
                        );
                    }
                    if !has_valid {
                        failures.push(format!(
                            "{}: no downloadable result (infohash+magnet or torrentUrl) ({} total)",
                            descriptor.manifest.id,
                            results.len()
                        ));
                    }
                    summary.push((
                        descriptor.manifest.id.clone(),
                        results.len(),
                        descriptor.manifest.name.clone(),
                    ));
                }

                (summary, failures)
            }),
        )
        .await
        .expect("smoke test timed out")
        .expect("smoke task panicked");

        let tested: std::collections::HashSet<String> =
            summary.iter().map(|(id, _, _)| id.clone()).collect();
        for id in expected_ids {
            assert!(tested.contains(id), "plugin {id} was not tested");
        }
        eprintln!(
            "[plugins] live smoke: tested {} plugins — {}",
            summary.len(),
            summary
                .iter()
                .map(|(id, n, _)| format!("{id}={n}"))
                .collect::<Vec<_>>()
                .join(", ")
        );
    }

    #[tokio::test]
    #[ignore]
    async fn gogrev_plugin_live_search() {
        let plugins_dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../plugins");
        let plugin_path = std::path::Path::new(plugins_dir).join("gogrev.js");
        let source = std::fs::read_to_string(&plugin_path).expect("read gogrev.js");

        let (descriptor, results) = tokio::task::spawn_blocking(move || {
            let http = reqwest::blocking::Client::builder()
                .user_agent(PLUGIN_HTTP_UA)
                .timeout(Duration::from_secs(20))
                .use_rustls_tls()
                .build()
                .expect("client");

            let descriptor = runtime::evaluate_plugin(&source, &http).expect("evaluate_plugin");
            let results = runtime::run_search(&descriptor, "cult of the lamb", &http).expect("run_search");
            (descriptor, results)
        })
        .await
        .expect("spawn_blocking");

        assert_eq!(descriptor.manifest.id, "gogrev");
        assert!(!results.is_empty(), "gogrev search returned no results");

        let has_direct = results.iter().any(|r| {
            r.direct_urls
                .as_ref()
                .is_some_and(|urls| !urls.is_empty())
        });
        let has_magnet = results.iter().any(|r| {
            r.magnet.as_deref().is_some_and(|m| m.starts_with("magnet:"))
        });
        let has_torrent = results.iter().any(|r| {
            r.torrent_url
                .as_deref()
                .is_some_and(|t| t.starts_with("http"))
        });

        assert!(has_direct, "expected at least one direct download result");
        assert!(has_magnet, "expected at least one magnet result");
        assert!(has_torrent, "expected at least one torrent result");
    }
}
