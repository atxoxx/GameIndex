//! ROM management commands: filename identification, metadata scraping,
//! save-state / save-file management, per-ROM launch profiles, BIOS
//! detection, emulator & ROM-folder discovery, duplicate detection,
//! archive extraction, and emulator-config import/export.
//!
//! ROMs are ordinary `Game` rows (carrying `emulator_id` + `rom_path`),
//! so every command here reads/writes through the shared `games` DAO and
//! reuses the existing launch / session-tracking pipeline.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use regex::Regex;
use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::db;
use crate::emulator_install;
use crate::games::{GameData, RomProfile};

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ─── Filename parsing (No-Intro / GoodTools style) ──────────────────────────

/// Result of parsing a ROM's file stem into display + filter data.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ParsedRomName {
    /// Human-readable title with tags removed and separators cleaned
    /// (e.g. `Game.Name.(USA).(Rev 1)` → `Game Name`).
    pub clean_title: String,
    /// First recognised region tag (e.g. `USA`, `Europe`, `World`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub region: Option<String>,
    /// Comma-joined language tags (e.g. `En,Fr,De`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    /// Multi-disc group key (cleaned title) when a disc tag is present.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    /// 1-based disc index when a disc tag is present.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disc: Option<u32>,
}

/// Known No-Intro region tags (exact, case-insensitive). Tags like
/// `Rev 1` / `Beta` / `Demo` are recognised and dropped but not stored.
const REGION_TAGS: &[&str] = &[
    "USA", "Europe", "Japan", "World", "Asia", "Australia", "Korea",
    "Brazil", "China", "Taiwan", "Hong Kong", "Russia", "France",
    "Germany", "Spain", "Italy", "Netherlands", "Sweden", "Norway",
    "Denmark", "Finland", "Poland", "Portugal", "Mexico", "Canada",
    "India", "New Zealand", "PAL", "NTSC", "NTSC-U", "NTSC-J", "PAL-E",
];

/// ISO-639-1 style language codes used by No-Intro language tags.
const LANGUAGE_CODES: &[&str] = &[
    "En", "Fr", "De", "Es", "It", "Ja", "Ko", "Zh", "Pt", "Ru", "Nl",
    "Pl", "Sv", "No", "Da", "Fi", "Tr", "Cs", "Hu", "El", "Ar", "He",
    "Th", "Vi", "Id", "Sv", "Sk", "Ro", "Bg", "Uk",
];

fn tag_kind(tag: &str) -> (Option<String>, Option<String>, Option<u32>) {
    // Returns (region, language, disc) — at most one is Some.
    let t = tag.trim();
    if t.is_empty() {
        return (None, None, None);
    }
    let lower = t.to_lowercase();
    // Disc / Disk N
    if let Some(rest) = lower
        .strip_prefix("disc")
        .or_else(|| lower.strip_prefix("disk"))
    {
        let num: u32 = rest
            .trim()
            .trim_start_matches(|c: char| c == ' ' || c == '-' || c == '_' || c == '.')
            .trim()
            .parse()
            .unwrap_or(0);
        if num > 0 {
            return (None, None, Some(num));
        }
    }
    // Split multi-value tags like `En,Fr,De` or `USA,Europe`.
    let parts: Vec<&str> = t.split(',').map(|p| p.trim()).filter(|p| !p.is_empty()).collect();
    if parts.len() > 1 {
        // All parts are language codes → language tag.
        if parts.iter().all(|p| {
            LANGUAGE_CODES.iter().any(|l| l.eq_ignore_ascii_case(p))
        }) {
            let joined = parts.join(",");
            return (None, Some(joined), None);
        }
    }
    // Single value: language code, region, or ignorable version tag.
    if LANGUAGE_CODES.iter().any(|l| l.eq_ignore_ascii_case(t)) {
        return (None, Some(t.to_string()), None);
    }
    if REGION_TAGS.iter().any(|r| r.eq_ignore_ascii_case(t)) {
        return (Some(t.to_string()), None, None);
    }
    (None, None, None)
}

/// Parse a ROM file stem (name without extension) into display title +
/// region / language / disc metadata. Unknown tags (`Rev 1`, `Beta`,
/// `Demo`, …) are dropped from the cleaned title without being stored.
pub fn parse_rom_filename(stem: &str) -> ParsedRomName {
    // Split off every `(…)` / `[…]` tag.
    let tag_re = Regex::new(r"[\(\[][^\)\]]*[\)\]]").unwrap();
    let tags: Vec<String> = tag_re
        .find_iter(stem)
        .map(|m| {
            let raw = m.as_str();
            raw[1..raw.len() - 1].to_string()
        })
        .collect();

    let mut region: Option<String> = None;
    let mut languages: Vec<String> = Vec::new();
    let mut disc: Option<u32> = None;

    for raw in &tags {
        let (r, l, d) = tag_kind(raw);
        if let Some(r) = r {
            if region.is_none() {
                region = Some(r);
            }
        }
        if let Some(l) = l {
            for part in l.split(',') {
                if !languages.iter().any(|x| x.eq_ignore_ascii_case(part)) {
                    languages.push(part.to_string());
                }
            }
        }
        if let Some(d) = d {
            disc = Some(d);
        }
    }

    let clean = clean_rom_name(stem);
    let group = if disc.is_some() && !clean.is_empty() {
        Some(clean.clone())
    } else {
        None
    };

    ParsedRomName {
        clean_title: clean,
        region,
        language: if languages.is_empty() {
            None
        } else {
            Some(languages.join(","))
        },
        group,
        disc,
    }
}

/// Clean a ROM filename into a readable title: strip `(…)`/`[…]` tags,
/// convert dots/underscores to spaces, collapse whitespace, trim.
/// `Game.Name.(USA).Rev.1.iso` → `Game Name`.
pub fn clean_rom_name(name: &str) -> String {
    let tag_re = Regex::new(r"[\(\[][^\)\]]*[\)\]]").unwrap();
    let without_tags = tag_re.replace_all(name, " ");
    let normalized = without_tags.replace(['.', '_', '-'], " ");
    // Drop `Rev 1` / `Rev 1.1` / `Rev.1` tokens (unparenthesised in
    // some naming schemes) from the tail of the title.
    let words: Vec<String> = normalized
        .split_whitespace()
        .map(|w| w.to_string())
        .collect();
    let mut out: Vec<String> = Vec::new();
    let mut skip_next_numeric = false;
    for w in words {
        let wl = w.to_lowercase();
        let is_rev = wl == "rev"
            || (wl.starts_with("rev")
                && wl.len() > 3
                && wl[3..].chars().all(|c| c.is_ascii_digit() || c == '.'));
        let is_numeric = !w.is_empty() && w.chars().all(|c| c.is_ascii_digit() || c == '.');
        if is_rev {
            skip_next_numeric = true;
            continue;
        }
        if skip_next_numeric && is_numeric {
            skip_next_numeric = false;
            continue;
        }
        skip_next_numeric = false;
        out.push(w);
    }
    out.join(" ")
}

// ─── Quick file hashing (CRC32) ─────────────────────────────────────────────

fn crc32_table() -> [u32; 256] {
    let mut table = [0u32; 256];
    for (i, entry) in table.iter_mut().enumerate() {
        let mut c = i as u32;
        for _ in 0..8 {
            c = if c & 1 != 0 { 0xEDB88320 ^ (c >> 1) } else { c >> 1 };
        }
        *entry = c;
    }
    table
}

/// Stream a file in chunks and return its CRC32 as 8 lowercase hex
/// chars. Cheap enough for multi-GB ISOs (disk-bound) and identical for
/// byte-identical files, which is all duplicate detection needs.
pub fn crc32_file(path: &Path) -> std::io::Result<String> {
    use std::io::Read;
    let table = crc32_table();
    let mut file = std::fs::File::open(path)?;
    let mut crc: u32 = 0xFFFF_FFFF;
    let mut buf = [0u8; 1024 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        for b in &buf[..n] {
            crc = table[((crc ^ *b as u32) & 0xFF) as usize] ^ (crc >> 8);
        }
    }
    Ok(format!("{:08x}", !crc))
}

/// Compute (and persist) a ROM's hash when missing. Returns the hash.
fn ensure_rom_hash(db_state: &db::Db, game: &GameData) -> Result<Option<String>, String> {
    if let Some(h) = &game.rom_hash {
        return Ok(Some(h.clone()));
    }
    let rom_path = game.rom_path.clone().ok_or("ROM has no file path")?;
    let hash = crc32_file(Path::new(&rom_path))
        .map_err(|e| format!("hash failed for {}: {e}", rom_path))?;
    let mut updated = game.clone();
    updated.rom_hash = Some(hash.clone());
    persist_game(db_state, &updated)?;
    Ok(Some(hash))
}

fn persist_game(db_state: &db::Db, game: &GameData) -> Result<(), String> {
    let value = serde_json::to_value(game).map_err(|e| format!("to_value: {e}"))?;
    let row: db::games::GameRow =
        serde_json::from_value(value).map_err(|e| format!("to GameRow: {e}"))?;
    db::games::upsert_one(db_state, &row)
}

fn load_game(db_state: &db::Db, game_id: &str) -> Result<GameData, String> {
    let row = db::games::get(db_state, game_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("ROM not found: {game_id}"))?;
    let value = serde_json::to_value(&row).map_err(|e| format!("to_value: {e}"))?;
    serde_json::from_value(value).map_err(|e| format!("from_value: {e}"))
}

// ─── Command: identify & clean names ────────────────────────────────────────

/// Identify a ROM from its filename: cleaned title, region, language,
/// multi-disc group + disc index.
#[tauri::command]
pub fn rom_identify(app: tauri::AppHandle, game_id: String) -> Result<ParsedRomName, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let game = load_game(db_state.inner(), &game_id)?;
    let stem = game
        .rom_path
        .as_deref()
        .and_then(|p| Path::new(p).file_stem())
        .and_then(|s| s.to_str())
        .unwrap_or(game.name.as_str());
    Ok(parse_rom_filename(stem))
}

/// Clean a raw filename into a readable title (pure helper used by the
/// rename input and the QoL name-cleanup action).
#[tauri::command]
pub fn rom_clean_name(name: String) -> Result<String, String> {
    Ok(clean_rom_name(&name))
}

// ─── Command: metadata scraping ─────────────────────────────────────────────

/// A single scraped-metadata candidate for a ROM (subsets the richer
/// `GameMetadataResult` so the frontend list stays light).
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RomMetadataCandidate {
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub developer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub publisher: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_date: Option<String>,
    pub genres: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub igdb_id: Option<u64>,
}

/// Search IGDB for a ROM by its cleaned filename. Returns candidate
/// titles the user can pick from (then apply via `rom_apply_metadata`).
#[tauri::command]
pub async fn rom_scrape_metadata(
    app: tauri::AppHandle,
    game_id: String,
) -> Result<Vec<RomMetadataCandidate>, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let game = load_game(db_state.inner(), &game_id)?;
    let search_term = game
        .rom_path
        .as_deref()
        .and_then(|p| Path::new(p).file_stem())
        .and_then(|s| s.to_str())
        .map(clean_rom_name)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| game.name.clone());
    if search_term.trim().is_empty() {
        return Ok(Vec::new());
    }
    let results = crate::game_scraper::search_igdb(&search_term).await;
    Ok(results
        .into_iter()
        .take(10)
        .map(|r| RomMetadataCandidate {
            title: r.title,
            description: r.description,
            developer: r.developer,
            publisher: r.publisher,
            release_date: r.release_date,
            genres: r.genres,
            cover_url: r.images.cover,
            source_url: Some(r.source_url),
            source_name: Some(r.source_name),
            igdb_id: r.igdb_id,
        })
        .collect())
}

/// Metadata patch applied to a ROM (manual corrections + scraped
/// fields). Every field optional; `None` leaves the existing value.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct RomMetadataPatch {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_art_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub developer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub publisher: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub genres: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub screenshots: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub region: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
}

/// Apply a metadata patch to a ROM row and persist it. Rows touched by
/// this command carry `metadata_source == "manual"` so re-scans keep the
/// corrected values.
#[tauri::command]
pub fn rom_apply_metadata(
    app: tauri::AppHandle,
    game_id: String,
    patch: RomMetadataPatch,
) -> Result<GameData, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let mut game = load_game(db_state.inner(), &game_id)?;
    if let Some(v) = patch.name {
        if !v.trim().is_empty() {
            game.name = v.trim().to_string();
        }
    }
    if let Some(v) = patch.cover_art_url {
        if !v.trim().is_empty() {
            game.cover_art_url = Some(v.trim().to_string());
        }
    }
    if let Some(v) = patch.description {
        game.description = Some(v);
    }
    if let Some(v) = patch.developer {
        game.developer = Some(v);
    }
    if let Some(v) = patch.publisher {
        game.publisher = Some(v);
    }
    if let Some(v) = patch.release_date {
        game.release_date = Some(v);
    }
    if let Some(v) = patch.genres {
        game.genres = Some(v);
    }
    if let Some(v) = patch.screenshots {
        game.screenshots = Some(v);
    }
    if let Some(v) = patch.region {
        game.rom_region = Some(v);
    }
    if let Some(v) = patch.language {
        game.rom_language = Some(v);
    }
    game.metadata_source = Some("manual".to_string());
    persist_game(db_state.inner(), &game)?;
    Ok(game)
}

// ─── Command: save-state / save-file management ─────────────────────────────

/// One save file found for a ROM (matched by filename stem inside the
/// emulator's saves folder).
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RomSaveEntry {
    /// Absolute path of the save file.
    pub path: String,
    /// File name.
    pub name: String,
    /// Path relative to the saves folder.
    pub relative_path: String,
    pub size_bytes: u64,
    pub modified_at_ms: u64,
    /// True when a copy of this file exists in the backup area.
    pub backed_up: bool,
}

/// Snapshot of a ROM's saves stored under the app-data backup area.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SaveSnapshot {
    pub name: String,
    pub created_at_ms: u64,
    pub file_count: u32,
    pub size_bytes: u64,
}

/// Backup health summary shown before launching (outdated-backup warn).
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RomSavesStatus {
    pub saves_configured: bool,
    pub saves_folder: Option<String>,
    pub has_saves: bool,
    pub save_count: u32,
    /// Max modified-at across the ROM's save files.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_save_mtime: Option<u64>,
    /// Max created-at across snapshots.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_backup_mtime: Option<u64>,
    /// True when save files are newer than the newest backup.
    pub outdated: bool,
}

fn saves_backup_root(app: &tauri::AppHandle, game_id: &str) -> Result<PathBuf, String> {
    let data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir: {e}"))?;
    Ok(data.join("rom-backups").join(sanitize_component(game_id)))
}

fn sanitize_component(s: &str) -> String {
    let cleaned: String = s
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' || c == '.' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if cleaned.is_empty() {
        "rom".to_string()
    } else {
        cleaned
    }
}

/// Resolve the saves folder for a ROM's emulator (configured value).
fn saves_folder_for(db_state: &db::Db, game: &GameData) -> Result<Option<String>, String> {
    let Some(emu_id) = game.emulator_id.as_deref() else {
        return Ok(None);
    };
    let emu = db::emulators::get(db_state, emu_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Emulator not found: {emu_id}"))?;
    let folder = emu.saves_folder.unwrap_or_default();
    if folder.trim().is_empty() {
        Ok(None)
    } else {
        Ok(Some(folder))
    }
}

/// Collect save files for a ROM inside `saves_folder`: files whose stem
/// matches the ROM's stem (case-insensitive), recursively (2 levels).
fn collect_save_files(saves_folder: &str, game: &GameData) -> Vec<RomSaveEntry> {
    let root = PathBuf::from(saves_folder);
    if !root.is_dir() {
        return Vec::new();
    }
    let rom_stem = game
        .rom_path
        .as_deref()
        .and_then(|p| Path::new(p).file_stem())
        .and_then(|s| s.to_str())
        .map(|s| s.to_lowercase());
    let name_stem = game.name.to_lowercase();
    let Some(match_stem) = rom_stem.or(Some(name_stem)) else {
        return Vec::new();
    };

    let mut out = Vec::new();
    fn walk(dir: &Path, depth: usize, match_stem: &str, saves_root: &str, out: &mut Vec<RomSaveEntry>) {
        if depth > 2 {
            return;
        }
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(&path, depth + 1, match_stem, saves_root, out);
                continue;
            }
            let Some(name) = entry.file_name().to_str().map(|s| s.to_string()) else {
                continue;
            };
            let lower = name.to_lowercase();
            let stem_matches = Path::new(&name)
                .file_stem()
                .map(|s| s.to_str().unwrap_or("").to_lowercase() == match_stem)
                .unwrap_or(false)
                || lower == match_stem;
            // Save files usually share the ROM stem exactly, but some
            // emulators append suffixes / Disc tags.
            let stem_similar = lower.starts_with(match_stem);
            if !stem_matches && !stem_similar {
                continue;
            }
            let meta = std::fs::metadata(&path).ok();
            let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
            let modified = meta
                .as_ref()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            let rel = path
                .strip_prefix(saves_root)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_else(|_| name.clone());
            out.push(RomSaveEntry {
                path: path.to_string_lossy().to_string(),
                name,
                relative_path: rel,
                size_bytes: size,
                modified_at_ms: modified,
                backed_up: false,
            });
        }
    }
    walk(&root, 0, &match_stem, saves_folder, &mut out);
    out.sort_by(|a, b| b.modified_at_ms.cmp(&a.modified_at_ms));
    out
}

/// List the save files currently found for a ROM (from the emulator's
/// configured saves folder).
#[tauri::command]
pub fn rom_saves_list(app: tauri::AppHandle, game_id: String) -> Result<Vec<RomSaveEntry>, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let game = load_game(db_state.inner(), &game_id)?;
    let Some(folder) = saves_folder_for(db_state.inner(), &game)? else {
        return Ok(Vec::new());
    };
    let mut entries = collect_save_files(&folder, &game);
    // Mark files already backed up in the latest snapshot.
    let backup_root = saves_backup_root(&app, &game_id)?;
    let snapshots = list_snapshots_inner(&backup_root);
    let newest = snapshots.into_iter().max_by_key(|s| s.created_at_ms);
    if let Some(snap) = newest {
        let snap_dir = backup_root.join(sanitize_component(&snap.name));
        for e in &mut entries {
            let backed = snap_dir
                .join(&e.relative_path)
                .is_file()
                || snap_dir
                    .join(Path::new(&e.name).file_name().unwrap_or_default())
                    .is_file();
            e.backed_up = backed;
        }
    }
    Ok(entries)
}

/// Backup-health summary: newest save mtime vs newest snapshot mtime.
#[tauri::command]
pub fn rom_saves_status(
    app: tauri::AppHandle,
    game_id: String,
) -> Result<RomSavesStatus, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let game = load_game(db_state.inner(), &game_id)?;
    let folder = saves_folder_for(db_state.inner(), &game)?;
    let entries = folder
        .as_deref()
        .map(|f| collect_save_files(f, &game))
        .unwrap_or_default();
    let last_save = entries.iter().map(|e| e.modified_at_ms).max();
    let backup_root = saves_backup_root(&app, &game_id)?;
    let snapshots = list_snapshots_inner(&backup_root);
    let last_backup = snapshots.iter().map(|s| s.created_at_ms).max();
    let outdated = match (last_save, last_backup) {
        (Some(save), Some(backup)) => save > backup,
        (Some(_), None) => true,
        _ => false,
    };
    Ok(RomSavesStatus {
        saves_configured: folder.is_some(),
        saves_folder: folder,
        has_saves: !entries.is_empty(),
        save_count: entries.len() as u32,
        last_save_mtime: last_save,
        last_backup_mtime: last_backup,
        outdated,
    })
}

fn list_snapshots_inner(root: &Path) -> Vec<SaveSnapshot> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(name) = entry.file_name().to_str().map(|s| s.to_string()) else {
            continue;
        };
        let meta = std::fs::metadata(&path).ok();
        let created = meta
            .as_ref()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let (file_count, size_bytes) = snapshot_stats(&path);
        out.push(SaveSnapshot {
            name,
            created_at_ms: created,
            file_count,
            size_bytes,
        });
    }
    out.sort_by(|a, b| b.created_at_ms.cmp(&a.created_at_ms));
    out
}

fn snapshot_stats(dir: &Path) -> (u32, u64) {
    let mut files = 0u32;
    let mut bytes = 0u64;
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&d) else {
            continue;
        };
        for e in entries.flatten() {
            let p = e.path();
            if p.is_dir() {
                stack.push(p);
            } else if let Ok(m) = std::fs::metadata(&p) {
                files += 1;
                bytes += m.len();
            }
        }
    }
    (files, bytes)
}

/// Create a snapshot of the ROM's current save files. `name` is a
/// user-chosen label (defaults to a timestamp when empty). Returns the
/// number of files backed up.
#[tauri::command]
pub fn rom_saves_backup(
    app: tauri::AppHandle,
    game_id: String,
    name: Option<String>,
) -> Result<u32, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let game = load_game(db_state.inner(), &game_id)?;
    let Some(folder) = saves_folder_for(db_state.inner(), &game)? else {
        return Err("No saves folder configured for this emulator".into());
    };
    let entries = collect_save_files(&folder, &game);
    if entries.is_empty() {
        return Err("No save files found for this ROM".into());
    }
    let label = name
        .filter(|n| !n.trim().is_empty())
        .map(|n| sanitize_component(&n))
        .unwrap_or_else(|| format!("auto-{}", now_ms()));
    let backup_root = saves_backup_root(&app, &game_id)?;
    let snap_dir = backup_root.join(&label);
    std::fs::create_dir_all(&snap_dir).map_err(|e| format!("backup mkdir: {e}"))?;
    let mut count = 0u32;
    for e in &entries {
        let target = snap_dir.join(&e.relative_path);
        if let Some(parent) = target.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if std::fs::copy(&e.path, &target).is_ok() {
            count += 1;
        }
    }
    Ok(count)
}

/// List named save snapshots for a ROM.
#[tauri::command]
pub fn rom_saves_snapshots(
    app: tauri::AppHandle,
    game_id: String,
) -> Result<Vec<SaveSnapshot>, String> {
    let backup_root = saves_backup_root(&app, &game_id)?;
    Ok(list_snapshots_inner(&backup_root))
}

/// Restore a snapshot: copy its files back over the current save files
/// (original locations are reconstructed from the relative paths).
#[tauri::command]
pub fn rom_saves_restore(
    app: tauri::AppHandle,
    game_id: String,
    name: String,
) -> Result<u32, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let game = load_game(db_state.inner(), &game_id)?;
    let Some(folder) = saves_folder_for(db_state.inner(), &game)? else {
        return Err("No saves folder configured for this emulator".into());
    };
    let label = sanitize_component(&name);
    let backup_root = saves_backup_root(&app, &game_id)?;
    let snap_dir = backup_root.join(&label);
    if !snap_dir.is_dir() {
        return Err(format!("Snapshot not found: {name}"));
    }
    let saves_root = PathBuf::from(&folder);
    let mut restored = 0u32;
    let mut stack = vec![snap_dir.clone()];
    while let Some(d) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&d) else {
            continue;
        };
        for e in entries.flatten() {
            let p = e.path();
            if p.is_dir() {
                stack.push(p);
            } else {
                let rel = p
                    .strip_prefix(&snap_dir)
                    .map(|r| r.to_path_buf())
                    .unwrap_or_else(|_| {
                        p.file_name().map(PathBuf::from).unwrap_or_default()
                    });
                let target = saves_root.join(&rel);
                if let Some(parent) = target.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                if std::fs::copy(&p, &target).is_ok() {
                    restored += 1;
                }
            }
        }
    }
    Ok(restored)
}

/// Delete a named save snapshot.
#[tauri::command]
pub fn rom_saves_delete(
    app: tauri::AppHandle,
    game_id: String,
    name: String,
) -> Result<(), String> {
    let backup_root = saves_backup_root(&app, &game_id)?;
    let snap_dir = backup_root.join(sanitize_component(&name));
    if !snap_dir.is_dir() {
        return Err(format!("Snapshot not found: {name}"));
    }
    std::fs::remove_dir_all(&snap_dir).map_err(|e| format!("delete snapshot: {e}"))
}

// ─── Command: per-ROM launch profiles ───────────────────────────────────────

/// Read a ROM's stored launch profile (None when unset).
#[tauri::command]
pub fn rom_profile_get(app: tauri::AppHandle, game_id: String) -> Result<Option<RomProfile>, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let game = load_game(db_state.inner(), &game_id)?;
    Ok(game.rom_profile)
}

/// Save (or clear, when empty) a ROM's launch profile. Returns the
/// updated game row.
#[tauri::command]
pub fn rom_profile_save(
    app: tauri::AppHandle,
    game_id: String,
    profile: RomProfile,
) -> Result<GameData, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let mut game = load_game(db_state.inner(), &game_id)?;
    let empty = profile == RomProfile::default();
    game.rom_profile = if empty { None } else { Some(profile) };
    persist_game(db_state.inner(), &game)?;
    Ok(game)
}

/// Final launch plan for a ROM: the executable to spawn, the argument
/// string, extra env vars, and the effective ROM path (post-extraction
/// for archives). The frontend passes these into `launch_game`.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RomLaunchPlan {
    pub executable_path: String,
    pub arguments: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env_vars: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extracted_rom_path: Option<String>,
    /// Save-backup health (warn before launch when outdated).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub saves_status: Option<RomSavesStatus>,
}

/// Compute the launch plan for a ROM: resolves the effective ROM path
/// (extracting archives into the managed cache), merges the per-ROM
/// profile's argument override, and reports save-backup health.
#[tauri::command]
pub async fn rom_launch_plan(
    app: tauri::AppHandle,
    game_id: String,
) -> Result<RomLaunchPlan, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let game = load_game(db_state.inner(), &game_id)?;
    let emu_id = game
        .emulator_id
        .clone()
        .ok_or("Game is not a ROM (no emulator linkage)")?;
    let emu = db::emulators::get(db_state.inner(), &emu_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Emulator not found: {emu_id}"))?;

    let mut effective_rom = game
        .rom_path
        .clone()
        .ok_or("ROM has no file path")?;
    let mut extracted: Option<String> = None;
    if game.rom_archived.unwrap_or(false) {
        let app_data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("app data dir: {e}"))?;
        let emu_id_for_extract = emu_id.clone();
        let game_id_for_extract = game_id.clone();
        let rom_for_extract = effective_rom.clone();
        let path = tokio::task::spawn_blocking(move || {
            extract_rom_archive(
                &app_data_dir,
                &emu_id_for_extract,
                &game_id_for_extract,
                &rom_for_extract,
            )
        })
        .await
        .map_err(|e| format!("extract task: {e}"))??;
        effective_rom = path;
        extracted = Some(effective_rom.clone());
    }

    let profile = game.rom_profile.clone().unwrap_or_default();
    let args = match profile.arguments_override.clone() {
        Some(override_args) if !override_args.trim().is_empty() => {
            if override_args.contains("%ROM%") {
                override_args.replace("%ROM%", &effective_rom)
            } else {
                override_args
            }
        }
        _ => {
            let base = game
                .launch_arguments
                .clone()
                .unwrap_or_else(|| emu.arguments_template.clone());
            if base.contains("%ROM%") {
                base.replace("%ROM%", &effective_rom)
            } else if let Some(orig) = game.rom_path.as_deref() {
                // Scan-time baked args already carry the archive path;
                // swap in the extracted path when it changed.
                base.replace(orig, &effective_rom)
            } else {
                base
            }
        }
    };

    let saves_status = rom_saves_status(app, game_id.clone()).ok();

    Ok(RomLaunchPlan {
        executable_path: emu.executable_path,
        arguments: args,
        env_vars: profile.env_vars,
        extracted_rom_path: extracted,
        saves_status,
    })
}

// ─── Command: BIOS / firmware detection ─────────────────────────────────────

/// A BIOS/firmware file an emulator platform expects.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BiosRequirement {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Expected SHA-1 of a known-good dump (validated when present).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_sha1: Option<String>,
    /// Whether the platform refuses to run without it.
    pub mandatory: bool,
}

/// Per-file BIOS check result.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BiosStatus {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// True when the file was found in the BIOS folder (size > 0).
    pub found: bool,
    /// Found file path (when `found`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// True when a known-good SHA-1 is expected AND matches.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hash_ok: Option<bool>,
    pub mandatory: bool,
}

/// Full BIOS check for an emulator's platform.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BiosCheckResult {
    pub platform: String,
    pub bios_folder: Option<String>,
    pub configured: bool,
    pub requirements: Vec<BiosStatus>,
    pub missing: Vec<String>,
}

/// Curated BIOS requirements per platform. Only file NAMES + the
/// well-known PS1 dumps' SHA-1s are shipped — never the firmware itself.
fn bios_requirements(platform: &str) -> Vec<BiosRequirement> {
    let table: &[(&str, &[(&str, Option<&str>, bool)])] = &[
        (
            "PlayStation",
            &[
                ("scph5500.bin", Some("PS1 NTSC-J BIOS"), true),
                ("scph5501.bin", Some("PS1 NTSC-U/C BIOS"), true),
                ("scph5502.bin", Some("PS1 PAL BIOS"), true),
            ],
        ),
        (
            "PlayStation 2",
            &[
                ("scph39001.bin", Some("PS2 NTSC-U/C BIOS"), true),
                ("scph70012.bin", Some("PS2 NTSC-U/C slim BIOS"), true),
                ("scph77001.bin", Some("PS2 NTSC-U/C slim BIOS"), true),
                ("scph90000.bin", Some("PS2 NTSC-U/C slim BIOS"), true),
            ],
        ),
        (
            "Game Boy",
            &[("gb_bios.bin", Some("Game Boy boot ROM"), false)],
        ),
        (
            "Game Boy Color",
            &[("gbc_bios.bin", Some("Game Boy Color boot ROM"), false)],
        ),
        (
            "Game Boy Advance",
            &[("gba_bios.bin", Some("GBA boot ROM"), false)],
        ),
        (
            "Nintendo DS",
            &[
                ("bios7.bin", Some("ARM7 BIOS"), false),
                ("bios9.bin", Some("ARM9 BIOS"), false),
                ("firmware.bin", Some("NDS firmware"), false),
            ],
        ),
        (
            "Sega Saturn",
            &[
                ("sega_1003.bin", Some("Saturn JP BIOS"), true),
                ("sega_100a.bin", Some("Saturn US BIOS"), true),
                ("sega_101.bin", Some("Saturn EU BIOS"), true),
            ],
        ),
        (
            "Sega Dreamcast",
            &[
                ("dc_boot.bin", Some("Dreamcast boot ROM"), true),
                ("dc_flash.bin", Some("Dreamcast flash ROM"), true),
            ],
        ),
        (
            "Xbox",
            &[
                ("mcpx_1.0.bin", Some("MCPX boot ROM"), true),
                ("xbox-1.0.bin", Some("Xbox kernel (v1.0)"), true),
            ],
        ),
        (
            "PlayStation 3",
            &[("PS3UPDAT.PUP", Some("RPCS3 firmware"), true)],
        ),
        (
            "Neo Geo",
            &[("neogeo.zip", Some("Neo Geo MVS BIOS set"), true)],
        ),
    ];
    for (name, reqs) in table {
        if name.eq_ignore_ascii_case(platform) {
            let mut out: Vec<BiosRequirement> = reqs
                .iter()
                .map(|(n, desc, mandatory)| BiosRequirement {
                    name: n.to_string(),
                    description: desc.map(|s| s.to_string()),
                    expected_sha1: None,
                    mandatory: *mandatory,
                })
                .collect();
            // Well-known PS1 BIOS SHA-1s (RetroArch BIOS list).
            if name.eq_ignore_ascii_case("PlayStation") {
                let sha1s = [
                    "8dd7d5296a650fac7319bce665a6a53c09a8cc19", // scph5500
                    "490f666e1afb15b7362b406ed1cea246abae502b", // scph5501
                    "32736f17079d0b2b7024407c39bd3050e2b9e7b8", // scph5502
                ];
                for (req, sha) in out.iter_mut().zip(sha1s.iter()) {
                    req.expected_sha1 = Some(sha.to_string());
                }
            }
            return out;
        }
    }
    Vec::new()
}

/// The BIOS requirements for a platform (UI reference; no file contents).
#[tauri::command]
pub fn bios_requirements_list(platform: String) -> Result<Vec<BiosRequirement>, String> {
    Ok(bios_requirements(&platform))
}

/// Check which required BIOS files are present (and hash-valid where a
/// known-good SHA-1 exists) in the emulator's configured BIOS folder.
#[tauri::command]
pub fn check_bios_status(app: tauri::AppHandle, emulator_id: String) -> Result<BiosCheckResult, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let emu = db::emulators::get(db_state.inner(), &emulator_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Emulator not found: {emulator_id}"))?;

    let reqs = bios_requirements(&emu.platform);
    let folder = emu.bios_folder.filter(|f| !f.trim().is_empty());
    let configured = folder.is_some();

    let mut statuses: Vec<BiosStatus> = Vec::new();
    let mut missing: Vec<String> = Vec::new();
    for req in reqs {
        let mut found = false;
        let mut found_path: Option<String> = None;
        let mut hash_ok: Option<bool> = None;
        if let Some(f) = &folder {
            if let Some(hit) = find_bios_file(Path::new(f), &req.name) {
                let meta = std::fs::metadata(&hit).ok();
                found = meta.map(|m| m.len() > 0).unwrap_or(false);
                found_path = Some(hit.to_string_lossy().to_string());
                if let Some(expected) = &req.expected_sha1 {
                    let actual = sha1_file(&hit);
                    hash_ok = Some(actual.as_deref() == Some(expected.as_str()));
                }
            }
        }
        if !found {
            missing.push(req.name.clone());
        }
        statuses.push(BiosStatus {
            name: req.name,
            description: req.description,
            found,
            path: found_path,
            hash_ok,
            mandatory: req.mandatory,
        });
    }
    Ok(BiosCheckResult {
        platform: emu.platform,
        bios_folder: folder,
        configured,
        requirements: statuses,
        missing,
    })
}

/// Case-insensitive recursive lookup of a BIOS file name in a folder
/// (2 levels deep — BIOS folders are usually flat).
fn find_bios_file(root: &Path, target: &str) -> Option<PathBuf> {
    let target_lower = target.to_lowercase();
    fn walk(dir: &Path, target_lower: &str, depth: usize) -> Option<PathBuf> {
        if depth > 2 {
            return None;
        }
        let entries = std::fs::read_dir(dir).ok()?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if let Some(hit) = walk(&path, target_lower, depth + 1) {
                    return Some(hit);
                }
            } else if path
                .file_name()
                .map(|n| n.to_string_lossy().to_lowercase() == target_lower)
                .unwrap_or(false)
            {
                return Some(path);
            }
        }
        None
    }
    walk(root, &target_lower, 0)
}

/// SHA-1 of a file, hex lowercase (for BIOS validation).
fn sha1_file(path: &Path) -> Option<String> {
    use sha1::{Digest, Sha1};
    let mut file = std::fs::File::open(path).ok()?;
    let mut hasher = Sha1::new();
    let mut buf = [0u8; 1024 * 1024];
    loop {
        use std::io::Read;
        let n = file.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Some(format!("{:x}", hasher.finalize()))
}

// ─── Command: emulator & ROM-folder discovery ───────────────────────────────

/// A discovered emulator executable on disk.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredEmulator {
    /// Matches `KnownEmulator.key` in the frontend catalog.
    pub key: String,
    pub name: String,
    pub platform: String,
    pub executable_path: String,
    pub executable_name: String,
}

/// Extra known emulator executables not present in the download catalog
/// (still worth detecting on disk).
const EXTRA_KNOWN_EXES: &[(&str, &str, &str, &str)] = &[
    ("project64", "Project64", "Nintendo 64", "Project64.exe"),
    ("demul", "Demul", "Sega Dreamcast", "demul.exe"),
    ("kronos", "Kronos", "Sega Saturn", "kronos.exe"),
    ("kega-fusion", "Kega Fusion", "Sega Genesis", "Fusion.exe"),
    ("mame", "MAME", "Arcade", "mame.exe"),
    ("ryujinx", "Ryujinx", "Nintendo Switch", "Ryujinx.exe"),
    ("yuzu", "Yuzu", "Nintendo Switch", "yuzu.exe"),
    ("citra", "Citra", "Nintendo 3DS", "citra.exe"),
    ("mednafen", "Mednafen", "Multi-system", "mednafen.exe"),
    ("kega-fusion", "Kega Fusion", "Sega Genesis", "fusion.exe"),
    ("bizhawk", "BizHawk", "Arcade", "EmuHawk.exe"),
    ("ares", "ares", "Multi-system", "ares.exe"),
];

fn known_exe_map() -> Vec<(String, &'static str, &'static str, &'static str)> {
    // (lowercase exe name, key, name, platform)
    let mut out: Vec<(String, &'static str, &'static str, &'static str)> = Vec::new();
    for entry in emulator_install::all_catalog_entries() {
        out.push((
            entry.exe_name.to_lowercase(),
            entry.key,
            // Catalog keys are the stable identity; names come from the
            // frontend catalog, but keep a readable fallback here.
            entry.key,
            "",
        ));
    }
    for (key, name, platform, exe) in EXTRA_KNOWN_EXES {
        out.push((exe.to_lowercase(), key, name, platform));
    }
    out
}

/// Candidate root folders to scan for emulator executables.
fn discovery_roots() -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    for var in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA", "USERPROFILE", "ProgramData", "HOME"] {
        if let Ok(v) = std::env::var(var) {
            let p = PathBuf::from(&v);
            if p.is_dir() {
                roots.push(p.clone());
                if var == "LOCALAPPDATA" || var == "USERPROFILE" || var == "HOME" {
                    roots.push(p.join("Programs"));
                    roots.push(p.join("Emulation"));
                    roots.push(p.join("Emulators"));
                    roots.push(p.join("RetroArch-Win64"));
                }
            }
        }
    }
    roots
}

/// Scan common install folders for known emulator executables. Depth
/// limited (3 levels) so the scan stays fast on big Program Files trees.
#[tauri::command]
pub async fn discover_emulators() -> Result<Vec<DiscoveredEmulator>, String> {
    tokio::task::spawn_blocking(|| {
        let known = known_exe_map();
        let mut found: Vec<DiscoveredEmulator> = Vec::new();
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
        for root in discovery_roots() {
            walk_for_exes(&root, &known, 0, &mut seen, &mut found);
        }
        found.sort_by(|a, b| a.name.cmp(&b.name));
        found.dedup_by(|a, b| a.executable_path == b.executable_path);
        Ok(found)
    })
    .await
    .map_err(|e| format!("discover task: {e}"))?
}

fn walk_for_exes(
    dir: &Path,
    known: &[(String, &'static str, &'static str, &'static str)],
    depth: usize,
    seen: &mut std::collections::HashSet<String>,
    out: &mut Vec<DiscoveredEmulator>,
) {
    if depth > 3 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_lowercase();
        if name.starts_with('.') || name.starts_with("__macosx") {
            continue;
        }
        if name == "windows" || name == "system32" || name == "syswow64" || name == "node_modules" {
            continue;
        }
        let Ok(ft) = entry.file_type() else {
            continue;
        };
        if ft.is_dir() {
            walk_for_exes(&path, known, depth + 1, seen, out);
            continue;
        }
        if !name.ends_with(".exe") {
            continue;
        }
        for (exe_lower, key, display, platform) in known {
            if name == *exe_lower {
                let abs = path.to_string_lossy().to_string();
                if seen.insert(abs.clone()) {
                    out.push(DiscoveredEmulator {
                        key: key.to_string(),
                        name: if display.is_empty() {
                            key.to_string()
                        } else {
                            display.to_string()
                        },
                        platform: platform.to_string(),
                        executable_path: abs,
                        executable_name: path
                            .file_name()
                            .map(|f| f.to_string_lossy().to_string())
                            .unwrap_or_default(),
                    });
                }
                break;
            }
        }
    }
}

/// Suggest existing ROM folders near a configured emulator (sibling
/// `roms` dirs + common user locations). The frontend offers these as
/// one-click imports.
#[tauri::command]
pub fn discover_rom_folders(app: tauri::AppHandle, emulator_id: String) -> Result<Vec<String>, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let emu = db::emulators::get(db_state.inner(), &emulator_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Emulator not found: {emulator_id}"))?;

    let mut candidates: Vec<PathBuf> = Vec::new();
    let exe_dir = Path::new(&emu.executable_path)
        .parent()
        .map(|p| p.to_path_buf());
    if let Some(exe_dir) = &exe_dir {
        for name in [
            "roms", "ROMs", "games", "Games", "saves", "Saves",
            "roms/games", "roms/ROMS",
        ] {
            let mut p = exe_dir.clone();
            for part in name.split('/') {
                p.push(part);
            }
            candidates.push(p);
            // One level up: <install>/../roms
            if let Some(parent) = exe_dir.parent() {
                let mut up = parent.to_path_buf();
                for part in name.split('/') {
                    up.push(part);
                }
                candidates.push(up);
            }
        }
    }
    if !emu.rom_folder.trim().is_empty() {
        let rf = Path::new(&emu.rom_folder);
        if let Some(parent) = rf.parent() {
            candidates.push(parent.join("roms"));
            candidates.push(parent.join("ROMs"));
        }
    }
    if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
        let home = PathBuf::from(home);
        candidates.push(home.join("ROMs"));
        candidates.push(home.join("Emulation").join("roms"));
        candidates.push(home.join("Emulation").join("roms").join(&emu.platform));
        candidates.push(home.join("Documents").join("ROMs"));
    }

    let mut out: Vec<String> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    for c in candidates {
        if c.is_dir() {
            let s = c.to_string_lossy().to_string();
            if seen.insert(s.clone()) {
                out.push(s);
            }
        }
    }
    out.sort();
    Ok(out)
}

// ─── Command: duplicate detection ───────────────────────────────────────────

/// A group of ROMs sharing the same file hash.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateGroup {
    pub hash: String,
    pub size_bytes: u64,
    pub games: Vec<GameData>,
}

/// Find duplicate ROMs by file hash. ROMs without a stored hash are
/// hashed on demand (CRC32, streaming) and the hash is persisted, so a
/// second call is instant. Optionally scoped to one emulator.
#[tauri::command]
pub async fn find_duplicate_roms(
    app: tauri::AppHandle,
    emulator_id: Option<String>,
) -> Result<Vec<DuplicateGroup>, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let rows = db::games::list_all(db_state.inner()).map_err(|e| e.to_string())?;
    let games: Vec<GameData> = rows
        .into_iter()
        .filter_map(|row| {
            if row.emulator_id.is_none() {
                return None;
            }
            if let Some(filter) = &emulator_id {
                if row.emulator_id.as_deref() != Some(filter.as_str()) {
                    return None;
                }
            }
            let value = serde_json::to_value(&row).ok()?;
            serde_json::from_value::<GameData>(value).ok()
        })
        .collect();

    let db_for_task = db_state.inner().clone();
    let hashed = tokio::task::spawn_blocking(move || {
        let mut out: Vec<GameData> = Vec::new();
        for mut g in games {
            match ensure_rom_hash(&db_for_task, &g) {
                Ok(Some(h)) => {
                    g.rom_hash = Some(h);
                    out.push(g);
                }
                Ok(None) => out.push(g),
                Err(e) => {
                    eprintln!("[find_duplicate_roms] skipping {}: {e}", g.id);
                }
            }
        }
        out
    })
    .await
    .map_err(|e| format!("hash task: {e}"))?;

    let mut by_hash: HashMap<String, Vec<GameData>> = HashMap::new();
    for g in hashed {
        if let Some(h) = &g.rom_hash {
            by_hash.entry(h.clone()).or_default().push(g);
        }
    }
    let mut groups: Vec<DuplicateGroup> = by_hash
        .into_iter()
        .filter(|(_, list)| list.len() > 1)
        .map(|(hash, games)| {
            let size = games
                .iter()
                .filter_map(|g| g.size_bytes)
                .max()
                .unwrap_or(0);
            DuplicateGroup { hash, size_bytes: size, games }
        })
        .collect();
    groups.sort_by(|a, b| b.games.len().cmp(&a.games.len()));
    Ok(groups)
}

// ─── Command: archive support ───────────────────────────────────────────────

/// Extract a ROM archive (zip / 7z) into the managed cache at
/// `<app-data>/rom-cache/<emulator_id>/<game_id>/` and return the path
/// of the first playable file found inside. The original archive stays
/// untouched — the extracted copy is the launch target.
pub fn extract_rom_archive(
    app_data_dir: &Path,
    emulator_id: &str,
    game_id: &str,
    rom_path: &str,
) -> Result<String, String> {
    let cache_dir = app_data_dir
        .join("rom-cache")
        .join(sanitize_component(emulator_id))
        .join(sanitize_component(game_id));
    std::fs::create_dir_all(&cache_dir).map_err(|e| format!("cache mkdir: {e}"))?;

    let src = PathBuf::from(rom_path);
    if !src.is_file() {
        return Err(format!("Archive not found: {rom_path}"));
    }
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let mut extracted: Vec<PathBuf> = Vec::new();
    if ext == "zip" {
        let file = std::fs::File::open(&src).map_err(|e| format!("archive open: {e}"))?;
        let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("archive read: {e}"))?;
        for i in 0..zip.len() {
            let mut entry = zip.by_index(i).map_err(|e| format!("archive entry: {e}"))?;
            let name = entry.name().replace('\\', "/");
            if !archive_entry_is_safe(&name) {
                return Err("unsafe_archive: archive contains a path traversal entry".into());
            }
            let target = cache_dir.join(&name);
            if entry.is_dir() {
                let _ = std::fs::create_dir_all(&target);
                continue;
            }
            if let Some(parent) = target.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let mut out = std::fs::File::create(&target).map_err(|e| format!("extract file: {e}"))?;
            if let Err(e) = std::io::copy(&mut entry, &mut out) {
                return Err(format!("extract copy: {e}"));
            }
            extracted.push(target);
        }
    } else if ext == "7z" {
        sevenz_rust::decompress_file(&src, &cache_dir)
            .map_err(|e| format!("7z extract: {e}"))?;
        collect_files(&cache_dir, &mut extracted);
    } else {
        return Err(format!("Unsupported archive type: .{ext}"));
    }

    pick_playable_file(&extracted)
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| format!("No playable ROM found inside archive {rom_path}"))
}

fn archive_entry_is_safe(name: &str) -> bool {
    let path = Path::new(name);
    !path.is_absolute()
        && !path
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
}

fn collect_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_dir() {
            collect_files(&p, out);
        } else {
            out.push(p);
        }
    }
}

/// Pick the most likely playable ROM inside an extracted archive:
/// prefer the largest file with a ROM-ish extension, else the largest.
fn pick_playable_file(files: &[PathBuf]) -> Option<PathBuf> {
    let rom_like = ["iso", "bin", "cue", "chd", "nes", "sfc", "smc", "n64", "z64", "v64", "gb", "gbc", "gba", "nds", "3ds", "cia", "xci", "nsp", "gcm", "rvz", "wbfs", "wud", "wux", "rpx", "md", "gen", "smd", "pce", "a26", "neo", "cdi", "gdi", "toc", "pbp", "cso", "vpk", "elf", "pkg", "xbe", "xex", "fds", "fig", "swc", "gcz", "gdi", "rom"];
    let mut best: Option<PathBuf> = None;
    let mut best_size = 0u64;
    for f in files {
        let ext = f.extension().and_then(|e| e.to_str()).unwrap_or("");
        if !rom_like.iter().any(|x| x.eq_ignore_ascii_case(ext)) {
            continue;
        }
        let size = std::fs::metadata(f).map(|m| m.len()).unwrap_or(0);
        if size > best_size {
            best_size = size;
            best = Some(f.clone());
        }
    }
    best.or_else(|| {
        // Fallback: largest file overall.
        files
            .iter()
            .max_by_key(|f| std::fs::metadata(f).map(|m| m.len()).unwrap_or(0))
            .cloned()
    })
}

/// Ensure a ROM archive is extracted to the managed cache and return
/// the playable file path (idempotent — reuses the cached copy).
#[tauri::command]
pub async fn rom_extract(
    app: tauri::AppHandle,
    game_id: String,
) -> Result<String, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let game = load_game(db_state.inner(), &game_id)?;
    let rom_path = game.rom_path.clone().ok_or("ROM has no file path")?;
    let emu_id = game
        .emulator_id
        .clone()
        .ok_or("ROM has no emulator linkage")?;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir: {e}"))?;
    let game_id_for_task = game_id.clone();
    let path = tokio::task::spawn_blocking(move || {
        extract_rom_archive(&app_data_dir, &emu_id, &game_id_for_task, &rom_path)
    })
    .await
    .map_err(|e| format!("extract task: {e}"))??;
    Ok(path)
}

// ─── Command: config import / export (JSON) ─────────────────────────────────

/// JSON export of every configured emulator + per-ROM profiles.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EmulatorsExport {
    pub version: u32,
    pub exported_at_ms: u64,
    pub emulators: Vec<crate::emulation::EmulatorData>,
    /// Per-ROM profiles keyed by game id (only ROMs owned by exported
    /// emulators).
    pub rom_profiles: HashMap<String, RomProfile>,
}

/// Export emulator configuration (config + ROM profiles) as JSON —
/// import with `import_emulators_config`.
#[tauri::command]
pub fn export_emulators_config(app: tauri::AppHandle) -> Result<String, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let emus = db::emulators::list_all(db_state.inner()).map_err(|e| e.to_string())?;
    let emu_ids: std::collections::HashSet<String> = emus.iter().map(|e| e.id.clone()).collect();
    let mut emulator_data: Vec<crate::emulation::EmulatorData> = Vec::new();
    for e in emus {
        emulator_data.push(crate::emulation::EmulatorData {
            id: e.id,
            name: e.name,
            platform: e.platform,
            executable_path: e.executable_path,
            arguments_template: e.arguments_template,
            rom_folder: e.rom_folder,
            notes: e.notes,
            icon_url: e.icon_url,
            bios_folder: e.bios_folder,
            saves_folder: e.saves_folder,
            auto_scan: e.auto_scan,
            created_at: e.created_at,
            updated_at: e.updated_at,
        });
    }
    let mut profiles: HashMap<String, RomProfile> = HashMap::new();
    for row in db::games::list_all(db_state.inner()).map_err(|e| e.to_string())? {
        if row.emulator_id.is_none() || !emu_ids.contains(row.emulator_id.as_deref().unwrap_or("")) {
            continue;
        }
        if let Some(p) = row.rom_profile {
            if let Ok(profile) = serde_json::from_value::<RomProfile>(p) {
                profiles.insert(row.id.clone(), profile);
            }
        }
    }
    let payload = EmulatorsExport {
        version: 1,
        exported_at_ms: now_ms(),
        emulators: emulator_data,
        rom_profiles: profiles,
    };
    serde_json::to_string_pretty(&payload).map_err(|e| format!("serialize: {e}"))
}

/// Import emulator configuration from JSON (from
/// `export_emulators_config`). Upserts emulators; ROM profiles are
/// applied only when the referenced game rows already exist. Returns
/// the number of emulators imported.
#[tauri::command]
pub fn import_emulators_config(app: tauri::AppHandle, json: String) -> Result<usize, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let payload: EmulatorsExport =
        serde_json::from_str(&json).map_err(|e| format!("invalid config JSON: {e}"))?;
    let mut imported = 0usize;
    for emu in payload.emulators {
        let row = db::emulators::EmulatorRow {
            id: emu.id.clone(),
            name: emu.name,
            platform: emu.platform,
            executable_path: emu.executable_path,
            arguments_template: emu.arguments_template,
            rom_folder: emu.rom_folder,
            notes: emu.notes,
            icon_url: emu.icon_url,
            bios_folder: emu.bios_folder,
            saves_folder: emu.saves_folder,
            auto_scan: emu.auto_scan,
            created_at: emu.created_at,
            updated_at: now_ms(),
        };
        db::emulators::upsert_one(db_state.inner(), &row)?;
        imported += 1;
    }
    // Apply ROM profiles to existing rows only.
    for (game_id, profile) in payload.rom_profiles {
        let Some(row) = db::games::get(db_state.inner(), &game_id).map_err(|e| e.to_string())? else {
            continue;
        };
        let value = serde_json::to_value(&row).map_err(|e| format!("to_value: {e}"))?;
        let mut game: GameData = serde_json::from_value(value)
            .map_err(|e| format!("from_value: {e}"))?;
        game.rom_profile = Some(profile);
        persist_game(db_state.inner(), &game)?;
    }
    Ok(imported)
}

// ─── Helpers for the ROM-folder watcher ─────────────────────────────────────

/// A cheap folder signature: sorted (name, size, mtime) of top-level
/// entries. Used by the watcher to detect added/removed/changed files
/// without re-scanning the whole tree.
pub fn folder_signature(dir: &Path) -> Option<Vec<(String, u64, u64)>> {
    let entries = std::fs::read_dir(dir).ok()?;
    let mut sig: Vec<(String, u64, u64)> = entries
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            let meta = std::fs::metadata(e.path()).ok()?;
            let mtime = meta
                .modified()
                .ok()?
                .duration_since(SystemTime::UNIX_EPOCH)
                .ok()?
                .as_millis() as u64;
            Some((name, meta.len(), mtime))
        })
        .collect();
    sig.sort();
    Some(sig)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_region_language_and_disc() {
        let parsed = parse_rom_filename("Game.Name.(USA).(En,Fr).(Rev 1)");
        assert_eq!(parsed.clean_title, "Game Name");
        assert_eq!(parsed.region.as_deref(), Some("USA"));
        assert_eq!(parsed.language.as_deref(), Some("En,Fr"));
        assert_eq!(parsed.disc, None);

        let parsed = parse_rom_filename("Final Fantasy VII (USA) (Disc 2)");
        assert_eq!(parsed.clean_title, "Final Fantasy VII");
        assert_eq!(parsed.disc, Some(2));
        assert_eq!(parsed.group.as_deref(), Some("Final Fantasy VII"));
    }

    #[test]
    fn cleans_names() {
        assert_eq!(clean_rom_name("Game.Name.(USA).Rev.1"), "Game Name");
        assert_eq!(clean_rom_name("Super_Mario_World"), "Super Mario World");
        assert_eq!(clean_rom_name("Metal Gear [Solid]"), "Metal Gear");
        assert_eq!(clean_rom_name(""), "");
    }

    #[test]
    fn crc32_matches_known_vector() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.bin");
        std::fs::write(&path, b"123456789").unwrap();
        // CRC-32 of "123456789" is 0xCBF43926.
        assert_eq!(crc32_file(&path).unwrap(), "cbf43926");
    }

    #[test]
    fn saves_scan_matches_rom_stem() {
        let dir = tempfile::tempdir().unwrap();
        let saves = dir.path().join("saves");
        std::fs::create_dir_all(&saves).unwrap();
        std::fs::write(saves.join("Metal Gear.srm"), b"").unwrap();
        std::fs::write(saves.join("unrelated.bin"), b"").unwrap();
        let game = GameData {
            id: "emu-1-abc".into(),
            name: "Metal Gear".into(),
            path: "emu.exe".into(),
            platform: "PlayStation".into(),
            installed: true,
            play_time: "0h".into(),
            added_at: 0,
            rom_path: Some(saves.join("Metal Gear.bin").to_string_lossy().to_string()),
            ..Default::default()
        };
        let entries = collect_save_files(&saves.to_string_lossy(), &game);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "Metal Gear.srm");
    }

    #[test]
    fn sanitizes_snapshot_names() {
        assert_eq!(sanitize_component("a/b:c*d?"), "a_b_c_d_");
        assert_eq!(sanitize_component("normal-name_1"), "normal-name_1");
    }
}
