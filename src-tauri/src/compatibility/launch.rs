use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use super::*;
use super::paths::{os_str_to_display, shell_quote};

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
    let _ = writeln!(log_file, "ESync: {}, FSync: {}, NTSync: {}, DXVK: {}, VKD3D: {}, VKD3D Descriptor Heap: {}", enable_esync, enable_fsync, enable_ntsync, enable_dxvk, enable_vkd3d, enable_vkd3d_descriptor_heap);
    let _ = writeln!(log_file, "Wineland: {}, WoW64: {}, LargeAddress: {}", enable_wayland, enable_wow64, enable_large_address_aware);
    let specific_gpu_label = specific_gpu
        .as_ref()
        .and_then(|gpu| gpu.pci_slot.as_deref().or(gpu.pci_id.as_deref()))
        .unwrap_or("disabled");
    let _ = writeln!(log_file, "Specific GPU: {}", specific_gpu_label);
    let _ = writeln!(log_file, "MangoHud: {} (hidden: {}), UMU: {}, GameMode: {}, Gamescope: {}", enable_mangohud, mangohud_hidden, use_umu, enable_gamemode, enable_gamescope);
    let _ = writeln!(log_file, "Controller support: {}, Anti-cheat support: {}", enable_controller_support, enable_anticheat_support);

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

    // Capture the environment as it is applied so the session log can show
    // the exact command line, wine/proton flags included.
    let mut env_lines: Vec<String> = Vec::new();
    macro_rules! set_env {
        ($k:expr, $v:expr) => {{
            cmd.env(&$k, &$v);
            env_lines.push(format!("{}={}", $k, os_str_to_display(&$v)));
        }};
    }

    #[cfg(target_os = "linux")]
    strip_appimage_env(&mut cmd);

    // Environment variables
    set_env!("WINEPREFIX", &prefix);

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
                set_env!("MANGOHUD_CONFIG", mangohud_log_config(&folder, mangohud_hidden));
            }
        }
    }

    // UMU-Launcher environment: identify the game for umu's prefix /
    // protonfix handling and point PROTONPATH at the Proton folder.
    if use_umu {
        set_env!("GAMEID", format!("umu-{}", game_id));
        set_env!("STORE", "none");
        if let Some(folder) = proton_folder_for_runner(&runner_path) {
            set_env!("PROTONPATH", folder.to_string_lossy().to_string());
        }
    }
    if let Some(a) = arch {
        set_env!("WINEARCH", a);
    }
    set_env!("WINEESYNC", if enable_esync { "1" } else { "0" });
    set_env!("WINEFSYNC", if enable_fsync { "1" } else { "0" });
    if enable_ntsync {
        set_env!("WINESYNC", "1");
        set_env!("WINENTSYNC", "1");
    }

    if enable_dxvk_nvapi {
        set_env!("DXVK_ENABLE_NVAPI", "1");
    }
    if enable_dxvk_async {
        set_env!("DXVK_ASYNC", "1");
    }
    if enable_wayland {
        set_env!("WINE_ENABLE_WAYLAND", "1");
    }
    // Pinning a specific GPU also forces Wine Wayland on (WINE + Proton)
    // and hands the selection to the whole graphics-stack matrix.
    if let Some(selection) = specific_gpu.as_ref() {
        set_env!("WINE_ENABLE_WAYLAND", "1");
        set_env!("PROTON_ENABLE_WAYLAND", "1");
        for (key, value) in specific_gpu_env(selection) {
            set_env!(key, value);
        }
    }
    if enable_wow64 {
        set_env!("WINE_NEW_WOW64", "1");
    }
    if enable_large_address_aware {
        set_env!("WINE_LARGE_ADDRESS_AWARE", "1");
    }
    if enable_controller_support {
        set_env!("PROTON_PREFER_SDL", "1");
    }
    if enable_anticheat_support {
        if let Some(dir) = eac_runtime_dir() {
            set_env!("PROTON_EAC_RUNTIME", &dir);
        }
        if let Some(dir) = battleye_runtime_dir() {
            set_env!("PROTON_BATTLEYE_RUNTIME", &dir);
        }
    }
    if let Some(dbg) = wine_debug.as_deref() {
        set_env!("WINEDEBUG", dbg);
    }
    if let Some(aud) = audio_driver.as_deref() {
        if aud != "auto" {
            set_env!("WINEAUDIODRIVER", aud);
        }
    }
    if let Some(hud) = dxvk_hud {
        if !hud.trim().is_empty() {
            set_env!("DXVK_HUD", hud);
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
    if enable_vkd3d && enable_vkd3d_descriptor_heap {
        // VKD3D descriptor-heap mode: Proton exposes it via its own
        // wrapper flag, plain Wine reads the vkd3d-proton config var.
        if is_proton {
            set_env!("PROTON_VKD3D_HEAP", "1");
        } else {
            set_env!("VKD3D_CONFIG", "descriptor_heap");
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
        set_env!("WINEDLLOVERRIDES", dll_str);
    }

    if prime_render_offload {
        set_env!("DRI_PRIME", "1");
        set_env!("__NV_PRIME_RENDER_OFFLOAD", "1");
        set_env!("__GLX_VENDOR_LIBRARY_NAME", "nvidia");
        set_env!("__VK_LAYER_NV_optimus", "NVIDIA_only");
    }

    // Proton specific environment (umu supplies its own Steam
    // compatibility vars inside the runtime container).
    if is_proton && !use_umu {
        set_env!("STEAM_COMPAT_DATA_PATH", &prefix);
        if let Some(steam) = steam_candidate_roots().into_iter().next() {
            set_env!("STEAM_COMPAT_CLIENT_INSTALL_PATH", steam.to_string_lossy().to_string());
        }
    }

    // Steam-owned titles launched directly (the running client drops the
    // flag env on `-applaunch`) still need the app id so Steamworks/DRM
    // and the overlay find the client.
    if let Some(app_id) = steam_app_id {
        let app_id = app_id.to_string();
        set_env!("SteamAppId", &app_id);
        set_env!("SteamGameId", &app_id);
        if let Some(steam) = steam_candidate_roots().into_iter().next() {
            set_env!("SteamPath", steam.to_string_lossy().to_string());
        }
    }

    // User environment variables (filtered for exclusions), in a stable
    // order so launch-options prefixes don't churn between launches.
    let mut user_env: Vec<(&String, &String)> =
        settings.custom_environment_variables.iter().collect();
    user_env.sort_by(|a, b| a.0.cmp(b.0));
    for (k, v) in user_env {
        if !excluded_global_env.contains(k) {
            set_env!(k, v);
        }
    }
    if let Some(game_envs) = game_profile
        .and_then(|p| p.get("environmentVariables").or_else(|| p.get("customEnv")))
        .and_then(|v| v.as_object())
    {
        for (k, v) in game_envs {
            if let Some(s) = v.as_str() {
                set_env!(k, s);
            }
        }
    }

    // Write the full command line (env flags + runner + exe + args) into the
    // session log header for troubleshooting, then close the header block.
    let mut command_parts: Vec<String> = Vec::new();
    command_parts.push("env".to_string());
    command_parts.extend(env_lines.iter().map(|line| shell_quote(line)));
    command_parts.push(shell_quote(&program));
    command_parts.extend(tokens.iter().map(|t| shell_quote(t)));
    let full_command = command_parts.join(" ");
    let _ = writeln!(log_file, "Command: {}", full_command);
    let _ = writeln!(log_file, "==================================================");
    let _ = log_file.flush();

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
