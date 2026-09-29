//! Mod Organizer 2 (MO2) integration.
//!
//! Provides discovery of MO2 instances (both portable and global AppData instances),
//! profile management, mod list inspection, enabled/disabled state toggling (+/- in modlist.txt),
//! priority (load order) reordering, plugin management (plugins.txt), and launching
//! games through MO2's USVFS (User Space Virtual File System) launcher.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::SystemTime;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

/// A custom executable configured inside MO2 (e.g. SKSE, F4SE, Game launcher).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mo2Executable {
    pub title: String,
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub arguments: Option<String>,
}

/// An identified Mod Organizer 2 instance.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mo2Instance {
    pub id: String,
    pub name: String,
    pub instance_path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mo_exe_path: Option<String>,
    pub is_portable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub game_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub game_path: Option<String>,
    pub mods_dir: String,
    pub profiles_dir: String,
    pub overwrite_dir: String,
    pub selected_profile: String,
    pub profiles: Vec<String>,
    pub custom_executables: Vec<Mo2Executable>,
}

/// One managed mod inside an MO2 instance for a given profile.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mo2Mod {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub priority: i64,
    pub is_separator: bool,
    pub is_unmanaged: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nexus_mod_id: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nexus_domain: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_count: Option<u64>,
    pub path: String,
}

/// One plugin (.esp, .esm, .esl) inside MO2's plugins.txt.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mo2Plugin {
    pub name: String,
    pub enabled: bool,
    pub priority: i64,
}

/// Detailed profile content (all mods with status + plugins list).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mo2ProfileDetails {
    pub instance_path: String,
    pub profile_name: String,
    pub mods: Vec<Mo2Mod>,
    pub plugins: Vec<Mo2Plugin>,
    pub active_mod_count: usize,
    pub total_mod_count: usize,
    pub active_plugin_count: usize,
    pub total_plugin_count: usize,
}

// ─── Simple INI Parser ────────────────────────────────────────────────────────

type IniMap = HashMap<String, HashMap<String, String>>;

/// Clean an INI value by removing Qt QSettings wrapper types (@ByteArray, @Variant),
/// stripping surrounding quotes, and unescaping backslashes.
pub fn clean_ini_val(val: &str) -> String {
    let mut s = val.trim();
    if s.starts_with("@ByteArray(") && s.ends_with(')') && s.len() >= 12 {
        s = s[11..s.len() - 1].trim();
    } else if s.starts_with("@Variant(") && s.ends_with(')') && s.len() >= 10 {
        s = s[9..s.len() - 1].trim();
    }
    if (s.starts_with('"') && s.ends_with('"')) || (s.starts_with('\'') && s.ends_with('\'')) {
        if s.len() >= 2 {
            s = &s[1..s.len() - 1];
        }
    }
    s.replace("\\\\", "\\")
}

/// Parse an INI file into Section -> Key -> Value.
pub fn parse_ini(content: &str) -> IniMap {
    let mut map: IniMap = HashMap::new();
    let mut current_section = "General".to_string();

    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
            continue;
        }

        if line.starts_with('[') && line.ends_with(']') {
            current_section = line[1..line.len() - 1].trim().to_string();
            continue;
        }

        if let Some((k, v)) = line.split_once('=') {
            let key = k.trim().to_string();
            let val = clean_ini_val(v.trim());
            map.entry(current_section.clone())
                .or_default()
                .insert(key, val);
        }
    }

    map
}

// ─── Path & Directory Resolvers ───────────────────────────────────────────────

fn normalize_path_str(p: &str) -> String {
    p.replace('\\', "/").trim_end_matches('/').to_lowercase()
}

fn resolve_mo2_dir(base_dir: &Path, raw: &str, fallback_sub: &str) -> PathBuf {
    let cleaned = clean_ini_val(raw);
    if cleaned.is_empty() {
        return base_dir.join(fallback_sub);
    }
    let normalized = cleaned.replace("%BASE_DIR%", &base_dir.to_string_lossy());
    let path = PathBuf::from(&normalized);
    if path.is_absolute() {
        path
    } else {
        base_dir.join(path)
    }
}

/// Helper to resolve the directory for a given profile name, with case-insensitive and cleaned fallback.
pub fn resolve_profile_dir(profiles_dir: &str, profile_name: &str) -> Option<PathBuf> {
    let clean_name = clean_ini_val(profile_name);
    let root = Path::new(profiles_dir);
    let direct = root.join(&clean_name);
    if direct.is_dir() {
        return Some(direct);
    }
    let target_lower = clean_name.to_lowercase();
    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.to_lowercase() == target_lower {
                    return Some(entry.path());
                }
            }
        }
    }
    None
}

/// Parse a single ModOrganizer.ini and produce an Mo2Instance model if valid.
pub fn parse_instance_at(ini_path: &Path, mo_exe_hint: Option<PathBuf>) -> Option<Mo2Instance> {
    if !ini_path.is_file() {
        return None;
    }

    let content = fs::read_to_string(ini_path).ok()?;
    let ini = parse_ini(&content);
    let general = ini.get("General")?;

    let instance_dir = ini_path.parent()?;
    let base_raw = general.get("base_directory").cloned().unwrap_or_default();
    let base_dir = if base_raw.is_empty() {
        instance_dir.to_path_buf()
    } else {
        PathBuf::from(&base_raw)
    };

    let mods_dir = resolve_mo2_dir(&base_dir, general.get("mods_directory").map(|s| s.as_str()).unwrap_or(""), "mods");
    let profiles_dir = resolve_mo2_dir(&base_dir, general.get("profiles_directory").map(|s| s.as_str()).unwrap_or(""), "profiles");
    let overwrite_dir = resolve_mo2_dir(&base_dir, general.get("overwrite_directory").map(|s| s.as_str()).unwrap_or(""), "overwrite");

    let game_name = general.get("gameName").cloned();
    let game_path = general.get("gamePath").cloned();
    let raw_selected = general.get("selected_profile").cloned().unwrap_or_else(|| "Default".to_string());

    // Locate ModOrganizer.exe: check candidate locations
    let mo_exe_path = if let Some(hint) = mo_exe_hint.filter(|p| p.is_file()) {
        Some(hint.to_string_lossy().to_string())
    } else {
        let same_dir = instance_dir.join("ModOrganizer.exe");
        if same_dir.is_file() {
            Some(same_dir.to_string_lossy().to_string())
        } else {
            // Check common locations
            let candidates = [
                PathBuf::from("C:\\Modding\\MO2\\ModOrganizer.exe"),
                PathBuf::from("C:\\Mod Organizer 2\\ModOrganizer.exe"),
                PathBuf::from("D:\\Modding\\MO2\\ModOrganizer.exe"),
                PathBuf::from("D:\\Mod Organizer 2\\ModOrganizer.exe"),
            ];
            candidates.into_iter().find(|p| p.is_file()).map(|p| p.to_string_lossy().to_string())
        }
    };

    let is_portable = mo_exe_path.as_ref().map(|exe| {
        Path::new(exe).parent() == Some(instance_dir)
    }).unwrap_or(false);

    // List available profiles
    let mut profiles = Vec::new();
    if let Ok(entries) = fs::read_dir(&profiles_dir) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                if let Ok(name) = entry.file_name().into_string() {
                    profiles.push(name);
                }
            }
        }
    }
    profiles.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    if profiles.is_empty() {
        profiles.push(raw_selected.clone());
    }

    // Ensure selected_profile matches the exact profile directory name
    let selected_profile = profiles
        .iter()
        .find(|p| p.eq_ignore_ascii_case(&raw_selected))
        .cloned()
        .unwrap_or(raw_selected);

    // Parse custom executables (checking both {i}\binary and {i}\custom keys)
    let mut custom_executables = Vec::new();
    if let Some(execs) = ini.get("customExecutables") {
        let size: usize = execs.get("size").and_then(|s| s.parse().ok()).unwrap_or(0);
        for i in 1..=size.max(30) {
            let title_key = format!("{i}\\title");
            let binary_key = format!("{i}\\binary");
            let custom_key = format!("{i}\\custom");
            let args_key = format!("{i}\\arguments");
            let exe_path = execs.get(&binary_key).or_else(|| execs.get(&custom_key));
            if let (Some(title), Some(raw_path)) = (execs.get(&title_key), exe_path) {
                if !title.is_empty() && !raw_path.is_empty() {
                    let mut path = raw_path.clone();
                    if path.contains("%BASE_DIR%") {
                        path = path.replace("%BASE_DIR%", &base_dir.to_string_lossy());
                    }
                    if let Some(ref gp) = game_path {
                        if path.contains("%GAME_PATH%") {
                            path = path.replace("%GAME_PATH%", gp);
                        }
                    }
                    if !Path::new(&path).is_absolute() {
                        if let Some(ref gp) = game_path {
                            let candidate = Path::new(gp).join(&path);
                            if candidate.exists() {
                                path = candidate.to_string_lossy().to_string();
                            }
                        }
                    }
                    custom_executables.push(Mo2Executable {
                        title: title.clone(),
                        path,
                        arguments: execs.get(&args_key).cloned().filter(|s| !s.is_empty()),
                    });
                }
            }
        }
    }

    let instance_name = if is_portable {
        game_name.clone().unwrap_or_else(|| "Portable MO2".to_string())
    } else {
        instance_dir.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Mod Organizer 2")
            .to_string()
    };

    Some(Mo2Instance {
        id: format!("mo2-{}", instance_dir.to_string_lossy().replace(['\\', '/', ':'], "-")),
        name: instance_name,
        instance_path: instance_dir.to_string_lossy().to_string(),
        mo_exe_path,
        is_portable,
        game_name,
        game_path,
        mods_dir: mods_dir.to_string_lossy().to_string(),
        profiles_dir: profiles_dir.to_string_lossy().to_string(),
        overwrite_dir: overwrite_dir.to_string_lossy().to_string(),
        selected_profile,
        profiles,
        custom_executables,
    })
}

/// Detect all MO2 instances relevant for a game (or all global instances if game is unspecified).
pub fn detect_mo2_instances(game_path: &str, game_name: &str) -> Vec<Mo2Instance> {
    let mut instances = Vec::new();
    let norm_game_path = normalize_path_str(game_path);
    let norm_game_name = game_name.to_lowercase();

    // 1. Portable checks: scan direct path and ascend parent directories (up to 4 levels)
    if !game_path.is_empty() {
        let gpath = Path::new(game_path);

        // If the path itself points to an MO2 directory or ModOrganizer.ini directly
        let direct_ini = if gpath.is_file() && gpath.file_name().map(|n| n.to_string_lossy().eq_ignore_ascii_case("ModOrganizer.ini")).unwrap_or(false) {
            Some(gpath.to_path_buf())
        } else if gpath.join("ModOrganizer.ini").is_file() {
            Some(gpath.join("ModOrganizer.ini"))
        } else {
            None
        };
        if let Some(ini) = direct_ini {
            if let Some(inst) = parse_instance_at(&ini, ini.parent().map(|p| p.join("ModOrganizer.exe"))) {
                instances.push(inst);
            }
        }

        let start_dir = if gpath.is_file() {
            gpath.parent()
        } else {
            Some(gpath)
        };

        if let Some(base) = start_dir {
            let mut curr = Some(base);
            let mut depth = 0;

            while let Some(dir) = curr {
                if depth > 4 {
                    break;
                }
                // Check current directory directly
                let direct = dir.join("ModOrganizer.ini");
                if direct.is_file() {
                    let exe = dir.join("ModOrganizer.exe");
                    if let Some(inst) = parse_instance_at(&direct, Some(exe)) {
                        instances.push(inst);
                    }
                }

                // Check immediate subdirectories for MO2 folders
                if let Ok(entries) = fs::read_dir(dir) {
                    for entry in entries.flatten() {
                        if entry.path().is_dir() {
                            let name_lower = entry.file_name().to_string_lossy().to_lowercase();
                            let is_mo2_name = matches!(
                                name_lower.as_str(),
                                "modorganizer"
                                    | "mod organizer"
                                    | "mod organizer 2"
                                    | "modorganizer2"
                                    | "mo2"
                            );
                            if is_mo2_name {
                                let ini = entry.path().join("ModOrganizer.ini");
                                if ini.is_file() {
                                    let exe = entry.path().join("ModOrganizer.exe");
                                    if let Some(inst) = parse_instance_at(&ini, Some(exe)) {
                                        instances.push(inst);
                                    }
                                }
                            }
                        }
                    }
                }
                curr = dir.parent();
                depth += 1;
            }
        }
    }

    // 2. Global instances in %LOCALAPPDATA%\ModOrganizer
    #[cfg(windows)]
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        let mo2_root = Path::new(&local_app_data).join("ModOrganizer");
        if let Ok(entries) = fs::read_dir(mo2_root) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    let ini = entry.path().join("ModOrganizer.ini");
                    if let Some(inst) = parse_instance_at(&ini, None) {
                        instances.push(inst);
                    }
                }
            }
        }
    }

    // Deduplicate by instance_path
    let mut seen = std::collections::HashSet::new();
    instances.retain(|inst| seen.insert(normalize_path_str(&inst.instance_path)));

    // Filter and score match to the target game
    if !norm_game_path.is_empty() || !norm_game_name.is_empty() {
        let mut scored: Vec<(i32, Mo2Instance)> = Vec::new();

        for inst in instances {
            let inst_game_path = inst.game_path.as_deref().map(normalize_path_str).unwrap_or_default();
            let inst_game_name = inst.game_name.as_deref().map(|s| s.to_lowercase()).unwrap_or_default();
            let inst_path_norm = normalize_path_str(&inst.instance_path);

            let mut score = 0;

            // Direct path matching
            if !norm_game_path.is_empty() {
                // If instance directory is ancestor of game or vice-versa
                if !inst_path_norm.is_empty() {
                    if norm_game_path.starts_with(&inst_path_norm) || inst_path_norm.starts_with(&norm_game_path) {
                        score += 80;
                    }
                }

                // If instance's configured game_path matches
                if !inst_game_path.is_empty() {
                    if norm_game_path == inst_game_path {
                        score += 100;
                    } else if norm_game_path.starts_with(&inst_game_path) || inst_game_path.starts_with(&norm_game_path) {
                        score += 75;
                    } else if norm_game_path.contains(&inst_game_path) || inst_game_path.contains(&norm_game_path) {
                        score += 50;
                    }
                }

                // Check custom executables inside instance
                for exec in &inst.custom_executables {
                    let exec_norm = normalize_path_str(&exec.path);
                    if !exec_norm.is_empty() {
                        let exec_file = Path::new(&exec.path)
                            .file_name()
                            .map(|f| f.to_string_lossy().to_lowercase())
                            .unwrap_or_default();
                        if exec_norm == norm_game_path || norm_game_path.ends_with(&exec_norm) || exec_norm.ends_with(&norm_game_path) {
                            score += 90;
                            break;
                        } else if !exec_file.is_empty() && norm_game_path.ends_with(&exec_file) {
                            score += 65;
                            break;
                        }
                    }
                }
            }

            // Game name matching
            if !norm_game_name.is_empty() && !inst_game_name.is_empty() {
                if norm_game_name == inst_game_name {
                    score += 60;
                } else if norm_game_name.contains(&inst_game_name) || inst_game_name.contains(&norm_game_name) {
                    score += 40;
                }
            }

            if inst.is_portable {
                score += 15;
            }

            scored.push((score, inst));
        }

        scored.sort_by(|a, b| b.0.cmp(&a.0));

        let positive: Vec<Mo2Instance> = scored.iter().filter(|(s, _)| *s > 0).map(|(_, i)| i.clone()).collect();
        if !positive.is_empty() {
            return positive;
        }
        return scored.into_iter().map(|(_, i)| i).collect();
    }

    instances
}

// ─── Profile & Mod Details ───────────────────────────────────────────────────

/// Parse a single mod folder inside MO2 `mods/<ModName>/` and read its `meta.ini`.
fn parse_mod_meta(mod_path: &Path, _mod_name: &str) -> (Option<String>, Option<String>, Option<i64>, Option<String>, Option<String>, Option<String>) {
    let meta_file = mod_path.join("meta.ini");
    if !meta_file.is_file() {
        return (None, None, None, None, None, None);
    }

    let Ok(content) = fs::read_to_string(&meta_file) else {
        return (None, None, None, None, None, None);
    };

    let ini = parse_ini(&content);
    let general = ini.get("General");

    let version = general.and_then(|g| g.get("version").or_else(|| g.get("newestVersion"))).cloned();
    let author = general.and_then(|g| g.get("author")).cloned();
    let nexus_id = general
        .and_then(|g| g.get("modid"))
        .and_then(|id| id.parse::<i64>().ok())
        .filter(|id| *id > 0);
    let category = general.and_then(|g| g.get("category")).cloned();
    let url = general.and_then(|g| g.get("url")).cloned();
    let nexus_domain = general.and_then(|g| g.get("gameName")).cloned();

    (version, author, nexus_id, nexus_domain, category, url)
}

/// In-memory cache for folder size and file count to eliminate freeze on large modlists.
/// Key: mod folder path. Value: (size_bytes, file_count, last_modified).
static FOLDER_STATS_CACHE: LazyLock<Mutex<HashMap<PathBuf, (u64, u64, SystemTime)>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Recursive directory stats for a mod with caching.
fn get_folder_stats(p: &Path) -> (u64, u64) {
    let mtime = fs::metadata(p).and_then(|m| m.modified()).unwrap_or(SystemTime::UNIX_EPOCH);
    if let Ok(guard) = FOLDER_STATS_CACHE.lock() {
        if let Some((b, f, cached_mtime)) = guard.get(p) {
            if *cached_mtime == mtime {
                return (*b, *f);
            }
        }
    }

    let (bytes, files) = walk_stats(p, 0);

    if let Ok(mut guard) = FOLDER_STATS_CACHE.lock() {
        guard.insert(p.to_path_buf(), (bytes, files, mtime));
    }

    (bytes, files)
}

fn walk_stats(p: &Path, depth: usize) -> (u64, u64) {
    if depth > 10 {
        return (0, 0);
    }
    let mut bytes = 0u64;
    let mut files = 0u64;
    let Ok(rd) = fs::read_dir(p) else { return (0, 0); };
    for entry in rd.flatten() {
        let ep = entry.path();
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str.starts_with('.') || name_str == "node_modules" {
            continue;
        }
        if ep.is_dir() {
            let (b, f) = walk_stats(&ep, depth + 1);
            bytes += b;
            files += f;
        } else if let Ok(md) = entry.metadata() {
            bytes += md.len();
            files += 1;
        }
    }
    (bytes, files)
}

/// Get detailed mod list and plugins list for a specific profile in an MO2 instance.
pub fn get_profile_details(instance_path: &str, profile_name: &str) -> Result<Mo2ProfileDetails, String> {
    let ini_path = Path::new(instance_path).join("ModOrganizer.ini");
    let instance = parse_instance_at(&ini_path, None)
        .ok_or_else(|| format!("Invalid MO2 instance at {instance_path}"))?;

    let profile_dir = resolve_profile_dir(&instance.profiles_dir, profile_name)
        .ok_or_else(|| format!("Profile '{profile_name}' not found in {}", instance.profiles_dir))?;

    let mods_root = Path::new(&instance.mods_dir);
    let modlist_path = profile_dir.join("modlist.txt");

    let mut raw_lines = Vec::new();
    if modlist_path.is_file() {
        if let Ok(content) = fs::read_to_string(&modlist_path) {
            raw_lines = content.lines()
                .map(|l| l.trim().to_string())
                .filter(|l| !l.is_empty() && !l.starts_with('#'))
                .collect();
        }
    }

    // In MO2's modlist.txt, lines are stored in REVERSE priority:
    // First line in modlist.txt = highest priority (bottom of MO2 UI)
    // Last line in modlist.txt = lowest priority (top of MO2 UI)
    // We reverse raw_lines so index 0 = lowest priority (0 in MO2 UI),
    // and index N = highest priority (overwrites previous ones).
    raw_lines.reverse();

    // Pre-calculate folder paths so we can measure folder stats in parallel
    let folder_paths: Vec<Option<PathBuf>> = raw_lines.iter().map(|line| {
        let (_, mod_name) = line.split_at(1);
        let mod_folder = mods_root.join(mod_name);
        if mod_folder.is_dir() { Some(mod_folder) } else { None }
    }).collect();

    // Compute stats across worker threads in parallel to avoid freezing UI
    let stats_results: Vec<(Option<u64>, Option<u64>)> = if folder_paths.is_empty() {
        Vec::new()
    } else {
        std::thread::scope(|s| {
            let chunk_size = (folder_paths.len() / 8).max(12);
            let mut handles = Vec::new();
            for chunk in folder_paths.chunks(chunk_size) {
                let chunk_owned = chunk.to_vec();
                handles.push(s.spawn(move || {
                    chunk_owned.into_iter().map(|opt_path| {
                        if let Some(p) = opt_path {
                            let (b, f) = get_folder_stats(&p);
                            (Some(b), Some(f))
                        } else {
                            (None, None)
                        }
                    }).collect::<Vec<_>>()
                }));
            }
            handles.into_iter().flat_map(|h| h.join().unwrap_or_default()).collect()
        })
    };

    let mut mods = Vec::with_capacity(raw_lines.len());
    let mut active_count = 0;
    let mut current_category: Option<String> = None;

    for (idx, line) in raw_lines.iter().enumerate() {
        let (prefix, mod_name) = line.split_at(1);
        let enabled = prefix == "+";
        let is_unmanaged = prefix == "*";
        let is_separator = mod_name.ends_with("_separator");
        let display_name = if is_separator {
            mod_name.strip_suffix("_separator").unwrap_or(mod_name).to_string()
        } else {
            mod_name.to_string()
        };

        if is_separator {
            current_category = Some(display_name.clone());
        }

        let mod_folder = mods_root.join(mod_name);
        let (version, author, nexus_mod_id, nexus_domain, meta_category, url) = if mod_folder.is_dir() {
            parse_mod_meta(&mod_folder, mod_name)
        } else {
            (None, None, None, None, None, None)
        };

        if enabled && !is_separator {
            active_count += 1;
        }

        let (size_bytes, file_count) = stats_results.get(idx).copied().unwrap_or((None, None));

        let category = if is_separator {
            Some(display_name.clone())
        } else {
            current_category.clone().or(meta_category)
        };

        mods.push(Mo2Mod {
            id: format!("mo2mod-{}", mod_name.replace(['\\', '/', ':', ' '], "-")),
            name: display_name,
            enabled,
            priority: idx as i64,
            is_separator,
            is_unmanaged,
            version,
            author,
            nexus_mod_id,
            nexus_domain,
            category,
            url,
            size_bytes,
            file_count,
            path: mod_folder.to_string_lossy().to_string(),
        });
    }

    // Also parse plugins.txt / loadorder.txt if present
    let plugins_path = profile_dir.join("plugins.txt");
    let loadorder_path = profile_dir.join("loadorder.txt");

    let mut plugins = Vec::new();
    let target_plugins_file = if plugins_path.is_file() {
        Some(plugins_path)
    } else if loadorder_path.is_file() {
        Some(loadorder_path)
    } else {
        None
    };

    let mut active_plugin_count = 0;
    if let Some(pfile) = target_plugins_file {
        if let Ok(content) = fs::read_to_string(pfile) {
            for (p_idx, raw_line) in content.lines().enumerate() {
                let line = raw_line.trim();
                if line.is_empty() || line.starts_with('#') {
                    continue;
                }
                let enabled = line.starts_with('*');
                let name = if enabled {
                    line[1..].trim().to_string()
                } else {
                    line.to_string()
                };
                if enabled {
                    active_plugin_count += 1;
                }
                plugins.push(Mo2Plugin {
                    name,
                    enabled,
                    priority: p_idx as i64,
                });
            }
        }
    }

    let total_mods = mods.iter().filter(|m| !m.is_separator).count();
    let total_plugins = plugins.len();

    Ok(Mo2ProfileDetails {
        instance_path: instance_path.to_string(),
        profile_name: profile_name.to_string(),
        mods,
        plugins,
        active_mod_count: active_count,
        total_mod_count: total_mods,
        active_plugin_count,
        total_plugin_count: total_plugins,
    })
}

// ─── Mutation Operations ──────────────────────────────────────────────────────

/// Enable or disable multiple mods at once in a single atomic rewrite of `modlist.txt`.
pub fn set_mods_enabled(
    instance_path: &str,
    profile_name: &str,
    updates: HashMap<String, bool>,
) -> Result<(), String> {
    if updates.is_empty() {
        return Ok(());
    }

    let ini_path = Path::new(instance_path).join("ModOrganizer.ini");
    let instance = parse_instance_at(&ini_path, None)
        .ok_or_else(|| format!("Invalid MO2 instance at {instance_path}"))?;

    let profile_dir = resolve_profile_dir(&instance.profiles_dir, profile_name)
        .ok_or_else(|| format!("Profile '{profile_name}' not found in {}", instance.profiles_dir))?;
    let modlist_path = profile_dir.join("modlist.txt");
    if !modlist_path.is_file() {
        return Err("modlist.txt does not exist for this profile".into());
    }

    let content = fs::read_to_string(&modlist_path).map_err(|e| e.to_string())?;
    let mut modified = false;
    let mut new_lines = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            new_lines.push(line.to_string());
            continue;
        }
        let name = &trimmed[1..];
        let sep_name = format!("{name}_separator");
        let bare_name = name.strip_suffix("_separator").unwrap_or(name);

        let target_state = updates.get(name)
            .or_else(|| updates.get(&sep_name))
            .or_else(|| updates.get(bare_name));

        if let Some(&enabled) = target_state {
            let next_prefix = if enabled { "+" } else { "-" };
            new_lines.push(format!("{next_prefix}{name}"));
            modified = true;
        } else {
            new_lines.push(line.to_string());
        }
    }

    if !modified {
        return Err("None of the specified mods were found in modlist.txt".into());
    }

    let out = new_lines.join("\r\n") + "\r\n";
    super::operations::atomic_write(&modlist_path, out.as_bytes())
        .map_err(|e| format!("Writing modlist.txt failed: {e}"))?;

    Ok(())
}

/// Enable or disable a single mod by modifying `modlist.txt`.
pub fn set_mod_enabled(instance_path: &str, profile_name: &str, mod_name: &str, enabled: bool) -> Result<(), String> {
    let mut updates = HashMap::new();
    updates.insert(mod_name.to_string(), enabled);
    set_mods_enabled(instance_path, profile_name, updates)
}

/// Reorder mods in `modlist.txt` based on the ordered list of mod names from the UI.
/// UI order: index 0 = lowest priority (top of list in MO2), index N = highest priority (bottom of list in MO2).
/// In modlist.txt, lines are stored in REVERSE priority (highest priority at top).
pub fn reorder_mods(instance_path: &str, profile_name: &str, ordered_mod_names: Vec<String>) -> Result<(), String> {
    let ini_path = Path::new(instance_path).join("ModOrganizer.ini");
    let instance = parse_instance_at(&ini_path, None)
        .ok_or_else(|| format!("Invalid MO2 instance at {instance_path}"))?;

    let profile_dir = resolve_profile_dir(&instance.profiles_dir, profile_name)
        .ok_or_else(|| format!("Profile '{profile_name}' not found in {}", instance.profiles_dir))?;
    let modlist_path = profile_dir.join("modlist.txt");
    if !modlist_path.is_file() {
        return Err("modlist.txt does not exist for this profile".into());
    }

    let content = fs::read_to_string(&modlist_path).map_err(|e| e.to_string())?;

    // Map each mod name to its current prefix (+ or - or *)
    let mut prefix_map: HashMap<String, String> = HashMap::new();
    let mut header_lines = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            header_lines.push(line.to_string());
            continue;
        }
        let prefix = trimmed[..1].to_string();
        let name = trimmed[1..].to_string();
        prefix_map.insert(name.clone(), prefix.clone());
        if let Some(stem) = name.strip_suffix("_separator") {
            prefix_map.insert(stem.to_string(), prefix);
        }
    }

    // In modlist.txt, lines are written in REVERSE priority.
    // So we reverse ordered_mod_names before writing.
    let mut reversed = ordered_mod_names;
    reversed.reverse();

    let mut result_lines = header_lines;
    for name in reversed {
        let prefix = prefix_map.get(&name).cloned().unwrap_or_else(|| "+".to_string());
        // Handle separator naming
        let full_name = if !name.ends_with("_separator") && prefix_map.contains_key(&format!("{name}_separator")) {
            format!("{name}_separator")
        } else {
            name
        };
        result_lines.push(format!("{prefix}{full_name}"));
    }

    let out = result_lines.join("\r\n") + "\r\n";
    super::operations::atomic_write(&modlist_path, out.as_bytes())
        .map_err(|e| format!("Writing modlist.txt failed: {e}"))?;

    Ok(())
}

/// Enable or disable a plugin in `plugins.txt`.
pub fn set_plugin_enabled(instance_path: &str, profile_name: &str, plugin_name: &str, enabled: bool) -> Result<(), String> {
    let ini_path = Path::new(instance_path).join("ModOrganizer.ini");
    let instance = parse_instance_at(&ini_path, None)
        .ok_or_else(|| format!("Invalid MO2 instance at {instance_path}"))?;

    let profile_dir = resolve_profile_dir(&instance.profiles_dir, profile_name)
        .ok_or_else(|| format!("Profile '{profile_name}' not found in {}", instance.profiles_dir))?;
    let plugins_path = profile_dir.join("plugins.txt");
    if !plugins_path.is_file() {
        return Err("plugins.txt does not exist for this profile".into());
    }

    let content = fs::read_to_string(&plugins_path).map_err(|e| e.to_string())?;
    let mut modified = false;
    let mut new_lines = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            new_lines.push(line.to_string());
            continue;
        }

        let is_active = trimmed.starts_with('*');
        let current_name = if is_active { trimmed[1..].trim() } else { trimmed };

        if current_name.eq_ignore_ascii_case(plugin_name) {
            if enabled {
                new_lines.push(format!("*{current_name}"));
            } else {
                new_lines.push(current_name.to_string());
            }
            modified = true;
        } else {
            new_lines.push(line.to_string());
        }
    }

    if !modified {
        return Err(format!("Plugin '{plugin_name}' not found in plugins.txt"));
    }

    let out = new_lines.join("\r\n") + "\r\n";
    super::operations::atomic_write(&plugins_path, out.as_bytes())
        .map_err(|e| format!("Writing plugins.txt failed: {e}"))?;

    Ok(())
}

/// Reorder plugins in `plugins.txt`.
pub fn reorder_plugins(instance_path: &str, profile_name: &str, ordered_plugin_names: Vec<String>) -> Result<(), String> {
    let ini_path = Path::new(instance_path).join("ModOrganizer.ini");
    let instance = parse_instance_at(&ini_path, None)
        .ok_or_else(|| format!("Invalid MO2 instance at {instance_path}"))?;

    let profile_dir = resolve_profile_dir(&instance.profiles_dir, profile_name)
        .ok_or_else(|| format!("Profile '{profile_name}' not found in {}", instance.profiles_dir))?;
    let plugins_path = profile_dir.join("plugins.txt");
    if !plugins_path.is_file() {
        return Err("plugins.txt does not exist for this profile".into());
    }

    let content = fs::read_to_string(&plugins_path).map_err(|e| e.to_string())?;
    let mut status_map: HashMap<String, bool> = HashMap::new();
    let mut headers = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            headers.push(line.to_string());
            continue;
        }
        let active = trimmed.starts_with('*');
        let name = if active { trimmed[1..].trim().to_string() } else { trimmed.to_string() };
        status_map.insert(name.to_lowercase(), active);
    }

    let mut result_lines = headers;
    for name in ordered_plugin_names {
        let active = status_map.get(&name.to_lowercase()).copied().unwrap_or(true);
        if active {
            result_lines.push(format!("*{name}"));
        } else {
            result_lines.push(name);
        }
    }

    let out = result_lines.join("\r\n") + "\r\n";
    super::operations::atomic_write(&plugins_path, out.as_bytes())
        .map_err(|e| format!("Writing plugins.txt failed: {e}"))?;

    Ok(())
}

/// Switch the active profile in `ModOrganizer.ini`.
pub fn switch_profile(instance_path: &str, profile_name: &str) -> Result<(), String> {
    let clean_profile = clean_ini_val(profile_name);
    let ini_path = Path::new(instance_path).join("ModOrganizer.ini");
    let content = fs::read_to_string(&ini_path).map_err(|e| e.to_string())?;

    let mut new_lines = Vec::new();
    let mut in_general = false;
    let mut replaced = false;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            in_general = trimmed.eq_ignore_ascii_case("[General]");
        }

        if in_general && trimmed.starts_with("selected_profile") {
            new_lines.push(format!("selected_profile = {clean_profile}"));
            replaced = true;
        } else {
            new_lines.push(line.to_string());
        }
    }

    if !replaced {
        new_lines.push(format!("selected_profile = {clean_profile}"));
    }

    let out = new_lines.join("\r\n") + "\r\n";
    super::operations::atomic_write(&ini_path, out.as_bytes())
        .map_err(|e| format!("Writing ModOrganizer.ini failed: {e}"))?;

    Ok(())
}

fn get_instance_profiles_dir(instance_path: &str) -> Result<PathBuf, String> {
    let ini_path = Path::new(instance_path).join("ModOrganizer.ini");
    if !ini_path.is_file() {
        return Err(format!("ModOrganizer.ini not found at {instance_path}"));
    }
    let content = fs::read_to_string(&ini_path).map_err(|e| e.to_string())?;
    let ini = parse_ini(&content);
    let general = ini.get("General").cloned().unwrap_or_default();
    let instance_dir = Path::new(instance_path);
    let base_raw = general.get("base_directory").cloned().unwrap_or_default();
    let base_dir = if base_raw.is_empty() {
        instance_dir.to_path_buf()
    } else {
        PathBuf::from(&base_raw)
    };
    Ok(resolve_mo2_dir(
        &base_dir,
        general.get("profiles_directory").map(|s| s.as_str()).unwrap_or(""),
        "profiles",
    ))
}

/// Create a new profile directory and initialize its files.
pub fn create_profile(
    instance_path: &str,
    profile_name: &str,
    clone_from: Option<&str>,
) -> Result<(), String> {
    let clean_name = profile_name.trim();
    if clean_name.is_empty() {
        return Err("Profile name cannot be empty".to_string());
    }

    let invalid_chars = ['\\', '/', ':', '*', '?', '"', '<', '>', '|'];
    if clean_name.chars().any(|c| invalid_chars.contains(&c)) {
        return Err("Profile name contains invalid characters".to_string());
    }

    let profiles_dir = get_instance_profiles_dir(instance_path)?;
    let target_dir = profiles_dir.join(clean_name);
    if target_dir.exists() {
        return Err(format!("Profile '{clean_name}' already exists"));
    }

    fs::create_dir_all(&target_dir).map_err(|e| format!("Failed to create profile directory: {e}"))?;

    if let Some(src_name) = clone_from.map(|s| s.trim()).filter(|s| !s.is_empty()) {
        let src_dir = profiles_dir.join(src_name);
        if src_dir.is_dir() {
            if let Ok(entries) = fs::read_dir(&src_dir) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    if p.is_file() {
                        let dest = target_dir.join(entry.file_name());
                        let _ = fs::copy(&p, &dest);
                    }
                }
            }
        }
    } else {
        let modlist_path = target_dir.join("modlist.txt");
        let _ = fs::write(&modlist_path, "# This file was automatically generated by Mod Organizer\r\n");
    }

    Ok(())
}

/// Delete an existing profile directory in an MO2 instance.
pub fn delete_profile(instance_path: &str, profile_name: &str) -> Result<(), String> {
    let clean_name = profile_name.trim();
    if clean_name.is_empty() {
        return Err("Profile name cannot be empty".to_string());
    }
    if clean_name.eq_ignore_ascii_case("default") {
        return Err("Cannot delete the Default profile".to_string());
    }

    let ini_path = Path::new(instance_path).join("ModOrganizer.ini");
    if let Ok(content) = fs::read_to_string(&ini_path) {
        let ini = parse_ini(&content);
        if let Some(gen) = ini.get("General") {
            if let Some(sel) = gen.get("selected_profile") {
                if sel.eq_ignore_ascii_case(clean_name) {
                    return Err(format!("Cannot delete active profile '{clean_name}'. Please switch to another profile first."));
                }
            }
        }
    }

    let profiles_dir = get_instance_profiles_dir(instance_path)?;
    let target_dir = profiles_dir.join(clean_name);
    if !target_dir.is_dir() {
        return Err(format!("Profile '{clean_name}' does not exist"));
    }

    fs::remove_dir_all(&target_dir).map_err(|e| format!("Failed to delete profile directory: {e}"))?;

    Ok(())
}

// ─── Launching via MO2 (USVFS) ────────────────────────────────────────────────

/// Launch a game through ModOrganizer.exe with the specified profile and executable.
/// This utilizes MO2's USVFS hooks to virtualize all enabled mods at runtime.
pub fn launch_with_mo2(
    app: &AppHandle,
    game_id: &str,
    game_name: &str,
    instance_path: &str,
    profile_name: &str,
    executable_path_or_title: &str,
    run_as_admin: bool,
) -> Result<String, String> {
    #[derive(Debug, Clone, serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct LaunchProgressPayload {
        game_id: String,
        step: String,
    }

    let launcher_state: Option<tauri::State<'_, std::sync::Arc<std::sync::Mutex<crate::launcher::LauncherSettings>>>> = app.try_state();
    if let Some(launcher) = launcher_state {
        let settings = launcher.lock().map(|s| s.clone()).unwrap_or_default();
        if settings.disable_elevation_prompts && run_as_admin {
            return Err(
                "Launch with admin elevation is blocked by Settings → Disable UAC elevation prompts. Enable the setting or unset \"Run as administrator\" on the game to launch."
                    .to_string(),
            );
        }
    }

    let _ = app.emit(
        "launch-progress",
        LaunchProgressPayload {
            game_id: game_id.to_string(),
            step: "resolvingPaths".to_string(),
        },
    );

    let ini_path = Path::new(instance_path).join("ModOrganizer.ini");
    let instance = parse_instance_at(&ini_path, None)
        .ok_or_else(|| format!("Invalid MO2 instance at {instance_path}"))?;

    let mo_exe = instance.mo_exe_path.as_deref()
        .ok_or_else(|| "ModOrganizer.exe not found for this instance".to_string())?;

    let mo_dir = Path::new(mo_exe).parent().unwrap_or_else(|| Path::new("."));
    let clean_profile = clean_ini_val(profile_name);

    // Make sure the active profile is written before launch
    let _ = switch_profile(instance_path, &clean_profile);

    let _ = app.emit(
        "launch-progress",
        LaunchProgressPayload {
            game_id: game_id.to_string(),
            step: "loadingAssets".to_string(),
        },
    );

    // If an executable path was passed, check if it matches any custom executable title configured in MO2
    let matched_title = if executable_path_or_title.contains('\\') || executable_path_or_title.contains('/') {
        let norm_target = normalize_path_str(executable_path_or_title);
        let target_file_name = Path::new(executable_path_or_title)
            .file_name()
            .map(|f| f.to_string_lossy().to_lowercase())
            .unwrap_or_default();

        instance.custom_executables.iter().find(|e| {
            let norm_e = normalize_path_str(&e.path);
            norm_e == norm_target
                || norm_target.ends_with(&norm_e)
                || norm_e.ends_with(&norm_target)
                || (!target_file_name.is_empty() && norm_e.ends_with(&target_file_name))
        }).map(|e| e.title.clone())
    } else {
        Some(executable_path_or_title.to_string())
    };

    let (is_shortcut, shortcut_arg) = if let Some(title) = matched_title {
        let instance_spec = if instance.is_portable {
            "".to_string()
        } else {
            instance.name.clone()
        };
        (true, format!("moshortcut://{instance_spec}:{title}"))
    } else {
        (false, executable_path_or_title.to_string())
    };

    let (pid, _child) = if run_as_admin {
        #[cfg(windows)]
        {
            let _ = app.emit(
                "launch-progress",
                LaunchProgressPayload {
                    game_id: game_id.to_string(),
                    step: "elevating".to_string(),
                },
            );

            let elevated_args = if is_shortcut {
                format!("\"{shortcut_arg}\"")
            } else {
                format!("-p \"{clean_profile}\" \"{shortcut_arg}\"")
            };

            let elevated_pid = crate::launcher::launch_elevated(
                Path::new(mo_exe),
                mo_dir,
                Some(&elevated_args),
            )?.unwrap_or(0);

            (elevated_pid, None)
        }
        #[cfg(not(windows))]
        {
            return Err("Running as administrator is only supported on Windows".to_string());
        }
    } else {
        let mut cmd = std::process::Command::new(mo_exe);
        cmd.current_dir(mo_dir);
        if is_shortcut {
            cmd.arg(shortcut_arg);
        } else {
            cmd.arg("-p").arg(&clean_profile).arg(shortcut_arg);
        }
        let child = cmd.spawn().map_err(|e| format!("Failed to spawn ModOrganizer.exe: {e}"))?;
        let child_pid = child.id();
        (child_pid, Some(child))
    };

    // Resolve the actual game executable path on disk for GameWatcher tracking
    let real_exe_path: Option<String> = if executable_path_or_title.contains('\\') || executable_path_or_title.contains('/') {
        Some(executable_path_or_title.to_string())
    } else if let Some(exec) = instance.custom_executables.iter().find(|e| {
        e.title.eq_ignore_ascii_case(executable_path_or_title)
            || normalize_path_str(&e.title) == normalize_path_str(executable_path_or_title)
            || normalize_path_str(&e.path) == normalize_path_str(executable_path_or_title)
    }) {
        Some(exec.path.clone())
    } else if let Some(g_path) = {
        let db = app.state::<crate::db::Db>();
        crate::db::games::get(&db, game_id).ok().flatten().map(|g| g.path)
    } {
        Some(g_path)
    } else if let Some(first) = instance.custom_executables.first() {
        Some(first.path.clone())
    } else {
        instance.game_path.clone()
    };

    let _ = app.emit(
        "launch-progress",
        LaunchProgressPayload {
            game_id: game_id.to_string(),
            step: "launching".to_string(),
        },
    );

    // Immediately notify frontend that game is now running
    let _ = app.emit(
        "game-started",
        crate::game_watcher::GameStartedPayload {
            game_id: game_id.to_string(),
            game_name: game_name.to_string(),
            detected_exe: real_exe_path.clone(),
        },
    );

    // Register session in GameWatcher so GameIndex tracks playtime, overlay, and exit.
    // ModOrganizer.exe is a launcher wrapper, so we register with initial_pid 0 (pending launch).
    // GameWatcher's poll loop will detect the real game process (using real_exe_path and its install_dir),
    // attach to its PID, collect telemetry/metrics, and properly detect when the game process exits.
    let watcher: tauri::State<'_, std::sync::Arc<std::sync::Mutex<crate::game_watcher::GameWatcher>>> = app.state();
    if let Ok(mut w) = watcher.lock() {
        let (dummy_stop_tx, _) = std::sync::mpsc::channel();
        let (_, dummy_metrics_rx) = std::sync::mpsc::channel();
        w.register_launched_session(
            app,
            game_id,
            game_name,
            "MO2",
            None,
            real_exe_path.as_deref(),
            0,
            dummy_stop_tx,
            dummy_metrics_rx,
            None,
        );
    }

    Ok(format!("Launched with MO2 (PID {pid})"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_ini_handles_sections_and_comments() {
        let text = r#"
# Comment line
[General]
gameName=Skyrim Special Edition
gamePath=C:\Games\Skyrim
selected_profile=Default

[customExecutables]
size=1
1\title=SKSE
1\custom=C:\Games\Skyrim\skse64_loader.exe
"#;
        let ini = parse_ini(text);
        assert_eq!(ini.get("General").unwrap().get("gameName").unwrap(), "Skyrim Special Edition");
        assert_eq!(ini.get("General").unwrap().get("selected_profile").unwrap(), "Default");
        assert_eq!(ini.get("customExecutables").unwrap().get("1\\title").unwrap(), "SKSE");
    }

    #[test]
    fn test_modlist_toggle_and_reorder() {
        let dir = tempfile::tempdir().unwrap();
        let profiles_dir = dir.path().join("profiles");
        let default_dir = profiles_dir.join("Default");
        fs::create_dir_all(&default_dir).unwrap();

        let ini_content = format!(
            "[General]\r\ngameName=Skyrim\r\nprofiles_directory={}\r\nmods_directory={}\r\n",
            profiles_dir.to_str().unwrap().replace('\\', "/"),
            dir.path().join("mods").to_str().unwrap().replace('\\', "/"),
        );
        fs::write(dir.path().join("ModOrganizer.ini"), ini_content).unwrap();

        let modlist_content = "# Generated by MO2\r\n+SkyUI\r\n-Disabled Mod\r\n+USSEP\r\n";
        let modlist_file = default_dir.join("modlist.txt");
        fs::write(&modlist_file, modlist_content).unwrap();

        // 1. Happy-path: Toggle Disabled Mod to enabled
        set_mod_enabled(dir.path().to_str().unwrap(), "Default", "Disabled Mod", true).unwrap();
        let updated = fs::read_to_string(&modlist_file).unwrap();
        assert!(updated.contains("+Disabled Mod"));

        // 2. Error-path: Mod does not exist
        let err = set_mod_enabled(dir.path().to_str().unwrap(), "Default", "NonexistentMod", true);
        assert!(err.is_err());

        // 3. Reorder mods
        let ordered = vec!["USSEP".to_string(), "Disabled Mod".to_string(), "SkyUI".to_string()];
        reorder_mods(dir.path().to_str().unwrap(), "Default", ordered).unwrap();
        let reordered_content = fs::read_to_string(&modlist_file).unwrap();
        let lines: Vec<&str> = reordered_content.lines().filter(|l| !l.starts_with('#') && !l.trim().is_empty()).collect();
        // In modlist.txt, lines are written in reverse of UI priority:
        assert_eq!(lines[0], "+SkyUI");
        assert_eq!(lines[1], "+Disabled Mod");
        assert_eq!(lines[2], "+USSEP");
    }

    #[test]
    fn test_plugins_toggle_and_reorder() {
        let dir = tempfile::tempdir().unwrap();
        let profiles_dir = dir.path().join("profiles");
        let default_dir = profiles_dir.join("Default");
        fs::create_dir_all(&default_dir).unwrap();

        let ini_content = format!(
            "[General]\r\ngameName=Skyrim\r\nprofiles_directory={}\r\n",
            profiles_dir.to_str().unwrap().replace('\\', "/"),
        );
        fs::write(dir.path().join("ModOrganizer.ini"), ini_content).unwrap();

        let plugins_file = default_dir.join("plugins.txt");
        fs::write(&plugins_file, "*Skyrim.esm\r\n*SkyUI_SE.esp\r\nOptional.esp\r\n").unwrap();

        // 1. Toggle Optional.esp to enabled
        set_plugin_enabled(dir.path().to_str().unwrap(), "Default", "Optional.esp", true).unwrap();
        let content = fs::read_to_string(&plugins_file).unwrap();
        assert!(content.contains("*Optional.esp"));

        // 2. Error path: plugin not found
        let err = set_plugin_enabled(dir.path().to_str().unwrap(), "Default", "NotFound.esp", false);
        assert!(err.is_err());
    }

    #[test]
    fn test_clean_ini_val_and_qt_bytearray() {
        assert_eq!(clean_ini_val("@ByteArray(Custom Hardcore 0.1)"), "Custom Hardcore 0.1");
        assert_eq!(clean_ini_val("@ByteArray(G:\\\\Jeux\\\\stalker)"), "G:\\Jeux\\stalker");
        assert_eq!(clean_ini_val("\"Quoted String\""), "Quoted String");
        assert_eq!(clean_ini_val("@Variant(Normal Value)"), "Normal Value");
    }

    #[test]
    fn test_separator_categories_and_profile_resolution() {
        let dir = tempfile::tempdir().unwrap();
        let profiles_dir = dir.path().join("profiles");
        let profile_dir = profiles_dir.join("My Profile");
        fs::create_dir_all(&profile_dir).unwrap();

        let ini_content = format!(
            "[General]\r\ngameName=STALKER Anomaly\r\nselected_profile=@ByteArray(My Profile)\r\nprofiles_directory={}\r\nmods_directory={}\r\n\r\n[customExecutables]\r\nsize=1\r\n1\\title=Launcher\r\n1\\binary=C:\\Game\\Launcher.exe\r\n",
            profiles_dir.to_str().unwrap().replace('\\', "/"),
            dir.path().join("mods").to_str().unwrap().replace('\\', "/"),
        );
        let ini_file = dir.path().join("ModOrganizer.ini");
        fs::write(&ini_file, ini_content).unwrap();

        let inst = parse_instance_at(&ini_file, None).unwrap();
        assert_eq!(inst.selected_profile, "My Profile");
        assert_eq!(inst.custom_executables.len(), 1);
        assert_eq!(inst.custom_executables[0].title, "Launcher");
        assert_eq!(inst.custom_executables[0].path, "C:\\Game\\Launcher.exe");

        // Write modlist with separators:
        // Remember in modlist.txt, lines are stored in REVERSE priority:
        // Top line = highest priority, bottom line = lowest priority (Priority 0)
        let modlist_content = "# modlist\r\n+Gun Mod\r\n-Weapons_separator\r\n+HD Texture\r\n-Graphics_separator\r\n+Core MCM\r\n";
        fs::write(profile_dir.join("modlist.txt"), modlist_content).unwrap();

        let details = get_profile_details(dir.path().to_str().unwrap(), "@ByteArray(My Profile)").unwrap();
        assert_eq!(details.total_mod_count, 3); // 3 real mods (separators excluded from total_mod_count)
        assert_eq!(details.active_mod_count, 3); // all 3 are enabled

        // When reversed (UI priority 0..N):
        // 0: Core MCM (before any separator -> category is None)
        // 1: Graphics (is_separator=true, category="Graphics")
        // 2: HD Texture (under Graphics separator -> category="Graphics")
        // 3: Weapons (is_separator=true, category="Weapons")
        // 4: Gun Mod (under Weapons separator -> category="Weapons")
        assert_eq!(details.mods[0].name, "Core MCM");
        assert_eq!(details.mods[0].category, None);
        assert_eq!(details.mods[1].name, "Graphics");
        assert!(details.mods[1].is_separator);
        assert_eq!(details.mods[1].category, Some("Graphics".to_string()));
        assert_eq!(details.mods[2].name, "HD Texture");
        assert_eq!(details.mods[2].category, Some("Graphics".to_string()));
        assert_eq!(details.mods[3].name, "Weapons");
        assert!(details.mods[3].is_separator);
        assert_eq!(details.mods[4].name, "Gun Mod");
        assert_eq!(details.mods[4].category, Some("Weapons".to_string()));
    }

    #[test]
    fn test_detect_mo2_instances_hierarchy_and_scoring() {
        let dir = tempfile::tempdir().unwrap();
        // Setup folder tree:
        // root/
        //   MO2/
        //     ModOrganizer.ini
        //   Stalker/
        //     bin/
        //       AnomalyDX11AVX.exe
        let mo2_dir = dir.path().join("MO2");
        let bin_dir = dir.path().join("Stalker").join("bin");
        fs::create_dir_all(&mo2_dir).unwrap();
        fs::create_dir_all(&bin_dir).unwrap();

        let ini_content = format!(
            "[General]\r\ngameName=STALKER Anomaly\r\ngamePath={}\r\n[customExecutables]\r\nsize=1\r\n1\\title=Anomaly (DX11-AVX)\r\n1\\binary={}\r\n",
            dir.path().join("Stalker").to_str().unwrap().replace('\\', "/"),
            bin_dir.join("AnomalyDX11AVX.exe").to_str().unwrap().replace('\\', "/")
        );
        fs::write(mo2_dir.join("ModOrganizer.ini"), ini_content).unwrap();

        let game_exe = bin_dir.join("AnomalyDX11AVX.exe");
        fs::write(&game_exe, b"").unwrap();

        let detected = detect_mo2_instances(game_exe.to_str().unwrap(), "STALKER Anomaly");
        assert!(!detected.is_empty(), "Should detect MO2 in parent hierarchy");
        assert_eq!(normalize_path_str(&detected[0].instance_path), normalize_path_str(mo2_dir.to_str().unwrap()));
        assert_eq!(detected[0].custom_executables[0].title, "Anomaly (DX11-AVX)");
    }

    #[test]
    fn test_custom_executable_path_expansion_and_resolution() {
        let dir = tempfile::tempdir().unwrap();
        let mo2_dir = dir.path().join("MO2");
        let game_dir = dir.path().join("Anomaly");
        let bin_dir = game_dir.join("bin");
        fs::create_dir_all(&mo2_dir).unwrap();
        fs::create_dir_all(&bin_dir).unwrap();

        let exe_file = bin_dir.join("AnomalyDX11AVX.exe");
        fs::write(&exe_file, b"").unwrap();

        let ini_content = format!(
            "[General]\r\ngameName=STALKER Anomaly\r\ngamePath={}\r\n[customExecutables]\r\nsize=1\r\n1\\title=Anomaly (DX11-AVX)\r\n1\\binary=%GAME_PATH%/bin/AnomalyDX11AVX.exe\r\n",
            game_dir.to_str().unwrap().replace('\\', "/")
        );
        let ini_file = mo2_dir.join("ModOrganizer.ini");
        fs::write(&ini_file, ini_content).unwrap();

        let inst = parse_instance_at(&ini_file, None).unwrap();
        assert_eq!(inst.custom_executables.len(), 1);
        assert_eq!(inst.custom_executables[0].title, "Anomaly (DX11-AVX)");
        let expected_path = game_dir.join("bin").join("AnomalyDX11AVX.exe");
        assert_eq!(
            normalize_path_str(&inst.custom_executables[0].path),
            normalize_path_str(expected_path.to_str().unwrap())
        );
    }
}

