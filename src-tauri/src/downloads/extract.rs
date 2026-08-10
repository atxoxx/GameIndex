//! Archive extraction for completed downloads (7z / tar / PowerShell
//! fallback), with process tracking so extractions can be killed on
//! download removal / app exit.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex as StdMutex, OnceLock};

use super::types::DownloadFile;

static RUNNING_EXTRACTIONS: OnceLock<Arc<StdMutex<HashMap<String, u32>>>> = OnceLock::new();

fn running_extractions() -> Arc<StdMutex<HashMap<String, u32>>> {
    RUNNING_EXTRACTIONS
        .get_or_init(|| Arc::new(StdMutex::new(HashMap::new())))
        .clone()
}

#[cfg(windows)]
fn kill_pid(pid: u32) {
    let _ = std::process::Command::new("taskkill")
        .args(["/F", "/PID", &pid.to_string()])
        .output();
}

#[cfg(not(windows))]
fn kill_pid(pid: u32) {
    let _ = std::process::Command::new("kill")
        .args(["-9", &pid.to_string()])
        .output();
}

/// Kill a running extraction process for the given download id (no-op
/// when none is running).
pub fn kill_extraction(id: &str) {
    let map = running_extractions();
    let pid_opt = {
        let mut guard = map.lock().unwrap();
        guard.remove(id)
    };
    if let Some(pid) = pid_opt {
        println!(
            "[downloads] Killing extraction process (PID {}) for {}",
            pid, id
        );
        kill_pid(pid);
    }
}

/// Kill every running extraction (called on app exit).
pub fn cleanup_extractions() {
    let map = running_extractions();
    let mut guard = map.lock().unwrap();
    for (id, pid) in guard.drain() {
        println!(
            "[downloads] App exit: killing extraction process (PID {}) for {}",
            pid, id
        );
        kill_pid(pid);
    }
}

fn run_command_tracked(id: &str, mut cmd: std::process::Command) -> Result<(), String> {
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn process: {}", e))?;
    let pid = child.id();

    {
        let map = running_extractions();
        let mut guard = map.lock().unwrap();
        guard.insert(id.to_string(), pid);
    }

    let status = child
        .wait()
        .map_err(|e| format!("Failed to wait for process (PID {}): {}", pid, e))?;

    {
        let map = running_extractions();
        let mut guard = map.lock().unwrap();
        guard.remove(id);
    }

    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "Process (PID {}) exited with error status: {}",
            pid, status
        ))
    }
}

/// True when this file is the FIRST part of an archive and should be
/// handed to the extractor. Multi-part volumes are extracted once from
/// their first part only; the extractor follows the remaining volumes.
fn is_extractable_first_part(name: &str, ext: &str) -> bool {
    let lower = name.to_lowercase();
    match ext {
        "zip" => true,
        "7z" => match volume_number(&lower) {
            // game.7z.001 / .01 / .1 → first volume only (7z follows .002…)
            Some(n) => n == 1,
            // plain game.7z
            None => true,
        },
        "rar" => {
            if let Some(p) = lower.find(".part") {
                let num_seg = lower[p + 5..].trim_end_matches(".rar");
                num_seg.parse::<u32>().map(|n| n == 1).unwrap_or(false)
            } else {
                true
            }
        }
        // .tar.gz / .tgz: single-pass `tar -xf` (see extract_archive).
        "gz" | "tgz" => lower.ends_with(".tar.gz") || lower.ends_with(".tgz"),
        _ => false,
    }
}

/// Trailing numeric volume number: "game.7z.001" → Some(1), "game.7z" → None.
fn volume_number(name_lower: &str) -> Option<u32> {
    let (_, ext) = name_lower.rsplit_once('.')?;
    if ext.is_empty() || !ext.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    ext.parse::<u32>().ok()
}

/// Resolve the on-disk path of one of a download's archive files.
///
/// The two download kinds store `save_path` differently: Torrents save
/// the *folder* to download into (each `DownloadFile::name` is relative
/// to it), while Direct downloads save the *full target file path* of
/// the single archive. Detect which by inspecting the path itself.
fn resolve_archive_path(save_path: &Path, name: &str) -> PathBuf {
    if save_path.is_file() {
        save_path.to_path_buf()
    } else {
        save_path.join(name)
    }
}

/// Extract every extractable FIRST-part archive in the download's file
/// list. Returns the names of the archives that were successfully
/// extracted (multi-part volumes are keyed by their first part).
pub fn extract_archives_for_download(
    id: &str,
    save_path: &str,
    files: &[DownloadFile],
) -> Result<Vec<String>, String> {
    let save_path_buf = PathBuf::from(save_path);
    let mut extracted: Vec<String> = Vec::new();
    let mut last_err = None;

    for file in files {
        let file_path = resolve_archive_path(&save_path_buf, &file.name);
        if !file_path.exists() {
            continue;
        }

        let ext = file_path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();

        if !is_extractable_first_part(&file.name, &ext) {
            continue;
        }

        let dest_dir = file_path.parent().unwrap_or(&save_path_buf);
        println!("[downloads] Extracting {:?} to {:?}", file_path, dest_dir);
        match extract_archive(id, &file_path, dest_dir) {
            Ok(_) => {
                extracted.push(file.name.clone());
            }
            Err(e) => {
                println!("[downloads] Extract error for {:?}: {}", file_path, e);
                last_err = Some(e);
            }
        }
    }

    if !extracted.is_empty() {
        Ok(extracted)
    } else if let Some(e) = last_err {
        Err(e)
    } else {
        Ok(Vec::new()) // nothing to extract — nothing to delete
    }
}

/// Canonical family key for an archive and its volume parts:
///   "game.7z", "game.7z.001", "game.7z.002"      → "game.7z"
///   "game.rar", "game.part1.rar", "game.part2.rar" → "game.rar"
///   "game.r00", "game.r01"                        → "game.rar"
///   "game.z01"                                    → "game.zip"
///   "game.tar.gz"                                 → "game.tar.gz"
fn archive_family(name: &str) -> String {
    let mut n = name.to_lowercase();
    let mut last_was_rz: Option<char> = None;
    loop {
        let Some(dot) = n.rfind('.') else { break };
        let ext = &n[dot + 1..];
        let all_digits = !ext.is_empty() && ext.chars().all(|c| c.is_ascii_digit());
        let r_part =
            ext.len() >= 2 && ext.starts_with('r') && ext[1..].chars().all(|c| c.is_ascii_digit());
        let z_part =
            ext.len() >= 2 && ext.starts_with('z') && ext[1..].chars().all(|c| c.is_ascii_digit());
        if all_digits || r_part || z_part {
            if r_part {
                last_was_rz = Some('r');
            }
            if z_part {
                last_was_rz = Some('z');
            }
            n.truncate(dot);
        } else {
            break;
        }
    }
    // Collapse RAR part segments: "game.part1.rar" → "game.rar"
    if let Some(p) = n.find(".part") {
        if let Some(rar) = n.rfind(".rar") {
            let seg = &n[p + 5..rar];
            if !seg.is_empty() && seg.chars().all(|c| c.is_ascii_digit()) {
                n = format!("{}.rar", &n[..p]);
            }
        }
    }
    // Bare volumes stripped to a bare base ("game.r00" → "game"):
    // restore the rar/zip convention so they join the right family.
    if !n.contains('.') {
        match last_was_rz {
            Some('r') => n.push_str(".rar"),
            Some('z') => n.push_str(".zip"),
            _ => {}
        }
    }
    n
}

/// Delete the archive files that were actually part of a successful
/// extraction: the extracted first part plus its volume siblings
/// (game.7z.002…, game.part2.rar…, game.r00…). Files whose family was
/// NOT extracted are never touched — this is the C2 fix: nothing is
/// deleted when extraction failed or was skipped.
pub fn delete_archives_for_download(
    save_path: &str,
    files: &[DownloadFile],
    extracted: &[String],
) {
    if extracted.is_empty() {
        return;
    }
    let fams: std::collections::HashSet<String> =
        extracted.iter().map(|n| archive_family(n)).collect();
    let save_path_buf = PathBuf::from(save_path);
    for file in files {
        if fams.contains(&archive_family(&file.name)) {
            let file_path = resolve_archive_path(&save_path_buf, &file.name);
            if file_path.exists() {
                println!("[downloads] Deleting archive file {:?}", file_path);
                let _ = std::fs::remove_file(file_path);
            }
        }
    }
}

fn find_7z() -> Option<std::path::PathBuf> {
    let paths_to_try = [
        PathBuf::from("7z"),
        PathBuf::from("C:\\Program Files\\7-Zip\\7z.exe"),
        PathBuf::from("C:\\Program Files (x86)\\7-Zip\\7z.exe"),
    ];
    for p in &paths_to_try {
        if p.to_string_lossy() == "7z" {
            if std::process::Command::new("7z").arg("-h").output().is_ok() {
                return Some(p.clone());
            }
        } else if p.exists() {
            return Some(p.clone());
        }
    }
    None
}

fn extract_archive(
    id: &str,
    archive_path: &std::path::Path,
    dest_dir: &std::path::Path,
) -> Result<(), String> {
    use std::process::Command;
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
    let is_tar_gz = (ext == "gz" || ext == "tgz")
        && (name_lower.ends_with(".tar.gz") || name_lower.ends_with(".tgz"));

    // .tar.gz / .tgz: single-pass `tar -xf` (bsdtar/GNU tar transparently
    // handle the gzip layer; 7-Zip would only yield the inner .tar).
    if is_tar_gz {
        let mut cmd = Command::new("tar");
        cmd.arg("-xf").arg(archive_path).arg("-C").arg(dest_dir);
        if run_command_tracked(id, cmd).is_ok() {
            return Ok(());
        }
        return Err(format!(
            "Failed to extract {} (tar unavailable or failed)",
            archive_path.display()
        ));
    }

    // zip / rar / 7z (incl. multi-part volumes, opened from the first
    // part): 7-Zip first.
    if let Some(exe) = find_7z() {
        let mut cmd = Command::new(&exe);
        cmd.arg("x")
            .arg(archive_path)
            .arg(format!("-o{}", dest_dir.to_string_lossy()))
            .arg("-y");
        return run_command_tracked(id, cmd);
    }

    if ext == "zip" {
        let mut cmd = Command::new("tar");
        cmd.arg("-xf").arg(archive_path).arg("-C").arg(dest_dir);
        if run_command_tracked(id, cmd).is_ok() {
            return Ok(());
        }
        let mut cmd = Command::new("powershell");
        cmd.arg("-Command").arg(format!(
            "Expand-Archive -Path '{}' -DestinationPath '{}' -Force",
            archive_path.to_string_lossy(),
            dest_dir.to_string_lossy()
        ));
        return run_command_tracked(id, cmd);
    }

    Err(format!(
        "No extractor (7z/tar/PowerShell) found or format not supported for extension .{}",
        ext
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Torrent semantics: `save_path` is the download folder, and each
    /// file name is relative to it.
    #[test]
    fn resolve_archive_path_joins_relative_names_for_torrent_save_path() {
        let dir = tempfile::tempdir().unwrap();
        let resolved = resolve_archive_path(dir.path(), "game.7z");
        assert_eq!(resolved, dir.path().join("game.7z"));
    }

    /// Direct semantics: `save_path` IS the full archive file path, so
    /// the file must be resolved to itself, not joined onto itself.
    #[test]
    fn resolve_archive_path_returns_file_itself_for_direct_save_path() {
        let dir = tempfile::tempdir().unwrap();
        let archive = dir.path().join("RetroArch.7z");
        std::fs::write(&archive, b"not a real archive").unwrap();
        let resolved = resolve_archive_path(&archive, "RetroArch.7z");
        assert_eq!(resolved, archive);
    }
}
