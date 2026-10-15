use std::fs::{self};
use std::path::{Path, PathBuf};
#[cfg(not(windows))]
use std::process::Command;

use super::*;
use super::paths::{steam_library_roots, vdf_key_values};

/// True when the compatibility tool name belongs to CachyOS Proton
/// (`CachyOS-Proton*`, `cachyos-proton*`, `proton-cachyos*`).
pub(crate) fn is_cachyos_proton(name: &str) -> bool {
    name.to_lowercase().contains("cachyos")
}

/// Extract the version out of a CachyOS Proton tool name, e.g.
/// `proton-cachyos-10.0-20251222-slr` → `10.0-20251222-slr`. Returns an
/// empty string when the name carries no version part.
pub(crate) fn cachyos_version(name: &str) -> String {
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
pub(crate) fn proton_by_path_heuristic(path: &str) -> bool {
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
