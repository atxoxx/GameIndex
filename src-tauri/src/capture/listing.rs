//! Clip-folder helpers shared by every platform: discovery, deletion and
//! file-manager reveal. Mirrors the screenshot helpers in `overlay.rs` so the
//! captures gallery can treat images and clips the same way.

use std::path::{Path, PathBuf};

const CLIP_EXTS: [&str; 4] = ["mp4", "mkv", "webm", "mov"];

/// True when `path` has a recognized clip extension.
pub fn is_clip_path(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| CLIP_EXTS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// Newest-first list of clip files in `dir` (empty when the folder is missing).
pub fn list_clips(dir: &Path) -> Vec<String> {
    if !dir.exists() {
        return Vec::new();
    }
    let mut entries: Vec<(String, Option<std::time::SystemTime>)> = Vec::new();
    if let Ok(read) = std::fs::read_dir(dir) {
        for entry in read.flatten() {
            let path = entry.path();
            if path.is_file() && is_clip_path(&path) {
                let mtime = entry.metadata().and_then(|m| m.modified()).ok();
                entries.push((path.to_string_lossy().to_string(), mtime));
            }
        }
    }
    entries.sort_by(|a, b| b.1.cmp(&a.1));
    entries.into_iter().map(|(p, _)| p).collect()
}

/// Delete a clip, refusing non-clip extensions so a bad path can't wipe
/// unrelated files.
pub fn delete_clip(path: &str) -> Result<(), String> {
    let p = Path::new(path);
    if !p.exists() {
        return Ok(());
    }
    if is_clip_path(p) {
        std::fs::remove_file(p).map_err(|e| format!("failed to delete clip: {e}"))?;
        return Ok(());
    }
    Err("Invalid file type to delete".to_string())
}

/// Reveal a file (or open the parent folder) in the OS file manager.
pub fn open_in_file_manager(path: Option<String>) -> Result<(), String> {
    let target: PathBuf = match &path {
        Some(path) => PathBuf::from(path),
        None => default_captures_root(),
    };

    #[cfg(windows)]
    {
        use std::process::Command;
        if target.is_file() {
            let _ = Command::new("explorer")
                .arg(format!("/select,{}", target.to_string_lossy()))
                .spawn();
        } else {
            let _ = Command::new("explorer")
                .arg(target.to_string_lossy().as_ref())
                .spawn();
        }
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let _ = Command::new("open").arg(&target).spawn();
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        use std::process::Command;
        let dir = if target.is_file() {
            target.parent().map(Path::to_path_buf).unwrap_or(target)
        } else {
            target
        };
        let _ = Command::new("xdg-open").arg(dir).spawn();
        return Ok(());
    }

    #[allow(unreachable_code)]
    Ok(())
}

fn default_captures_root() -> PathBuf {
    #[cfg(windows)]
    {
        if let Ok(profile) = std::env::var("USERPROFILE") {
            return PathBuf::from(profile).join("Videos").join("Captures");
        }
    }
    #[cfg(not(windows))]
    {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home).join("Videos").join("Captures");
        }
    }
    PathBuf::from(".")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_clip_path_accepts_known_extensions_case_insensitively() {
        assert!(is_clip_path(Path::new("Replay_1.mp4")));
        assert!(is_clip_path(Path::new("C:/x/Clip.MP4")));
        assert!(is_clip_path(Path::new("clip.webm")));
        assert!(!is_clip_path(Path::new("screenshot.png")));
        assert!(!is_clip_path(Path::new("noext")));
    }

    #[test]
    fn list_clips_returns_empty_for_a_missing_folder() {
        let missing = std::env::temp_dir().join("gameindex-does-not-exist-xyz");
        assert!(list_clips(&missing).is_empty());
    }

    #[test]
    fn delete_clip_refuses_non_clip_extensions() {
        let path = std::env::temp_dir().join(format!(
            "gameindex-not-a-clip-{}.png",
            std::process::id()
        ));
        std::fs::write(&path, b"x").expect("write temp file");
        let err = delete_clip(path.to_str().unwrap()).unwrap_err();
        assert!(err.contains("Invalid file type"));
        let _ = std::fs::remove_file(&path);
    }
}
