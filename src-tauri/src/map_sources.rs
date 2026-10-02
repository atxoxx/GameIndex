//! Multi-provider game-map lookup.
//!
//! GameIndex surfaces an interactive-map tab that can point at several
//! community map sites. Each provider has a different catalog shape, so
//! we build a names → URL index per provider (cached in memory for a
//! day) and resolve the game by normalized name:
//!
//!   - MapGenie       JSON API catalog (title + alternative search titles)
//!   - GameMaps       gamemaps.net homepage cards (title + `/game/{slug}`)
//!   - GameMappers    gamemappers.com WordPress `post-sitemap.xml`
//!   - Wand           wand.com `/en/maps` link list (`/maps/{slug}`)
//!   - Game-Maps      game-maps.com homepage anchors (best-effort)
//!
//! Matching is deliberately permissive about *presentation* differences
//! (edition suffixes, roman numerals, `&`/`and`, publisher prefixes,
//! subtitles after a dash) but exact about the name itself, so a specific
//! title always resolves to its own game. When a query only names a
//! franchise (`STALKER`), several entries can share the loosened key; the
//! newest sequel wins rather than whichever entry happened to be indexed
//! first, unless a provider has a game titled exactly that base name.
//! Providers resolve concurrently and independently; a game that matches
//! none simply has no Map tab.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use regex::Regex;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

const CACHE_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(25);
const USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
     (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const MAPGENIE_URL: &str = "https://mapgenie.io/api/v1/games";
// The homepage carries both the display title and the `/game/{slug}` link,
// so abbreviated slugs (`cs2`) still match by their real name.
const GAMEMAPS_URL: &str = "https://www.gamemaps.net/";
const GAMEMAPPERS_SITEMAP: &str = "https://gamemappers.com/post-sitemap.xml";
const WAND_MAPS: &str = "https://wand.com/en/maps";
const GAMEMAPSCOM_HOME: &str = "https://game-maps.com/";

/// One selectable map belonging to a provider entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapSourceMap {
    pub title: String,
    pub url: String,
}

/// A provider that has a map for the requested game.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapSourceResult {
    /// Stable provider id (`mapgenie`, `gamemaps`, …).
    pub id: String,
    /// Display label ("MapGenie", "GameMaps", …).
    pub label: String,
    /// The game title as that provider names it.
    pub title: String,
    /// Preferred URL (the first map).
    pub url: String,
    pub maps: Vec<MapSourceMap>,
}

/// One normalized lookup key pointing at a provider page.
#[derive(Debug, Clone)]
struct IndexedGame {
    key: String,
    title: String,
    url: String,
    maps: Vec<MapSourceMap>,
    /// Fully normalized provider title, used to recognize an exact base
    /// match (e.g. a provider entry actually titled "Borderlands").
    norm: String,
    /// Highest number in the title (sequel/year), used to prefer the newest
    /// entry when several games share a loosened franchise key.
    sequel: u32,
    /// Significant tokens of every name this entry was indexed under
    /// (title plus provider alternatives). Used to reject a loosened match
    /// when the query names a specific game the candidate does not cover.
    haystack: String,
}

struct CachedIndex {
    fetched_at: Instant,
    games: Arc<Vec<IndexedGame>>,
}

// ── MapGenie catalog (JSON) ────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
struct CatalogGame {
    title: String,
    slug: String,
    /// IGN-style slug (e.g. "red-dead-redemption-2"); another match surface.
    #[serde(default)]
    ign_slug: Option<String>,
    /// Standalone domain if any (e.g. "rdr2map.com").
    #[serde(default)]
    domain: Option<String>,
    /// Alternative home title if specified.
    #[serde(default)]
    home_title: Option<String>,
    // Present but `null` for some entries, so a plain `#[serde(default)]`
    // Vec is not enough — the whole catalog would fail to parse.
    #[serde(default)]
    search_titles: Option<Vec<String>>,
    #[serde(default)]
    maps: Option<Vec<CatalogMap>>,
}

#[derive(Debug, Clone, Deserialize)]
struct CatalogMap {
    title: String,
    slug: String,
    #[serde(default = "default_true")]
    enabled: bool,
    #[serde(default = "default_true")]
    available: bool,
}

fn default_true() -> bool {
    true
}

// ── Name normalization ─────────────────────────────────────────────────

/// Words that describe an edition/platform/type rather than the game, dropped
/// when building the "significant tokens" key.
const NOISE_WORDS: &[&str] = &[
    "enhanced", "edition", "definitive", "deluxe", "ultimate", "complete",
    "remastered", "remaster", "goty", "game", "year", "special", "gold",
    "directors", "director", "cut", "redux", "vr", "playtest", "demo",
    "prologue", "beta", "test", "server", "digital", "goodies", "classic",
    "uncut", "anniversary", "multiplayer", "single", "player", "of", "the",
    "and", "version", "full", "free", "pts", "early", "access", "remake",
    "hd", "trilogy", "public", "testing", "obsolete", "weekend", "part",
    "pt", "bundle", "collection", "anthology", "expansion", "upgrade",
    "pass", "season", "interactive", "maps", "map", "walkthrough", "guide",
];

/// Publisher / franchise prefixes that can be stripped to find the base game.
const PUBLISHER_PREFIXES: &[&str] = &[
    "tom clancy's ", "tom clancys ",
    "sid meier's ", "sid meiers ",
    "disney's ", "disneys ",
    "marvel's ", "marvels ",
    "warhammer 40,000: ", "warhammer 40000: ", "warhammer 40k: ",
    "warhammer: ",
    "middle-earth: ", "middle earth: ",
    "shin megami tensei: ",
    "ea sports ",
    "clancy's ", "clancys ",
];

fn roman_to_arabic(token: &str) -> Option<&'static str> {
    Some(match token {
        "i" => "1",
        "ii" => "2",
        "iii" => "3",
        "iv" => "4",
        "v" => "5",
        "vi" => "6",
        "vii" => "7",
        "viii" => "8",
        "ix" => "9",
        "x" => "10",
        "xi" => "11",
        "xii" => "12",
        "xiii" => "13",
        "xiv" => "14",
        "xv" => "15",
        "xvi" => "16",
        "xvii" => "17",
        "xviii" => "18",
        "xix" => "19",
        "xx" => "20",
        _ => return None,
    })
}

fn word_to_number(token: &str) -> Option<&'static str> {
    Some(match token {
        "one" => "1",
        "two" => "2",
        "three" => "3",
        "four" => "4",
        "five" => "5",
        "six" => "6",
        "seven" => "7",
        "eight" => "8",
        "nine" => "9",
        "ten" => "10",
        _ => return None,
    })
}

/// Strip possessives (`'s`, `'s`, `'s`) so "Assassin's" matches "Assassins".
fn strip_possessives(input: &str) -> String {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        Regex::new(r"(?i)['\u{2019}\u{2018}]s\b").expect("valid possessive regex")
    });
    re.replace_all(input, "s").into_owned()
}

/// Fold a name down to lowercase letters and digits only.
pub(crate) fn normalize(input: &str) -> String {
    let clean = strip_possessives(input);
    clean
        .to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect()
}

fn push_key(out: &mut Vec<String>, key: &str) {
    if key.chars().count() >= 3 && !out.iter().any(|existing| existing == key) {
        out.push(key.to_string());
    }
}

/// Curated aliases are explicit, so short acronyms (`hl`, `gta`) are allowed
/// even though the general key builder rejects keys under three characters.
fn push_alias(out: &mut Vec<String>, key: &str) {
    if !key.is_empty() && !out.iter().any(|existing| existing == key) {
        out.push(key.to_string());
    }
}

fn strip_parentheses(input: &str) -> String {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"\([^)]*\)").expect("valid paren regex"));
    re.replace_all(input, " ").into_owned()
}

fn before_dash(input: &str) -> String {
    for separator in [" - ", " – ", " — "] {
        if let Some(idx) = input.find(separator) {
            return input[..idx].to_string();
        }
    }
    input.to_string()
}

fn after_dash(input: &str) -> Option<String> {
    for separator in [" - ", " – ", " — "] {
        if let Some(idx) = input.find(separator) {
            let suffix = input[idx + separator.len()..].trim();
            if suffix.chars().count() >= 3 {
                return Some(suffix.to_string());
            }
        }
    }
    None
}

/// Treat ":" the same as " - " (e.g. "The Witcher 3: Wild Hunt" → "The Witcher 3").
fn before_colon(input: &str) -> String {
    if let Some(idx) = input.find(':') {
        let prefix = input[..idx].trim();
        if !prefix.is_empty() {
            return prefix.to_string();
        }
    }
    input.to_string()
}

/// Extract subtitle after ":" (e.g. "The Witcher 3: Wild Hunt" → "Wild Hunt",
/// "The Elder Scrolls V: Skyrim" → "Skyrim").
fn after_colon(input: &str) -> Option<String> {
    if let Some(idx) = input.find(':') {
        let suffix = input[idx + 1..].trim();
        if suffix.chars().count() >= 3 {
            return Some(suffix.to_string());
        }
    }
    None
}

fn strip_publisher_prefix(input: &str) -> String {
    let lower = input.to_lowercase();
    for prefix in PUBLISHER_PREFIXES {
        if lower.starts_with(prefix) {
            return input[prefix.len()..].to_string();
        }
    }
    input.to_string()
}

/// Highest number that appears as a standalone token in a title, with Roman
/// numerals and number words folded to Arabic ("STALKER 2" → 2,
/// "Grand Theft Auto V" → 5). Used only to break ties between entries that
/// share a loosened franchise key.
fn max_number(input: &str) -> u32 {
    input
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|token| !token.is_empty())
        .filter_map(|token| {
            token
                .parse::<u32>()
                .ok()
                .or_else(|| roman_to_arabic(token).and_then(|n| n.parse().ok()))
                .or_else(|| word_to_number(token).and_then(|n| n.parse().ok()))
        })
        .max()
        .unwrap_or(0)
}

/// Drop a trailing sequel number so a bare franchise name still indexes the
/// newest entry: "STALKER 2" → "STALKER", "The Witcher 3" → "The Witcher".
/// Returns `None` when the last token is not a number.
fn strip_trailing_number(input: &str) -> Option<String> {
    let tokens: Vec<&str> = input
        .split(|c: char| !c.is_alphanumeric())
        .filter(|token| !token.is_empty())
        .collect();
    if tokens.len() < 2 {
        return None;
    }
    let last = tokens[tokens.len() - 1].to_lowercase();
    let is_number = last.parse::<u32>().is_ok()
        || roman_to_arabic(&last).is_some()
        || word_to_number(&last).is_some();
    if !is_number {
        return None;
    }
    Some(tokens[..tokens.len() - 1].join(" "))
}

fn significant_tokens(input: &str) -> String {
    input
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|token| !token.is_empty())
        .map(|token| {
            roman_to_arabic(token)
                .or_else(|| word_to_number(token))
                .map(str::to_string)
                .unwrap_or_else(|| token.to_string())
        })
        .filter(|token| !NOISE_WORDS.contains(&token.as_str()))
        .collect::<Vec<_>>()
        .join("")
}

/// The meaningful part of a subtitle after ":" or " - ", reduced to
/// significant tokens. Edition/platform noise ("Enhanced Edition") yields
/// `None`, so it does not constrain matching.
fn distinct_subtitle(input: &str) -> Option<String> {
    let subtitle = after_colon(input).or_else(|| after_dash(input))?;
    let sig = significant_tokens(&strip_parentheses(&subtitle));
    if sig.is_empty() {
        None
    } else {
        Some(sig)
    }
}

/// Known high-profile acronyms and abbreviations for games that providers
/// or user libraries commonly refer to by short names.
fn game_aliases(norm: &str) -> &'static [&'static str] {
    match norm {
        "grandtheftautov" | "grandtheftauto5" => &["gtav", "gta5"],
        "gtav" | "gta5" => &["grandtheftautov", "grandtheftauto5"],
        "reddeadredemption2" => &["rdr2"],
        "rdr2" => &["reddeadredemption2"],
        "cyberpunk2077" => &["cp2077"],
        "cp2077" => &["cyberpunk2077"],
        "baldursgate3" => &["bg3"],
        "bg3" => &["baldursgate3"],
        "counterstrike2" => &["cs2"],
        "cs2" => &["counterstrike2"],
        "counterstrikeglobaloffensive" => &["csgo"],
        "csgo" => &["counterstrikeglobaloffensive"],
        "kingdomcomedeliverance" => &["kcd"],
        "kcd" => &["kingdomcomedeliverance"],
        "kingdomcomedeliverance2" => &["kcd2"],
        "kcd2" => &["kingdomcomedeliverance2"],
        "theelderscrollsvskyrim" | "elderscrollsvskyrim" | "elderscrolls5skyrim" => &[
            "skyrim",
            "tes5",
            "tesv",
        ],
        "skyrim" => &["theelderscrollsvskyrim", "elderscrolls5skyrim"],
        "theelderscrollsonline" | "elderscrollsonline" => &["eso"],
        "eso" => &["theelderscrollsonline"],
        "starwarsjedifallenorder" => &["swjfo", "jedifallenorder", "fallenorder"],
        "swjfo" => &["starwarsjedifallenorder"],
        "dragonageinquisition" => &["dai"],
        "dai" => &["dragonageinquisition"],
        "dragonagetheveilguard" | "dragonageveilguard" => &["dav", "veilguard"],
        "dav" => &["dragonagetheveilguard"],
        "left4dead2" | "leftfordead2" => &["l4d2"],
        "l4d2" => &["left4dead2"],
        "left4dead" | "leftfordead" => &["l4d"],
        "l4d" => &["left4dead"],
        "teamfortress2" => &["tf2"],
        "tf2" => &["teamfortress2"],
        "fallout4" => &["fo4"],
        "fo4" => &["fallout4"],
        "fallout76" => &["fo76"],
        "fo76" => &["fallout76"],
        "hogwartslegacy" => &["hl"],
        "hl" => &["hogwartslegacy"],
        "residentevil4" => &["re4"],
        "re4" => &["residentevil4"],
        _ => &[],
    }
}

/// Decode the handful of HTML entities that appear in provider markup
/// (`&#39;`, `&amp;`, numeric entities, …).
fn decode_entities(input: &str) -> String {
    if !input.contains('&') {
        return input.to_string();
    }
    let mut out = String::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < input.len() {
        if bytes[i] == b'&' {
            if let Some(semi) = input[i..].find(';') {
                let entity = &input[i + 1..i + semi];
                let decoded = match entity {
                    "amp" => Some("&".to_string()),
                    "apos" => Some("'".to_string()),
                    "quot" => Some("\"".to_string()),
                    "lt" => Some("<".to_string()),
                    "gt" => Some(">".to_string()),
                    "nbsp" => Some(" ".to_string()),
                    _ if entity.starts_with("#x") || entity.starts_with("#X") => {
                        u32::from_str_radix(&entity[2..], 16)
                            .ok()
                            .and_then(char::from_u32)
                            .map(|c| c.to_string())
                    }
                    _ if entity.starts_with('#') => entity[1..]
                        .parse::<u32>()
                        .ok()
                        .and_then(char::from_u32)
                        .map(|c| c.to_string()),
                    _ => None,
                };
                if let Some(decoded) = decoded {
                    out.push_str(&decoded);
                    i += semi + 1;
                    continue;
                }
            }
        }
        let ch = input[i..].chars().next().expect("char boundary");
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

/// Every comparable key for a name. The first entry is the most specific
/// (the raw normalized name); later entries loosen presentation noise.
pub(crate) fn variants(name: &str) -> Vec<String> {
    let decoded = decode_entities(name);
    let cleaned: String = decoded
        .chars()
        .filter(|c| !matches!(c, '™' | '®' | '©'))
        .collect();

    let mut out = Vec::new();
    let norm = normalize(&cleaned);
    push_key(&mut out, &norm);
    push_key(&mut out, &normalize(&cleaned.replace('&', " and ")));

    // Cross-reference aliases and acronyms.
    for alias in game_aliases(&norm) {
        push_alias(&mut out, alias);
    }

    let no_paren = strip_parentheses(&cleaned);
    push_key(&mut out, &normalize(&no_paren));

    let no_dash = before_dash(&no_paren);
    push_key(&mut out, &normalize(&no_dash));

    // Subtitle after dash ("Game - Subtitle").
    if let Some(sub_dash) = after_dash(&no_paren) {
        let sub_clean = strip_parentheses(&sub_dash);
        push_key(&mut out, &normalize(&sub_clean));
        push_key(&mut out, &significant_tokens(&sub_clean));
    }

    // Colon-separated subtitle ("The Witcher 3: Wild Hunt" → "The Witcher 3").
    let no_colon = before_colon(&no_paren);
    push_key(&mut out, &normalize(&no_colon));

    // Subtitle after colon ("The Elder Scrolls V: Skyrim" → "Skyrim").
    if let Some(sub_colon) = after_colon(&no_paren) {
        let sub_clean = strip_parentheses(&sub_colon);
        push_key(&mut out, &normalize(&sub_clean));
        push_key(&mut out, &significant_tokens(&sub_clean));
    }

    let no_publisher = strip_publisher_prefix(&no_dash);
    push_key(&mut out, &normalize(&no_publisher));

    // Also strip publisher after colon truncation.
    let no_publisher_colon = strip_publisher_prefix(&no_colon);
    push_key(&mut out, &normalize(&no_publisher_colon));

    for base in [
        no_dash.as_str(),
        no_publisher.as_str(),
        no_colon.as_str(),
        no_publisher_colon.as_str(),
    ] {
        push_key(&mut out, &significant_tokens(base));
    }

    // Bare-franchise fallback: "STALKER 2" also indexes as "stalker" so a
    // base-name query reaches the newest entry, not just the games whose
    // subtitle happens to start with the franchise name.
    for base in [no_dash.as_str(), no_colon.as_str()] {
        if let Some(bare) = strip_trailing_number(base) {
            push_key(&mut out, &normalize(&bare));
            push_key(&mut out, &significant_tokens(&bare));
        }
    }

    out
}

fn single_map(title: &str, url: &str) -> Vec<MapSourceMap> {
    vec![MapSourceMap {
        title: title.to_string(),
        url: url.to_string(),
    }]
}

fn push_variants(
    out: &mut Vec<IndexedGame>,
    seen: &mut HashSet<(String, String)>,
    names: &[String],
    title: &str,
    url: &str,
    maps: &[MapSourceMap],
) {
    let norm = normalize(title);
    let sequel = max_number(title);
    let haystack: String = names.iter().map(|name| significant_tokens(name)).collect();
    for name in names {
        for key in variants(name) {
            // Keep every game that shares a key; `to_result` ranks them.
            if seen.insert((key.clone(), url.to_string())) {
                out.push(IndexedGame {
                    key,
                    title: title.to_string(),
                    url: url.to_string(),
                    maps: maps.to_vec(),
                    norm: norm.clone(),
                    sequel,
                    haystack: haystack.clone(),
                });
            }
        }
    }
}

/// Pick the better of two candidates that matched the same key. A game whose
/// own normalized title equals the matched key wins outright (a provider
/// entry actually titled "Borderlands" beats "Borderlands 4"). Otherwise the
/// highest sequel number wins, so a bare "STALKER" query resolves to the
/// newest entry instead of whichever title happened to be indexed first.
fn is_better_candidate(candidate: &IndexedGame, current: &IndexedGame, matched_key: &str) -> bool {
    let candidate_exact = candidate.norm == matched_key;
    let current_exact = current.norm == matched_key;
    if candidate_exact != current_exact {
        return candidate_exact;
    }
    candidate.sequel > current.sequel
}

fn to_result(
    id: &str,
    label: &str,
    index: &[IndexedGame],
    game_name: &str,
) -> Option<MapSourceResult> {
    let query = variants(game_name);
    let subtitle = distinct_subtitle(game_name);
    for q in &query {
        let mut best: Option<&IndexedGame> = None;
        for game in index.iter().filter(|game| &game.key == q) {
            // A query that names a specific game must not fall back to a
            // different game just because they share a franchise key.
            if let Some(ref subtitle) = subtitle {
                if !game.haystack.contains(subtitle.as_str()) {
                    continue;
                }
            }
            match best {
                None => best = Some(game),
                Some(current) if is_better_candidate(game, current, q) => best = Some(game),
                _ => {}
            }
        }
        if let Some(game) = best {
            return Some(MapSourceResult {
                id: id.to_string(),
                label: label.to_string(),
                title: game.title.clone(),
                url: game.url.clone(),
                maps: game.maps.clone(),
            });
        }
    }
    None
}

// ── Parsers (pure, unit-tested) ────────────────────────────────────────

fn locs(xml: &str) -> Vec<String> {
    let re = Regex::new(r"<loc>\s*([^<]+?)\s*</loc>").expect("valid loc regex");
    re.captures_iter(xml).map(|c| c[1].to_string()).collect()
}

fn parse_mapgenie(body: &str) -> Vec<IndexedGame> {
    let games: Vec<CatalogGame> = serde_json::from_str(body).unwrap_or_default();

    struct Parsed {
        title: String,
        alternatives: Vec<String>,
        url: String,
        maps: Vec<MapSourceMap>,
    }

    let mut parsed = Vec::with_capacity(games.len());
    for game in &games {
        let mut maps: Vec<MapSourceMap> = game
            .maps
            .as_deref()
            .unwrap_or(&[])
            .iter()
            .filter(|m| m.enabled && m.available)
            .map(|m| MapSourceMap {
                title: if m.title.trim().is_empty() {
                    game.title.clone()
                } else {
                    m.title.clone()
                },
                url: format!("https://mapgenie.io/{}/maps/{}", game.slug, m.slug),
            })
            .collect();
        if maps.is_empty() {
            maps = single_map(&game.title, &format!("https://mapgenie.io/{}", game.slug));
        }
        // Build alternatives from search_titles + ign_slug + slug.
        let mut alternatives = game.search_titles.clone().unwrap_or_default();
        if let Some(ref ign) = game.ign_slug {
            // ign_slug is a hyphenated form like "red-dead-redemption-2".
            alternatives.push(ign.replace('-', " "));
        }
        // The slug (e.g. "rdr2") acts as an abbreviation.
        let slug_name = game.slug.replace('-', " ");
        if !alternatives.iter().any(|a| a.eq_ignore_ascii_case(&slug_name)) {
            alternatives.push(slug_name);
        }
        // If custom domain exists (e.g. "rdr2map.com" or "fo76map.com"),
        // index its core name as an abbreviation alternative.
        if let Some(ref domain) = game.domain {
            let clean_domain = domain
                .trim_start_matches("www.")
                .strip_suffix(".com")
                .or_else(|| domain.strip_suffix(".io"))
                .or_else(|| domain.strip_suffix(".net"))
                .unwrap_or(domain);
            let name = clean_domain.strip_suffix("map").unwrap_or(clean_domain);
            if name.chars().count() >= 3 && !alternatives.iter().any(|a| a.eq_ignore_ascii_case(name)) {
                alternatives.push(name.to_string());
            }
        }
        if let Some(ref ht) = game.home_title {
            let ht = ht.trim();
            if !ht.is_empty() && !alternatives.iter().any(|a| a.eq_ignore_ascii_case(ht)) {
                alternatives.push(ht.to_string());
            }
        }
        parsed.push(Parsed {
            title: game.title.clone(),
            alternatives,
            url: maps[0].url.clone(),
            maps,
        });
    }

    let mut out = Vec::new();
    let mut seen = HashSet::new();
    // Canonical titles are indexed first so they win over another game's
    // alternative title that happens to collide.
    for entry in &parsed {
        push_variants(
            &mut out,
            &mut seen,
            &[entry.title.clone()],
            &entry.title,
            &entry.url,
            &entry.maps,
        );
    }
    for entry in &parsed {
        push_variants(
            &mut out,
            &mut seen,
            &entry.alternatives,
            &entry.title,
            &entry.url,
            &entry.maps,
        );
    }
    out
}

/// gamemaps.net homepage cards: `<a href="/game/{slug}">…<img alt="{Title}">`.
fn parse_gamemaps_home(html: &str) -> Vec<IndexedGame> {
    let with_alt =
        Regex::new(r#"href="/game/([a-z0-9_]+)"[\s\S]{0,600}?alt="([^"]+)""#).expect("gamemaps regex");
    let any_slug = Regex::new(r#"href="/game/([a-z0-9_]+)""#).expect("gamemaps slug regex");

    let mut out = Vec::new();
    let mut seen = HashSet::new();
    let mut covered = HashSet::new();

    for cap in with_alt.captures_iter(html) {
        let slug = cap[1].to_string();
        let title = decode_entities(&cap[2]);
        let display = if title.trim().is_empty() {
            slug.replace('_', " ")
        } else {
            title
        };
        let url = format!("https://www.gamemaps.net/game/{slug}");
        let maps = single_map(&display, &url);
        push_variants(
            &mut out,
            &mut seen,
            &[display.clone(), slug.replace('_', " ")],
            &display,
            &url,
            &maps,
        );
        covered.insert(slug);
    }

    // Cards without a nearby `alt` still contribute their slug.
    for cap in any_slug.captures_iter(html) {
        let slug = cap[1].to_string();
        if !covered.insert(slug.clone()) {
            continue;
        }
        let display = slug.replace('_', " ");
        let url = format!("https://www.gamemaps.net/game/{slug}");
        let maps = single_map(&display, &url);
        push_variants(
            &mut out,
            &mut seen,
            std::slice::from_ref(&display),
            &display,
            &url,
            &maps,
        );
    }

    out
}

fn strip_map_suffix(slug: &str) -> Option<&str> {
    let slug = slug.trim_matches('/');
    for suffix in ["-interactive-maps", "-interactive-map", "-maps", "-map"] {
        if let Some(rest) = slug.strip_suffix(suffix) {
            if !rest.is_empty() {
                return Some(rest);
            }
        }
    }
    None
}

/// Returns `true` for GameMappers sitemap URLs that are guide/article
/// posts rather than actual interactive map pages. These have patterns
/// like `all-*-locations-in-*`, `where-to-find-*`, `how-to-*`.
fn is_gamemappers_guide_post(segment: &str) -> bool {
    let s = segment.to_lowercase();
    s == "latest"
        || s == "latest-maps"
        || s == "all-maps"
        || s == "contact"
        || s == "about"
        || s == "privacy"
        || s.starts_with("all-")
        || s.starts_with("where-to-")
        || s.starts_with("how-to-")
        || s.contains("-locations-in-")
        || s.contains("-guide")
}

fn parse_gamemappers_sitemap(xml: &str) -> Vec<IndexedGame> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for loc in locs(xml) {
        let Some(segment) = loc.trim_end_matches('/').rsplit('/').next() else {
            continue;
        };
        // Skip guide / article posts that aren't interactive map pages.
        if is_gamemappers_guide_post(segment) {
            continue;
        }
        let Some(game_slug) = strip_map_suffix(segment) else {
            continue;
        };
        let title = game_slug.replace('-', " ");
        let maps = single_map(&title, &loc);
        let mut titles = vec![title.clone()];
        for edition in [
            "-scholarship-edition",
            "-complete-edition",
            "-definitive-edition",
            "-enhanced-edition",
        ] {
            if let Some(base) = game_slug.strip_suffix(edition) {
                titles.push(base.replace('-', " "));
            }
        }
        push_variants(&mut out, &mut seen, &titles, &title, &loc, &maps);
    }
    out
}

fn parse_wand_maps(html: &str) -> Vec<IndexedGame> {
    let card_re = Regex::new(r#"<a\b[^>]*href="/maps/([a-z0-9-]+)"[^>]*>([\s\S]*?)</a>"#)
        .expect("valid wand card regex");
    let title_re = Regex::new(r#"<h4\b[^>]*>([^<]+)</h4>"#).expect("valid wand title regex");
    let mut out = Vec::new();
    let mut seen = HashSet::new();

    for cap in card_re.captures_iter(html) {
        let slug = &cap[1];
        let card_body = &cap[2];
        let display_title = title_re
            .captures(card_body)
            .map(|c| decode_entities(c[1].trim()))
            .filter(|t| !t.is_empty())
            .unwrap_or_else(|| slug.replace('-', " "));

        let url = format!("https://wand.com/maps/{slug}");
        let maps = single_map(&display_title, &url);
        let slug_name = slug.replace('-', " ");
        push_variants(
            &mut out,
            &mut seen,
            &[display_title.clone(), slug_name],
            &display_title,
            &url,
            &maps,
        );
    }
    out
}

/// Parse the individual maps from a Wand game page. Wand lists each sub-map
/// as `/maps/{game}/{map}` (optionally locale-prefixed), so a game with
/// several maps gets a picker in the UI.
fn parse_wand_submaps(html: &str, base_url: &str) -> Vec<MapSourceMap> {
    let link_re = Regex::new(
        r#"<a\b[^>]*href="(?:/[a-z]{2})?/maps/[a-z0-9-]+/([a-z0-9-]+)"[^>]*>([\s\S]*?)</a>"#,
    )
    .expect("valid wand submap regex");
    let tag_re = Regex::new(r"<[^>]+>").expect("valid tag regex");

    let base = base_url.trim_end_matches('/');
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for cap in link_re.captures_iter(html) {
        let slug = &cap[1];
        if !seen.insert(slug.to_string()) {
            continue;
        }
        let text = tag_re.replace_all(&cap[2], " ");
        let title = decode_entities(&text.split_whitespace().collect::<Vec<_>>().join(" "));
        let title = if title.trim().is_empty() {
            slug.replace('-', " ")
        } else {
            title
        };
        out.push(MapSourceMap {
            title,
            url: format!("{base}/{slug}"),
        });
    }
    out
}

/// Derive a game title from an anchor's visible text or title attribute.
fn gamemapscom_clean_title(text: &str) -> Option<String> {
    let text = text.trim();
    if text.is_empty() || text.len() > 100 {
        return None;
    }

    if let Some(rest) = text.strip_prefix("All ") {
        let rest = rest.trim();
        let name = rest
            .strip_suffix(" Maps")
            .or_else(|| rest.strip_suffix(" Map"))
            .map(str::trim);
        if let Some(name) = name {
            if !name.is_empty() && !name.eq_ignore_ascii_case("game") {
                return Some(name.to_string());
            }
        }
    }

    // Strip common suffixes used in game-maps.com headings and cards
    let suffixes = [
        " - Maps & Walkthrough",
        " - Maps and Walkthrough",
        " - Full Walkthrough & Maps",
        " - Walkthrough, Guide & Maps",
        " - Maps and Guide",
        " - Maps & Guide",
        " - Maps & Game Guide",
        " - Revealed Maps & Walkthrough",
        " - Revealed Maps",
        " - Maps with Walkthrough",
        " - Game Guide & Maps",
        " - Walkthrough",
        " - Guide",
        " - Maps",
        " - Map",
        " Revealed Maps 2026",
        " Revealed Maps",
        " World Map",
        " Castle Map",
        " Maps",
        " Map",
    ];

    for suffix in suffixes {
        if let Some(prefix) = text.strip_suffix(suffix) {
            let candidate = prefix.trim();
            if candidate.len() >= 2
                && !matches!(
                    candidate.to_lowercase().as_str(),
                    "all"
                        | "world"
                        | "castle"
                        | "delve"
                        | "public dungeon"
                        | "quest"
                        | "npc"
                        | "video"
                        | "game"
                        | "latest"
                        | "toss a coin"
                )
            {
                return Some(candidate.to_string());
            }
        }
    }

    for separator in [" - ", " – ", " — "] {
        if let Some((name, _)) = text.split_once(separator) {
            let name = name.trim();
            if !name.is_empty() && name.len() <= 80 && !name.eq_ignore_ascii_case("all") {
                return Some(name.to_string());
            }
        }
    }

    None
}

fn parse_gamemapscom_home(html: &str) -> Vec<IndexedGame> {
    let anchor_re = Regex::new(
        r#"<a\b([^>]*)href="(https://game-maps\.com)?/([A-Za-z0-9_-]+/[A-Za-z0-9_-]+\.asp)"[^>]*>([\s\S]*?)</a>"#,
    )
    .expect("valid anchor regex");
    let title_attr_re = Regex::new(r#"title="([^"]+)""#).expect("valid title attr regex");
    let tag_re = Regex::new(r"<[^>]+>").expect("valid tag regex");

    let mut out = Vec::new();
    let mut seen = HashSet::new();

    for cap in anchor_re.captures_iter(html) {
        let attrs = &cap[1];
        let path = &cap[3];
        let url = format!("https://game-maps.com/{path}");
        let inner_text = tag_re.replace_all(&cap[4], " ");
        let inner_text = decode_entities(&inner_text.split_whitespace().collect::<Vec<_>>().join(" "));

        // Try extracting from anchor's title attribute first (e.g. title="Dragon Age: The Veilguard Maps")
        let title_from_attr = title_attr_re
            .captures(attrs)
            .and_then(|c| gamemapscom_clean_title(&decode_entities(&c[1])));

        let title = title_from_attr.or_else(|| gamemapscom_clean_title(&inner_text));

        let Some(title) = title else {
            continue;
        };

        if title.eq_ignore_ascii_case("donate") || title.eq_ignore_ascii_case("contact") {
            continue;
        }

        let maps = single_map(&title, &url);
        push_variants(&mut out, &mut seen, std::slice::from_ref(&title), &title, &url, &maps);
    }

    // Also scan game card blocks for images with alt attributes:
    let img_re = Regex::new(
        r#"<img\b[^>]*alt="([^"]+)"[^>]*>[\s\S]{0,400}?<a\b[^>]*href="(https://game-maps\.com)?/([A-Za-z0-9_-]+/[A-Za-z0-9_-]+\.asp)""#,
    )
    .expect("valid img-anchor regex");

    for cap in img_re.captures_iter(html) {
        let alt = decode_entities(&cap[1]);
        let path = &cap[3];
        let url = format!("https://game-maps.com/{path}");

        if let Some(title) = gamemapscom_clean_title(&alt) {
            if !title.eq_ignore_ascii_case("donate") && !title.eq_ignore_ascii_case("contact") {
                let maps = single_map(&title, &url);
                push_variants(&mut out, &mut seen, std::slice::from_ref(&title), &title, &url, &maps);
            }
        }
    }

    out
}

// ── Caching ────────────────────────────────────────────────────────────

async fn cached_index(
    cache: &'static OnceLock<Mutex<Option<CachedIndex>>>,
    client: &reqwest::Client,
    url: &str,
    referer: &str,
    parse: fn(&str) -> Vec<IndexedGame>,
) -> Result<Arc<Vec<IndexedGame>>, String> {
    let cell = cache.get_or_init(|| Mutex::new(None));

    {
        let guard = cell.lock().await;
        if let Some(entry) = guard.as_ref() {
            if entry.fetched_at.elapsed() < CACHE_TTL {
                return Ok(entry.games.clone());
            }
        }
    }

    let response = client
        .get(url)
        .header("Accept", "application/json, text/html;q=0.9, */*;q=0.8")
        .header("Referer", referer)
        .send()
        .await
        .map_err(|e| format!("{url} request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("{url} returned HTTP {}", response.status()));
    }

    let body = response
        .text()
        .await
        .map_err(|e| format!("{url} read failed: {e}"))?;

    let games = Arc::new(parse(&body));
    if games.is_empty() {
        // Don't cache a shape change — retry on the next request.
        return Err(format!("{url} produced no game entries"));
    }

    *cell.lock().await = Some(CachedIndex {
        fetched_at: Instant::now(),
        games: games.clone(),
    });
    Ok(games)
}

/// Read a provider's already-built index without touching the network. The
/// map tab only renders after `fetch_game_maps` warmed these caches, so the
/// autocomplete stays instant and never blocks on a provider that is down.
async fn cached_snapshot(
    cache: &'static OnceLock<Mutex<Option<CachedIndex>>>,
) -> Option<Arc<Vec<IndexedGame>>> {
    let cell = cache.get_or_init(|| Mutex::new(None));
    let guard = cell.lock().await;
    guard
        .as_ref()
        .filter(|entry| entry.fetched_at.elapsed() < CACHE_TTL)
        .map(|entry| entry.games.clone())
}

// ── Providers ──────────────────────────────────────────────────────────

static MAPGENIE_CACHE: OnceLock<Mutex<Option<CachedIndex>>> = OnceLock::new();
static GAMEMAPS_CACHE: OnceLock<Mutex<Option<CachedIndex>>> = OnceLock::new();
static GAMEMAPPERS_CACHE: OnceLock<Mutex<Option<CachedIndex>>> = OnceLock::new();
static WAND_CACHE: OnceLock<Mutex<Option<CachedIndex>>> = OnceLock::new();
static GAMEMAPSCOM_CACHE: OnceLock<Mutex<Option<CachedIndex>>> = OnceLock::new();
/// Per-game Wand sub-map lists (`/maps/{game}/{map}`), cached for a day.
static WAND_SUBMAP_CACHE: OnceLock<Mutex<HashMap<String, (Instant, Arc<Vec<MapSourceMap>>)>>> =
    OnceLock::new();

async fn resolve_mapgenie(
    client: &reqwest::Client,
    game_name: &str,
) -> Result<Option<MapSourceResult>, String> {
    let index = cached_index(
        &MAPGENIE_CACHE,
        client,
        MAPGENIE_URL,
        "https://mapgenie.io/",
        parse_mapgenie,
    )
    .await?;
    Ok(to_result("mapgenie", "MapGenie", &index, game_name))
}

async fn resolve_gamemaps(
    client: &reqwest::Client,
    game_name: &str,
) -> Result<Option<MapSourceResult>, String> {
    let index = cached_index(
        &GAMEMAPS_CACHE,
        client,
        GAMEMAPS_URL,
        "https://www.gamemaps.net/",
        parse_gamemaps_home,
    )
    .await?;
    Ok(to_result("gamemaps", "GameMaps", &index, game_name))
}

async fn resolve_gamemappers(
    client: &reqwest::Client,
    game_name: &str,
) -> Result<Option<MapSourceResult>, String> {
    let index = cached_index(
        &GAMEMAPPERS_CACHE,
        client,
        GAMEMAPPERS_SITEMAP,
        "https://gamemappers.com/",
        parse_gamemappers_sitemap,
    )
    .await?;
    Ok(to_result("gamemappers", "GameMappers", &index, game_name))
}

/// Fetch (and cache) the sub-map list for a Wand game page. Failure is
/// non-fatal: the caller keeps the single game-level map.
async fn cached_wand_submaps(
    client: &reqwest::Client,
    game_url: &str,
) -> Arc<Vec<MapSourceMap>> {
    let cache = WAND_SUBMAP_CACHE.get_or_init(|| Mutex::new(HashMap::new()));

    {
        let guard = cache.lock().await;
        if let Some((fetched_at, maps)) = guard.get(game_url) {
            if fetched_at.elapsed() < CACHE_TTL {
                return maps.clone();
            }
        }
    }

    let maps = match client
        .get(game_url)
        .header("Referer", "https://wand.com/")
        .send()
        .await
    {
        Ok(response) if response.status().is_success() => match response.text().await {
            Ok(html) => parse_wand_submaps(&html, game_url),
            Err(_) => Vec::new(),
        },
        _ => Vec::new(),
    };

    let maps = Arc::new(maps);
    if !maps.is_empty() {
        cache
            .lock()
            .await
            .insert(game_url.to_string(), (Instant::now(), maps.clone()));
    }
    maps
}

async fn resolve_wand(
    client: &reqwest::Client,
    game_name: &str,
) -> Result<Option<MapSourceResult>, String> {
    let index = cached_index(
        &WAND_CACHE,
        client,
        WAND_MAPS,
        "https://wand.com/",
        parse_wand_maps,
    )
    .await?;

    let Some(mut result) = to_result("wand", "Wand", &index, game_name) else {
        return Ok(None);
    };

    // A Wand game page lists its individual maps as `/maps/{game}/{map}`.
    // When more than one exists, surface them so the UI offers a picker and
    // opens the first map directly.
    let submaps = cached_wand_submaps(client, &result.url).await;
    if submaps.len() > 1 {
        result.url = submaps[0].url.clone();
        result.maps = submaps.as_ref().clone();
    }

    Ok(Some(result))
}

async fn resolve_gamemapscom(
    client: &reqwest::Client,
    game_name: &str,
) -> Result<Option<MapSourceResult>, String> {
    let index = cached_index(
        &GAMEMAPSCOM_CACHE,
        client,
        GAMEMAPSCOM_HOME,
        "https://game-maps.com/",
        parse_gamemapscom_home,
    )
    .await?;
    Ok(to_result("gamemapscom", "Game-Maps", &index, game_name))
}

/// Resolve every known map provider for a game. Providers run
/// concurrently; a provider that fails (offline, shape change) is logged
/// and skipped so the rest still resolve. An empty result means no
/// provider has a map and the caller renders no Map tab.
#[tauri::command]
pub async fn fetch_game_maps(game_name: String) -> Result<Vec<MapSourceResult>, String> {
    if normalize(&game_name).is_empty() {
        return Ok(Vec::new());
    }

    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|e| format!("map client build failed: {e}"))?;

    let (mapgenie, gamemaps, gamemappers, wand, gamemapscom) = tokio::join!(
        resolve_mapgenie(&client, &game_name),
        resolve_gamemaps(&client, &game_name),
        resolve_gamemappers(&client, &game_name),
        resolve_wand(&client, &game_name),
        resolve_gamemapscom(&client, &game_name),
    );

    let mut results = Vec::new();
    for (name, outcome) in [
        ("mapgenie", mapgenie),
        ("gamemaps", gamemaps),
        ("gamemappers", gamemappers),
        ("wand", wand),
        ("gamemapscom", gamemapscom),
    ] {
        match outcome {
            Ok(Some(source)) => results.push(source),
            Ok(None) => {}
            Err(err) => eprintln!("[map_sources] {name}: {err}"),
        }
    }

    Ok(results)
}

/// Rank distinct catalog titles for the lookup autocomplete: prefix matches
/// first, then shorter titles, deduped across providers. Pure so it can be
/// unit-tested without the network.
fn suggestion_matches<'a, I>(indexes: I, query: &str, limit: usize) -> Vec<String>
where
    I: IntoIterator<Item = &'a [IndexedGame]>,
{
    let needle = normalize(query);
    if needle.chars().count() < 2 {
        return Vec::new();
    }

    let mut seen = HashSet::new();
    let mut ranked: Vec<(u8, usize, String)> = Vec::new();
    for index in indexes {
        for game in index {
            if !game.norm.contains(&needle) {
                continue;
            }
            if !seen.insert(game.title.clone()) {
                continue;
            }
            let priority = if game.norm.starts_with(&needle) { 0 } else { 1 };
            ranked.push((priority, game.norm.len(), game.title.clone()));
        }
    }

    ranked.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)).then(a.2.cmp(&b.2)));
    ranked
        .into_iter()
        .take(limit)
        .map(|(_, _, title)| title)
        .collect()
}

/// Autocomplete for the map lookup, drawn from the provider catalogs the
/// initial resolve already built and cached in memory.
#[tauri::command]
pub async fn search_map_games(
    query: String,
    limit: Option<usize>,
) -> Result<Vec<String>, String> {
    let limit = limit.unwrap_or(8).clamp(1, 25);

    let (mapgenie, gamemaps, gamemappers, wand, gamemapscom) = tokio::join!(
        cached_snapshot(&MAPGENIE_CACHE),
        cached_snapshot(&GAMEMAPS_CACHE),
        cached_snapshot(&GAMEMAPPERS_CACHE),
        cached_snapshot(&WAND_CACHE),
        cached_snapshot(&GAMEMAPSCOM_CACHE),
    );

    let mut indexes: Vec<&[IndexedGame]> = Vec::new();
    for snapshot in [&mapgenie, &gamemaps, &gamemappers, &wand, &gamemapscom] {
        if let Some(index) = snapshot {
            indexes.push(index.as_slice());
        }
    }

    Ok(suggestion_matches(indexes, &query, limit))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn find(index: &[IndexedGame], name: &str) -> Option<String> {
        to_result("test", "Test", index, name).map(|r| r.url)
    }

    #[test]
    fn normalize_ignores_case_punctuation_and_spacing() {
        assert_eq!(normalize("The Witcher 3: Wild Hunt™"), "thewitcher3wildhunt");
        assert_eq!(normalize("the-witcher-3"), "thewitcher3");
        assert_eq!(normalize("grand_theft_auto_v"), "grandtheftautov");
        assert_eq!(normalize("  "), "");
    }

    #[test]
    fn variants_handle_editions_romans_ampersands_and_prefixes() {
        // Edition suffix + dash.
        assert!(variants("S.T.A.L.K.E.R.: Clear Sky - Enhanced Edition")
            .contains(&"stalkerclearsky".to_string()));
        // Roman numeral.
        assert!(variants("Grand Theft Auto V").contains(&"grandtheftauto5".to_string()));
        // `&` vs `and`.
        assert!(variants("Dark Messiah of Might & Magic")
            .contains(&"darkmessiahmightmagic".to_string()));
        // Publisher prefix.
        assert!(variants("Tom Clancy's Rainbow Six Siege")
            .contains(&"rainbowsixsiege".to_string()));
        // Parenthetical.
        assert!(variants("Beneath a Steel Sky (1994)").contains(&"beneathasteelsky".to_string()));
    }

    #[test]
    fn mapgenie_matches_title_and_alternative_and_tolerates_nulls() {
        let json = r#"[
            {"title":"Elden Ring","slug":"elden-ring","search_titles":null,"maps":[
                {"title":"The Lands Between","slug":"the-lands-between","enabled":true,"available":true},
                {"title":"WIP","slug":"wip","enabled":true,"available":false}
            ]},
            {"title":"The Witcher 3","slug":"witcher-3","search_titles":["wild hunt"],"maps":null}
        ]"#;

        let index = parse_mapgenie(json);

        let elden = to_result("mapgenie", "MapGenie", &index, "ELDEN RING")
            .expect("canonical title should match");
        assert_eq!(elden.url, "https://mapgenie.io/elden-ring/maps/the-lands-between");
        assert_eq!(elden.maps.len(), 1, "unavailable map is filtered out");

        let witcher = to_result("mapgenie", "MapGenie", &index, "The Witcher 3: Wild Hunt")
            .expect("should match via search title");
        assert_eq!(witcher.url, "https://mapgenie.io/witcher-3");

        assert!(to_result("mapgenie", "MapGenie", &index, "Nope").is_none());
    }

    #[test]
    fn gamemaps_home_uses_card_titles_for_abbreviated_slugs() {
        let html = r#"
            <a href="/game/cs2" class="game-card-link"><img alt="Counter Strike 2" src="x"><h3>Counter Strike 2</h3></a>
            <a href="/game/grand_theft_auto_v" class="game-card-link"><img alt="GTA V &#8211; Grand Theft Auto V" src="y"></a>
        "#;
        let index = parse_gamemaps_home(html);
        assert_eq!(
            find(&index, "Counter-Strike 2").as_deref(),
            Some("https://www.gamemaps.net/game/cs2")
        );
        assert!(find(&index, "Grand Theft Auto V").is_some());
        assert!(find(&index, "Halo").is_none());
    }

    #[test]
    fn gamemappers_sitemap_strips_map_suffix() {
        let xml = r#"<urlset>
            <url><loc>https://gamemappers.com/red-dead-redemption-2-interactive-map/</loc></url>
            <url><loc>https://gamemappers.com/elden-ring-map/</loc></url>
            <url><loc>https://gamemappers.com/latest-maps/</loc></url>
            <url><loc>https://gamemappers.com/all-locations-schedule-1-guide/</loc></url>
        </urlset>"#;
        let index = parse_gamemappers_sitemap(xml);
        assert!(find(&index, "Elden Ring").is_some());
        assert!(find(&index, "Red Dead Redemption 2").is_some());
        assert!(find(&index, "Schedule 1").is_none(), "guide posts are excluded");
    }

    #[test]
    fn wand_maps_reads_game_links_only() {
        let html = r#"<a href="/maps/elden-ring">x</a>
            <link href="/maps/_next/static/chunks/a.css">
            <a href="/maps/grand-theft-auto-v">y</a>"#;
        let index = parse_wand_maps(html);
        assert_eq!(
            find(&index, "Elden Ring").as_deref(),
            Some("https://wand.com/maps/elden-ring")
        );
        assert!(find(&index, "Grand Theft Auto V").is_some());
    }

    #[test]
    fn gamemapscom_home_reads_card_titles() {
        let html = r#"
            <a href="https://game-maps.com/HL/Hogwarts-Legacy.asp">Hogwarts Legacy - Maps, Walkthrough &amp; Guide</a>
            <a href="https://game-maps.com/Fallout4/Fallout-4-Walkthrough.asp">All Fallout 4 Maps</a>
            <a href="https://game-maps.com/x/Some-Random-Guide.asp">How to beat the first boss</a>
        "#;
        let index = parse_gamemapscom_home(html);
        assert!(find(&index, "Hogwarts Legacy").is_some());
        assert!(find(&index, "Fallout 4").is_some());
        assert!(find(&index, "Some Random Game").is_none(), "non-game anchors ignored");
    }

    // ── New tests for improved matching ───────────────────────────────

    #[test]
    fn possessive_stripping_matches_apostrophe_variants() {
        // ASCII apostrophe.
        assert_eq!(normalize("Assassin's Creed"), normalize("Assassins Creed"));
        // Unicode right single quote.
        assert_eq!(normalize("Assassin\u{2019}s Creed"), normalize("Assassins Creed"));
        // Already no apostrophe.
        assert_eq!(normalize("Assassins Creed"), "assassinscreed");
    }

    #[test]
    fn colon_before_subtitle_produces_truncated_variant() {
        let keys = variants("The Witcher 3: Wild Hunt");
        assert!(
            keys.contains(&"thewitcher3".to_string()),
            "colon truncation should produce 'thewitcher3', got: {keys:?}"
        );
    }

    #[test]
    fn mapgenie_indexes_ign_slug_and_slug() {
        let json = r#"[
            {"title":"Red Dead Redemption 2","slug":"rdr2","ign_slug":"red-dead-redemption-2",
             "search_titles":["rdr2"],"maps":[
                {"title":"RDR2","slug":"rdr2","enabled":true,"available":true}
            ]}
        ]"#;

        let index = parse_mapgenie(json);

        assert!(
            to_result("mapgenie", "MapGenie", &index, "Red Dead Redemption 2").is_some(),
            "should match via ign_slug"
        );
        assert!(
            to_result("mapgenie", "MapGenie", &index, "rdr2").is_some(),
            "should match via slug"
        );
    }

    #[test]
    fn gamemappers_filters_guide_posts() {
        let xml = r#"<urlset>
            <url><loc>https://gamemappers.com/the-witcher-3-wild-hunt-interactive-maps/</loc></url>
            <url><loc>https://gamemappers.com/all-chest-locations-in-hogwarts-legacy/</loc></url>
            <url><loc>https://gamemappers.com/where-to-find-all-fast-travel-points-in-cyberpunk-2077/</loc></url>
            <url><loc>https://gamemappers.com/how-to-get-tints-in-clair-obscur-expedition-33/</loc></url>
        </urlset>"#;

        let index = parse_gamemappers_sitemap(xml);
        assert!(find(&index, "the witcher 3 wild hunt").is_some());
        assert!(find(&index, "Hogwarts Legacy").is_none(), "guide post excluded");
        assert!(find(&index, "Cyberpunk 2077").is_none(), "guide post excluded");
    }

    #[test]
    fn gamemappers_handles_maps_plural_suffix() {
        let xml = r#"<urlset>
            <url><loc>https://gamemappers.com/conan-exiles-interactive-maps/</loc></url>
            <url><loc>https://gamemappers.com/death-stranding-interactive-maps/</loc></url>
        </urlset>"#;
        let index = parse_gamemappers_sitemap(xml);
        assert!(find(&index, "Conan Exiles").is_some());
        assert!(find(&index, "Death Stranding").is_some());
    }

    #[test]
    fn publisher_prefixes_cover_disney_and_marvel() {
        assert!(variants("Disney's Dreamlight Valley")
            .contains(&"dreamlightvalley".to_string()));
        assert!(variants("Marvel's Spider-Man 2")
            .contains(&"spiderman2".to_string()));
    }

    #[test]
    fn aliases_match_acronyms_both_ways() {
        assert!(variants("Grand Theft Auto V").contains(&"gtav".to_string()));
        assert!(variants("Grand Theft Auto 5").contains(&"gta5".to_string()));
        assert!(variants("Cyberpunk 2077").contains(&"cp2077".to_string()));
        assert!(variants("Baldur's Gate 3").contains(&"bg3".to_string()));
        assert!(variants("Kingdom Come: Deliverance 2").contains(&"kcd2".to_string()));
        assert!(variants("The Elder Scrolls V: Skyrim").contains(&"skyrim".to_string()));
        assert!(variants("The Elder Scrolls Online").contains(&"eso".to_string()));
        assert!(variants("Counter-Strike 2").contains(&"cs2".to_string()));
        assert!(variants("Left 4 Dead 2").contains(&"l4d2".to_string()));
        assert!(variants("Fallout 76").contains(&"fo76".to_string()));
        assert!(variants("Hogwarts Legacy").contains(&"hl".to_string()));

        // And in reverse: abbreviation query expands to game name.
        assert!(variants("rdr2").contains(&"reddeadredemption2".to_string()));
        assert!(variants("bg3").contains(&"baldursgate3".to_string()));
        assert!(variants("cs2").contains(&"counterstrike2".to_string()));
    }

    #[test]
    fn subtitles_after_colon_and_dash_produce_variants() {
        // Subtitle after colon: "The Elder Scrolls V: Skyrim" -> "Skyrim"
        let skyrim_variants = variants("The Elder Scrolls V: Skyrim");
        assert!(
            skyrim_variants.contains(&"skyrim".to_string()),
            "expected 'skyrim' variant in: {skyrim_variants:?}"
        );

        // Subtitle after colon: "Total War: WARHAMMER III" -> "WARHAMMER III" -> "warhammer3"
        let tw_variants = variants("Total War: WARHAMMER III");
        assert!(
            tw_variants.contains(&"warhammer3".to_string()),
            "expected 'warhammer3' variant in: {tw_variants:?}"
        );

        // Subtitle after dash: "S.T.A.L.K.E.R. 2 - Heart of Chornobyl" -> "Heart of Chornobyl" -> "heartofchornobyl"
        let stalker_variants = variants("S.T.A.L.K.E.R. 2 - Heart of Chornobyl");
        assert!(
            stalker_variants.contains(&"heartofchornobyl".to_string()),
            "expected 'heartofchornobyl' variant in: {stalker_variants:?}"
        );
    }

    #[test]
    fn word_numbers_match_arabic_numbers() {
        let one = variants("Schedule One");
        assert!(one.contains(&"schedule1".to_string()));

        let four = variants("Left Four Dead 2");
        assert!(four.contains(&"left4dead2".to_string()));
    }

    #[test]
    fn expanded_roman_numerals_up_to_xx() {
        let ff16 = variants("Final Fantasy XVI");
        assert!(ff16.contains(&"finalfantasy16".to_string()));

        let ff14 = variants("Final Fantasy XIV");
        assert!(ff14.contains(&"finalfantasy14".to_string()));
    }

    #[test]
    fn gamemapscom_parses_card_titles_and_alts() {
        let html = r#"
            <div class="mp26-gbox">
                <picture class="mp26-gbox-pic">
                    <img src="/img/dav.jpg" alt="Dragon Age: The Veilguard - Maps &amp; Walkthrough">
                </picture>
                <p class="mp26-gbox-links">
                    <a href="https://game-maps.com/Veilguard/Dragon-Age-Veilguard.asp" title="Dragon Age: The Veilguard Maps">All Maps</a>
                    <a href="https://game-maps.com/Veilguard/Veilguard-World-Map.asp" title="Dragon Age: The Veilguard World Map of Thedas">World Map</a>
                </p>
            </div>
            <div class="mp26-gbox-s">
                <a href="/BG3/BG3-Map.asp">Baldur's Gate 3 - Map</a>
            </div>
        "#;
        let index = parse_gamemapscom_home(html);
        assert!(
            find(&index, "Dragon Age: The Veilguard").is_some(),
            "should match via title attribute or alt text"
        );
        assert!(
            find(&index, "Baldur's Gate 3").is_some(),
            "should match via anchor text"
        );
    }

    #[test]
    fn wand_maps_parses_h4_headings() {
        let html = r#"
            <a href="/maps/stalker-2-heart-of-chornobyl">
                <div class="card">
                    <h4>STALKER 2: Heart of Chornobyl</h4>
                </div>
            </a>
            <a href="/maps/runescape-dragonwilds">
                <div>
                    <h4>RuneScape: Dragonwilds</h4>
                </div>
            </a>
        "#;
        let index = parse_wand_maps(html);
        let stalker = to_result("wand", "Wand", &index, "S.T.A.L.K.E.R. 2: Heart of Chornobyl")
            .expect("should match proper display title");
        assert_eq!(stalker.title, "STALKER 2: Heart of Chornobyl");
        assert_eq!(stalker.url, "https://wand.com/maps/stalker-2-heart-of-chornobyl");

        assert!(find(&index, "RuneScape: Dragonwilds").is_some());
        assert!(find(&index, "runescape").is_some());
    }

    #[test]
    fn mapgenie_indexes_domain_and_home_title() {
        let json = r#"[
            {
                "title": "Fallout 76",
                "slug": "fo76",
                "domain": "fo76map.com",
                "home_title": "Fallout 76 Interactive Map",
                "maps": [
                    {"title": "Appalachia", "slug": "appalachia", "enabled": true, "available": true}
                ]
            }
        ]"#;
        let index = parse_mapgenie(json);

        assert!(find(&index, "Fallout 76").is_some(), "matches canonical title");
        assert!(find(&index, "fo76").is_some(), "matches domain abbreviation");
    }

    #[test]
    fn trailing_numbers_strip_to_a_base_franchise_key() {
        assert_eq!(strip_trailing_number("STALKER 2").as_deref(), Some("STALKER"));
        assert_eq!(
            strip_trailing_number("The Witcher 3").as_deref(),
            Some("The Witcher")
        );
        assert_eq!(
            strip_trailing_number("S.T.A.L.K.E.R. 2").as_deref(),
            Some("S T A L K E R")
        );
        // Not a sequel number — nothing to strip.
        assert_eq!(strip_trailing_number("Elden Ring"), None);
        assert_eq!(strip_trailing_number("Borderlands"), None);
    }

    #[test]
    fn max_number_folds_romans_and_words() {
        assert_eq!(max_number("STALKER 2: Heart of Chornobyl"), 2);
        assert_eq!(max_number("Grand Theft Auto V"), 5);
        assert_eq!(max_number("Left Four Dead 2"), 4);
        assert_eq!(max_number("Elden Ring"), 0);
    }

    #[test]
    fn wand_bare_franchise_query_prefers_newest_sequel() {
        let html = r#"
            <a href="/maps/stalker-2-heart-of-chornobyl">
                <div><h4>STALKER 2: Heart of Chornobyl</h4></div>
            </a>
            <a href="/maps/stalker-call-of-pripyat">
                <div><h4>S.T.A.L.K.E.R.: Call of Pripyat</h4></div>
            </a>
            <a href="/maps/stalker-clear-sky-enhanced-edition">
                <div><h4>S.T.A.L.K.E.R.: Clear Sky - Enhanced Edition</h4></div>
            </a>
        "#;
        let index = parse_wand_maps(html);

        let bare = to_result("wand", "Wand", &index, "S.T.A.L.K.E.R.")
            .expect("a base franchise query should still resolve");
        assert_eq!(bare.url, "https://wand.com/maps/stalker-2-heart-of-chornobyl");
    }

    #[test]
    fn wand_specific_titles_still_resolve_to_their_own_game() {
        let html = r#"
            <a href="/maps/stalker-2-heart-of-chornobyl">
                <div><h4>STALKER 2: Heart of Chornobyl</h4></div>
            </a>
            <a href="/maps/stalker-call-of-pripyat">
                <div><h4>S.T.A.L.K.E.R.: Call of Pripyat</h4></div>
            </a>
        "#;
        let index = parse_wand_maps(html);

        let cop = to_result("wand", "Wand", &index, "S.T.A.L.K.E.R.: Call of Pripyat")
            .expect("exact title matches its own game");
        assert_eq!(cop.url, "https://wand.com/maps/stalker-call-of-pripyat");

        let sequel = to_result("wand", "Wand", &index, "STALKER 2: Heart of Chornobyl")
            .expect("exact title matches its own game");
        assert_eq!(sequel.url, "https://wand.com/maps/stalker-2-heart-of-chornobyl");
    }

    #[test]
    fn exact_base_title_beats_a_newer_sequel() {
        let html = r#"
            <a href="/maps/borderlands-4">
                <div><h4>Borderlands 4</h4></div>
            </a>
            <a href="/maps/borderlands">
                <div><h4>Borderlands</h4></div>
            </a>
        "#;
        let index = parse_wand_maps(html);

        assert_eq!(
            find(&index, "Borderlands").as_deref(),
            Some("https://wand.com/maps/borderlands"),
            "the exact base title should win over a newer sequel"
        );
    }

    #[test]
    fn suggestions_match_across_providers_and_rank_prefixes() {
        let wand = parse_wand_maps(
            r#"
            <a href="/maps/stalker-2-heart-of-chornobyl"><div><h4>STALKER 2: Heart of Chornobyl</h4></div></a>
            <a href="/maps/stalker-call-of-pripyat"><div><h4>S.T.A.L.K.E.R.: Call of Pripyat</h4></div></a>
            <a href="/maps/elden-ring"><div><h4>Elden Ring</h4></div></a>
            "#,
        );
        let other = parse_wand_maps(
            r#"
            <a href="/maps/stalker-shadow-of-chernobyl"><div><h4>S.T.A.L.K.E.R.: Shadow of Chernobyl</h4></div></a>
            <a href="/maps/heart-of-chornobyl"><div><h4>Heart of Chornobyl</h4></div></a>
            "#,
        );

        let out = suggestion_matches([wand.as_slice(), other.as_slice()], "stalk", 10);
        assert!(out.iter().any(|t| t.contains("STALKER 2")));
        assert!(out.iter().any(|t| t.contains("Call of Pripyat")));
        assert!(
            out.iter().any(|t| t.contains("Shadow of Chernobyl")),
            "every provider contributes suggestions"
        );
        assert!(!out.iter().any(|t| t.contains("Elden Ring")));

        let merged = suggestion_matches([wand.as_slice(), wand.as_slice()], "stalk", 10);
        let mut unique = merged.clone();
        unique.sort();
        unique.dedup();
        assert_eq!(merged.len(), unique.len(), "duplicate titles are removed");

        // Suggestions need at least two characters.
        assert!(suggestion_matches([wand.as_slice()], "s", 10).is_empty());
        assert!(!suggestion_matches([wand.as_slice()], "el", 10).is_empty());
    }

    #[test]
    fn specific_subtitle_does_not_fall_back_to_a_different_game() {
        // MapGenie only ships STALKER 2 and indexes the bare "stalker" alias,
        // so a Call of Pripyat query must not resolve to it.
        let json = r#"[
            {"title":"S.T.A.L.K.E.R. 2: Heart of Chornobyl","slug":"stalker-2-heart-of-chornobyl",
             "search_titles":["stalker 2","stalker"],"maps":[
                {"title":"The Zone","slug":"the-zone","enabled":true,"available":true}
             ]}
        ]"#;
        let index = parse_mapgenie(json);

        assert!(
            to_result("mapgenie", "MapGenie", &index, "S.T.A.L.K.E.R.: Call of Pripyat").is_none(),
            "a specific title must not match a different game through a franchise alias"
        );

        let bare = to_result("mapgenie", "MapGenie", &index, "STALKER")
            .expect("a bare franchise query still resolves");
        assert_eq!(
            bare.url,
            "https://mapgenie.io/stalker-2-heart-of-chornobyl/maps/the-zone"
        );
    }

    #[test]
    fn wand_submaps_parse_game_page_links() {
        let html = r#"
            <a href="/maps/stalker-call-of-pripyat/pripyat">Pripyat</a>
            <a href="/fr/maps/stalker-call-of-pripyat/jupiter">Jupiter</a>
            <a href="/maps/stalker-call-of-pripyat/pripyat">Pripyat</a>
            <a href="/maps/stalker-call-of-pripyat">All maps</a>
        "#;
        let maps = parse_wand_submaps(html, "https://wand.com/maps/stalker-call-of-pripyat");

        assert_eq!(maps.len(), 2, "duplicate and non-map links are dropped");
        assert_eq!(maps[0].title, "Pripyat");
        assert_eq!(
            maps[0].url,
            "https://wand.com/maps/stalker-call-of-pripyat/pripyat"
        );
        assert_eq!(
            maps[1].url,
            "https://wand.com/maps/stalker-call-of-pripyat/jupiter"
        );
    }
}

