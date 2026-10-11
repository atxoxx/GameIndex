//! Windows WASAPI implementation of [`super::audio`].

use std::ffi::c_void;

use windows::core::{GUID, PCWSTR, PWSTR};
use windows::Win32::Media::Audio::{
    eCapture, eConsole, eRender, IAudioCaptureClient, IAudioClient, IMMDevice, IMMDeviceCollection,
    IMMDeviceEnumerator, MMDeviceEnumerator, AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED,
    AUDCLNT_STREAMFLAGS_LOOPBACK, DEVICE_STATE_ACTIVE, WAVEFORMATEX,
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

/// Capture client for one endpoint. Owns the WASAPI interfaces; safe to poll
/// from the encoder thread.
pub struct AudioClient {
    client: IAudioClient,
    capture: IAudioCaptureClient,
    format: AudioFormat,
    /// 4 bytes/sample for float32, 2 for PCM16.
    is_float: bool,
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
            let channels = wave.nChannels.max(1);
            let sample_rate = if wave.nSamplesPerSec == 0 {
                48_000
            } else {
                wave.nSamplesPerSec
            };
            let bits = wave.wBitsPerSample;
            let is_float = bits == 32;

            if bits != 16 && bits != 32 {
                CoTaskMemFree(Some(mix as *const c_void));
                return Err(format!("unsupported audio sample size: {bits}-bit"));
            }

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
                    channels,
                    sample_rate,
                },
                is_float,
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
                    let bytes_per_sample = if self.is_float { 4 } else { 2 };
                    let len = frames as usize * self.format.channels as usize * bytes_per_sample;
                    let slice = std::slice::from_raw_parts(data, len);
                    let pcm = if self.is_float {
                        float_to_pcm16(slice)
                    } else {
                        slice.to_vec()
                    };
                    on_data(&pcm, frames);
                }

                let _ = self.capture.ReleaseBuffer(frames);
            }
        }
        Ok(())
    }
}

impl Drop for AudioClient {
    fn drop(&mut self) {
        unsafe {
            let _ = self.client.Stop();
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

fn float_to_pcm16(bytes: &[u8]) -> Vec<u8> {
    let samples = bytes.len() / 4;
    let mut out = Vec::with_capacity(samples * 2);
    for i in 0..samples {
        let f = f32::from_le_bytes([
            bytes[i * 4],
            bytes[i * 4 + 1],
            bytes[i * 4 + 2],
            bytes[i * 4 + 3],
        ]);
        let clamped = if f.is_finite() { f.clamp(-1.0, 1.0) } else { 0.0 };
        let s = (clamped * 32767.0) as i16;
        out.extend_from_slice(&s.to_le_bytes());
    }
    out
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
