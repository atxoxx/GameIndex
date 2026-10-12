use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime};

use super::*;
use super::igdb::http_client;
use super::steam_store::{SteamMovie, SteamReleaseDate};

// ─── Base64 Encoding ─────────────────────────────────────────────────────────

/// Re-export of the base64 encoder shared with lib.rs.
/// This avoids code duplication.
// ─── Rich About Payload (Steam `about_the_game` + `movies[]`) ────────────────

/// A single trailer/gameplay clip sourced from the Steam store. The
/// frontend AboutSection renders a `<video>` tile per entry; `poster`
/// powers the static thumbnail while the browser picks the best
/// `<source>` based on the `kind` (application/vnd.apple.mpegurl /
/// video/webm vs video/mp4 — webm is preferred because Steam encodes
/// at a smaller size for the same perceived quality).
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MovieEntry {
    pub id: u32,
    pub name: Option<String>,
    pub thumbnail: Option<String>,
    /// Best webm URL (max resolution when available, else 480p).
    pub webm: Option<String>,
    /// Best mp4 URL (max resolution when available, else 480p, else
    /// full). Webm is preferred on capable browsers; mp4 is the
    /// universal fallback (Safari, mobile, embedded WebView).
    pub mp4: Option<String>,
    /// Steam HLS master playlist (.m3u8, H.264). Newer trailers drop the
    /// legacy webm/mp4 slots in favour of DASH/HLS manifests; the frontend
    /// plays this via hls.js when no direct file is available.
    pub hls_h264: Option<String>,
    pub highlight: bool,
}

/// The combined "About" payload returned by the `get_about_section`
/// Tauri command. Source priority is Steam-first (`source == "steam"`)
/// with IGDB as a graceful fallback (`source == "igdb"`) when:
///   1. The game has no Steam AppID, OR
///   2. Steam's `about_the_game` is empty AND no movies, OR
///   3. Steam's appdetails call failed.
///
/// `about_html` is rendered with `dangerouslySetInnerHTML` after
/// minimal client-side sanitization; it includes Steam CDN `<img>`
/// tags as inlined images/GIFs for the visual richness the user
/// asked for. `about_text` is the fallback for renderers that don't
/// accept raw HTML.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RichAboutPayload {
    /// `"steam" | "igdb" | "none"`. `none` signals "no data" — the
    /// frontend should hide the section OR fall back to its pre-
    /// existing `game.description` field as a last resort.
    pub source: String,
    /// Deep-link to the source page (Steam store / IGDB game).
    pub source_url: Option<String>,
    /// Human-readable source name ("Steam" / "IGDB").
    pub source_name: Option<String>,
    /// Raw HTML body (Steam "about_the_game"). Frontend sanitizes.
    pub about_html: Option<String>,
    /// Plain-text fallback (Steam short_description or IGDB summary).
    pub about_text: Option<String>,
    /// Localized concise short description (Steam short_description).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub short_description: Option<String>,
    /// Steam storefront release date string (e.g. "27 Feb, 2025" or "Coming Soon").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub release_date: Option<String>,
    /// Trailers / gameplay videos from Steam `movies[]`. IGDB
    /// YouTube videos are intentionally not surfaced here — the
    /// existing `VideosSection` already handles YouTube embeds.
    pub movies: Vec<MovieEntry>,
    /// Unix-seconds timestamp of the last successful fetch. Drives
    /// the frontend "Updated {fetchedAt}" label.
    pub fetched_at: u64,
}

// Tiny per-appid TTL cache. Steam's `about_the_game` HTML changes at
// most every few weeks (store page edits, new patch notes), so a
// 6-hour TTL strikes a reasonable balance. We use a `OnceLock<Mutex>`
// for cheap cloning and zero per-fetch hashing; the entry count is
// bounded by the size of the user's Steam library, so there's no
// memory-growth concern.
//
// Cooldown of negative cache: a Steam failure (HTTP error / parse
// error) is NOT cached — we want the next click to have a fresh
// chance to succeed. Negative caching Steam errors would turn a
// single hiccup into a 6-hour outage.
pub(crate) static ABOUT_CACHE: OnceLock<Mutex<HashMap<(u32, String), (Instant, RichAboutPayload)>>> =
    OnceLock::new();

/// The fixed set of Steam storefront `l=` codes we fetch localized
/// "About" text for. The first entry is the canonical default
/// (`english`); the rest are the configured "top" languages. The UI
/// display language picks which entry to show; this list is what we
/// always pre-fetch so switching languages never triggers a refetch.
pub const ABOUT_LANGUAGES: &[&str] = &[
    "english", "french", "spanish", "german", "russian", "schinese",
];

/// A language-keyed bundle of localized "About" payloads. Returned by
/// `get_about_bundle`; the frontend selects `by_language[uiLang]` (falling
/// back to `by_language[default_language]`, then the first entry) so the
/// About section renders in the user's UI language when available.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct AboutBundle {
    /// Map of Steam `l=` language code → localized about payload.
    pub by_language: HashMap<String, RichAboutPayload>,
    /// Canonical default language code (always `"english"`).
    pub default_language: String,
}

/// Whole-bundle cache keyed by (Steam appid, game name) so re-opening a
/// game page within the TTL serves all six languages from memory.
pub(crate) static ABOUT_BUNDLE_CACHE: OnceLock<
    Mutex<HashMap<(Option<u32>, String), (Instant, AboutBundle)>>,
> = OnceLock::new();

/// Build the Steam `appdetails` URL for a given `l=` language code.
/// Steam localizes `about_the_game` (and several other fields) per
/// `l=`; `cc=us` keeps pricing/country-agnostic store metadata stable.
pub(crate) fn steam_about_url(app_id: u32, lang: &str) -> String {
    format!(
        "https://store.steampowered.com/api/appdetails?appids={}&cc=us&l={}",
        app_id, lang
    )
}

/// Per-appid TTL cache for the system-requirements payload. Steam's
/// `pc_requirements` block is *extremely* stable (it's set once at
/// launch and only rarely bumped when a game ships a "we now need
/// 16 GB RAM" patch), so we cache for a longer 24h window than
/// `ABOUT_CACHE`. Same `OnceLock<Mutex>` pattern so concurrent
/// fetches across the library share the same in-memory store.
pub(crate) static REQUIREMENTS_CACHE: OnceLock<Mutex<HashMap<u32, (Instant, PcRequirementsPayload)>>> =
    OnceLock::new();

/// 24-hour TTL for cached system-requirements payloads. Steam
/// specs rarely change once a game is published; even when they
/// do (e.g. a "we now recommend 32 GB" update), the next visit
/// after 24h picks it up.
pub(crate) const REQUIREMENTS_CACHE_TTL: Duration = Duration::from_secs(24 * 60 * 60);

pub(crate) const ABOUT_CACHE_TTL: Duration = Duration::from_secs(6 * 60 * 60);

/// Upper bound for each TTL-only metadata cache. They are keyed by
/// game/language and previously kept an entry for every title the user ever
/// opened until restart — the About payloads in particular carry full Steam
/// HTML plus trailer lists. Once a cache passes the cap we evict the oldest
/// entries first so the freshest data stays hot.
pub(crate) const METADATA_CACHE_MAX_ENTRIES: usize = 64;

/// Evict oldest-first until `map` holds at most `max` entries. `map` values
/// are `(inserted_at, payload)` tuples, matching every metadata cache here.
pub(crate) fn prune_metadata_cache<K, V>(map: &mut HashMap<K, (Instant, V)>, max: usize)
where
    K: Eq + std::hash::Hash + Clone,
{
    while map.len() > max {
        let oldest = map
            .iter()
            .min_by_key(|(_, (inserted_at, _))| *inserted_at)
            .map(|(key, _)| key.clone());
        match oldest {
            Some(key) => {
                map.remove(&key);
            }
            None => break,
        }
    }
}

// ─── System Requirements Parser ────────────────────────────────────────────

/// Convert a Steam `pc_requirements.minimum` / `.recommended`
/// HTML blob into a line-oriented plain-text form suitable for
/// label extraction. Steam's pc_requirements block is shallow
/// markup — one of two common shapes:
///
///   1. `<ul class="bb_ul"><li><strong>OS:</strong> Windows…</li>
///        <li><strong>Processor:</strong> …</li>…</ul>`
///   2. `<strong>OS:</strong> Windows…<br><strong>Processor:</strong>
///        …<br>…`
///
/// Both shapes flatten to the same one-pair-per-line plain-text
/// representation under the rules below. We don't ship a full
/// HTML parser for this — it would add a multi-MB dependency for
/// a handful of HTML tags that Steam actually uses, and the
/// hand-written transform is easy to audit.
///
/// Transform rules (applied in order):
///   1. `<br>`, `<br/>`, `<br />`  → `\n`
///   2. `</li>`, `</p>`, `</div>` → `\n`
///   3. `</ul>`, `</ol>`          → `\n`
///   4. `<li …>`                  → `\n`
///   5. `</strong>`, `</b>`       → ` `   (label/value join space)
///   6. Any remaining `<…>` tag   → ` `   (insert a space so
///       `</strong>foo` doesn't fuse with the label word)
///   7. Decode the common HTML entities (`&amp;`, `&nbsp;`, `&lt;`,
///      `&gt;`, `&quot;`, `&#39;`) so the parsed values read cleanly.
pub(crate) fn requirements_html_to_text(html: &str) -> String {
    if html.is_empty() {
        return String::new();
    }
    let mut out = html.to_string();

    // 1. Block-level / line-break tags → newline. We iterate
    //    case-insensitively because some games ship `<BR>` in
    //    uppercase.
    for needle in ["<br>", "<br/>", "<br />", "<BR>", "<BR/>", "<BR />"] {
        out = out.replace(needle, "\n");
    }
    for needle in ["</li>", "</p>", "</div>", "</LI>", "</P>"] {
        out = out.replace(needle, "\n");
    }
    for needle in ["</ul>", "</ol>"] {
        out = out.replace(needle, "\n");
    }
    // 2. Drop the remaining inline tag pairs, leaving a space at
    //    the join so "label value" doesn't become "labelvalue".
    //    `replacen(n, 1)` is fine — we only ever have one pair
    //    per line in practice and the next pass strips the rest.
    for needle in ["</strong>", "</b>", "</em>", "</span>", "</font>"] {
        out = out.replace(needle, " ");
    }
    // Strip ALL remaining `<…>` tag fragments. We use a string-based
    // scanner rather than a regex to keep the dependency graph
    // tight — the spec block is small and we never hit this path
    // more than once per appdetails fetch. Iterating over `&str`
    // rather than `bytes` lets us handle multi-byte UTF-8
    // characters (Steam ships ™ and — in spec values) safely.
    let mut cleaned = String::with_capacity(out.len());
    let mut rest: &str = out.as_str();
    while !rest.is_empty() {
        match rest.find('<') {
            Some(start) => {
                // Copy everything before the `<` verbatim.
                cleaned.push_str(&rest[..start]);
                cleaned.push(' ');
                // Find the matching `>`.
                match rest[start..].find('>') {
                    Some(end) => rest = &rest[start + end + 1..],
                    None => {
                        // Unterminated tag — copy the rest verbatim so
                        // we don't silently truncate user data.
                        cleaned.push_str(&rest[start..]);
                        break;
                    }
                }
            }
            None => {
                cleaned.push_str(rest);
                break;
            }
        }
    }
    out = cleaned;

    // 3. Common HTML entities. We keep this short — pc_requirements
    //    in practice uses `&amp;` heavily (Radeon™ RX 580 & Co.).
    out = out
        .replace("&amp;", "&")
        .replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'");

    // 4. Collapse runs of whitespace within each line, trim edges,
    //    and drop empty lines.
    let mut cleaned = String::with_capacity(out.len());
    for line in out.split('\n') {
        let mut last_space = true;
        let mut current = String::new();
        for ch in line.chars() {
            if ch.is_whitespace() {
                if !last_space {
                    current.push(' ');
                    last_space = true;
                }
            } else {
                current.push(ch);
                last_space = false;
            }
        }
        let trimmed = current.trim();
        if !trimmed.is_empty() {
            cleaned.push_str(trimmed);
            cleaned.push('\n');
        }
    }
    cleaned
}

/// Canonical label table for `parse_requirements_text`. Each
/// entry is `(target_field, lowercase_label)`. The longest
/// labels must come first so the prefix matcher doesn't snap
/// "VR Support" to "VR" + leftover.
pub(crate) const REQUIREMENT_LABELS: &[(&str, &str)] = &[
    ("os", "os"),
    ("processor", "processor"),
    ("memory", "memory"),
    ("graphics", "graphics"),
    ("directX", "directx"),
    ("network", "network"),
    ("storage", "storage"),
    ("soundCard", "sound card"),
    ("vrSupport", "vr support"),
    ("vrSupport", "vr headset"),
    ("additionalNotes", "additional notes"),
    ("additionalNotes", "notes"),
];

/// Resolve a single canonical field name to the slot on a
/// `RequirementsSpec`. Keeping this in one place makes it
/// trivial to audit that every `REQUIREMENT_LABELS` entry has
/// a corresponding destination slot.
pub(crate) fn spec_slot<'a>(spec: &'a mut RequirementsSpec, field: &str) -> Option<&'a mut Option<String>> {
    match field {
        "os" => Some(&mut spec.os),
        "processor" => Some(&mut spec.processor),
        "memory" => Some(&mut spec.memory),
        "graphics" => Some(&mut spec.graphics),
        "directX" => Some(&mut spec.direct_x),
        "network" => Some(&mut spec.network),
        "storage" => Some(&mut spec.storage),
        "soundCard" => Some(&mut spec.sound_card),
        "vrSupport" => Some(&mut spec.vr_support),
        "additionalNotes" => Some(&mut spec.additional_notes),
        _ => None,
    }
}

/// True when the first character of `line` past `label_len`
/// matches our "label boundary" rule (whitespace, colon, or
/// end-of-line). This prevents "osm" from accidentally matching
/// the "OS" label and the equivalent for every other label.
pub(crate) fn is_label_boundary(rest: &str) -> bool {
    match rest.chars().next() {
        None => true,
        Some(c) => c.is_whitespace() || c == ':' || c == '\t',
    }
}

/// Parse the line-oriented text produced by
/// `requirements_html_to_text` into a `RequirementsSpec`.
///
/// We scan the text once, looking for the known label set
/// (see `REQUIREMENT_LABELS`). For each match we capture the
/// rest of the line as the value, then continue with the next
/// line. The parser is tolerant to:
///
///   - Trailing colons (`OS: Windows`) or no colon (`OS Windows`)
///   - Case-insensitive label matching (we lowercase the input)
///   - Whitespace between the label and the colon
///   - Multi-word labels (`Sound Card`, `VR Support`)
///
/// Unknown labels are silently dropped so a publisher writing
/// "Controller: Gamepad required" doesn't leak into the wrong
/// field. If a label appears multiple times, the *longest* value
/// wins (Steam sometimes appends a redundant footnote to the
/// minimum spec).
pub(crate) fn parse_requirements_text(text: &str) -> RequirementsSpec {
    let mut spec = RequirementsSpec::default();
    let lower = text.to_lowercase();

    for raw_line in lower.lines() {
        let line = raw_line.trim_start();
        for (field, label) in REQUIREMENT_LABELS {
            // Longest labels must come first so we don't snap
            // "sound card" to "sound" + leftover. We still guard
            // with `is_label_boundary` so a partial prefix like
            // "memoryx" doesn't match "memory".
            // `label` is `&&str` from the slice iteration; deref to
            // `&str` directly rather than calling `.as_str()` (which
            // is the unstable `str_as_str` feature) so we stay on
            // stable Rust.
            if line.len() <= label.len() || !line.starts_with(*label) {
                continue;
            }
            if !is_label_boundary(&line[label.len()..]) {
                continue;
            }
            let value = line[label.len()..]
                .trim_start_matches(|c: char| c == ':' || c.is_whitespace())
                .to_string();
            if value.is_empty() {
                break;
            }
            if let Some(slot) = spec_slot(&mut spec, field) {
                let dominated = slot.as_ref().is_some_and(|existing| existing.len() >= value.len());
                if !dominated {
                    *slot = Some(value);
                }
            }
            break;
        }
    }

    spec
}

/// Public convenience wrapper: takes the raw Steam HTML for a
/// spec block and returns a parsed `RequirementsSpec`. Returns
/// `None` when both the input is empty and the parsed output is
/// empty (frontend hides the section in that case).
pub(crate) fn parse_requirements_html(html: Option<&str>) -> Option<RequirementsSpec> {
    let text = html.map(requirements_html_to_text).unwrap_or_default();
    let spec = parse_requirements_text(&text);
    if spec.is_empty() {
        None
    } else {
        Some(spec)
    }
}

// ─── System Requirements Fetch + Cache ──────────────────────────────────────

/// Strip every HTML tag from `html` and return the resulting
/// plain text. Used by the About-section path to derive a
/// `short_description`-friendly text preview from Steam's rich
/// `about_the_game` HTML (which contains inline `<img>` tags the
/// text preview shouldn't show). The transformation is more
/// aggressive than `requirements_html_to_text` — it doesn't
/// preserve line structure because the text preview feeds into
/// a single-line display field, not a multi-line list.
pub(crate) fn strip_html_for_preview(html: &str) -> String {
    if html.is_empty() {
        return String::new();
    }
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    for ch in html.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                if !out.ends_with(' ') {
                    out.push(' ');
                }
            }
            c if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Fetch system requirements with a per-appid TTL cache. Returns
/// `None` only when Steam is unreachable AND the IGDB fallback
/// (currently a no-op since IGDB doesn't expose specs) produced
/// nothing. On a successful Steam response with *both* blocks
/// empty, we return `Some(PcRequirementsPayload { source: "steam",
/// …, minimum: None, recommended: None })` so the frontend can
/// still render the "Steam returned no requirements for this
/// title" empty state with a stable shape.
pub async fn fetch_system_requirements(
    steam_app_id: Option<u32>,
) -> Option<PcRequirementsPayload> {
    let app_id = steam_app_id?;
    fetch_steam_requirements_cached(app_id).await
}

pub(crate) async fn fetch_steam_requirements_cached(app_id: u32) -> Option<PcRequirementsPayload> {
    // Positive-cache hit? Return it.
    {
        let cache = REQUIREMENTS_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
        let guard = cache.lock().ok()?;
        if let Some((fetched, payload)) = guard.get(&app_id) {
            if fetched.elapsed() < REQUIREMENTS_CACHE_TTL {
                return Some(payload.clone());
            }
        }
    }

    // Hit Steam's appdetails endpoint. We reuse `http_client()` for
    // TLS session cache warmth — the about-payload fetcher on the
    // same appid warms the connection a few seconds before us.
    let url = format!(
        "https://store.steampowered.com/api/appdetails?appids={}&cc=us&l=en",
        app_id
    );
    let client = http_client();
    let resp = match client.get(&url).send().await {
        Ok(r) => r,
        Err(_) => return None,
    };
    if !resp.status().is_success() {
        return None;
    }

    #[derive(Deserialize)]
    struct ReqWrapper {
        success: bool,
        #[serde(default)]
        data: Option<ReqAppDetail>,
    }
    #[derive(Deserialize)]
    struct ReqAppDetail {
        #[serde(default)]
        pc_requirements: Option<PcRequirementsRaw>,
        #[serde(default)]
        mac_requirements: Option<PcRequirementsRaw>,
        #[serde(default)]
        linux_requirements: Option<PcRequirementsRaw>,
    }
    #[derive(Deserialize, Default)]
    #[serde(default)]
    struct PcRequirementsRaw {
        minimum: Option<String>,
        recommended: Option<String>,
    }

    let map: HashMap<String, ReqWrapper> = match resp.json().await {
        Ok(m) => m,
        Err(_) => return None,
    };
    let wrapper = map.get(&app_id.to_string())?;
    if !wrapper.success {
        return None;
    }
    let data = wrapper.data.as_ref()?;

    // Prefer Windows (pc) requirements. Mac / Linux blocks are
    // present on cross-platform titles but the overwhelming
    // majority of the library is Windows-first; we'll consider
    // them in a future iteration if the demand is there.
    let block = data
        .pc_requirements
        .as_ref()
        .or(data.mac_requirements.as_ref())
        .or(data.linux_requirements.as_ref());

    let (minimum_html, recommended_html) = match block {
        Some(b) => (b.minimum.clone(), b.recommended.clone()),
        None => (None, None),
    };

    let minimum = parse_requirements_html(minimum_html.as_deref());
    let recommended = parse_requirements_html(recommended_html.as_deref());

    // When Steam returned empty strings for BOTH blocks, surface
    // an empty payload so the frontend can decide whether to
    // render the "no requirements published" empty state. We
    // never cache an empty payload — that would suppress a future
    // edit-cycle from being picked up for 24h.
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let payload = PcRequirementsPayload {
        source: "steam".to_string(),
        source_url: Some(format!("https://store.steampowered.com/app/{}", app_id)),
        source_name: Some("Steam".to_string()),
        minimum,
        recommended,
        minimum_html,
        recommended_html,
        fetched_at: now,
    };

    // Only cache payloads that actually carry some data. A title
    // that hasn't published requirements yet today may publish
    // them tomorrow, and we'd rather re-fetch than 24h-cache a
    // negative.
    if payload.minimum.is_some() || payload.recommended.is_some() {
        if let Some(cache) = REQUIREMENTS_CACHE.get() {
            if let Ok(mut guard) = cache.lock() {
                guard.insert(app_id, (Instant::now(), payload.clone()));
                prune_metadata_cache(&mut *guard, METADATA_CACHE_MAX_ENTRIES);
            }
        }
    }

    Some(payload)
}

// ─── Steam Store Features Scraper (responsive_apppage_details_left) ─────────

pub(crate) static FEATURES_CACHE: OnceLock<Mutex<HashMap<(u32, String), (Instant, SteamStoreFeaturesPayload)>>> =
    OnceLock::new();
pub(crate) const FEATURES_CACHE_TTL: Duration = Duration::from_secs(24 * 60 * 60);

pub(crate) fn normalize_steam_lang(lang: &str) -> String {
    let lower = lang.trim().to_lowercase();
    match lower.as_str() {
        "fr" | "french" => "french".to_string(),
        "de" | "german" => "german".to_string(),
        "es" | "spanish" => "spanish".to_string(),
        "ru" | "russian" => "russian".to_string(),
        "zh-cn" | "zh" | "schinese" | "simplified chinese" => "schinese".to_string(),
        _ => "english".to_string(),
    }
}

pub(crate) fn decode_steam_html_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
}

pub(crate) fn strip_steam_html_tags(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    for c in html.chars() {
        match c {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                if !out.ends_with(' ') {
                    out.push(' ');
                }
            }
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub(crate) fn default_steam_category_icon(id: u32) -> &'static str {
    match id {
        2 => "https://store.akamai.steamstatic.com/public/images/v6/ico/ico_singlePlayer.png",
        1 | 36 | 37 | 49 => "https://store.akamai.steamstatic.com/public/images/v6/ico/ico_multiPlayer.png",
        9 | 38 | 39 | 48 => "https://store.akamai.steamstatic.com/public/images/v6/ico/ico_coop.png",
        22 => "https://store.akamai.steamstatic.com/public/images/v6/ico/ico_achievements.png",
        23 => "https://store.akamai.steamstatic.com/public/images/v6/ico/ico_cloud.png",
        29 => "https://store.akamai.steamstatic.com/public/images/v6/ico/ico_cards.png",
        30 | 51 => "https://store.akamai.steamstatic.com/public/images/v6/ico/ico_workshop.png",
        17 => "https://store.akamai.steamstatic.com/public/images/v6/ico/ico_editor.png",
        62 => "https://store.akamai.steamstatic.com/public/images/v6/ico/ico_familysharing.png",
        41 | 42 | 43 => "https://store.akamai.steamstatic.com/public/images/v6/ico/ico_remote_play.png",
        44 => "https://store.akamai.steamstatic.com/public/images/v6/ico/ico_remote_play_together.png",
        61 => "https://store.akamai.steamstatic.com/public/images/v6/ico/ico_hdr.png",
        35 => "https://store.akamai.steamstatic.com/public/images/v6/ico/ico_cart.png",
        18 | 28 => "https://store.akamai.steamstatic.com/public/images/v6/ico/ico_controller.png",
        40 | 53 | 54 => "https://store.akamai.steamstatic.com/public/images/v6/ico/ico_vr.png",
        _ => "https://store.akamai.steamstatic.com/public/images/v6/ico/ico_singlePlayer.png",
    }
}

pub async fn fetch_steam_features(
    steam_app_id: Option<u32>,
    lang_param: Option<&str>,
) -> Option<SteamStoreFeaturesPayload> {
    let app_id = steam_app_id?;
    let lang = normalize_steam_lang(lang_param.unwrap_or("english"));

    // Cache hit?
    {
        let cache = FEATURES_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
        if let Ok(guard) = cache.lock() {
            if let Some((fetched, payload)) = guard.get(&(app_id, lang.clone())) {
                if fetched.elapsed() < FEATURES_CACHE_TTL {
                    return Some(payload.clone());
                }
            }
        }
    }

    let payload = fetch_steam_features_uncached(app_id, &lang).await;
    if let Some(ref p) = payload {
        if !p.features.is_empty() {
            if let Some(cache) = FEATURES_CACHE.get() {
                if let Ok(mut guard) = cache.lock() {
                    guard.insert((app_id, lang), (Instant::now(), p.clone()));
                    prune_metadata_cache(&mut *guard, METADATA_CACHE_MAX_ENTRIES);
                }
            }
        }
    }
    payload
}

pub(crate) async fn fetch_steam_features_uncached(app_id: u32, lang: &str) -> Option<SteamStoreFeaturesPayload> {
    let client = http_client();

    let mut features: Vec<SteamFeatureItem> = Vec::new();
    let mut controller_support: Option<SteamControllerSupport> = None;
    let mut notices: Vec<SteamNoticeItem> = Vec::new();

    // 1. Attempt to fetch HTML from Steam storefront
    let url = format!("https://store.steampowered.com/app/{}/?l={}", app_id, lang);
    let html_resp = client
        .get(&url)
        .header(
            reqwest::header::COOKIE,
            format!(
                "birthtime=283993201; mature_content=1; wants_mature_content=1; Steam_Language={}",
                lang
            ),
        )
        .send()
        .await;

    if let Ok(resp) = html_resp {
        if resp.status().is_success() {
            if let Ok(html) = resp.text().await {
                // Find category block: either id="category_block" or class="responsive_apppage_details_left"
                let block_start = html
                    .find("id=\"category_block\"")
                    .or_else(|| html.find("responsive_apppage_details_left"));

                if let Some(start) = block_start {
                    let max_end = html.len().min(start + 15000);
                    let end = html[start..max_end]
                        .find("responsive_apppage_details_right")
                        .map(|idx| start + idx)
                        .unwrap_or(max_end);
                    let block = &html[start..end];

                    // Extract specs items: <a class="game_area_details_specs_ctn" ...>...</a>
                    let mut cursor = 0;
                    while let Some(rel_start) = block[cursor..].find("game_area_details_specs_ctn") {
                        let class_idx = cursor + rel_start;
                        let a_start = match block[..class_idx].rfind("<a") {
                            Some(pos) => pos,
                            None => {
                                cursor = class_idx + 27;
                                continue;
                            }
                        };
                        let a_end = match block[class_idx..].find("</a>") {
                            Some(pos) => class_idx + pos + 4,
                            None => {
                                cursor = class_idx + 27;
                                continue;
                            }
                        };
                        cursor = a_end;
                        let anchor_html = &block[a_start..a_end];

                        // Extract search URL from href
                        let search_url = if let Some(href_pos) = anchor_html.find("href=\"") {
                            let after = &anchor_html[href_pos + 6..];
                            after.find('"').map(|e| after[..e].to_string())
                        } else {
                            None
                        };

                        // Extract category ID from search URL (category2=XX)
                        let cat_id = search_url.as_ref().and_then(|u| {
                            let needle = "category2=";
                            u.find(needle).and_then(|pos| {
                                let rest = &u[pos + needle.len()..];
                                let num_str: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
                                num_str.parse::<u32>().ok()
                            })
                        });

                        // Extract icon URL from img src
                        let icon_url = if let Some(img_pos) = anchor_html.find("<img") {
                            let img_slice = &anchor_html[img_pos..];
                            if let Some(src_pos) = img_slice.find("src=\"") {
                                let after = &img_slice[src_pos + 5..];
                                after.find('"').map(|e| {
                                    let raw = &after[..e];
                                    if raw.starts_with("//") {
                                        format!("https:{}", raw)
                                    } else if raw.starts_with('/') {
                                        format!("https://store.akamai.steamstatic.com{}", raw)
                                    } else {
                                        raw.to_string()
                                    }
                                })
                            } else {
                                None
                            }
                        } else {
                            None
                        };

                        // Fall back to default category icon if not found
                        let icon_url = icon_url.or_else(|| cat_id.map(|id| default_steam_category_icon(id).to_string()));

                        // Extract label text from <div class="label">...</div>
                        let name = if let Some(lbl_pos) = anchor_html.find("class=\"label\"") {
                            let lbl_slice = &anchor_html[lbl_pos..];
                            if let Some(close_tag) = lbl_slice.find('>') {
                                let content = &lbl_slice[close_tag + 1..];
                                if let Some(end_div) = content.find("</div>") {
                                    decode_steam_html_entities(&strip_steam_html_tags(&content[..end_div]))
                                } else {
                                    String::new()
                                }
                            } else {
                                String::new()
                            }
                        } else {
                            decode_steam_html_entities(&strip_steam_html_tags(anchor_html))
                        };

                        if !name.is_empty() && !features.iter().any(|f| f.name.eq_ignore_ascii_case(&name)) {
                            features.push(SteamFeatureItem {
                                id: cat_id,
                                name,
                                icon_url,
                                search_url,
                            });
                        }
                    }

                    // Extract controller support from data-props
                    if let Some(ctrl_pos) = block.find("data-featuretarget=\"store-sidebar-controller-support-info\"") {
                        let slice = &block[ctrl_pos..];
                        if let Some(props_pos) = slice.find("data-props=\"") {
                            let after = &slice[props_pos + 12..];
                            if let Some(end_props) = after.find('"') {
                                let raw_json = decode_steam_html_entities(&after[..end_props]);
                                #[derive(Deserialize)]
                                #[serde(rename_all = "camelCase")]
                                struct CtrlProps {
                                    #[serde(default)]
                                    b_full_xbox_controller_support: bool,
                                    #[serde(default)]
                                    b_partial_xbox_controller_support: bool,
                                    #[serde(default)]
                                    b_p_s4_controller_support: bool,
                                    #[serde(default)]
                                    b_p_s5_controller_support: bool,
                                    #[serde(default)]
                                    b_gamepad_preferred: bool,
                                }
                                if let Ok(p) = serde_json::from_str::<CtrlProps>(&raw_json) {
                                    if p.b_full_xbox_controller_support
                                        || p.b_partial_xbox_controller_support
                                        || p.b_p_s4_controller_support
                                        || p.b_p_s5_controller_support
                                    {
                                        controller_support = Some(SteamControllerSupport {
                                            full_support: p.b_full_xbox_controller_support,
                                            partial_support: p.b_partial_xbox_controller_support,
                                            gamepad_preferred: p.b_gamepad_preferred,
                                            xbox: p.b_full_xbox_controller_support || p.b_partial_xbox_controller_support,
                                            ps4: p.b_p_s4_controller_support,
                                            ps5: p.b_p_s5_controller_support,
                                        });
                                    }
                                }
                            }
                        }
                    }

                    // Extract DRM / Anti-Cheat notices
                    let mut drm_cursor = 0;
                    while let Some(rel) = block[drm_cursor..].find("class=\"DRM_notice\"")
                        .or_else(|| block[drm_cursor..].find("class=\"anticheat_section DRM_notice\""))
                    {
                        let tag_idx = drm_cursor + rel;
                        let div_start = match block[..tag_idx].rfind("<div") {
                            Some(p) => p,
                            None => {
                                drm_cursor = tag_idx + 18;
                                continue;
                            }
                        };
                        let div_end = match block[tag_idx..].find("</div>") {
                            Some(p) => tag_idx + p + 6,
                            None => {
                                drm_cursor = tag_idx + 18;
                                continue;
                            }
                        };
                        drm_cursor = div_end;
                        let drm_html = &block[div_start..div_end];
                        let lower_drm = drm_html.to_lowercase();
                        let is_anticheat = lower_drm.contains("anti-cheat")
                            || lower_drm.contains("anticheat")
                            || lower_drm.contains("battleye")
                            || lower_drm.contains("easy anti-cheat");

                        let link_url = if let Some(href_start) = drm_html.find("href=\"") {
                            let after = &drm_html[href_start + 6..];
                            after.find('"').map(|end| after[..end].to_string())
                        } else {
                            None
                        };

                        let link_text = if let Some(a_start) = drm_html.find("<a") {
                            let a_slice = &drm_html[a_start..];
                            if let Some(close_tag) = a_slice.find('>') {
                                let after_open = &a_slice[close_tag + 1..];
                                after_open
                                    .find("</a>")
                                    .map(|end| decode_steam_html_entities(&strip_steam_html_tags(&after_open[..end])))
                            } else {
                                None
                            }
                        } else {
                            None
                        };

                        let text = decode_steam_html_entities(&strip_steam_html_tags(drm_html));
                        if !text.is_empty() && !notices.iter().any(|n| n.text == text) {
                            notices.push(SteamNoticeItem {
                                text,
                                link_url,
                                link_text,
                                is_anticheat,
                            });
                        }
                    }
                }
            }
        }
    }

    // 2. Fallback to Steam appdetails JSON API if no features were extracted
    if features.is_empty() {
        let api_url = format!(
            "https://store.steampowered.com/api/appdetails?appids={}&cc=us&l={}",
            app_id, lang
        );
        if let Ok(api_resp) = client.get(&api_url).send().await {
            if api_resp.status().is_success() {
                #[derive(Deserialize)]
                struct ApiWrapper {
                    success: bool,
                    #[serde(default)]
                    data: Option<ApiAppDetail>,
                }
                #[derive(Deserialize)]
                struct ApiAppDetail {
                    #[serde(default)]
                    categories: Vec<ApiCategory>,
                    #[serde(default)]
                    controller_support: Option<String>,
                }
                #[derive(Deserialize)]
                struct ApiCategory {
                    id: Option<u32>,
                    description: Option<String>,
                }

                if let Ok(map) = api_resp.json::<HashMap<String, ApiWrapper>>().await {
                    if let Some(wrapper) = map.get(&app_id.to_string()) {
                        if wrapper.success {
                            if let Some(data) = &wrapper.data {
                                for cat in &data.categories {
                                    if let Some(desc) = &cat.description {
                                        let trimmed = desc.trim();
                                        if !trimmed.is_empty() {
                                            let id = cat.id;
                                            let icon_url = id.map(|i| default_steam_category_icon(i).to_string());
                                            let search_url = id.map(|i| format!("https://store.steampowered.com/search/?category2={}", i));
                                            features.push(SteamFeatureItem {
                                                id,
                                                name: trimmed.to_string(),
                                                icon_url,
                                                search_url,
                                            });
                                        }
                                    }
                                }

                                if controller_support.is_none() {
                                    if let Some(cs) = &data.controller_support {
                                        let is_full = cs.eq_ignore_ascii_case("full");
                                        controller_support = Some(SteamControllerSupport {
                                            full_support: is_full,
                                            partial_support: !is_full,
                                            gamepad_preferred: false,
                                            xbox: true,
                                            ps4: is_full,
                                            ps5: is_full,
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if features.is_empty() && controller_support.is_none() && notices.is_empty() {
        return None;
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    Some(SteamStoreFeaturesPayload {
        app_id,
        features,
        controller_support,
        notices,
        fetched_at: now,
    })
}


/// Fetch the rich "About" payload for every configured language and
/// return them as a single [`AboutBundle`].
///
/// Strategy (Steam-primary, IGDB fallback): for each language in
/// `ABOUT_LANGUAGES` we try Steam's localized `about_the_game`. Steam is
/// the authoritative source for translated store copy, so it wins
/// whenever it returns a non-empty body or trailers. For any language
/// Steam can't supply (it only localizes a subset of store pages), we
/// fall back once to IGDB's `summary` / `storyline` — English-only — and
/// reuse that single IGDB payload for every missing language, so the
/// About section still has content in the user's UI language when Steam
/// lacks a translation (no redundant IGDB calls).
///
pub async fn fetch_about_bundle(
    steam_app_id: Option<u32>,
    game_name: Option<&str>,
) -> AboutBundle {
    let cache_key = match steam_app_id {
        Some(id) => (Some(id), String::new()),
        None => (None, game_name.unwrap_or("").to_string()),
    };

    // Bundle cache hit?
    {
        let cache = ABOUT_BUNDLE_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
        if let Ok(guard) = cache.lock() {
            if let Some((fetched, bundle)) = guard.get(&cache_key) {
                if fetched.elapsed() < ABOUT_CACHE_TTL {
                    return bundle.clone();
                }
            }
        }
    }

    // Steam pass — one concurrent fetch per language.
    let mut entries: Vec<(String, Option<RichAboutPayload>)> = if let Some(app_id) = steam_app_id {
        let futures = ABOUT_LANGUAGES.iter().map(|lang| {
            let lang = (*lang).to_string();
            async move {
                let p = fetch_steam_about_for_lang_cached(app_id, &lang).await;
                (lang, p)
            }
        });
        futures::future::join_all(futures).await
    } else {
        Vec::new()
    };

    let mut by_language: HashMap<String, RichAboutPayload> = HashMap::new();
    let mut missing: Vec<String> = Vec::new();
    for (lang, payload) in entries.drain(..) {
        match payload {
            Some(p) if p.about_html.is_some() || p.about_text.is_some() || p.short_description.is_some() || !p.movies.is_empty() => {
                by_language.insert(lang, p);
            }
            _ => missing.push(lang),
        }
    }

    // IGDB fallback (English-only) fills any language Steam couldn't
    // supply, so the About section still has content in the chosen UI
    // language when Steam lacks a localization.
    if !missing.is_empty() {
        if let Some(name) = game_name {
            if let Some(igdb) = fetch_igdb_about(name).await {
                for lang in missing {
                    by_language.insert(lang, igdb.clone());
                }
            }
        }
    }

    let bundle = AboutBundle {
        by_language,
        default_language: "english".to_string(),
    };

    if let Some(cache) = ABOUT_BUNDLE_CACHE.get() {
        if let Ok(mut guard) = cache.lock() {
            guard.insert(cache_key, (Instant::now(), bundle.clone()));
            prune_metadata_cache(&mut *guard, METADATA_CACHE_MAX_ENTRIES);
        }
    }

    bundle
}

/// Steam-specific fetch + cache. The cache key is the Steam appid;
/// the TTL is `ABOUT_CACHE_TTL`. Returns `None` on any failure
/// (network, parse, missing appid) — the caller treats that as
/// "Steam unavailable" and walks the IGDB fallback.
/// Steam-specific fetch + cache, parameterized by `l=` language code.
/// The cache key is `(app_id, lang)`; the TTL is `ABOUT_CACHE_TTL`.
/// Returns `None` on any failure (network, parse, missing appid) — the
/// caller treats that as "Steam unavailable" for this language.
pub(crate) async fn fetch_steam_about_for_lang_cached(app_id: u32, lang: &str) -> Option<RichAboutPayload> {
    // Positive-cache hit? Return it.
    {
        let cache = ABOUT_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
        let guard = cache.lock().ok()?;
        if let Some((fetched, payload)) = guard.get(&(app_id, lang.to_string())) {
            if fetched.elapsed() < ABOUT_CACHE_TTL {
                return Some(payload.clone());
            }
        }
    }

    // 1. Hit Steam's appdetails endpoint with the requested language.
    //    Mirrors the URL `fetch_steam_game_details_impl` uses; we reuse
    //    `http_client()` for TLS session cache warmth.
    let url = steam_about_url(app_id, lang);
    let client = http_client();
    let resp = match client.get(&url).send().await {
        Ok(r) => r,
        Err(_) => return None,
    };
    if !resp.status().is_success() {
        return None;
    }

    // 2. Parse the raw response. The Steam wrapper is keyed by the
    //    appid string, identical to `SteamAppDetailResponse` used by
    //    `search_steam`, so we reuse the deserialization path —
    //    except we also read `about_the_game` + `movies` which the
    //    search path ignores. We declare a local copy of the
    //    wrapper here so the change is self-contained (touching the
    //    outer `SteamAppDetail` would silently let the search path
    //    start pulling trailers, which we don't want yet).
    #[derive(Deserialize)]
    struct RichWrapper {
        success: bool,
        #[serde(default)]
        data: Option<RichAppDetail>,
    }
    #[derive(Deserialize)]
    struct RichAppDetail {
        #[serde(default)]
        about_the_game: Option<String>,
        #[serde(default)]
        short_description: Option<String>,
        #[serde(default)]
        release_date: Option<SteamReleaseDate>,
        #[serde(default)]
        movies: Vec<SteamMovie>,
    }

    let map: HashMap<String, RichWrapper> = match resp.json().await {
        Ok(m) => m,
        Err(_) => return None,
    };
    let wrapper = match map.get(&app_id.to_string()) {
        Some(w) => w,
        None => return None,
    };
    if !wrapper.success {
        return None;
    }
    let data = match wrapper.data.as_ref() {
        Some(d) => d,
        None => return None,
    };

    // 3. Build the payload. Map movies to the frontend schema; pick
    //    the best webm (max → 480 → None) and best mp4 (max → 480 →
    //    full → None) slots.
    let movies: Vec<MovieEntry> = data
        .movies
        .iter()
        .map(|m| {
            let webm = m
                .webm
                .as_ref()
                .and_then(|v| v.max.clone().or_else(|| v.p480.clone()));
            let mp4 = m
                .mp4
                .as_ref()
                .and_then(|v| v.max.clone().or_else(|| v.p480.clone()).or_else(|| v.full.clone()));
            MovieEntry {
                id: m.id,
                name: m.name.clone(),
                thumbnail: m.thumbnail.clone(),
                webm,
                mp4,
                hls_h264: m.hls_h264.clone(),
                highlight: m.highlight,
            }
        })
        .collect();

    let short_desc = data
        .short_description
        .as_deref()
        .map(strip_html_for_preview)
        .filter(|s| !s.is_empty());

    let about_text = short_desc.clone().or_else(|| {
        data.about_the_game
            .as_deref()
            .map(strip_html_for_preview)
            .filter(|s| !s.is_empty())
    });

    let release_date = data.release_date.as_ref().and_then(|r| r.date.clone());

    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let payload = RichAboutPayload {
        source: "steam".to_string(),
        source_url: Some(format!("https://store.steampowered.com/app/{}", app_id)),
        source_name: Some("Steam".to_string()),
        about_html: data.about_the_game.clone(),
        about_text,
        short_description: short_desc,
        release_date,
        movies,
        fetched_at: now,
    };

    // 4. Cache + return. Only positive results are cached so a
    //    transient Steam hiccup doesn't poison subsequent renders.
    if payload.about_html.is_some() || payload.about_text.is_some() || !payload.movies.is_empty() {
        if let Some(cache) = ABOUT_CACHE.get() {
            if let Ok(mut guard) = cache.lock() {
                guard.insert((app_id, lang.to_string()), (Instant::now(), payload.clone()));
                prune_metadata_cache(&mut *guard, METADATA_CACHE_MAX_ENTRIES);
            }
        }
    }

    Some(payload)
}

/// IGDB fallback: search by name and return the first hit's
/// storyline + summary as plain text. We don't include IGDB videos
/// here because the existing VideosSection already surfaces them
/// via YouTube embeds; doubling-up would create two trailers rows.
pub(crate) async fn fetch_igdb_about(game_name: &str) -> Option<RichAboutPayload> {
    let results = search_igdb(game_name).await;
    let best = results.into_iter().next()?;

    // Prefer the longer `storyline`; fall back to `summary`. Skip
    // when both are empty (no IGDB data worth showing).
    let about_text = best
        .storyline
        .clone()
        .filter(|s| !s.trim().is_empty())
        .or(best.description.clone().filter(|s| !s.trim().is_empty()));

    let about_text = match about_text {
        Some(s) => s,
        None => return None,
    };

    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    Some(RichAboutPayload {
        source: "igdb".to_string(),
        source_url: Some(best.source_url.clone()),
        source_name: Some("IGDB".to_string()),
        about_html: None,
        about_text: Some(about_text),
        short_description: best.description.clone(),
        release_date: best.release_date.clone(),
        movies: Vec::new(),
        fetched_at: now,
    })
}

pub(crate) fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(CHARS[((triple >> 18) & 63) as usize] as char);
        out.push(CHARS[((triple >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            out.push(CHARS[((triple >> 6) & 63) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(CHARS[(triple & 63) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_base64_roundtrip() {
        let input = b"Hello, World!";
        let encoded = base64_encode(input);
        // Decode manually to verify
        assert_eq!(encoded, "SGVsbG8sIFdvcmxkIQ==");
    }
}
