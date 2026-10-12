use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::SystemTime;
use tauri::Manager;

use crate::db;
use super::*;
use super::wine::default_prefix_base;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrefixAssociatedGame {
    pub id: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WinePrefixInfo {
    pub id: String,
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    pub is_valid: bool,
    pub is_proton: bool,
    pub arch: String,
    pub win_version: Option<String>,
    pub wine_version: Option<String>,
    pub associated_games: Vec<PrefixAssociatedGame>,
    pub last_modified: Option<u64>,
    pub is_default_base: bool,
    pub is_custom: bool,
}

/// Inspect a WINEPREFIX directory and extract its metadata.
pub fn inspect_prefix_path(path: &Path) -> (bool, bool, String, Option<String>, Option<String>) {
    let pfx_drive_c = path.join("pfx").join("drive_c");
    let standard_drive_c = path.join("drive_c");

    let (is_valid, is_proton, reg_file) = if pfx_drive_c.is_dir() {
        (true, true, path.join("pfx").join("system.reg"))
    } else if standard_drive_c.is_dir() {
        (true, false, path.join("system.reg"))
    } else if path.join("pfx").join("system.reg").is_file() {
        (true, true, path.join("pfx").join("system.reg"))
    } else if path.join("system.reg").is_file() {
        (true, false, path.join("system.reg"))
    } else {
        (false, false, path.join("system.reg"))
    };

    let mut arch = "unknown".to_string();
    let mut win_version = None;
    let mut wine_version = None;

    if reg_file.is_file() {
        if let Ok(content) = fs::read_to_string(&reg_file) {
            for line in content.lines().take(30) {
                let trimmed = line.trim();
                if trimmed.starts_with("#arch=") {
                    arch = trimmed.trim_start_matches("#arch=").to_string();
                    break;
                }
            }

            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with("\"ProductName\"=") {
                    let val = trimmed.trim_start_matches("\"ProductName\"=").trim_matches('"');
                    win_version = Some(val.to_string());
                    break;
                }
                if win_version.is_none() && trimmed.starts_with("\"CurrentVersion\"=") {
                    let val = trimmed.trim_start_matches("\"CurrentVersion\"=").trim_matches('"');
                    win_version = Some(format!("Windows {}", val));
                }
            }

            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with("\"Version\"=") {
                    let val = trimmed.trim_start_matches("\"Version\"=").trim_matches('"');
                    wine_version = Some(val.to_string());
                    break;
                }
            }
        }
    }

    if wine_version.is_none() {
        let proton_ver_file = path.join("version");
        if proton_ver_file.is_file() {
            if let Ok(c) = fs::read_to_string(&proton_ver_file) {
                let v = c.trim();
                if !v.is_empty() {
                    wine_version = Some(v.to_string());
                }
            }
        }
    }

    (is_valid, is_proton, arch, win_version, wine_version)
}

pub(crate) fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ft = entry.file_type()?;
        let dest_path = dst.join(entry.file_name());
        if ft.is_dir() {
            copy_dir_recursive(&entry.path(), &dest_path)?;
        } else if ft.is_file() {
            fs::copy(entry.path(), dest_path)?;
        }
    }
    Ok(())
}

pub fn list_wine_prefixes_sync(app: &tauri::AppHandle) -> Result<Vec<WinePrefixInfo>, String> {
    let settings = get_compatibility_settings_internal(app).unwrap_or_default();
    let base_dir = if let Some(ref d) = settings.default_prefix_base_dir {
        if !d.trim().is_empty() {
            PathBuf::from(d.trim())
        } else {
            default_prefix_base(app)
        }
    } else {
        default_prefix_base(app)
    };

    let db_state: tauri::State<'_, db::Db> = app.state();
    let games = db::games::list_all(db_state.inner()).unwrap_or_default();
    let compat_map = db::compatibility::list_all_for_games(db_state.inner()).unwrap_or_default();

    let default_prefix_path = settings
        .default_prefix
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .map(PathBuf::from);

    let mut game_titles: HashMap<String, String> = HashMap::new();
    let mut custom_prefix_to_games: HashMap<PathBuf, Vec<PrefixAssociatedGame>> = HashMap::new();
    let mut default_prefix_games: Vec<PrefixAssociatedGame> = Vec::new();

    for g in &games {
        game_titles.insert(g.id.clone(), g.name.clone());

        let custom_prefix = compat_map
            .get(&g.id)
            .and_then(|p| p.get("customWinePrefix").or_else(|| p.get("winePrefix")))
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|cp| !cp.is_empty());

        if let Some(cp) = custom_prefix {
            custom_prefix_to_games
                .entry(PathBuf::from(cp))
                .or_default()
                .push(PrefixAssociatedGame {
                    id: g.id.clone(),
                    title: g.name.clone(),
                });
        } else if default_prefix_path.is_some() {
            default_prefix_games.push(PrefixAssociatedGame {
                id: g.id.clone(),
                title: g.name.clone(),
            });
        }
    }

    let merge_associations = |path: &Path, associated: &mut Vec<PrefixAssociatedGame>| {
        let mut push_unique = |item: &PrefixAssociatedGame| {
            if !associated.iter().any(|a| a.id == item.id) {
                associated.push(item.clone());
            }
        };
        if let Some(mapped) = custom_prefix_to_games.get(path) {
            for item in mapped {
                push_unique(item);
            }
        }
        if default_prefix_path.as_deref() == Some(path) {
            for item in &default_prefix_games {
                push_unique(item);
            }
        }
    };

    let mut prefixes: Vec<WinePrefixInfo> = Vec::new();
    let mut seen_paths: std::collections::HashSet<PathBuf> = std::collections::HashSet::new();

    // 1. Scan default base directory
    if base_dir.is_dir() {
        if let Ok(entries) = fs::read_dir(&base_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    let folder_name = entry.file_name().to_string_lossy().to_string();
                    let mut associated = Vec::new();

                    let name = if let Some(title) = game_titles.get(&folder_name) {
                        if default_prefix_path.is_none() {
                            associated.push(PrefixAssociatedGame {
                                id: folder_name.clone(),
                                title: title.clone(),
                            });
                        }
                        title.clone()
                    } else if folder_name == "default" {
                        "Default Prefix".to_string()
                    } else {
                        folder_name.clone()
                    };

                    merge_associations(&path, &mut associated);

                    let (is_valid, is_proton, arch, win_version, wine_version) = inspect_prefix_path(&path);
                    let size_bytes = dir_size_bytes(&path).unwrap_or(0);
                    let last_modified = fs::metadata(&path)
                        .ok()
                        .and_then(|m| m.modified().ok())
                        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs());

                    seen_paths.insert(path.clone());
                    prefixes.push(WinePrefixInfo {
                        id: format!("prefix-{}", folder_name),
                        name,
                        path: path.to_string_lossy().to_string(),
                        size_bytes,
                        is_valid,
                        is_proton,
                        arch,
                        win_version,
                        wine_version,
                        associated_games: associated,
                        last_modified,
                        is_default_base: true,
                        is_custom: false,
                    });
                }
            }
        }
    }

    // 2. Scan custom prefixes attached to games outside base_dir
    for (p, games_list) in &custom_prefix_to_games {
        if !seen_paths.contains(p) && p.is_dir() {
            let folder_name = p
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| p.to_string_lossy().to_string());
            let name = if games_list.len() == 1 {
                games_list[0].title.clone()
            } else {
                folder_name.clone()
            };

            let (is_valid, is_proton, arch, win_version, wine_version) = inspect_prefix_path(p);
            let size_bytes = dir_size_bytes(p).unwrap_or(0);
            let last_modified = fs::metadata(p)
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
                .map(|d| d.as_secs());

            seen_paths.insert(p.clone());
            let mut associated = games_list.clone();
            merge_associations(p, &mut associated);
            prefixes.push(WinePrefixInfo {
                id: format!("custom-{}", folder_name),
                name,
                path: p.to_string_lossy().to_string(),
                size_bytes,
                is_valid,
                is_proton,
                arch,
                win_version,
                wine_version,
                associated_games: associated,
                last_modified,
                is_default_base: false,
                is_custom: true,
            });
        }
    }

    // 3. Scan user registered custom prefixes
    for cp_str in &settings.custom_prefixes {
        let p = PathBuf::from(cp_str.trim());
        if !seen_paths.contains(&p) && p.is_dir() {
            let folder_name = p
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| p.to_string_lossy().to_string());
            let (is_valid, is_proton, arch, win_version, wine_version) = inspect_prefix_path(&p);
            let size_bytes = dir_size_bytes(&p).unwrap_or(0);
            let last_modified = fs::metadata(&p)
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
                .map(|d| d.as_secs());

            seen_paths.insert(p.clone());
            let mut associated = Vec::new();
            merge_associations(&p, &mut associated);
            prefixes.push(WinePrefixInfo {
                id: format!("user-{}", folder_name),
                name: folder_name,
                path: p.to_string_lossy().to_string(),
                size_bytes,
                is_valid,
                is_proton,
                arch,
                win_version,
                wine_version,
                associated_games: associated,
                last_modified,
                is_default_base: false,
                is_custom: true,
            });
        }
    }

    // 3b. Include the shared default prefix even when it lives outside
    // the scanned roots and was never registered as a custom prefix.
    if let Some(default_path) = &default_prefix_path {
        if !seen_paths.contains(default_path) && default_path.is_dir() {
            let folder_name = default_path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "Default Prefix".to_string());
            let (is_valid, is_proton, arch, win_version, wine_version) =
                inspect_prefix_path(default_path);
            let size_bytes = dir_size_bytes(default_path).unwrap_or(0);
            let last_modified = fs::metadata(default_path)
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
                .map(|d| d.as_secs());

            seen_paths.insert(default_path.clone());
            let mut associated = Vec::new();
            merge_associations(default_path, &mut associated);
            prefixes.push(WinePrefixInfo {
                id: format!("shared-{}", folder_name),
                name: folder_name,
                path: default_path.to_string_lossy().to_string(),
                size_bytes,
                is_valid,
                is_proton,
                arch,
                win_version,
                wine_version,
                associated_games: associated,
                last_modified,
                is_default_base: false,
                is_custom: true,
            });
        }
    }

    // 4. Scan ~/.wine if present
    if let Ok(home) = std::env::var("HOME") {
        let wine_dir = PathBuf::from(home).join(".wine");
        if !seen_paths.contains(&wine_dir) && wine_dir.is_dir() {
            let (is_valid, is_proton, arch, win_version, wine_version) = inspect_prefix_path(&wine_dir);
            let size_bytes = dir_size_bytes(&wine_dir).unwrap_or(0);
            let last_modified = fs::metadata(&wine_dir)
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
                .map(|d| d.as_secs());

            let mut associated = Vec::new();
            merge_associations(&wine_dir, &mut associated);
            prefixes.push(WinePrefixInfo {
                id: "system-wine-default".to_string(),
                name: "System Wine (~/.wine)".to_string(),
                path: wine_dir.to_string_lossy().to_string(),
                size_bytes,
                is_valid,
                is_proton,
                arch,
                win_version,
                wine_version,
                associated_games: associated,
                last_modified,
                is_default_base: false,
                is_custom: false,
            });
        }
    }

    prefixes.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(prefixes)
}

#[tauri::command]
pub async fn list_wine_prefixes(app: tauri::AppHandle) -> Result<Vec<WinePrefixInfo>, String> {
    let app_clone = app.clone();
    tokio::task::spawn_blocking(move || list_wine_prefixes_sync(&app_clone))
        .await
        .map_err(|e| format!("Prefix scan task failed: {}", e))?
}

#[tauri::command]
pub async fn create_wine_prefix(
    app: tauri::AppHandle,
    name: String,
    custom_path: Option<String>,
    arch: Option<String>,
    runner_path: Option<String>,
) -> Result<WinePrefixInfo, String> {
    let app_clone = app.clone();
    tokio::task::spawn_blocking(move || {
        let clean_name = name.trim();
        if clean_name.is_empty() {
            return Err("Prefix name cannot be empty".to_string());
        }

        let prefix_dir = if let Some(ref c) = custom_path {
            let c_trimmed = c.trim();
            if !c_trimmed.is_empty() {
                PathBuf::from(c_trimmed)
            } else {
                default_prefix_base(&app_clone).join(clean_name)
            }
        } else {
            default_prefix_base(&app_clone).join(clean_name)
        };

        let is_custom = custom_path
            .as_ref()
            .map(|c| !c.trim().is_empty())
            .unwrap_or(false);

        fs::create_dir_all(&prefix_dir)
            .map_err(|e| format!("Failed to create prefix directory: {}", e))?;

        let settings = get_compatibility_settings_internal(&app_clone).unwrap_or_default();
        let effective_runner = runner_path
            .or_else(|| settings.default_runner_path.clone())
            .unwrap_or_else(|| {
                detect_compatibility_runners()
                    .into_iter()
                    .next()
                    .map(|r| r.path)
                    .unwrap_or_else(|| "wine".to_string())
            });

        let is_proton = runner_is_proton(&effective_runner);
        let effective_arch = arch.unwrap_or_else(|| "win64".to_string());

        let mut cmd = Command::new(&effective_runner);
        if is_proton {
            cmd.arg("run");
            cmd.arg("wineboot");
            cmd.arg("-u");
            cmd.env("STEAM_COMPAT_DATA_PATH", &prefix_dir);
            if let Some(steam) = steam_candidate_roots().into_iter().next() {
                cmd.env("STEAM_COMPAT_CLIENT_INSTALL_PATH", steam.to_string_lossy().to_string());
            }
        } else {
            cmd.arg("wineboot");
            cmd.arg("-u");
        }

        cmd.env("WINEPREFIX", &prefix_dir);
        cmd.env("WINEARCH", &effective_arch);
        cmd.env("WINEDEBUG", "-all");

        let _ = cmd.status();

        if is_custom {
            let path_str = prefix_dir.to_string_lossy().to_string();
            let mut updated_settings = settings;
            if !updated_settings.custom_prefixes.contains(&path_str) {
                updated_settings.custom_prefixes.push(path_str);
                let _ = set_compatibility_settings_internal(&app_clone, &updated_settings);
            }
        }

        let (is_valid, is_proton_res, arch_res, win_version, wine_version) = inspect_prefix_path(&prefix_dir);
        let size_bytes = dir_size_bytes(&prefix_dir).unwrap_or(0);
        let last_modified = fs::metadata(&prefix_dir)
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
            .map(|d| d.as_secs());

        Ok(WinePrefixInfo {
            id: format!("prefix-{}", clean_name),
            name: clean_name.to_string(),
            path: prefix_dir.to_string_lossy().to_string(),
            size_bytes,
            is_valid,
            is_proton: is_proton_res,
            arch: arch_res,
            win_version,
            wine_version,
            associated_games: Vec::new(),
            last_modified,
            is_default_base: !is_custom,
            is_custom,
        })
    })
    .await
    .map_err(|e| format!("Create prefix task failed: {}", e))?
}

#[tauri::command]
pub async fn delete_wine_prefix(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let p = PathBuf::from(path.trim());
    if !p.is_dir() {
        return Err("Directory does not exist.".to_string());
    }

    let components_count = p.components().count();
    if components_count < 3 {
        return Err("Cannot delete root or top-level system directories.".to_string());
    }

    let mut kill_cmd = Command::new("wineserver");
    kill_cmd.arg("-k").env("WINEPREFIX", &p);
    let _ = kill_cmd.status();

    fs::remove_dir_all(&p)
        .map_err(|e| format!("Failed to delete prefix directory: {}", e))?;

    if let Ok(mut settings) = get_compatibility_settings_internal(&app) {
        let path_str = p.to_string_lossy().to_string();
        if settings.custom_prefixes.contains(&path_str) {
            settings.custom_prefixes.retain(|x| x != &path_str);
            let _ = set_compatibility_settings_internal(&app, &settings);
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn clear_wine_prefix(
    app: tauri::AppHandle,
    path: String,
    runner_path: Option<String>,
    arch: Option<String>,
) -> Result<(), String> {
    let app_clone = app.clone();
    tokio::task::spawn_blocking(move || {
        let p = PathBuf::from(path.trim());
        if !p.is_dir() {
            return Err("Prefix directory does not exist.".to_string());
        }

        let mut kill_cmd = Command::new("wineserver");
        kill_cmd.arg("-k").env("WINEPREFIX", &p);
        let _ = kill_cmd.status();

        if let Ok(entries) = fs::read_dir(&p) {
            for entry in entries.flatten() {
                let ep = entry.path();
                if ep.is_dir() {
                    let _ = fs::remove_dir_all(&ep);
                } else {
                    let _ = fs::remove_file(&ep);
                }
            }
        }

        let settings = get_compatibility_settings_internal(&app_clone).unwrap_or_default();
        let effective_runner = runner_path
            .or(settings.default_runner_path)
            .unwrap_or_else(|| "wine".to_string());
        let is_proton = runner_is_proton(&effective_runner);
        let effective_arch = arch.unwrap_or_else(|| "win64".to_string());

        let mut cmd = Command::new(&effective_runner);
        if is_proton {
            cmd.arg("run");
            cmd.arg("wineboot");
            cmd.arg("-u");
            cmd.env("STEAM_COMPAT_DATA_PATH", &p);
            if let Some(steam) = steam_candidate_roots().into_iter().next() {
                cmd.env("STEAM_COMPAT_CLIENT_INSTALL_PATH", steam.to_string_lossy().to_string());
            }
        } else {
            cmd.arg("wineboot");
            cmd.arg("-u");
        }

        cmd.env("WINEPREFIX", &p);
        cmd.env("WINEARCH", &effective_arch);
        cmd.env("WINEDEBUG", "-all");
        let _ = cmd.status();

        Ok(())
    })
    .await
    .map_err(|e| format!("Clear prefix task failed: {}", e))?
}

#[tauri::command]
pub async fn duplicate_wine_prefix(
    app: tauri::AppHandle,
    source_path: String,
    new_name: String,
    target_path: Option<String>,
) -> Result<WinePrefixInfo, String> {
    let app_clone = app.clone();
    tokio::task::spawn_blocking(move || {
        let src = PathBuf::from(source_path.trim());
        if !src.is_dir() {
            return Err("Source prefix directory does not exist.".to_string());
        }

        let clean_name = new_name.trim();
        if clean_name.is_empty() {
            return Err("Duplicate prefix name cannot be empty.".to_string());
        }

        let dst = if let Some(ref tp) = target_path {
            let tp_trimmed = tp.trim();
            if !tp_trimmed.is_empty() {
                PathBuf::from(tp_trimmed)
            } else {
                default_prefix_base(&app_clone).join(clean_name)
            }
        } else {
            default_prefix_base(&app_clone).join(clean_name)
        };

        if dst.exists() {
            return Err("Destination prefix directory already exists.".to_string());
        }

        let mut kill_cmd = Command::new("wineserver");
        kill_cmd.arg("-k").env("WINEPREFIX", &src);
        let _ = kill_cmd.status();

        copy_dir_recursive(&src, &dst)
            .map_err(|e| format!("Failed to duplicate prefix: {}", e))?;

        let is_custom = target_path
            .as_ref()
            .map(|t| !t.trim().is_empty())
            .unwrap_or(false);

        if is_custom {
            if let Ok(mut settings) = get_compatibility_settings_internal(&app_clone) {
                let path_str = dst.to_string_lossy().to_string();
                if !settings.custom_prefixes.contains(&path_str) {
                    settings.custom_prefixes.push(path_str);
                    let _ = set_compatibility_settings_internal(&app_clone, &settings);
                }
            }
        }

        let (is_valid, is_proton, arch, win_version, wine_version) = inspect_prefix_path(&dst);
        let size_bytes = dir_size_bytes(&dst).unwrap_or(0);
        let last_modified = fs::metadata(&dst)
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
            .map(|d| d.as_secs());

        Ok(WinePrefixInfo {
            id: format!("prefix-{}", clean_name),
            name: clean_name.to_string(),
            path: dst.to_string_lossy().to_string(),
            size_bytes,
            is_valid,
            is_proton,
            arch,
            win_version,
            wine_version,
            associated_games: Vec::new(),
            last_modified,
            is_default_base: !is_custom,
            is_custom,
        })
    })
    .await
    .map_err(|e| format!("Duplicate prefix task failed: {}", e))?
}

#[tauri::command]
pub async fn open_prefix_directory(
    _app: tauri::AppHandle,
    prefix_path: String,
    target_subdir: Option<String>,
) -> Result<(), String> {
    let base = PathBuf::from(prefix_path.trim());
    if !base.exists() {
        return Err("Prefix directory does not exist on disk.".to_string());
    }

    let pfx_drive_c = base.join("pfx").join("drive_c");
    let drive_c = if pfx_drive_c.is_dir() {
        pfx_drive_c
    } else {
        base.join("drive_c")
    };

    let target = match target_subdir.as_deref() {
        Some("drive_c") => {
            if drive_c.is_dir() {
                drive_c
            } else {
                base
            }
        }
        Some("appdata") => {
            let users_dir = drive_c.join("users");
            let mut resolved = None;
            if users_dir.is_dir() {
                if let Ok(entries) = fs::read_dir(&users_dir) {
                    for entry in entries.flatten() {
                        let name = entry.file_name().to_string_lossy().to_string();
                        if name != "Public" && name != "Default" {
                            let appdata = entry.path().join("AppData");
                            if appdata.is_dir() {
                                resolved = Some(appdata);
                                break;
                            }
                        }
                    }
                }
            }
            resolved.unwrap_or(if drive_c.is_dir() { drive_c } else { base })
        }
        Some("documents") => {
            let users_dir = drive_c.join("users");
            let mut resolved = None;
            if users_dir.is_dir() {
                if let Ok(entries) = fs::read_dir(&users_dir) {
                    for entry in entries.flatten() {
                        let name = entry.file_name().to_string_lossy().to_string();
                        if name != "Public" && name != "Default" {
                            let docs = entry.path().join("Documents");
                            if docs.is_dir() {
                                resolved = Some(docs);
                                break;
                            }
                        }
                    }
                }
            }
            resolved.unwrap_or(if drive_c.is_dir() { drive_c } else { base })
        }
        _ => base,
    };

    tauri_plugin_opener::open_path(target.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("Failed to open folder: {}", e))
}

#[tauri::command]
pub async fn install_winetricks_verb(
    app: tauri::AppHandle,
    prefix_path: String,
    verb: String,
    runner_path: Option<String>,
) -> Result<(), String> {
    let settings = get_compatibility_settings_internal(&app).unwrap_or_default();
    let bin = settings.winetricks_path.unwrap_or_else(|| "winetricks".to_string());
    let mut cmd = Command::new(bin);

    let clean_verb = verb.trim();
    if !clean_verb.is_empty() && clean_verb != "gui" {
        cmd.arg("-q");
        cmd.arg(clean_verb);
    }

    let effective_runner = runner_path.or(settings.default_runner_path);
    if let Some(ref r) = effective_runner {
        cmd.env("WINE", r);
    }
    cmd.env("WINEPREFIX", prefix_path.trim());

    cmd.spawn()
        .map_err(|e| format!("Failed to spawn winetricks: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn register_custom_prefix(
    app: tauri::AppHandle,
    path: String,
) -> Result<WinePrefixInfo, String> {
    let p = PathBuf::from(path.trim());
    if !p.is_dir() {
        return Err("Selected directory does not exist on disk.".to_string());
    }

    let mut settings = get_compatibility_settings_internal(&app).unwrap_or_default();
    let path_str = p.to_string_lossy().to_string();
    if !settings.custom_prefixes.contains(&path_str) {
        settings.custom_prefixes.push(path_str.clone());
        set_compatibility_settings_internal(&app, &settings)?;
    }

    let folder_name = p
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "Custom Prefix".to_string());
    let (is_valid, is_proton, arch, win_version, wine_version) = inspect_prefix_path(&p);
    let size_bytes = dir_size_bytes(&p).unwrap_or(0);
    let last_modified = fs::metadata(&p)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_secs());

    Ok(WinePrefixInfo {
        id: format!("user-{}", folder_name),
        name: folder_name,
        path: path_str,
        size_bytes,
        is_valid,
        is_proton,
        arch,
        win_version,
        wine_version,
        associated_games: Vec::new(),
        last_modified,
        is_default_base: false,
        is_custom: true,
    })
}

#[tauri::command]
pub async fn unregister_custom_prefix(
    app: tauri::AppHandle,
    path: String,
) -> Result<(), String> {
    let path_str = path.trim().to_string();
    let mut settings = get_compatibility_settings_internal(&app).unwrap_or_default();
    if settings.custom_prefixes.contains(&path_str) {
        settings.custom_prefixes.retain(|x| x != &path_str);
        set_compatibility_settings_internal(&app, &settings)?;
    }
    Ok(())
}
