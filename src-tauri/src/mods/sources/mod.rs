//! Multi-source mod browsing ("Discover").
//!
//! Aggregates the popular mod websites behind one normalized contract so
//! the frontend can browse/search/download regardless of the site. Each
//! site lives in its own submodule and speaks its native API; this module
//! owns the shared types, the per-game source *detection* (which sites
//! have content for a game), credential handling, and the Tauri commands.
//!
//! Sites: Nexus Mods, Thunderstore, GameBanana, ModDB, CurseForge,
//! mod.io, and Steam Workshop browsing. Credentials (where required) go
//! to the OS keychain; Steam Workshop reuses the library sync session.

pub mod curseforge;
pub mod gamebanana;
pub mod moddb;
pub mod modio;
pub mod nexus;
pub mod thunderstore;
pub mod workshop;

use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

use crate::db::{self, games::GameRow};

pub const SOURCE_NEXUS: &str = "nexus";
pub const SOURCE_THUNDERSTORE: &str = "thunderstore";
pub const SOURCE_GAMEBANANA: &str = "gamebanana";
pub const SOURCE_MODDB: &str = "moddb";
pub const SOURCE_CURSEFORGE: &str = "curseforge";
pub const SOURCE_MODIO: &str = "modio";
pub const SOURCE_WORKSHOP: &str = "workshop";

pub const ALL_SOURCES: &[&str] = &[
    SOURCE_NEXUS,
    SOURCE_THUNDERSTORE,
    SOURCE_GAMEBANANA,
    SOURCE_MODDB,
    SOURCE_CURSEFORGE,
    SOURCE_MODIO,
    SOURCE_WORKSHOP,
];

/// Keychain account that holds a source's API key, if it needs one.
pub fn credential_account(source: &str) -> Option<&'static str> {
    match source {
        SOURCE_NEXUS => Some(crate::mods::nexus::NEXUS_KEY_ACCOUNT),
        SOURCE_CURSEFORGE => Some("curseforge_api_key"),
        SOURCE_MODIO => Some("modio_api_key"),
        _ => None,
    }
}

pub fn display_name(source: &str) -> &'static str {
    match source {
        SOURCE_NEXUS => "Nexus Mods",
        SOURCE_THUNDERSTORE => "Thunderstore",
        SOURCE_GAMEBANANA => "GameBanana",
        SOURCE_MODDB => "Mod DB",
        SOURCE_CURSEFORGE => "CurseForge",
        SOURCE_MODIO => "mod.io",
        SOURCE_WORKSHOP => "Steam Workshop",
        _ => "Unknown",
    }
}

pub fn homepage(source: &str) -> &'static str {
    match source {
        SOURCE_NEXUS => "https://www.nexusmods.com",
        SOURCE_THUNDERSTORE => "https://thunderstore.io",
        SOURCE_GAMEBANANA => "https://gamebanana.com",
        SOURCE_MODDB => "https://www.moddb.com",
        SOURCE_CURSEFORGE => "https://www.curseforge.com",
        SOURCE_MODIO => "https://mod.io",
        SOURCE_WORKSHOP => "https://steamcommunity.com/workshop",
        _ => "https://example.com",
    }
}

pub fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

// ── Shared HTTP client ──────────────────────────────────────────────

static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

/// Shared, browser-ish client for every mod site. Some sites 403 the
/// default reqwest UA, so we present as a regular browser.
pub fn http_client() -> reqwest::Client {
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .user_agent(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
                     (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                )
                .timeout(Duration::from_secs(30))
                .cookie_store(true)
                .build()
                .unwrap_or_else(|_| reqwest::Client::new())
        })
        .clone()
}

// ── Value helpers (APIs drift; parse defensively) ───────────────────

pub fn val_str(v: &Value, keys: &[&str]) -> Option<String> {
    for k in keys {
        if let Some(s) = v.get(*k).and_then(|x| x.as_str()) {
            if !s.trim().is_empty() {
                return Some(s.to_string());
            }
        }
        if let Some(n) = v.get(*k).and_then(|x| x.as_i64()) {
            return Some(n.to_string());
        }
    }
    None
}

pub fn val_i64(v: &Value, keys: &[&str]) -> Option<i64> {
    for k in keys {
        if let Some(n) = v.get(*k).and_then(|x| x.as_i64()) {
            return Some(n);
        }
        if let Some(n) = v.get(*k).and_then(|x| x.as_f64()) {
            return Some(n as i64);
        }
        if let Some(s) = v.get(*k).and_then(|x| x.as_str()) {
            if let Ok(n) = s.parse::<i64>() {
                return Some(n);
            }
        }
    }
    None
}

/// Coerce a timestamp that may be unix seconds, unix millis, or an ISO
/// string into a plain string the frontend can normalize.
pub fn timestamp_string(v: Option<&Value>) -> Option<String> {
    let v = v?;
    if let Some(n) = v.as_i64() {
        return Some(n.to_string());
    }
    if let Some(s) = v.as_str() {
        if !s.trim().is_empty() {
            return Some(s.to_string());
        }
    }
    None
}

/// Pick the first array found at any of the given keys, or the value
/// itself when it already is an array.
pub fn first_array<'a>(v: &'a Value, keys: &[&str]) -> Option<&'a Vec<Value>> {
    if let Some(a) = v.as_array() {
        return Some(a);
    }
    for k in keys {
        if let Some(a) = v.get(*k).and_then(|x| x.as_array()) {
            return Some(a);
        }
    }
    None
}

/// Lowercase, collapse non-alphanumerics, drop common edition noise so
/// a game title matches a site's name/slug.
pub fn normalize_name(s: &str) -> String {
    let lower = s.to_lowercase();
    let mut out = String::with_capacity(lower.len());
    for c in lower.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        }
    }
    out
}

/// URL slug form of a title (`The Witcher 3` → `the-witcher-3`).
/// Periods and apostrophes are dropped rather than turned into dashes so
/// acronym titles survive: `S.T.A.L.K.E.R.` → `stalker`.
pub fn slugify(s: &str) -> String {
    let lower = s.to_lowercase();
    let mut out = String::with_capacity(lower.len());
    let mut prev_dash = false;
    for c in lower.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
            prev_dash = false;
        } else if c == '.' || c == '\'' || c == '\u{2019}' {
            // Drop punctuation that isn't a word separator.
            continue;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    out.trim_matches('-').to_string()
}

/// Titles we try when matching a game on a mod site: the user's display
/// name, the canonical name, and any IGDB alternative names. More
/// candidates means fewer "no matching game found" cases across sites.
pub fn title_candidates(game: &GameRow) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut push = |s: &str| {
        let t = s.trim();
        if t.is_empty() {
            return;
        }
        if !out.iter().any(|e| e.eq_ignore_ascii_case(t)) {
            out.push(t.to_string());
        }
    };
    if let Some(d) = &game.display_name {
        push(d);
    }
    push(&game.name);
    if let Some(alts) = &game.alternative_names {
        for a in alts.iter().take(8) {
            push(a);
        }
    }
    out
}

/// Words that don't help distinguish one game from another.
const STOP_WORDS: &[&str] = &[
    "the", "a", "an", "of", "and", "edition", "definitive", "remastered", "enhanced",
    "complete", "deluxe", "ultimate", "goty", "game", "year", "hd",
];

fn tokens(s: &str) -> std::collections::HashSet<String> {
    s.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty() && !STOP_WORDS.contains(t))
        .map(str::to_string)
        .collect()
}

/// Roman numerals 1–12 and their arabic forms. Sites are inconsistent
/// ("Final Fantasy VII" vs "Final Fantasy 7"), so we compare both.
const NUMERALS: &[(&str, &str)] = &[
    ("i", "1"),
    ("ii", "2"),
    ("iii", "3"),
    ("iv", "4"),
    ("v", "5"),
    ("vi", "6"),
    ("vii", "7"),
    ("viii", "8"),
    ("ix", "9"),
    ("x", "10"),
    ("xi", "11"),
    ("xii", "12"),
];

/// Rewrite standalone numeral tokens. The first token is left alone so
/// "I Am Alive" does not become "1 Am Alive".
fn swap_numerals(s: &str, roman_to_arabic: bool) -> String {
    let parts: Vec<&str> = s.split_whitespace().collect();
    let mut changed = false;
    let mut out: Vec<String> = Vec::with_capacity(parts.len());
    for (idx, part) in parts.iter().enumerate() {
        let lower = part.to_ascii_lowercase();
        let mapped = if roman_to_arabic {
            NUMERALS
                .iter()
                .find(|(r, _)| *r == lower)
                .map(|(_, a)| (*a).to_string())
        } else {
            NUMERALS
                .iter()
                .find(|(_, a)| *a == lower)
                .map(|(r, _)| (*r).to_string())
        };
        if idx > 0 {
            if let Some(m) = mapped {
                changed = true;
                out.push(m);
                continue;
            }
        }
        out.push((*part).to_string());
    }
    if changed {
        out.join(" ")
    } else {
        s.to_string()
    }
}

fn push_unique(out: &mut Vec<(String, bool)>, v: String, allow_containment: bool) {
    if !out.iter().any(|(e, _)| e == &v) {
        out.push((v, allow_containment));
    }
}

/// Spelling variants worth comparing: the raw title, `&`→`and`, and
/// roman↔arabic numeral swaps. `bool` marks whether containment matching
/// is safe — it is not for numeral swaps, where "Civilization V" is a
/// string prefix of "Civilization VI" but the games differ.
fn raw_variants(s: &str) -> Vec<(String, bool)> {
    let mut out: Vec<(String, bool)> = Vec::new();
    push_unique(&mut out, s.to_string(), true);
    let amp = s.replace('&', "and");
    push_unique(&mut out, amp.clone(), true);
    for base in [s, amp.as_str()] {
        push_unique(&mut out, swap_numerals(base, true), false);
        push_unique(&mut out, swap_numerals(base, false), false);
    }
    out
}

/// 0..100 similarity between a game title and a site's name/slug.
/// Exact matches win; containment ("Skyrim" in "The Elder Scrolls V:
/// Skyrim") next; otherwise a stop-word-aware token overlap decides, so
/// "Fallout 4" does not match "Fallout 76".
pub fn score_name(candidate: &str, target: &str) -> i32 {
    let ca = raw_variants(candidate);
    let tb = raw_variants(target);
    let mut best = 0;
    for (a_raw, a_allow) in &ca {
        let a = normalize_name(a_raw);
        if a.is_empty() {
            continue;
        }
        for (b_raw, b_allow) in &tb {
            let b = normalize_name(b_raw);
            if b.is_empty() {
                continue;
            }
            best = best.max(pair_score(a_raw, &a, b_raw, &b, *a_allow && *b_allow));
            if best == 100 {
                return 100;
            }
        }
    }
    best
}

fn pair_score(a_raw: &str, a: &str, b_raw: &str, b: &str, allow_containment: bool) -> i32 {
    if a == b {
        return 100;
    }
    // A meaningful title contained in a longer one. The length guard
    // keeps short generic words from matching everything.
    if allow_containment {
        let (short, long) = if a.len() <= b.len() { (a, b) } else { (b, a) };
        if short.len() >= 5 && long.contains(short) {
            return 85;
        }
    }
    let ta = tokens(a_raw);
    let tb = tokens(b_raw);
    if ta.is_empty() || tb.is_empty() {
        return 0;
    }
    let inter = ta.intersection(&tb).count() as f64;
    let union = ta.union(&tb).count() as f64;
    if union == 0.0 {
        return 0;
    }
    let score = (inter / union) * 100.0;
    if score >= 60.0 {
        score as i32
    } else {
        0
    }
}

/// Best score for a set of candidate titles against a set of site names.
pub fn best_score(candidates: &[String], targets: &[&str]) -> i32 {
    let mut best = 0;
    for c in candidates {
        for t in targets {
            best = best.max(score_name(c, t));
        }
    }
    best
}

/// Minimum score a candidate must reach before we accept a mapping.
pub const MATCH_FLOOR: i32 = 60;

// ── Types ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModSourceInfo {
    pub id: String,
    pub name: String,
    pub homepage: String,
    /// A key/token is needed before this source can be used.
    pub requires_credential: bool,
    pub has_credential: bool,
    /// A mapping (game → external id) exists, so browsing can start.
    pub available: bool,
    /// Resolved external id on the site (Nexus domain, Thunderstore
    /// community, …). `None` when we haven't resolved it yet.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub external_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub external_label: Option<String>,
    /// Some sites (Workshop) can't hand out an archive — the UI opens
    /// the site instead of downloading.
    pub direct_download: bool,
    /// True when the site has its own search/pagination (vs. a static
    /// catalog we filter client-side).
    pub supports_search: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteModSummary {
    pub source: String,
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub downloads: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub endorsements: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail_url: Option<String>,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_count: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteModFile {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uploaded_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(default)]
    pub is_primary: bool,
    /// `direct` (backend can stream it), `external` (open the site),
    /// or `steam` (subscribe through the Steam client).
    pub download_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub download_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteModLink {
    pub label: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteModDetail {
    pub summary: RemoteModSummary,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub gallery: Vec<String>,
    #[serde(default)]
    pub files: Vec<RemoteModFile>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub links: Vec<RemoteModLink>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteModSearch {
    pub source: String,
    pub query: String,
    pub results: Vec<RemoteModSummary>,
    pub page: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<i64>,
    pub has_more: bool,
}

#[derive(Debug, Clone)]
pub struct GameRef {
    pub external_id: String,
    pub label: String,
}

#[derive(Debug, Clone)]
pub struct RemoteDownload {
    pub kind: String,
    pub url: String,
    pub filename: Option<String>,
    pub referer: Option<String>,
    pub headers: Vec<(String, String)>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInstallResult {
    /// `installed` | `manual` | `external` | `steam`
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installed_path: Option<String>,
    pub installed_files: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

// ── Credentials ─────────────────────────────────────────────────────

pub fn credential_for(source: &str) -> Result<Option<String>, String> {
    match credential_account(source) {
        Some(account) => crate::db::secrets::SecretStore::new().get(account),
        None => Ok(None),
    }
}

pub fn set_credential_for(source: &str, key: &str) -> Result<(), String> {
    let account = credential_account(source)
        .ok_or_else(|| format!("{} does not use an API key", display_name(source)))?;
    let store = crate::db::secrets::SecretStore::new();
    if key.trim().is_empty() {
        store.delete(account)
    } else {
        store.set(account, key.trim())
    }
}

/// Steam Web API key from the library-sync session (Workshop browsing).
pub fn steam_api_key() -> Option<String> {
    let secret = crate::db::secrets::SecretStore::new()
        .get("steam_session")
        .ok()
        .flatten()?;
    let v: Value = serde_json::from_str(&secret).ok()?;
    // `SteamSession` serialises with `rename_all = "camelCase"`, so the
    // stored key is `apiKey`; `api_key`/`webApiToken` are tolerated for
    // older blobs.
    v.get("apiKey")
        .or_else(|| v.get("api_key"))
        .or_else(|| v.get("webApiToken"))
        .and_then(|x| x.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
}

// ── Dispatch ────────────────────────────────────────────────────────

pub async fn resolve_game(
    source: &str,
    candidates: &[String],
    steam_app_id: Option<u32>,
    existing: Option<&str>,
) -> Result<Option<GameRef>, String> {
    match source {
        SOURCE_NEXUS => nexus::resolve_game(candidates, existing).await,
        SOURCE_THUNDERSTORE => thunderstore::resolve_game(candidates).await,
        SOURCE_GAMEBANANA => gamebanana::resolve_game(candidates).await,
        SOURCE_MODDB => moddb::resolve_game(candidates).await,
        SOURCE_CURSEFORGE => curseforge::resolve_game(candidates).await,
        SOURCE_MODIO => modio::resolve_game(candidates).await,
        SOURCE_WORKSHOP => Ok(steam_app_id.map(|id| GameRef {
            external_id: id.to_string(),
            label: format!("App {id}"),
        })),
        _ => Err(format!("unknown mod source: {source}")),
    }
}

pub async fn browse(
    source: &str,
    external_id: &str,
    query: &str,
    sort: &str,
    page: u32,
    page_size: u32,
) -> Result<RemoteModSearch, String> {
    let mut out = match source {
        SOURCE_NEXUS => nexus::browse(external_id, query, sort, page, page_size).await?,
        SOURCE_THUNDERSTORE => {
            thunderstore::browse(external_id, query, sort, page, page_size).await?
        }
        SOURCE_GAMEBANANA => {
            gamebanana::browse(external_id, query, sort, page, page_size).await?
        }
        SOURCE_MODDB => moddb::browse(external_id, query, sort, page, page_size).await?,
        SOURCE_CURSEFORGE => {
            curseforge::browse(external_id, query, sort, page, page_size).await?
        }
        SOURCE_MODIO => modio::browse(external_id, query, sort, page, page_size).await?,
        SOURCE_WORKSHOP => workshop::browse(external_id, query, sort, page, page_size).await?,
        _ => return Err(format!("unknown mod source: {source}")),
    };
    out.source = source.to_string();
    Ok(out)
}

pub async fn detail(
    source: &str,
    external_id: &str,
    mod_id: &str,
) -> Result<RemoteModDetail, String> {
    match source {
        SOURCE_NEXUS => nexus::detail(external_id, mod_id).await,
        SOURCE_THUNDERSTORE => thunderstore::detail(external_id, mod_id).await,
        SOURCE_GAMEBANANA => gamebanana::detail(external_id, mod_id).await,
        SOURCE_MODDB => moddb::detail(external_id, mod_id).await,
        SOURCE_CURSEFORGE => curseforge::detail(external_id, mod_id).await,
        SOURCE_MODIO => modio::detail(external_id, mod_id).await,
        SOURCE_WORKSHOP => workshop::detail(external_id, mod_id).await,
        _ => Err(format!("unknown mod source: {source}")),
    }
}

async fn resolve_download(
    source: &str,
    external_id: &str,
    mod_id: &str,
    file_id: Option<&str>,
) -> Result<RemoteDownload, String> {
    match source {
        SOURCE_NEXUS => nexus::download(external_id, mod_id, file_id).await,
        SOURCE_THUNDERSTORE => thunderstore::download(external_id, mod_id, file_id).await,
        SOURCE_GAMEBANANA => gamebanana::download(external_id, mod_id, file_id).await,
        SOURCE_MODDB => moddb::download(external_id, mod_id, file_id).await,
        SOURCE_CURSEFORGE => curseforge::download(external_id, mod_id, file_id).await,
        SOURCE_MODIO => modio::download(external_id, mod_id, file_id).await,
        SOURCE_WORKSHOP => workshop::download(external_id, mod_id, file_id).await,
        _ => Err(format!("unknown mod source: {source}")),
    }
}

// ── Detection ───────────────────────────────────────────────────────

fn info_for(
    source: &str,
    has_credential: bool,
    link: Option<&db::mods::ModSourceLinkRow>,
    nexus_domain: Option<&str>,
    steam_app_id: Option<u32>,
) -> ModSourceInfo {
    let requires_credential = credential_account(source).is_some() || source == SOURCE_WORKSHOP;
    let (external_id, external_label) = if let Some(l) = link {
        (Some(l.external_id.clone()), l.display_name.clone())
    } else if source == SOURCE_NEXUS {
        (nexus_domain.map(str::to_string), nexus_domain.map(str::to_string))
    } else if source == SOURCE_WORKSHOP {
        (steam_app_id.map(|a| a.to_string()), steam_app_id.map(|a| format!("App {a}")))
    } else {
        (None, None)
    };

    let direct_download = !matches!(source, SOURCE_WORKSHOP);
    let supports_search = !matches!(source, SOURCE_NEXUS);
    let available = external_id.is_some()
        && (!requires_credential || has_credential)
        // Workshop needs the Steam API key to browse.
        && !(source == SOURCE_WORKSHOP && !has_credential);

    let note = if !has_credential && credential_account(source).is_some() {
        Some("API key required".to_string())
    } else if source == SOURCE_WORKSHOP && !has_credential {
        Some("Connect your Steam account to browse the Workshop".to_string())
    } else if external_id.is_none() {
        Some("No matching game found — set it manually".to_string())
    } else {
        None
    };

    ModSourceInfo {
        id: source.to_string(),
        name: display_name(source).to_string(),
        homepage: homepage(source).to_string(),
        requires_credential,
        has_credential,
        available,
        external_id,
        external_label,
        direct_download,
        supports_search,
        note,
    }
}

pub async fn detect_sources(
    db: &db::Db,
    game: &GameRow,
    resolve: bool,
) -> Result<Vec<ModSourceInfo>, String> {
    let links = db::mods::list_source_links(db, &game.id)?;
    let link_map: HashMap<String, db::mods::ModSourceLinkRow> = links
        .into_iter()
        .map(|l| (l.source.clone(), l))
        .collect();
    let settings = db::mods::get_settings(db, &game.id)?;
    let nexus_domain = settings.as_ref().and_then(|s| s.nexus_domain.clone());
    let candidates = title_candidates(game);

    // Optionally resolve unresolved mappings over the network, in
    // parallel. Each source is independent and time-boxed, so one slow
    // or failing site can't stall the others.
    let mut resolved: HashMap<String, GameRef> = HashMap::new();
    if resolve {
        let sources: Vec<&str> = ALL_SOURCES
            .iter()
            .copied()
            .filter(|s| {
                !link_map.contains_key(*s)
                    && !(*s == SOURCE_NEXUS && nexus_domain.is_some())
                    && !(*s == SOURCE_WORKSHOP && game.steam_app_id.is_some())
            })
            .collect();
        let futures = sources.iter().map(|s| {
            let source = *s;
            let candidates = candidates.clone();
            let existing = nexus_domain.clone();
            async move {
                let res = tokio::time::timeout(
                    Duration::from_secs(20),
                    resolve_game(source, &candidates, game.steam_app_id, existing.as_deref()),
                )
                .await
                .unwrap_or_else(|_| Err("detection timed out".to_string()));
                (source, res)
            }
        });
        for (source, res) in futures::future::join_all(futures).await {
            if let Ok(Some(gref)) = res {
                resolved.insert(source.to_string(), gref);
            }
        }
    }

    let mut out = Vec::new();
    for source in ALL_SOURCES {
        let has_credential = if *source == SOURCE_WORKSHOP {
            steam_api_key().is_some()
        } else {
            matches!(credential_for(source), Ok(Some(_)))
        };
        let link = link_map.get(*source);
        // Persist freshly resolved mappings so later loads are instant.
        if let Some(gref) = resolved.get(*source) {
            let row = db::mods::ModSourceLinkRow {
                game_id: game.id.clone(),
                source: source.to_string(),
                external_id: gref.external_id.clone(),
                display_name: Some(gref.label.clone()),
                updated_at: now_secs(),
            };
            let _ = db::mods::upsert_source_link(db, &row);
        }
        let effective_link = link.cloned().or_else(|| {
            resolved.get(*source).map(|g| db::mods::ModSourceLinkRow {
                game_id: game.id.clone(),
                source: source.to_string(),
                external_id: g.external_id.clone(),
                display_name: Some(g.label.clone()),
                updated_at: now_secs(),
            })
        });
        out.push(info_for(
            source,
            has_credential,
            effective_link.as_ref(),
            nexus_domain.as_deref(),
            game.steam_app_id,
        ));
    }
    Ok(out)
}

// ── Commands ────────────────────────────────────────────────────────

/// Which mod sites have content for this game. With `resolve = true`
/// the backend also tries to match the game name on each site (network).
#[tauri::command]
pub async fn mods_sources_detect(
    app: tauri::AppHandle,
    game_id: String,
    resolve: Option<bool>,
) -> Result<Vec<ModSourceInfo>, String> {
    use tauri::Manager;
    let db = app.state::<db::Db>().inner().clone();
    let game = db::games::get(&db, &game_id)?
        .ok_or_else(|| format!("game not found: {game_id}"))?;
    detect_sources(&db, &game, resolve.unwrap_or(false)).await
}

/// Credential status for every source (no network).
#[tauri::command]
pub fn mods_source_status() -> Result<Vec<ModSourceInfo>, String> {
    let mut out = Vec::new();
    for source in ALL_SOURCES {
        let has_credential = if *source == SOURCE_WORKSHOP {
            steam_api_key().is_some()
        } else {
            matches!(credential_for(source), Ok(Some(_)))
        };
        out.push(info_for(*source, has_credential, None, None, None));
    }
    Ok(out)
}

#[tauri::command]
pub fn mods_source_set_credential(source: String, key: String) -> Result<(), String> {
    set_credential_for(&source, &key)
}

/// Manually pin a game to an external id on a site (overrides detection).
#[tauri::command]
pub fn mods_source_set_link(
    app: tauri::AppHandle,
    game_id: String,
    source: String,
    external_id: String,
    display_name: Option<String>,
) -> Result<db::mods::ModSourceLinkRow, String> {
    use tauri::Manager;
    let db = app.state::<db::Db>().inner().clone();
    if external_id.trim().is_empty() {
        db::mods::delete_source_link(&db, &game_id, &source)?;
    }
    let row = db::mods::ModSourceLinkRow {
        game_id,
        source,
        external_id: external_id.trim().to_string(),
        display_name: display_name.filter(|s| !s.trim().is_empty()),
        updated_at: now_secs(),
    };
    db::mods::upsert_source_link(&db, &row)?;
    Ok(row)
}

#[tauri::command]
pub fn mods_source_clear_link(
    app: tauri::AppHandle,
    game_id: String,
    source: String,
) -> Result<(), String> {
    use tauri::Manager;
    let db = app.state::<db::Db>().inner().clone();
    db::mods::delete_source_link(&db, &game_id, &source)
}

#[tauri::command]
pub async fn mods_source_browse(
    source: String,
    external_id: String,
    query: String,
    sort: Option<String>,
    page: Option<u32>,
    page_size: Option<u32>,
) -> Result<RemoteModSearch, String> {
    browse(
        &source,
        &external_id,
        &query,
        sort.as_deref().unwrap_or("trending"),
        page.unwrap_or(1),
        page_size.unwrap_or(24).clamp(1, 60),
    )
    .await
}

#[tauri::command]
pub async fn mods_source_detail(
    source: String,
    external_id: String,
    mod_id: String,
) -> Result<RemoteModDetail, String> {
    detail(&source, &external_id, &mod_id).await
}

/// Download a remote mod (when the site allows it) and install it into
/// the game's mods folder. Falls back to `manual`/`external`/`steam`
/// when the site can only be driven through a browser/Steam.
#[tauri::command]
pub async fn mods_source_download(
    app: tauri::AppHandle,
    game_id: String,
    source: String,
    external_id: String,
    mod_id: String,
    file_id: Option<String>,
    name: Option<String>,
    author: Option<String>,
    version: Option<String>,
    remote_url: Option<String>,
    destination: Option<String>,
) -> Result<RemoteInstallResult, String> {
    let plan = resolve_download(&source, &external_id, &mod_id, file_id.as_deref()).await?;
    if plan.kind != "direct" {
        return Ok(RemoteInstallResult {
            status: plan.kind,
            installed_path: None,
            installed_files: 0,
            url: Some(plan.url),
            message: plan.message,
        });
    }
    install::download_and_install(
        app,
        game_id,
        source,
        external_id,
        mod_id,
        file_id,
        name,
        author,
        version,
        remote_url,
        destination,
        plan,
    )
    .await
}

#[tauri::command]
pub fn mods_remote_installs(
    app: tauri::AppHandle,
    game_id: String,
) -> Result<Vec<db::mods::ModRemoteInstallRow>, String> {
    use tauri::Manager;
    let db = app.state::<db::Db>().inner().clone();
    db::mods::list_remote_installs(&db, &game_id)
}

#[tauri::command]
pub fn mods_remote_install_remove(app: tauri::AppHandle, id: String) -> Result<(), String> {
    use tauri::Manager;
    let db = app.state::<db::Db>().inner().clone();
    db::mods::delete_remote_install(&db, &id)
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_name_strips_punctuation_and_case() {
        assert_eq!(normalize_name("The Witcher 3: Wild Hunt"), "thewitcher3wildhunt");
        assert_eq!(normalize_name("STALKER — Shadow of Chernobyl"), "stalkershadowofchernobyl");
    }

    #[test]
    fn score_name_matches_aliases_but_not_siblings() {
        // A subtitle alias matches its base title.
        assert_eq!(score_name("Skyrim", "The Elder Scrolls V: Skyrim"), 85);
        // Slug-form identifiers match exactly.
        assert_eq!(score_name("Risk of Rain 2", "riskofrain2"), 100);
        // Sequels must not collide.
        assert!(score_name("Fallout 4", "Fallout 76") < MATCH_FLOOR);
        assert!(score_name("Dark Souls", "Cyberpunk 2077") < MATCH_FLOOR);
    }

    #[test]
    fn score_name_bridges_numerals_and_ampersands() {
        assert_eq!(score_name("Final Fantasy VII", "Final Fantasy 7"), 100);
        assert_eq!(score_name("Half-Life 2", "Half-Life II"), 100);
        assert_eq!(score_name("Grand Theft Auto V", "Grand Theft Auto 5"), 100);
        assert!(score_name("Dungeons & Dragons", "Dungeons and Dragons") >= MATCH_FLOOR);
        // The numeral bridge must not merge different sequels.
        assert!(score_name("Civilization 5", "Civilization 6") < MATCH_FLOOR);
    }

    #[test]
    fn best_score_picks_the_closest_candidate() {
        let candidates = vec![
            "The Witcher 3: Wild Hunt".to_string(),
            "Witcher 3".to_string(),
        ];
        assert!(best_score(&candidates, &["The Witcher 3"]) >= MATCH_FLOOR);
        assert_eq!(best_score(&candidates, &["Cyberpunk 2077"]), 0);
    }

    #[test]
    fn slugify_makes_url_safe_slugs() {
        assert_eq!(slugify("The Witcher 3: Wild Hunt"), "the-witcher-3-wild-hunt");
        assert_eq!(slugify("  Halo: CE  "), "halo-ce");
        // Acronym titles drop their periods instead of hyphenating them.
        assert_eq!(
            slugify("S.T.A.L.K.E.R.: Call of Pripyat"),
            "stalker-call-of-pripyat"
        );
        assert_eq!(slugify("S.T.A.L.K.E.R. Anomaly"), "stalker-anomaly");
    }

    #[test]
    fn info_for_requires_credential_before_available() {
        // Nexus with a resolved domain but no key: mapped yet unusable.
        let no_key = info_for(SOURCE_NEXUS, false, None, Some("skyrimspecialedition"), None);
        assert!(!no_key.available);
        assert!(no_key.requires_credential);

        // With a key and a domain it becomes available.
        let ready = info_for(SOURCE_NEXUS, true, None, Some("skyrimspecialedition"), None);
        assert!(ready.available);
        assert_eq!(ready.external_id.as_deref(), Some("skyrimspecialedition"));
    }

    #[test]
    fn info_for_workshop_needs_steam_app_and_key() {
        let no_app = info_for(SOURCE_WORKSHOP, true, None, None, None);
        assert!(!no_app.available);
        let ready = info_for(SOURCE_WORKSHOP, true, None, None, Some(1091500));
        assert!(ready.available);
        assert_eq!(ready.external_id.as_deref(), Some("1091500"));
        assert!(!ready.direct_download);
    }

    #[test]
    fn value_helpers_handle_strings_and_numbers() {
        let v = serde_json::json!({ "name": "Mod", "id": 42, "empty": "" });
        assert_eq!(val_str(&v, &["name"]).as_deref(), Some("Mod"));
        assert_eq!(val_i64(&v, &["id"]), Some(42));
        // Empty strings are treated as absent so callers can fall back.
        assert_eq!(val_str(&v, &["empty", "missing"]), None);
        assert_eq!(timestamp_string(Some(&serde_json::json!(1700000000))).as_deref(), Some("1700000000"));
    }
}

// ── Download + install engine ───────────────────────────────────────

mod install {
    use super::*;
    use futures::StreamExt;
    use std::path::{Path, PathBuf};
    use tauri::{Emitter, Manager};

    #[derive(Debug, Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Progress {
        source: String,
        mod_id: String,
        phase: String,
        downloaded: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        total: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        message: Option<String>,
    }

    fn sanitize_filename(name: &str) -> String {
        let base = name
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or(name)
            .trim();
        let mut out = String::with_capacity(base.len());
        for c in base.chars() {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ' ' | '(' | ')') {
                out.push(c);
            } else {
                out.push('_');
            }
        }
        let out = out.trim().to_string();
        if out.is_empty() {
            "mod-download".to_string()
        } else {
            out
        }
    }

    fn archive_name(plan: &RemoteDownload, fallback: &str) -> String {
        if let Some(f) = &plan.filename {
            return sanitize_filename(f);
        }
        if let Some(f) = filename_from_url(&plan.url) {
            return sanitize_filename(&f);
        }
        sanitize_filename(fallback)
    }

    fn filename_from_url(url: &str) -> Option<String> {
        let path = url.split(['?', '#']).next().unwrap_or(url);
        let last = path.rsplit('/').next().unwrap_or("");
        if last.is_empty() || !last.contains('.') {
            None
        } else {
            Some(last.to_string())
        }
    }

    fn mod_downloads_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
        let dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("app data dir: {e}"))?
            .join("mod-downloads");
        std::fs::create_dir_all(&dir).map_err(|e| format!("mod downloads dir: {e}"))?;
        Ok(dir)
    }

    /// Stream a URL to `dest`, emitting progress. Returns bytes written.
    async fn stream_to_file(
        app: &tauri::AppHandle,
        plan: &RemoteDownload,
        dest: &Path,
        source: &str,
        mod_id: &str,
    ) -> Result<u64, String> {
        let mut req = http_client().get(&plan.url);
        for (k, v) in &plan.headers {
            req = req.header(k.as_str(), v.as_str());
        }
        if let Some(referer) = &plan.referer {
            req = req.header("Referer", referer.as_str());
        }
        let resp = req
            .send()
            .await
            .map_err(|e| format!("mod download request: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("mod download failed: HTTP {}", resp.status()));
        }
        let total = resp.content_length();
        let mut file = tokio::fs::File::create(dest)
            .await
            .map_err(|e| format!("mod download create: {e}"))?;
        let mut stream = resp.bytes_stream();
        let mut downloaded = 0u64;
        let mut last_emit = 0u64;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("mod download stream: {e}"))?;
            tokio::io::AsyncWriteExt::write_all(&mut file, &chunk)
                .await
                .map_err(|e| format!("mod download write: {e}"))?;
            downloaded += chunk.len() as u64;
            if downloaded - last_emit > 512 * 1024 {
                last_emit = downloaded;
                let _ = app.emit(
                    "mods-remote-progress",
                    Progress {
                        source: source.to_string(),
                        mod_id: mod_id.to_string(),
                        phase: "downloading".into(),
                        downloaded,
                        total,
                        message: None,
                    },
                );
            }
        }
        tokio::io::AsyncWriteExt::flush(&mut file)
            .await
            .map_err(|e| format!("mod download flush: {e}"))?;
        Ok(downloaded)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn download_and_install(
        app: tauri::AppHandle,
        game_id: String,
        source: String,
        _external_id: String,
        mod_id: String,
        file_id: Option<String>,
        name: Option<String>,
        author: Option<String>,
        version: Option<String>,
        remote_url: Option<String>,
        destination: Option<String>,
        plan: RemoteDownload,
    ) -> Result<RemoteInstallResult, String> {
        let db = app.state::<db::Db>().inner().clone();
        // Resolve the mods root: explicit destination → per-game custom
        // root → detected mods root.
        let settings = db::mods::get_settings(&db, &game_id)?;
        let root = destination
            .filter(|d| !d.trim().is_empty())
            .or_else(|| settings.as_ref().and_then(|s| s.custom_root.clone()))
            .or_else(|| settings.as_ref().and_then(|s| s.mods_root.clone()))
            .ok_or("install_target_missing: select a mods folder first")?;
        let target = PathBuf::from(&root);
        if !target.is_dir() {
            return Err("install_target_missing: destination folder was not found".into());
        }

        let label = name.clone().unwrap_or_else(|| mod_id.clone());
        let archive = mod_downloads_dir(&app)?.join(archive_name(&plan, &label));
        let _ = app.emit(
            "mods-remote-progress",
            Progress {
                source: source.clone(),
                mod_id: mod_id.clone(),
                phase: "starting".into(),
                downloaded: 0,
                total: None,
                message: None,
            },
        );
        let bytes = stream_to_file(&app, &plan, &archive, &source, &mod_id).await?;

        let _ = app.emit(
            "mods-remote-progress",
            Progress {
                source: source.clone(),
                mod_id: mod_id.clone(),
                phase: "installing".into(),
                downloaded: bytes,
                total: Some(bytes),
                message: None,
            },
        );

        let ext = archive
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let dest_for_extract = target.clone();
        let archive_for_extract = archive.clone();
        let result = tokio::task::spawn_blocking(move || match ext.as_str() {
            "zip" => crate::mods::install_zip_archive(&archive_for_extract, &dest_for_extract)
                .map(|n| (n, None)),
            _ => Err(
                "unsupported_archive: this archive isn't a ZIP — install it manually".to_string(),
            ),
        })
        .await
        .map_err(|e| format!("install task: {e}"))?;

        let (installed_files, manual_note) = match result {
            Ok((n, note)) => (n, note),
            Err(e) => {
                // Non-zip or a conflict: keep the archive so the user can
                // install it through the existing manual modal.
                return Ok(RemoteInstallResult {
                    status: "manual".into(),
                    installed_path: Some(archive.to_string_lossy().to_string()),
                    installed_files: 0,
                    url: Some(plan.url.clone()),
                    message: Some(e),
                });
            }
        };

        let install_id = format!("mri-{}-{}", game_id, now_secs());
        let record = db::mods::ModRemoteInstallRow {
            id: install_id,
            game_id: game_id.clone(),
            source: source.clone(),
            source_mod_id: mod_id.clone(),
            source_file_id: file_id,
            name: label,
            author,
            version,
            remote_url: remote_url.or_else(|| Some(plan.url.clone())),
            installed_path: Some(target.to_string_lossy().to_string()),
            installed_at: now_secs(),
        };
        let _ = db::mods::insert_remote_install(&db, &record);

        let _ = app.emit(
            "mods-remote-progress",
            Progress {
                source: source.clone(),
                mod_id: mod_id.clone(),
                phase: "complete".into(),
                downloaded: bytes,
                total: Some(bytes),
                message: Some(format!("{installed_files} files installed")),
            },
        );

        // Best-effort: drop the temp archive now the install finished.
        let _ = std::fs::remove_file(&archive);

        Ok(RemoteInstallResult {
            status: "installed".into(),
            installed_path: Some(target.to_string_lossy().to_string()),
            installed_files,
            url: Some(plan.url),
            message: manual_note,
        })
    }
}
