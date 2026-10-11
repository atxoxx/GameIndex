//! Linux video capture via `gpu-screen-recorder`.
//!
//! GameIndex does not ship its own encoder on Linux. Instead it supervises the
//! external `gpu-screen-recorder` CLI, which captures and encodes entirely on
//! the GPU. A session is just a child process we launch with the settings mapped
//! onto its flags and then drive with signals: `SIGINT` stops a recording,
//! `SIGUSR1` flushes a replay buffer to disk.
//!
//! The public surface mirrors the stub and Windows `platform` modules so
//! `capture::mod` can stay platform-agnostic.

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use super::{CaptureConfig, ClipResult};

/// The external recorder this platform delegates to.
const BINARY: &str = "gpu-screen-recorder";

/// A live recorder process.
///
/// `stop` consumes the session and reaps the child; `save_replay` only signals
/// it, so the child lives behind a mutex to keep `&self` usable.
pub struct Session {
    child: Mutex<Option<Child>>,
    folder: PathBuf,
    started_at: u64,
    game_title: String,
    kind: String,
    /// Exact output file for `record` sessions; `None` for replay, where
    /// `gpu-screen-recorder` picks the filename itself.
    output: Option<PathBuf>,
}

impl Session {
    /// Whether the recorder process is still running.
    pub fn active(&self) -> bool {
        match self.child.lock() {
            Ok(mut guard) => match guard.as_mut() {
                Some(child) => matches!(child.try_wait(), Ok(None)),
                None => false,
            },
            Err(_) => false,
        }
    }

    /// Stop a manual recording and return the finalized clip.
    ///
    /// `SIGINT` is a no-op save for replay sessions (gsr discards the buffer
    /// without writing a file), so those always yield `None`.
    pub fn stop(self) -> Option<ClipResult> {
        self.terminate(Duration::from_secs(5));
        if self.kind != "record" {
            return None;
        }

        let path = match &self.output {
            Some(path) if path.is_file() => path.clone(),
            _ => newest_video(&self.folder)
                .filter(|(_, mtime)| *mtime >= self.started_at)
                .map(|(path, _)| path)?,
        };
        Some(self.clip_result(path, now_ms()))
    }

    /// Flush the rolling replay buffer to a clip without stopping.
    pub fn save_replay(&self) -> Option<ClipResult> {
        if self.kind != "replay" {
            return None;
        }
        let pid = self.pid()?;
        let before = newest_video(&self.folder).map(|(_, mtime)| mtime);

        // SAFETY: `pid` belongs to the child we spawned; a failed signal just
        // means it already exited.
        let _ = unsafe { libc::kill(pid as libc::pid_t, libc::SIGUSR1) };

        // The buffer is encoded in RAM, so the file lands a moment after the
        // signal. Poll for a *new* clip rather than sleeping a fixed amount.
        let deadline = Instant::now() + Duration::from_secs(6);
        loop {
            if let Some((path, mtime)) = newest_video(&self.folder) {
                if before.map_or(true, |before| mtime > before) {
                    return Some(self.clip_result(path, now_ms()));
                }
            }
            if Instant::now() >= deadline {
                return None;
            }
            std::thread::sleep(Duration::from_millis(150));
        }
    }

    fn pid(&self) -> Option<u32> {
        self.child
            .lock()
            .ok()
            .and_then(|guard| guard.as_ref().map(Child::id))
    }

    /// Ask the child to stop with `SIGINT`, waiting up to `timeout`, then kill
    /// it if it ignored the signal.
    fn terminate(&self, timeout: Duration) {
        if let Some(pid) = self.pid() {
            // SAFETY: `pid` belongs to the child we spawned.
            let _ = unsafe { libc::kill(pid as libc::pid_t, libc::SIGINT) };
        }

        let deadline = Instant::now() + timeout;
        loop {
            let exited = match self.child.lock() {
                Ok(mut guard) => match guard.as_mut() {
                    Some(child) => !matches!(child.try_wait(), Ok(None)),
                    None => true,
                },
                Err(_) => true,
            };
            if exited || Instant::now() >= deadline {
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }

        if let Ok(mut guard) = self.child.lock() {
            if let Some(child) = guard.as_mut() {
                if matches!(child.try_wait(), Ok(None)) {
                    let _ = child.kill();
                }
                let _ = child.wait();
            }
        }
    }

    fn clip_result(&self, path: PathBuf, now: u64) -> ClipResult {
        let file_name = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "clip.mp4".to_string());
        ClipResult {
            file_path: path.to_string_lossy().into_owned(),
            file_name,
            game_title: self.game_title.clone(),
            timestamp: self.started_at,
            duration_ms: now.saturating_sub(self.started_at),
            // gsr reports no size over this interface; 0 means "unknown".
            width: 0,
            height: 0,
            kind: self.kind.clone(),
        }
    }
}

/// True when the `gpu-screen-recorder` binary is on `PATH`.
pub fn is_supported() -> bool {
    crate::compatibility::is_command_available(BINARY)
}

/// Start a capture session. `kind` is `record` or `replay`.
pub fn start(
    config: &CaptureConfig,
    folder: &Path,
    started_at: u64,
    kind: &str,
) -> Result<Session, String> {
    if !is_supported() {
        return Err(
            "gpu-screen-recorder was not found on PATH. Install it from your distro \
             (e.g. `sudo pacman -S gpu-screen-recorder`), from flathub \
             (`flatpak install flathub com.dec05eba.gpu_screen_recorder`), or from source."
                .to_string(),
        );
    }

    let replay = kind == "replay";
    let mut cmd = Command::new(BINARY);

    // Wayland monitor capture needs root; the desktop portal is the supported
    // path there. X11 can grab the monitor directly.
    cmd.arg("-w");
    cmd.arg(if crate::linux_desktop::is_wayland() {
        "portal"
    } else {
        "screen"
    });
    cmd.arg("-c").arg("mp4");
    cmd.arg("-f").arg(config.fps.max(1).to_string());

    // gsr records at constant quality by default, where `-q` is a preset name.
    // A numeric `-q` is only a bitrate in CBR mode, so pair it with `-bm cbr`
    // to honour the configured bitrate. (`-k` is the *codec*, not the bitrate.)
    cmd.arg("-bm").arg("cbr");
    cmd.arg("-q")
        .arg(config.bitrate_kbps.max(1_000).to_string());

    if config.game_audio {
        cmd.arg("-a").arg(audio_source(
            config.audio_device.as_deref(),
            "default_output",
        ));
    }
    if config.microphone {
        cmd.arg("-a")
            .arg(audio_source(config.mic_device.as_deref(), "default_input"));
    }

    cmd.arg("-cursor")
        .arg(if config.show_cursor { "yes" } else { "no" });

    // `-o` is an output *file* for recordings but a *directory* for replay mode,
    // where gsr generates the filename when the buffer is saved.
    let output = if replay {
        cmd.arg("-r").arg(config.replay_seconds.max(2).to_string());
        cmd.arg("-replay-storage").arg("ram");
        None
    } else {
        Some(folder.join(format!("Record_{started_at}.mp4")))
    };
    match &output {
        Some(path) => cmd.arg("-o").arg(path),
        None => cmd.arg("-o").arg(folder),
    };

    // Detach from our console; gsr's chatter is not useful in the app log.
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let child = cmd
        .spawn()
        .map_err(|e| format!("failed to start gpu-screen-recorder: {e}"))?;

    Ok(Session {
        child: Mutex::new(Some(child)),
        folder: folder.to_path_buf(),
        started_at,
        game_title: config.game_title.clone(),
        kind: kind.to_string(),
        output,
    })
}

/// Map a stored device id onto a `gpu-screen-recorder` `-a` source.
///
/// Specific devices use gsr's `device:<name>` form; `default_output`/
/// `default_input` (and explicit `device:`/`app:` specs) pass through verbatim.
fn audio_source(device: Option<&str>, default: &str) -> String {
    match device.map(str::trim).filter(|name| !name.is_empty()) {
        None => default.to_string(),
        Some(name)
            if name == "default_output"
                || name == "default_input"
                || name.starts_with("device:")
                || name.starts_with("app:") =>
        {
            name.to_string()
        }
        Some(name) => format!("device:{name}"),
    }
}

/// Newest video file (`.mp4`/`.mkv`) in `folder` as `(path, mtime_ms)`.
fn newest_video(folder: &Path) -> Option<(PathBuf, u64)> {
    let entries = std::fs::read_dir(folder).ok()?;
    let mut best: Option<(PathBuf, u64)> = None;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let is_video = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| matches!(ext.to_ascii_lowercase().as_str(), "mp4" | "mkv"))
            .unwrap_or(false);
        if !is_video {
            continue;
        }
        let mtime = entry
            .metadata()
            .ok()
            .and_then(|meta| meta.modified().ok())
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis() as u64)
            .unwrap_or(0);
        if best.as_ref().map(|(_, seen)| mtime > *seen).unwrap_or(true) {
            best = Some((path, mtime));
        }
    }
    best
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_audio_sources_pass_through() {
        assert_eq!(audio_source(None, "default_output"), "default_output");
        assert_eq!(audio_source(Some(""), "default_output"), "default_output");
        assert_eq!(audio_source(Some("  "), "default_input"), "default_input");
        assert_eq!(
            audio_source(Some("default_input"), "default_output"),
            "default_input"
        );
    }

    #[test]
    fn specific_devices_get_the_device_prefix() {
        assert_eq!(
            audio_source(Some("alsa_output.pci.analog-stereo"), "default_output"),
            "device:alsa_output.pci.analog-stereo"
        );
        assert_eq!(
            audio_source(Some("device:alsa_input.usb"), "default_input"),
            "device:alsa_input.usb"
        );
    }
}
