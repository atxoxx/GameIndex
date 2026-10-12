use serde::{Deserialize, Serialize};
use std::collections::HashMap;


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
    /// VKD3D descriptor-heap mode (`VKD3D_CONFIG=descriptor_heap` /
    /// `PROTON_VKD3D_HEAP=1`). Some drivers still ship descriptor-heap
    /// bugs, so it can be switched off per game or globally.
    pub enable_vkd3d_descriptor_heap: bool,
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
            enable_vkd3d_descriptor_heap: true,
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
