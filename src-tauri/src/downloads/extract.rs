//! Archive extraction for completed downloads (7z / tar / PowerShell
//! fallback), with process tracking so extractions can be killed on
//! download removal / app exit.

use std::collections::HashMap;
use std::path::PathBuf;
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

/// Extract every archive in the download's file list. Returns `Ok` if
/// at least one archive extracted (or there was nothing to extract).
pub fn extract_archives_for_download(
    id: &str,
    save_path: &str,
    files: &[DownloadFile],
) -> Result<(), String> {
    let save_path_buf = PathBuf::from(save_path);
    let mut extracted_any = false;
    let mut last_err = None;

    for file in files {
        let file_path = save_path_buf.join(&file.name);
        if !file_path.exists() {
            continue;
        }

        let ext = file_path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();

        let name_lower = file.name.to_lowercase();
        let is_archive = match ext.as_str() {
            "zip" => true,
            "7z" => !name_lower.ends_with(".7z.002") && !name_lower.contains(".7z.00"),
            "rar" => {
                if name_lower.contains(".part") {
                    name_lower.contains(".part1.rar") || name_lower.contains(".part01.rar")
                } else {
                    true
                }
            }
            _ => false,
        };

        if is_archive {
            let dest_dir = file_path.parent().unwrap_or(&save_path_buf);
            println!("[downloads] Extracting {:?} to {:?}", file_path, dest_dir);
            match extract_archive(id, &file_path, dest_dir) {
                Ok(_) => {
                    extracted_any = true;
                }
                Err(e) => {
                    println!("[downloads] Extract error for {:?}: {}", file_path, e);
                    last_err = Some(e);
                }
            }
        }
    }

    if extracted_any {
        Ok(())
    } else if let Some(e) = last_err {
        Err(e)
    } else {
        Ok(())
    }
}

/// Delete archive parts after successful extraction.
pub fn delete_archives_for_download(save_path: &str, files: &[DownloadFile]) {
    let save_path_buf = PathBuf::from(save_path);
    for file in files {
        let file_path = save_path_buf.join(&file.name);
        if !file_path.exists() {
            continue;
        }

        let ext = file_path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();

        let name_lower = file.name.to_lowercase();
        let is_archive_part = match ext.as_str() {
            "zip" | "rar" | "7z" | "tar" | "gz" => true,
            _ => {
                let has_numeric_part = ext.chars().all(|c| c.is_ascii_digit());
                let is_rar_part =
                    ext.starts_with('r') && ext[1..].chars().all(|c| c.is_ascii_digit());
                let is_zip_part =
                    ext.starts_with('z') && ext[1..].chars().all(|c| c.is_ascii_digit());

                has_numeric_part || is_rar_part || is_zip_part || name_lower.contains(".7z.")
            }
        };

        if is_archive_part {
            println!("[downloads] Deleting archive file {:?}", file_path);
            let _ = std::fs::remove_file(file_path);
        }
    }
}

fn extract_archive(
    id: &str,
    archive_path: &std::path::Path,
    dest_dir: &std::path::Path,
) -> Result<(), String> {
    use std::process::Command;
    let paths_to_try = [
        PathBuf::from("7z"),
        PathBuf::from("C:\\Program Files\\7-Zip\\7z.exe"),
        PathBuf::from("C:\\Program Files (x86)\\7-Zip\\7z.exe"),
    ];

    let mut found_7z = false;
    let mut exe_path = PathBuf::new();

    for p in &paths_to_try {
        if p.to_string_lossy() == "7z" {
            if Command::new("7z").arg("-h").output().is_ok() {
                found_7z = true;
                exe_path = p.clone();
                break;
            }
        } else if p.exists() {
            found_7z = true;
            exe_path = p.clone();
            break;
        }
    }

    if found_7z {
        let mut cmd = Command::new(&exe_path);
        cmd.arg("x")
            .arg(archive_path)
            .arg(format!("-o{}", dest_dir.to_string_lossy()))
            .arg("-y");

        return run_command_tracked(id, cmd);
    }

    let ext = archive_path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();

    if ext == "zip" {
        let mut cmd = Command::new("tar");
        cmd.arg("-xf").arg(archive_path).arg("-C").arg(dest_dir);

        if run_command_tracked(id, cmd).is_ok() {
            return Ok(());
        }
    }

    if ext == "zip" {
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
