//! PCGamingWiki save-location lookups.
//!
//! PCGamingWiki stores every game's save/config paths in its `GameData`
//! Cargo table. Anonymous `action=cargoquery` calls are permission-denied
//! (the wiki requires a bot-password login), so this module uses the two
//! endpoints that stay open to anonymous readers:
//!
//!   1. `api/appid.php?appid=<id>` resolves a Steam app id to a wiki page
//!      (falling back to `action=opensearch` by title).
//!   2. `action=parse&prop=wikitext` returns the page source, from which the
//!      `{{Game data/saves|Platform|path}}` templates are parsed.
//!
//! Paths use PCGamingWiki's own placeholders (`{{p|appdata}}`, `{{p|uid}}`,
//! `<path-to-game>`, …). [`resolve_entries`] maps those onto the host's
//! standard folders (via [`super::detect`]) and expands single-segment
//! `<uid>` wildcards, so the result plugs straight into the existing
//! detection pipeline as `source = "pcgamingwiki"`.
//!
//! Results (including explicit negatives) are cached in the KV store for
//! [`CACHE_TTL_MS`] so a library scan never re-queries a game it has already
//! looked up. Requests are serialized by the caller; this module never fans
//! out concurrent fetches, and it identifies itself with a descriptive
//! User-Agent as the wiki's API policy requires.

use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::db::games::GameRow;
use crate::db::Db;

use super::detect::{DetectedLocation, Roots, TemplateCtx, resolve_template};
use super::registry::normalize_name;

/// How long a parsed wiki result (positive or negative) is trusted.
const CACHE_TTL_MS: u64 = 1000 * 60 * 60 * 24 * 7;
/// KV key prefix for cached lookups.
const CACHE_PREFIX: &str = "saves.pcgw.";
/// The wiki rate-limits anonymous traffic to 60 requests/minute and asks
/// for a descriptive User-Agent with contact information.
const USER_AGENT: &str = concat!(
    "GameIndex/",
    env!("CARGO_PKG_VERSION"),
    " (https://github.com/atxoxx/GameIndex)"
);

/// One `{{Game data/saves|Platform|path}}` row as written on the wiki.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PcgwEntry {
    pub platform: String,
    pub raw: String,
}

/// A cached lookup: the parsed rows plus a freshness stamp.
#[derive(Debug, Serialize, Deserialize)]
struct CachedEntries {
    entries: Vec<PcgwEntry>,
    updated_at: u64,
}

/// Outcome of a PCGamingWiki lookup for one game.
pub struct PcgwResult {
    pub locations: Vec<DetectedLocation>,
    /// True when a network request was attempted (drives scan pacing);
    /// false when the answer came from the KV cache.
    pub fetched: bool,
}

fn now_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .timeout(Duration::from_secs(20))
            .build()
            .expect("build PCGamingWiki HTTP client")
    })
}

// ── Wikitext parsing ─────────────────────────────────────────────────────

/// Extract the bodies of every `{{Game data/saves|…}}` call, honouring the
/// nested `{{p|…}}` templates inside path values.
pub fn parse_game_data(wikitext: &str) -> Vec<PcgwEntry> {
    const MARKER: &str = "{{Game data/saves";
    let mut out = Vec::new();
    let mut search_from = 0;
    while let Some(rel) = wikitext[search_from..].find(MARKER) {
        let start = search_from + rel;
        let Some(end) = matching_template_end(wikitext, start) else {
            break;
        };
        // Strip the wrapping `{{` / `}}`.
        let inner = &wikitext[start + 2..end - 2];
        let parts = split_top_level(inner);
        if parts.len() >= 3 {
            let platform = parts[1].trim().to_string();
            let raw = parts[2..].join("|").trim().to_string();
            if !platform.is_empty() && !raw.is_empty() {
                out.push(PcgwEntry { platform, raw });
            }
        }
        search_from = end;
    }
    out
}

/// Index just past the `}}` that closes the template opened at `start`.
fn matching_template_end(text: &str, start: usize) -> Option<usize> {
    let mut depth = 0i32;
    let mut i = start;
    while i < text.len() {
        if text[i..].starts_with("{{") {
            depth += 1;
            i += 2;
        } else if text[i..].starts_with("}}") {
            depth -= 1;
            i += 2;
            if depth == 0 {
                return Some(i);
            }
        } else {
            i += text[i..].chars().next().map(char::len_utf8).unwrap_or(1);
        }
    }
    None
}

/// Split a template body on top-level `|`, leaving nested `{{…}}` intact.
fn split_top_level(inner: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut cur = String::new();
    let mut depth = 0i32;
    let mut i = 0;
    while i < inner.len() {
        if inner[i..].starts_with("{{") {
            depth += 1;
            cur.push_str("{{");
            i += 2;
        } else if inner[i..].starts_with("}}") {
            depth -= 1;
            cur.push_str("}}");
            i += 2;
        } else {
            let ch = inner[i..].chars().next().unwrap();
            if ch == '|' && depth == 0 {
                parts.push(std::mem::take(&mut cur));
            } else {
                cur.push(ch);
            }
            i += ch.len_utf8();
        }
    }
    parts.push(cur);
    parts
}

// ── Path resolution ──────────────────────────────────────────────────────

/// The OS a path row targets, so Windows templates don't resolve against
/// Linux fallbacks (and vice versa).
fn current_os() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

fn platform_allowed(platform: &str) -> bool {
    platform_allowed_on(platform, current_os())
}

/// Whether a PCGamingWiki platform label applies to `os`. `Steam` covers
/// Steam Cloud `userdata` paths, which exist on every platform.
fn platform_allowed_on(platform: &str, os: &str) -> bool {
    match platform.trim().to_lowercase().as_str() {
        "steam" => true,
        "windows" => os == "windows",
        "linux" => os == "linux",
        "steam play (linux)" => os == "linux",
        "os x" | "macos" | "mac os x" => os == "macos",
        "epic games store" | "epic" => os == "windows" || os == "linux",
        _ => false,
    }
}

/// Translate PCGamingWiki placeholders into the token vocabulary understood
/// by [`super::detect::resolve_template`].
fn translate_tokens(raw: &str) -> String {
    raw.replace("{{p|appdata}}", "<winAppData>")
        .replace("{{p|localappdata}}", "<winLocalAppData>")
        .replace("{{p|userprofile}}", "<home>")
        .replace("{{p|savedgames}}", "<winSavedGames>")
        .replace("{{p|programdata}}", "<winProgramData>")
        .replace("{{p|game}}", "<base>")
        .replace("{{p|uid}}", "<uid>")
        .replace("%APPDATA%", "<winAppData>")
        .replace("%LOCALAPPDATA%", "<winLocalAppData>")
        .replace("%PROGRAMDATA%", "<winProgramData>")
        .replace("%USERPROFILE%", "<home>")
        .replace("<path-to-game>", "<base>")
        .replace("<Steam-folder>", "<home>/.steam/steam")
        .replace("<user-id>", "<uid>")
}

/// Reduce one raw path to a concrete, wildcard-free template. Globs and
/// optional-selection brackets are trimmed back to their parent folder so
/// the directory — not an unknown file — is what gets tracked.
fn sanitize_piece(piece: &str) -> Option<String> {
    let mut s = piece
        .trim()
        .replace("<br>", "")
        .replace('\\', "/");
    if let Some(i) = s.find('*') {
        s.truncate(i);
    }
    if let Some(i) = s.find('[') {
        let head = &s[..i];
        s = match head.rfind('/') {
            Some(j) => head[..j].to_string(),
            None => head.to_string(),
        };
    }
    while s.ends_with('/') {
        s.pop();
    }
    let s = s.trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

/// Cut a template at its first optional-selection bracket, backing up to the
/// enclosing folder. Done before splitting on ` • ` so brackets whose options
/// contain the delimiter (`profile[0 • 1 • 3].ojs`) don't fracture the path.
fn truncate_at_optional(template: &str) -> String {
    let Some(i) = template.find('[') else {
        return template.to_string();
    };
    let head = &template[..i];
    match head.rfind('/') {
        Some(j) => head[..j].to_string(),
        None => head.to_string(),
    }
}

/// Resolve one sanitized template to zero or more absolute paths. A
/// single-segment `<uid>` placeholder is expanded by listing the directory
/// that precedes it (e.g. `%APPDATA%\Game\<user-id>` or Steam `userdata`).
fn resolve_template_paths(template: &str, ctx: &TemplateCtx<'_>) -> Vec<PathBuf> {
    let Some(idx) = template.find("<uid>") else {
        return resolve_template(template, ctx).into_iter().collect();
    };
    let prefix = &template[..idx];
    let suffix = &template[idx + "<uid>".len()..];
    let Some(prefix_dir) = resolve_template(prefix, ctx) else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(&prefix_dir) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        if !entry.path().is_dir() {
            continue;
        }
        let mut candidate = entry.path();
        for seg in suffix.split('/').filter(|s| !s.is_empty()) {
            candidate.push(seg);
        }
        out.push(candidate);
    }
    out
}

/// Resolve parsed wiki rows against the host into detected locations.
pub fn resolve_entries(entries: &[PcgwEntry], ctx: &TemplateCtx<'_>) -> Vec<DetectedLocation> {
    let mut out: Vec<DetectedLocation> = Vec::new();
    for entry in entries {
        if !platform_allowed(&entry.platform) {
            continue;
        }
        let template = translate_tokens(&entry.raw);
        // Trim bracketed optionals first, then split any ` • `-packed
        // multi-path cell (some rows list several candidates).
        let template = truncate_at_optional(&template);
        for piece in template.split(" • ") {
            let Some(piece) = sanitize_piece(piece) else {
                continue;
            };
            for path in resolve_template_paths(&piece, ctx) {
                if !path.exists() {
                    continue;
                }
                let key = path.to_string_lossy().to_lowercase();
                if out.iter().any(|l| l.path.to_lowercase() == key) {
                    continue;
                }
                let label = path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("Saves")
                    .to_string();
                let kind = if path.is_dir() { "dir" } else { "file" };
                out.push(DetectedLocation {
                    path: path.to_string_lossy().replace('\\', "/"),
                    label,
                    kind: kind.to_string(),
                    source: "pcgamingwiki".to_string(),
                });
            }
        }
    }
    out
}

/// Build the resolution context for a game (mirrors `detect::detect_for_game`).
fn context_for<'a>(roots: &'a Roots, game: &GameRow) -> TemplateCtx<'a> {
    TemplateCtx {
        roots,
        app_id: game.steam_app_id,
        install_dir: super::detect::install_dir(game),
    }
}

// ── Network ──────────────────────────────────────────────────────────────

/// A fetched wiki answer, or the reason there isn't one.
enum Fetch {
    /// The page exists; rows may still be empty (game has no save data).
    Entries(Vec<PcgwEntry>),
    /// The page does not exist — cacheable as a negative.
    Missing,
    /// A request failed — do not cache, do not guess.
    Unavailable,
}

/// Extract a wiki page title from a resolved `/wiki/<Page>` URL.
fn page_from_wiki_url(url: &str) -> Option<String> {
    let path = url.split(['?', '#']).next().unwrap_or(url);
    let rest = path.split_once("/wiki/")?.1;
    if rest.is_empty() {
        return None;
    }
    let decoded = urlencoding::decode(rest)
        .map(|c| c.into_owned())
        .unwrap_or_else(|_| rest.to_string());
    let title = decoded.replace('_', " ");
    if title.is_empty() {
        None
    } else {
        Some(title)
    }
}

/// Pick the wiki page for a name search. Only a normalized-exact match is
/// trusted: opensearch orders by relevance, so a "close" first result can
/// belong to a different game and would attach that game's save folders.
fn pick_page_title(titles: &[String], name: &str) -> Option<String> {
    let target = normalize_name(name);
    if target.is_empty() {
        return None;
    }
    titles
        .iter()
        .find(|title| normalize_name(title) == target)
        .cloned()
}

/// Resolve a game to a wiki page title. `Err(())` signals a network
/// failure (so callers avoid caching a false negative).
async fn resolve_page_name(app_id: Option<u32>, name: &str) -> Result<Option<String>, ()> {
    if let Some(id) = app_id {
        let url = format!("https://www.pcgamingwiki.com/api/appid.php?appid={id}");
        match client().get(&url).send().await {
            Ok(resp) => {
                let path = resp.url().path().to_string();
                if let Some(page) = page_from_wiki_url(&path) {
                    return Ok(Some(page));
                }
            }
            Err(_) => return Err(()),
        }
    }

    let name = name.trim();
    if name.is_empty() {
        return Ok(None);
    }
    let url = format!(
        "https://www.pcgamingwiki.com/w/api.php?action=opensearch&format=json&limit=10&search={}",
        urlencoding::encode(name)
    );
    let resp = client().get(&url).send().await.map_err(|_| ())?;
    let json: serde_json::Value = resp.json().await.map_err(|_| ())?;
    let titles: Vec<String> = json
        .get(1)
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|t| t.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    Ok(pick_page_title(&titles, name))
}

/// Fetch and parse a page's `Game data/saves` rows.
async fn fetch_wikitext(page: &str) -> Result<Option<String>, ()> {
    let url = format!(
        "https://www.pcgamingwiki.com/w/api.php?action=parse&format=json&prop=wikitext&redirects=1&page={}",
        urlencoding::encode(page)
    );
    let resp = client().get(&url).send().await.map_err(|_| ())?;
    let json: serde_json::Value = resp.json().await.map_err(|_| ())?;
    Ok(json
        .get("parse")
        .and_then(|p| p.get("wikitext"))
        .and_then(|w| w.get("*"))
        .and_then(|v| v.as_str())
        .map(str::to_string))
}

async fn fetch_entries(app_id: Option<u32>, name: &str) -> Fetch {
    let page = match resolve_page_name(app_id, name).await {
        Ok(Some(page)) => page,
        Ok(None) => return Fetch::Missing,
        Err(()) => return Fetch::Unavailable,
    };
    match fetch_wikitext(&page).await {
        Ok(Some(wikitext)) => Fetch::Entries(parse_game_data(&wikitext)),
        Ok(None) => Fetch::Missing,
        Err(()) => Fetch::Unavailable,
    }
}

// ── Cache + entry point ──────────────────────────────────────────────────

fn cache_key(game: &GameRow) -> String {
    if let Some(id) = game.steam_app_id {
        format!("{CACHE_PREFIX}app.{id}")
    } else {
        format!("{CACHE_PREFIX}name.{}", normalize_name(&game.name))
    }
}

fn read_cache(db: &Db, key: &str) -> Option<Vec<PcgwEntry>> {
    let raw = crate::db::kv::get(db, key).ok().flatten()?;
    let cached: CachedEntries = serde_json::from_str(&raw).ok()?;
    if cached.updated_at + CACHE_TTL_MS > now_ms() {
        Some(cached.entries)
    } else {
        None
    }
}

fn write_cache(db: &Db, key: &str, entries: &[PcgwEntry]) {
    let cached = CachedEntries {
        entries: entries.to_vec(),
        updated_at: now_ms(),
    };
    if let Ok(json) = serde_json::to_string(&cached) {
        let _ = crate::db::kv::set(db, key, &json);
    }
}

/// Look up a game's save locations on PCGamingWiki.
///
/// Cache-first: a fresh KV entry (including a cached negative) short-circuits
/// the network. A live fetch is never fanned out by this function — the
/// caller controls pacing.
pub async fn detect_for_game(db: &Db, game: &GameRow) -> PcgwResult {
    let key = cache_key(game);
    if let Some(entries) = read_cache(db, &key) {
        let roots = Roots::resolve();
        let ctx = context_for(&roots, game);
        return PcgwResult {
            locations: resolve_entries(&entries, &ctx),
            fetched: false,
        };
    }

    let name = game.display_name.as_deref().unwrap_or(&game.name);
    let entries = match fetch_entries(game.steam_app_id, name).await {
        Fetch::Entries(entries) => {
            write_cache(db, &key, &entries);
            entries
        }
        Fetch::Missing => {
            write_cache(db, &key, &[]);
            Vec::new()
        }
        Fetch::Unavailable => Vec::new(),
    };

    let roots = Roots::resolve();
    let ctx = context_for(&roots, game);
    PcgwResult {
        locations: resolve_entries(&entries, &ctx),
        fetched: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roots_with(home: &std::path::Path) -> Roots {
        Roots {
            home: Some(home.to_path_buf()),
            appdata: Some(home.join("AppData/Roaming")),
            local_appdata: Some(home.join("AppData/Local")),
            local_low: Some(home.join("AppData/LocalLow")),
            documents: Some(home.join("Documents")),
            saved_games: Some(home.join("Saved Games")),
            program_data: None,
        }
    }

    fn ctx_for<'a>(roots: &'a Roots) -> TemplateCtx<'a> {
        TemplateCtx {
            roots,
            app_id: None,
            install_dir: None,
        }
    }

    #[test]
    fn parses_saves_rows_and_ignores_config() {
        let wikitext = r#"==Game data==
===Configuration file(s) location===
{{Game data|
{{Game data/config|Windows|{{p|appdata}}\EldenRing\GraphicsConfig.xml}}
}}
===Save game data location===
{{Game data|
{{Game data/saves|Windows|{{p|appdata}}\EldenRing\{{p|uid}}\}}
{{Game data/saves|Steam Play (Linux)|<SteamLibrary-folder>/steamapps/compatdata/1245620/pfx/}}
}}
"#;
        let entries = parse_game_data(wikitext);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].platform, "Windows");
        assert_eq!(entries[0].raw, r"{{p|appdata}}\EldenRing\{{p|uid}}\");
        assert_eq!(entries[1].platform, "Steam Play (Linux)");
    }

    #[test]
    fn missing_rows_are_empty() {
        assert!(parse_game_data("{{Infobox game\n|steam appid = 1\n}}").is_empty());
        // A dangling template must not panic.
        assert!(parse_game_data("{{Game data/saves|Windows").is_empty());
    }

    #[test]
    fn platform_filter_is_os_aware() {
        assert!(platform_allowed_on("Steam", "linux"));
        assert!(platform_allowed_on("Steam", "windows"));
        assert!(platform_allowed_on("Windows", "windows"));
        assert!(!platform_allowed_on("Windows", "linux"));
        assert!(platform_allowed_on("Linux", "linux"));
        assert!(!platform_allowed_on("Linux", "windows"));
        assert!(platform_allowed_on("OS X", "macos"));
        assert!(!platform_allowed_on("Steam Play (Linux)", "windows"));
        assert!(!platform_allowed_on("Unknown", "windows"));
    }

    #[test]
    fn sanitizes_globs_and_optionals() {
        assert_eq!(
            sanitize_piece(r"<winAppData>/Gnorp/Apologue/Saves/*"),
            Some("<winAppData>/Gnorp/Apologue/Saves".to_string())
        );
        assert_eq!(
            sanitize_piece(r"<winAppData>\EldenRing\"),
            Some("<winAppData>/EldenRing".to_string())
        );
        assert_eq!(sanitize_piece("   "), None);
        // Optionals are trimmed to their parent folder before the ` • `
        // split, so bracket options can't fracture the path.
        assert_eq!(
            truncate_at_optional("<base>/save/<uid>/profile[0 • 1 • 3].ojs"),
            "<base>/save/<uid>"
        );
    }

    #[test]
    fn expands_uid_wildcard_against_host_roots() {
        let dir = tempfile::tempdir().unwrap();
        let roots = roots_with(dir.path());
        let user_dir = roots
            .appdata
            .as_ref()
            .unwrap()
            .join("EldenRing/76561198000000000");
        std::fs::create_dir_all(&user_dir).unwrap();

        let entries = vec![PcgwEntry {
            platform: "Windows".into(),
            raw: r"{{p|appdata}}\EldenRing\{{p|uid}}\".into(),
        }];
        let ctx = ctx_for(&roots);
        let found = resolve_entries(&entries, &ctx);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].source, "pcgamingwiki");
        assert!(found[0].path.ends_with("EldenRing/76561198000000000"));
        assert_eq!(found[0].kind, "dir");
    }

    #[test]
    fn resolves_path_to_game_against_install_dir() {
        let dir = tempfile::tempdir().unwrap();
        let roots = roots_with(dir.path());
        let install = dir.path().join("Games/Kerbal");
        std::fs::create_dir_all(install.join("saves")).unwrap();
        let ctx = TemplateCtx {
            roots: &roots,
            app_id: None,
            install_dir: Some(install.clone()),
        };
        let entries = vec![PcgwEntry {
            platform: "Windows".into(),
            raw: r"<path-to-game>\saves".into(),
        }];
        let found = resolve_entries(&entries, &ctx);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].source, "pcgamingwiki");
        assert!(found[0].path.ends_with("Games/Kerbal/saves"));
        assert_eq!(found[0].kind, "dir");
    }

    #[test]
    fn skips_windows_rows_on_non_windows_and_missing_paths() {
        let dir = tempfile::tempdir().unwrap();
        let roots = roots_with(dir.path());
        let ctx = ctx_for(&roots);

        // Platform that doesn't apply to this host: never resolved.
        let wrong = vec![PcgwEntry {
            platform: "Windows".into(),
            raw: r"{{p|appdata}}\Game".into(),
        }];
        if !cfg!(target_os = "windows") {
            assert!(resolve_entries(&wrong, &ctx).is_empty());
        }

        // A resolvable path that simply doesn't exist is dropped.
        let absent = vec![PcgwEntry {
            platform: "Steam".into(),
            raw: r"{{p|appdata}}\NoSuchGame\saves".into(),
        }];
        assert!(resolve_entries(&absent, &ctx).is_empty());
    }

    #[test]
    fn page_from_wiki_url_decodes_title() {
        assert_eq!(
            page_from_wiki_url("https://www.pcgamingwiki.com/wiki/Elden_Ring")
                .as_deref(),
            Some("Elden Ring")
        );
        assert_eq!(
            page_from_wiki_url("https://www.pcgamingwiki.com/wiki/Baldur%27s_Gate_3")
                .as_deref(),
            Some("Baldur's Gate 3")
        );
        assert_eq!(
            page_from_wiki_url("https://www.pcgamingwiki.com/api/appid.php?appid=1"),
            None
        );
    }

    #[test]
    fn search_titles_must_match_exactly() {
        // An unrelated relevance hit must not be accepted.
        let unrelated = vec![
            "Elden Ring II".to_string(),
            "Elden Ring: Shadow of the Erdtree".to_string(),
        ];
        assert_eq!(pick_page_title(&unrelated, "Elden Ring"), None);

        // Exact match wins even when it is not the first result.
        let mixed = vec!["Some Other Game".to_string(), "Elden Ring".to_string()];
        assert_eq!(pick_page_title(&mixed, "Elden Ring").as_deref(), Some("Elden Ring"));

        // Normalization ignores case and punctuation.
        let punctuation = vec!["Baldurs Gate 3".to_string()];
        assert_eq!(
            pick_page_title(&punctuation, "Baldur's Gate 3").as_deref(),
            Some("Baldurs Gate 3")
        );

        assert_eq!(pick_page_title(&[], "Elden Ring"), None);
        assert_eq!(pick_page_title(&["X".to_string()], "   "), None);
    }
}
