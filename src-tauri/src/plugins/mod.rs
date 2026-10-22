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
//! - [`PluginManager::ensure_loaded`] — one-time warm-up hook (called on
//!   a background thread from `lib.rs::setup`): loads every enabled
//!   plugin's source into the in-memory map so searches never touch
//!   disk, setting `last_error` for files that fail to read or evaluate.
//!   The first search also calls it in case it beats the warm-up thread.
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
use crate::db::secrets::SecretStore;
use crate::source_manager::{self, MatchedDownload};

mod bencode;
mod html;
mod runtime;

pub use runtime::{PluginChecksum, PluginFile, PluginRawResult};

/// How long raw plugin search results stay fresh (yourbittorrent's
/// documented search-fresh policy).
const PLUGIN_CACHE_TTL: Duration = Duration::from_secs(15 * 60);

/// Upper bound on cached `(plugin, query)` result sets. The TTL alone never
/// removes stale entries (they only linger until re-read), so without a cap
/// the map grows with every distinct search the user ever runs.
const PLUGIN_CACHE_MAX_ENTRIES: usize = 64;

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
    /// The full parsed plugin manifest as JSON, so the plugins UI can
    /// render icon/homepage/config/capabilities without re-evaluating.
    /// Null for legacy rows that predate the v3 column.
    #[serde(default)]
    pub manifest: serde_json::Value,
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
            manifest: parse_manifest_json(&r.manifest_json),
        }
    }
}

/// Parse a stored manifest JSON blob, degrading an empty/malformed
/// value to JSON null so legacy rows still serialize cleanly.
fn parse_manifest_json(raw: &str) -> serde_json::Value {
    if raw.trim().is_empty() {
        serde_json::Value::Null
    } else {
        serde_json::from_str(raw).unwrap_or(serde_json::Value::Null)
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
    /// The evaluated manifest as JSON, so the import preview can show
    /// the same metadata the installed row will expose.
    #[serde(default)]
    pub manifest: serde_json::Value,
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
    /// Title to score matches against when it differs from `title`.
    #[serde(default)]
    pub match_title: Option<String>,
    /// Files contained in the release, when the plugin reports them.
    #[serde(default)]
    pub file_list: Option<Vec<PluginFile>>,
    /// Checksums for the release, when the plugin reports them.
    #[serde(default)]
    pub checksums: Option<Vec<PluginChecksum>>,
    /// Release version string, when the plugin reports one.
    #[serde(default)]
    pub version: Option<String>,
    /// Region code (e.g. "USA", "EUR") for ROM hits.
    #[serde(default)]
    pub region: Option<String>,
    /// Cover art URL.
    #[serde(default)]
    pub cover_url: Option<String>,
    /// Long description of the release.
    #[serde(default)]
    pub description: Option<String>,
    /// Release group / repacker name.
    #[serde(default)]
    pub release_group: Option<String>,
    /// Plugin's own recommendation flag.
    #[serde(default)]
    pub recommended: Option<bool>,
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
    /// Guards the one-time `load_enabled` pass. Startup warms it on a
    /// background thread; the first search that beats the warm-up blocks
    /// here until the sources are ready instead of silently missing them.
    loaded: std::sync::Once,
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
        //
        // `cookie_store(true)` is what makes session-based flows possible:
        // sites like ankergames bind their CSRF token to a session cookie
        // minted by GET /csrf-token, and their mint POST answers 419 without
        // it. The jar is shared by every plugin (one client per app), but a
        // cookie is only sent back to the host that set it, so plugins never
        // see each other's sessions.
        let http = reqwest::blocking::Client::builder()
            .user_agent(PLUGIN_HTTP_UA)
            .timeout(Duration::from_secs(15))
            .use_rustls_tls()
            .cookie_store(true)
            .build()
            .expect("blocking client build is infallible with these settings");
        Self {
            db,
            plugins_dir,
            sources: Mutex::new(HashMap::new()),
            cache: Mutex::new(HashMap::new()),
            http,
            loaded: std::sync::Once::new(),
        }
    }

    /// Run the one-time source load exactly once, blocking the caller
    /// until it completes. Evaluates every enabled plugin's QuickJS
    /// source, so it must never run on the UI thread — call it from a
    /// background thread (warm-up) or right before the first search.
    pub fn ensure_loaded(&self) {
        self.loaded.call_once(|| self.load_enabled());
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
                Ok(source) => {
                    let file_hash = sha256_hex(source.as_bytes());
                    match runtime::evaluate_plugin(&source, &self.http) {
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
                            // Keep the stored manifest current (new fields
                            // appear as plugins are upgraded) without a write
                            // when nothing changed.
                            let manifest_json =
                                serde_json::to_string(&descriptor.manifest).unwrap_or_default();
                            if manifest_json != row.manifest_json {
                                let _ = db::plugins::set_plugin_manifest(
                                    &self.db,
                                    &row.id,
                                    &manifest_json,
                                );
                            }
                            // A plugin file replaced on disk (a manual update
                            // or a newer bundled copy) keeps its row in step,
                            // so the sources UI shows the version that runs.
                            if file_hash != row.file_hash
                                || descriptor.manifest.name != row.name
                                || descriptor.manifest.version != row.version
                                || descriptor.manifest.author != row.author
                                || descriptor.manifest.description != row.description
                                || descriptor.manifest.source_url != row.source_url
                            {
                                let _ = db::plugins::set_plugin_metadata(
                                    &self.db,
                                    &row.id,
                                    &descriptor.manifest.name,
                                    &descriptor.manifest.version,
                                    &descriptor.manifest.author,
                                    &descriptor.manifest.description,
                                    &descriptor.manifest.source_url,
                                    &file_hash,
                                );
                            }
                        }
                        Err(e) => {
                            eprintln!("[plugins] {} failed validation: {e}", row.id);
                            let _ = db::plugins::set_plugin_error(&self.db, &row.id, Some(&e));
                        }
                    }
                }
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
        // Per-plugin freshness: a plugin may declare `cacheTtlSecs`;
        // otherwise the global default applies.
        let ttl = plugin_cache_ttl(row);
        {
            let cache = self
                .cache
                .lock()
                .map_err(|e| format!("plugin cache lock: {e}"))?;
            if let Some((at, results)) = cache.get(&key) {
                if at.elapsed() < ttl {
                    return Ok(results.clone());
                }
            }
        }

        let descriptor = runtime::evaluate_plugin(source, &self.http)
            .map_err(|e| format!("evaluate {}: {e}", row.id))?;
        // Read the plugin's configured values from the keychain (only
        // the keys its manifest declares) and serialize them once so the
        // blocking task can move a plain string across the boundary.
        let config_json = plugin_config_json(&row.id, &row.manifest_json);
        let http = self.http.clone();
        let query_owned = query.to_string();
        let joined = tokio::time::timeout(
            PLUGIN_SEARCH_TIMEOUT,
            tokio::task::spawn_blocking(move || {
                runtime::run_search(&descriptor, &query_owned, &config_json, &http)
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
        // Drop expired entries on write so the map doesn't retain every
        // query ever run, then evict the oldest entry if we're at the cap.
        cache.retain(|_, (at, _)| at.elapsed() < PLUGIN_CACHE_TTL);
        while cache.len() >= PLUGIN_CACHE_MAX_ENTRIES {
            let oldest = cache
                .iter()
                .min_by_key(|(_, (at, _))| *at)
                .map(|(k, _)| k.clone());
            match oldest {
                Some(key) => {
                    cache.remove(&key);
                }
                None => break,
            }
        }
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

// ─── Per-plugin config ──────────────────────────────────────────────────────

/// Sanitize one id/key component to the `[a-z0-9_]` alphabet used in
/// keychain account names. Case is folded and every other character
/// (notably the `-` allowed in plugin ids) collapses to `_`. The mapping
/// is deterministic so the same plugin always addresses the same entry.
fn sanitize_account_component(raw: &str) -> String {
    raw.chars()
        .map(|c| {
            let lower = c.to_ascii_lowercase();
            if lower.is_ascii_lowercase() || lower.is_ascii_digit() || lower == '_' {
                lower
            } else {
                '_'
            }
        })
        .collect()
}

/// Keychain account for a plugin config value: `plugin_<id>_<key>` with
/// both components sanitized to `[a-z0-9_]`. Secrets live only in the OS
/// keychain — never in the DB or on disk.
pub fn config_account(id: &str, key: &str) -> String {
    format!(
        "plugin_{}_{}",
        sanitize_account_component(id),
        sanitize_account_component(key)
    )
}

/// Declared config keys for a plugin, parsed leniently from the stored
/// manifest JSON. Using `Value` rather than `PluginManifest` means a
/// legacy row missing newer manifest fields still yields its config list.
fn declared_config_keys(manifest_json: &str) -> Vec<String> {
    serde_json::from_str::<serde_json::Value>(manifest_json)
        .ok()
        .and_then(|v| v.get("config").cloned())
        .and_then(|c| serde_json::from_value::<Vec<runtime::PluginConfigField>>(c).ok())
        .unwrap_or_default()
        .into_iter()
        .map(|f| f.key)
        .filter(|k| !k.trim().is_empty())
        .collect()
}

/// Assemble the JSON object injected into a plugin's sandbox from its
/// declared keys and the values that are actually stored. A declared key
/// with no stored value is omitted (never nulled) so a plugin can tell
/// "unset" from "empty". Always returns a JSON *object* string — `{}`
/// when nothing is configured — so legacy plugins that ignore the second
/// `search` argument keep working unchanged.
fn config_json(declared: &[String], stored: &HashMap<String, String>) -> String {
    let mut map = serde_json::Map::new();
    for key in declared {
        if let Some(value) = stored.get(key) {
            map.insert(key.clone(), serde_json::Value::String(value.clone()));
        }
    }
    serde_json::to_string(&serde_json::Value::Object(map))
        .unwrap_or_else(|_| "{}".to_string())
}

/// Read every declared key's value from the keychain and serialize the
/// result for injection. A keychain read error is treated as "unset" —
/// a missing/broken credential store must never fail a search.
fn plugin_config_json(id: &str, manifest_json: &str) -> String {
    let declared = declared_config_keys(manifest_json);
    let store = SecretStore::new();
    let mut stored = HashMap::new();
    for key in &declared {
        if let Ok(Some(value)) = store.get(&config_account(id, key)) {
            stored.insert(key.clone(), value);
        }
    }
    config_json(&declared, &stored)
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
        manifest: serde_json::to_value(m).unwrap_or(serde_json::Value::Null),
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
        manifest_json: serde_json::to_string(m).unwrap_or_default(),
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
                    let manifest_json =
                        serde_json::to_string(&descriptor.manifest).unwrap_or_default();
                    if manifest_json != row.manifest_json {
                        let _ = db::plugins::set_plugin_manifest(&state.db, &id, &manifest_json);
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
                        let manifest_json =
                            serde_json::to_string(&descriptor.manifest).unwrap_or_default();
                        if manifest_json != row.manifest_json {
                            let _ = db::plugins::set_plugin_manifest(
                                &state.db,
                                &row.id,
                                &manifest_json,
                            );
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

/// Persist one config value for a plugin in the OS keychain. The key
/// must be declared in the plugin's manifest `config` array so a typo
/// can never write an arbitrary keychain entry.
#[tauri::command]
pub async fn plugins_set_config(
    state: tauri::State<'_, Arc<PluginManager>>,
    id: String,
    key: String,
    value: String,
) -> Result<(), String> {
    let row = db::plugins::get_plugin(&state.db, &id)?
        .ok_or_else(|| format!("Plugin not found: {id}"))?;
    if !declared_config_keys(&row.manifest_json).iter().any(|k| k == &key) {
        return Err(format!("Plugin {id} does not declare a config key {key:?}"));
    }
    SecretStore::new().set(&config_account(&id, &key), &value)?;
    // A config change must take effect on the next search, so drop any
    // cached results that were produced under the previous value.
    state.drop_cache_for(&id);
    Ok(())
}

/// Remove one plugin config value from the keychain. Validates the key
/// the same way as `plugins_set_config` so a typo cannot delete an
/// unrelated entry.
#[tauri::command]
pub async fn plugins_clear_config(
    state: tauri::State<'_, Arc<PluginManager>>,
    id: String,
    key: String,
) -> Result<(), String> {
    let row = db::plugins::get_plugin(&state.db, &id)?
        .ok_or_else(|| format!("Plugin not found: {id}"))?;
    if !declared_config_keys(&row.manifest_json).iter().any(|k| k == &key) {
        return Err(format!("Plugin {id} does not declare a config key {key:?}"));
    }
    SecretStore::new().delete(&config_account(&id, &key))?;
    state.drop_cache_for(&id);
    Ok(())
}

/// Report, for each declared config key, whether a value is stored.
/// Only presence is reported — the value itself never leaves the
/// keychain, not even to the settings UI that set it.
#[tauri::command]
pub async fn plugins_config_status(
    state: tauri::State<'_, Arc<PluginManager>>,
    id: String,
) -> Result<HashMap<String, bool>, String> {
    let row = db::plugins::get_plugin(&state.db, &id)?
        .ok_or_else(|| format!("Plugin not found: {id}"))?;
    let store = SecretStore::new();
    let mut status = HashMap::new();
    for key in declared_config_keys(&row.manifest_json) {
        // An empty stored string counts as "not configured" so clearing
        // a field and saving an empty field behave the same in the UI.
        let present = matches!(
            store.get(&config_account(&id, &key)),
            Ok(Some(value)) if !value.is_empty()
        );
        status.insert(key, present);
    }
    Ok(status)
}

/// Run a fresh, uncached search for a single plugin so the settings UI
/// can verify a configuration before saving. Bypasses the result cache
/// entirely and records/clears `last_error` accordingly.
#[tauri::command]
pub async fn plugins_test_search(
    state: tauri::State<'_, Arc<PluginManager>>,
    id: String,
    query: String,
) -> Result<Vec<PluginRawResult>, String> {
    let row = db::plugins::get_plugin(&state.db, &id)?
        .ok_or_else(|| format!("Plugin not found: {id}"))?;
    // Re-read + re-evaluate from disk (not the in-memory map) so the
    // test reflects the current file even if it was edited after load.
    let source = std::fs::read_to_string(&row.file_path)
        .map_err(|e| format!("read plugin file {}: {e}", row.file_path))?;
    let descriptor = match runtime::evaluate_plugin(&source, &state.http) {
        Ok(d) => d,
        Err(e) => {
            let _ = db::plugins::set_plugin_error(&state.db, &id, Some(&e));
            return Err(format!("evaluate {id}: {e}"));
        }
    };
    let config_json = plugin_config_json(&id, &row.manifest_json);
    let http = state.http.clone();
    let query_owned = query.clone();
    let joined = tokio::time::timeout(
        PLUGIN_SEARCH_TIMEOUT,
        tokio::task::spawn_blocking(move || {
            runtime::run_search(&descriptor, &query_owned, &config_json, &http)
        }),
    )
    .await
    .map_err(|_| {
        format!(
            "plugin {id} search timed out after {}s",
            PLUGIN_SEARCH_TIMEOUT.as_secs()
        )
    })?
    .map_err(|e| format!("plugin search task failed: {e}"))?;

    match joined {
        Ok(results) => {
            // A successful test clears any stale error from a previous
            // failing search.
            let _ = db::plugins::set_plugin_error(&state.db, &id, None);
            Ok(results)
        }
        Err(e) => {
            let _ = db::plugins::set_plugin_error(&state.db, &id, Some(&e));
            Err(e)
        }
    }
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
    // First search may beat the background warm-up; block until the
    // enabled plugin sources are in memory rather than return partial
    // results.
    plugin_manager.ensure_loaded();

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
        if let Some(result) =
            raw_to_download_search_result(&row, &raw, &query, &[], None)
        {
            out.push(result);
        }
    }
    // 6. Collapse duplicate releases (same infohash or the same
    //    normalised title across sources/plugins).
    Ok(merge_duplicates(out))
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
///
/// `release_year` and `aliases` carry identity hints from the game record
/// (its own release date and IGDB/local alternative names). They sharpen
/// scoring — a release that matches an alias perfectly still scores full
/// marks, and a title whose embedded year conflicts with the game's is
/// penalised — without changing which results are *requested*.
#[tauri::command]
pub async fn search_downloads_stream(
    app: tauri::AppHandle,
    query: String,
    steam_app_id: Option<u32>,
    search_id: String,
    release_year: Option<i32>,
    aliases: Option<Vec<String>>,
) -> Result<Vec<DownloadSearchResult>, String> {
    let alias_list: Vec<String> = aliases
        .unwrap_or_default()
        .into_iter()
        .map(|a| a.trim().to_string())
        .filter(|a| !a.is_empty() && a != &query)
        .take(8)
        .collect();
    let source_manager = app.state::<Arc<source_manager::SourceManager>>();
    let plugin_manager = app.state::<Arc<PluginManager>>();
    plugin_manager.ensure_loaded();

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

    // Task 1: Built-in sources. Scored against the raw query *and* the
    // game's alternative names, then year-adjusted. A cleaned short
    // query is used as a one-shot fallback when the full title index
    // has nothing useful (verbose titles often miss the FTS index).
    let sm = Arc::clone(&source_manager);
    let app_handle = app.clone();
    let query_sm = query.clone();
    let aliases_sm = alias_list.clone();
    let search_id_sm = search_id.clone();
    let counter_sm = Arc::clone(&completed_counter);
    let all_results_sm = Arc::clone(&all_results);

    let builtin_task = tokio::spawn(async move {
        let mut matched = sm.search_online(&query_sm, steam_app_id).await.unwrap_or_default();
        if matched.is_empty() {
            if let Some(cleaned) = source_manager::clean_search_query(&query_sm) {
                matched = sm.search_online(&cleaned, steam_app_id).await.unwrap_or_default();
            }
        }
        let source_results: Vec<DownloadSearchResult> = matched
            .into_iter()
            .map(|mut m| {
                m.match_score = source_manager::best_title_similarity(
                    &query_sm,
                    &aliases_sm,
                    &m.title,
                );
                if let Some(year) = release_year {
                    m.match_score =
                        source_manager::apply_release_year_adj(m.match_score, &m.title, year);
                }
                m
            })
            .filter(|m| m.match_score >= MIN_MATCH_SCORE)
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

    // Task 2..N: Run each enabled plugin in parallel, retrying with the
    // cleaned short query when the full title produced nothing usable
    // (subtitle/edition-heavy titles often miss on upstream sites that
    // do plain substring matching).
    let mut plugin_tasks = Vec::new();
    for (row, source) in enabled {
        let pm = Arc::clone(&plugin_manager);
        let app_handle = app.clone();
        let query_p = query.clone();
        let search_id_p = search_id.clone();
        let counter_p = Arc::clone(&completed_counter);
        let all_results_p = Arc::clone(&all_results);
        let aliases_p = alias_list.clone();

        let t = tokio::spawn(async move {
            let mut query_used = query_p.clone();
            let plugin_raw = plugin_search_raw(&pm, &row, &source, &query_used).await;

            let convert_all = |query: &str, raws: &[PluginRawResult]| -> Vec<DownloadSearchResult> {
                raws.iter()
                    .filter_map(|raw| {
                        raw_to_download_search_result(&row, raw, query, &aliases_p, release_year)
                    })
                    .collect()
            };
            let mut matches = convert_all(&query_used, &plugin_raw);

            if matches.is_empty() {
                if let Some(cleaned) = source_manager::clean_search_query(&query_used) {
                    let retry_raw = plugin_search_raw(&pm, &row, &source, &cleaned).await;
                    if !retry_raw.is_empty() {
                        query_used = cleaned;
                        matches = convert_all(&query_used, &retry_raw);
                    }
                }
            }

            let plugin_results: Vec<DownloadSearchResult> = matches;

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
    // Collapse duplicate releases that share an infohash (the per-source
    // progress events above intentionally stay unmerged so the UI can
    // render results as they arrive).
    Ok(merge_duplicates(out))
}

// ─── Mapping helpers ────────────────────────────────────────────────────────

/// Shorthand for [`PluginManager::search_plugin`] that folds the error
/// path into an empty result list (`last_error` is still recorded). Used
/// by both the streaming and the initial plugin search rounds.
async fn plugin_search_raw(
    pm: &PluginManager,
    row: &db::plugins::PluginRow,
    source: &str,
    query: &str,
) -> Vec<PluginRawResult> {
    match pm.search_plugin(row, source, query).await {
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
    }
}

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
        match_title: None,
        file_list: None,
        checksums: None,
        version: None,
        region: None,
        cover_url: None,
        description: None,
        release_group: None,
        recommended: None,
    }
}

/// Convert a raw plugin result into the merged shape, dropping entries
/// below the match floor. The `uris` array is built from the magnet,
/// torrent URL and any direct download URLs (deduped, non-empty only);
/// `magnet` falls back to the first `magnet:` URI inside `uris`.
///
/// Scoring takes the best of [`source_manager::title_similarity`] over the
/// requested query plus the game's alternative names, then applies the
/// release-year adjustment. The year penalty runs *after* the floor check
/// so a decisive title match stays listed even if its year looks off —
/// the modal hides it behind the weak-match accordion instead of losing it.
fn raw_to_download_search_result(
    row: &db::plugins::PluginRow,
    raw: &PluginRawResult,
    query: &str,
    aliases: &[String],
    release_year: Option<i32>,
) -> Option<DownloadSearchResult> {
    // Score against `matchTitle` when the plugin supplies a clean one;
    // the display `title` is left untouched.
    let match_source = raw
        .match_title
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(raw.title.as_str());
    let match_score = source_manager::best_title_similarity(query, aliases, match_source);
    if match_score < MIN_MATCH_SCORE {
        return None;
    }
    let match_score = release_year
        .map(|year| source_manager::apply_release_year_adj(match_score, match_source, year))
        .unwrap_or(match_score);

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
        match_title: raw.match_title.clone().filter(|s| !s.trim().is_empty()),
        file_list: raw.file_list.clone().filter(|f| !f.is_empty()),
        checksums: raw.checksums.clone().filter(|c| !c.is_empty()),
        version: raw.version.clone().filter(|s| !s.is_empty()),
        region: raw.region.clone().filter(|s| !s.is_empty()),
        cover_url: raw.cover_url.clone().filter(|s| !s.is_empty()),
        description: raw.description.clone().filter(|s| !s.is_empty()),
        release_group: raw.release_group.clone().filter(|s| !s.is_empty()),
        recommended: raw.recommended,
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

/// Effective cache TTL for a plugin: its manifest's `cacheTtlSecs` when
/// present, clamped to `0..=3600` seconds, else the global default. A
/// value of `0` disables caching (every search refetches).
fn plugin_cache_ttl(row: &db::plugins::PluginRow) -> Duration {
    let secs = serde_json::from_str::<serde_json::Value>(&row.manifest_json)
        .ok()
        .and_then(|v| v.get("cacheTtlSecs").and_then(|s| s.as_u64()));
    match secs {
        Some(s) => Duration::from_secs(s.min(3600)),
        None => PLUGIN_CACHE_TTL,
    }
}

/// Normalised form of an infohash for dedupe: trimmed + lowercased.
fn normalize_infohash(raw: &str) -> String {
    raw.trim().to_ascii_lowercase()
}

/// Collapse duplicate releases. Two key shapes:
/// 1. an exact shared infohash (same torrent listed by several plugins), or
/// 2. no infohash (built-in source results never carry one) but the same
///    normalised primary title — editions/repack noise is folded away by
///    [`source_manager::normalize_title`], so "Hollow Knight: Voidheart
///    Edition" listings from different sources merge into one row.
///
/// The higher-scored row survives (its metadata is kept wholesale); the
/// loser contributes any `uris` the winner lacks, and `seeds`/`peers`,
/// `verified`, `torrentUrl`, `uploadDate` fall back to the loser's values
/// when the winner has none. A *differing* infohash always stays a
/// separate row — two distinct torrents of one release are two downloads.
fn merge_duplicates(results: Vec<DownloadSearchResult>) -> Vec<DownloadSearchResult> {
    let mut out: Vec<DownloadSearchResult> = Vec::with_capacity(results.len());
    let mut index: HashMap<String, usize> = HashMap::new();
    for result in results {
        match merge_key(&result) {
            Some(key) => match index.get(&key) {
                Some(&at) => merge_into(&mut out[at], result),
                None => {
                    index.insert(key, out.len());
                    out.push(result);
                }
            },
            None => out.push(result),
        }
    }
    out
}

/// Dedupe key for one result: `h:<infohash>` when the row carries one,
/// else `t:<normalised-title>` when the title normalises to something
/// usable. `None` rows never merge.
fn merge_key(result: &DownloadSearchResult) -> Option<String> {
    if let Some(hash) = result
        .infohash
        .as_deref()
        .map(normalize_infohash)
        .filter(|h| !h.is_empty())
    {
        return Some(format!("h:{hash}"));
    }
    let title = source_manager::normalize_title(&result.title);
    if title.chars().count() >= 2 {
        Some(format!("t:{title}"))
    } else {
        None
    }
}

/// Fold `result` into the row already indexed under the same key.
fn merge_into(kept: &mut DownloadSearchResult, result: DownloadSearchResult) {
    let opt_max = |a: Option<u32>, b: Option<u32>| match (a, b) {
        (Some(x), Some(y)) => Some(x.max(y)),
        (x, y) => x.or(y),
    };
    if result.match_score > kept.match_score {
        let loser = std::mem::replace(kept, result);
        for uri in loser.uris {
            if !uri.is_empty() && !kept.uris.contains(&uri) {
                kept.uris.push(uri);
            }
        }
        kept.seeds = opt_max(kept.seeds, loser.seeds);
        kept.peers = opt_max(kept.peers, loser.peers);
        if kept.verified.is_none() {
            kept.verified = loser.verified;
        }
        if kept.torrent_url.is_none() {
            kept.torrent_url = loser.torrent_url;
        }
        if kept.upload_date.is_none() {
            kept.upload_date = loser.upload_date;
        }
    } else {
        for uri in result.uris {
            if !uri.is_empty() && !kept.uris.contains(&uri) {
                kept.uris.push(uri);
            }
        }
        kept.seeds = opt_max(kept.seeds, result.seeds);
        kept.peers = opt_max(kept.peers, result.peers);
        if kept.verified.is_none() {
            kept.verified = result.verified;
        }
        if kept.torrent_url.is_none() {
            kept.torrent_url = result.torrent_url;
        }
        if kept.upload_date.is_none() {
            kept.upload_date = result.upload_date;
        }
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
            "romsfun",
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
                    .cookie_store(true)
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
                    let results = match runtime::run_search(&descriptor, "elden ring", "{}", &http) {
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
            let results = runtime::run_search(&descriptor, "cult of the lamb", "{}", &http).expect("run_search");
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

    /// Live check of the AnkerGames plugin: the catalog search must return
    /// hits AND the CSRF-gated mint must produce at least one signed
    /// `https://ankergames.net/download/<token>` page. That mint is the part
    /// that regressed silently when the sandbox HTTP client had no cookie
    /// jar (the POST answers 419 without the session the token belongs to).
    #[tokio::test]
    #[ignore]
    async fn ankergames_plugin_live_search() {
        let plugins_dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../plugins");
        let plugin_path = std::path::Path::new(plugins_dir).join("ankergames.js");
        let source = std::fs::read_to_string(&plugin_path).expect("read ankergames.js");

        let (descriptor, results) = tokio::task::spawn_blocking(move || {
            let http = reqwest::blocking::Client::builder()
                .user_agent(PLUGIN_HTTP_UA)
                .timeout(Duration::from_secs(20))
                .use_rustls_tls()
                .cookie_store(true)
                .build()
                .expect("client");

            let descriptor = runtime::evaluate_plugin(&source, &http).expect("evaluate_plugin");
            let results =
                runtime::run_search(&descriptor, "elden ring", "{}", &http).expect("run_search");
            (descriptor, results)
        })
        .await
        .expect("spawn_blocking");

        assert_eq!(descriptor.manifest.id, "ankergames");
        assert!(
            results.iter().any(|r| r.title.to_lowercase().contains("elden ring")),
            "ankergames search returned no Elden Ring hit"
        );

        let minted: Vec<&str> = results
            .iter()
            .filter_map(|r| r.direct_urls.as_ref())
            .flat_map(|urls| urls.iter())
            .map(String::as_str)
            .collect();
        eprintln!("[plugins] ankergames minted: {minted:?}");
        assert!(
            minted.iter().any(|u| u.starts_with("https://ankergames.net/download/")),
            "expected at least one minted download page, got none (cookie jar / CSRF regression?)"
        );
    }

    /// Minimal `DownloadSearchResult` for the merge helper tests.
    fn result_with(
        infohash: Option<&str>,
        uris: &[&str],
        seeds: Option<u32>,
        peers: Option<u32>,
    ) -> DownloadSearchResult {
        DownloadSearchResult {
            id: String::new(),
            source_name: String::new(),
            source_id: String::new(),
            title: String::new(),
            file_size: String::new(),
            uris: uris.iter().map(|s| s.to_string()).collect(),
            magnet: None,
            upload_date: None,
            match_score: 1.0,
            is_new: false,
            provider: "plugin".to_string(),
            plugin_id: None,
            infohash: infohash.map(str::to_string),
            seeds,
            peers,
            torrent_url: None,
            verified: None,
            detail_url: None,
            platform: None,
            provenance: None,
            referer: None,
            platform_category: "pc".to_string(),
            match_title: None,
            file_list: None,
            checksums: None,
            version: None,
            region: None,
            cover_url: None,
            description: None,
            release_group: None,
            recommended: None,
        }
    }

    #[test]
    fn merge_by_infohash_merges_shared_and_keeps_distinct() {
        // The first two share a hash modulo case/whitespace and must
        // collapse (union uris, keep the larger seeds/peers); the
        // different hash and the hashless result stay separate.
        let merged = merge_duplicates(vec![
            result_with(Some("ABC123"), &["magnet:a"], Some(5), Some(1)),
            result_with(Some("  abc123 "), &["magnet:b", "magnet:a"], Some(9), Some(2)),
            result_with(Some("deadbeef"), &["magnet:c"], Some(1), None),
            result_with(None, &["magnet:d"], None, None),
        ]);
        assert_eq!(merged.len(), 3, "same hash merges, others stay separate");
        let first = &merged[0];
        assert_eq!(first.uris, vec!["magnet:a", "magnet:b"]);
        assert_eq!(first.seeds, Some(9));
        assert_eq!(first.peers, Some(2));
        assert!(merged
            .iter()
            .any(|r| r.infohash.as_deref() == Some("deadbeef")));
        assert!(merged.iter().any(|r| r.infohash.is_none()));
    }

    #[test]
    fn merge_duplicates_merges_same_title_without_infohash() {
        // Built-in source rows carry no infohash — the normalised title
        // is the merge key. The higher-scored row wins and the loser's
        // uris + swarm data fold into it.
        let mut a = result_with(None, &["magnet:a"], Some(2), None);
        a.title = "Hollow Knight: Voidheart Edition".into();
        a.match_score = 0.8;
        let mut b = result_with(None, &["magnet:b"], Some(7), Some(3));
        b.title = "Hollow Knight [FitGirl Repack]".into();
        b.match_score = 0.9;
        let merged = merge_duplicates(vec![a, b]);
        assert_eq!(merged.len(), 1, "same game merges across sources/plugins");
        assert_eq!(merged[0].uris, vec!["magnet:b", "magnet:a"]);
        assert_eq!(merged[0].seeds, Some(7));
    }

    #[test]
    fn merge_duplicates_keeps_different_games_apart() {
        let mut a = result_with(None, &["magnet:a"], None, None);
        a.title = "Elden Ring".into();
        // Edition/repack noise normalises away, so this one merges with `a`.
        let mut b = result_with(None, &["magnet:b"], None, None);
        b.title = "Elden Ring [Gold Edition]".into();
        let mut c = result_with(None, &["magnet:c"], None, None);
        c.title = "Farming Simulator 22".into();
        let merged = merge_duplicates(vec![a, b, c]);
        assert_eq!(merged.len(), 2);
        assert!(merged.iter().any(|r| r.title.contains("Elden")));
        assert!(merged.iter().any(|r| r.title.contains("Farming")));
    }

    #[test]
    fn manifest_json_round_trip_preserves_extended_fields() {
        let manifest = runtime::PluginManifest {
            id: "demo".into(),
            name: "Demo".into(),
            version: "1.0.0".into(),
            author: "me".into(),
            description: "desc".into(),
            source_url: "https://example.com".into(),
            platform_category: "hybrid".into(),
            allowed_hosts: vec!["example.com".into()],
            rate_limit_ms: 500,
            cache_ttl_secs: Some(120),
            icon: Some("https://example.com/icon.png".into()),
            homepage: Some("https://example.com".into()),
            capabilities: vec!["search".into(), "direct".into()],
            config: vec![runtime::PluginConfigField {
                key: "apiKey".into(),
                label: "API key".into(),
                secret: true,
                required: true,
                placeholder: Some("sk-...".into()),
                description: Some("your key".into()),
            }],
        };
        let json = serde_json::to_string(&manifest).expect("serialize manifest");
        // The stored blob is camelCase, which `plugin_cache_ttl` reads.
        assert!(json.contains("\"cacheTtlSecs\":120"), "json was {json}");
        assert!(json.contains("\"allowedHosts\":[\"example.com\"]"));
        let back: runtime::PluginManifest =
            serde_json::from_str(&json).expect("deserialize manifest");
        assert_eq!(manifest, back);
    }

    #[test]
    fn config_account_sanitizes_to_keychain_alphabet() {
        // Ids allow `-`; keys may be arbitrary. Both fold to [a-z0-9_]
        // and the `plugin_` prefix separates them from other entries.
        assert_eq!(
            config_account("my-plugin", "apiKey"),
            "plugin_my_plugin_apikey"
        );
        assert_eq!(
            config_account("Rom-Fun.2", "client.id/secret"),
            "plugin_rom_fun_2_client_id_secret"
        );
        // Already-clean values are left alone, and the transform is
        // deterministic (same input -> same account).
        assert_eq!(config_account("abc_123", "key_1"), "plugin_abc_123_key_1");
        assert_eq!(
            config_account("my-plugin", "apiKey"),
            config_account("my-plugin", "apiKey")
        );
    }

    #[test]
    fn config_json_tolerates_missing_values() {
        let declared = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        let mut stored = HashMap::new();
        stored.insert("a".to_string(), "secret-a".to_string());
        // `b` is declared but unset and `c` is not stored at all — both
        // must be omitted rather than nulled.
        let json = config_json(&declared, &stored);
        assert_eq!(json, r#"{"a":"secret-a"}"#);

        // Nothing configured -> still a valid empty JSON object so
        // legacy plugins that ignore the second search argument work.
        assert_eq!(config_json(&[], &HashMap::new()), "{}");
        assert_eq!(
            config_json(&["missing".to_string()], &HashMap::new()),
            "{}"
        );
    }
}
