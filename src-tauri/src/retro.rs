//! RetroAchievements provider (L1a).
//!
//! Bridges the local library to <https://retroachievements.org> so
//! emulated games can surface a real achievement list. The wire
//! behavior (endpoints, query params, response shapes, ROM-hash
//! preprocessing, console exclusion list, 5-day caching) mirrors the
//! SuccessStory Playnite plugin's `RetroAchievements.cs` client
//! exactly where it applies.
//!
//! ## Endpoints
//!
//! - `GET /API/API_GetConsoleIDs.php?z=<user>&y=<key>`
//!   → `[{ "ID": 7, "Name": "NES" }, ...]`
//! - `GET /API/API_GetGameList.php?z=<user>&y=<key>&i=<consoleId>&h=1`
//!   → `[{ "ID", "Title", "NumAchievements", "Hashes": [...] }, ...]`
//!   (`h=1` asks RA to include the ROM MD5s we match against.)
//! - `GET /API/API_GetGameInfoAndUserProgress.php?z=<user>&y=<key>&u=<user>&g=<gameId>`
//!   → `{ "Title", "NumDistinctPlayersCasual",
//!        "Achievements": { "<id>": { "Title", "Description",
//!        "BadgeName", "DateEarned", "NumAwarded" } } }`
//!
//! ## Game → platform → console resolution
//!
//! GameIndex stores emulated games with `platform` = the owning
//! emulator's console string (lib.rs `scan_emulator_roms` writes
//! `GameRow.platform` from `EmulatorRow.platform`, so ROMs carry
//! strings like "NES" / "GameCube" / "Super Nintendo"). We therefore
//! use `game.platform` as the console key when it is non-empty, and
//! fall back to the linked emulator's `platform` (then `name`) from
//! the `emulators` table when a game has `emulator_id` but an empty
//! platform. The key is canonicalized through the plugin's
//! `FindConsole` alias table ("Sega Genesis" → "Mega Drive", …) plus
//! a few GameIndex catalog strings ("Super Nintendo" → "SNES"), then
//! matched case-insensitively against the user-configured
//! `console_map`. No entry → the sync fails with a message the UI can
//! surface ("configure in settings or link manually").
//!
//! ## Deviations from the plugin (all deliberate)
//!
//! - `PlayniteTools.NormalizeGameName` lives in the
//!   `playnite-plugincommon` submodule, which is NOT checked out in
//!   the reference clone. `normalize_game_name` is a documented
//!   approximation: lowercase, strip `(...)` / `[...]` content,
//!   collapse punctuation/whitespace to single spaces.
//! - Badge URLs use the plugin's exact S3 bucket
//!   (`https://s3-eu-west-1.amazonaws.com/i.retroachievements.org/Badge/…`).
//! - `DateEarned` is parsed as UTC (`YYYY-MM-DD HH:MM:SS`) — the
//!   plugin's `Convert.ToDateTime` would apply local time.
//! - Rarity: RA's progress endpoint returns `NumAwarded` +
//!   `NumDistinctPlayersCasual`, so we replicate the plugin's exact
//!   formula (`NumAwarded*100/NumDistinctPlayersCasual` with integer
//!   division, defaulting to 100 when either is missing/zero).
//! - `.rar`/`.7z` detection checks the file extension (the plugin
//!   substring-matches the whole path); zip extraction takes the first
//!   non-directory entry (the plugin takes the last enumerated file).
//! - A game that resolves to no RA id returns an `Err` (the plugin
//!   silently returns an empty list).
//! - URL params are percent-encoded.

use std::collections::HashMap;
use std::fs::File;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::achievements::{Achievement, GameAchievementData};
use crate::db;

/// Base URL for the RetroAchievements legacy PHP API.
const RA_API_BASE: &str = "https://retroachievements.org/API/";
/// Badge URL for unlocked achievements (plugin's exact S3 bucket).
const RA_BADGE_URL_UNLOCKED: &str =
    "https://s3-eu-west-1.amazonaws.com/i.retroachievements.org/Badge/{}.png";
/// Badge URL for locked achievements (plugin's exact S3 bucket).
const RA_BADGE_URL_LOCKED: &str =
    "https://s3-eu-west-1.amazonaws.com/i.retroachievements.org/Badge/{}_lock.png";
const RA_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/// OS-keychain secret name holding `RetroCredentials` (username + API
/// key as one JSON blob, mirroring `steam_session`).
const CREDENTIALS_KEY: &str = "retroachievements_credentials";
/// kv_store keys (non-secret state lives in SQLite, secrets in the
/// keychain — same split as the Steam/Humble lanes).
const KV_CONSOLE_MAP: &str = "retro_console_map";
const KV_ENABLED: &str = "retro_enabled";
const KV_CONSOLES_CACHE: &str = "retro_consoles_cache";
const KV_GAMES_CACHE_PREFIX: &str = "retro_games_cache_";

/// Cache lifetime for the console list + per-console game lists
/// (plugin caches `RA_Consoles.json` / `RA_Games_<id>.json` for
/// 5 days, keyed on file mtime; we timestamp the cached blob instead).
const CACHE_TTL_SECS: u64 = 5 * 24 * 60 * 60;
/// Plugin's console-exclusion list for hash-based matching.
const CONSOLE_EXCLUDE_HASH: [u32; 10] = [2, 8, 12, 16, 21, 40, 41, 47, 49, 76];
/// Guardrails from the plugin's `GetGameIdByHash`.
const ZIP_EXTRACT_MAX_BYTES: u64 = 20 * 1024 * 1024; // skip zips > 20 MB
const FILE_HASH_MAX_BYTES: usize = 300 * 1024 * 1024; // skip files > 300 MB

/// Source tag for the `achievement_links` + `achievements_cache` rows.
const SOURCE: &str = "retro";

// ── Public types (serde_json round-trip to the frontend) ──────────────

/// One row of the user's platform → RA-console mapping.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetroConsoleMapEntry {
    /// Local platform key (the game's `platform` / emulator platform).
    pub platform: String,
    /// RetroAchievements console id (`API_GetConsoleIDs`).
    pub console_id: u32,
}

/// Settings surface for the Settings UI.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetroSettings {
    /// RA username. Read from the OS keychain (never persisted in
    /// plaintext); `None` when the user hasn't configured one.
    pub username: Option<String>,
    /// `true` when a non-empty API key is stored in the OS keychain.
    /// The key itself is never shipped back to the frontend.
    pub has_api_key: bool,
    /// platform → RA console mapping.
    pub console_map: Vec<RetroConsoleMapEntry>,
    /// Master toggle (kv_store-backed; defaults to `true`).
    pub enabled: bool,
}

/// A RetroAchievements console (`API_GetConsoleIDs` row).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RaConsole {
    #[serde(alias = "ID")]
    pub id: u32,
    #[serde(alias = "Name")]
    pub name: String,
}

/// A lightweight search hit from the console's full game list.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RaSearchResult {
    #[serde(alias = "ID")]
    pub id: u32,
    #[serde(alias = "Title")]
    pub title: String,
    #[serde(alias = "NumAchievements")]
    pub num_achievements: u32,
}

// ── Internal wire types (RA response shapes, PascalCase keys) ─────────

/// Keychain blob for RA credentials.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct RetroCredentials {
    #[serde(default)]
    username: Option<String>,
    #[serde(default)]
    api_key: Option<String>,
}

/// One game row from `API_GetGameList.php` (with `h=1`, so `Hashes`
/// carries the ROM MD5s the hash matcher works from).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct RaGameWire {
    #[serde(rename = "ID", default)]
    id: u32,
    #[serde(rename = "Title", default)]
    title: String,
    #[serde(rename = "NumAchievements", default)]
    num_achievements: u32,
    #[serde(rename = "Hashes", default)]
    hashes: Vec<String>,
}

/// Top level of `API_GetGameInfoAndUserProgress.php`.
#[derive(Debug, Clone, Default, Deserialize)]
struct RaProgressWire {
    #[serde(rename = "Title", default)]
    title: String,
    #[serde(rename = "NumDistinctPlayersCasual", default)]
    num_distinct_players_casual: Option<u32>,
    #[serde(rename = "Achievements", default)]
    achievements: HashMap<String, RaAchievementWire>,
}

/// One achievement inside the progress response.
#[derive(Debug, Clone, Default, Deserialize)]
struct RaAchievementWire {
    #[serde(rename = "Title", default)]
    title: String,
    #[serde(rename = "Description", default)]
    description: String,
    #[serde(rename = "BadgeName", default)]
    badge_name: String,
    /// `null` (or empty) when the user hasn't earned the achievement.
    #[serde(rename = "DateEarned", default)]
    date_earned: Option<String>,
    /// Rarity numerator (number of users who earned it).
    #[serde(rename = "NumAwarded", default)]
    num_awarded: Option<u32>,
}

/// kv-store cache blob for the console list.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct ConsolesCache {
    fetched_at: u64,
    consoles: Vec<RaConsole>,
}

/// kv-store cache blob for one console's game list.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct GamesCache {
    fetched_at: u64,
    games: Vec<RaGameWire>,
}

// ── Platform type (mirrors the plugin's `RaPlatformType`) ──────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RaPlatformType {
    All,
    Snes,
    SegaCdSaturn,
    Nes,
    Famicom,
    Arcade,
    Nds,
}

// ── Pure helpers ───────────────────────────────────────────────────────

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn md5_hex(bytes: &[u8]) -> String {
    use md5::{Digest, Md5};
    let mut hasher = Md5::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

/// NDS preprocessing from the plugin's `nds.cs`: the hashable payload
/// is `header(352) + ARM9 + ARM7 + icon(2560)`, where the three
/// sections are located through the little-endian fields in the
/// 0x160-byte header (`ARM9romOffset` @ 0x20, `ARM9size` @ 0x2C,
/// `ARM7romOffset` @ 0x30, `ARM7size` @ 0x3C, `bannerOffset` @ 0x68).
fn preprocess_nds(bytes: &[u8]) -> Vec<u8> {
    if bytes.len() < 0x70 {
        return bytes.to_vec();
    }
    let le32 = |off: usize| -> u32 {
        u32::from_le_bytes([bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]])
    };
    let arm9_off = le32(0x20) as usize;
    let arm9_size = le32(0x2c) as usize;
    let arm7_off = le32(0x30) as usize;
    let arm7_size = le32(0x3c) as usize;
    let banner_off = le32(0x68) as usize;

    let header = &bytes[..352.min(bytes.len())];
    let arm9 = slice_range(bytes, arm9_off, arm9_size);
    let arm7 = slice_range(bytes, arm7_off, arm7_size);
    let icon = slice_range(bytes, banner_off, 2560);

    let mut out = Vec::with_capacity(352 + arm9.len() + arm7.len() + icon.len());
    out.extend_from_slice(header);
    out.extend_from_slice(&arm9);
    out.extend_from_slice(&arm7);
    out.extend_from_slice(&icon);
    out
}

fn slice_range(bytes: &[u8], start: usize, len: usize) -> Vec<u8> {
    if start >= bytes.len() {
        return Vec::new();
    }
    bytes[start..(start + len).min(bytes.len())].to_vec()
}

/// Apply the plugin's per-platform ROM preprocessing, returning the
/// exact byte payload to MD5. `file_name` is used only by the Arcade
/// variant (it hashes the ASCII file stem, like the plugin's
/// `Path.GetFileNameWithoutExtension` + `Encoding.ASCII`).
fn preprocess_rom(bytes: &[u8], platform: RaPlatformType, file_name: &str) -> Vec<u8> {
    match platform {
        RaPlatformType::All => bytes.to_vec(),
        // Drop the 512-byte copier header when present.
        RaPlatformType::Snes => {
            if bytes.len() > 512 {
                bytes[512..].to_vec()
            } else {
                bytes.to_vec()
            }
        }
        // Strip the 16-byte iNES header (0x4E 45 53 1A) / FDS header
        // (0x46 44 53 1A) when present.
        RaPlatformType::Nes | RaPlatformType::Famicom => {
            let magic: &[u8] = match platform {
                RaPlatformType::Nes => b"NES\x1a",
                _ => b"FDS\x1a",
            };
            if bytes.len() >= 16 && bytes.starts_with(magic) {
                bytes[16..].to_vec()
            } else {
                bytes.to_vec()
            }
        }
        // Sega CD / Saturn: hash the first 512 bytes only.
        RaPlatformType::SegaCdSaturn => {
            let n = 512.min(bytes.len());
            bytes[..n].to_vec()
        }
        // Arcade: hash the ASCII file stem (extension removed).
        RaPlatformType::Arcade => {
            let file = file_name.rsplit(['\\', '/']).next().unwrap_or(file_name);
            let stem = match file.rfind('.') {
                Some(i) if i > 0 => &file[..i],
                _ => file,
            };
            stem.as_bytes()
                .iter()
                .map(|&b| if b > 127 { b'?' } else { b })
                .collect()
        }
        RaPlatformType::Nds => preprocess_nds(bytes),
    }
}

/// Remove every `(...)` / `[...]` segment (non-nested) from `s`.
/// Mirrors the plugin's edition-region stripping.
fn strip_delimited(s: &str, open: char, close: char) -> String {
    let mut out = String::with_capacity(s.len());
    let mut depth = 0usize;
    for c in s.chars() {
        if c == open {
            depth += 1;
        } else if c == close {
            depth = depth.saturating_sub(1);
        } else if depth == 0 {
            out.push(c);
        }
    }
    out
}

/// Documented approximation of the plugin's
/// `PlayniteTools.NormalizeGameName(name, true)` (the authoritative
/// source lives in the `playnite-plugincommon` submodule, which is not
/// checked out in the reference clone): trim, lowercase, strip
/// bracketed/parenthetical content, then collapse every run of
/// punctuation/whitespace to a single space.
pub fn normalize_game_name(name: &str) -> String {
    let s = strip_delimited(name, '[', ']');
    let s = strip_delimited(&s, '(', ')');
    let mut out = String::with_capacity(s.len());
    let mut pending_space = false;
    for c in s.to_lowercase().chars() {
        if c.is_alphanumeric() {
            if pending_space && !out.is_empty() {
                out.push(' ');
            }
            pending_space = false;
            out.push(c);
        } else {
            pending_space = true;
        }
    }
    out
}

/// RA title → game-id match: exact normalized equality first, then the
/// plugin's `|` / `-` fragment split (case-insensitive, un-normalized).
fn match_by_name(game_name: &str, games: &[RaGameWire]) -> Option<u32> {
    let norm = normalize_game_name(game_name);
    for g in games {
        if normalize_game_name(&g.title) == norm {
            return Some(g.id);
        }
    }
    let target = game_name.trim();
    for g in games {
        for frag in g.title.split(['|', '-']) {
            let frag = frag.trim();
            if !frag.is_empty() && frag.eq_ignore_ascii_case(target) {
                return Some(g.id);
            }
        }
    }
    None
}

/// Canonicalize a local platform string toward the RA console name,
/// applying the plugin's `FindConsole` alias table (case-insensitive)
/// plus a few GameIndex emulator-catalog strings.
pub fn normalize_platform_name(platform: &str) -> String {
    let aliases: &[(&str, &str)] = &[
        ("sega genesis", "mega drive"),
        ("nintendo snes", "snes"),
        ("super nintendo entertainment system", "snes"),
        ("super nintendo", "snes"), // GameIndex emulator catalog
        ("nintendo game boy", "game boy"),
        ("nintendo game boy advance", "game boy advance"),
        ("nintendo game boy color", "game boy color"),
        ("nintendo entertainment system", "nes"),
        ("pc engine supergrafx", "pc engine"),
        ("sega 32x", "32x"),
        ("sega master system", "master system"),
        ("sony playstation", "playstation"),
        ("snk neo geo pocket", "neo geo pocket"),
        ("sega game gear", "game gear"),
        ("nintendo gamecube", "gamecube"),
        ("nintendo wii", "wii"),
        ("nintendo wii u", "wii u"),
        ("sony playstation 2", "playstation 2"),
        ("microsoft xbox", "xbox"),
        ("magnavox odyssey2", "magnavox odyssey 2"),
        ("pc (dos)", "dos"),
        ("various", "arcade"),
        ("mame 2003 plus", "arcade"),
        ("nintendo virtual boy", "virtual boy"),
        ("sega sg 1000", "sg-1000"),
        ("atari st/ste/tt/falcon", "atari st"),
        ("sega saturn", "saturn"),
        ("sega dreamcast", "dreamcast"),
        ("sony playstation portable", "playstation portable"),
        ("sony psp", "playstation portable"),
        ("coleco colecovision", "colecovision"),
        ("snk neo geo cd", "neo geo cd"),
    ];
    let key = platform.trim().to_lowercase();
    for (from, to) in aliases {
        if key == *from {
            return to.to_string();
        }
    }
    // Plugin's catch-all: any platform containing "Grafx" → PC Engine.
    if key.contains("grafx") {
        return "pc engine".to_string();
    }
    key
}

/// Find the RA console id for a platform key through the user's
/// `console_map` (both sides normalized).
fn resolve_console_id(platform_key: &str, console_map: &[RetroConsoleMapEntry]) -> Option<u32> {
    let key = normalize_platform_name(platform_key);
    if key.is_empty() {
        return None;
    }
    console_map
        .iter()
        .find(|e| normalize_platform_name(&e.platform) == key)
        .map(|e| e.console_id)
}

/// Plugin's rarity formula: `NumAwarded * 100 / NumDistinctPlayersCasual`
/// with integer (truncating) division; 100 when either value is missing
/// or zero (the plugin treats a 0-awarded achievement as 100%).
fn ra_percent(num_awarded: Option<u32>, distinct_players: Option<u32>) -> f64 {
    match (num_awarded, distinct_players) {
        (Some(n), Some(d)) if n > 0 && d > 0 => (n * 100 / d) as f64,
        _ => 100.0,
    }
}

/// Parse RA's `YYYY-MM-DD HH:MM:SS` DateEarned as UTC → unix seconds.
fn parse_ra_datetime(s: &str) -> Option<u64> {
    let t = chrono::NaiveDateTime::parse_from_str(s.trim(), "%Y-%m-%d %H:%M:%S").ok()?;
    Some(t.and_utc().timestamp().max(0) as u64)
}

/// Map a parsed progress response to the shared `GameAchievementData`
/// shape (Steam-compatible), using the plugin's field mapping:
/// `api_name` = RA achievement id, `display_name` = Title,
/// `description` = Description, icons = BadgeName URL pair,
/// `achieved` = DateEarned present, `unlock_time` = epoch(DateEarned).
fn map_progress_to_data(ra_game_id: u32, progress: &RaProgressWire) -> GameAchievementData {
    let mut achievements: Vec<Achievement> = progress
        .achievements
        .iter()
        .map(|(key, a)| {
            let achieved = a
                .date_earned
                .as_deref()
                .map(|d| !d.trim().is_empty())
                .unwrap_or(false);
            let unlock_time = a
                .date_earned
                .as_deref()
                .and_then(parse_ra_datetime)
                .unwrap_or(0);
            Achievement {
                api_name: key.clone(),
                display_name: a.title.clone(),
                description: a.description.clone(),
                icon: RA_BADGE_URL_UNLOCKED.replace("{}", &a.badge_name),
                icon_gray: RA_BADGE_URL_LOCKED.replace("{}", &a.badge_name),
                achieved,
                unlock_time,
                percent: ra_percent(a.num_awarded, progress.num_distinct_players_casual),
            }
        })
        .collect();

    // Same ordering the Steam path uses: unlocked first (newest unlock
    // first), then locked by rarity (rarest first).
    achievements.sort_by(|a, b| match (a.achieved, b.achieved) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        (true, true) => b.unlock_time.cmp(&a.unlock_time),
        (false, false) => b
            .percent
            .partial_cmp(&a.percent)
            .unwrap_or(std::cmp::Ordering::Equal),
    });

    let total = achievements.len() as u32;
    let unlocked = achievements.iter().filter(|a| a.achieved).count() as u32;
    GameAchievementData {
        steam_app_id: 0,
        achievements,
        total,
        unlocked,
        locked: total - unlocked,
        last_synced: Some(now_secs()),
        source: SOURCE.to_string(),
        provider_id: Some(ra_game_id.to_string()),
    }
}

// ── ROM hash matching (plugin `GetGameIdByHash` parity) ───────────────

/// Build the `md5 → game id` lookup from a console's game list.
fn build_hash_map(games: &[RaGameWire]) -> HashMap<String, u32> {
    let mut map = HashMap::new();
    for g in games {
        for h in &g.hashes {
            map.entry(h.to_ascii_lowercase()).or_insert(g.id);
        }
    }
    map
}

/// Extract the first non-directory entry of a `.zip` ROM into a temp
/// dir and return `(path, tempdir)`. `TempDir` is returned so the
/// extraction stays alive for the caller's read.
fn extract_first_zip_entry(
    zip_path: &str,
) -> Result<(std::path::PathBuf, tempfile::TempDir), String> {
    let file = File::open(zip_path).map_err(|e| format!("RA zip open: {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("RA zip parse: {e}"))?;
    let dir = tempfile::tempdir().map_err(|e| format!("RA zip tempdir: {e}"))?;
    let mut chosen: Option<(usize, String)> = None;
    for i in 0..archive.len() {
        let entry = archive
            .by_index(i)
            .map_err(|e| format!("RA zip entry: {e}"))?;
        if entry.is_dir() {
            continue;
        }
        chosen = Some((i, entry.name().to_string()));
        break;
    }
    let (idx, name) = chosen.ok_or_else(|| "RA zip has no files".to_string())?;
    // Guard against zip-slip: only the final path component is used.
    let safe_name = name.rsplit(['/', '\\']).next().unwrap_or("rom");
    let out = dir.path().join(safe_name);
    let mut entry = archive
        .by_index(idx)
        .map_err(|e| format!("RA zip re-open: {e}"))?;
    let mut out_file = File::create(&out).map_err(|e| format!("RA zip create: {e}"))?;
    std::io::copy(&mut entry, &mut out_file).map_err(|e| format!("RA zip extract: {e}"))?;
    Ok((out, dir))
}

/// Try every platform preprocessing variant the plugin tries (NDS → All
/// → SNES → NES → Arcade → Famicom → Sega CD/Saturn) and return the
/// first game whose `Hashes` contains the computed MD5. Honors the
/// plugin's guards: skip `.rar`/`.7z`, extract `.zip` to temp only when
/// ≤ 20 MB, and skip files > 300 MB.
fn match_by_hash(rom_path: &str, games: &[RaGameWire]) -> Option<u32> {
    let hash_to_game = build_hash_map(games);
    if hash_to_game.is_empty() {
        return None;
    }

    let lower = rom_path.to_ascii_lowercase();
    if lower.ends_with(".rar") || lower.ends_with(".7z") {
        return None;
    }

    let resolved = if lower.ends_with(".zip") {
        let meta = std::fs::metadata(rom_path).ok()?;
        if meta.len() > ZIP_EXTRACT_MAX_BYTES {
            return None;
        }
        extract_first_zip_entry(rom_path).ok()?
    } else {
        let path = std::path::PathBuf::from(rom_path);
        let keepalive = tempfile::tempdir().ok()?;
        (path, keepalive)
    };

    let bytes = std::fs::read(&resolved.0).ok()?;
    if bytes.len() > FILE_HASH_MAX_BYTES {
        return None;
    }
    let file_name = resolved
        .0
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let ext = resolved
        .0
        .extension()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    let find = |platform: RaPlatformType| {
        let data = preprocess_rom(&bytes, platform, &file_name);
        hash_to_game.get(&md5_hex(&data)).copied()
    };

    if ext == "nds" {
        if let Some(id) = find(RaPlatformType::Nds) {
            return Some(id);
        }
    }
    for platform in [
        RaPlatformType::All,
        RaPlatformType::Snes,
        RaPlatformType::Nes,
        RaPlatformType::Arcade,
        RaPlatformType::Famicom,
        RaPlatformType::SegaCdSaturn,
    ] {
        if let Some(id) = find(platform) {
            return Some(id);
        }
    }
    None
}

/// Resolve the RA game id for a sync, in the plugin's precedence order:
/// forced id (retro link `provider_id`) → console map → ROM hash →
/// normalized name. The game list is fetched by the caller only when a
/// console is mapped and no forced id exists, so forced links never
/// trigger a console fetch.
fn pick_game_id(
    forced: Option<u32>,
    console_id: Option<u32>,
    games: &[RaGameWire],
    rom_path: Option<&str>,
    game_name: &str,
) -> Result<u32, String> {
    if let Some(fid) = forced {
        return Ok(fid);
    }
    let console_id = console_id.ok_or_else(|| {
        "No RetroAchievements console mapped for this game — configure one in settings or \
         link the game manually"
            .to_string()
    })?;
    if let Some(rom) = rom_path {
        if !CONSOLE_EXCLUDE_HASH.contains(&console_id) {
            if let Some(id) = match_by_hash(rom, games) {
                return Ok(id);
            }
        }
    }
    match_by_name(game_name, games).ok_or_else(|| {
        format!(
            "No RetroAchievements game matched \"{game_name}\" — search the console's game \
             list and link it manually"
        )
    })
}

// ── Persistence helpers ────────────────────────────────────────────────

/// Read the keychain credentials blob (defaults to empty when absent or
/// malformed — `has_api_key` on the settings surface is derived from it).
fn load_credentials() -> Result<RetroCredentials, String> {
    let store = db::secrets::SecretStore::new();
    Ok(store
        .get(CREDENTIALS_KEY)?
        .as_deref()
        .and_then(|raw| serde_json::from_str(raw).ok())
        .unwrap_or_default())
}

/// Read credentials and fail with a UI-surfaccable message when the
/// account isn't configured (used by the network commands).
fn require_credentials() -> Result<RetroCredentials, String> {
    let creds = load_credentials()?;
    let user_ok = creds
        .username
        .as_deref()
        .map(|u| !u.trim().is_empty())
        .unwrap_or(false);
    let key_ok = creds
        .api_key
        .as_deref()
        .map(|k| !k.trim().is_empty())
        .unwrap_or(false);
    if !user_ok || !key_ok {
        return Err(
            "RetroAchievements is not configured — add your username and API key in settings"
                .to_string(),
        );
    }
    Ok(creds)
}

fn load_console_map(db: &db::Db) -> Vec<RetroConsoleMapEntry> {
    db::kv::get(db, KV_CONSOLE_MAP)
        .ok()
        .flatten()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

/// The platform key that decides which `console_map` row applies:
/// `game.platform` when non-empty (emulated games store the emulator's
/// console string there — see lib.rs `scan_emulator_roms`), else the
/// linked emulator's `platform`, then its `name`.
fn platform_key_for_game(app: &tauri::AppHandle, game: &crate::db::games::GameRow) -> Option<String> {
    if !game.platform.trim().is_empty() {
        return Some(game.platform.trim().to_string());
    }
    if let Some(emu_id) = &game.emulator_id {
        let db_state = app.state::<db::Db>();
        if let Ok(Some(emu)) = db::emulators::get(db_state.inner(), emu_id) {
            if !emu.platform.trim().is_empty() {
                return Some(emu.platform.trim().to_string());
            }
            if !emu.name.trim().is_empty() {
                return Some(emu.name.trim().to_string());
            }
        }
    }
    None
}

/// The forced RA game id from the `retro` link row's `provider_id`
/// (the plugin's RAgameID override), if any.
fn get_forced_game_id(app: &tauri::AppHandle, game_id: &str) -> Result<Option<u32>, String> {
    let db_state = app.state::<db::Db>();
    let link = db::achievement_links::get_links_for_game(db_state.inner(), game_id)?
        .into_iter()
        .find(|l| l.source == SOURCE);
    match link.and_then(|l| l.provider_id) {
        Some(pid) => pid
            .parse::<u32>()
            .map(Some)
            .map_err(|e| format!("Stored RetroAchievements game id \"{pid}\" is invalid: {e}")),
        None => Ok(None),
    }
}

fn read_retro_link(db: &db::Db, game_id: &str) -> Result<Option<db::achievement_links::AchievementLink>, String> {
    Ok(db::achievement_links::get_links_for_game(db, game_id)?
        .into_iter()
        .find(|l| l.source == SOURCE))
}

/// Try to recover an RA title for a forced id from any cached game
/// list, so the link row carries a real RA title when available.
fn lookup_title_from_cache(db: &db::Db, ra_game_id: u32) -> Option<String> {
    for entry in load_console_map(db) {
        let key = format!("{KV_GAMES_CACHE_PREFIX}{}", entry.console_id);
        let Some(raw) = db::kv::get(db, &key).ok().flatten() else {
            continue;
        };
        let Ok(cache) = serde_json::from_str::<GamesCache>(&raw) else {
            continue;
        };
        if let Some(g) = cache.games.iter().find(|g| g.id == ra_game_id) {
            return Some(g.title.clone());
        }
    }
    None
}

// ── kv caches (console list + per-console game lists, 5-day TTL) ──────

fn read_consoles_cache(db: &db::Db) -> Option<Vec<RaConsole>> {
    let raw = db::kv::get(db, KV_CONSOLES_CACHE).ok().flatten()?;
    let cache: ConsolesCache = serde_json::from_str(&raw).ok()?;
    if now_secs().saturating_sub(cache.fetched_at) > CACHE_TTL_SECS {
        return None;
    }
    Some(cache.consoles)
}

fn read_games_cache(db: &db::Db, key: &str) -> Option<Vec<RaGameWire>> {
    let raw = db::kv::get(db, key).ok().flatten()?;
    let cache: GamesCache = serde_json::from_str(&raw).ok()?;
    if now_secs().saturating_sub(cache.fetched_at) > CACHE_TTL_SECS {
        return None;
    }
    Some(cache.games)
}

fn write_consoles_cache(db: &db::Db, consoles: &[RaConsole]) -> Result<(), String> {
    let cache = ConsolesCache {
        fetched_at: now_secs(),
        consoles: consoles.to_vec(),
    };
    db::kv::set(
        db,
        KV_CONSOLES_CACHE,
        &serde_json::to_string(&cache).map_err(|e| e.to_string())?,
    )
}

fn write_games_cache(db: &db::Db, key: &str, games: &[RaGameWire]) -> Result<(), String> {
    let cache = GamesCache {
        fetched_at: now_secs(),
        games: games.to_vec(),
    };
    db::kv::set(db, key, &serde_json::to_string(&cache).map_err(|e| e.to_string())?)
}

// ── HTTP helpers ───────────────────────────────────────────────────────

fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(RA_USER_AGENT)
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))
}

/// GET a URL and return the raw body, failing on non-success status and
/// on RA's `Unauthenticated` payload (bad username/key).
async fn get_json(client: &reqwest::Client, url: &str, label: &str) -> Result<String, String> {
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("{label} request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("{label} returned HTTP {}", resp.status().as_u16()));
    }
    let body = resp
        .text()
        .await
        .map_err(|e| format!("{label} read failed: {e}"))?;
    if body.contains("Unauthenticated") {
        return Err(
            "RetroAchievements rejected the credentials — check your username and API key"
                .to_string(),
        );
    }
    Ok(body)
}

/// Fetch (or read from the 5-day cache) the RA console list.
async fn fetch_consoles(
    app: &tauri::AppHandle,
    client: &reqwest::Client,
    creds: &RetroCredentials,
) -> Result<Vec<RaConsole>, String> {
    {
        let db_state = app.state::<db::Db>();
        if let Some(cached) = read_consoles_cache(db_state.inner()) {
            return Ok(cached);
        }
    }
    let url = format!(
        "{RA_API_BASE}API_GetConsoleIDs.php?z={}&y={}",
        urlencoding::encode(creds.username.as_deref().unwrap_or("")),
        urlencoding::encode(creds.api_key.as_deref().unwrap_or("")),
    );
    let body = get_json(client, &url, "Console list").await?;
    let consoles: Vec<RaConsole> =
        serde_json::from_str(&body).map_err(|e| format!("Failed to parse console list: {e}"))?;
    {
        let db_state = app.state::<db::Db>();
        if let Err(e) = write_consoles_cache(db_state.inner(), &consoles) {
            eprintln!("[retro] failed to cache console list: {e}");
        }
    }
    Ok(consoles)
}

/// Fetch (or read from the 5-day cache) one console's full game list
/// with `h=1` (RA includes `Hashes` only when the flag is set).
async fn fetch_game_list(
    app: &tauri::AppHandle,
    client: &reqwest::Client,
    creds: &RetroCredentials,
    console_id: u32,
) -> Result<Vec<RaGameWire>, String> {
    let cache_key = format!("{KV_GAMES_CACHE_PREFIX}{console_id}");
    {
        let db_state = app.state::<db::Db>();
        if let Some(games) = read_games_cache(db_state.inner(), &cache_key) {
            return Ok(games);
        }
    }
    let url = format!(
        "{RA_API_BASE}API_GetGameList.php?z={}&y={}&i={}&h=1",
        urlencoding::encode(creds.username.as_deref().unwrap_or("")),
        urlencoding::encode(creds.api_key.as_deref().unwrap_or("")),
        console_id,
    );
    let body = get_json(client, &url, "Game list").await?;
    let games: Vec<RaGameWire> = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse game list for console {console_id}: {e}"))?;
    {
        let db_state = app.state::<db::Db>();
        if let Err(e) = write_games_cache(db_state.inner(), &cache_key, &games) {
            eprintln!("[retro] failed to cache game list for console {console_id}: {e}");
        }
    }
    Ok(games)
}

// ── Tauri commands ─────────────────────────────────────────────────────

/// Settings surface for the Settings UI (credentials masked).
#[tauri::command]
pub fn retro_get_settings(app: tauri::AppHandle) -> Result<RetroSettings, String> {
    let creds = load_credentials()?;
    let username = creds
        .username
        .filter(|u| !u.trim().is_empty())
        .map(|u| u.trim().to_string());
    let has_api_key = creds
        .api_key
        .as_deref()
        .map(|k| !k.trim().is_empty())
        .unwrap_or(false);
    let db_state = app.state::<db::Db>();
    let console_map = load_console_map(db_state.inner());
    let enabled = db::kv::get(db_state.inner(), KV_ENABLED)
        .ok()
        .flatten()
        .and_then(|raw| raw.parse::<bool>().ok())
        .unwrap_or(true);
    Ok(RetroSettings {
        username,
        has_api_key,
        console_map,
        enabled,
    })
}

/// Persist updated settings. Only the provided fields are touched; an
/// empty `api_key` string clears it. Credentials go to the OS keychain,
/// non-secret state to the kv_store.
#[tauri::command]
pub fn retro_save_settings(
    app: tauri::AppHandle,
    username: Option<String>,
    api_key: Option<String>,
    console_map: Option<Vec<RetroConsoleMapEntry>>,
    enabled: Option<bool>,
) -> Result<(), String> {
    let mut creds = load_credentials()?;
    if let Some(u) = username {
        creds.username = if u.trim().is_empty() {
            None
        } else {
            Some(u.trim().to_string())
        };
    }
    if let Some(k) = api_key {
        creds.api_key = if k.trim().is_empty() {
            None
        } else {
            Some(k.trim().to_string())
        };
    }
    let store = db::secrets::SecretStore::new();
    match (&creds.username, &creds.api_key) {
        (None, None) => {
            store.delete(CREDENTIALS_KEY)?;
        }
        _ => {
            store.set(
                CREDENTIALS_KEY,
                &serde_json::to_string(&creds).map_err(|e| e.to_string())?,
            )?;
        }
    }
    let db_state = app.state::<db::Db>();
    if let Some(cm) = console_map {
        db::kv::set(
            db_state.inner(),
            KV_CONSOLE_MAP,
            &serde_json::to_string(&cm).map_err(|e| e.to_string())?,
        )?;
    }
    if let Some(en) = enabled {
        db::kv::set(db_state.inner(), KV_ENABLED, &en.to_string())?;
    }
    Ok(())
}

/// Full RA console list (5-day cached) for the settings picker.
#[tauri::command]
pub async fn retro_get_consoles(app: tauri::AppHandle) -> Result<Vec<RaConsole>, String> {
    let client = build_client()?;
    let creds = require_credentials()?;
    fetch_consoles(&app, &client, &creds).await
}

/// Search one console's full game list (same list the hash/name
/// matcher uses; 5-day cached).
#[tauri::command]
pub async fn retro_search_games(
    app: tauri::AppHandle,
    console_id: u32,
    query: String,
) -> Result<Vec<RaSearchResult>, String> {
    let client = build_client()?;
    let creds = require_credentials()?;
    let games = fetch_game_list(&app, &client, &creds, console_id).await?;

    let q = query.trim().to_lowercase();
    let q_norm = normalize_game_name(query.trim());
    let mut results: Vec<RaSearchResult> = games
        .iter()
        .filter(|g| {
            let title = g.title.to_lowercase();
            q.is_empty() || title.contains(&q) || normalize_game_name(&g.title).contains(&q_norm)
        })
        .take(100)
        .map(|g| RaSearchResult {
            id: g.id,
            title: g.title.clone(),
            num_achievements: g.num_achievements,
        })
        .collect();
    results.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    Ok(results)
}

/// Set (or clear) the forced RA game id on the game's `retro` link row
/// (the plugin's RAgameID override). When forcing, `display_name` is
/// set to the RA title if one is cached, else the game's own name.
#[tauri::command]
pub fn retro_set_forced_game_id(
    app: tauri::AppHandle,
    game_id: String,
    ra_game_id: Option<u32>,
) -> Result<db::achievement_links::AchievementLink, String> {
    let db_state = app.state::<db::Db>();
    let db = db_state.inner();
    let existing = read_retro_link(db, &game_id)?;

    match ra_game_id {
        Some(id) => {
            let title = existing
                .as_ref()
                .and_then(|l| l.display_name.clone())
                .or_else(|| lookup_title_from_cache(db, id))
                .or_else(|| {
                    db::games::get(db, &game_id)
                        .ok()
                        .flatten()
                        .map(|g| g.name)
                });
            let link = db::achievement_links::AchievementLink {
                game_id: game_id.clone(),
                source: SOURCE.to_string(),
                provider_id: Some(id.to_string()),
                display_name: title,
                source_url: Some(format!("https://retroachievements.org/game/{id}")),
                manual_unlocks: existing.as_ref().and_then(|l| l.manual_unlocks.clone()),
                created_at: existing.as_ref().map(|l| l.created_at).unwrap_or(0),
                updated_at: 0,
            };
            db::achievement_links::upsert_link(db, &link)?;
            Ok(read_retro_link(db, &game_id)?
                .ok_or_else(|| "Failed to persist the RetroAchievements link".to_string())?)
        }
        None => {
            db::achievement_links::delete_link(db, &game_id, SOURCE)?;
            Ok(db::achievement_links::AchievementLink {
                game_id,
                source: SOURCE.to_string(),
                provider_id: None,
                display_name: None,
                source_url: None,
                manual_unlocks: None,
                created_at: 0,
                updated_at: 0,
            })
        }
    }
}

/// Full sync for one game: resolve the RA game id (forced → console
/// map → ROM hash → name), fetch user progress, and persist both the
/// `retro` link row and the `achievements_cache` row (source "retro",
/// steam_app_id 0, provider_id = RA game id).
#[tauri::command]
pub async fn retro_sync_game(
    app: tauri::AppHandle,
    game_id: String,
) -> Result<GameAchievementData, String> {
    let client = build_client()?;
    let creds = require_credentials()?;

    let game = {
        let db_state = app.state::<db::Db>();
        db::games::get(db_state.inner(), &game_id)?
            .ok_or_else(|| format!("Game {game_id} not found"))?
    };

    let forced = get_forced_game_id(&app, &game_id)?;
    let (console_id, games) = if forced.is_some() {
        (None, Vec::new())
    } else {
        let platform_key = platform_key_for_game(&app, &game);
        let console_map = {
            let db_state = app.state::<db::Db>();
            load_console_map(db_state.inner())
        };
        let cid = platform_key
            .as_deref()
            .and_then(|pk| resolve_console_id(pk, &console_map))
            .ok_or_else(|| {
                "No RetroAchievements console mapped for this game — configure one in settings \
                 or link the game manually"
                    .to_string()
            })?;
        let games = fetch_game_list(&app, &client, &creds, cid).await?;
        (Some(cid), games)
    };

    let ra_game_id = pick_game_id(
        forced,
        console_id,
        &games,
        game.rom_path.as_deref(),
        &game.name,
    )?;

    let url = format!(
        "{RA_API_BASE}API_GetGameInfoAndUserProgress.php?z={}&y={}&u={}&g={}",
        urlencoding::encode(creds.username.as_deref().unwrap_or("")),
        urlencoding::encode(creds.api_key.as_deref().unwrap_or("")),
        urlencoding::encode(creds.username.as_deref().unwrap_or("")),
        ra_game_id,
    );
    let body = get_json(&client, &url, "Game progress").await?;
    let progress: RaProgressWire =
        serde_json::from_str(&body).map_err(|e| format!("Failed to parse game progress: {e}"))?;

    let data = map_progress_to_data(ra_game_id, &progress);
    let now = now_secs();
    let payload = serde_json::to_string(&data).map_err(|e| e.to_string())?;

    {
        let db_state = app.state::<db::Db>();
        let db = db_state.inner();
        let existing = read_retro_link(db, &game_id)?;
        let link = db::achievement_links::AchievementLink {
            game_id: game_id.clone(),
            source: SOURCE.to_string(),
            provider_id: Some(ra_game_id.to_string()),
            display_name: Some(progress.title.clone()),
            source_url: Some(format!("https://retroachievements.org/game/{ra_game_id}")),
            manual_unlocks: existing.as_ref().and_then(|l| l.manual_unlocks.clone()),
            created_at: existing.as_ref().map(|l| l.created_at).unwrap_or(0),
            updated_at: 0,
        };
        db::achievement_links::upsert_link(db, &link)?;
        db::achievements::upsert(
            db,
            &game_id,
            0,
            &payload,
            now,
            SOURCE,
            Some(&ra_game_id.to_string()),
        )?;
    }

    Ok(data)
}

// ── Tests (hermetic: no network, no DB) ────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── MD5 vectors ────────────────────────────────────────────────────

    #[test]
    fn md5_known_vectors() {
        assert_eq!(md5_hex(b""), "d41d8cd98f00b204e9800998ecf8427e");
        assert_eq!(md5_hex(b"abc"), "900150983cd24fb0d6963f7d28e17f72");
    }

    // ── ROM hash preprocessing ─────────────────────────────────────────

    /// Build a synthetic NDS ROM with recognizable section offsets.
    fn build_nds_rom() -> Vec<u8> {
        let mut rom = vec![0u8; 0x2000];
        // Pattern-fill the header region FIRST so the offset writes below
        // (which land inside it) are not clobbered.
        for (i, b) in rom[0..352].iter_mut().enumerate() {
            *b = (i % 251) as u8;
        }
        rom[0x20..0x24].copy_from_slice(&2000u32.to_le_bytes()); // ARM9romOffset
        rom[0x2c..0x30].copy_from_slice(&100u32.to_le_bytes()); // ARM9size
        rom[0x30..0x34].copy_from_slice(&2304u32.to_le_bytes()); // ARM7romOffset
        rom[0x3c..0x40].copy_from_slice(&50u32.to_le_bytes()); // ARM7size
        rom[0x68..0x6c].copy_from_slice(&4096u32.to_le_bytes()); // bannerOffset
        for (i, b) in rom[2000..2100].iter_mut().enumerate() {
            *b = (200 + i % 50) as u8;
        }
        for (i, b) in rom[2304..2354].iter_mut().enumerate() {
            *b = (100 + i % 40) as u8;
        }
        for (i, b) in rom[4096..4096 + 2560].iter_mut().enumerate() {
            *b = (7 + i % 240) as u8;
        }
        rom
    }

    #[test]
    fn nds_header_strip_concatenates_sections() {
        let rom = build_nds_rom();
        let out = preprocess_rom(&rom, RaPlatformType::Nds, "");
        // header(352) + arm9(100) + arm7(50) + icon(2560)
        assert_eq!(out.len(), 3062);
        assert_eq!(&out[0..352], &rom[0..352]);
        assert_eq!(&out[352..452], &rom[2000..2100]);
        assert_eq!(&out[452..502], &rom[2304..2354]);
        assert_eq!(&out[502..], &rom[4096..6656]);
    }

    #[test]
    fn snes_drops_first_512_bytes() {
        let bytes: Vec<u8> = (0..600u16).map(|i| i as u8).collect();
        let out = preprocess_rom(&bytes, RaPlatformType::Snes, "");
        assert_eq!(out.len(), 88);
        assert_eq!(out, bytes[512..]);

        // Small SNES ROMs are hashed raw.
        let small = vec![1u8, 2, 3, 4];
        assert_eq!(
            preprocess_rom(&small, RaPlatformType::Snes, ""),
            small
        );
    }

    #[test]
    fn nes_strips_16_byte_ines_header_only_when_present() {
        let mut ines = vec![0u8; 64];
        ines[0..4].copy_from_slice(b"NES\x1a");
        let out = preprocess_rom(&ines, RaPlatformType::Nes, "");
        assert_eq!(out.len(), 48);
        assert_eq!(out, ines[16..]);

        let raw = vec![9u8; 64];
        assert_eq!(preprocess_rom(&raw, RaPlatformType::Nes, ""), raw);
    }

    #[test]
    fn famicom_strips_16_byte_fds_header_only_when_present() {
        let mut fds = vec![0u8; 64];
        fds[0..4].copy_from_slice(b"FDS\x1a");
        let out = preprocess_rom(&fds, RaPlatformType::Famicom, "");
        assert_eq!(out.len(), 48);

        // An iNES header does NOT trigger the FDS strip.
        let mut ines = vec![0u8; 64];
        ines[0..4].copy_from_slice(b"NES\x1a");
        assert_eq!(
            preprocess_rom(&ines, RaPlatformType::Famicom, ""),
            ines
        );
    }

    #[test]
    fn sega_cd_saturn_hashes_first_512_bytes() {
        let bytes: Vec<u8> = (0..1000u16).map(|i| i as u8).collect();
        let out = preprocess_rom(&bytes, RaPlatformType::SegaCdSaturn, "");
        assert_eq!(out.len(), 512);
        assert_eq!(out, bytes[..512]);

        let small = vec![1u8, 2, 3];
        assert_eq!(
            preprocess_rom(&small, RaPlatformType::SegaCdSaturn, ""),
            small
        );
    }

    #[test]
    fn plain_raw_platform_is_identity() {
        let bytes = vec![5u8, 6, 7, 8];
        assert_eq!(preprocess_rom(&bytes, RaPlatformType::All, ""), bytes);
    }

    #[test]
    fn arcade_hashes_ascii_file_stem() {
        let out = preprocess_rom(b"whatever", RaPlatformType::Arcade, "C:\\roms\\sonic.zip");
        assert_eq!(out, b"sonic");
        assert_eq!(md5_hex(&out), md5_hex(b"sonic"));
    }

    #[test]
    fn hash_matching_finds_game_via_temp_file() {
        let dir = tempfile::tempdir().unwrap();
        let rom_path = dir.path().join("game.rom");
        std::fs::write(&rom_path, b"abc").unwrap();
        let games = vec![RaGameWire {
            id: 42,
            title: "Test Game".into(),
            num_achievements: 1,
            hashes: vec!["900150983cd24fb0d6963f7d28e17f72".into()],
        }];
        assert_eq!(match_by_hash(rom_path.to_str().unwrap(), &games), Some(42));
    }

    #[test]
    fn hash_matching_skips_rar_and_7z() {
        let dir = tempfile::tempdir().unwrap();
        for ext in ["rar", "7z"] {
            let rom_path = dir.path().join(format!("game.{ext}"));
            std::fs::write(&rom_path, b"abc").unwrap();
            let games = vec![RaGameWire {
                id: 42,
                title: "Test Game".into(),
                num_achievements: 1,
                hashes: vec!["900150983cd24fb0d6963f7d28e17f72".into()],
            }];
            assert_eq!(
                match_by_hash(rom_path.to_str().unwrap(), &games),
                None,
                "{ext} must be skipped"
            );
        }
    }

    // ── Name normalization + matching ──────────────────────────────────

    #[test]
    fn normalize_game_name_vectors() {
        assert_eq!(normalize_game_name("Super Mario Bros. (USA)"), "super mario bros");
        assert_eq!(normalize_game_name("Final Fantasy VII [T-En]"), "final fantasy vii");
        assert_eq!(normalize_game_name("Zelda II: The Adventure of Link"), "zelda ii the adventure of link");
        assert_eq!(normalize_game_name("   Mega   Man   "), "mega man");
        assert_eq!(normalize_game_name(""), "");
    }

    fn sample_games() -> Vec<RaGameWire> {
        vec![
            RaGameWire {
                id: 14402,
                title: "Super Mario Bros.".into(),
                num_achievements: 20,
                hashes: vec![],
            },
            RaGameWire {
                id: 10392,
                title: "Zelda II - The Adventure of Link".into(),
                num_achievements: 10,
                hashes: vec![],
            },
            RaGameWire {
                id: 10111,
                title: "Castlevania | Akumajou Dracula".into(),
                num_achievements: 15,
                hashes: vec![],
            },
        ]
    }

    #[test]
    fn name_matching_exact_normalized() {
        let games = sample_games();
        assert_eq!(match_by_name("Super Mario Bros.", &games), Some(14402));
        assert_eq!(match_by_name("super mario bros.", &games), Some(14402));
    }

    #[test]
    fn name_matching_splits_on_dash_and_pipe() {
        let games = sample_games();
        // `-` fragment split (plugin `GetGameIdByName`).
        assert_eq!(match_by_name("Zelda II", &games), Some(10392));
        // `|` fragment split.
        assert_eq!(match_by_name("Castlevania", &games), Some(10111));
    }

    #[test]
    fn name_matching_returns_none_when_absent() {
        assert_eq!(match_by_name("Nothing Here", &sample_games()), None);
    }

    // ── Console resolution ─────────────────────────────────────────────

    #[test]
    fn console_map_matches_via_platform_aliases() {
        let map = vec![
            RetroConsoleMapEntry {
                platform: "Sega Genesis".into(),
                console_id: 1,
            },
            RetroConsoleMapEntry {
                platform: "SNES".into(),
                console_id: 3,
            },
        ];
        assert_eq!(resolve_console_id("Sega Genesis", &map), Some(1));
        assert_eq!(resolve_console_id("Super Nintendo", &map), Some(3));
        assert_eq!(resolve_console_id("Nintendo 64", &map), None);
    }

    #[test]
    fn platform_aliases_cover_gameindex_catalog() {
        assert_eq!(normalize_platform_name("Super Nintendo"), "snes");
        assert_eq!(normalize_platform_name("Sega Genesis"), "mega drive");
        assert_eq!(normalize_platform_name("PC Engine SuperGrafx"), "pc engine");
        assert_eq!(normalize_platform_name("Arcade"), "arcade");
    }

    // ── Game-id precedence ─────────────────────────────────────────────

    #[test]
    fn forced_id_wins_over_hash_and_name() {
        let games = vec![RaGameWire {
            id: 99,
            title: "Mario".into(),
            num_achievements: 1,
            hashes: vec![],
        }];
        // Forced id 5 must win even though a name match exists.
        assert_eq!(pick_game_id(Some(5), Some(7), &games, None, "Mario"), Ok(5));
    }

    #[test]
    fn excluded_console_skips_hash_and_uses_name() {
        let dir = tempfile::tempdir().unwrap();
        let rom_path = dir.path().join("game.rom");
        std::fs::write(&rom_path, b"abc").unwrap();
        let games = vec![
            RaGameWire {
                id: 10,
                title: "Hash Victim".into(),
                num_achievements: 1,
                hashes: vec!["900150983cd24fb0d6963f7d28e17f72".into()],
            },
            RaGameWire {
                id: 20,
                title: "Name Victim".into(),
                num_achievements: 1,
                hashes: vec![],
            },
        ];
        // Console 2 is on the plugin's exclusion list → hash ignored.
        assert_eq!(
            pick_game_id(None, Some(2), &games, Some(rom_path.to_str().unwrap()), "Name Victim"),
            Ok(20)
        );
        // Console 7 is not excluded → hash match wins over the name.
        assert_eq!(
            pick_game_id(None, Some(7), &games, Some(rom_path.to_str().unwrap()), "Name Victim"),
            Ok(10)
        );
    }

    #[test]
    fn no_console_mapped_errors_clearly() {
        assert!(pick_game_id(None, None, &[], None, "Any").is_err());
    }

    // ── Settings round-trip ────────────────────────────────────────────

    #[test]
    fn settings_round_trip_camel_case() {
        let settings = RetroSettings {
            username: Some("player-one".into()),
            has_api_key: true,
            console_map: vec![RetroConsoleMapEntry {
                platform: "NES".into(),
                console_id: 7,
            }],
            enabled: true,
        };
        let json = serde_json::to_string(&settings).unwrap();
        assert!(json.contains("\"consoleMap\""));
        assert!(json.contains("\"hasApiKey\""));
        let back: RetroSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(back, settings);
    }

    // ── Canned API fixture parsing ─────────────────────────────────────

    const PROGRESS_FIXTURE: &str = r#"{
        "ID": 14402,
        "Title": "Super Mario Bros.",
        "ConsoleID": 7,
        "NumAchievements": 3,
        "NumDistinctPlayersCasual": 4031,
        "Achievements": {
            "2008": {
                "ID": 2008,
                "Title": "Big Bad Boss",
                "Description": "Defeat the final boss.",
                "Points": 5,
                "BadgeName": "12345",
                "NumAwarded": 1000,
                "DateEarned": "2021-04-01 00:00:00"
            },
            "2009": {
                "ID": 2009,
                "Title": "Speed Runner",
                "Description": "Finish in under an hour.",
                "Points": 10,
                "BadgeName": "12346",
                "NumAwarded": 0,
                "DateEarned": null
            },
            "2010": {
                "ID": 2010,
                "Title": "Hidden Secret",
                "Description": "Find the warp zone.",
                "Points": 3,
                "BadgeName": "12347",
                "NumAwarded": 4031,
                "DateEarned": ""
            }
        }
    }"#;

    #[test]
    fn progress_fixture_maps_to_achievement_data() {
        let wire: RaProgressWire = serde_json::from_str(PROGRESS_FIXTURE).unwrap();
        assert_eq!(wire.title, "Super Mario Bros.");
        assert_eq!(wire.achievements.len(), 3);

        let data = map_progress_to_data(14402, &wire);
        assert_eq!(data.steam_app_id, 0);
        assert_eq!(data.source, "retro");
        assert_eq!(data.provider_id.as_deref(), Some("14402"));
        assert_eq!(data.total, 3);
        assert_eq!(data.unlocked, 1);
        assert_eq!(data.locked, 2);
        assert!(data.last_synced.is_some());

        let earned = data
            .achievements
            .iter()
            .find(|a| a.api_name == "2008")
            .unwrap();
        assert!(earned.achieved);
        assert_eq!(earned.unlock_time, 1617235200); // 2021-04-01 00:00:00 UTC
        assert_eq!(earned.percent, 24.0); // 1000 * 100 / 4031 truncated
        assert_eq!(
            earned.icon,
            "https://s3-eu-west-1.amazonaws.com/i.retroachievements.org/Badge/12345.png"
        );
        assert_eq!(
            earned.icon_gray,
            "https://s3-eu-west-1.amazonaws.com/i.retroachievements.org/Badge/12345_lock.png"
        );

        // NumAwarded == 0 → plugin's 100 default.
        let unawarded = data
            .achievements
            .iter()
            .find(|a| a.api_name == "2009")
            .unwrap();
        assert!(!unawarded.achieved);
        assert_eq!(unawarded.percent, 100.0);

        // Empty-string DateEarned counts as locked.
        let hidden = data
            .achievements
            .iter()
            .find(|a| a.api_name == "2010")
            .unwrap();
        assert!(!hidden.achieved);
        assert_eq!(hidden.percent, 100.0);
    }

    #[test]
    fn console_list_fixture_parses() {
        let body = r#"[{"ID": 7, "Name": "NES"}, {"ID": 1, "Name": "Mega Drive"}]"#;
        let consoles: Vec<RaConsole> = serde_json::from_str(body).unwrap();
        assert_eq!(consoles.len(), 2);
        assert_eq!(consoles[0].id, 7);
        assert_eq!(consoles[0].name, "NES");
        // Serializes back as camelCase for the frontend.
        let json = serde_json::to_string(&consoles[0]).unwrap();
        assert_eq!(json, r#"{"id":7,"name":"NES"}"#);
    }

    #[test]
    fn game_list_fixture_parses_with_hashes() {
        let body = r#"[
            {"ID": 14402, "Title": "Super Mario Bros.", "NumAchievements": 20, "Hashes": ["aaa", "bbb"]},
            {"ID": 10392, "Title": "Zelda II - The Adventure of Link", "NumAchievements": 10, "Hashes": []}
        ]"#;
        let games: Vec<RaGameWire> = serde_json::from_str(body).unwrap();
        assert_eq!(games.len(), 2);
        assert_eq!(games[0].hashes, vec!["aaa".to_string(), "bbb".to_string()]);
        assert_eq!(games[1].num_achievements, 10);
        // Search results round-trip in camelCase.
        let result = RaSearchResult {
            id: games[0].id,
            title: games[0].title.clone(),
            num_achievements: games[0].num_achievements,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert_eq!(json, r#"{"id":14402,"title":"Super Mario Bros.","numAchievements":20}"#);
    }

    #[test]
    fn parse_ra_datetime_handles_garbage() {
        assert_eq!(parse_ra_datetime("2021-04-01 00:00:00"), Some(1617235200));
        assert_eq!(parse_ra_datetime("not a date"), None);
        assert_eq!(parse_ra_datetime(""), None);
    }
}
