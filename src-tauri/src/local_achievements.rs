//! Local (crack / emulator) achievement discovery + parsing.
//!
//! Discovers and parses local achievement files. Cracked /
//! repacked games ship achievement emulators (Goldberg, CODEX, RUNE,
//! OnlineFix, RLD!, Skidrow, CreamAPI, SmartSteamEmu, EMPRESS,
//! Razor1911, 3DM, …) that write local achievement state files under
//! well-known folders (`%APPDATA%`, `C:\Users\Public\Documents`,
//! `C:\ProgramData`, …), keyed by the game's **Steam appid**
//! (`objectId`). On Linux/macOS those Windows folders are resolved
//! inside each detected Wine prefix's `drive_c`, so cracked games
//! launched through Wine/Proton/Lutris/Bottles are picked up too.
//!
//! This module locates those files for a given appid and parses them
//! into `UnlockedAchievement { name, unlock_time }`. `unlock_time` is
//! kept in **milliseconds** here;
//! callers convert to seconds when merging into the Steam-shaped
//! `Achievement` model.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde_json::Value;

/// Known achievement emulators / crackers.
// `Flt` / `Steam` are parsed but not folder-scanned yet (Steam userdata
// discovery is intentionally out of scope for the first pass).
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Cracker {
    Codex,
    Rune,
    OnlineFix,
    Goldberg,
    UserStats,
    Rld,
    CreamApi,
    Skidrow,
    SmartSteamEmu,
    Empress,
    Flt,
    Razor1911,
    Rle,
    Threedm,
    Steam,
}

/// A parsed, on-disk achievement record: the internal achievement name
/// (matches Steam's `name` / api_name) and the unlock time in **ms**.
#[derive(Debug, Clone)]
pub struct UnlockedAchievement {
    pub name: String,
    pub unlock_time: u64,
}

/// A located achievement file + which cracker format it uses.
#[derive(Debug, Clone)]
pub struct AchievementFile {
    pub cracker: Cracker,
    pub path: PathBuf,
}

// ── Base directories ────────────────────────────────────────────────────

/// Logical Windows root folder. Resolved to real paths per-platform:
/// natively via env vars on Windows, inside each detected Wine prefix
/// (`drive_c`) elsewhere.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WinRoot {
    AppData,
    LocalAppData,
    ProgramData,
    Documents,
    PublicDocuments,
}

#[cfg(target_os = "windows")]
fn app_data() -> PathBuf {
    std::env::var("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_default()
}

#[cfg(target_os = "windows")]
fn local_app_data() -> PathBuf {
    std::env::var("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_default()
}

#[cfg(target_os = "windows")]
fn program_data() -> PathBuf {
    std::env::var("ProgramData")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(r"C:\ProgramData"))
}

#[cfg(target_os = "windows")]
fn documents() -> PathBuf {
    std::env::var("USERPROFILE")
        .map(|p| PathBuf::from(p).join("Documents"))
        .unwrap_or_default()
}

#[cfg(target_os = "windows")]
fn public_documents() -> PathBuf {
    PathBuf::from(r"C:\Users\Public\Documents")
}

#[cfg(target_os = "windows")]
fn resolve_win_root(root: WinRoot) -> Vec<PathBuf> {
    let p = match root {
        WinRoot::AppData => app_data(),
        WinRoot::LocalAppData => local_app_data(),
        WinRoot::ProgramData => program_data(),
        WinRoot::Documents => documents(),
        WinRoot::PublicDocuments => public_documents(),
    };
    vec![p]
}

/// Reduce candidate prefix roots (single prefixes or containers of
/// prefixes) to the `drive_c` dirs that actually exist.
#[cfg(not(target_os = "windows"))]
fn collect_drive_roots(candidates: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for root in candidates {
        let drive = root.join("drive_c");
        if drive.is_dir() {
            out.push(drive);
            continue;
        }
        // A container of prefixes: each child dir may hold a `drive_c`.
        if let Ok(entries) = std::fs::read_dir(&root) {
            for entry in entries.flatten() {
                let drive = entry.path().join("drive_c");
                if drive.is_dir() {
                    out.push(drive);
                }
            }
        }
    }
    out
}

/// Wine prefix roots that can contain a `drive_c` (Linux/macOS). Covers
/// the `WINEPREFIX` env var, the default `~/.wine`, `~/.wineprefixes`,
/// Flatpak Wine, Bottles, PlayOnLinux, and Lutris game folders under
/// `~/Games` (which are prefixes themselves).
#[cfg(not(target_os = "windows"))]
fn wine_drive_roots() -> Vec<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(p) = std::env::var("WINEPREFIX") {
        if !p.trim().is_empty() {
            candidates.push(PathBuf::from(p));
        }
    }

    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        candidates.push(home.join(".wine"));
        candidates.push(home.join(".wineprefixes"));
        candidates.push(home.join(".var/app/org.winehq.Wine/data/wineprefixes"));
        candidates.push(home.join(".var/app/org.winehq.wine/data/wineprefixes"));
        candidates.push(home.join(".var/app/com.usebottles.bottles/data/bottles/bottles"));
        candidates.push(home.join(".PlayOnLinux/wineprefix"));
        candidates.push(home.join("Games"));
    }

    collect_drive_roots(candidates)
}

/// Map a logical Windows root onto one Wine `drive_c` (Linux/macOS).
/// User-profile folders (`AppData`, `Documents`) are expanded for every
/// user dir under `drive_c/users`, skipping `Public` / `Default`.
#[cfg(not(target_os = "windows"))]
fn resolve_root_in_drive(drive: &Path, root: WinRoot) -> Vec<PathBuf> {
    match root {
        WinRoot::ProgramData => vec![drive.join("ProgramData")],
        WinRoot::PublicDocuments => {
            vec![drive.join("users").join("Public").join("Documents")]
        }
        WinRoot::AppData | WinRoot::LocalAppData | WinRoot::Documents => {
            let mut out = Vec::new();
            let users = drive.join("users");
            let Ok(entries) = std::fs::read_dir(&users) else {
                return out;
            };
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                if name_str.eq_ignore_ascii_case("Public")
                    || name_str.eq_ignore_ascii_case("Default")
                {
                    continue;
                }
                let path = match root {
                    WinRoot::AppData => entry.path().join("AppData").join("Roaming"),
                    WinRoot::LocalAppData => entry.path().join("AppData").join("Local"),
                    _ => entry.path().join("Documents"),
                };
                out.push(path);
            }
            out
        }
    }
}

/// Resolve a logical Windows root to the real folders that can hold
/// cracker state: the native path on Windows, and every matching folder
/// inside each detected Wine prefix elsewhere.
fn resolve_roots(root: WinRoot) -> Vec<PathBuf> {
    #[cfg(target_os = "windows")]
    return resolve_win_root(root);

    #[cfg(not(target_os = "windows"))]
    {
        let mut out = Vec::new();
        for drive in wine_drive_roots() {
            out.extend(resolve_root_in_drive(&drive, root));
        }
        out
    }
}

/// The set of crackers we scan for, in priority order.
const CRACKERS: &[Cracker] = &[
    Cracker::Codex,
    Cracker::Goldberg,
    Cracker::Rune,
    Cracker::OnlineFix,
    Cracker::Rld,
    Cracker::CreamApi,
    Cracker::Skidrow,
    Cracker::SmartSteamEmu,
    Cracker::Empress,
    Cracker::Razor1911,
    Cracker::Rle,
];

/// A folder to scan (logical Windows root + relative subfolders) plus
/// the file location template inside each `<objectId>` subfolder.
/// `<objectId>` placeholders are substituted with the game's Steam appid.
struct CrackerPath {
    root: WinRoot,
    rel: Vec<&'static str>,
    file_location: Vec<&'static str>,
}

fn paths_for_cracker(cracker: Cracker) -> Vec<CrackerPath> {
    match cracker {
        Cracker::Codex => vec![
            CrackerPath {
                root: WinRoot::PublicDocuments,
                rel: vec!["Steam", "CODEX"],
                file_location: vec!["<objectId>", "achievements.ini"],
            },
            CrackerPath {
                root: WinRoot::AppData,
                rel: vec!["Steam", "CODEX"],
                file_location: vec!["<objectId>", "achievements.ini"],
            },
        ],
        Cracker::Rune => vec![CrackerPath {
            root: WinRoot::PublicDocuments,
            rel: vec!["Steam", "RUNE"],
            file_location: vec!["<objectId>", "achievements.ini"],
        }],
        Cracker::OnlineFix => vec![
            CrackerPath {
                root: WinRoot::PublicDocuments,
                rel: vec!["OnlineFix"],
                file_location: vec!["<objectId>", "Stats", "Achievements.ini"],
            },
            CrackerPath {
                root: WinRoot::PublicDocuments,
                rel: vec!["OnlineFix"],
                file_location: vec!["<objectId>", "Achievements.ini"],
            },
        ],
        Cracker::Goldberg => vec![
            CrackerPath {
                root: WinRoot::AppData,
                rel: vec!["Goldberg SteamEmu Saves"],
                file_location: vec!["<objectId>", "achievements.json"],
            },
            CrackerPath {
                root: WinRoot::AppData,
                rel: vec!["GSE Saves"],
                file_location: vec!["<objectId>", "achievements.json"],
            },
        ],
        Cracker::Rld => vec![
            CrackerPath {
                root: WinRoot::ProgramData,
                rel: vec!["RLD!"],
                file_location: vec!["<objectId>", "achievements.ini"],
            },
            CrackerPath {
                root: WinRoot::ProgramData,
                rel: vec!["Steam", "Player"],
                file_location: vec!["<objectId>", "stats", "achievements.ini"],
            },
            CrackerPath {
                root: WinRoot::ProgramData,
                rel: vec!["Steam", "RLD!"],
                file_location: vec!["<objectId>", "stats", "achievements.ini"],
            },
            CrackerPath {
                root: WinRoot::ProgramData,
                rel: vec!["Steam", "dodi"],
                file_location: vec!["<objectId>", "stats", "achievements.ini"],
            },
        ],
        Cracker::Empress => vec![
            CrackerPath {
                root: WinRoot::AppData,
                rel: vec!["EMPRESS", "remote"],
                file_location: vec!["<objectId>", "achievements.json"],
            },
            CrackerPath {
                root: WinRoot::PublicDocuments,
                rel: vec!["EMPRESS"],
                file_location: vec![
                    "<objectId>",
                    "remote",
                    "<objectId>",
                    "achievements.json",
                ],
            },
        ],
        Cracker::Skidrow => vec![
            CrackerPath {
                root: WinRoot::Documents,
                rel: vec!["SKIDROW"],
                file_location: vec!["<objectId>", "SteamEmu", "UserStats", "achiev.ini"],
            },
            CrackerPath {
                root: WinRoot::Documents,
                rel: vec!["Player"],
                file_location: vec!["<objectId>", "SteamEmu", "UserStats", "achiev.ini"],
            },
            CrackerPath {
                root: WinRoot::LocalAppData,
                rel: vec!["SKIDROW"],
                file_location: vec!["<objectId>", "SteamEmu", "UserStats", "achiev.ini"],
            },
        ],
        Cracker::CreamApi => vec![CrackerPath {
            root: WinRoot::AppData,
            rel: vec!["CreamAPI"],
            file_location: vec!["<objectId>", "stats", "CreamAPI.Achievements.cfg"],
        }],
        Cracker::SmartSteamEmu => vec![CrackerPath {
            root: WinRoot::AppData,
            rel: vec!["SmartSteamEmu"],
            file_location: vec!["<objectId>", "User", "Achievements.ini"],
        }],
        Cracker::Rle => vec![
            CrackerPath {
                root: WinRoot::AppData,
                rel: vec!["RLE"],
                file_location: vec!["<objectId>", "achievements.ini"],
            },
            CrackerPath {
                root: WinRoot::AppData,
                rel: vec!["RLE"],
                file_location: vec!["<objectId>", "Achievements.ini"],
            },
        ],
        Cracker::Razor1911 => vec![CrackerPath {
            root: WinRoot::AppData,
            rel: vec![".1911"],
            file_location: vec!["<objectId>", "achievement"],
        }],
        // No folder-based discovery: located via the executable dir
        // (UserStats / 3DM) or unsupported (FLT / Steam-cache handled
        // through dedicated helpers).
        Cracker::UserStats | Cracker::Flt | Cracker::Threedm | Cracker::Steam => vec![],
    }
}

/// Dishonored ships achievements under sibling appids.
pub fn get_alternative_object_ids(object_id: &str) -> Vec<String> {
    if object_id == "205100" {
        return vec!["205100".into(), "217980".into(), "31292".into()];
    }
    vec![object_id.to_string()]
}

fn map_file_location(file_location: &[&str], object_id: &str) -> Vec<String> {
    file_location
        .iter()
        .map(|seg| seg.replace("<objectId>", object_id))
        .collect()
}

/// Find crack achievement files for a single game (by Steam appid),
/// plus any files sitting next to the game executable.
pub fn find_achievement_files(steam_app_id: u32, exe_path: Option<&str>) -> Vec<AchievementFile> {
    let mut out = Vec::new();

    for &cracker in CRACKERS {
        for cp in paths_for_cracker(cracker) {
            for root in resolve_roots(cp.root) {
                let mut folder = root.clone();
                for seg in &cp.rel {
                    folder.push(seg);
                }
                for object_id in get_alternative_object_ids(&steam_app_id.to_string()) {
                    let mut file_path = folder.clone();
                    for seg in map_file_location(&cp.file_location, &object_id) {
                        file_path.push(seg);
                    }
                    if file_path.exists() {
                        out.push(AchievementFile {
                            cracker,
                            path: file_path,
                        });
                    }
                }
            }
        }
    }

    out.extend(find_achievement_file_in_executable_directory(exe_path));
    out
}

/// Achievement files that live inside the game's install directory
/// (relative to the executable): UserStats + 3DM.
pub fn find_achievement_file_in_executable_directory(
    exe_path: Option<&str>,
) -> Vec<AchievementFile> {
    let Some(exe) = exe_path else {
        return Vec::new();
    };
    let Some(dir) = Path::new(exe).parent() else {
        return Vec::new();
    };

    let candidates = [
        (
            Cracker::UserStats,
            dir.join("SteamData").join("user_stats.ini"),
        ),
        (
            Cracker::Threedm,
            dir.join("3DMGAME")
                .join("Player")
                .join("stats")
                .join("achievements.ini"),
        ),
    ];

    candidates
        .into_iter()
        .filter(|(_, p)| p.exists())
        .map(|(cracker, path)| AchievementFile { cracker, path })
        .collect()
}

/// Scan every cracker folder once and build a map of
/// `appid -> [AchievementFile]`. Used by the watcher's bulk passes so
/// we don't stat one path per game per cracker on every poll.
pub fn find_all_achievement_files() -> HashMap<String, Vec<AchievementFile>> {
    let mut map: HashMap<String, Vec<AchievementFile>> = HashMap::new();

    for &cracker in CRACKERS {
        for cp in paths_for_cracker(cracker) {
            for root in resolve_roots(cp.root) {
                let mut folder = root.clone();
                for seg in &cp.rel {
                    folder.push(seg);
                }
                let Ok(entries) = std::fs::read_dir(&folder) else {
                    continue;
                };
                for entry in entries.flatten() {
                    let object_id = entry.file_name().to_string_lossy().to_string();
                    let mut file_path = folder.clone();
                    for seg in map_file_location(&cp.file_location, &object_id) {
                        file_path.push(seg);
                    }
                    if !file_path.exists() {
                        continue;
                    }
                    map.entry(object_id).or_default().push(AchievementFile {
                        cracker,
                        path: file_path,
                    });
                }
            }
        }
    }

    map
}

// ── Parsing ─────────────────────────────────────────────────────────────

/// Parse one achievement file into its unlocked achievements.
pub fn parse_achievement_file(file: &AchievementFile) -> Vec<UnlockedAchievement> {
    if !file.path.exists() {
        return Vec::new();
    }

    let result = match file.cracker {
        Cracker::Codex | Cracker::Rune => ini_parse(&file.path).map(|o| process_default(&o)),
        Cracker::OnlineFix => ini_parse(&file.path).map(|o| process_online_fix(&o)),
        Cracker::Goldberg | Cracker::Empress => {
            json_parse(&file.path).map(|v| process_goldberg(&v))
        }
        Cracker::UserStats => ini_parse(&file.path).map(|o| process_user_stats(&o)),
        Cracker::Rld => ini_parse(&file.path).map(|o| process_rld(&o)),
        Cracker::Skidrow => ini_parse(&file.path).map(|o| process_skidrow(&o)),
        Cracker::SmartSteamEmu | Cracker::Rle => {
            ini_parse(&file.path).map(|o| process_default(&o))
        }
        Cracker::Threedm => ini_parse(&file.path).map(|o| process_3dm(&o)),
        Cracker::CreamApi => ini_parse(&file.path).map(|o| process_cream_api(&o)),
        Cracker::Razor1911 => Ok(process_razor1911(&file.path)),
        Cracker::Flt => Ok(process_flt(&file.path)),
        Cracker::Steam => json_parse(&file.path).map(|v| process_steam_cache(&v)),
    };

    match result {
        Ok(list) => list,
        Err(e) => {
            eprintln!(
                "[local_achievements] error parsing {:?} ({:?}): {e}",
                file.path, file.cracker
            );
            Vec::new()
        }
    }
}

type IniObject = HashMap<String, Vec<(String, String)>>;

/// INI parser: strips a leading BOM, skips
/// blank / `###` lines, tracks `[section]` headers, and splits each
/// `k=v` on the first `=`. Section entries preserve order so index-based
/// lookups (Skidrow) stay stable.
fn ini_parse(path: &Path) -> Result<IniObject, String> {
    let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let content = content.strip_prefix('\u{feff}').unwrap_or(&content);

    let mut object: IniObject = HashMap::new();
    let mut section = String::new();
    object.insert(section.clone(), Vec::new());

    for raw in content.split(['\r', '\n']) {
        let line = raw;
        if line.starts_with("###") || line.is_empty() {
            continue;
        }
        if line.starts_with('[') && line.ends_with(']') {
            section = line[1..line.len() - 1].to_string();
            object.entry(section.clone()).or_default();
        } else if let Some(idx) = line.find('=') {
            let name = line[..idx].trim().to_string();
            let value = line[idx + 1..].trim().to_string();
            object.entry(section.clone()).or_default().push((name, value));
        }
    }

    Ok(object)
}

fn json_parse(path: &Path) -> Result<Value, String> {
    let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

fn section<'a>(obj: &'a IniObject, name: &str) -> Option<&'a Vec<(String, String)>> {
    obj.get(name)
}

/// Parse a hex string as a little-endian u32.
fn hex_le_u32(s: &str) -> u32 {
    let bytes: Vec<u8> = (0..s.len())
        .step_by(2)
        .filter_map(|i| s.get(i..i + 2).and_then(|b| u8::from_str_radix(b, 16).ok()))
        .collect();
    let mut buf = [0u8; 4];
    for (i, b) in bytes.iter().take(4).enumerate() {
        buf[i] = *b;
    }
    u32::from_le_bytes(buf)
}

fn parse_num(s: &str) -> Option<u64> {
    s.trim().parse::<u64>().ok()
}

/// CODEX / RUNE / RLE: `Achieved=1` + `UnlockTime=<secs>` per section.
fn process_default(obj: &IniObject) -> Vec<UnlockedAchievement> {
    let mut out = Vec::new();
    for (name, entries) in obj {
        if name.is_empty() {
            continue;
        }
        let map: HashMap<&str, &str> =
            entries.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
        if map.get("Achieved").copied() == Some("1") {
            let ut = map.get("UnlockTime").and_then(|v| parse_num(v)).unwrap_or(0);
            out.push(UnlockedAchievement {
                name: name.clone(),
                unlock_time: ut * 1000,
            });
        }
    }
    out
}

/// OnlineFix: `achieved=true`/`Achieved=true` variants.
fn process_online_fix(obj: &IniObject) -> Vec<UnlockedAchievement> {
    let mut out = Vec::new();
    for (name, entries) in obj {
        if name.is_empty() {
            continue;
        }
        let map: HashMap<&str, &str> =
            entries.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
        if map.get("achieved").copied() == Some("true") {
            let ts = map.get("timestamp").and_then(|v| parse_num(v)).unwrap_or(0);
            out.push(UnlockedAchievement {
                name: name.clone(),
                unlock_time: ts * 1000,
            });
        } else if map.get("Achieved").copied() == Some("true") {
            let raw = map.get("TimeUnlocked").copied().unwrap_or("0");
            let n = parse_num(raw).unwrap_or(0);
            let unlock_time = if raw.trim().len() == 7 {
                n * 1000 * 1000
            } else {
                n * 1000
            };
            out.push(UnlockedAchievement {
                name: name.clone(),
                unlock_time,
            });
        }
    }
    out
}

/// CreamAPI: `achieved=true` + `unlocktime`.
fn process_cream_api(obj: &IniObject) -> Vec<UnlockedAchievement> {
    let mut out = Vec::new();
    for (name, entries) in obj {
        if name.is_empty() {
            continue;
        }
        let map: HashMap<&str, &str> =
            entries.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
        if map.get("achieved").copied() == Some("true") {
            let raw = map.get("unlocktime").copied().unwrap_or("0");
            let n = parse_num(raw).unwrap_or(0);
            let unlock_time = if raw.trim().len() == 7 {
                n * 1000 * 1000
            } else {
                n * 1000
            };
            out.push(UnlockedAchievement {
                name: name.clone(),
                unlock_time,
            });
        }
    }
    out
}

/// Skidrow: `[Achievements]` section, values `"1@...@<secs>"`.
fn process_skidrow(obj: &IniObject) -> Vec<UnlockedAchievement> {
    let mut out = Vec::new();
    let Some(entries) = section(obj, "Achievements") else {
        return out;
    };
    for (name, value) in entries {
        let parts: Vec<&str> = value.split('@').collect();
        if parts.first().copied() == Some("1") {
            let last = parts.last().and_then(|v| parse_num(v)).unwrap_or(0);
            out.push(UnlockedAchievement {
                name: name.clone(),
                unlock_time: last * 1000,
            });
        }
    }
    out
}

/// Goldberg / EMPRESS: JSON array or object of `{ earned, earned_time }`.
fn process_goldberg(value: &Value) -> Vec<UnlockedAchievement> {
    let mut out = Vec::new();

    if let Some(arr) = value.as_array() {
        for a in arr {
            if a.get("earned").and_then(|v| v.as_bool()).unwrap_or(false) {
                let name = a.get("name").and_then(|v| v.as_str()).unwrap_or_default();
                let earned = a.get("earned_time").and_then(|v| v.as_u64()).unwrap_or(0);
                out.push(UnlockedAchievement {
                    name: name.to_string(),
                    unlock_time: earned * 1000,
                });
            }
        }
        return out;
    }

    if let Some(obj) = value.as_object() {
        for (name, a) in obj {
            if a.get("earned").and_then(|v| v.as_bool()).unwrap_or(false) {
                let earned = a.get("earned_time").and_then(|v| v.as_u64()).unwrap_or(0);
                out.push(UnlockedAchievement {
                    name: name.clone(),
                    unlock_time: earned * 1000,
                });
            }
        }
    }

    out
}

/// Steam library-cache JSON (`<appid>.json` under userdata).
fn process_steam_cache(value: &Value) -> Vec<UnlockedAchievement> {
    let mut out = Vec::new();
    let Some(arr) = value.as_array() else {
        return out;
    };

    let entry = arr.iter().find(|e| {
        e.as_array()
            .and_then(|inner| inner.first())
            .and_then(|v| v.as_str())
            == Some("achievements")
    });

    let Some(highlights) = entry
        .and_then(|e| e.as_array())
        .and_then(|inner| inner.get(1))
        .and_then(|v| v.get("data"))
        .and_then(|v| v.get("vecHighlight"))
        .and_then(|v| v.as_array())
    else {
        return out;
    };

    for a in highlights {
        if a.get("bAchieved").and_then(|v| v.as_bool()).unwrap_or(false) {
            let name = a.get("strID").and_then(|v| v.as_str()).unwrap_or_default();
            let unlocked = a.get("rtUnlocked").and_then(|v| v.as_u64()).unwrap_or(0);
            out.push(UnlockedAchievement {
                name: name.to_string(),
                unlock_time: unlocked * 1000,
            });
        }
    }
    out
}

/// 3DM: `[State]` = "0101" unlocked, `[Time]` hex-LE u32 seconds.
fn process_3dm(obj: &IniObject) -> Vec<UnlockedAchievement> {
    let mut out = Vec::new();
    let (Some(states), Some(times)) = (section(obj, "State"), section(obj, "Time")) else {
        return out;
    };
    let times_map: HashMap<&str, &str> =
        times.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();

    for (name, state) in states {
        if state == "0101" {
            let secs = times_map.get(name.as_str()).map(|t| hex_le_u32(t)).unwrap_or(0);
            out.push(UnlockedAchievement {
                name: name.clone(),
                unlock_time: secs as u64 * 1000,
            });
        }
    }
    out
}

/// RLD!: per-section `State` (hex-LE u32 == 1) + `Time` (hex-LE u32).
fn process_rld(obj: &IniObject) -> Vec<UnlockedAchievement> {
    let mut out = Vec::new();
    for (name, entries) in obj {
        if name.is_empty() || name == "Steam" {
            continue;
        }
        let map: HashMap<&str, &str> =
            entries.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
        let Some(state) = map.get("State") else {
            continue;
        };
        if hex_le_u32(state) == 1 {
            let secs = map.get("Time").map(|t| hex_le_u32(t)).unwrap_or(0);
            out.push(UnlockedAchievement {
                name: name.clone(),
                unlock_time: secs as u64 * 1000,
            });
        }
    }
    out
}

/// SmartSteamEmu / UserStats: `[ACHIEVEMENTS]` with values like
/// `(unlocked = true, time = <secs>)`.
fn process_user_stats(obj: &IniObject) -> Vec<UnlockedAchievement> {
    let mut out = Vec::new();
    let Some(entries) = section(obj, "ACHIEVEMENTS") else {
        return out;
    };
    for (name, value) in entries {
        // Strip surrounding parens, then the leading label.
        let inner = value
            .strip_prefix('(')
            .and_then(|s| s.strip_suffix(')'))
            .unwrap_or(value);
        let num = inner.replace("unlocked = true, time = ", "");
        if let Ok(secs) = num.trim().parse::<u64>() {
            out.push(UnlockedAchievement {
                name: name.replace('"', ""),
                unlock_time: secs * 1000,
            });
        }
    }
    out
}

/// Razor1911: whitespace-delimited `name unlocked unlockTime` lines.
fn process_razor1911(path: &Path) -> Vec<UnlockedAchievement> {
    let Ok(content) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let content = content.strip_prefix('\u{feff}').unwrap_or(&content);
    let mut out = Vec::new();
    for line in content.split(['\r', '\n']) {
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split(' ').collect();
        if parts.len() >= 3 && parts[1] == "1" {
            let secs = parse_num(parts[2]).unwrap_or(0);
            out.push(UnlockedAchievement {
                name: parts[0].to_string(),
                unlock_time: secs * 1000,
            });
        }
    }
    out
}

/// FLT: a directory whose entries are unlocked achievement names.
fn process_flt(path: &Path) -> Vec<UnlockedAchievement> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let Ok(entries) = std::fs::read_dir(path) else {
        return Vec::new();
    };
    entries
        .flatten()
        .map(|e| UnlockedAchievement {
            name: e.file_name().to_string_lossy().to_string(),
            unlock_time: now,
        })
        .collect()
}

#[cfg(all(test, not(target_os = "windows")))]
mod tests {
    use super::*;

    /// A fake `drive_c` layout, mirroring what Wine creates.
    fn fake_drive(root: &Path) {
        std::fs::create_dir_all(root.join("users/alice/AppData/Roaming")).unwrap();
        std::fs::create_dir_all(root.join("users/alice/AppData/Local")).unwrap();
        std::fs::create_dir_all(root.join("users/alice/Documents")).unwrap();
        std::fs::create_dir_all(root.join("users/Public/Documents")).unwrap();
        std::fs::create_dir_all(root.join("users/Default/AppData/Roaming")).unwrap();
        std::fs::create_dir_all(root.join("ProgramData")).unwrap();
    }

    #[test]
    fn maps_windows_roots_inside_wine_drive() {
        let drive = tempfile::tempdir().unwrap();
        fake_drive(drive.path());

        let app = resolve_root_in_drive(drive.path(), WinRoot::AppData);
        assert_eq!(app.len(), 1);
        assert_eq!(app[0], drive.path().join("users/alice/AppData/Roaming"));

        let local = resolve_root_in_drive(drive.path(), WinRoot::LocalAppData);
        assert_eq!(local, vec![drive.path().join("users/alice/AppData/Local")]);

        let docs = resolve_root_in_drive(drive.path(), WinRoot::Documents);
        assert_eq!(docs, vec![drive.path().join("users/alice/Documents")]);

        let prog = resolve_root_in_drive(drive.path(), WinRoot::ProgramData);
        assert_eq!(prog, vec![drive.path().join("ProgramData")]);

        let pubd = resolve_root_in_drive(drive.path(), WinRoot::PublicDocuments);
        assert_eq!(pubd, vec![drive.path().join("users/Public/Documents")]);
    }

    #[test]
    fn resolves_single_prefix_and_container_of_prefixes() {
        let base = tempfile::tempdir().unwrap();
        let single = base.path().join("myprefix");
        std::fs::create_dir_all(single.join("drive_c")).unwrap();
        let container = base.path().join("wineprefixes");
        std::fs::create_dir_all(container.join("p1/drive_c")).unwrap();
        std::fs::create_dir_all(container.join("p2/drive_c")).unwrap();
        std::fs::create_dir_all(container.join("p3/not_drive")).unwrap();
        std::fs::create_dir_all(base.path().join("empty")).unwrap();

        let mut drives = collect_drive_roots(vec![
            single.clone(),
            container.clone(),
            base.path().join("empty"),
        ]);
        drives.sort();

        let mut expected = vec![
            single.join("drive_c"),
            container.join("p1/drive_c"),
            container.join("p2/drive_c"),
        ];
        expected.sort();
        assert_eq!(drives, expected);
    }

    #[test]
    fn codex_paths_use_public_documents_and_appdata_roots() {
        let paths = paths_for_cracker(Cracker::Codex);
        let roots: Vec<WinRoot> = paths.iter().map(|cp| cp.root).collect();
        assert_eq!(
            roots,
            vec![WinRoot::PublicDocuments, WinRoot::AppData]
        );
        assert_eq!(paths[0].rel, vec!["Steam", "CODEX"]);
        assert_eq!(paths[0].file_location, vec!["<objectId>", "achievements.ini"]);
    }
}
