//! Host hardware/system-info commands.

use std::sync::Arc;
use tauri::Manager;
use crate::gpu_detector;
use crate::gpu_detector::GpuInfo;
use crate::game_watcher::GameWatcher;
use crate::metrics_collector;

/// Detect GPUs on the system using WMI.
#[tauri::command]
pub fn detect_gpus() -> Vec<GpuInfo> {
    cached_system_info().gpus
}

/// Close the startup splash window and reveal the main window once the
/// frontend has finished its first render. Idempotent - safe to call
/// multiple times (React StrictMode double-mount) or when the splash has
/// already been dismissed.
#[tauri::command]
pub fn close_splashscreen(app: tauri::AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
    if let Some(splash) = app.get_webview_window("splashscreen") {
        let _ = splash.close();
    }
}

/// Static summary of the host hardware, returned by `get_system_info`.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub cpu_name: String,
    pub ram_gb: u32,
    pub gpus: Vec<GpuInfo>,
}

/// Cached host-hardware summary. Detection (COM init + WMI enumeration on a
/// spawned thread) is non-trivial, and the values (CPU name, RAM, GPUs) don't
/// change during a run — so compute once and reuse across the multiple
/// surfaces that call `get_system_info` / `detect_gpus`. Cleared by the
/// `refresh_hardware` command when the user asks to re-detect GPUs.
static HARDWARE_CACHE: std::sync::Mutex<Option<SystemInfo>> = std::sync::Mutex::new(None);

/// Return the host hardware summary, detecting it once and caching the result.
fn cached_system_info() -> SystemInfo {
    let mut cache = HARDWARE_CACHE.lock().expect("hardware cache poisoned");
    if let Some(info) = cache.as_ref() {
        return info.clone();
    }
    let info = SystemInfo {
        cpu_name: metrics_collector::get_cpu_name(),
        ram_gb: metrics_collector::get_system_ram_gb(),
        gpus: gpu_detector::detect_gpus(),
    };
    *cache = Some(info.clone());
    info
}

/// Get total system RAM in GB.
#[tauri::command]
pub fn get_system_ram_gb() -> u32 {
    metrics_collector::get_system_ram_gb()
}

/// Summary of the host system's hardware, used by the Settings → Hardware
/// tab's "System summary" card. Returns the CPU model name, total RAM (GB),
/// and the full list of detected GPUs (not just the one chosen for monitoring).
#[tauri::command]
pub fn get_system_info() -> SystemInfo {
    cached_system_info()
}

/// Invalidate the cached hardware summary so the next `detect_gpus` /
/// `get_system_info` call re-detects (e.g. after the user plugs in an eGPU or
/// installs a driver).
#[tauri::command]
pub fn refresh_hardware() {
    if let Ok(mut cache) = HARDWARE_CACHE.lock() {
        *cache = None;
    }
}

/// Persist the user's telemetry configuration (master toggle, sampling
/// interval, per-metric capture flags) so the game watcher applies it to
/// the next collection thread.
#[tauri::command]
pub fn set_metrics_config(
    state: tauri::State<Arc<std::sync::Mutex<GameWatcher>>>,
    config: metrics_collector::MetricsConfig,
) -> Result<(), String> {
    let mut w = state.lock().map_err(|e| e.to_string())?;
    w.set_metrics_config(config);
    Ok(())
}



