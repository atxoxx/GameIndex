//! Non-Windows capture stub. Video capture is a Windows-only feature (WGC +
//! Media Foundation), but the settings UI and commands stay available so the
//! rest of the app is platform-uniform — starting a capture just reports a
//! clear "unsupported" error.

use super::{CaptureConfig, ClipResult};

const UNSUPPORTED: &str = "Video capture is currently supported on Windows only";

/// Placeholder session; never active.
pub struct Session;

impl Session {
    pub fn active(&self) -> bool {
        false
    }

    pub fn stop(self) -> Option<ClipResult> {
        None
    }

    pub fn save_replay(&self) -> Option<ClipResult> {
        None
    }
}

pub fn is_supported() -> bool {
    false
}

pub fn start(
    _config: &CaptureConfig,
    _folder: &std::path::Path,
    _started_at: u64,
    _kind: &str,
) -> Result<Session, String> {
    Err(UNSUPPORTED.to_string())
}
