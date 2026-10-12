use futures::StreamExt;
use serde::Deserialize;
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};
use tauri::Emitter;

use super::*;

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
pub(crate) fn runner_source(source: &str) -> Option<(&'static str, &'static str)> {
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

pub(crate) fn host_is_arm64() -> bool {
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
pub(crate) fn runner_asset_matches(source: &str, name: &str) -> bool {
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

pub(crate) fn is_release_installed(detected: &[CompatibilityRunner], tag: &str, name: &str) -> bool {
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
