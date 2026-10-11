//! Linux audio-device enumeration for the recorder's device dropdowns.
//!
//! `gpu-screen-recorder` performs the actual audio capture itself, so this
//! module only shells out to `pactl` to populate the UI. Monitor sources
//! (`<sink>.monitor`) are what a game-audio loopback records, so they are
//! surfaced alongside the regular capture sources and marked in their name.

use std::process::Command;

use super::{AudioDeviceInfo, AudioDeviceList, AudioFormat};

/// Enumerate output (sinks) and input (sources) devices via `pactl`.
///
/// Returns an empty list when `pactl` is unavailable (for example a bare X11
/// session without PipeWire) so the UI can fall back to the system default.
pub fn list_devices() -> AudioDeviceList {
    if !crate::compatibility::is_command_available("pactl") {
        return AudioDeviceList::default();
    }

    AudioDeviceList {
        output: endpoints("sinks", pactl_default("get-default-sink").as_deref(), false),
        input: endpoints(
            "sources",
            pactl_default("get-default-source").as_deref(),
            true,
        ),
    }
}

fn endpoints(kind: &str, default: Option<&str>, mark_monitors: bool) -> Vec<AudioDeviceInfo> {
    let output = match Command::new("pactl").args(["list", "short", kind]).output() {
        Ok(output) if output.status.success() => output,
        _ => return Vec::new(),
    };
    parse_endpoints(
        &String::from_utf8_lossy(&output.stdout),
        default,
        mark_monitors,
    )
}

/// Parse `pactl list short` output. Each line is tab-separated:
/// `index`, `name`, `driver`, `spec`, `state`.
fn parse_endpoints(text: &str, default: Option<&str>, mark_monitors: bool) -> Vec<AudioDeviceInfo> {
    let mut devices = Vec::new();
    for line in text.lines() {
        let name = match line
            .split('\t')
            .nth(1)
            .map(str::trim)
            .filter(|name| !name.is_empty())
        {
            Some(name) => name,
            None => continue,
        };
        let is_monitor = mark_monitors && name.ends_with(".monitor");
        let display = if is_monitor {
            format!("{name} (monitor)")
        } else {
            name.to_string()
        };
        devices.push(AudioDeviceInfo {
            id: name.to_string(),
            name: display,
            is_default: default == Some(name),
        });
    }
    devices
}

fn pactl_default(command: &str) -> Option<String> {
    let output = Command::new("pactl").arg(command).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!name.is_empty()).then_some(name)
}

/// Unused on Linux: `gpu-screen-recorder` captures audio itself.
pub struct AudioClient;

impl AudioClient {
    pub fn open(_device_id: Option<&str>, _loopback: bool) -> Result<Self, String> {
        Err("Audio capture is handled by gpu-screen-recorder on Linux".to_string())
    }

    pub fn format(&self) -> AudioFormat {
        AudioFormat {
            channels: 2,
            sample_rate: 48_000,
        }
    }

    pub fn poll<F: FnMut(&[u8], u32)>(&mut self, _on_data: F) -> Result<(), String> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_sinks_and_marks_the_default() {
        let text =
            "0\talsa_output.pci.analog-stereo\tmodule-alsa-card.c\ts16le 2ch 48000Hz\tIDLE\n";
        let devices = parse_endpoints(text, Some("alsa_output.pci.analog-stereo"), false);
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].id, "alsa_output.pci.analog-stereo");
        assert!(devices[0].is_default);
    }

    #[test]
    fn marks_monitor_sources() {
        let text = "2\talsa_output.pci.analog-stereo.monitor\tmodule-alsa-card.c\ts16le 2ch 48000Hz\tIDLE\n";
        let devices = parse_endpoints(text, None, true);
        assert_eq!(devices.len(), 1);
        assert!(devices[0].name.ends_with("(monitor)"));
        assert!(!devices[0].is_default);
    }

    #[test]
    fn ignores_blank_and_malformed_lines() {
        assert!(parse_endpoints("\n\nnot-a-device\n", None, true).is_empty());
    }
}
