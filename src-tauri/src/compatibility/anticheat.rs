use serde::Deserialize;
use std::fs::{self};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use super::*;
use super::paths::steam_library_roots;

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
pub(crate) fn runtime_url_from_index(body: &str, name: &str) -> Result<String, String> {
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
pub(crate) fn extract_anticheat_archive(archive_path: &Path, dest_dir: &Path) -> Result<(), String> {
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
