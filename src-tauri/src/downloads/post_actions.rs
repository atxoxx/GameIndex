//! Post-download actions and engine-wide download preferences.
//!
//! Runs after a download reaches a terminal state (completed or errored),
//! *after* auto-extraction, so file actions see the extracted tree. Two
//! action kinds are supported: opening the containing folder and launching
//! a downloaded installer. Launching an installer is gated behind an
//! explicit settings opt-in plus a per-run confirmation dialog.
//!
//! [`DownloadSettings`] is the engine-wide preference blob persisted in the
//! `kv` store under `download_settings`: multi-connection downloads (segment
//! count) and the default post-action list. A download record may carry its
//! own `postActions` override; `None` inherits the defaults, `Some([])`
//! means "no actions".

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::types::DownloadFile;

/// Largest segment count a user may configure (matches the probe/tuning
/// assumptions in `http.rs`; every extra stream costs a connection).
pub const MAX_SEGMENTS: u32 = 16;

fn default_true() -> bool {
    true
}

fn default_segments() -> u32 {
    super::http::SEGMENT_COUNT
}

/// What a post-download action does when it runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PostActionKind {
    /// Reveal the download's folder (or the file's parent) in the file manager.
    OpenFolder,
    /// Run a downloaded installer (.exe / .msi / …). Confirmed per run.
    LaunchInstaller,
}

/// One configured post-download action.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostAction {
    /// Stable identifier assigned by the UI (order is the vector order).
    #[serde(default)]
    pub id: String,
    pub kind: PostActionKind,
    /// Run when the download completed successfully. Defaults to true.
    #[serde(default = "default_true")]
    pub on_success: bool,
    /// Run when the download ended in an error. Defaults to false.
    #[serde(default)]
    pub on_failure: bool,
    /// Explicit path override. For `OpenFolder`, a folder to reveal (empty =
    /// the download's own folder). For `LaunchInstaller`, the executable to
    /// run (empty = auto-detect among the download's files).
    #[serde(default)]
    pub path: Option<String>,
}

/// Engine-wide download preferences (persisted in the `kv` store).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadSettings {
    /// Split eligible files across parallel Range connections.
    #[serde(default = "default_true")]
    pub multi_connection: bool,
    /// Connections per file when `multi_connection` is on (clamped to 1..=16).
    #[serde(default = "default_segments")]
    pub segment_count: u32,
    /// User acknowledgement that post-download installer actions may run.
    /// When false, `LaunchInstaller` actions are skipped.
    #[serde(default)]
    pub installer_opt_in: bool,
    /// Default post-action list applied to downloads without an override.
    #[serde(default)]
    pub post_actions: Vec<PostAction>,
}

impl Default for DownloadSettings {
    fn default() -> Self {
        Self {
            multi_connection: true,
            segment_count: default_segments(),
            installer_opt_in: false,
            post_actions: Vec::new(),
        }
    }
}

/// Clamp a user-supplied segment count into the supported range.
pub fn clamp_segment_count(n: u32) -> u32 {
    n.clamp(1, MAX_SEGMENTS)
}

impl DownloadSettings {
    /// Segment count to actually use, or 0 for a single connection.
    pub fn effective_segments(&self) -> u32 {
        if self.multi_connection {
            clamp_segment_count(self.segment_count)
        } else {
            0
        }
    }

    /// Clamp loaded/deserialized values into the supported ranges so a
    /// hand-edited kv blob can't request an absurd connection count.
    pub fn normalized(mut self) -> Self {
        self.segment_count = clamp_segment_count(self.segment_count);
        self
    }
}

/// Whether a post-action should run for the given terminal outcome.
pub fn should_run(action: &PostAction, success: bool) -> bool {
    if success {
        action.on_success
    } else {
        action.on_failure
    }
}

/// True when the path's extension names something we would run as an installer.
fn is_installer_ext(name: &str) -> bool {
    let ext = Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    matches!(
        ext.as_str(),
        "exe" | "msi" | "bat" | "cmd" | "dmg" | "pkg" | "appimage" | "sh"
    )
}

/// Resolve the installer to launch for a download, or `None` when there is
/// nothing runnable. `single_file` is true for direct downloads, where
/// `save_path` is the downloaded file itself rather than a folder.
///
/// Prefers an explicit `path`, then a "setup"/"install" looking file, then
/// the first installer-extension file.
pub fn detect_installer(
    files: &[DownloadFile],
    save_path: &str,
    explicit: Option<&str>,
    single_file: bool,
) -> Option<PathBuf> {
    if let Some(p) = explicit.map(str::trim).filter(|s| !s.is_empty()) {
        let pb = PathBuf::from(p);
        if pb.exists() {
            return Some(pb);
        }
    }

    if single_file {
        return is_installer_ext(save_path).then(|| PathBuf::from(save_path));
    }

    let dir = if save_path.trim().is_empty() {
        PathBuf::from(".")
    } else {
        PathBuf::from(save_path)
    };

    let mut fallback: Option<PathBuf> = None;
    for f in files {
        if f.name.trim().is_empty() || !is_installer_ext(&f.name) {
            continue;
        }
        let full = dir.join(&f.name);
        let lower = f.name.to_ascii_lowercase();
        if lower.contains("setup") || lower.contains("install") {
            return Some(full);
        }
        if fallback.is_none() {
            fallback = Some(full);
        }
    }
    fallback
}

/// The folder an `OpenFolder` action should reveal: the download's folder,
/// or the parent when `save_path` is a single file.
pub fn open_folder_target(save_path: &str, explicit: Option<&str>, single_file: bool) -> PathBuf {
    if let Some(p) = explicit.map(str::trim).filter(|s| !s.is_empty()) {
        return PathBuf::from(p);
    }
    let path = Path::new(save_path);
    if single_file {
        path.parent().unwrap_or(path).to_path_buf()
    } else {
        path.to_path_buf()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(name: &str) -> DownloadFile {
        DownloadFile {
            name: name.to_string(),
            size: 0,
            downloaded: 0,
            progress: 0.0,
            selected: true,
        }
    }

    #[test]
    fn settings_defaults_are_sane() {
        let s = DownloadSettings::default();
        assert!(s.multi_connection);
        assert_eq!(s.segment_count, super::super::http::SEGMENT_COUNT);
        assert!(!s.installer_opt_in);
        assert!(s.post_actions.is_empty());
        // Off means no segments even with a high count.
        let off = DownloadSettings {
            multi_connection: false,
            segment_count: 8,
            ..Default::default()
        };
        assert_eq!(off.effective_segments(), 0);
    }

    #[test]
    fn settings_serde_is_camel_case_and_tolerant() {
        let s: DownloadSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(s, DownloadSettings::default());

        let s: DownloadSettings = serde_json::from_str(
            r#"{"multiConnection":false,"segmentCount":4,"installerOptIn":true,
                "postActions":[{"id":"a","kind":"launchInstaller","onSuccess":true,"onFailure":false}]}"#,
        )
        .unwrap();
        assert!(!s.multi_connection);
        assert_eq!(s.segment_count, 4);
        assert!(s.installer_opt_in);
        assert_eq!(s.post_actions.len(), 1);
        assert_eq!(s.post_actions[0].kind, PostActionKind::LaunchInstaller);
        // onFailure absent → false; onSuccess present → true.
        assert!(s.post_actions[0].on_success);
        assert!(!s.post_actions[0].on_failure);
    }

    #[test]
    fn clamp_segment_count_bounds() {
        assert_eq!(clamp_segment_count(0), 1);
        assert_eq!(clamp_segment_count(8), 8);
        assert_eq!(clamp_segment_count(999), MAX_SEGMENTS);
    }

    #[test]
    fn should_run_respects_triggers() {
        let success_only = PostAction {
            id: "a".into(),
            kind: PostActionKind::OpenFolder,
            on_success: true,
            on_failure: false,
            path: None,
        };
        assert!(should_run(&success_only, true));
        assert!(!should_run(&success_only, false));

        let failure_only = PostAction {
            on_success: false,
            on_failure: true,
            ..success_only.clone()
        };
        assert!(!should_run(&failure_only, true));
        assert!(should_run(&failure_only, false));
    }

    #[test]
    fn detect_installer_prefers_setup_and_ignores_non_installers() {
        let files = vec![
            file("data.bin"),
            file("readme.txt"),
            file("game-launcher.exe"),
            file("setup.exe"),
        ];
        let found = detect_installer(&files, "C:/dl/game", None, false).unwrap();
        assert!(found.to_string_lossy().ends_with("setup.exe"));
    }

    #[test]
    fn detect_installer_falls_back_to_any_executable() {
        let files = vec![file("data.bin"), file("patcher.EXE")];
        let found = detect_installer(&files, "C:/dl/game", None, false).unwrap();
        assert!(found.to_string_lossy().ends_with("patcher.EXE"));
    }

    #[test]
    fn detect_installer_uses_direct_file_and_returns_none_for_none() {
        // Direct download: save_path is the file itself.
        let found = detect_installer(&[], "C:/dl/Setup.msi", None, true).unwrap();
        assert_eq!(found, PathBuf::from("C:/dl/Setup.msi"));
        // A direct non-installer file yields nothing.
        assert!(detect_installer(&[], "C:/dl/movie.mkv", None, true).is_none());
        // No installer in a torrent folder.
        assert!(detect_installer(&[file("movie.mkv")], "C:/dl/game", None, false).is_none());
        // A missing explicit path is ignored, detection still runs.
        let fallback =
            detect_installer(&[file("setup.exe")], "C:/dl/game", Some("C:/nope/x.exe"), false);
        assert!(fallback.is_some());
    }

    #[test]
    fn detect_installer_honours_existing_explicit_path() {
        let dir = std::env::temp_dir();
        let explicit = dir.join("gamelib_explicit_installer.exe");
        std::fs::write(&explicit, b"x").unwrap();
        let found = detect_installer(
            &[file("setup.exe")],
            "C:/dl/game",
            Some(&explicit.to_string_lossy()),
            false,
        );
        assert_eq!(found, Some(explicit.clone()));
        let _ = std::fs::remove_file(&explicit);
    }

    #[test]
    fn open_folder_target_strips_file_to_parent() {
        assert_eq!(
            open_folder_target("C:/dl/file.zip", None, true),
            PathBuf::from("C:/dl")
        );
        assert_eq!(
            open_folder_target("C:/dl", None, false),
            PathBuf::from("C:/dl")
        );
        assert_eq!(
            open_folder_target("C:/dl", Some("D:/elsewhere"), false),
            PathBuf::from("D:/elsewhere")
        );
    }
}
