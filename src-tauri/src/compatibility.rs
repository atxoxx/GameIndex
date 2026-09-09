//! Wine, Proton, and Linux compatibility layer runner and environment tools.

use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::SystemTime;
use serde::{Deserialize, Serialize};
use tauri::Manager;
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompatibilitySettings {
    pub default_runner_path: Option<String>,
    pub default_prefix_base_dir: Option<String>,
    pub enable_dxvk: bool,
    pub enable_vkd3d: bool,
    pub enable_esync: bool,
    pub enable_fsync: bool,
    pub enable_dxvk_nvapi: bool,
    pub enable_mangohud: bool,
    pub enable_gamemode: bool,
    pub enable_gamescope: bool,
    pub gamescope_args: Option<String>,
    pub prime_render_offload: bool,
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
}

impl Default for CompatibilitySettings {
    fn default() -> Self {
        Self {
            default_runner_path: None,
            default_prefix_base_dir: None,
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
                if p.is_absolute() && !out.contains(&p) {
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
                        runners.push(CompatibilityRunner {
                            id: format!("steam-{}", name.to_lowercase().replace(' ', "-")),
                            name: format!("Steam {}", name),
                            path: p_str,
                            kind: "proton".to_string(),
                            version: Some(ver),
                            is_proton: true,
                        });
                    }
                }
            }
        }
    }

    // 2. Compatibility tools in `compatibilitytools.d` — user Steam
    //    roots plus the system-wide distro directory (CachyOS ships
    //    proton-cachyos to /usr/share/steam/compatibilitytools.d).
    let mut compat_dirs: Vec<PathBuf> = steam_roots
        .iter()
        .map(|r| r.join("compatibilitytools.d"))
        .collect();
    #[cfg(target_os = "linux")]
    compat_dirs.push(PathBuf::from("/usr/share/steam/compatibilitytools.d"));

    for dir in &compat_dirs {
        let Ok(entries) = fs::read_dir(dir) else { continue };
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            let base_name = name.trim_end_matches(".vdf");

            // System-package layout: a bare VDF at the top of
            // compatibilitytools.d whose `install_path` points at the
            // real tool directory (used by newer CachyOS packaging).
            let script = if name.ends_with(".vdf") {
                fs::read_to_string(e.path())
                    .ok()
                    .and_then(|raw| {
                        vdf_key_values(&raw, "install_path")
                            .into_iter()
                            .next()
                            .map(|p| PathBuf::from(p).join("proton"))
                    })
            } else {
                Some(e.path().join("proton"))
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
                });
            } else {
                runners.push(CompatibilityRunner {
                    id: format!("compat-{}", base_name.to_lowercase().replace(' ', "-")),
                    name: base_name.to_string(),
                    path: p_str,
                    kind: "ge-proton".to_string(),
                    version: Some(base_name.to_string()),
                    is_proton: true,
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
            h.join(".config/heroic/tools/wine"),
            h.join(".config/heroic/tools/proton"),
            h.join(".local/share/proton-runners"),
            h.join(".local/share/wine-custom"),
        ];

        for dir in &runner_dirs {
            if let Ok(entries) = fs::read_dir(dir) {
                for e in entries.flatten() {
                    let name = e.file_name().to_string_lossy().to_string();
                    let wine_bin = e.path().join("bin/wine");
                    let proton_bin = e.path().join("proton");

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
                            });
                        }
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

    LinuxSystemStatus {
        os_name,
        kernel_version,
        display_server,
        vulkan_support,
        gamemode_available,
        mangohud_available,
        gamescope_available,
        winetricks_available,
    }
}

/// Resolve the directory used for per-game WINEPREFIXes.
pub fn resolve_prefix_dir(app: &tauri::AppHandle, custom_dir: Option<&str>, game_id: &str) -> PathBuf {
    if let Some(c) = custom_dir {
        if !c.trim().is_empty() {
            let p = PathBuf::from(c.trim());
            return p;
        }
    }

    let base = if let Ok(db_settings) = get_compatibility_settings_internal(app) {
        if let Some(d) = db_settings.default_prefix_base_dir {
            if !d.trim().is_empty() {
                PathBuf::from(d.trim())
            } else {
                default_prefix_base(app)
            }
        } else {
            default_prefix_base(app)
        }
    } else {
        default_prefix_base(app)
    };

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

/// Get the log file path for a game's Wine/Proton session.
pub fn wine_log_path_for_game(app: &tauri::AppHandle, game_id: &str) -> PathBuf {
    let dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("wine_logs");
    let _ = fs::create_dir_all(&dir);
    dir.join(format!("{}.log", game_id))
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

#[tauri::command]
pub fn set_compatibility_settings(
    app: tauri::AppHandle,
    settings: CompatibilitySettings,
) -> Result<(), String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let json = serde_json::to_string(&settings).map_err(|e| e.to_string())?;
    db::compatibility::set_global_settings(db_state.inner(), &json)?;
    Ok(())
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
    let p = wine_log_path_for_game(&app, &game_id);
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
    Ok(())
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

    let is_proton = effective_runner.contains("proton") && !effective_runner.ends_with("wine");

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
    let enable_mangohud = game_profile
        .and_then(|p| p.get("enableMangoHud").or_else(|| p.get("mangohud")))
        .and_then(|v| v.as_bool())
        .unwrap_or(settings.enable_mangohud);
    let enable_gamemode = game_profile
        .and_then(|p| p.get("enableGameMode").or_else(|| p.get("gamemode")))
        .and_then(|v| v.as_bool())
        .unwrap_or(settings.enable_gamemode);
    let enable_gamescope = game_profile
        .and_then(|p| p.get("enableGamescope").or_else(|| p.get("gamescope")))
        .and_then(|v| v.as_bool())
        .unwrap_or(settings.enable_gamescope);

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
    let prime_render_offload = game_profile
        .and_then(|p| p.get("primeRenderOffload").or_else(|| p.get("primeOffload")))
        .and_then(|v| v.as_bool())
        .unwrap_or(settings.prime_render_offload);

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
    } else if let Some(r) = settings.default_runner_path.filter(|s| !s.trim().is_empty()) {
        r
    } else {
        let detected = detect_compatibility_runners();
        detected
            .into_iter()
            .next()
            .map(|r| r.path)
            .unwrap_or_else(|| "wine".to_string())
    };

    let is_proton = runner_path.contains("proton") && !runner_path.ends_with("wine");

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
    let _ = writeln!(log_file, "MangoHud: {}, GameMode: {}, Gamescope: {}", enable_mangohud, enable_gamemode, enable_gamescope);
    let _ = writeln!(log_file, "==================================================");
    let _ = log_file.flush();

    // Build the command chain.
    // Order: [gamescope [args] --] [gamemoderun] [mangohud] runner [run] [virtual desktop / exe] [args]
    let mut tokens: Vec<String> = Vec::new();

    if enable_gamescope && is_command_available("gamescope") {
        tokens.push("gamescope".to_string());
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
            for arg in args_str.split_whitespace() {
                tokens.push(arg.to_string());
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
    }

    if enable_gamemode && is_command_available("gamemoderun") {
        tokens.push("gamemoderun".to_string());
    }

    if enable_mangohud && is_command_available("mangohud") {
        tokens.push("mangohud".to_string());
    }

    tokens.push(runner_path.clone());
    if is_proton {
        tokens.push("run".to_string());
    }

    if virtual_desktop {
        tokens.push("explorer.exe".to_string());
        let res = virtual_desktop_res.as_deref().unwrap_or("1920x1080");
        tokens.push(format!("/desktop=GameIndex,{}", res));
    }

    tokens.push(exe_path.to_string_lossy().to_string());

    if let Some(args) = launch_args {
        if !args.trim().is_empty() {
            for a in args.split_whitespace() {
                tokens.push(a.to_string());
            }
        }
    }

    let program = tokens.remove(0);
    let mut cmd = Command::new(&program);
    cmd.args(&tokens);
    cmd.current_dir(working_dir);

    // Environment variables
    cmd.env("WINEPREFIX", &prefix);

    // Linux: enable MangoHud CSV logging (auto-start after 1s, one line per
    // second) into a folder `metrics_collector` scans, so the overlay also
    // feeds real-time FPS/frametimes into the session telemetry instead of
    // being display-only. `MANGOHUD_CONFIG` only overrides the listed keys;
    // the rest of the user's MangoHud.conf still applies. A user-supplied
    // `MANGOHUD_CONFIG` in custom env vars below still wins.
    #[cfg(target_os = "linux")]
    if enable_mangohud && is_command_available("mangohud") {
        if let Some(folder) = linux_mangohud_log_dir() {
            if fs::create_dir_all(&folder).is_ok() {
                cmd.env(
                    "MANGOHUD_CONFIG",
                    format!(
                        "log_interval=1000,output_folder={},autostart_log=1",
                        folder.display()
                    ),
                );
            }
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
    if enable_wow64 {
        cmd.env("WINE_NEW_WOW64", "1");
    }
    if enable_large_address_aware {
        cmd.env("WINE_LARGE_ADDRESS_AWARE", "1");
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
        let dll_str = dll_map
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

    // Proton specific environment
    if is_proton {
        cmd.env("STEAM_COMPAT_DATA_PATH", &prefix);
        if let Some(steam) = steam_candidate_roots().into_iter().next() {
            cmd.env("STEAM_COMPAT_CLIENT_INSTALL_PATH", steam.to_string_lossy().to_string());
        }
    }

    // User environment variables (filtered for exclusions)
    for (k, v) in &settings.custom_environment_variables {
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
            .find(|r| r.path.ends_with("CachyOS-Proton-9.0/proton"))
            .expect("CachyOS Proton directory runner");
        assert_eq!(cachy_dir.kind, "cachyos");
        assert_eq!(cachy_dir.version.as_deref(), Some("9.0"));
        assert!(cachy_dir.is_proton);

        // CachyOS Proton (bare-VDF indirection).
        let cachy_vdf = runners
            .iter()
            .find(|r| r.path.ends_with("proton-cachyos-10.0-20251222-slr/proton"))
            .expect("CachyOS Proton VDF runner");
        assert_eq!(cachy_vdf.kind, "cachyos");
        assert_eq!(
            cachy_vdf.version.as_deref(),
            Some("10.0-20251222-slr")
        );
        assert!(cachy_vdf.is_proton);

        let _ = fs::remove_dir_all(&home);
    }
}
