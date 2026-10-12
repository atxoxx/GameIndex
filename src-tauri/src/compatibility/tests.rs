use super::*;
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;
use super::anticheat::{extract_anticheat_archive, runtime_url_from_index};
use super::prefixes::copy_dir_recursive;
use super::runners::host_is_arm64;
use super::steam::with_steam_prefix;
use super::wine::{newest_log_file, resolve_prefix_from};
use super::paths::parse_library_folders_vdf;
use super::proton::{cachyos_version, is_cachyos_proton, proton_by_path_heuristic};
use super::runners::{is_release_installed, runner_asset_matches, runner_source};
use super::steam::{choose_steam_route, SteamRoute};

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
    assert!(parsed.enable_vkd3d_descriptor_heap);
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
fn steam_launch_env_vkd3d_defaults_to_proton_flag() {
    // Steam games run through Proton by default, so the wrapper flag
    // is the one that reaches the game.
    let env = steam_launch_env(&CompatibilitySettings::default(), None, None);
    let map: std::collections::HashMap<&str, &str> = env
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();
    assert_eq!(map.get("PROTON_VKD3D_HEAP"), Some(&"1"));
    assert!(!map.contains_key("VKD3D_CONFIG"));
}

#[test]
fn steam_launch_env_vkd3d_proton_runner_uses_proton_flag() {
    let settings = CompatibilitySettings::default();
    let profile = serde_json::json!({
        "customRunnerPath": "/usr/share/steam/compatibilitytools.d/GE-Proton9.0/proton"
    });
    let env = steam_launch_env(&settings, Some(&profile), None);
    let map: std::collections::HashMap<&str, &str> = env
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();
    assert_eq!(map.get("PROTON_VKD3D_HEAP"), Some(&"1"));
    assert!(!map.contains_key("VKD3D_CONFIG"));
}

#[test]
fn steam_launch_env_vkd3d_pins_wine_runner_to_raw_config() {
    let settings = CompatibilitySettings::default();
    let profile = serde_json::json!({ "customRunnerPath": "/usr/bin/wine" });
    let env = steam_launch_env(&settings, Some(&profile), None);
    let map: std::collections::HashMap<&str, &str> = env
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();
    assert_eq!(map.get("VKD3D_CONFIG"), Some(&"descriptor_heap"));
    assert!(!map.contains_key("PROTON_VKD3D_HEAP"));
}

#[test]
fn steam_launch_env_vkd3d_disabled_sets_no_heap_flag() {
    let settings = CompatibilitySettings {
        enable_vkd3d: false,
        ..Default::default()
    };
    let env = steam_launch_env(&settings, None, None);
    let map: std::collections::HashMap<&str, &str> = env
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();
    assert!(!map.contains_key("PROTON_VKD3D_HEAP"));
    assert!(!map.contains_key("VKD3D_CONFIG"));
}

#[test]
fn steam_launch_env_vkd3d_descriptor_heap_global_off_disables_flags() {
    let settings = CompatibilitySettings {
        enable_vkd3d_descriptor_heap: false,
        ..Default::default()
    };
    let env = steam_launch_env(&settings, None, None);
    let map: std::collections::HashMap<&str, &str> = env
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();
    assert!(!map.contains_key("PROTON_VKD3D_HEAP"));
    assert!(!map.contains_key("VKD3D_CONFIG"));
    // The d3d12 override still applies — only the heap flag is skipped.
    let dll = map.get("WINEDLLOVERRIDES").expect("DXVK dll overrides set");
    assert!(dll.contains("d3d12=n,b"));
}

#[test]
fn steam_launch_env_vkd3d_descriptor_heap_per_game_override() {
    // Global off, per-game on: the flag comes back.
    let settings = CompatibilitySettings {
        enable_vkd3d_descriptor_heap: false,
        ..Default::default()
    };
    let on = serde_json::json!({ "enableVkd3dDescriptorHeap": true });
    let env = steam_launch_env(&settings, Some(&on), None);
    let map: std::collections::HashMap<&str, &str> = env
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();
    assert_eq!(map.get("PROTON_VKD3D_HEAP"), Some(&"1"));

    // Global on, per-game off: the flag is dropped.
    let off = serde_json::json!({ "enableVkd3dDescriptorHeap": false });
    let env = steam_launch_env(&CompatibilitySettings::default(), Some(&off), None);
    let map: std::collections::HashMap<&str, &str> = env
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();
    assert!(!map.contains_key("PROTON_VKD3D_HEAP"));
    assert!(!map.contains_key("VKD3D_CONFIG"));
}

#[cfg(target_os = "linux")]
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

#[cfg(target_os = "linux")]
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
