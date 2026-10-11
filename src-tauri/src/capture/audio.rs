//! WASAPI audio capture for the recorder.
//!
//! Two flavours share one implementation:
//!   * **game audio** — loopback capture of a render (output) endpoint, and
//!   * **microphone** — capture of an input endpoint.
//!
//! Both deliver interleaved 16-bit PCM to the encoder, which muxes each as an
//! AAC track. Device enumeration backs the settings dropdowns.
//!
//! Everything here is Windows-only; the stub in `audio` above the `cfg` keeps
//! macOS/Linux green.

use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDeviceInfo {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDeviceList {
    pub output: Vec<AudioDeviceInfo>,
    pub input: Vec<AudioDeviceInfo>,
}

/// Interleaved PCM format delivered to the encoder.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AudioFormat {
    pub channels: u16,
    pub sample_rate: u32,
}

#[cfg(not(any(windows, target_os = "linux")))]
mod imp {
    use super::{AudioDeviceList, AudioFormat};

    pub fn list_devices() -> AudioDeviceList {
        AudioDeviceList::default()
    }

    pub struct AudioClient;

    impl AudioClient {
        pub fn open(_device_id: Option<&str>, _loopback: bool) -> Result<Self, String> {
            Err("Audio capture is supported on Windows only".to_string())
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
}

#[cfg(windows)]
#[path = "audio_windows.rs"]
mod imp;

#[cfg(target_os = "linux")]
#[path = "audio_linux.rs"]
mod imp;

pub use imp::{list_devices, AudioClient};
