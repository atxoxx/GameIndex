use std::fs::{self};
use std::path::Path;
use std::process::Command;
use tauri::Manager;

use crate::db;
use super::*;

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
    let enable_vkd3d_descriptor_heap = game_profile
        .and_then(|p| p.get("enableVkd3dDescriptorHeap").or_else(|| p.get("vkd3dDescriptorHeap")))
        .and_then(|v| v.as_bool())
        .unwrap_or(settings.enable_vkd3d_descriptor_heap);
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
    if enable_vkd3d && enable_vkd3d_descriptor_heap {
        // VKD3D descriptor-heap mode. Steam games run through Proton
        // (Steam Play) unless a runner is pinned to plain Wine, so the
        // flag travels through the layer that owns the game: Proton
        // exposes it as `PROTON_VKD3D_HEAP`, Wine reads the raw
        // vkd3d-proton `VKD3D_CONFIG` instead.
        let steam_proton = game_profile
            .and_then(|p| p.get("customRunnerPath").or_else(|| p.get("runner")))
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .or(settings.default_runner_path.as_deref())
            .map(runner_is_proton)
            .unwrap_or(true);
        if steam_proton {
            env.push(("PROTON_VKD3D_HEAP".to_string(), "1".to_string()));
        } else {
            env.push(("VKD3D_CONFIG".to_string(), "descriptor_heap".to_string()));
        }
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
pub(crate) enum SteamRoute {
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
pub(crate) fn choose_steam_route(
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
pub(crate) fn with_steam_prefix(
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
