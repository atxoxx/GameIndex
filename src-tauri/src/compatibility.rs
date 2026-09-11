//! Wine, Proton, and Linux compatibility layer runner and environment tools.

use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use crate::db;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompatibilityRunner {
    pub id: String,
    pub name: String,
    pub path: String,
    /// "proton" | "ge-proton" | "cachyos" | "wine" | "custom"
    pub kind: String,
    pub version: Option<String>,
    pub is_proton: bool,
    #[serde(default)]
    pub size_bytes: Option<u64>,
    #[serde(default)]
    pub is_deletable: bool,
    #[serde(default)]
    pub install_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteRunnerRelease {
    pub id: String,
    pub name: String,
    pub tag: String,
    pub source: String,
    pub release_date: String,
    pub download_url: String,
    pub filename: String,
    pub size_bytes: Option<u64>,
    pub body: Option<String>,
    pub html_url: Option<String>,
    pub is_installed: bool,
    #[serde(default)]
    pub target_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunnerInstallProgress {
    pub runner_name: String,
    pub status: String, // "downloading" | "extracting" | "completed" | "failed" | "cancelled"
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub percent: f32,
    pub speed_bytes_per_sec: u64,
    pub error: Option<String>,
}

static ACTIVE_INSTALL_CANCELS: Mutex<Option<HashMap<String, Arc<AtomicBool>>>> = Mutex::new(None);

fn clear_install_cancel(runner_name: &str) {
    if let Ok(mut guard) = ACTIVE_INSTALL_CANCELS.lock() {
        if let Some(map) = guard.as_mut() {
            map.remove(runner_name);
        }
    }
}

fn emit_install_failed(
    app: &tauri::AppHandle,
    runner_name: &str,
    error: String,
    downloaded: u64,
    total_bytes: Option<u64>,
) {
    clear_install_cancel(runner_name);
    let percent = match total_bytes {
        Some(total) if total > 0 => (downloaded as f32 / total as f32) * 100.0,
        _ => 0.0,
    };
    let _ = app.emit(
        "runner-install-progress",
        RunnerInstallProgress {
            runner_name: runner_name.to_string(),
            status: "failed".to_string(),
            downloaded_bytes: downloaded,
            total_bytes,
            percent,
            speed_bytes_per_sec: 0,
            error: Some(error),
        },
    );
}

#[derive(Clone)]
struct RunnerCacheEntry {
    fetched_at: Instant,
    releases: Vec<RemoteRunnerRelease>,
}
static RUNNER_RELEASES_CACHE: Mutex<Option<HashMap<String, RunnerCacheEntry>>> = Mutex::new(None);

#[derive(Deserialize)]
struct GhAsset {
    name: String,
    size: u64,
    browser_download_url: String,
}

#[derive(Deserialize)]
struct GhRelease {
    tag_name: String,
    name: Option<String>,
    published_at: Option<String>,
    body: Option<String>,
    html_url: Option<String>,
    assets: Vec<GhAsset>,
}

/// Recursively compute the disk size of a directory in bytes (ignoring symlinks to prevent cycles).
pub fn dir_size_bytes(path: &Path) -> Option<u64> {
    if !path.exists() {
        return None;
    }
    if path.is_file() {
        return fs::metadata(path).ok().map(|m| m.len());
    }
    let mut total: u64 = 0;
    let mut stack = vec![path.to_path_buf()];
    let mut visited_dirs = 0;
    while let Some(current) = stack.pop() {
        visited_dirs += 1;
        if visited_dirs > 25_000 {
            break;
        }
        if let Ok(entries) = fs::read_dir(&current) {
            for entry in entries.flatten() {
                if let Ok(ft) = entry.file_type() {
                    if ft.is_symlink() {
                        continue;
                    }
                    if ft.is_dir() {
                        stack.push(entry.path());
                    } else if ft.is_file() {
                        if let Ok(meta) = entry.metadata() {
                            total = total.saturating_add(meta.len());
                        }
                    }
                }
            }
        }
    }
    Some(total)
}

/// Locate or resolve the preferred Steam compatibility tools directory (`compatibilitytools.d`).
pub fn steam_compat_tools_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_default();
    if !home.is_empty() {
        let h = PathBuf::from(&home);
        let candidates = [
            h.join(".steam/root/compatibilitytools.d"),
            h.join(".local/share/Steam/compatibilitytools.d"),
            h.join(".steam/steam/compatibilitytools.d"),
            h.join(".var/app/com.valvesoftware.Steam/.local/share/Steam/compatibilitytools.d"),
        ];
        for c in &candidates {
            if c.exists() || c.parent().map(|p| p.exists()).unwrap_or(false) {
                return c.clone();
            }
        }
        return h.join(".local/share/Steam/compatibilitytools.d");
    }

    if let Ok(app_data) = std::env::var("APPDATA") {
        return PathBuf::from(app_data).join("GameIndex").join("compatibilitytools.d");
    }
    PathBuf::from("compatibilitytools.d")
}

/// Locate or resolve GameIndex's custom runner directory.
pub fn gameindex_runners_dir(kind: &str) -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_default();
    if !home.is_empty() {
        let h = PathBuf::from(&home);
        if kind == "wine" {
            let lutris = h.join(".local/share/lutris/runners/wine");
            if lutris.exists() {
                return lutris;
            }
        }
        return h.join(".local/share/GameIndex/runners").join(kind);
    }

    if let Ok(app_data) = std::env::var("APPDATA") {
        return PathBuf::from(app_data).join("GameIndex").join("runners").join(kind);
    }
    PathBuf::from("runners").join(kind)
}

/// Directory for the anti-cheat runtimes GameIndex manages itself.
pub fn gameindex_anticheat_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_default();
    if !home.is_empty() {
        return PathBuf::from(&home).join(".local/share/GameIndex/anticheat");
    }
    if let Ok(app_data) = std::env::var("APPDATA") {
        return PathBuf::from(app_data).join("GameIndex").join("anticheat");
    }
    PathBuf::from("anticheat")
}

/// Folder names for the supported anti-cheat runtime components.
fn anticheat_component_names(kind: &str) -> (&'static str, &'static str, &'static str) {
    if kind == "battleye" {
        ("battleye_runtime", "battleye_runtime", "Proton BattlEye Runtime")
    } else {
        ("eac_runtime", "eac_runtime", "Proton EasyAntiCheat Runtime")
    }
}

/// Every place a runtime may already live: GameIndex's own folder, a Lutris
/// runtime install, then the Steam libraries (Steam installs the runtimes as
/// tool apps alongside games).
fn anticheat_runtime_candidates(kind: &str) -> Vec<PathBuf> {
    let (managed_name, lutris_name, steam_name) = anticheat_component_names(kind);
    let mut candidates = vec![gameindex_anticheat_dir().join(managed_name)];

    if let Ok(home) = std::env::var("HOME") {
        let home = PathBuf::from(home);
        candidates.push(home.join(".local/share/lutris/runtime").join(lutris_name));
    }

    for root in steam_library_roots() {
        candidates.push(root.join("steamapps/common").join(steam_name));
    }

    candidates
}

fn resolve_anticheat_runtime(kind: &str) -> Option<PathBuf> {
    anticheat_runtime_candidates(kind)
        .into_iter()
        .find(|p| p.is_dir())
}

/// Path to the Easy Anti-Cheat runtime, if one is installed.
pub fn eac_runtime_dir() -> Option<PathBuf> {
    resolve_anticheat_runtime("eac")
}

/// Path to the BattlEye runtime, if one is installed.
pub fn battleye_runtime_dir() -> Option<PathBuf> {
    resolve_anticheat_runtime("battleye")
}

#[derive(Debug, Deserialize)]
struct RuntimeIndexEntry {
    name: String,
    url: String,
}

/// Pick the download URL for `name` out of the public runtime index payload.
fn runtime_url_from_index(body: &str, name: &str) -> Result<String, String> {
    let entries: Vec<RuntimeIndexEntry> =
        serde_json::from_str(body).map_err(|e| format!("Failed to parse runtime index: {}", e))?;
    entries
        .into_iter()
        .find(|e| e.name == name)
        .map(|e| e.url)
        .ok_or_else(|| format!("Runtime '{}' is not available from the runtime index", name))
}

/// Extract a runtime archive whose contents live under a single top-level
/// folder, flattening it so the target directory holds `v1/`, `v2/`, ...
fn extract_anticheat_archive(archive_path: &Path, dest_dir: &Path) -> Result<(), String> {
    let _ = fs::remove_dir_all(dest_dir);
    fs::create_dir_all(dest_dir).map_err(|e| format!("Failed to create {}: {}", dest_dir.display(), e))?;

    let tar_bin = if cfg!(windows) { "tar.exe" } else { "tar" };
    let output = Command::new(tar_bin)
        .arg("-xf")
        .arg(archive_path)
        .arg("-C")
        .arg(dest_dir)
        .arg("--strip-components=1")
        .output()
        .map_err(|e| format!("Failed to run {}: {}", tar_bin, e))?;

    if !output.status.success() {
        return Err(format!(
            "Failed to extract runtime archive: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(())
}

async fn download_runtime_archive(
    client: &reqwest::Client,
    url: &str,
    dest_dir: &Path,
) -> Result<(), String> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Failed to download runtime: {}", e))?;
    if !response.status().is_success() {
        return Err(format!("Runtime download failed with status: {}", response.status()));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read runtime download: {}", e))?;

    let parent = dest_dir.parent().unwrap_or_else(|| Path::new("."));
    let _ = fs::create_dir_all(parent);
    let archive_path = parent.join(".runtime_download.tar.xz");
    fs::write(&archive_path, &bytes).map_err(|e| format!("Failed to save runtime archive: {}", e))?;

    let result = extract_anticheat_archive(&archive_path, dest_dir);
    let _ = fs::remove_file(&archive_path);
    result
}

/// Download any missing anti-cheat runtimes (EAC and BattlEye) into the
/// GameIndex folder so games that rely on Proton's runtime env vars work.
#[tauri::command]
pub async fn install_anticheat_runtimes() -> Result<(), String> {
    let missing: Vec<&str> = ["eac", "battleye"]
        .into_iter()
        .filter(|kind| resolve_anticheat_runtime(kind).is_none())
        .collect();
    if missing.is_empty() {
        return Ok(());
    }

    let client = reqwest::Client::builder()
        .user_agent("GameIndex-App/1.0")
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let response = client
        .get("https://lutris.net/api/runtimes")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch the runtime index: {}", e))?;
    if !response.status().is_success() {
        return Err(format!("Runtime index responded with status: {}", response.status()));
    }
    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read the runtime index: {}", e))?;

    for kind in missing {
        let (name, _, _) = anticheat_component_names(kind);
        let url = runtime_url_from_index(&body, name)?;
        let dest = gameindex_anticheat_dir().join(name);
        download_runtime_archive(&client, &url, &dest).await?;
    }

    Ok(())
}

/// Extract an archive file (.tar.gz, .tar.xz, .zip, etc.) into a target directory.
pub fn extract_runner_archive(archive_path: &Path, dest_root: &Path) -> Result<PathBuf, String> {
    let _ = fs::create_dir_all(dest_root);
    let ext = archive_path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    let name_lower = archive_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();

    let is_tar = name_lower.ends_with(".tar.gz")
        || name_lower.ends_with(".tgz")
        || name_lower.ends_with(".tar.xz")
        || name_lower.ends_with(".txz")
        || name_lower.ends_with(".tar.zst")
        || name_lower.ends_with(".tar.bz2")
        || ext == "tar";

    if is_tar {
        let tar_bin = if cfg!(windows) { "tar.exe" } else { "tar" };
        let output = Command::new(tar_bin)
            .arg("-xf")
            .arg(archive_path)
            .arg("-C")
            .arg(dest_root)
            .output()
            .map_err(|e| format!("Failed to run {}: {}", tar_bin, e))?;

        if !output.status.success() {
            let err_msg = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Extraction command failed: {}", err_msg));
        }

        ensure_exec_permissions(dest_root);
        return Ok(dest_root.to_path_buf());
    }

    if ext == "zip" {
        let tar_bin = if cfg!(windows) { "tar.exe" } else { "tar" };
        if let Ok(out) = Command::new(tar_bin)
            .arg("-xf")
            .arg(archive_path)
            .arg("-C")
            .arg(dest_root)
            .output()
        {
            if out.status.success() {
                ensure_exec_permissions(dest_root);
                return Ok(dest_root.to_path_buf());
            }
        }
        #[cfg(not(windows))]
        {
            let out = Command::new("unzip")
                .arg("-q")
                .arg("-o")
                .arg(archive_path)
                .arg("-d")
                .arg(dest_root)
                .output()
                .map_err(|e| format!("Failed to run unzip: {}", e))?;
            if !out.status.success() {
                return Err(format!("unzip failed: {}", String::from_utf8_lossy(&out.stderr)));
            }
            ensure_exec_permissions(dest_root);
            return Ok(dest_root.to_path_buf());
        }
        #[cfg(windows)]
        {
            let out = Command::new("powershell")
                .args([
                    "-NoProfile",
                    "-Command",
                    &format!(
                        "Expand-Archive -Path '{}' -DestinationPath '{}' -Force",
                        archive_path.to_string_lossy(),
                        dest_root.to_string_lossy()
                    ),
                ])
                .output()
                .map_err(|e| format!("Powershell extraction failed: {}", e))?;
            if !out.status.success() {
                return Err(format!("Powershell extraction failed: {}", String::from_utf8_lossy(&out.stderr)));
            }
            return Ok(dest_root.to_path_buf());
        }
    }

    Err(format!("Unsupported archive format for file: {}", archive_path.display()))
}

fn ensure_exec_permissions(root: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut stack = vec![root.to_path_buf()];
        while let Some(dir) = stack.pop() {
            if let Ok(entries) = fs::read_dir(&dir) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    if let Ok(ft) = entry.file_type() {
                        if ft.is_dir() {
                            stack.push(p);
                        } else if ft.is_file() {
                            let name = entry.file_name().to_string_lossy().to_string();
                            let is_bin = name == "proton"
                                || name == "wine"
                                || name == "wineserver"
                                || name == "wine64"
                                || p.to_string_lossy().contains("/bin/");
                            if is_bin {
                                if let Ok(meta) = entry.metadata() {
                                    let mut perms = meta.permissions();
                                    perms.set_mode(perms.mode() | 0o755);
                                    let _ = fs::set_permissions(&p, perms);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    #[cfg(not(unix))]
    let _ = root;
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinuxSystemStatus {
    pub os_name: String,
    pub kernel_version: String,
    pub display_server: String,
    pub vulkan_support: bool,
    pub gamemode_available: bool,
    pub mangohud_available: bool,
    pub gamescope_available: bool,
    pub winetricks_available: bool,
    pub umu_available: bool,
    #[serde(default)]
    pub eac_runtime_available: bool,
    #[serde(default)]
    pub battleye_runtime_available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CompatibilitySettings {
    pub default_runner_path: Option<String>,
    pub default_prefix_base_dir: Option<String>,
    /// Shared WINEPREFIX used by every game unless the game overrides it.
    pub default_prefix: Option<String>,
    pub enable_dxvk: bool,
    pub enable_vkd3d: bool,
    pub enable_esync: bool,
    pub enable_fsync: bool,
    pub enable_dxvk_nvapi: bool,
    /// Frontend spells this `enableMangoHud`; older settings rows in
    /// `compatibility.db` carry the naive camelCase `enableMangohud`, so
    /// both must load and saves emit the frontend key.
    #[serde(rename = "enableMangoHud", alias = "enableMangohud")]
    pub enable_mangohud: bool,
    /// Same legacy-key story as `enable_mangohud`: the UI uses
    /// `enableGameMode`, not serde's `enableGamemode`.
    #[serde(rename = "enableGameMode", alias = "enableGamemode")]
    pub enable_gamemode: bool,
    pub enable_gamescope: bool,
    pub gamescope_args: Option<String>,
    pub prime_render_offload: bool,
    #[serde(default)]
    pub use_specific_gpu: bool,
    #[serde(default)]
    pub specific_gpu_id: Option<String>,
    pub custom_environment_variables: HashMap<String, String>,
    pub custom_dll_overrides: HashMap<String, String>,
    pub winetricks_path: Option<String>,

    // Wine sync, architecture & engine additions
    #[serde(default)]
    pub enable_ntsync: bool,
    #[serde(default)]
    pub enable_dxvk_async: bool,
    #[serde(default)]
    pub enable_wayland: bool,
    #[serde(default)]
    pub enable_wow64: bool,
    #[serde(default)]
    pub enable_large_address_aware: bool,
    #[serde(default)]
    pub wine_debug: Option<String>,
    #[serde(default)]
    pub audio_driver: Option<String>,
    #[serde(default)]
    pub virtual_desktop: bool,
    #[serde(default)]
    pub virtual_desktop_res: Option<String>,
    #[serde(default)]
    pub enable_umu_launcher: bool,
    #[serde(default)]
    pub mangohud_hidden: bool,
    #[serde(default)]
    pub enable_controller_support: bool,
    #[serde(default)]
    pub enable_anticheat_support: bool,

    // Structured Gamescope settings
    #[serde(default)]
    pub gamescope_mode: Option<String>,
    #[serde(default)]
    pub gamescope_game_width: Option<u32>,
    #[serde(default)]
    pub gamescope_game_height: Option<u32>,
    #[serde(default)]
    pub gamescope_window_width: Option<u32>,
    #[serde(default)]
    pub gamescope_window_height: Option<u32>,
    #[serde(default)]
    pub gamescope_filter: Option<String>,
    #[serde(default)]
    pub gamescope_fsr_sharpness: Option<u32>,
    #[serde(default)]
    pub gamescope_fps_limit: Option<u32>,
    #[serde(default)]
    pub gamescope_refresh_rate: Option<u32>,
    #[serde(default)]
    pub gamescope_adaptive_sync: bool,
    #[serde(default)]
    pub gamescope_hdr: bool,
    #[serde(default)]
    pub gamescope_stretch: bool,
    #[serde(default)]
    pub gamescope_force_windows_fullscreen: bool,
    #[serde(default)]
    pub custom_prefixes: Vec<String>,
}

impl Default for CompatibilitySettings {
    fn default() -> Self {
        Self {
            default_runner_path: None,
            default_prefix_base_dir: None,
            default_prefix: None,
            enable_dxvk: true,
            enable_vkd3d: true,
            enable_esync: true,
            enable_fsync: true,
            enable_dxvk_nvapi: false,
            enable_mangohud: false,
            enable_gamemode: false,
            enable_gamescope: false,
            gamescope_args: Some("-w 1920 -h 1080 -F fsr -f".to_string()),
            prime_render_offload: false,
            use_specific_gpu: false,
            specific_gpu_id: None,
            custom_environment_variables: HashMap::new(),
            custom_dll_overrides: HashMap::new(),
            winetricks_path: None,

            enable_ntsync: false,
            enable_dxvk_async: false,
            enable_wayland: false,
            enable_wow64: false,
            enable_large_address_aware: false,
            wine_debug: Some("-all".to_string()),
            audio_driver: None,
            virtual_desktop: false,
            virtual_desktop_res: Some("1920x1080".to_string()),

            enable_umu_launcher: false,
            mangohud_hidden: false,
            enable_controller_support: false,
            enable_anticheat_support: false,

            gamescope_mode: Some("fullscreen".to_string()),
            gamescope_game_width: Some(1920),
            gamescope_game_height: Some(1080),
            gamescope_window_width: None,
            gamescope_window_height: None,
            gamescope_filter: Some("fsr".to_string()),
            gamescope_fsr_sharpness: Some(5),
            gamescope_fps_limit: None,
            gamescope_refresh_rate: None,
            gamescope_adaptive_sync: false,
            gamescope_hdr: false,
            gamescope_stretch: false,
            gamescope_force_windows_fullscreen: false,
            custom_prefixes: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WineLogResult {
    pub game_id: String,
    pub log_content: String,
    pub exists: bool,
    pub last_modified: Option<u64>,
    pub size_bytes: u64,
    pub log_path: String,
}

static COMMAND_CACHE: std::sync::Mutex<Option<HashMap<String, bool>>> = std::sync::Mutex::new(None);

/// Helper: check if a command executable is available in PATH (cached & fast on Windows).
pub fn is_command_available(cmd: &str) -> bool {
    if let Ok(mut lock) = COMMAND_CACHE.lock() {
        if lock.is_none() {
            *lock = Some(HashMap::new());
        }
        if let Some(map) = lock.as_mut() {
            if let Some(&cached) = map.get(cmd) {
                return cached;
            }
            #[cfg(windows)]
            let avail = {
                let path_var = std::env::var("PATH").unwrap_or_default();
                let has_ext = cmd.ends_with(".exe") || cmd.ends_with(".cmd") || cmd.ends_with(".bat");
                let exts = [".exe", ".cmd", ".bat"];
                std::env::split_paths(&path_var).any(|dir| {
                    if has_ext {
                        dir.join(cmd).is_file()
                    } else {
                        exts.iter().any(|ext| dir.join(format!("{}{}", cmd, ext)).is_file())
                    }
                })
            };
            #[cfg(not(windows))]
            let avail = Command::new("which").arg(cmd).output().map(|o| o.status.success()).unwrap_or(false);

            map.insert(cmd.to_string(), avail);
            return avail;
        }
    }
    false
}

/// Locate system and user Steam installation folders.
pub fn steam_candidate_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    let home = std::env::var("HOME").unwrap_or_default();
    if !home.is_empty() {
        let h = PathBuf::from(&home);
        roots.push(h.join(".steam/steam"));
        roots.push(h.join(".local/share/Steam"));
        roots.push(h.join(".var/app/com.valvesoftware.Steam/.steam/steam"));
        roots.push(h.join(".var/app/com.valvesoftware.Steam/.local/share/Steam"));
        roots.push(PathBuf::from("/snap/steam/common/.steam/steam"));
    }
    roots.retain(|p| p.exists());
    roots
}

/// Pull the values for `wanted_key` out of a simple VDF file (a flat
/// list of `"key" "value"` pairs). Used to resolve `install_path` in
/// system-package compatibility tool manifests.
fn vdf_key_values(raw: &str, wanted_key: &str) -> Vec<String> {
    let parts: Vec<&str> = raw.split('"').collect();
    let mut out = Vec::new();
    let mut i = 1;
    while i + 2 < parts.len() {
        if parts[i] == wanted_key {
            let val = parts[i + 2].trim();
            if !val.is_empty() {
                out.push(val.to_string());
            }
        }
        i += 2;
    }
    out
}

/// Parse the contents of `steamapps/libraryfolders.vdf` and return every
/// library root it declares (both the modern numeric-key format and the
/// legacy nested `"path"` format). Accepts `/`-prefixed Linux paths as
/// well as Windows drive / UNC paths.
fn parse_library_folders_vdf(raw: &str) -> Vec<PathBuf> {
    let parts: Vec<&str> = raw.split('"').collect();
    let mut out = Vec::new();
    let mut i = 1;
    while i + 2 < parts.len() {
        let key = parts[i];
        if key == "path" || (!key.is_empty() && key.chars().all(|c| c.is_ascii_digit())) {
            let val = parts[i + 2].trim();
            if !val.is_empty() {
                let p = PathBuf::from(val);
                let is_abs = p.is_absolute() || val.starts_with('/') || val.starts_with('\\');
                if is_abs && !out.contains(&p) {
                    out.push(p);
                }
            }
        }
        i += 2;
    }
    out
}

/// Read `steamapps/libraryfolders.vdf` and return every library root it
/// declares.
fn steam_library_folders(steam_root: &Path) -> Vec<PathBuf> {
    let vdf = steam_root.join("steamapps/libraryfolders.vdf");
    let Ok(raw) = fs::read_to_string(&vdf) else { return Vec::new() };
    parse_library_folders_vdf(&raw)
}

/// Steam install roots: the standard candidate folders plus every
/// secondary library declared in `libraryfolders.vdf`.
fn steam_library_roots() -> Vec<PathBuf> {
    let mut roots = steam_candidate_roots();
    let mut seen: std::collections::HashSet<PathBuf> = roots.iter().cloned().collect();
    for root in steam_candidate_roots() {
        for lib in steam_library_folders(&root) {
            if seen.insert(lib.clone()) {
                roots.push(lib);
            }
        }
    }
    roots
}

/// True when the compatibility tool name belongs to CachyOS Proton
/// (`CachyOS-Proton*`, `cachyos-proton*`, `proton-cachyos*`).
fn is_cachyos_proton(name: &str) -> bool {
    name.to_lowercase().contains("cachyos")
}

/// Extract the version out of a CachyOS Proton tool name, e.g.
/// `proton-cachyos-10.0-20251222-slr` → `10.0-20251222-slr`. Returns an
/// empty string when the name carries no version part.
fn cachyos_version(name: &str) -> String {
    let lower = name.to_lowercase();
    for (lower_prefix, orig_prefix) in [
        ("proton-cachyos-", "proton-cachyos-"),
        ("cachyos-proton-", "cachyos-proton-"),
        ("proton-cachyos", "proton-cachyos"),
        ("cachyos-proton", "cachyos-proton"),
    ] {
        if lower.starts_with(lower_prefix) {
            return name[orig_prefix.len()..].trim_matches('-').to_string();
        }
    }
    String::new()
}

/// Detect installed compatibility runners: Steam Proton, GE-Proton,
/// CachyOS Proton, system Wine, and custom runners.
pub fn detect_compatibility_runners() -> Vec<CompatibilityRunner> {
    let mut runners = Vec::new();
    let mut seen_paths = std::collections::HashSet::new();

    // Steam roots include the standard install folders plus every
    // secondary library declared in `libraryfolders.vdf`, so Proton
    // installs on other drives are found too.
    let steam_roots = steam_library_roots();

    // 1. Steam Proton installs
    for root in &steam_roots {
        let common = root.join("steamapps/common");
        if let Ok(entries) = fs::read_dir(&common) {
            for e in entries.flatten() {
                let name = e.file_name().to_string_lossy().to_string();
                if name.starts_with("Proton") {
                    let script = e.path().join("proton");
                    let p_str = script.to_string_lossy().to_string();
                    if script.exists() && seen_paths.insert(p_str.clone()) {
                        let ver = name
                            .trim_start_matches("Proton ")
                            .trim_start_matches("Proton-")
                            .to_string();
                        let install_dir_path = e.path();
                        let size = dir_size_bytes(&install_dir_path);
                        runners.push(CompatibilityRunner {
                            id: format!("steam-{}", name.to_lowercase().replace(' ', "-")),
                            name: format!("Steam {}", name),
                            path: p_str,
                            kind: "proton".to_string(),
                            version: Some(ver),
                            is_proton: true,
                            size_bytes: size,
                            is_deletable: false,
                            install_dir: Some(install_dir_path.to_string_lossy().to_string()),
                        });
                    }
                }
            }
        }
    }

    // 2. Compatibility tools in `compatibilitytools.d` — user Steam
    //    roots plus the system-wide distro directory (CachyOS ships
    //    proton-cachyos to /usr/share/steam/compatibilitytools.d).
    #[allow(unused_mut)]
    let mut compat_dirs: Vec<PathBuf> = steam_roots
        .iter()
        .map(|r| r.join("compatibilitytools.d"))
        .collect();
    #[cfg(target_os = "linux")]
    compat_dirs.push(PathBuf::from("/usr/share/steam/compatibilitytools.d"));

    // Also include user steam compatibility tools dir if not already present
    let default_compat = steam_compat_tools_dir();
    if !compat_dirs.contains(&default_compat) {
        compat_dirs.push(default_compat);
    }

    for dir in &compat_dirs {
        let Ok(entries) = fs::read_dir(dir) else { continue };
        let is_system_dir = dir.starts_with("/usr") || dir.starts_with("/var");
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            let base_name = name.trim_end_matches(".vdf");
            let install_dir_path = e.path();
            let is_del = !is_system_dir && install_dir_path.is_dir();
            let size = dir_size_bytes(&install_dir_path);

            // System-package layout: a bare VDF at the top of
            // compatibilitytools.d whose `install_path` points at the
            // real tool directory (used by newer CachyOS packaging).
            let script = if name.ends_with(".vdf") {
                fs::read_to_string(&install_dir_path)
                    .ok()
                    .and_then(|raw| {
                        vdf_key_values(&raw, "install_path")
                            .into_iter()
                            .next()
                            .map(|p| PathBuf::from(p).join("proton"))
                    })
            } else {
                Some(install_dir_path.join("proton"))
            };

            let Some(script) = script else { continue };
            let p_str = script.to_string_lossy().to_string();
            if !script.exists() || !seen_paths.insert(p_str.clone()) {
                continue;
            }

            if is_cachyos_proton(base_name) {
                let ver = cachyos_version(base_name);
                let display = if ver.is_empty() {
                    "CachyOS Proton".to_string()
                } else {
                    format!("CachyOS Proton ({})", ver)
                };
                runners.push(CompatibilityRunner {
                    id: format!("cachyos-{}", base_name.to_lowercase().replace(' ', "-")),
                    name: display,
                    path: p_str,
                    kind: "cachyos".to_string(),
                    version: if ver.is_empty() { None } else { Some(ver) },
                    is_proton: true,
                    size_bytes: size,
                    is_deletable: is_del,
                    install_dir: Some(install_dir_path.to_string_lossy().to_string()),
                });
            } else {
                runners.push(CompatibilityRunner {
                    id: format!("compat-{}", base_name.to_lowercase().replace(' ', "-")),
                    name: base_name.to_string(),
                    path: p_str,
                    kind: "ge-proton".to_string(),
                    version: Some(base_name.to_string()),
                    is_proton: true,
                    size_bytes: size,
                    is_deletable: is_del,
                    install_dir: Some(install_dir_path.to_string_lossy().to_string()),
                });
            }
        }
    }

    // 3. User runner folders in standard Linux directories
    let home = std::env::var("HOME").unwrap_or_default();
    if !home.is_empty() {
        let h = PathBuf::from(&home);
        let runner_dirs = [
            h.join(".local/share/runners/wine"),
            h.join(".local/share/wine/runners"),
            h.join(".local/share/lutris/runners/wine"),
            h.join(".config/heroic/tools/wine"),
            h.join(".config/heroic/tools/proton"),
            h.join(".local/share/proton-runners"),
            h.join(".local/share/wine-custom"),
            h.join(".local/share/GameIndex/runners/proton"),
            h.join(".local/share/GameIndex/runners/wine"),
        ];

        for dir in &runner_dirs {
            if let Ok(entries) = fs::read_dir(dir) {
                for e in entries.flatten() {
                    let name = e.file_name().to_string_lossy().to_string();
                    let wine_bin = e.path().join("bin/wine");
                    let proton_bin = e.path().join("proton");
                    let install_dir_path = e.path();
                    let size = dir_size_bytes(&install_dir_path);

                    if proton_bin.exists() {
                        let p_str = proton_bin.to_string_lossy().to_string();
                        if seen_paths.insert(p_str.clone()) {
                            runners.push(CompatibilityRunner {
                                id: format!("runner-proton-{}", name.to_lowercase().replace(' ', "-")),
                                name: format!("Proton ({})", name),
                                path: p_str,
                                kind: "proton".to_string(),
                                version: Some(name),
                                is_proton: true,
                                size_bytes: size,
                                is_deletable: true,
                                install_dir: Some(install_dir_path.to_string_lossy().to_string()),
                            });
                        }
                    } else if wine_bin.exists() {
                        let p_str = wine_bin.to_string_lossy().to_string();
                        if seen_paths.insert(p_str.clone()) {
                            runners.push(CompatibilityRunner {
                                id: format!("runner-wine-{}", name.to_lowercase().replace(' ', "-")),
                                name: format!("Wine ({})", name),
                                path: p_str,
                                kind: "wine".to_string(),
                                version: Some(name),
                                is_proton: false,
                                size_bytes: size,
                                is_deletable: true,
                                install_dir: Some(install_dir_path.to_string_lossy().to_string()),
                            });
                        }
                    }
                }
            }
        }
    }

    // Fallback runner directories (Windows / custom standalone path)
    let fallback_dirs = [
        gameindex_runners_dir("proton"),
        gameindex_runners_dir("wine"),
    ];
    for dir in &fallback_dirs {
        if !dir.exists() {
            continue;
        }
        if let Ok(entries) = fs::read_dir(dir) {
            for e in entries.flatten() {
                let name = e.file_name().to_string_lossy().to_string();
                let wine_bin = e.path().join("bin/wine");
                let proton_bin = e.path().join("proton");
                let install_dir_path = e.path();
                let size = dir_size_bytes(&install_dir_path);

                if proton_bin.exists() {
                    let p_str = proton_bin.to_string_lossy().to_string();
                    if seen_paths.insert(p_str.clone()) {
                        let kind = if name.to_lowercase().contains("ge") { "ge-proton" } else { "proton" };
                        runners.push(CompatibilityRunner {
                            id: format!("custom-proton-{}", name.to_lowercase().replace(' ', "-")),
                            name: name.clone(),
                            path: p_str,
                            kind: kind.to_string(),
                            version: Some(name),
                            is_proton: true,
                            size_bytes: size,
                            is_deletable: true,
                            install_dir: Some(install_dir_path.to_string_lossy().to_string()),
                        });
                    }
                } else if wine_bin.exists() {
                    let p_str = wine_bin.to_string_lossy().to_string();
                    if seen_paths.insert(p_str.clone()) {
                        runners.push(CompatibilityRunner {
                            id: format!("custom-wine-{}", name.to_lowercase().replace(' ', "-")),
                            name: name.clone(),
                            path: p_str,
                            kind: "wine".to_string(),
                            version: Some(name),
                            is_proton: false,
                            size_bytes: size,
                            is_deletable: true,
                            install_dir: Some(install_dir_path.to_string_lossy().to_string()),
                        });
                    }
                }
            }
        }
    }

    // 4. System Wine from PATH
    #[cfg(not(windows))]
    if let Ok(out) = Command::new("which").arg("wine").output() {
        if out.status.success() {
            let wp = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !wp.is_empty() && seen_paths.insert(wp.clone()) {
                let ver = Command::new("wine")
                    .arg("--version")
                    .output()
                    .ok()
                    .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());
                let disp = ver.as_deref().unwrap_or("System");
                runners.push(CompatibilityRunner {
                    id: "system-wine".to_string(),
                    name: format!("System Wine ({})", disp),
                    path: wp,
                    kind: "wine".to_string(),
                    version: ver,
                    is_proton: false,
                    size_bytes: None,
                    is_deletable: false,
                    install_dir: None,
                });
            }
        }
    }

    // Sort: GE-Proton, CachyOS Proton, Steam Proton, Wine runners, then system Wine
    runners.sort_by_key(|r| match r.kind.as_str() {
        "ge-proton" => 0,
        "cachyos" => 1,
        "proton" => 2,
        "wine" => 3,
        _ => 4,
    });

    runners
}

/// Path-only fallback used when a runner isn't in the detection list
/// (custom wrappers, plain `wine` on PATH): Proton scripts live under a
/// path containing "proton" (Steam's `…/Proton 9.0/proton`, GE-Proton,
/// CachyOS), while every Wine binary path ends in the `wine` executable.
fn proton_by_path_heuristic(path: &str) -> bool {
    path.contains("proton") && !path.ends_with("wine")
}

/// True when `runner_path` is a Proton-style runner (needs the `run`
/// subcommand plus the Steam compat env vars) rather than a plain Wine
/// binary. Prefers the authoritative `is_proton` flag from
/// `detect_compatibility_runners` for known installs — the heuristic is
/// only a fallback for paths that never appear in the detection list.
pub fn runner_is_proton(runner_path: &str) -> bool {
    if let Some(r) = detect_compatibility_runners()
        .into_iter()
        .find(|r| r.path == runner_path)
    {
        return r.is_proton;
    }
    proton_by_path_heuristic(runner_path)
}

/// The Proton installation folder for a runner path — the parent
/// directory of the `proton` script. umu-launcher's `PROTONPATH`
/// expects the folder (containing `proton`, `dist/`, …), not the
/// script itself. Returns `None` for plain Wine binaries.
pub fn proton_folder_for_runner(runner_path: &str) -> Option<PathBuf> {
    let parent = Path::new(runner_path).parent()?;
    if parent.join("proton").is_file() {
        Some(parent.to_path_buf())
    } else {
        None
    }
}

/// Locate the `umu-run` executable: on `PATH` first, then the standard
/// umu-launcher install locations (`~/.local/share/umu/umu_run` is the
/// canonical data-dir script, `~/.local/bin/umu-run` the user-install
/// wrapper, plus the system paths). Never an error — callers fall back
/// to the direct Wine/Proton invocation.
#[cfg(target_os = "linux")]
pub fn find_umu_run() -> Option<PathBuf> {
    if is_command_available("umu-run") {
        return Some(PathBuf::from("umu-run"));
    }
    let home = std::env::var("HOME").ok()?;
    [
        PathBuf::from(&home).join(".local/share/umu/umu_run"),
        PathBuf::from(&home).join(".local/bin/umu-run"),
        PathBuf::from("/usr/share/umu/umu_run"),
        PathBuf::from("/usr/bin/umu-run"),
    ]
    .into_iter()
    .find(|p| p.exists())
}

#[cfg(not(target_os = "linux"))]
pub fn find_umu_run() -> Option<PathBuf> {
    None
}

/// Build the MangoHud CSV-logging config used for GameIndex sessions:
/// one line per second into `folder` so `metrics_collector` finds the
/// frame log. `read_cfg` must come first: `MANGOHUD_CONFIG` otherwise
/// replaces the user's `MangoHud.conf` wholesale, and only keys listed
/// after it override the file. When `hidden` the overlay starts hidden
/// (`no_display`, toggled back with the MangoHud hotkey) while still
/// logging — useful when the overlay is only needed for telemetry, not
/// on screen.
pub fn mangohud_log_config(folder: &Path, hidden: bool) -> String {
    let mut cfg = format!(
        "read_cfg,log_interval=1000,output_folder={},autostart_log=1",
        folder.display()
    );
    if hidden {
        cfg.push_str(",no_display");
    }
    cfg
}

/// Whether the specific-GPU launch override is active. The per-game
/// `useSpecificGpu` tri-state wins over the global `use_specific_gpu`.
pub fn specific_gpu_enabled(
    settings: &CompatibilitySettings,
    game_profile: Option<&serde_json::Value>,
) -> bool {
    game_profile
        .and_then(|p| p.get("useSpecificGpu"))
        .and_then(|v| v.as_bool())
        .unwrap_or(settings.use_specific_gpu)
}

/// GPU identity handed to the launch environment. Mirrors the fields the
/// frontend `GpuInfo` carries; every field is optional because older
/// payloads and the tray-launch path only persist a single id string.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GpuSelection {
    /// PCI `vendor:device`, e.g. `10de:2c05`.
    pub pci_id: Option<String>,
    /// PCI slot, e.g. `0000:01:00.0` — unique for identical cards.
    pub pci_slot: Option<String>,
    /// Vulkan `deviceUUID` (32 hex chars; dashes are stripped).
    pub vulkan_uuid: Option<String>,
    /// Position in the Vulkan device enumeration.
    pub vulkan_index: Option<u32>,
    /// `NVIDIA`, `AMD`, `Intel`, …
    pub vendor: Option<String>,
    /// RandR offload-screen name (`NVIDIA-G0`).
    pub nvidia_provider: Option<String>,
}

impl GpuSelection {
    fn is_empty(&self) -> bool {
        self.pci_id.is_none()
            && self.pci_slot.is_none()
            && self.vulkan_uuid.is_none()
            && self.vulkan_index.is_none()
            && self.nvidia_provider.is_none()
    }
}

/// Normalize a `vendor:device` string, rejecting anything else. Shared with tests.
pub(crate) fn normalized_pci_id(raw: &str) -> Option<String> {
    let value = raw.trim().to_lowercase();
    let bytes = value.as_bytes();
    let shape_ok = bytes.len() == 9
        && bytes[4] == b':'
        && bytes[..4].iter().all(u8::is_ascii_hexdigit)
        && bytes[5..].iter().all(u8::is_ascii_hexdigit);
    shape_ok.then_some(value)
}

/// Normalize a `0000:01:00.0` PCI slot, rejecting anything else. Shared with tests.
pub(crate) fn normalized_pci_slot(raw: &str) -> Option<String> {
    let value = raw.trim().to_lowercase();
    let bytes = value.as_bytes();
    let hex_at = |i: usize| bytes.get(i).is_some_and(u8::is_ascii_hexdigit);
    let shape_ok = bytes.len() == 12
        && bytes[4] == b':'
        && bytes[7] == b':'
        && bytes[10] == b'.'
        && [0, 1, 2, 3, 5, 6, 8, 9, 11].iter().all(|&i| hex_at(i));
    shape_ok.then_some(value)
}

/// Normalize an `NVIDIA-G<n>` provider name, rejecting others. Shared with tests.
pub(crate) fn normalized_nvidia_provider(raw: &str) -> Option<String> {
    let value = raw.trim().to_uppercase();
    let digits = value.strip_prefix("NVIDIA-G")?;
    (!digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit())).then_some(value)
}

/// Drop fields that aren't shaped like real identifiers, so a stale or
/// hand-edited setting can't inject garbage into the launch environment.
fn sanitize_gpu_selection(gpu: &GpuSelection) -> GpuSelection {
    GpuSelection {
        pci_id: gpu.pci_id.as_deref().and_then(normalized_pci_id),
        pci_slot: gpu.pci_slot.as_deref().and_then(normalized_pci_slot),
        vulkan_uuid: gpu
            .vulkan_uuid
            .as_deref()
            .and_then(crate::gpu_detector::normalize_vulkan_uuid),
        vulkan_index: gpu.vulkan_index,
        vendor: gpu
            .vendor
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(str::to_string),
        nvidia_provider: gpu
            .nvidia_provider
            .as_deref()
            .and_then(normalized_nvidia_provider),
    }
}

/// Interpret the single persisted id string (tray launches) as either a PCI
/// slot or a `vendor:device` pair.
fn selection_from_id(raw: &str) -> GpuSelection {
    let trimmed = raw.trim();
    if let Some(slot) = normalized_pci_slot(trimmed) {
        return GpuSelection {
            pci_slot: Some(slot),
            ..Default::default()
        };
    }
    if let Some(pci_id) = normalized_pci_id(trimmed) {
        return GpuSelection {
            pci_id: Some(pci_id),
            ..Default::default()
        };
    }
    GpuSelection::default()
}

/// Resolve the GPU override for a launch. The launch-provided selection (the
/// GPU currently selected in Settings) wins; the id persisted on the global
/// setting is the fallback for launches that don't go through the frontend
/// (e.g. the tray menu). `None` means no injection: setting off, no GPU
/// selected, or disabled per game.
pub fn specific_gpu_selection(
    settings: &CompatibilitySettings,
    game_profile: Option<&serde_json::Value>,
    gpu: Option<&GpuSelection>,
) -> Option<GpuSelection> {
    if !specific_gpu_enabled(settings, game_profile) {
        return None;
    }
    if let Some(gpu) = gpu {
        let cleaned = sanitize_gpu_selection(gpu);
        if !cleaned.is_empty() {
            return Some(cleaned);
        }
    }
    settings
        .specific_gpu_id
        .as_deref()
        .map(selection_from_id)
        .filter(|selection| !selection.is_empty())
}

/// Environment variables that pin a launch to the selected GPU. The set is a
/// matrix because every graphics stack has its own selector: Vulkan (DXVK
/// UUID filter, vkdevicechooser, loader + Mesa `vid:did`), OpenGL (NVIDIA
/// PRIME offload provider) and Mesa `DRI_PRIME`. Missing fields simply
/// produce fewer entries, so old selections and tray launches degrade
/// gracefully. Shared with tests.
pub fn specific_gpu_env(selection: &GpuSelection) -> Vec<(String, String)> {
    let mut env: Vec<(String, String)> = Vec::new();

    // DXVK's UUID filter is the only precise selector for two identical GPUs.
    if let Some(uuid) = selection
        .vulkan_uuid
        .as_deref()
        .and_then(crate::gpu_detector::normalize_vulkan_uuid)
    {
        env.push(("DXVK_FILTER_DEVICE_UUID".to_string(), uuid));
    }
    // vkdevicechooser covers native Vulkan titles; harmless without the layer.
    if let Some(index) = selection.vulkan_index {
        env.push(("ENABLE_DEVICE_CHOOSER_LAYER".to_string(), "1".to_string()));
        env.push(("VULKAN_DEVICE_INDEX".to_string(), index.to_string()));
    }
    if let Some(pci_id) = selection.pci_id.as_deref().and_then(normalized_pci_id) {
        if let Some((vendor, device)) = pci_id.split_once(':') {
            env.push((
                "VK_LOADER_DEVICE_SELECT".to_string(),
                format!("0x{vendor}:0x{device}"),
            ));
        }
        env.push(("MESA_VK_DEVICE_SELECT".to_string(), pci_id));
    }

    let is_nvidia = selection
        .vendor
        .as_deref()
        .is_some_and(|vendor| vendor.eq_ignore_ascii_case("NVIDIA"))
        || selection
            .pci_id
            .as_deref()
            .is_some_and(|pci| pci.to_lowercase().starts_with("10de:"));

    if is_nvidia {
        // X11 OpenGL offload needs the GPU screen name; the adapter that
        // drives the X screen needs nothing (GL already runs there).
        if let Some(provider) = selection
            .nvidia_provider
            .as_deref()
            .and_then(normalized_nvidia_provider)
        {
            env.push(("__NV_PRIME_RENDER_OFFLOAD".to_string(), "1".to_string()));
            env.push(("__GLX_VENDOR_LIBRARY_NAME".to_string(), "nvidia".to_string()));
            env.push(("__NV_PRIME_RENDER_OFFLOAD_PROVIDER".to_string(), provider));
            env.push(("__VK_LAYER_NV_optimus".to_string(), "NVIDIA_only".to_string()));
        }
    } else if let Some(slot) = selection.pci_slot.as_deref().and_then(normalized_pci_slot) {
        // Mesa selects by bus path, which stays unique for identical cards.
        let dri = format!("pci-{}", slot.replace(':', "_").replace('.', "_"));
        env.push(("DRI_PRIME".to_string(), dri));
    }

    env
}

/// Environment variables that carry the configured Wine/Proton flags
/// into a Steam-launched session.
///
/// When a Steam title has no local executable, Steam itself owns the
/// launch (via the `steam` CLI / `steam://run` protocol), so the direct
/// compatibility path cannot wrap the command. Steam passes its own
/// environment down to the game process, so the flags that translate
/// cleanly to env vars — sync engines, DXVK/VKD3D layers, Wayland /
/// WoW64 toggles, DLL overrides, MangoHud — are applied here instead.
/// Runner and prefix stay Steam-managed: no `WINEPREFIX` / `PROTONPATH`
/// is set.
pub fn steam_launch_env(
    settings: &CompatibilitySettings,
    game_profile: Option<&serde_json::Value>,
    gpu: Option<&GpuSelection>,
) -> Vec<(String, String)> {
    let mut env: Vec<(String, String)> = Vec::new();

    let enable_dxvk = game_profile
        .and_then(|p| p.get("enableDxvk").or_else(|| p.get("dxvk")))
        .and_then(|v| v.as_bool())
        .unwrap_or(settings.enable_dxvk);
    let enable_vkd3d = game_profile
        .and_then(|p| p.get("enableVkd3d").or_else(|| p.get("vkd3d")))
        .and_then(|v| v.as_bool())
        .unwrap_or(settings.enable_vkd3d);
    let enable_esync = game_profile
        .and_then(|p| p.get("enableEsync").or_else(|| p.get("esync")))
        .and_then(|v| v.as_bool())
        .unwrap_or(settings.enable_esync);
    let enable_fsync = game_profile
        .and_then(|p| p.get("enableFsync").or_else(|| p.get("fsync")))
        .and_then(|v| v.as_bool())
        .unwrap_or(settings.enable_fsync);
    let enable_ntsync = game_profile
        .and_then(|p| p.get("enableNtsync").or_else(|| p.get("ntsync")))
        .and_then(|v| v.as_bool())
        .unwrap_or(settings.enable_ntsync);
    let enable_dxvk_nvapi = game_profile
        .and_then(|p| p.get("enableDxvkNvapi").or_else(|| p.get("enableNvapi")))
        .and_then(|v| v.as_bool())
        .unwrap_or(settings.enable_dxvk_nvapi);
    let enable_dxvk_async = game_profile
        .and_then(|p| p.get("enableDxvkAsync").or_else(|| p.get("dxvkAsync")))
        .and_then(|v| v.as_bool())
        .unwrap_or(settings.enable_dxvk_async);
    let enable_wayland = game_profile
        .and_then(|p| p.get("enableWayland").or_else(|| p.get("wineland")))
        .and_then(|v| v.as_bool())
        .unwrap_or(settings.enable_wayland);
    let enable_wow64 = game_profile
        .and_then(|p| p.get("enableWow64").or_else(|| p.get("wow64")))
        .and_then(|v| v.as_bool())
        .unwrap_or(settings.enable_wow64);
    let enable_large_address_aware = game_profile
        .and_then(|p| p.get("enableLargeAddressAware").or_else(|| p.get("largeAddressAware")))
        .and_then(|v| v.as_bool())
        .unwrap_or(settings.enable_large_address_aware);
    let wine_debug = game_profile
        .and_then(|p| p.get("wineDebug"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| settings.wine_debug.clone());
    let audio_driver = game_profile
        .and_then(|p| p.get("audioDriver"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| settings.audio_driver.clone());
    let arch = game_profile.and_then(|p| p.get("arch")).and_then(|v| v.as_str());
    let dxvk_hud = game_profile.and_then(|p| p.get("dxvkHud")).and_then(|v| v.as_str());
    let enable_controller_support = game_profile
        .and_then(|p| p.get("enableControllerSupport"))
        .and_then(|v| v.as_bool())
        .unwrap_or(settings.enable_controller_support);
    let enable_anticheat_support = game_profile
        .and_then(|p| p.get("enableAnticheatSupport"))
        .and_then(|v| v.as_bool())
        .unwrap_or(settings.enable_anticheat_support);
    // MangoHud is wired up on Linux only — the resolved values feed the
    // MANGOHUD force further down.
    #[cfg(target_os = "linux")]
    let enable_mangohud = game_profile
        .and_then(|p| p.get("enableMangoHud").or_else(|| p.get("mangohud")))
        .and_then(|v| v.as_bool())
        .unwrap_or(settings.enable_mangohud);
    #[cfg(target_os = "linux")]
    let mangohud_hidden = game_profile
        .and_then(|p| p.get("mangohudHidden"))
        .and_then(|v| v.as_bool())
        .unwrap_or(settings.mangohud_hidden);
    let prime_render_offload = game_profile
        .and_then(|p| p.get("primeRenderOffload").or_else(|| p.get("primeOffload")))
        .and_then(|v| v.as_bool())
        .unwrap_or(settings.prime_render_offload);
    let specific_gpu = specific_gpu_selection(settings, game_profile, gpu);
    let excluded_global_env: Vec<String> = game_profile
        .and_then(|p| p.get("excludedGlobalEnv"))
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default();
    let excluded_global_dlls: Vec<String> = game_profile
        .and_then(|p| p.get("excludedGlobalDlls"))
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default();

    if let Some(a) = arch {
        env.push(("WINEARCH".to_string(), a.to_string()));
    }
    env.push(("WINEESYNC".to_string(), if enable_esync { "1" } else { "0" }.to_string()));
    env.push(("WINEFSYNC".to_string(), if enable_fsync { "1" } else { "0" }.to_string()));
    if enable_ntsync {
        env.push(("WINESYNC".to_string(), "1".to_string()));
        env.push(("WINENTSYNC".to_string(), "1".to_string()));
    }
    if enable_dxvk_nvapi {
        env.push(("DXVK_ENABLE_NVAPI".to_string(), "1".to_string()));
    }
    if enable_dxvk_async {
        env.push(("DXVK_ASYNC".to_string(), "1".to_string()));
    }
    // The specific-GPU override also turns on the native Wayland driver, so
    // a launch that pins a GPU never silently falls back to XWayland.
    if enable_wayland || specific_gpu.is_some() {
        env.push(("WINE_ENABLE_WAYLAND".to_string(), "1".to_string()));
        env.push(("PROTON_ENABLE_WAYLAND".to_string(), "1".to_string()));
    }
    if let Some(selection) = specific_gpu.as_ref() {
        for (key, value) in specific_gpu_env(selection) {
            env.push((key, value));
        }
    }
    if enable_wow64 {
        env.push(("WINE_NEW_WOW64".to_string(), "1".to_string()));
        env.push(("PROTON_USE_WOW64".to_string(), "1".to_string()));
    }
    if enable_large_address_aware {
        env.push(("WINE_LARGE_ADDRESS_AWARE".to_string(), "1".to_string()));
    }
    if enable_controller_support {
        // Prefer Proton's SDL gamepad backend, which detects controllers the
        // default path misses.
        env.push(("PROTON_PREFER_SDL".to_string(), "1".to_string()));
    }
    if enable_anticheat_support {
        if let Some(dir) = eac_runtime_dir() {
            env.push(("PROTON_EAC_RUNTIME".to_string(), dir.to_string_lossy().to_string()));
        }
        if let Some(dir) = battleye_runtime_dir() {
            env.push(("PROTON_BATTLEYE_RUNTIME".to_string(), dir.to_string_lossy().to_string()));
        }
    }
    if let Some(dbg) = wine_debug.as_deref() {
        env.push(("WINEDEBUG".to_string(), dbg.to_string()));
    }
    if let Some(aud) = audio_driver.as_deref() {
        if aud != "auto" {
            env.push(("WINEAUDIODRIVER".to_string(), aud.to_string()));
        }
    }
    if let Some(hud) = dxvk_hud {
        if !hud.trim().is_empty() {
            env.push(("DXVK_HUD".to_string(), hud.to_string()));
        }
    }

    // DLL overrides: global map minus per-game exclusions, then game
    // overrides, then the DXVK / VKD3D layer entries.
    let mut dll_map = settings.custom_dll_overrides.clone();
    for exc in &excluded_global_dlls {
        dll_map.remove(exc);
    }
    if let Some(game_dlls) = game_profile.and_then(|p| p.get("dllOverrides")).and_then(|v| v.as_object()) {
        for (k, val) in game_dlls {
            if let Some(s) = val.as_str() {
                dll_map.insert(k.clone(), s.to_string());
            }
        }
    }
    if enable_dxvk {
        dll_map.entry("d3d11".to_string()).or_insert_with(|| "n,b".to_string());
        dll_map.entry("dxgi".to_string()).or_insert_with(|| "n,b".to_string());
        dll_map.entry("d3d10core".to_string()).or_insert_with(|| "n,b".to_string());
        dll_map.entry("d3d9".to_string()).or_insert_with(|| "n,b".to_string());
    }
    if enable_vkd3d {
        dll_map.entry("d3d12".to_string()).or_insert_with(|| "n,b".to_string());
    }
    if !dll_map.is_empty() {
        // Sort for a stable string: the map iteration order is random,
        // and the Steam launch-options comparison relies on it.
        let mut entries: Vec<(String, String)> = dll_map.into_iter().collect();
        entries.sort_by(|a, b| a.0.cmp(&b.0));
        let dll_str = entries
            .into_iter()
            .map(|(k, v)| format!("{}={}", k, v))
            .collect::<Vec<_>>()
            .join(";");
        env.push(("WINEDLLOVERRIDES".to_string(), dll_str));
    }

    if prime_render_offload {
        env.push(("DRI_PRIME".to_string(), "1".to_string()));
        env.push(("__NV_PRIME_RENDER_OFFLOAD".to_string(), "1".to_string()));
        env.push(("__GLX_VENDOR_LIBRARY_NAME".to_string(), "nvidia".to_string()));
        env.push(("__VK_LAYER_NV_optimus".to_string(), "NVIDIA_only".to_string()));
    }

    // MangoHud has no wrapper on the Steam path — force the layer on
    // with `MANGOHUD=1` and keep the same CSV logging + hide behavior
    // as direct launches.
    #[cfg(target_os = "linux")]
    if enable_mangohud {
        env.push(("MANGOHUD".to_string(), "1".to_string()));
        if let Some(folder) = linux_mangohud_log_dir() {
            env.push(("MANGOHUD_CONFIG".to_string(), mangohud_log_config(&folder, mangohud_hidden)));
        }
    }

    // User environment variables (filtered for exclusions), then game
    // overrides on top. Sorted so the Steam launch-options prefix is
    // stable across calls.
    let mut user_env: Vec<(&String, &String)> =
        settings.custom_environment_variables.iter().collect();
    user_env.sort_by(|a, b| a.0.cmp(b.0));
    for (k, v) in user_env {
        if !excluded_global_env.contains(k) {
            env.push((k.clone(), v.clone()));
        }
    }
    if let Some(game_envs) = game_profile
        .and_then(|p| p.get("environmentVariables").or_else(|| p.get("customEnv")))
        .and_then(|v| v.as_object())
    {
        for (k, v) in game_envs {
            if let Some(s) = v.as_str() {
                env.push((k.clone(), s.to_string()));
            }
        }
    }

    env
}

/// Build the launch-options prefix (`KEY=VALUE` assignments plus wrapper
/// commands) that hands the configured Wine/Proton flags to Steam
/// itself. Steam splices it in front of `%command%` when it launches a
/// game, which is the only way the flags reach a game launched by an
/// already-running client — the `steam` launcher forwards `-applaunch`
/// over its IPC pipe and drops the invoker's environment.
///
/// `proton_log_dir` adds the `PROTON_LOG` pair so per-game Proton log
/// capture also works for Steam-owned launches.
pub fn steam_launch_prefix(
    settings: &CompatibilitySettings,
    game_profile: Option<&serde_json::Value>,
    gpu: Option<&GpuSelection>,
    proton_log_dir: Option<&Path>,
) -> String {
    let mut tokens: Vec<String> = steam_launch_env(settings, game_profile, gpu)
        .into_iter()
        .map(|(key, value)| {
            format!(
                "{}={}",
                key,
                crate::steam::launch_config::quote_env_value(&value)
            )
        })
        .collect();

    if let Some(dir) = proton_log_dir {
        tokens.push("PROTON_LOG=1".to_string());
        tokens.push(format!(
            "PROTON_LOG_DIR={}",
            crate::steam::launch_config::quote_env_value(&dir.to_string_lossy())
        ));
    }

    // Wrappers mirror the direct compatibility chain: gamescope first,
    // then gamemoderun. MangoHud travels as its `MANGOHUD` env switch.
    tokens.extend(gamescope_command_tokens(settings, game_profile));
    if enable_gamemode(settings, game_profile) && is_command_available("gamemoderun") {
        tokens.push("gamemoderun".to_string());
    }

    tokens.join(" ")
}

/// Resolve the per-game/global GameMode toggle.
pub fn enable_gamemode(
    settings: &CompatibilitySettings,
    game_profile: Option<&serde_json::Value>,
) -> bool {
    game_profile
        .and_then(|p| p.get("enableGameMode").or_else(|| p.get("gamemode")))
        .and_then(|v| v.as_bool())
        .unwrap_or(settings.enable_gamemode)
}

/// Build the `gamescope … --` command tokens for the compatibility
/// chain, or an empty vec when gamescope is disabled or not installed.
pub fn gamescope_command_tokens(
    settings: &CompatibilitySettings,
    game_profile: Option<&serde_json::Value>,
) -> Vec<String> {
    let enable_gamescope = game_profile
        .and_then(|p| p.get("enableGamescope").or_else(|| p.get("gamescope")))
        .and_then(|v| v.as_bool())
        .unwrap_or(settings.enable_gamescope);
    if !enable_gamescope || !is_command_available("gamescope") {
        return Vec::new();
    }

    let gamescope_mode = game_profile
        .and_then(|p| p.get("gamescopeMode"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| settings.gamescope_mode.clone());
    let gamescope_game_width = game_profile
        .and_then(|p| p.get("gamescopeGameWidth"))
        .and_then(|v| v.as_u64())
        .map(|n| n as u32)
        .or(settings.gamescope_game_width);
    let gamescope_game_height = game_profile
        .and_then(|p| p.get("gamescopeGameHeight"))
        .and_then(|v| v.as_u64())
        .map(|n| n as u32)
        .or(settings.gamescope_game_height);
    let gamescope_window_width = game_profile
        .and_then(|p| p.get("gamescopeWindowWidth"))
        .and_then(|v| v.as_u64())
        .map(|n| n as u32)
        .or(settings.gamescope_window_width);
    let gamescope_window_height = game_profile
        .and_then(|p| p.get("gamescopeWindowHeight"))
        .and_then(|v| v.as_u64())
        .map(|n| n as u32)
        .or(settings.gamescope_window_height);
    let gamescope_filter = game_profile
        .and_then(|p| p.get("gamescopeFilter"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| settings.gamescope_filter.clone());
    let gamescope_fsr_sharpness = game_profile
        .and_then(|p| p.get("gamescopeFsrSharpness"))
        .and_then(|v| v.as_u64())
        .map(|n| n as u32)
        .or(settings.gamescope_fsr_sharpness);
    let gamescope_fps_limit = game_profile
        .and_then(|p| p.get("gamescopeFpsLimit"))
        .and_then(|v| v.as_u64())
        .map(|n| n as u32)
        .or(settings.gamescope_fps_limit);
    let gamescope_refresh_rate = game_profile
        .and_then(|p| p.get("gamescopeRefreshRate"))
        .and_then(|v| v.as_u64())
        .map(|n| n as u32)
        .or(settings.gamescope_refresh_rate);
    let gamescope_adaptive_sync = game_profile
        .and_then(|p| p.get("gamescopeAdaptiveSync"))
        .and_then(|v| v.as_bool())
        .unwrap_or(settings.gamescope_adaptive_sync);
    let gamescope_hdr = game_profile
        .and_then(|p| p.get("gamescopeHdr"))
        .and_then(|v| v.as_bool())
        .unwrap_or(settings.gamescope_hdr);
    let gamescope_stretch = game_profile
        .and_then(|p| p.get("gamescopeStretch"))
        .and_then(|v| v.as_bool())
        .unwrap_or(settings.gamescope_stretch);
    let gamescope_force_windows_fullscreen = game_profile
        .and_then(|p| p.get("gamescopeForceWindowsFullscreen"))
        .and_then(|v| v.as_bool())
        .unwrap_or(settings.gamescope_force_windows_fullscreen);
    let gamescope_args = game_profile
        .and_then(|p| p.get("gamescopeArgs"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| settings.gamescope_args.clone());

    let mut tokens: Vec<String> = vec!["gamescope".to_string()];
    if let Some(mode) = gamescope_mode.as_deref() {
        if mode == "fullscreen" {
            tokens.push("-f".to_string());
        } else if mode == "borderless" {
            tokens.push("-b".to_string());
        }
    }
    if let (Some(w), Some(h)) = (gamescope_game_width, gamescope_game_height) {
        tokens.push("-w".to_string());
        tokens.push(w.to_string());
        tokens.push("-h".to_string());
        tokens.push(h.to_string());
    }
    if let (Some(w), Some(h)) = (gamescope_window_width, gamescope_window_height) {
        tokens.push("-W".to_string());
        tokens.push(w.to_string());
        tokens.push("-H".to_string());
        tokens.push(h.to_string());
    }
    if let Some(flt) = gamescope_filter.as_deref() {
        if flt == "integer" {
            tokens.push("-i".to_string());
        } else {
            tokens.push("-F".to_string());
            tokens.push(flt.to_string());
        }
    }
    if let Some(sharp) = gamescope_fsr_sharpness {
        tokens.push("--fsr-sharpness".to_string());
        tokens.push(sharp.to_string());
    }
    if let Some(lim) = gamescope_fps_limit {
        tokens.push("-r".to_string());
        tokens.push(lim.to_string());
    }
    if let Some(ref_rate) = gamescope_refresh_rate {
        tokens.push("-o".to_string());
        tokens.push(ref_rate.to_string());
    }
    if gamescope_adaptive_sync {
        tokens.push("--adaptive-sync".to_string());
    }
    if gamescope_hdr {
        tokens.push("--hdr-enabled".to_string());
    }
    if gamescope_stretch {
        tokens.push("-s".to_string());
    }
    if gamescope_force_windows_fullscreen {
        tokens.push("--force-windows-fullscreen".to_string());
    }
    if let Some(args_str) = gamescope_args.as_ref() {
        for arg in crate::launcher::split_launch_args(args_str) {
            tokens.push(arg);
        }
    }
    // Pipe real-time compositor stats (`fps=…` / `focus=…` lines) to a
    // named FIFO the metrics collector tails, so FPS telemetry works
    // even without MangoHud. Gamescope retries the open until a reader
    // shows up, so a missing reader never blocks the compositor.
    #[cfg(target_os = "linux")]
    if let Some(fifo) = linux_gamescope_stats_fifo() {
        if ensure_gamescope_stats_fifo(&fifo) {
            tokens.push("--stats-path".to_string());
            tokens.push(fifo.to_string_lossy().to_string());
        }
    }
    tokens.push("--".to_string());
    tokens
}

/// Persist GameIndex's Wine/Proton prefix as the Steam app's
/// `LaunchOptions` (`%command%`), preserving the user's own options.
///
/// Best-effort by contract: a missing account config (Steam never
/// launched) or an unreadable file is reported so callers can log it,
/// but never allowed to abort a launch. The applied prefix is remembered
/// in the kv store so disabling the settings removes the stale flags
/// again on the next launch.
pub fn apply_steam_launch_options(
    app: &tauri::AppHandle,
    steam_app_id: u32,
    prefix: &str,
) -> Result<(), String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let db = db_state.inner();
    let marker_key = format!("steam.launchOptions.applied.{steam_app_id}");
    let previous = db::kv::get(db, &marker_key)
        .ok()
        .flatten()
        .filter(|value| !value.trim().is_empty());

    if prefix.trim().is_empty() && previous.is_none() {
        return Ok(());
    }

    let localconfig = crate::steam::launch_config::active_localconfig_path()
        .ok_or_else(|| "no Steam account config found".to_string())?;
    let raw = fs::read_to_string(&localconfig)
        .map_err(|e| format!("read {}: {e}", localconfig.display()))?;
    let existing = crate::steam::launch_config::read_launch_options(&raw, steam_app_id)
        .unwrap_or_default();
    let merged = crate::steam::launch_config::merge_launch_options(
        &existing,
        previous.as_deref(),
        prefix,
    );
    let Some(updated) =
        crate::steam::launch_config::set_launch_options(&raw, steam_app_id, &merged)?
    else {
        return Ok(());
    };

    backup_localconfig_once(&localconfig);
    write_file_atomic(&localconfig, updated.as_bytes())?;

    if prefix.trim().is_empty() {
        let _ = db::kv::delete(db, &marker_key);
    } else {
        db::kv::set(db, &marker_key, prefix).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn backup_localconfig_once(path: &Path) {
    let Some(name) = path.file_name() else {
        return;
    };
    let backup = path.with_file_name(format!("{}.gameindex.bak", name.to_string_lossy()));
    if !backup.exists() {
        let _ = fs::copy(path, backup);
    }
}

fn write_file_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension(format!("gameindex.{}.tmp", std::process::id()));
    fs::write(&tmp, bytes).map_err(|e| format!("write {}: {e}", tmp.display()))?;
    if let Ok(metadata) = fs::metadata(path) {
        let _ = fs::set_permissions(&tmp, metadata.permissions());
    }
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("replace {}: {e}", path.display())
    })
}

/// Best-effort check for a running Steam client. The launcher wrapper
/// forwards `-applaunch` through the client's IPC pipe when one is up,
/// and that path drops the invoker's environment — callers use this to
/// decide whether flags can ride the `steam` process or have to be
/// applied another way. Non-Linux targets have no `/proc`, so this is
/// simply false there.
pub fn steam_client_running() -> bool {
    // The client's pid file is the cheapest signal, but it can go stale
    // after a crash — only trust it when the pid is a live `steam`.
    for root in steam_candidate_roots() {
        for pid_file in [
            root.join("steam.pid"),
            root.parent()
                .map(|parent| parent.join("steam.pid"))
                .unwrap_or_default(),
        ] {
            let Ok(pid) = fs::read_to_string(&pid_file) else {
                continue;
            };
            let pid = pid.trim();
            if pid.is_empty() || !pid.chars().all(|c| c.is_ascii_digit()) {
                continue;
            }
            let comm = fs::read_to_string(format!("/proc/{pid}/comm")).unwrap_or_default();
            if comm.trim() == "steam" {
                return true;
            }
        }
    }

    // Fallback: scan /proc for the client or its web helper.
    let Ok(entries) = fs::read_dir("/proc") else {
        return false;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.chars().all(|c| c.is_ascii_digit()) {
            continue;
        }
        let Ok(comm) = fs::read_to_string(entry.path().join("comm")) else {
            continue;
        };
        if matches!(comm.trim(), "steam" | "steamwebhelper") {
            return true;
        }
    }
    false
}

/// Outcome of a Steam-owned launch: the game PID when GameIndex spawned
/// the process itself (0 when Steam owns it) plus the resolved exe for
/// the watcher's stem matching.
pub struct SteamLaunchOutcome {
    pub pid: u32,
    pub exe_path: Option<String>,
}

/// How a Steam title should be launched.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SteamRoute {
    /// Honor Steam's executable/action picker.
    Picker,
    /// Run the resolved Windows exe through the compatibility layer.
    Direct,
    /// Hand off to the Steam client (CLI or protocol).
    Steam,
}

/// Pick the launch route for a Steam title.
///
/// Direct is chosen only when there are managed flags that must be
/// delivered now and the client is already running — the client's
/// `-applaunch` hand-off drops the invoker's environment, and it does
/// not reload `%command%` launch options until it restarts. With the
/// client closed the flag env rides the `steam` process itself, so the
/// client-side route is preferred.
fn choose_steam_route(
    show_picker: bool,
    has_managed_flags: bool,
    windows_exe: bool,
    steam_running: bool,
) -> SteamRoute {
    if show_picker {
        return SteamRoute::Picker;
    }
    if has_managed_flags && windows_exe && steam_running {
        return SteamRoute::Direct;
    }
    SteamRoute::Steam
}

/// Route a Steam title on Linux.
///
/// Order of preference:
/// 1. The user's Steam launch picker is honored when requested — the
///    picker window only exists inside Steam, so flags are persisted
///    for the next client start instead of forcing a direct launch.
/// 2. A running client drops the invoker's environment (its launcher
///    forwards `-applaunch` over IPC), so a known Windows exe is run
///    through the compatibility layer directly with `SteamAppId` set,
///    so Steamworks/DRM still find the running client.
/// 3. Otherwise hand off to the Steam CLI (or the `steam://` protocol
///    as a last resort) with the flag environment on the process for a
///    cold start, and the same flags persisted as Steam launch options
///    so future client-side launches carry them too.
pub fn launch_steam_game(
    app: &tauri::AppHandle,
    game_id: &str,
    game_name: &str,
    game_path: &str,
    steam_app_id: u32,
    launch_arguments: Option<&str>,
    gpu: Option<&GpuSelection>,
    show_picker: bool,
) -> Result<SteamLaunchOutcome, String> {
    let settings = get_compatibility_settings_internal(app).unwrap_or_default();
    let game_profile = {
        let db_state: tauri::State<'_, db::Db> = app.state();
        db::compatibility::get_for_game(db_state.inner(), game_id)
            .ok()
            .flatten()
    };

    // Proton log capture: point Proton at this game's log folder.
    let log_dir = steam_wine_log_dir_for_game(app, game_id);
    let _ = fs::remove_dir_all(&log_dir);
    let _ = fs::create_dir_all(&log_dir);

    let prefix = steam_launch_prefix(&settings, game_profile.as_ref(), gpu, Some(&log_dir));
    let managed = steam_launch_prefix(&settings, game_profile.as_ref(), gpu, None);
    let defaults = steam_launch_prefix(&CompatibilitySettings::default(), None, None, None);
    // An explicit per-game disable opts out of GameIndex's flags, and
    // nothing configured beyond the defaults means there is nothing to
    // pass — neither case should touch the user's Steam config.
    let compat_disabled = game_profile
        .as_ref()
        .and_then(|p| p.get("enabled"))
        .and_then(|v| v.as_bool())
        == Some(false);
    let persisted = if compat_disabled || managed == defaults {
        String::new()
    } else {
        prefix.clone()
    };
    // A running client keeps `localconfig.vdf` in memory and rewrites
    // the file on exit, so an edit made now would be neither applied nor
    // persisted — and racing Steam's own write is worse than skipping.
    // The direct-launch path below still gets the flags to the game.
    let steam_running = steam_client_running();
    if !steam_running {
        if let Err(error) = apply_steam_launch_options(app, steam_app_id, &persisted) {
            eprintln!("[launch_steam_game] Steam launch options not applied: {error}");
        }
    }

    let mut process_env = steam_launch_env(&settings, game_profile.as_ref(), gpu);
    process_env.push(("PROTON_LOG".to_string(), "1".to_string()));
    process_env.push((
        "PROTON_LOG_DIR".to_string(),
        log_dir.to_string_lossy().to_string(),
    ));

    // The library sync normally resolves the exe, but manual or older
    // entries (and games whose drive was offline during the sync) can
    // arrive with an empty path. Resolve from the Steam appmanifest at
    // launch time so the compatibility route is still available.
    let resolved_exe = if !game_path.is_empty() && Path::new(game_path).exists() {
        Some(game_path.to_string())
    } else {
        crate::game_watcher::resolve_steam_game_exe(steam_app_id, game_name)
    };
    let exe_known = resolved_exe
        .as_deref()
        .is_some_and(|path| Path::new(path).exists());
    let exe_path = resolved_exe
        .clone()
        .or_else(|| (!game_path.is_empty()).then(|| game_path.to_string()));
    let is_windows_exe = resolved_exe
        .as_deref()
        .unwrap_or(game_path)
        .to_lowercase()
        .ends_with(".exe");

    match choose_steam_route(
        show_picker,
        !persisted.is_empty(),
        exe_known && is_windows_exe,
        steam_running,
    ) {
        SteamRoute::Picker => {
            let url = crate::steam::launch_options::steam_launch_url(steam_app_id, true);
            if !spawn_steam_cli(steam_app_id, None, Some(&url), &process_env) {
                tauri_plugin_opener::open_url(url, None::<&str>)
                    .map_err(|e| format!("Failed to open Steam URL: {e}"))?;
            }
            return Ok(SteamLaunchOutcome { pid: 0, exe_path });
        }
        SteamRoute::Direct => {
            let profile =
                with_steam_prefix(game_profile, steam_app_id, settings.default_prefix.as_deref());
            let path = Path::new(resolved_exe.as_deref().unwrap_or(game_path));
            let cwd = path.parent().unwrap_or_else(|| Path::new("."));
            let pid = launch_with_compatibility(
                app,
                game_id,
                game_name,
                path,
                cwd,
                launch_arguments,
                profile.as_ref(),
                gpu,
                Some(steam_app_id),
            )?;
            return Ok(SteamLaunchOutcome { pid, exe_path });
        }
        SteamRoute::Steam => {}
    }

    if spawn_steam_cli(steam_app_id, launch_arguments, None, &process_env) {
        return Ok(SteamLaunchOutcome { pid: 0, exe_path });
    }

    let url = crate::steam::launch_options::steam_launch_url(steam_app_id, false);
    tauri_plugin_opener::open_url(url, None::<&str>)
        .map_err(|e| format!("Failed to open Steam URL: {e}"))?;
    Ok(SteamLaunchOutcome { pid: 0, exe_path })
}

/// Spawn the `steam` client with the compatibility environment and the
/// requested action (game appid + args, or an explicit URL such as the
/// launch-picker dialog). Returns `false` when it could not be started.
fn spawn_steam_cli(
    steam_app_id: u32,
    launch_arguments: Option<&str>,
    url: Option<&str>,
    env: &[(String, String)],
) -> bool {
    let mut cmd = Command::new("steam");
    cmd.arg("-nobigpicture")
        .arg("-nochatui")
        .arg("-nofriendsui")
        .arg("-silent");
    match url {
        Some(url) => {
            cmd.arg(url);
        }
        None => {
            cmd.arg("-applaunch").arg(steam_app_id.to_string());
            if let Some(args) = launch_arguments {
                if !args.trim().is_empty() {
                    for arg in crate::launcher::split_launch_args(args) {
                        cmd.arg(arg);
                    }
                }
            }
        }
    }
    for (key, value) in env {
        cmd.env(key, value);
    }
    // Fire-and-forget: Steam keeps the game process alive on its own.
    cmd.spawn().map(|_| true).unwrap_or(false)
}

/// Clone a game profile with the Steam compatdata base injected when the
/// game has one and the user did not pick a custom prefix. Proton reads
/// the Wine prefix from `${STEAM_COMPAT_DATA_PATH}/pfx`, so the base is
/// what keeps saves/config/Cloud in the prefix Steam created. A global
/// default prefix opts out of the injection so every game shares it.
fn with_steam_prefix(
    game_profile: Option<serde_json::Value>,
    steam_app_id: u32,
    default_prefix: Option<&str>,
) -> Option<serde_json::Value> {
    let mut profile = match game_profile {
        Some(profile) if profile.is_object() => profile,
        _ => serde_json::json!({}),
    };
    let has_custom = profile
        .get("customWinePrefix")
        .or_else(|| profile.get("winePrefix"))
        .and_then(|v| v.as_str())
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);
    let has_global_default = default_prefix
        .map(str::trim)
        .is_some_and(|value| !value.is_empty());
    if !has_custom && !has_global_default {
        if let Some(prefix) = crate::steam::launch_config::steam_compat_prefix(steam_app_id) {
            profile["customWinePrefix"] =
                serde_json::Value::String(prefix.to_string_lossy().to_string());
        }
    }
    Some(profile)
}

/// Retrieve Linux system diagnostics (kernel, display server, Vulkan, gaming tools).
pub fn get_linux_system_status() -> LinuxSystemStatus {
    let os_name = std::env::consts::OS.to_string();
    #[allow(unused_mut)]
    let mut kernel_version = "Unknown".to_string();
    #[allow(unused_mut)]
    let mut display_server = "Unknown".to_string();

    #[cfg(target_os = "linux")]
    {
        if let Ok(uname) = Command::new("uname").arg("-r").output() {
            kernel_version = String::from_utf8_lossy(&uname.stdout).trim().to_string();
        }
        let wayland_var = std::env::var("WAYLAND_DISPLAY").ok();
        let session_type = std::env::var("XDG_SESSION_TYPE").ok();
        if wayland_var.is_some() || session_type.as_deref() == Some("wayland") {
            display_server = "Wayland".to_string();
        } else if std::env::var("DISPLAY").is_ok() || session_type.as_deref() == Some("x11") {
            display_server = "X11".to_string();
        }
    }

    let vulkan_support = is_command_available("vulkaninfo");
    let gamemode_available = is_command_available("gamemoderun");
    let mangohud_available = is_command_available("mangohud");
    let gamescope_available = is_command_available("gamescope");
    let winetricks_available = is_command_available("winetricks");
    let umu_available = find_umu_run().is_some();
    let eac_runtime_available = eac_runtime_dir().is_some();
    let battleye_runtime_available = battleye_runtime_dir().is_some();

    LinuxSystemStatus {
        os_name,
        kernel_version,
        display_server,
        vulkan_support,
        gamemode_available,
        mangohud_available,
        gamescope_available,
        winetricks_available,
        umu_available,
        eac_runtime_available,
        battleye_runtime_available,
    }
}

/// Resolve the directory used for per-game WINEPREFIXes.
pub fn resolve_prefix_dir(app: &tauri::AppHandle, custom_dir: Option<&str>, game_id: &str) -> PathBuf {
    let settings = get_compatibility_settings_internal(app).unwrap_or_default();
    resolve_prefix_from(
        custom_dir,
        settings.default_prefix.as_deref(),
        settings.default_prefix_base_dir.as_deref(),
        default_prefix_base(app),
        game_id,
    )
}

/// Prefix precedence: per-game override, then the shared default prefix,
/// then an isolated folder under the configured base directory.
fn resolve_prefix_from(
    custom_dir: Option<&str>,
    default_prefix: Option<&str>,
    default_base: Option<&str>,
    fallback_base: PathBuf,
    game_id: &str,
) -> PathBuf {
    if let Some(c) = custom_dir.map(str::trim).filter(|s| !s.is_empty()) {
        return PathBuf::from(c);
    }

    if let Some(d) = default_prefix.map(str::trim).filter(|s| !s.is_empty()) {
        return PathBuf::from(d);
    }

    let base = default_base
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .unwrap_or(fallback_base);

    base.join(game_id)
}

fn default_prefix_base(app: &tauri::AppHandle) -> PathBuf {
    let home = std::env::var("HOME").ok();
    if let Some(h) = home {
        PathBuf::from(h).join(".local/share/GameIndex/wineprefixes")
    } else {
        app.path()
            .app_data_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("wineprefixes")
    }
}

/// Root folder holding every game's Wine/Proton session logs.
fn wine_logs_root(app: &tauri::AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("wine_logs");
    let _ = fs::create_dir_all(&dir);
    dir
}

/// Get the log file path for a game's direct Wine/Proton session.
pub fn wine_log_path_for_game(app: &tauri::AppHandle, game_id: &str) -> PathBuf {
    wine_logs_root(app).join(format!("{}.log", game_id))
}

/// Per-game folder for a Steam-owned launch: Proton writes
/// `steam-<appid>.log` there when `PROTON_LOG` is set, and the file name is
/// fixed by Proton, so the reader picks the newest log in the folder.
pub fn steam_wine_log_dir_for_game(app: &tauri::AppHandle, game_id: &str) -> PathBuf {
    let dir = wine_logs_root(app).join(game_id);
    let _ = fs::create_dir_all(&dir);
    dir
}

/// Newest `.log` file inside `dir`, or `None` when the folder is empty.
fn newest_log_file(dir: &Path) -> Option<PathBuf> {
    fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .filter(|p| p.is_file() && p.extension().map(|e| e == "log").unwrap_or(false))
        .max_by_key(|p| fs::metadata(p).and_then(|m| m.modified()).ok())
}

pub fn get_compatibility_settings_internal(app: &tauri::AppHandle) -> Result<CompatibilitySettings, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    if let Ok(Some(raw)) = db::compatibility::get_global_settings(db_state.inner()) {
        if let Ok(parsed) = serde_json::from_str::<CompatibilitySettings>(&raw) {
            return Ok(parsed);
        }
    }
    Ok(CompatibilitySettings::default())
}

#[tauri::command]
pub fn get_compatibility_settings(app: tauri::AppHandle) -> Result<CompatibilitySettings, String> {
    get_compatibility_settings_internal(&app)
}

pub fn set_compatibility_settings_internal(
    app: &tauri::AppHandle,
    settings: &CompatibilitySettings,
) -> Result<(), String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let json = serde_json::to_string(settings).map_err(|e| e.to_string())?;
    db::compatibility::set_global_settings(db_state.inner(), &json)?;
    Ok(())
}

#[tauri::command]
pub fn set_compatibility_settings(
    app: tauri::AppHandle,
    settings: CompatibilitySettings,
) -> Result<(), String> {
    set_compatibility_settings_internal(&app, &settings)
}

#[tauri::command]
pub fn list_compatibility_runners() -> Vec<CompatibilityRunner> {
    detect_compatibility_runners()
}

#[tauri::command]
pub fn get_compatibility_runners() -> Vec<CompatibilityRunner> {
    detect_compatibility_runners()
}

#[tauri::command]
pub fn get_compatibility_system_status() -> LinuxSystemStatus {
    get_linux_system_status()
}

#[tauri::command]
pub fn get_game_wine_logs(app: tauri::AppHandle, game_id: String) -> Result<WineLogResult, String> {
    let direct = wine_log_path_for_game(&app, &game_id);
    let steam_dir = steam_wine_log_dir_for_game(&app, &game_id);

    // Direct compatibility launches write `<game_id>.log`; Steam-owned
    // launches let Proton write `steam-<appid>.log` into a per-game folder.
    // Show whichever log was touched most recently.
    let p = std::iter::once(direct.clone())
        .chain(newest_log_file(&steam_dir))
        .filter(|p| p.is_file())
        .max_by_key(|p| fs::metadata(p).and_then(|m| m.modified()).ok())
        .unwrap_or_else(|| {
            // No log yet — point at where the next Steam launch would write
            // one when the game has an app id, otherwise the direct path.
            let appid = {
                let db_state: tauri::State<'_, db::Db> = app.state();
                db::games::get(db_state.inner(), &game_id)
                    .ok()
                    .flatten()
                    .and_then(|g| g.steam_app_id)
            };
            match appid {
                Some(id) => steam_dir.join(format!("steam-{}.log", id)),
                None => direct,
            }
        });
    let path_str = p.to_string_lossy().to_string();

    if !p.exists() {
        return Ok(WineLogResult {
            game_id,
            log_content: String::new(),
            exists: false,
            last_modified: None,
            size_bytes: 0,
            log_path: path_str,
        });
    }

    let meta = fs::metadata(&p).map_err(|e| e.to_string())?;
    let size_bytes = meta.len();
    let last_modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64);

    let content = fs::read_to_string(&p).unwrap_or_else(|_| {
        let bytes = fs::read(&p).unwrap_or_default();
        String::from_utf8_lossy(&bytes).to_string()
    });

    Ok(WineLogResult {
        game_id,
        log_content: content,
        exists: true,
        last_modified,
        size_bytes,
        log_path: path_str,
    })
}

#[tauri::command]
pub fn clear_game_wine_logs(app: tauri::AppHandle, game_id: String) -> Result<(), String> {
    let p = wine_log_path_for_game(&app, &game_id);
    if p.exists() {
        let _ = fs::remove_file(p);
    }
    let steam_dir = steam_wine_log_dir_for_game(&app, &game_id);
    if steam_dir.exists() {
        let _ = fs::remove_dir_all(steam_dir);
    }
    Ok(())
}

/// Safely delete a user-installed compatibility runner directory.
#[tauri::command]
pub fn delete_compatibility_runner(
    app: tauri::AppHandle,
    runner_id: String,
    path: String,
) -> Result<(), String> {
    let runners = detect_compatibility_runners();
    let runner = runners
        .iter()
        .find(|r| r.id == runner_id || r.path == path)
        .ok_or_else(|| format!("Runner not found: {}", runner_id))?;

    if !runner.is_deletable {
        return Err("This runner is managed by Steam or your system package manager and cannot be removed here.".to_string());
    }

    let install_dir_str = runner
        .install_dir
        .as_ref()
        .ok_or_else(|| "No install directory associated with this runner.".to_string())?;
    let install_dir = PathBuf::from(install_dir_str);

    // Strict safety check: Never delete root, home, system paths
    let canon = install_dir.canonicalize().unwrap_or_else(|_| install_dir.clone());
    let path_str = canon.to_string_lossy().to_string();

    let is_safe = path_str.contains("compatibilitytools.d")
        || path_str.contains("runners")
        || path_str.contains("proton-runners")
        || path_str.contains("GameIndex");

    if !is_safe || path_str == "/" || path_str == "/usr" || path_str == "/home" {
        return Err(format!("Unsafe deletion target: {}", path_str));
    }

    if install_dir.is_dir() {
        fs::remove_dir_all(&install_dir)
            .map_err(|e| format!("Failed to delete runner directory: {}", e))?;
    } else if install_dir.is_file() {
        fs::remove_file(&install_dir)
            .map_err(|e| format!("Failed to delete runner file: {}", e))?;
    }

    // If this was the active default runner, reset it
    let mut settings = get_compatibility_settings_internal(&app).unwrap_or_default();
    if settings.default_runner_path.as_deref() == Some(&runner.path)
        || settings.default_runner_path.as_deref() == Some(&path)
    {
        settings.default_runner_path = None;
        let _ = set_compatibility_settings(app, settings);
    }

    Ok(())
}

/// GitHub repo + install target ("proton" | "wine") for each downloadable
/// runner source. Keep in sync with the source pills in the frontend.
fn runner_source(source: &str) -> Option<(&'static str, &'static str)> {
    match source {
        "ge-proton" => Some(("GloriousEggroll/proton-ge-custom", "proton")),
        "cachyos" => Some(("CachyOS/proton-cachyos", "proton")),
        "proton-em" => Some(("BananaWorks07/Proton", "proton")),
        "wine-ge" => Some(("GloriousEggroll/wine-ge-custom", "wine")),
        "kron4ek" => Some(("Kron4ek/Wine-Builds", "wine")),
        "soda" => Some(("bottlesdevs/wine", "wine")),
        _ => None,
    }
}

fn host_is_arm64() -> bool {
    std::env::consts::ARCH == "aarch64"
}

/// True when a release asset targets the host CPU. Arch-agnostic assets
/// (no arch token in the name) always match; when both tokens appear we
/// require the one matching the host.
fn asset_arch_matches(name: &str, arm_tokens: &[&str], x86_tokens: &[&str]) -> bool {
    let n = name.to_lowercase();
    let is_arm = arm_tokens.iter().any(|t| n.contains(t));
    let is_x86 = x86_tokens.iter().any(|t| n.contains(t));
    if !is_arm && !is_x86 {
        return true;
    }
    if host_is_arm64() {
        is_arm
    } else {
        is_x86
    }
}

fn is_checksum_asset(name: &str) -> bool {
    let n = name.to_lowercase();
    n.ends_with(".sha512sum")
        || n.ends_with(".sha256sum")
        || n.ends_with(".sha512")
        || n.ends_with(".sha256")
        || n.ends_with(".sum")
        || n.ends_with(".sig")
        || n.ends_with(".asc")
        || n.ends_with(".txt")
}

/// Pick the release asset that matches a runner source on this machine.
/// Filters checksums first, then the per-source archive format and CPU arch.
fn runner_asset_matches(source: &str, name: &str) -> bool {
    if is_checksum_asset(name) {
        return false;
    }
    let n = name.to_lowercase();
    match source {
        "ge-proton" => {
            n.ends_with(".tar.gz") && asset_arch_matches(&n, &["aarch64"], &["x86_64"])
        }
        "cachyos" => {
            n.ends_with(".tar.xz")
                && !n.contains("_v3")
                && asset_arch_matches(&n, &["arm64"], &["x86_64"])
        }
        "proton-em" => {
            n.ends_with(".tar.xz") && asset_arch_matches(&n, &["aarch64", "arm64"], &["x86_64"])
        }
        "wine-ge" => n.ends_with(".tar.xz") && asset_arch_matches(&n, &["aarch64"], &["x86_64"]),
        "kron4ek" => n.ends_with(".tar.xz") && (n.contains("amd64") || n.contains("x86_64")),
        "soda" => {
            n.ends_with(".tar.xz") && asset_arch_matches(&n, &["aarch64", "arm64"], &["x86_64"])
        }
        _ => false,
    }
}

/// Fetch available runner releases from GitHub (Proton and Wine builds).
#[tauri::command]
pub async fn fetch_available_runners(
    source: String,
    force_refresh: Option<bool>,
) -> Result<Vec<RemoteRunnerRelease>, String> {
    let force = force_refresh.unwrap_or(false);
    let cache_key = source.to_lowercase();

    if !force {
        if let Ok(guard) = RUNNER_RELEASES_CACHE.lock() {
            if let Some(cache) = guard.as_ref() {
                if let Some(entry) = cache.get(&cache_key) {
                    if entry.fetched_at.elapsed() < Duration::from_secs(15 * 60) {
                        let detected = detect_compatibility_runners();
                        let mut res = entry.releases.clone();
                        for r in &mut res {
                            r.is_installed = is_release_installed(&detected, &r.tag, &r.name);
                        }
                        return Ok(res);
                    }
                }
            }
        }
    }

    let (repo, target_type) =
        runner_source(&cache_key).ok_or_else(|| format!("Unknown runner source: {}", source))?;

    let url = format!("https://api.github.com/repos/{}/releases?per_page=25", repo);
    let client = reqwest::Client::builder()
        .user_agent("GameIndex-App/1.0")
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let response = client
        .get(&url)
        .header("Accept", "application/vnd.github.v3+json")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch releases from GitHub ({}): {}", repo, e))?;

    if !response.status().is_success() {
        return Err(format!(
            "GitHub API responded with status {}: {}",
            response.status(),
            repo
        ));
    }

    let gh_releases: Vec<GhRelease> = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse GitHub releases JSON: {}", e))?;

    let detected = detect_compatibility_runners();
    let mut out = Vec::new();

    for gh in gh_releases {
        let best_asset = gh
            .assets
            .into_iter()
            .find(|a| runner_asset_matches(&cache_key, &a.name));

        if let Some(asset) = best_asset {
            let tag = gh.tag_name;
            let name = gh.name.unwrap_or_else(|| tag.clone());
            let is_inst = is_release_installed(&detected, &tag, &name);

            out.push(RemoteRunnerRelease {
                id: format!("{}-{}", cache_key, tag),
                name,
                tag,
                source: cache_key.clone(),
                release_date: gh.published_at.unwrap_or_default(),
                download_url: asset.browser_download_url,
                filename: asset.name,
                size_bytes: Some(asset.size),
                body: gh.body,
                html_url: gh.html_url,
                is_installed: is_inst,
                target_type: target_type.to_string(),
            });
        }
    }

    if let Ok(mut guard) = RUNNER_RELEASES_CACHE.lock() {
        if guard.is_none() {
            *guard = Some(HashMap::new());
        }
        if let Some(cache) = guard.as_mut() {
            cache.insert(
                cache_key,
                RunnerCacheEntry {
                    fetched_at: Instant::now(),
                    releases: out.clone(),
                },
            );
        }
    }

    Ok(out)
}

fn is_release_installed(detected: &[CompatibilityRunner], tag: &str, name: &str) -> bool {
    let tag_lower = tag.to_lowercase();
    let name_lower = name.to_lowercase();
    detected.iter().any(|r| {
        let r_name = r.name.to_lowercase();
        let r_path = r.path.to_lowercase();
        let r_ver = r.version.as_deref().unwrap_or("").to_lowercase();
        r_name.contains(&tag_lower)
            || r_path.contains(&tag_lower)
            || (!r_ver.is_empty() && r_ver == tag_lower)
            || r_name == name_lower
    })
}

/// Download and install a runner from a remote archive URL.
#[tauri::command]
pub async fn install_compatibility_runner(
    app: tauri::AppHandle,
    download_url: String,
    filename: String,
    runner_name: String,
    target_type: String, // "steam_compat_tool" | "wine_runner"
) -> Result<(), String> {
    let cancel_flag = Arc::new(AtomicBool::new(false));
    {
        let mut guard = ACTIVE_INSTALL_CANCELS.lock().unwrap();
        if guard.is_none() {
            *guard = Some(HashMap::new());
        }
        if let Some(map) = guard.as_mut() {
            map.insert(runner_name.clone(), cancel_flag.clone());
        }
    }

    let dest_dir = if target_type == "steam_compat_tool" || target_type == "proton" {
        steam_compat_tools_dir()
    } else {
        gameindex_runners_dir("wine")
    };
    let _ = fs::create_dir_all(&dest_dir);

    let temp_dir = dest_dir.join(".temp_downloads");
    let _ = fs::create_dir_all(&temp_dir);
    let ts = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap().as_secs();
    let temp_file_path = temp_dir.join(format!("download_{}_{}", ts, filename));

    // Emit initial progress
    let _ = app.emit(
        "runner-install-progress",
        RunnerInstallProgress {
            runner_name: runner_name.clone(),
            status: "downloading".to_string(),
            downloaded_bytes: 0,
            total_bytes: None,
            percent: 0.0,
            speed_bytes_per_sec: 0,
            error: None,
        },
    );

    let client = reqwest::Client::builder()
        .user_agent("GameIndex-App/1.0")
        .build();
    let client = match client {
        Ok(c) => c,
        Err(e) => {
            let err = format!("HTTP client error: {}", e);
            emit_install_failed(&app, &runner_name, err.clone(), 0, None);
            return Err(err);
        }
    };

    let res = client.get(&download_url).send().await;
    let res = match res {
        Ok(r) => r,
        Err(e) => {
            let err = format!("Failed to initiate download: {}", e);
            emit_install_failed(&app, &runner_name, err.clone(), 0, None);
            return Err(err);
        }
    };

    if !res.status().is_success() {
        let err = format!("Download failed with status: {}", res.status());
        emit_install_failed(&app, &runner_name, err.clone(), 0, res.content_length());
        return Err(err);
    }

    let total_bytes = res.content_length();
    let mut file = match OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&temp_file_path)
    {
        Ok(f) => f,
        Err(e) => {
            let err = format!("Failed to create temporary download file: {}", e);
            emit_install_failed(&app, &runner_name, err.clone(), 0, total_bytes);
            return Err(err);
        }
    };

    let mut stream = res.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut last_emit = Instant::now();
    let mut last_bytes = 0u64;

    while let Some(chunk) = stream.next().await {
        if cancel_flag.load(Ordering::Relaxed) {
            drop(file);
            let _ = fs::remove_file(&temp_file_path);
            clear_install_cancel(&runner_name);
            let _ = app.emit(
                "runner-install-progress",
                RunnerInstallProgress {
                    runner_name: runner_name.clone(),
                    status: "cancelled".to_string(),
                    downloaded_bytes: downloaded,
                    total_bytes,
                    percent: 0.0,
                    speed_bytes_per_sec: 0,
                    error: None,
                },
            );
            return Err("Download cancelled by user".to_string());
        }

        let chunk = match chunk {
            Ok(c) => c,
            Err(e) => {
                drop(file);
                let _ = fs::remove_file(&temp_file_path);
                let err = format!("Error during download stream: {}", e);
                emit_install_failed(&app, &runner_name, err.clone(), downloaded, total_bytes);
                return Err(err);
            }
        };
        if let Err(e) = file.write_all(&chunk) {
            drop(file);
            let _ = fs::remove_file(&temp_file_path);
            let err = format!("Failed to write chunk to disk: {}", e);
            emit_install_failed(&app, &runner_name, err.clone(), downloaded, total_bytes);
            return Err(err);
        }
        downloaded += chunk.len() as u64;

        if last_emit.elapsed() >= Duration::from_millis(200) {
            let elapsed_sec = last_emit.elapsed().as_secs_f64();
            let bytes_diff = downloaded.saturating_sub(last_bytes);
            let speed = if elapsed_sec > 0.0 {
                (bytes_diff as f64 / elapsed_sec) as u64
            } else {
                0
            };
            let pct = if let Some(tot) = total_bytes {
                if tot > 0 {
                    (downloaded as f32 / tot as f32) * 100.0
                } else {
                    0.0
                }
            } else {
                0.0
            };

            let _ = app.emit(
                "runner-install-progress",
                RunnerInstallProgress {
                    runner_name: runner_name.clone(),
                    status: "downloading".to_string(),
                    downloaded_bytes: downloaded,
                    total_bytes,
                    percent: pct,
                    speed_bytes_per_sec: speed,
                    error: None,
                },
            );

            last_emit = Instant::now();
            last_bytes = downloaded;
        }
    }

    drop(file);

    // Extraction phase
    let _ = app.emit(
        "runner-install-progress",
        RunnerInstallProgress {
            runner_name: runner_name.clone(),
            status: "extracting".to_string(),
            downloaded_bytes: downloaded,
            total_bytes,
            percent: 100.0,
            speed_bytes_per_sec: 0,
            error: None,
        },
    );

    let extract_res = extract_runner_archive(&temp_file_path, &dest_dir);
    let _ = fs::remove_file(&temp_file_path);

    // Clean up cancellation handle
    clear_install_cancel(&runner_name);

    match extract_res {
        Ok(_) => {
            let _ = app.emit(
                "runner-install-progress",
                RunnerInstallProgress {
                    runner_name: runner_name.clone(),
                    status: "completed".to_string(),
                    downloaded_bytes: downloaded,
                    total_bytes,
                    percent: 100.0,
                    speed_bytes_per_sec: 0,
                    error: None,
                },
            );
            Ok(())
        }
        Err(e) => {
            let err = format!("Extraction error: {}", e);
            emit_install_failed(&app, &runner_name, err.clone(), downloaded, total_bytes);
            Err(err)
        }
    }
}

/// Cancel an ongoing runner download or install.
#[tauri::command]
pub fn cancel_runner_install(runner_name: String) -> Result<(), String> {
    if let Ok(guard) = ACTIVE_INSTALL_CANCELS.lock() {
        if let Some(map) = guard.as_ref() {
            if let Some(cancel) = map.get(&runner_name) {
                cancel.store(true, Ordering::Relaxed);
                return Ok(());
            }
        }
    }
    Ok(())
}

/// Install a runner by extracting an existing archive from disk.
#[tauri::command]
pub fn install_runner_from_archive(
    app: tauri::AppHandle,
    archive_path: String,
    target_type: String,
) -> Result<String, String> {
    let p = PathBuf::from(&archive_path);
    if !p.exists() || !p.is_file() {
        return Err(format!("Archive file not found: {}", archive_path));
    }

    let dest_dir = if target_type == "steam_compat_tool" {
        steam_compat_tools_dir()
    } else {
        gameindex_runners_dir("wine")
    };
    let _ = fs::create_dir_all(&dest_dir);

    extract_runner_archive(&p, &dest_dir)?;

    let name = p
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Custom-Runner")
        .trim_end_matches(".tar")
        .to_string();

    let _ = app.emit(
        "runner-install-progress",
        RunnerInstallProgress {
            runner_name: name.clone(),
            status: "completed".to_string(),
            downloaded_bytes: 0,
            total_bytes: None,
            percent: 100.0,
            speed_bytes_per_sec: 0,
            error: None,
        },
    );

    Ok(name)
}

/// Run common Wine/Proton maintenance utilities for a game or prefix.
#[tauri::command]
pub fn run_wine_tool(
    app: tauri::AppHandle,
    runner_path: Option<String>,
    prefix_path: Option<String>,
    game_id: Option<String>,
    tool: String,
    args: Option<Vec<String>>,
) -> Result<(), String> {
    let effective_prefix = if let Some(p) = prefix_path {
        PathBuf::from(p)
    } else if let Some(gid) = game_id {
        resolve_prefix_dir(&app, None, &gid)
    } else {
        default_prefix_base(&app).join("default")
    };

    let _ = fs::create_dir_all(&effective_prefix);

    // Resolve runner
    let effective_runner = if let Some(r) = runner_path {
        r
    } else {
        let settings = get_compatibility_settings_internal(&app).unwrap_or_default();
        if let Some(r) = settings.default_runner_path {
            r
        } else {
            let detected = detect_compatibility_runners();
            detected
                .into_iter()
                .next()
                .map(|r| r.path)
                .unwrap_or_else(|| "wine".to_string())
        }
    };

    let is_proton = runner_is_proton(&effective_runner);

    match tool.as_str() {
        "browse_prefix" => {
            let path_str = effective_prefix.to_string_lossy().to_string();
            tauri_plugin_opener::open_path(path_str, None::<&str>)
                .map_err(|e| format!("Failed to open prefix folder: {}", e))?;
            return Ok(());
        }
        "kill" => {
            let mut cmd = Command::new("wineserver");
            cmd.arg("-k").env("WINEPREFIX", &effective_prefix);
            let _ = cmd.spawn();
            return Ok(());
        }
        "winetricks" => {
            let settings = get_compatibility_settings_internal(&app).unwrap_or_default();
            let bin = settings.winetricks_path.unwrap_or_else(|| "winetricks".to_string());
            let mut cmd = Command::new(bin);
            if let Some(extra_args) = args {
                cmd.args(extra_args);
            }
            cmd.env("WINEPREFIX", &effective_prefix);
            cmd.env("WINE", &effective_runner);
            cmd.spawn().map_err(|e| format!("winetricks failed to spawn: {}", e))?;
            return Ok(());
        }
        _ => {}
    }

    let wine_binary = if is_proton {
        // Proton script wraps wine via "run" command
        effective_runner
    } else {
        effective_runner
    };

    let mut cmd = Command::new(&wine_binary);
    if is_proton {
        cmd.arg("run");
    }

    match tool.as_str() {
        "winecfg" => {
            cmd.arg("winecfg");
        }
        "regedit" => {
            cmd.arg("regedit");
        }
        "control" => {
            cmd.arg("control");
        }
        "taskmgr" => {
            cmd.arg("taskmgr");
        }
        "cmd" => {
            cmd.arg("cmd");
        }
        other => {
            cmd.arg(other);
            if let Some(extra_args) = args {
                cmd.args(extra_args);
            }
        }
    }

    cmd.env("WINEPREFIX", &effective_prefix);
    if is_proton {
        cmd.env("STEAM_COMPAT_DATA_PATH", &effective_prefix);
        if let Some(steam) = steam_candidate_roots().into_iter().next() {
            cmd.env("STEAM_COMPAT_CLIENT_INSTALL_PATH", steam.to_string_lossy().to_string());
        }
    }

    cmd.spawn().map_err(|e| format!("Failed to spawn wine tool ({}): {}", tool, e))?;
    Ok(())
}

/// MangoHud CSV log folder used by GameIndex-launched sessions.
///
/// GameIndex forces logging here (via `MANGOHUD_CONFIG`) so
/// `metrics_collector` can find the frame log; it is also where MangoHud
/// drops logs by default when the user configures `output_folder`
/// themselves, so a log written here never surprises anyone.
#[cfg(target_os = "linux")]
pub fn linux_mangohud_log_dir() -> Option<PathBuf> {
    let base = std::env::var("XDG_DATA_HOME")
        .ok()
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            let home = std::env::var("HOME").ok()?;
            Some(PathBuf::from(home).join(".local/share"))
        })?;
    Some(base.join("MangoHud"))
}

/// Path of the gamescope `--stats-path` FIFO that the metrics collector
/// tails for real-time FPS. Lives under `$XDG_RUNTIME_DIR` (per-user,
/// cleaned up on logout) with `/tmp` as fallback for sessions without it
/// (bare-bones desktops, some containers).
#[cfg(target_os = "linux")]
pub fn linux_gamescope_stats_fifo() -> Option<PathBuf> {
    let base = std::env::var("XDG_RUNTIME_DIR")
        .ok()
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var("TMPDIR")
                .ok()
                .filter(|s| !s.is_empty())
                .map(PathBuf::from)
        })
        .unwrap_or_else(|| PathBuf::from("/tmp"));
    Some(base.join("gameindex-gamescope-stats.fifo"))
}

/// Create (or repair) the gamescope stats FIFO. Returns `false` when the
/// path cannot be made a FIFO — e.g. it exists as a regular file left
/// over from a crash and unlinking it fails.
#[cfg(target_os = "linux")]
fn ensure_gamescope_stats_fifo(path: &Path) -> bool {
    use std::os::unix::fs::FileTypeExt;
    match fs::metadata(path) {
        Ok(meta) if meta.file_type().is_fifo() => return true,
        Ok(_) => {
            // Stale non-FIFO leftover; replace it.
            let _ = fs::remove_file(path);
        }
        Err(_) => {}
    }
    match std::ffi::CString::new(path.to_string_lossy().as_bytes()) {
        Ok(c_path) => unsafe { libc::mkfifo(c_path.as_ptr(), 0o600) == 0 },
        Err(_) => false,
    }
}

/// Remove AppImage `AppRun` paths from a child command's environment.
///
/// `AppRun` exports `PYTHONHOME`/`PYTHONPATH` pointing at the ephemeral mount
/// and prepends the mount to `LD_LIBRARY_PATH`. Spawning a system tool with
/// those still set breaks it — `umu-run` and Proton's Python launcher abort
/// with "Failed to import encodings module" because the system Python reads a
/// foreign stdlib. Only entries under `APPDIR` are dropped; paths the user set
/// themselves survive.
#[cfg(target_os = "linux")]
pub(crate) fn strip_appimage_env(cmd: &mut Command) {
    let Some(app_dir) = std::env::var_os("APPDIR") else {
        return;
    };
    let vars = utf8_env_vars();
    let keys = ["PYTHONHOME", "PYTHONPATH", "LD_LIBRARY_PATH"];
    for (key, value) in appimage_env_overrides(&PathBuf::from(app_dir), &vars, &keys) {
        match value {
            Some(value) => {
                cmd.env(key, value);
            }
            None => {
                cmd.env_remove(key);
            }
        }
    }
}

/// Scrub the AppImage Python overrides from our own environment at startup, so
/// every later child (prefix `wineboot`, winetricks, Proton's Python launcher)
/// sees the system Python. `LD_LIBRARY_PATH` is deliberately left alone:
/// WebKit's helper processes rely on the bundled libraries.
#[cfg(target_os = "linux")]
pub fn scrub_appimage_python_env() {
    let Some(app_dir) = std::env::var_os("APPDIR") else {
        return;
    };
    let vars = utf8_env_vars();
    let keys = ["PYTHONHOME", "PYTHONPATH"];
    for (key, value) in appimage_env_overrides(&PathBuf::from(app_dir), &vars, &keys) {
        match value {
            Some(value) => std::env::set_var(&key, value),
            None => std::env::remove_var(&key),
        }
    }
}

#[cfg(target_os = "linux")]
fn utf8_env_vars() -> Vec<(String, String)> {
    std::env::vars_os()
        .filter_map(|(key, value)| Some((key.into_string().ok()?, value.into_string().ok()?)))
        .collect()
}

/// Pure core of the AppImage scrubbers: `(key, Some(replacement))` means the
/// variable keeps only its non-AppImage entries, `(key, None)` means it is
/// removed entirely. Variables with nothing to strip are left untouched.
#[cfg(target_os = "linux")]
fn appimage_env_overrides(
    app_dir: &Path,
    vars: &[(String, String)],
    keys: &[&str],
) -> Vec<(String, Option<String>)> {
    let mut overrides = Vec::new();
    for key in keys {
        let Some((_, value)) = vars.iter().find(|(name, _)| name == key) else {
            continue;
        };
        let entries: Vec<&str> = value.split(':').collect();
        if !entries
            .iter()
            .any(|entry| Path::new(entry).starts_with(app_dir))
        {
            continue;
        }
        let kept: Vec<&str> = entries
            .into_iter()
            .filter(|entry| !entry.is_empty() && !Path::new(entry).starts_with(app_dir))
            .collect();
        overrides.push((
            key.to_string(),
            (!kept.is_empty()).then(|| kept.join(":")),
        ));
    }
    overrides
}

/// Launch a Windows executable through Wine or Proton.
/// Returns the PID of the spawned process, while recording stdout/stderr into the game's log file.
pub fn launch_with_compatibility(
    app: &tauri::AppHandle,
    game_id: &str,
    game_name: &str,
    exe_path: &Path,
    working_dir: &Path,
    launch_args: Option<&str>,
    game_profile: Option<&serde_json::Value>,
    gpu: Option<&GpuSelection>,
    steam_app_id: Option<u32>,
) -> Result<u32, String> {
    let settings = get_compatibility_settings_internal(app).unwrap_or_default();

    // Extract per-game profile if present
    let custom_runner_path = game_profile
        .and_then(|p| p.get("customRunnerPath").or_else(|| p.get("runner")))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let custom_wine_prefix = game_profile
        .and_then(|p| p.get("customWinePrefix").or_else(|| p.get("winePrefix")))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let arch = game_profile.and_then(|p| p.get("arch")).and_then(|v| v.as_str());

    let enable_dxvk = game_profile
        .and_then(|p| p.get("enableDxvk").or_else(|| p.get("dxvk")))
        .and_then(|v| v.as_bool())
        .unwrap_or(settings.enable_dxvk);
    let enable_vkd3d = game_profile
        .and_then(|p| p.get("enableVkd3d").or_else(|| p.get("vkd3d")))
        .and_then(|v| v.as_bool())
        .unwrap_or(settings.enable_vkd3d);
    let enable_esync = game_profile
        .and_then(|p| p.get("enableEsync").or_else(|| p.get("esync")))
        .and_then(|v| v.as_bool())
        .unwrap_or(settings.enable_esync);
    let enable_fsync = game_profile
        .and_then(|p| p.get("enableFsync").or_else(|| p.get("fsync")))
        .and_then(|v| v.as_bool())
        .unwrap_or(settings.enable_fsync);
    let enable_ntsync = game_profile
        .and_then(|p| p.get("enableNtsync").or_else(|| p.get("ntsync")))
        .and_then(|v| v.as_bool())
        .unwrap_or(settings.enable_ntsync);
    let enable_dxvk_nvapi = game_profile
        .and_then(|p| p.get("enableDxvkNvapi").or_else(|| p.get("enableNvapi")))
        .and_then(|v| v.as_bool())
        .unwrap_or(settings.enable_dxvk_nvapi);
    let enable_dxvk_async = game_profile
        .and_then(|p| p.get("enableDxvkAsync").or_else(|| p.get("dxvkAsync")))
        .and_then(|v| v.as_bool())
        .unwrap_or(settings.enable_dxvk_async);
    let enable_wayland = game_profile
        .and_then(|p| p.get("enableWayland").or_else(|| p.get("wineland")))
        .and_then(|v| v.as_bool())
        .unwrap_or(settings.enable_wayland);
    let enable_wow64 = game_profile
        .and_then(|p| p.get("enableWow64").or_else(|| p.get("wow64")))
        .and_then(|v| v.as_bool())
        .unwrap_or(settings.enable_wow64);
    let enable_large_address_aware = game_profile
        .and_then(|p| p.get("enableLargeAddressAware").or_else(|| p.get("largeAddressAware")))
        .and_then(|v| v.as_bool())
        .unwrap_or(settings.enable_large_address_aware);
    let wine_debug = game_profile
        .and_then(|p| p.get("wineDebug"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| settings.wine_debug.clone());
    let audio_driver = game_profile
        .and_then(|p| p.get("audioDriver"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| settings.audio_driver.clone());
    let virtual_desktop = game_profile
        .and_then(|p| p.get("virtualDesktop"))
        .and_then(|v| v.as_bool())
        .unwrap_or(settings.virtual_desktop);
    let virtual_desktop_res = game_profile
        .and_then(|p| p.get("virtualDesktopRes"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| settings.virtual_desktop_res.clone());

    let dxvk_hud = game_profile.and_then(|p| p.get("dxvkHud")).and_then(|v| v.as_str());
    let enable_controller_support = game_profile
        .and_then(|p| p.get("enableControllerSupport"))
        .and_then(|v| v.as_bool())
        .unwrap_or(settings.enable_controller_support);
    let enable_anticheat_support = game_profile
        .and_then(|p| p.get("enableAnticheatSupport"))
        .and_then(|v| v.as_bool())
        .unwrap_or(settings.enable_anticheat_support);
    let enable_mangohud = game_profile
        .and_then(|p| p.get("enableMangoHud").or_else(|| p.get("mangohud")))
        .and_then(|v| v.as_bool())
        .unwrap_or(settings.enable_mangohud);
    let mangohud_hidden = game_profile
        .and_then(|p| p.get("mangohudHidden"))
        .and_then(|v| v.as_bool())
        .unwrap_or(settings.mangohud_hidden);
    let enable_umu = game_profile
        .and_then(|p| p.get("enableUmuLauncher"))
        .and_then(|v| v.as_bool())
        .unwrap_or(settings.enable_umu_launcher);
    let enable_gamemode = game_profile
        .and_then(|p| p.get("enableGameMode").or_else(|| p.get("gamemode")))
        .and_then(|v| v.as_bool())
        .unwrap_or(settings.enable_gamemode);
    let enable_gamescope = game_profile
        .and_then(|p| p.get("enableGamescope").or_else(|| p.get("gamescope")))
        .and_then(|v| v.as_bool())
        .unwrap_or(settings.enable_gamescope);

    let prime_render_offload = game_profile
        .and_then(|p| p.get("primeRenderOffload").or_else(|| p.get("primeOffload")))
        .and_then(|v| v.as_bool())
        .unwrap_or(settings.prime_render_offload);
    let specific_gpu = specific_gpu_selection(&settings, game_profile, gpu);

    let excluded_global_env: Vec<String> = game_profile
        .and_then(|p| p.get("excludedGlobalEnv"))
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default();
    let excluded_global_dlls: Vec<String> = game_profile
        .and_then(|p| p.get("excludedGlobalDlls"))
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default();

    // Resolve runner
    let runner_path = if let Some(r) = custom_runner_path.filter(|s| !s.trim().is_empty()) {
        r
    } else if let Some(r) = settings
        .default_runner_path
        .as_ref()
        .filter(|s| !s.trim().is_empty())
    {
        r.clone()
    } else {
        let detected = detect_compatibility_runners();
        detected
            .into_iter()
            .next()
            .map(|r| r.path)
            .unwrap_or_else(|| "wine".to_string())
    };

    let is_proton = runner_is_proton(&runner_path);

    // UMU-Launcher mode — run the executable through `umu-run` so
    // Proton runs inside Valve's Steam Runtime container without Steam
    // itself. Only Proton runners route through umu (`PROTONPATH` needs
    // a Proton build); plain Wine keeps the direct invocation.
    let umu_run = if enable_umu { find_umu_run() } else { None };
    let use_umu = umu_run.is_some()
        && is_proton
        && proton_folder_for_runner(&runner_path).is_some();

    // Resolve prefix
    let prefix = resolve_prefix_dir(app, custom_wine_prefix.as_deref(), game_id);
    let _ = fs::create_dir_all(&prefix);

    // Prepare log file
    let log_path = wine_log_path_for_game(app, game_id);
    let mut log_file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&log_path)
        .map_err(|e| format!("Failed to open log file {}: {}", log_path.display(), e))?;

    let now = chrono::Local::now().to_rfc3339();
    let _ = writeln!(log_file, "==================================================");
    let _ = writeln!(log_file, "GameIndex Compatibility Session Log");
    let _ = writeln!(log_file, "Game: {} ({})", game_name, game_id);
    let _ = writeln!(log_file, "Timestamp: {}", now);
    let _ = writeln!(log_file, "Executable: {}", exe_path.display());
    let _ = writeln!(log_file, "Runner: {}", runner_path);
    let _ = writeln!(log_file, "Prefix: {}", prefix.display());
    let _ = writeln!(log_file, "ESync: {}, FSync: {}, NTSync: {}, DXVK: {}, VKD3D: {}", enable_esync, enable_fsync, enable_ntsync, enable_dxvk, enable_vkd3d);
    let _ = writeln!(log_file, "Wineland: {}, WoW64: {}, LargeAddress: {}", enable_wayland, enable_wow64, enable_large_address_aware);
    let specific_gpu_label = specific_gpu
        .as_ref()
        .and_then(|gpu| gpu.pci_slot.as_deref().or(gpu.pci_id.as_deref()))
        .unwrap_or("disabled");
    let _ = writeln!(log_file, "Specific GPU: {}", specific_gpu_label);
    let _ = writeln!(log_file, "MangoHud: {} (hidden: {}), UMU: {}, GameMode: {}, Gamescope: {}", enable_mangohud, mangohud_hidden, use_umu, enable_gamemode, enable_gamescope);
    let _ = writeln!(log_file, "Controller support: {}, Anti-cheat support: {}", enable_controller_support, enable_anticheat_support);
    let _ = writeln!(log_file, "==================================================");
    let _ = log_file.flush();

    // Build the command chain.
    // Order: [gamescope [args] --] [gamemoderun] [mangohud] runner [run] [virtual desktop / exe] [args]
    let mut tokens: Vec<String> = Vec::new();

    if enable_gamescope {
        tokens.extend(gamescope_command_tokens(&settings, game_profile));
    }

    if enable_gamemode && is_command_available("gamemoderun") {
        tokens.push("gamemoderun".to_string());
    }

    if enable_mangohud && is_command_available("mangohud") {
        tokens.push("mangohud".to_string());
    }

    if use_umu {
        if let Some(umu) = &umu_run {
            tokens.push(umu.to_string_lossy().to_string());
        }
    } else {
        tokens.push(runner_path.clone());
        if is_proton {
            tokens.push("run".to_string());
        }
    }

    if virtual_desktop {
        tokens.push("explorer.exe".to_string());
        let res = virtual_desktop_res.as_deref().unwrap_or("1920x1080");
        tokens.push(format!("/desktop=GameIndex,{}", res));
    }

    tokens.push(exe_path.to_string_lossy().to_string());

    if let Some(args) = launch_args {
        if !args.trim().is_empty() {
            for a in crate::launcher::split_launch_args(args) {
                tokens.push(a);
            }
        }
    }

    let program = tokens.remove(0);
    let mut cmd = Command::new(&program);
    cmd.args(&tokens);
    cmd.current_dir(working_dir);

    #[cfg(target_os = "linux")]
    strip_appimage_env(&mut cmd);

    // Environment variables
    cmd.env("WINEPREFIX", &prefix);

    // Linux: enable MangoHud CSV logging (auto-start after 1s, one line per
    // second) into a folder `metrics_collector` scans, so the overlay also
    // feeds real-time FPS/frametimes into the session telemetry instead of
    // being display-only. `read_cfg` keeps the user's MangoHud.conf in play
    // and the listed keys override only what logging needs. A user-supplied
    // `MANGOHUD_CONFIG` in custom env vars below still wins.
    #[cfg(target_os = "linux")]
    if enable_mangohud && is_command_available("mangohud") {
        if let Some(folder) = linux_mangohud_log_dir() {
            if fs::create_dir_all(&folder).is_ok() {
                cmd.env("MANGOHUD_CONFIG", mangohud_log_config(&folder, mangohud_hidden));
            }
        }
    }

    // UMU-Launcher environment: identify the game for umu's prefix /
    // protonfix handling and point PROTONPATH at the Proton folder.
    if use_umu {
        cmd.env("GAMEID", format!("umu-{}", game_id));
        cmd.env("STORE", "none");
        if let Some(folder) = proton_folder_for_runner(&runner_path) {
            cmd.env("PROTONPATH", folder.to_string_lossy().to_string());
        }
    }
    if let Some(a) = arch {
        cmd.env("WINEARCH", a);
    }
    cmd.env("WINEESYNC", if enable_esync { "1" } else { "0" });
    cmd.env("WINEFSYNC", if enable_fsync { "1" } else { "0" });
    if enable_ntsync {
        cmd.env("WINESYNC", "1");
        cmd.env("WINENTSYNC", "1");
    }

    if enable_dxvk_nvapi {
        cmd.env("DXVK_ENABLE_NVAPI", "1");
    }
    if enable_dxvk_async {
        cmd.env("DXVK_ASYNC", "1");
    }
    if enable_wayland {
        cmd.env("WINE_ENABLE_WAYLAND", "1");
    }
    // Pinning a specific GPU also forces Wine Wayland on (WINE + Proton)
    // and hands the selection to the whole graphics-stack matrix.
    if let Some(selection) = specific_gpu.as_ref() {
        cmd.env("WINE_ENABLE_WAYLAND", "1");
        cmd.env("PROTON_ENABLE_WAYLAND", "1");
        for (key, value) in specific_gpu_env(selection) {
            cmd.env(key, value);
        }
    }
    if enable_wow64 {
        cmd.env("WINE_NEW_WOW64", "1");
    }
    if enable_large_address_aware {
        cmd.env("WINE_LARGE_ADDRESS_AWARE", "1");
    }
    if enable_controller_support {
        cmd.env("PROTON_PREFER_SDL", "1");
    }
    if enable_anticheat_support {
        if let Some(dir) = eac_runtime_dir() {
            cmd.env("PROTON_EAC_RUNTIME", &dir);
        }
        if let Some(dir) = battleye_runtime_dir() {
            cmd.env("PROTON_BATTLEYE_RUNTIME", &dir);
        }
    }
    if let Some(dbg) = wine_debug.as_deref() {
        cmd.env("WINEDEBUG", dbg);
    }
    if let Some(aud) = audio_driver.as_deref() {
        if aud != "auto" {
            cmd.env("WINEAUDIODRIVER", aud);
        }
    }
    if let Some(hud) = dxvk_hud {
        if !hud.trim().is_empty() {
            cmd.env("DXVK_HUD", hud);
        }
    }

    // Build DLL overrides
    let mut dll_map = settings.custom_dll_overrides.clone();
    // Exclude global DLLs if designated by game profile
    for exc in &excluded_global_dlls {
        dll_map.remove(exc);
    }

    if let Some(game_dlls) = game_profile.and_then(|p| p.get("dllOverrides")).and_then(|v| v.as_object()) {
        for (k, val) in game_dlls {
            if let Some(s) = val.as_str() {
                dll_map.insert(k.clone(), s.to_string());
            }
        }
    }

    if enable_dxvk {
        dll_map.entry("d3d11".to_string()).or_insert_with(|| "n,b".to_string());
        dll_map.entry("dxgi".to_string()).or_insert_with(|| "n,b".to_string());
        dll_map.entry("d3d10core".to_string()).or_insert_with(|| "n,b".to_string());
        dll_map.entry("d3d9".to_string()).or_insert_with(|| "n,b".to_string());
    }
    if enable_vkd3d {
        dll_map.entry("d3d12".to_string()).or_insert_with(|| "n,b".to_string());
    }

    if !dll_map.is_empty() {
        // Sort for a stable string: the map iteration order is random,
        // and the Steam launch-options comparison relies on it.
        let mut entries: Vec<(String, String)> = dll_map.into_iter().collect();
        entries.sort_by(|a, b| a.0.cmp(&b.0));
        let dll_str = entries
            .into_iter()
            .map(|(k, v)| format!("{}={}", k, v))
            .collect::<Vec<_>>()
            .join(";");
        cmd.env("WINEDLLOVERRIDES", dll_str);
    }

    if prime_render_offload {
        cmd.env("DRI_PRIME", "1");
        cmd.env("__NV_PRIME_RENDER_OFFLOAD", "1");
        cmd.env("__GLX_VENDOR_LIBRARY_NAME", "nvidia");
        cmd.env("__VK_LAYER_NV_optimus", "NVIDIA_only");
    }

    // Proton specific environment (umu supplies its own Steam
    // compatibility vars inside the runtime container).
    if is_proton && !use_umu {
        cmd.env("STEAM_COMPAT_DATA_PATH", &prefix);
        if let Some(steam) = steam_candidate_roots().into_iter().next() {
            cmd.env("STEAM_COMPAT_CLIENT_INSTALL_PATH", steam.to_string_lossy().to_string());
        }
    }

    // Steam-owned titles launched directly (the running client drops the
    // flag env on `-applaunch`) still need the app id so Steamworks/DRM
    // and the overlay find the client.
    if let Some(app_id) = steam_app_id {
        let app_id = app_id.to_string();
        cmd.env("SteamAppId", &app_id);
        cmd.env("SteamGameId", &app_id);
        if let Some(steam) = steam_candidate_roots().into_iter().next() {
            cmd.env("SteamPath", steam.to_string_lossy().to_string());
        }
    }

    // User environment variables (filtered for exclusions), in a stable
    // order so launch-options prefixes don't churn between launches.
    let mut user_env: Vec<(&String, &String)> =
        settings.custom_environment_variables.iter().collect();
    user_env.sort_by(|a, b| a.0.cmp(b.0));
    for (k, v) in user_env {
        if !excluded_global_env.contains(k) {
            cmd.env(k, v);
        }
    }
    if let Some(game_envs) = game_profile
        .and_then(|p| p.get("environmentVariables").or_else(|| p.get("customEnv")))
        .and_then(|v| v.as_object())
    {
        for (k, v) in game_envs {
            if let Some(s) = v.as_str() {
                cmd.env(k, s);
            }
        }
    }

    // Redirect stdout and stderr into the log file
    let out_file = OpenOptions::new().append(true).open(&log_path).map_err(|e| e.to_string())?;
    let err_file = out_file.try_clone().map_err(|e| e.to_string())?;

    cmd.stdout(Stdio::from(out_file));
    cmd.stderr(Stdio::from(err_file));

    let child = cmd.spawn().map_err(|e| format!("Failed to spawn compatibility process: {}", e))?;
    Ok(child.id())
}

// ---------------------------------------------------------------------------
// Prefix Manager Data Structures & Operations
// ---------------------------------------------------------------------------

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

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;

    fn write_test_file(path: &Path, content: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    #[test]
    fn parses_vdf_install_path() {
        let raw = "\"install_path\"\t\t\"/usr/share/proton-cachyos-10.0\"\n\"name\"\t\t\"proton-cachyos (Steam Linux Runtime)\"\n";
        assert_eq!(
            vdf_key_values(raw, "install_path"),
            vec!["/usr/share/proton-cachyos-10.0"]
        );
        assert!(vdf_key_values(raw, "missing").is_empty());
    }

    #[test]
    fn parses_library_folders_vdf() {
        let raw = "\"LibraryFolders\"\n{\n\t\"1\"\t\t\"/mnt/games/SteamLibrary\"\n\t\"2\"\t\t\"/home/user/Games\"\n\t\"path\"\t\t\"/legacy/Library\"\n}\n";
        assert_eq!(
            parse_library_folders_vdf(raw),
            vec![
                PathBuf::from("/mnt/games/SteamLibrary"),
                PathBuf::from("/home/user/Games"),
                PathBuf::from("/legacy/Library"),
            ]
        );
        assert!(parse_library_folders_vdf("not a vdf").is_empty());
    }

    #[test]
    fn classifies_cachyos_proton_names() {
        assert!(is_cachyos_proton("CachyOS-Proton-9.0"));
        assert!(is_cachyos_proton("proton-cachyos-10.0-20251222-slr"));
        assert!(is_cachyos_proton("cachyos-proton-experimental"));
        assert!(!is_cachyos_proton("GE-Proton9-24"));

        assert_eq!(cachyos_version("CachyOS-Proton-9.0"), "9.0");
        assert_eq!(
            cachyos_version("proton-cachyos-10.0-20251222-slr"),
            "10.0-20251222-slr"
        );
        assert_eq!(cachyos_version("cachyos-proton"), "");
    }

    #[test]
    fn detects_steam_geproton_and_cachyos_proton() {
        // Point HOME at a scratch tree so detection walks a controlled
        // layout instead of the real user profile.
        let home = std::env::temp_dir().join(format!(
            "gameindex-compat-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&home);
        std::env::set_var("HOME", &home);

        // Primary Steam root with official Proton installs.
        let steam_root = home.join(".local/share/Steam");
        write_test_file(
            &steam_root.join("steamapps/common/Proton 9.0/proton"),
            "#!/bin/sh\n",
        );
        write_test_file(
            &steam_root.join("steamapps/common/Proton Experimental/proton"),
            "#!/bin/sh\n",
        );

        // Secondary library on another drive (libraryfolders.vdf).
        let lib2 = home.join("Games/SteamLibrary");
        write_test_file(&lib2.join("steamapps/common/Proton Hotfix/proton"), "#!/bin/sh\n");
        write_test_file(
            &steam_root.join("steamapps/libraryfolders.vdf"),
            &format!(
                "\"LibraryFolders\"\n{{\n\t\"1\"\t\t\"{}\"\n}}\n",
                lib2.display()
            ),
        );

        // GE-Proton and CachyOS Proton as plain directories.
        write_test_file(
            &steam_root.join("compatibilitytools.d/GE-Proton9-24/proton"),
            "#!/bin/sh\n",
        );
        write_test_file(
            &steam_root.join("compatibilitytools.d/CachyOS-Proton-9.0/proton"),
            "#!/bin/sh\n",
        );

        // CachyOS Proton via bare-VDF indirection (new packaging).
        let cachyos_install = home.join(".local/share/proton-cachyos-10.0-20251222-slr");
        write_test_file(&cachyos_install.join("proton"), "#!/bin/sh\n");
        write_test_file(
            &steam_root.join("compatibilitytools.d/proton-cachyos-10.0-20251222-slr.vdf"),
            &format!(
                "\"install_path\"\t\t\"{}\"\n",
                cachyos_install.display()
            ),
        );

        let runners = detect_compatibility_runners();
        let by_id: std::collections::HashMap<&str, &CompatibilityRunner> =
            runners.iter().map(|r| (r.id.as_str(), r)).collect();

        // Official Steam Proton on the primary library.
        let steam = by_id
            .get("steam-proton-9.0")
            .expect("Steam Proton 9.0 detected");
        assert!(steam.is_proton);
        assert_eq!(steam.kind, "proton");
        assert_eq!(steam.version.as_deref(), Some("9.0"));

        // Official Steam Proton on a secondary library.
        let hotfix = by_id
            .get("steam-proton-hotfix")
            .expect("Steam Proton Hotfix on secondary library");
        assert_eq!(hotfix.kind, "proton");
        assert!(hotfix.is_proton);

        // GE-Proton.
        let ge = by_id
            .get("compat-ge-proton9-24")
            .expect("GE-Proton detected");
        assert_eq!(ge.kind, "ge-proton");
        assert!(ge.is_proton);

        // CachyOS Proton (directory layout).
        let cachy_dir = runners
            .iter()
            .find(|r| r.path.replace('\\', "/").ends_with("CachyOS-Proton-9.0/proton"))
            .expect("CachyOS Proton directory runner");
        assert_eq!(cachy_dir.kind, "cachyos");
        assert_eq!(cachy_dir.version.as_deref(), Some("9.0"));
        assert!(cachy_dir.is_proton);

        // CachyOS Proton (bare-VDF indirection).
        let cachy_vdf = runners
            .iter()
            .find(|r| r.path.replace('\\', "/").ends_with("proton-cachyos-10.0-20251222-slr/proton"))
            .expect("CachyOS Proton VDF runner");
        assert_eq!(cachy_vdf.kind, "cachyos");
        assert_eq!(
            cachy_vdf.version.as_deref(),
            Some("10.0-20251222-slr")
        );
        assert!(cachy_vdf.is_proton);

        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn classifies_runner_proton_vs_wine_heuristic() {
        // Path-only fallback (no HOME manipulation — keeps parallel test
        // runs deterministic alongside the detection test above).
        assert!(proton_by_path_heuristic(
            "/home/u/.steam/steam/steamapps/common/Proton 9.0/proton"
        ));
        assert!(proton_by_path_heuristic(
            "/home/u/.steam/steam/compatibilitytools.d/GE-Proton9-24/proton"
        ));
        assert!(proton_by_path_heuristic(
            "/usr/share/steam/compatibilitytools.d/proton-cachyos-10.0/proton"
        ));
        assert!(!proton_by_path_heuristic("/usr/bin/wine"));
        assert!(!proton_by_path_heuristic("wine"));
        assert!(!proton_by_path_heuristic(
            "/home/u/.local/share/wine/runners/wine-9.0/bin/wine"
        ));
        // A wine binary whose path merely contains "proton" must still
        // classify as wine — the `wine` suffix wins.
        assert!(!proton_by_path_heuristic(
            "/home/u/proton-tools/build/bin/wine"
        ));
    }

    #[test]
    fn runner_is_proton_falls_back_to_heuristic_for_unknown_paths() {
        // Paths that can never appear in the detection list (no such
        // file on any machine) exercise the fallback branch.
        assert!(runner_is_proton(
            "/nonexistent/.steam/steam/compatibilitytools.d/GE-Proton9-24/proton"
        ));
        assert!(!runner_is_proton("/nonexistent/wine"));
        assert!(!runner_is_proton(
            "/nonexistent/.local/share/wine/runners/wine-9.0/bin/wine"
        ));
    }

    #[test]
    fn proton_folder_derives_folder_from_script_and_rejects_wine() {
        let dir = tempfile::tempdir().unwrap();
        let proton_dir = dir.path().join("Proton 9.0");
        write_test_file(&proton_dir.join("proton"), "#!/bin/sh\n");

        let script = proton_dir.join("proton");
        let folder = proton_folder_for_runner(&script.to_string_lossy())
            .expect("proton script resolves to its folder");
        assert_eq!(folder, proton_dir);

        // A plain wine binary (or any path whose parent lacks a `proton`
        // script) is not a Proton folder.
        let wine = dir.path().join("bin/wine");
        assert!(proton_folder_for_runner(&wine.to_string_lossy()).is_none());
        assert!(proton_folder_for_runner("/usr/bin/wine").is_none());
    }

    #[test]
    fn mangohud_config_reads_user_config_and_hides_only_when_requested() {
        let folder = Path::new("/home/u/.local/share/MangoHud");
        let shown = mangohud_log_config(folder, false);
        assert!(shown.starts_with("read_cfg,"), "got: {}", shown);
        assert!(shown.contains("log_interval=1000"));
        assert!(shown.contains("autostart_log=1"));
        assert!(!shown.contains("no_display"));

        let hidden = mangohud_log_config(folder, true);
        assert!(hidden.ends_with(",no_display"), "got: {}", hidden);
    }

    #[test]
    fn compatibility_settings_accepts_legacy_and_frontend_mangohud_keys() {
        // Older `compatibility.db` rows were written with serde's naive
        // camelCase (`enableMangohud`/`enableGamemode`) while the UI reads
        // and writes `enableMangoHud`/`enableGameMode`. Both spellings
        // must load, and a save must emit the keys the UI expects.
        let mut value = serde_json::to_value(CompatibilitySettings::default()).unwrap();
        let obj = value.as_object_mut().unwrap();
        obj.remove("enableMangoHud");
        obj.remove("enableGameMode");
        obj.insert("enableMangohud".to_string(), serde_json::json!(true));
        obj.insert("enableGamemode".to_string(), serde_json::json!(true));

        let parsed: CompatibilitySettings = serde_json::from_value(value).unwrap();
        assert!(parsed.enable_mangohud);
        assert!(parsed.enable_gamemode);

        let emitted = serde_json::to_value(&parsed).unwrap();
        assert_eq!(emitted["enableMangoHud"], serde_json::json!(true));
        assert_eq!(emitted["enableGameMode"], serde_json::json!(true));
        assert!(emitted.get("enableMangohud").is_none());
        assert!(emitted.get("enableGamemode").is_none());
    }

    #[test]
    fn compatibility_settings_partial_payload_keeps_defaults() {
        // A payload missing fields (older frontend, interrupted write) must
        // fill from defaults instead of discarding the whole profile.
        let parsed: CompatibilitySettings =
            serde_json::from_str(r#"{"enableMangoHud":true}"#).unwrap();
        assert!(parsed.enable_mangohud);
        assert!(parsed.enable_dxvk);
        assert!(parsed.enable_vkd3d);
    }

    #[test]
    fn steam_launch_env_carries_flags_but_no_prefix_or_runner() {
        let settings = CompatibilitySettings {
            enable_dxvk: true,
            enable_vkd3d: true,
            enable_esync: true,
            enable_fsync: true,
            ..Default::default()
        };
        let env = steam_launch_env(&settings, None, None);
        let map: std::collections::HashMap<&str, &str> = env
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_str()))
            .collect();

        assert_eq!(map.get("WINEESYNC"), Some(&"1"));
        assert_eq!(map.get("WINEFSYNC"), Some(&"1"));
        let dll = map.get("WINEDLLOVERRIDES").expect("DXVK dll overrides set");
        assert!(dll.contains("d3d11=n,b") && dll.contains("d3d12=n,b"));
        // Steam owns runner and prefix — they must never leak through.
        assert!(!map.contains_key("WINEPREFIX"));
        assert!(!map.contains_key("PROTONPATH"));
        assert!(!map.contains_key("STEAM_COMPAT_DATA_PATH"));
    }

    #[test]
    fn steam_launch_prefix_quotes_values_and_keeps_steam_in_charge() {
        let settings = CompatibilitySettings {
            enable_mangohud: true,
            custom_environment_variables: [(
                "GLOBAL_VAR".to_string(),
                "value with spaces".to_string(),
            )]
            .into_iter()
            .collect(),
            ..Default::default()
        };
        let prefix = steam_launch_prefix(&settings, None, None, None);

        assert!(prefix.contains("MANGOHUD=1"), "got: {prefix}");
        assert!(prefix.contains("WINEESYNC=1"), "got: {prefix}");
        assert!(prefix.contains("GLOBAL_VAR='value with spaces'"), "got: {prefix}");
        assert!(!prefix.contains("WINEPREFIX"));
        assert!(!prefix.contains("PROTONPATH"));
    }

    #[test]
    fn steam_launch_prefix_adds_proton_log_only_when_requested() {
        let settings = CompatibilitySettings::default();
        let without = steam_launch_prefix(&settings, None, None, None);
        assert!(!without.contains("PROTON_LOG"), "got: {without}");

        let with = steam_launch_prefix(
            &settings,
            None,
            None,
            Some(Path::new("/tmp/gameindex-logs/730")),
        );
        assert!(with.contains("PROTON_LOG=1"), "got: {with}");
        assert!(
            with.contains("PROTON_LOG_DIR=/tmp/gameindex-logs/730"),
            "got: {with}"
        );
    }

    #[test]
    fn steam_launch_prefix_uses_defaults_as_the_vanilla_baseline() {
        // Sanity check for the "don't touch Steam config for a vanilla
        // launch" comparison: default settings must round-trip equal.
        let defaults = CompatibilitySettings::default();
        assert_eq!(
            steam_launch_prefix(&defaults, None, None, None),
            steam_launch_prefix(&CompatibilitySettings::default(), None, None, None)
        );
        let customized = CompatibilitySettings {
            enable_mangohud: true,
            ..Default::default()
        };
        assert_ne!(
            steam_launch_prefix(&customized, None, None, None),
            steam_launch_prefix(&CompatibilitySettings::default(), None, None, None)
        );
    }

    #[test]
    fn steam_route_prefers_picker_then_direct_only_with_running_client() {
        // The picker always wins when the user asked for it.
        assert_eq!(
            choose_steam_route(true, true, true, true),
            SteamRoute::Picker
        );
        // Flags to deliver + Windows exe + running client: launch direct.
        assert_eq!(
            choose_steam_route(false, true, true, true),
            SteamRoute::Direct
        );
        // Cold client inherits the flag env on the `steam` process.
        assert_eq!(
            choose_steam_route(false, true, true, false),
            SteamRoute::Steam
        );
        // Nothing configured beyond the defaults: let Steam own it.
        assert_eq!(
            choose_steam_route(false, false, true, true),
            SteamRoute::Steam
        );
        // Native binaries carry no Wine/Proton flags.
        assert_eq!(
            choose_steam_route(false, true, false, true),
            SteamRoute::Steam
        );
    }

    #[test]
    fn steam_launch_env_applies_controller_and_anticheat_flags() {
        let settings = CompatibilitySettings {
            enable_controller_support: true,
            enable_anticheat_support: true,
            ..Default::default()
        };
        let profile = serde_json::json!({});
        let env = steam_launch_env(&settings, Some(&profile), None);
        let map: std::collections::HashMap<&str, &str> = env
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_str()))
            .collect();

        assert_eq!(map.get("PROTON_PREFER_SDL"), Some(&"1"));
        // Runtime env vars only appear when a runtime is actually installed.
        match eac_runtime_dir() {
            Some(dir) => assert_eq!(
                map.get("PROTON_EAC_RUNTIME").map(PathBuf::from),
                Some(dir)
            ),
            None => assert!(!map.contains_key("PROTON_EAC_RUNTIME")),
        }
        match battleye_runtime_dir() {
            Some(dir) => assert_eq!(
                map.get("PROTON_BATTLEYE_RUNTIME").map(PathBuf::from),
                Some(dir)
            ),
            None => assert!(!map.contains_key("PROTON_BATTLEYE_RUNTIME")),
        }

        // A per-game `false` overrides the global toggle.
        let off = serde_json::json!({ "enableControllerSupport": false, "enableAnticheatSupport": false });
        let env = steam_launch_env(&settings, Some(&off), None);
        let map: std::collections::HashMap<&str, &str> = env
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_str()))
            .collect();
        assert!(!map.contains_key("PROTON_PREFER_SDL"));
        assert!(!map.contains_key("PROTON_EAC_RUNTIME"));
        assert!(!map.contains_key("PROTON_BATTLEYE_RUNTIME"));
    }

    #[test]
    fn steam_launch_env_applies_game_overrides_and_exclusions() {
        let settings = CompatibilitySettings {
            enable_esync: false,
            custom_environment_variables: [("GLOBAL_VAR".to_string(), "g".to_string())]
                .into_iter()
                .collect(),
            ..Default::default()
        };
        let profile = serde_json::json!({
            "enableEsync": true,
            "environmentVariables": { "PER_GAME_VAR": "1" },
            "excludedGlobalEnv": ["GLOBAL_VAR"],
            "enableMangoHud": false,
        });
        let env = steam_launch_env(&settings, Some(&profile), None);
        let map: std::collections::HashMap<&str, &str> = env
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_str()))
            .collect();

        // Per-game override wins over the global default.
        assert_eq!(map.get("WINEESYNC"), Some(&"1"));
        // Excluded global vars are dropped; per-game vars still apply.
        assert!(!map.contains_key("GLOBAL_VAR"));
        assert_eq!(map.get("PER_GAME_VAR"), Some(&"1"));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn steam_launch_env_mangohud_hide_flag() {
        let settings = CompatibilitySettings {
            enable_mangohud: true,
            mangohud_hidden: true,
            ..Default::default()
        };
        let env = steam_launch_env(&settings, None, None);
        let map: std::collections::HashMap<&str, &str> = env
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_str()))
            .collect();

        assert_eq!(map.get("MANGOHUD"), Some(&"1"));
        let config = map.get("MANGOHUD_CONFIG").expect("mangohud config set");
        assert!(
            config.contains("read_cfg,") && config.contains("autostart_log=1") && config.contains(",no_display"),
            "got: {config}"
        );
    }

    #[test]
    fn steam_launch_env_pins_selected_gpu_and_forces_wayland() {
        let settings = CompatibilitySettings {
            use_specific_gpu: true,
            ..Default::default()
        };
        let selection = GpuSelection {
            pci_id: Some("10de:2c05".to_string()),
            vendor: Some("NVIDIA".to_string()),
            ..Default::default()
        };
        let env = steam_launch_env(&settings, None, Some(&selection));
        let map: std::collections::HashMap<&str, &str> = env
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_str()))
            .collect();

        assert_eq!(map.get("MESA_VK_DEVICE_SELECT"), Some(&"10de:2c05"));
        assert_eq!(map.get("VK_LOADER_DEVICE_SELECT"), Some(&"0x10de:0x2c05"));
        assert_eq!(map.get("WINE_ENABLE_WAYLAND"), Some(&"1"));
        assert_eq!(map.get("PROTON_ENABLE_WAYLAND"), Some(&"1"));
    }

    #[test]
    fn steam_launch_env_specific_gpu_respects_tristate_and_missing_id() {
        let nvidia = GpuSelection {
            pci_id: Some("10de:2c05".to_string()),
            ..Default::default()
        };
        let amd = GpuSelection {
            pci_id: Some("1002:744c".to_string()),
            ..Default::default()
        };

        // Global on, per-game off wins: no device pin, no forced Wayland.
        let global_on = CompatibilitySettings {
            use_specific_gpu: true,
            ..Default::default()
        };
        let profile_off = serde_json::json!({ "useSpecificGpu": false });
        let env = steam_launch_env(&global_on, Some(&profile_off), Some(&nvidia));
        let map: std::collections::HashMap<&str, &str> = env
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_str()))
            .collect();
        assert!(!map.contains_key("MESA_VK_DEVICE_SELECT"));
        assert!(!map.contains_key("VK_LOADER_DEVICE_SELECT"));
        assert!(!map.contains_key("WINE_ENABLE_WAYLAND"));
        assert!(!map.contains_key("PROTON_ENABLE_WAYLAND"));

        // Global off, per-game on wins.
        let profile_on = serde_json::json!({ "useSpecificGpu": true });
        let global_off = CompatibilitySettings::default();
        let env = steam_launch_env(&global_off, Some(&profile_on), Some(&amd));
        let map: std::collections::HashMap<&str, &str> = env
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_str()))
            .collect();
        assert_eq!(map.get("MESA_VK_DEVICE_SELECT"), Some(&"1002:744c"));

        // Enabled but the launch carries no selected GPU.
        let env = steam_launch_env(&global_on, None, None);
        let map: std::collections::HashMap<&str, &str> = env
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_str()))
            .collect();
        assert!(!map.contains_key("MESA_VK_DEVICE_SELECT"));
        assert!(!map.contains_key("WINE_ENABLE_WAYLAND"));
    }

    #[test]
    fn specific_gpu_selection_requires_enabled_non_blank_id() {
        let settings = CompatibilitySettings {
            use_specific_gpu: true,
            ..Default::default()
        };
        let blank = GpuSelection {
            pci_id: Some("   ".to_string()),
            ..Default::default()
        };
        assert_eq!(specific_gpu_selection(&settings, None, Some(&blank)), None);

        let padded = GpuSelection {
            pci_id: Some(" 10de:2c05 ".to_string()),
            ..Default::default()
        };
        assert_eq!(
            specific_gpu_selection(&settings, None, Some(&padded)),
            Some(GpuSelection {
                pci_id: Some("10de:2c05".to_string()),
                ..Default::default()
            })
        );

        let disabled = CompatibilitySettings::default();
        assert_eq!(specific_gpu_selection(&disabled, None, Some(&padded)), None);
    }

    #[test]
    fn specific_gpu_selection_falls_back_to_persisted_id() {
        let settings = CompatibilitySettings {
            use_specific_gpu: true,
            specific_gpu_id: Some("1002:744c".to_string()),
            ..Default::default()
        };
        // No launch-provided selection (tray launch) — the persisted id is used.
        assert_eq!(
            specific_gpu_selection(&settings, None, None),
            Some(GpuSelection {
                pci_id: Some("1002:744c".to_string()),
                ..Default::default()
            })
        );
        // A fresh selection overrides the persisted one.
        let fresh = GpuSelection {
            pci_id: Some("10de:2c05".to_string()),
            ..Default::default()
        };
        assert_eq!(
            specific_gpu_selection(&settings, None, Some(&fresh)),
            Some(fresh)
        );
        // A persisted PCI slot keeps its unique identity.
        let slot_settings = CompatibilitySettings {
            use_specific_gpu: true,
            specific_gpu_id: Some("0000:03:00.0".to_string()),
            ..Default::default()
        };
        assert_eq!(
            specific_gpu_selection(&slot_settings, None, None),
            Some(GpuSelection {
                pci_slot: Some("0000:03:00.0".to_string()),
                ..Default::default()
            })
        );
        // A blank persisted id disables the fallback.
        let blank = CompatibilitySettings {
            use_specific_gpu: true,
            specific_gpu_id: Some("   ".to_string()),
            ..Default::default()
        };
        assert_eq!(specific_gpu_selection(&blank, None, None), None);
    }

    #[test]
    fn specific_gpu_env_full_nvidia_matrix() {
        let selection = GpuSelection {
            pci_id: Some("10de:2c05".to_string()),
            pci_slot: Some("0000:01:00.0".to_string()),
            vulkan_uuid: Some("B5291141-3FF6-F8BF-C85D-2F8E52FC144D".to_string()),
            vulkan_index: Some(1),
            vendor: Some("NVIDIA".to_string()),
            nvidia_provider: Some("NVIDIA-G1".to_string()),
        };
        let env = specific_gpu_env(&selection);
        let map: std::collections::HashMap<&str, &str> = env
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_str()))
            .collect();

        assert_eq!(
            map.get("DXVK_FILTER_DEVICE_UUID"),
            Some(&"b52911413ff6f8bfc85d2f8e52fc144d")
        );
        assert_eq!(map.get("ENABLE_DEVICE_CHOOSER_LAYER"), Some(&"1"));
        assert_eq!(map.get("VULKAN_DEVICE_INDEX"), Some(&"1"));
        assert_eq!(map.get("VK_LOADER_DEVICE_SELECT"), Some(&"0x10de:0x2c05"));
        assert_eq!(map.get("MESA_VK_DEVICE_SELECT"), Some(&"10de:2c05"));
        assert_eq!(map.get("__NV_PRIME_RENDER_OFFLOAD"), Some(&"1"));
        assert_eq!(map.get("__GLX_VENDOR_LIBRARY_NAME"), Some(&"nvidia"));
        assert_eq!(map.get("__NV_PRIME_RENDER_OFFLOAD_PROVIDER"), Some(&"NVIDIA-G1"));
        assert_eq!(map.get("__VK_LAYER_NV_optimus"), Some(&"NVIDIA_only"));
        assert!(!map.contains_key("DRI_PRIME"));
    }

    #[test]
    fn specific_gpu_env_mesa_uses_pci_slot_for_dri_prime() {
        let selection = GpuSelection {
            pci_id: Some("1002:744c".to_string()),
            pci_slot: Some("0000:03:00.0".to_string()),
            vendor: Some("AMD".to_string()),
            ..Default::default()
        };
        let env = specific_gpu_env(&selection);
        let map: std::collections::HashMap<&str, &str> = env
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_str()))
            .collect();

        assert_eq!(map.get("DRI_PRIME"), Some(&"pci-0000_03_00_0"));
        assert_eq!(map.get("VK_LOADER_DEVICE_SELECT"), Some(&"0x1002:0x744c"));
        assert!(!map.contains_key("__NV_PRIME_RENDER_OFFLOAD"));
        assert!(!map.contains_key("DXVK_FILTER_DEVICE_UUID"));
    }

    #[test]
    fn specific_gpu_env_rejects_malformed_fields() {
        let selection = GpuSelection {
            pci_id: Some("not-a-pci-id".to_string()),
            pci_slot: Some("garbage".to_string()),
            vulkan_uuid: Some("1234".to_string()),
            vendor: Some("NVIDIA".to_string()),
            nvidia_provider: Some("GPU-1".to_string()),
            ..Default::default()
        };
        assert!(specific_gpu_env(&selection).is_empty());
    }

    #[test]
    fn dir_size_bytes_calculates_accurately() {
        let dir = tempfile::tempdir().unwrap();
        let sub = dir.path().join("subdir");
        fs::create_dir_all(&sub).unwrap();

        fs::write(dir.path().join("file1.bin"), b"12345").unwrap(); // 5 bytes
        fs::write(sub.join("file2.bin"), b"1234567890").unwrap(); // 10 bytes

        let size = dir_size_bytes(dir.path()).expect("computes size");
        assert_eq!(size, 15);
    }

    #[test]
    fn is_release_installed_matches_tags_and_names() {
        let detected = vec![
            CompatibilityRunner {
                id: "compat-ge-proton9-25".to_string(),
                name: "GE-Proton9-25".to_string(),
                path: "/path/to/GE-Proton9-25/proton".to_string(),
                kind: "ge-proton".to_string(),
                version: Some("GE-Proton9-25".to_string()),
                is_proton: true,
                size_bytes: Some(1024),
                is_deletable: true,
                install_dir: Some("/path/to/GE-Proton9-25".to_string()),
            },
            CompatibilityRunner {
                id: "runner-wine-lutris-ge".to_string(),
                name: "lutris-GE-Proton8-26-x86_64".to_string(),
                path: "/path/to/lutris-GE-Proton8-26-x86_64/bin/wine".to_string(),
                kind: "wine".to_string(),
                version: Some("lutris-GE-Proton8-26-x86_64".to_string()),
                is_proton: false,
                size_bytes: Some(2048),
                is_deletable: true,
                install_dir: Some("/path/to/lutris-GE-Proton8-26-x86_64".to_string()),
            },
        ];

        assert!(is_release_installed(&detected, "GE-Proton9-25", "GE-Proton9-25"));
        assert!(is_release_installed(&detected, "GE-Proton9-25", "Release 9-25"));
        assert!(is_release_installed(&detected, "lutris-GE-Proton8-26", "lutris-GE-Proton8-26-x86_64"));
        assert!(!is_release_installed(&detected, "GE-Proton9-26", "GE-Proton9-26"));
    }

    #[test]
    fn runner_sources_map_to_repos_and_targets() {
        assert_eq!(
            runner_source("ge-proton"),
            Some(("GloriousEggroll/proton-ge-custom", "proton"))
        );
        assert_eq!(
            runner_source("cachyos"),
            Some(("CachyOS/proton-cachyos", "proton"))
        );
        assert_eq!(
            runner_source("proton-em"),
            Some(("BananaWorks07/Proton", "proton"))
        );
        assert_eq!(
            runner_source("wine-ge"),
            Some(("GloriousEggroll/wine-ge-custom", "wine"))
        );
        assert_eq!(runner_source("kron4ek"), Some(("Kron4ek/Wine-Builds", "wine")));
        assert_eq!(runner_source("soda"), Some(("bottlesdevs/wine", "wine")));
        assert_eq!(runner_source("lutris"), None);
        assert_eq!(runner_source("unknown"), None);
    }

    #[test]
    fn runner_asset_matches_format_checksums_and_host_arch() {
        // Checksum sidecars never match, whatever the source or arch.
        for name in [
            "GE-Proton11-6-x86_64.sha512sum",
            "proton-EM-10.0-37-HDR.sha256sum",
            "sha256sums.txt",
        ] {
            assert!(!runner_asset_matches("ge-proton", name), "{name}");
            assert!(!runner_asset_matches("kron4ek", name), "{name}");
            assert!(!runner_asset_matches("proton-em", name), "{name}");
        }

        // Proton-EM publishes one arch-agnostic tarball.
        assert!(runner_asset_matches("proton-em", "proton-EM-10.0-37-HDR.tar.xz"));
        assert!(!runner_asset_matches("proton-em", "proton-EM-10.0-37-HDR.zip"));

        // Kron4ek only ships x86/amd64 builds.
        assert!(runner_asset_matches("kron4ek", "wine-11.17-amd64-wow64.tar.xz"));
        assert!(!runner_asset_matches("kron4ek", "wine-11.17-staging-tkg-x86.tar.xz"));

        if host_is_arm64() {
            assert!(runner_asset_matches("ge-proton", "GE-Proton11-6-aarch64.tar.gz"));
            assert!(!runner_asset_matches("ge-proton", "GE-Proton11-6-x86_64.tar.gz"));
            assert!(runner_asset_matches("cachyos", "proton-cachyos-11.0-slr-arm64.tar.xz"));
            assert!(!runner_asset_matches("cachyos", "proton-cachyos-11.0-slr-x86_64.tar.xz"));
            assert!(runner_asset_matches("soda", "soda-11.0-10-aarch64.tar.xz"));
            assert!(!runner_asset_matches("soda", "soda-11.0-10-x86_64.tar.xz"));
        } else {
            assert!(runner_asset_matches("ge-proton", "GE-Proton11-6-x86_64.tar.gz"));
            assert!(!runner_asset_matches("ge-proton", "GE-Proton11-6-aarch64.tar.gz"));
            assert!(runner_asset_matches("cachyos", "proton-cachyos-11.0-slr-x86_64.tar.xz"));
            assert!(!runner_asset_matches("cachyos", "proton-cachyos-11.0-slr-x86_64_v3.tar.xz"));
            assert!(!runner_asset_matches("cachyos", "proton-cachyos-11.0-slr-arm64.tar.xz"));
            assert!(runner_asset_matches("soda", "soda-11.0-10-x86_64.tar.xz"));
            assert!(!runner_asset_matches("soda", "soda-11.0-10-aarch64.tar.xz"));
        }
    }

    #[test]
    #[cfg(unix)]
    fn extracts_runner_archive_and_fixes_binary_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let root = tempfile::tempdir().unwrap();
        let src = root.path().join("src/GE-Test");
        write_test_file(&src.join("proton"), "#!/bin/sh\n");
        write_test_file(&src.join("bin/wine"), "#!/bin/sh\n");
        write_test_file(&src.join("bin/wine64"), "#!/bin/sh\n");
        fs::set_permissions(&src.join("proton"), fs::Permissions::from_mode(0o644)).unwrap();

        let archive = root.path().join("GE-Test.tar.gz");
        let status = Command::new("tar")
            .arg("-czf")
            .arg(&archive)
            .arg("-C")
            .arg(root.path().join("src"))
            .arg("GE-Test")
            .status()
            .expect("creates runner archive");
        assert!(status.success());

        let dest = root.path().join("dest");
        let out = extract_runner_archive(&archive, &dest).unwrap();
        assert_eq!(out, dest);
        assert!(dest.join("GE-Test/proton").is_file());

        for rel in ["GE-Test/proton", "GE-Test/bin/wine", "GE-Test/bin/wine64"] {
            let mode = fs::metadata(dest.join(rel)).unwrap().permissions().mode();
            assert!(mode & 0o111 != 0, "{rel} should be executable, got {mode:o}");
        }
    }

    #[test]
    fn inspects_standard_wine_prefix() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        fs::create_dir_all(p.join("drive_c")).unwrap();

        let reg_content = "WINE REGISTRY Version 2\n;; All keys relative to \\Machine\n#arch=win64\n\n[Software\\\\Microsoft\\\\Windows NT\\\\CurrentVersion]\n\"ProductName\"=\"Windows 10 Pro\"\n\"CurrentVersion\"=\"10.0\"\n";
        fs::write(p.join("system.reg"), reg_content).unwrap();

        let (is_valid, is_proton, arch, win_version, _wine_ver) = inspect_prefix_path(p);
        assert!(is_valid);
        assert!(!is_proton);
        assert_eq!(arch, "win64");
        assert_eq!(win_version, Some("Windows 10 Pro".to_string()));
    }

    #[test]
    fn inspects_proton_prefix() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        fs::create_dir_all(p.join("pfx").join("drive_c")).unwrap();

        let reg_content = "WINE REGISTRY Version 2\n#arch=win32\n";
        fs::write(p.join("pfx").join("system.reg"), reg_content).unwrap();
        fs::write(p.join("version"), "Proton 9.0-2\n").unwrap();

        let (is_valid, is_proton, arch, _win_version, wine_ver) = inspect_prefix_path(p);
        assert!(is_valid);
        assert!(is_proton);
        assert_eq!(arch, "win32");
        assert_eq!(wine_ver, Some("Proton 9.0-2".to_string()));
    }

    #[test]
    fn copies_directory_recursively() {
        let src_dir = tempfile::tempdir().unwrap();
        let dst_dir = tempfile::tempdir().unwrap();
        let dst_target = dst_dir.path().join("copied_prefix");

        let sub = src_dir.path().join("drive_c").join("windows");
        fs::create_dir_all(&sub).unwrap();
        fs::write(sub.join("test.dll"), b"MZ_binary_header").unwrap();

        copy_dir_recursive(src_dir.path(), &dst_target).unwrap();

        assert!(dst_target.join("drive_c").join("windows").join("test.dll").is_file());
    }

    #[test]
    fn picks_runtime_url_from_index() {
        let body = r#"[
            {"name":"battleye_runtime","url":"https://example.com/be.tar.xz"},
            {"name":"eac_runtime","url":"https://example.com/eac.tar.xz"}
        ]"#;

        assert_eq!(
            runtime_url_from_index(body, "eac_runtime").unwrap(),
            "https://example.com/eac.tar.xz"
        );
    }

    #[test]
    fn errors_when_runtime_missing_from_index() {
        assert!(runtime_url_from_index("[]", "eac_runtime").is_err());
        assert!(runtime_url_from_index("not json", "eac_runtime").is_err());
    }

    #[test]
    fn extracts_runtime_archive_without_top_level_folder() {
        let dir = tempfile::tempdir().unwrap();
        let staging = dir.path().join("staging");
        let archive = dir.path().join("runtime.tar.gz");
        let dest = dir.path().join("eac_runtime");

        fs::create_dir_all(staging.join("eac_runtime").join("v2")).unwrap();
        fs::write(staging.join("eac_runtime").join("v2").join("easyanticheat.so"), b"so").unwrap();

        let status = Command::new("tar")
            .arg("-czf")
            .arg(&archive)
            .arg("-C")
            .arg(&staging)
            .arg("eac_runtime")
            .status()
            .unwrap();
        assert!(status.success());

        extract_anticheat_archive(&archive, &dest).unwrap();
        assert!(dest.join("v2").join("easyanticheat.so").is_file());
    }

    #[test]
    fn errors_extracting_a_missing_runtime_archive() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("eac_runtime");

        assert!(extract_anticheat_archive(&dir.path().join("missing.tar.xz"), &dest).is_err());
    }

    #[test]
    fn newest_log_file_picks_the_latest_log() {
        let dir = tempfile::tempdir().unwrap();
        let older = dir.path().join("steam-100.log");
        let newer = dir.path().join("steam-200.log");
        fs::write(&older, "old session").unwrap();
        std::thread::sleep(Duration::from_millis(30));
        fs::write(&newer, "new session").unwrap();
        fs::write(dir.path().join("notes.txt"), "ignored").unwrap();

        assert_eq!(newest_log_file(dir.path()), Some(newer));
        assert_eq!(newest_log_file(&dir.path().join("missing")), None);
    }

    #[test]
    fn prefix_resolution_prefers_game_override_then_shared_default() {
        let fallback = PathBuf::from("/fallback/base");

        let custom = resolve_prefix_from(
            Some("  /games/foo/custom  "),
            Some("/shared/prefix"),
            Some("/configured/base"),
            fallback.clone(),
            "game-1",
        );
        assert_eq!(custom, PathBuf::from("/games/foo/custom"));

        let shared = resolve_prefix_from(
            None,
            Some(" /shared/prefix "),
            Some("/configured/base"),
            fallback,
            "game-1",
        );
        assert_eq!(shared, PathBuf::from("/shared/prefix"));
    }

    #[test]
    fn prefix_resolution_falls_back_to_per_game_dirs() {
        let fallback = PathBuf::from("/fallback/base");

        let configured = resolve_prefix_from(
            None,
            None,
            Some("/configured/base"),
            fallback.clone(),
            "game-2",
        );
        assert_eq!(configured, PathBuf::from("/configured/base/game-2"));

        let blank = resolve_prefix_from(
            Some("   "),
            Some("  "),
            Some(""),
            fallback.clone(),
            "game-3",
        );
        assert_eq!(blank, fallback.join("game-3"));
    }

    #[test]
    fn shared_prefix_opts_out_of_steam_compat_injection() {
        let profile = with_steam_prefix(None, 123, Some("/shared/prefix")).unwrap();
        assert!(profile.get("customWinePrefix").is_none());

        let explicit = with_steam_prefix(
            Some(serde_json::json!({ "customWinePrefix": "/game/own" })),
            123,
            Some("/shared/prefix"),
        )
        .unwrap();
        assert_eq!(explicit["customWinePrefix"], "/game/own");
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn strips_appimage_env_entries_and_keeps_user_paths() {
        let app_dir = Path::new("/tmp/.mount_GameInkEnBaL/usr");
        let vars = vec![
            ("PYTHONHOME".to_string(), "/tmp/.mount_GameInkEnBaL/usr/".to_string()),
            (
                "PYTHONPATH".to_string(),
                "/tmp/.mount_GameInkEnBaL/usr/share/pyshared:/home/seth/pylib".to_string(),
            ),
            (
                "LD_LIBRARY_PATH".to_string(),
                "/home/seth/lib:/tmp/.mount_GameInkEnBaL/usr/lib".to_string(),
            ),
            ("PATH".to_string(), "/usr/bin".to_string()),
        ];

        assert_eq!(
            appimage_env_overrides(
                app_dir,
                &vars,
                &["PYTHONHOME", "PYTHONPATH", "LD_LIBRARY_PATH"],
            ),
            vec![
                ("PYTHONHOME".to_string(), None),
                (
                    "PYTHONPATH".to_string(),
                    Some("/home/seth/pylib".to_string())
                ),
                (
                    "LD_LIBRARY_PATH".to_string(),
                    Some("/home/seth/lib".to_string())
                ),
            ]
        );
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn leaves_environment_alone_outside_an_appimage() {
        let app_dir = Path::new("/tmp/.mount_GameInkEnBaL/usr");
        let vars = vec![
            ("PYTHONHOME".to_string(), "/usr".to_string()),
            ("PYTHONPATH".to_string(), "/home/seth/pylib".to_string()),
        ];

        assert!(appimage_env_overrides(app_dir, &vars, &["PYTHONHOME", "PYTHONPATH"]).is_empty());
    }
}
