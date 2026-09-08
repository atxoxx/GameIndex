//! System screenshot folder detection.
//!
//! Scans well-known directories for captures from:
//! - NVIDIA ShadowPlay / GeForce Experience
//! - AMD Radeon ReLive / Adrenalin
//! - OBS Studio
//! - Windows Game Bar / Xbox (Videos\Captures)
//!
//! Each discovered folder is returned with a `source` label so the
//! frontend can badge groups distinctly.

use serde::{Deserialize, Serialize};

/// One folder group returned by the scanner.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SystemScreenshotFolder {
    /// Source identifier: "nvidia", "amd", or "obs".
    pub source: String,
    /// Human-readable group name (game name, folder name, or source label).
    pub game_name: String,
    /// Absolute path to the folder containing these screenshots.
    pub folder_path: String,
    /// Sorted list of absolute paths to image files in this folder.
    pub screenshots: Vec<String>,
}

/// Non-recursive image-file lister for a single directory.
/// Sorted by modified time, newest first.
fn list_image_files_flat(dir: &std::path::Path) -> Vec<String> {
    let mut paths = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() {
                if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
                    let lower = ext.to_lowercase();
                    if lower == "jpg" || lower == "jpeg" || lower == "png"
                        || lower == "gif" || lower == "bmp" || lower == "webp"
                    {
                        paths.push(p.to_string_lossy().to_string());
                    }
                }
            }
        }
    }
    paths.sort_by(|a, b| {
        let ma = std::fs::metadata(a).ok().and_then(|m| m.modified().ok());
        let mb = std::fs::metadata(b).ok().and_then(|m| m.modified().ok());
        mb.cmp(&ma)
    });
    paths
}

/// Auto-detect screenshots from non-Steam capture tools.
///
/// Dispatches to the platform implementation: Windows capture tools
/// (NVIDIA ShadowPlay, AMD ReLive, Xbox Game Bar, OBS) live under
/// `%USERPROFILE%\Videos`; POSIX desktops (Linux/macOS) write GNOME/KDE
/// screenshots and OBS captures under `~/Pictures` / `~/Videos`.
/// Returns an empty Vec when none of the known folders exist or contain
/// images.
#[tauri::command]
pub fn detect_system_screenshot_folders() -> Vec<SystemScreenshotFolder> {
    #[cfg(windows)]
    {
        detect_windows_screenshot_folders()
    }
    #[cfg(not(windows))]
    {
        detect_posix_screenshot_folders()
    }
}

/// Windows capture-tool folders (NVIDIA ShadowPlay / GeForce Experience,
/// AMD Radeon ReLive, Xbox Game Bar captures, OBS).
#[cfg(windows)]
fn detect_windows_screenshot_folders() -> Vec<SystemScreenshotFolder> {
    let userprofile = match std::env::var("USERPROFILE") {
        Ok(p) => std::path::PathBuf::from(p),
        Err(_) => return Vec::new(),
    };
    detect_windows_screenshot_folders_inner(&userprofile)
}

#[cfg(windows)]
fn detect_windows_screenshot_folders_inner(
    userprofile: &std::path::Path,
) -> Vec<SystemScreenshotFolder> {
    let userprofile = userprofile.to_path_buf();

    let mut results: Vec<SystemScreenshotFolder> = Vec::new();

    // ---- NVIDIA ShadowPlay ----
    // Default: %USERPROFILE%\Videos, organized into per-game subfolders.
    let nv_root = userprofile.join("Videos");
    if nv_root.exists() && nv_root.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&nv_root) {
            for entry in entries.flatten() {
                let p = entry.path();
                if !p.is_dir() {
                    continue;
                }
                let game_name = p
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("Unknown")
                    .to_string();
                // Skip known non-game folders
                let lower = game_name.to_lowercase();
                if lower == "desktop" || lower == "captures" || lower == "radeon relive" {
                    continue;
                }
                let images = list_image_files_flat(&p);
                if !images.is_empty() {
                    results.push(SystemScreenshotFolder {
                        source: "nvidia".to_string(),
                        game_name,
                        folder_path: p.to_string_lossy().to_string(),
                        screenshots: images,
                    });
                }
            }
        }
    }

    // ---- Windows Game Bar / Xbox captures ----
    // %USERPROFILE%\Videos\Captures is the default destination for Xbox
    // Game Bar screenshots and clips (Win+G). Recent Windows versions
    // organise captures into per-game subfolders; loose files also land
    // at the root of the Captures folder.
    let win_root = userprofile.join("Videos").join("Captures");
    if win_root.exists() && win_root.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&win_root) {
            for entry in entries.flatten() {
                let p = entry.path();
                if !p.is_dir() {
                    continue;
                }
                let game_name = p
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("Unknown")
                    .to_string();
                let images = list_image_files_flat(&p);
                if !images.is_empty() {
                    results.push(SystemScreenshotFolder {
                        source: "windows".to_string(),
                        game_name,
                        folder_path: p.to_string_lossy().to_string(),
                        screenshots: images,
                    });
                }
            }
        }
        // Loose captures at the root of the Captures folder.
        let root_images = list_image_files_flat(&win_root);
        if !root_images.is_empty() {
            results.push(SystemScreenshotFolder {
                source: "windows".to_string(),
                game_name: "Xbox Game Bar".to_string(),
                folder_path: win_root.to_string_lossy().to_string(),
                screenshots: root_images,
            });
        }
    }

    // ---- AMD Radeon ReLive ----
    let amd_root = userprofile.join("Videos").join("Radeon ReLive");
    if amd_root.exists() && amd_root.is_dir() {
        let mut found_amd = false;
        if let Ok(entries) = std::fs::read_dir(&amd_root) {
            for entry in entries.flatten() {
                let p = entry.path();
                if !p.is_dir() {
                    continue;
                }
                let game_name = p
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("Unknown")
                    .to_string();
                let images = list_image_files_flat(&p);
                if !images.is_empty() {
                    found_amd = true;
                    results.push(SystemScreenshotFolder {
                        source: "amd".to_string(),
                        game_name,
                        folder_path: p.to_string_lossy().to_string(),
                        screenshots: images,
                    });
                }
            }
        }
        // If no subfolders had images, scan the root folder itself
        if !found_amd {
            let images = list_image_files_flat(&amd_root);
            if !images.is_empty() {
                results.push(SystemScreenshotFolder {
                    source: "amd".to_string(),
                    game_name: "AMD ReLive".to_string(),
                    folder_path: amd_root.to_string_lossy().to_string(),
                    screenshots: images,
                });
            }
        }
    }

    // ---- OBS Studio ----
    // OBS defaults to %USERPROFILE%\Videos with no subfolder, but scanning
    // the root Videos dir is too broad (would pick up non-OBS content).
    // Only scan the dedicated OBS subfolder if the user configured one.
    let obs_dir = userprofile.join("Videos").join("OBS");
    if obs_dir.exists() && obs_dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&obs_dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if !p.is_dir() {
                    continue;
                }
                let sub_name = p
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("Unknown")
                    .to_string();
                let images = list_image_files_flat(&p);
                if !images.is_empty() {
                    results.push(SystemScreenshotFolder {
                        source: "obs".to_string(),
                        game_name: sub_name,
                        folder_path: p.to_string_lossy().to_string(),
                        screenshots: images,
                    });
                }
            }
        }
        // Also check for loose screenshots in the OBS folder itself
        if results.iter().filter(|r| r.source == "obs").count() == 0 {
            let images = list_image_files_flat(&obs_dir);
            if !images.is_empty() {
                results.push(SystemScreenshotFolder {
                    source: "obs".to_string(),
                    game_name: "OBS Studio".to_string(),
                    folder_path: obs_dir.to_string_lossy().to_string(),
                    screenshots: images,
                });
            }
        }
    }

    results
}

/// Resolve an XDG user dir (e.g. `XDG_PICTURES_DIR`), falling back to
/// `$HOME/<fallback>` when unset or empty.
#[cfg(not(windows))]
fn posix_user_dir(env: &str, home: &std::path::Path, fallback: &str) -> std::path::PathBuf {
    std::env::var(env)
        .ok()
        .filter(|p| !p.is_empty())
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| home.join(fallback))
}

/// POSIX (Linux/macOS) capture-folder detection.
///
/// Desktop screenshot tools (GNOME/KDE screenshots, Spectacle, OBS,
/// Flameshot, …) write to the user's Pictures / Videos directories.
/// Known tool folders are grouped on their own (`OBS`, `Screenshots`);
/// every other subfolder of Pictures / Videos that contains images is
/// returned as a per-game / per-tool group, mirroring the Windows scan.
#[cfg(not(windows))]
fn detect_posix_screenshot_folders() -> Vec<SystemScreenshotFolder> {
    let home = std::env::var("HOME").unwrap_or_default();
    if home.is_empty() {
        return Vec::new();
    }
    let home_path = std::path::PathBuf::from(&home);
    let pictures = posix_user_dir("XDG_PICTURES_DIR", &home_path, "Pictures");
    let videos = posix_user_dir("XDG_VIDEOS_DIR", &home_path, "Videos");

    let mut results: Vec<SystemScreenshotFolder> = Vec::new();
    let mut seen: std::collections::HashSet<std::path::PathBuf> =
        std::collections::HashSet::new();

    // 1. Known tool folders, grouped under their own source badge.
    let tool_folders: Vec<(String, std::path::PathBuf)> = vec![
        ("obs".to_string(), videos.join("OBS")),
        ("linux".to_string(), pictures.join("Screenshots")),
        ("linux".to_string(), videos.join("Screenshots")),
    ];
    for (source, folder) in tool_folders {
        if !folder.is_dir() {
            continue;
        }
        seen.insert(folder.clone());
        let images = list_image_files_flat(&folder);
        if images.is_empty() {
            continue;
        }
        let game_name = folder
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Screenshots")
            .to_string();
        results.push(SystemScreenshotFolder {
            source: source.clone(),
            game_name,
            folder_path: folder.to_string_lossy().to_string(),
            screenshots: images,
        });
    }

    // 2. Other subfolders under Pictures / Videos (per-game captures,
    //    Steam-tool layouts, custom OBS per-game folders, ...).
    for root in [&pictures, &videos] {
        let Ok(entries) = std::fs::read_dir(root) else {
            continue;
        };
        for entry in entries.flatten() {
            let p = entry.path();
            if !p.is_dir() || seen.contains(&p) {
                continue;
            }
            seen.insert(p.clone());
            let name = p
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("Unknown")
                .to_string();
            let lower = name.to_lowercase();
            if [
                "desktop",
                "captures",
                "radeon relive",
                "obs",
                "recordings",
                "screenshots",
                "template",
                "templates",
                "wallpapers",
                "webcam",
            ]
            .contains(&lower.as_str())
            {
                continue;
            }
            let images = list_image_files_flat(&p);
            if images.is_empty() {
                continue;
            }
            results.push(SystemScreenshotFolder {
                source: "linux".to_string(),
                game_name: name,
                folder_path: p.to_string_lossy().to_string(),
                screenshots: images,
            });
        }
    }

    results
}
