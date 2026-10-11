//! Windows WASAPI implementation of [`super::audio`].

use std::ffi::c_void;

use windows::core::{GUID, PCWSTR, PWSTR};
use windows::Win32::Media::Audio::{
    eCapture, eConsole, eRender, IAudioCaptureClient, IAudioClient, IMMDevice, IMMDeviceCollection,
    IMMDeviceEnumerator, MMDeviceEnumerator, AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED,
    AUDCLNT_STREAMFLAGS_LOOPBACK, DEVICE_STATE_ACTIVE, WAVEFORMATEX, WAVEFORMATEXTENSIBLE,
};
use windows::Win32::System::Com::StructuredStorage::PropVariantToStringAlloc;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED, STGM_READ,
};
use windows::Win32::UI::Shell::PropertiesSystem::{IPropertyStore, PROPERTYKEY};

use super::{AudioDeviceInfo, AudioDeviceList, AudioFormat};

/// `PKEY_Device_FriendlyName` ({a45c254e-df1c-4efd-8020-67d146a850e0}, 14),
/// declared locally so we don't pull in the whole Devices property feature set.
const PKEY_DEVICE_FRIENDLY_NAME: PROPERTYKEY = PROPERTYKEY {
    fmtid: GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0),
    pid: 14,
};

const WAVE_FORMAT_IEEE_FLOAT: u16 = 0x0003;
const WAVE_FORMAT_EXTENSIBLE: u16 = 0xFFFE;
/// `KSDATAFORMAT_SUBTYPE_IEEE_FLOAT`.
const SUBTYPE_IEEE_FLOAT: GUID = GUID::from_u128(0x00000003_0000_0010_8000_00aa00389b71);

/// How a device's mix format stores one sample.
#[derive(Clone, Copy, Debug, PartialEq)]
enum SampleKind {
    F32,
    I16,
    I24,
    I32,
}

impl SampleKind {
    fn bytes(self) -> usize {
        match self {
            SampleKind::I16 => 2,
            SampleKind::I24 => 3,
            _ => 4,
        }
    }
}

/// Capture client for one endpoint. Owns the WASAPI interfaces; safe to poll
/// from the encoder thread.
pub struct AudioClient {
    client: IAudioClient,
    capture: IAudioCaptureClient,
    format: AudioFormat,
    kind: SampleKind,
    /// Channels as delivered by the device (may exceed the 2 we encode).
    device_channels: u16,
}

impl AudioClient {
    /// Open `device_id` (or the system default) as a loopback render capture
    /// (`loopback = true`) or a microphone capture (`loopback = false`).
    pub fn open(device_id: Option<&str>, loopback: bool) -> Result<Self, String> {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

            let enumerator: IMMDeviceEnumerator = CoCreateInstance(
                &MMDeviceEnumerator,
                None::<&windows::core::IUnknown>,
                CLSCTX_ALL,
            )
            .map_err(|e| format!("MMDeviceEnumerator: {e}"))?;

            let device = match device_id.map(str::trim).filter(|id| !id.is_empty()) {
                Some(id) => get_device_by_id(&enumerator, id)?,
                None => enumerator
                    .GetDefaultAudioEndpoint(if loopback { eRender } else { eCapture }, eConsole)
                    .map_err(|e| format!("GetDefaultAudioEndpoint: {e}"))?,
            };

            let client: IAudioClient = device
                .Activate(CLSCTX_ALL, None)
                .map_err(|e| format!("IAudioClient activate: {e}"))?;

            let mix = client.GetMixFormat().map_err(|e| format!("GetMixFormat: {e}"))?;
            if mix.is_null() {
                return Err("GetMixFormat returned no format".to_string());
            }
            let wave: WAVEFORMATEX = *mix;
            let device_channels = wave.nChannels.max(1);
            let sample_rate = if wave.nSamplesPerSec == 0 {
                48_000
            } else {
                wave.nSamplesPerSec
            };
            let kind = match detect_sample_kind(mix) {
                Some(kind) => kind,
                None => {
                    let bits = wave.wBitsPerSample;
                    let tag = wave.wFormatTag;
                    CoTaskMemFree(Some(mix as *const c_void));
                    return Err(format!(
                        "unsupported audio mix format: {bits} bits, tag {tag:#06x}"
                    ));
                }
            };

            let flags = if loopback {
                AUDCLNT_STREAMFLAGS_LOOPBACK
            } else {
                0
            };

            // 1 s ring buffer, shared mode.
            let init = client.Initialize(
                AUDCLNT_SHAREMODE_SHARED,
                flags,
                10_000_000,
                0,
                mix,
                None,
            );
            CoTaskMemFree(Some(mix as *const c_void));
            init.map_err(|e| format!("IAudioClient::Initialize: {e}"))?;

            let capture: IAudioCaptureClient = client
                .GetService()
                .map_err(|e| format!("IAudioCaptureClient: {e}"))?;
            client.Start().map_err(|e| format!("IAudioClient::Start: {e}"))?;

            Ok(Self {
                client,
                capture,
                format: AudioFormat {
                    // Always encode stereo: mono is duplicated and wider
                    // devices are reduced to their first stereo pair.
                    channels: 2,
                    sample_rate,
                },
                kind,
                device_channels,
            })
        }
    }

    pub fn format(&self) -> AudioFormat {
        self.format
    }

    /// Drain every buffered packet, invoking `on_data` with interleaved PCM16.
    pub fn poll<F: FnMut(&[u8], u32)>(&mut self, mut on_data: F) -> Result<(), String> {
        unsafe {
            loop {
                let packet = self
                    .capture
                    .GetNextPacketSize()
                    .map_err(|e| format!("GetNextPacketSize: {e}"))?;
                if packet == 0 {
                    break;
                }

                let mut data: *mut u8 = std::ptr::null_mut();
                let mut frames: u32 = 0;
                let mut flags: u32 = 0;
                self.capture
                    .GetBuffer(&mut data, &mut frames, &mut flags, None, None)
                    .map_err(|e| format!("GetBuffer: {e}"))?;

                let silent = (flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) != 0;
                if !silent && frames > 0 && !data.is_null() {
                    let len = frames as usize * self.device_channels as usize * self.kind.bytes();
                    let slice = std::slice::from_raw_parts(data, len);
                    let pcm = self.convert(slice, frames);
                    on_data(&pcm, frames);
                }

                let _ = self.capture.ReleaseBuffer(frames);
            }
        }
        Ok(())
    }

    /// Convert one device packet to interleaved stereo PCM16.
    fn convert(&self, bytes: &[u8], frames: u32) -> Vec<u8> {
        let device = self.device_channels as usize;
        let out = 2usize;
        let sb = self.kind.bytes();
        let mut out_bytes = Vec::with_capacity(frames as usize * out * 2);
        for frame in 0..frames as usize {
            for oc in 0..out {
                // Mono is duplicated; >2 channels keep the first stereo pair.
                let dc = if device == 1 { 0 } else { oc.min(device - 1) };
                let off = (frame * device + dc) * sb;
                if off + sb > bytes.len() {
                    break;
                }
                let sample = match self.kind {
                    SampleKind::F32 => {
                        let v = f32::from_le_bytes([
                            bytes[off],
                            bytes[off + 1],
                            bytes[off + 2],
                            bytes[off + 3],
                        ]);
                        let v = if v.is_finite() { v.clamp(-1.0, 1.0) } else { 0.0 };
                        (v * 32767.0) as i16
                    }
                    SampleKind::I16 => i16::from_le_bytes([bytes[off], bytes[off + 1]]),
                    SampleKind::I24 => {
                        let raw = (bytes[off] as i32)
                            | ((bytes[off + 1] as i32) << 8)
                            | ((bytes[off + 2] as i32) << 16);
                        // Sign-extend the 24-bit value, then take the high 16.
                        ((raw << 8) >> 8 >> 8) as i16
                    }
                    SampleKind::I32 => {
                        let v = i32::from_le_bytes([
                            bytes[off],
                            bytes[off + 1],
                            bytes[off + 2],
                            bytes[off + 3],
                        ]);
                        (v >> 16) as i16
                    }
                };
                out_bytes.extend_from_slice(&sample.to_le_bytes());
            }
        }
        out_bytes
    }
}

impl Drop for AudioClient {
    fn drop(&mut self) {
        unsafe {
            let _ = self.client.Stop();
        }
    }
}

fn detect_sample_kind(mix: *const WAVEFORMATEX) -> Option<SampleKind> {
    unsafe {
        let wave = *mix;
        let bits = wave.wBitsPerSample;
        let is_float = if wave.wFormatTag == WAVE_FORMAT_IEEE_FLOAT {
            true
        } else if wave.wFormatTag == WAVE_FORMAT_EXTENSIBLE {
            let sub_format = (*(mix as *const WAVEFORMATEXTENSIBLE)).SubFormat;
            sub_format == SUBTYPE_IEEE_FLOAT
        } else {
            false
        };
        match (bits, is_float) {
            (32, true) => Some(SampleKind::F32),
            (16, false) => Some(SampleKind::I16),
            (24, false) => Some(SampleKind::I24),
            (32, false) => Some(SampleKind::I32),
            _ => None,
        }
    }
}

fn get_device_by_id(enumerator: &IMMDeviceEnumerator, id: &str) -> Result<IMMDevice, String> {
    let wide: Vec<u16> = id.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        enumerator
            .GetDevice(PCWSTR(wide.as_ptr()))
            .map_err(|e| format!("GetDevice('{id}'): {e}"))
    }
}

fn pwstr_to_string(p: PWSTR) -> String {
    unsafe {
        if p.is_null() {
            String::new()
        } else {
            p.to_string().unwrap_or_default()
        }
    }
}

fn device_id(device: &IMMDevice) -> Option<String> {
    unsafe { device.GetId().ok().map(pwstr_to_string) }
}

fn device_name(device: &IMMDevice) -> Option<String> {
    unsafe {
        let store: IPropertyStore = device.OpenPropertyStore(STGM_READ).ok()?;
        let value = store.GetValue(&PKEY_DEVICE_FRIENDLY_NAME).ok()?;
        let pw = PropVariantToStringAlloc(&value).ok()?;
        let name = pwstr_to_string(pw);
        CoTaskMemFree(Some(pw.0 as *const c_void));
        Some(name)
    }
}

unsafe fn collect(
    enumerator: &IMMDeviceEnumerator,
    flow: windows::Win32::Media::Audio::EDataFlow,
    default_id: Option<&str>,
) -> Vec<AudioDeviceInfo> {
    let mut out = Vec::new();
    let Ok(collection): Result<IMMDeviceCollection, _> =
        enumerator.EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE)
    else {
        return out;
    };
    let count = collection.GetCount().unwrap_or(0);
    for index in 0..count {
        let Ok(device) = collection.Item(index) else {
            continue;
        };
        let id = device_id(&device).unwrap_or_default();
        let name = device_name(&device).unwrap_or_else(|| format!("Device {}", index + 1));
        out.push(AudioDeviceInfo {
            is_default: default_id == Some(id.as_str()),
            id,
            name,
        });
    }
    out
}

pub fn list_devices() -> AudioDeviceList {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

        let enumerator: Result<IMMDeviceEnumerator, _> = CoCreateInstance(
            &MMDeviceEnumerator,
            None::<&windows::core::IUnknown>,
            CLSCTX_ALL,
        );
        let Ok(enumerator) = enumerator else {
            return AudioDeviceList::default();
        };

        let default_out = enumerator
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .ok()
            .and_then(|d| device_id(&d));
        let default_in = enumerator
            .GetDefaultAudioEndpoint(eCapture, eConsole)
            .ok()
            .and_then(|d| device_id(&d));

        AudioDeviceList {
            output: collect(&enumerator, eRender, default_out.as_deref()),
            input: collect(&enumerator, eCapture, default_in.as_deref()),
        }
    }
}
