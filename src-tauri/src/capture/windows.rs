//! Windows Graphics Capture → Media Foundation recorder.
//!
//! A single worker thread owns the capture pipeline:
//!
//! 1. A D3D11 device is created and wrapped as a WinRT `IDirect3DDevice`.
//! 2. A **free-threaded** `Direct3D11CaptureFramePool` grabs the primary
//!    monitor; `FrameArrived` runs on a threadpool thread and copies each
//!    frame (BGRA) into a channel.
//! 3. The worker thread feeds those frames to a Media Foundation `IMFSinkWriter`
//!    which encodes H.264 into an MP4 (the Video Processor MFT handles the
//!    RGB32→H.264 conversion and any resolution scaling).
//!
//! Two session shapes share the pipeline: `record` writes one file, `replay`
//! writes a rolling temporary buffer that is promoted to a clip on demand.
//!
//! Audio muxing (WASAPI game-audio / microphone) is intentionally not wired yet
//! — the settings are persisted and the encoder is structured to add streams.

use std::collections::VecDeque;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use windows::core::{Interface, HSTRING, PCWSTR};
use windows::Foundation::TypedEventHandler;
use windows::Graphics::Capture::{Direct3D11CaptureFrame, Direct3D11CaptureFramePool, GraphicsCaptureItem, GraphicsCaptureSession};
use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
use windows::Graphics::DirectX::DirectXPixelFormat;
use windows::Graphics::SizeInt32;
use windows::Win32::Foundation::{HMODULE, POINT};
use windows::Win32::Graphics::Direct3D::{D3D_DRIVER_TYPE_HARDWARE, D3D_FEATURE_LEVEL_11_0};
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Resource, ID3D11Texture2D,
    D3D11_CPU_ACCESS_READ, D3D11_CREATE_DEVICE_FLAG, D3D11_MAP_READ, D3D11_MAPPED_SUBRESOURCE,
    D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
};
use windows::Win32::Graphics::Dxgi::IDXGIDevice;
use windows::Win32::Graphics::Gdi::{MonitorFromPoint, MONITOR_DEFAULTTOPRIMARY};
use windows::Win32::Media::MediaFoundation::{
    IMFByteStream, IMFMediaType, IMFSinkWriter, MFAudioFormat_AAC, MFAudioFormat_PCM,
    MFCreateAttributes, MFCreateMediaType, MFCreateMemoryBuffer, MFCreateSample,
    MFCreateSinkWriterFromURL, MFMediaType_Audio, MFMediaType_Video, MFStartup, MFVideoFormat_H264,
    MFVideoFormat_RGB32, MFSTARTUP_FULL, MF_MT_ALL_SAMPLES_INDEPENDENT, MF_MT_AUDIO_AVG_BYTES_PER_SECOND,
    MF_MT_AUDIO_BITS_PER_SAMPLE, MF_MT_AUDIO_BLOCK_ALIGNMENT, MF_MT_AUDIO_NUM_CHANNELS,
    MF_MT_AUDIO_SAMPLES_PER_SECOND, MF_MT_AVG_BITRATE, MF_MT_DEFAULT_STRIDE, MF_MT_FRAME_RATE,
    MF_MT_FRAME_SIZE, MF_MT_INTERLACE_MODE, MF_MT_MAJOR_TYPE, MF_MT_SUBTYPE,
    MF_MT_AAC_AUDIO_PROFILE_LEVEL_INDICATION, MF_MT_AAC_PAYLOAD_TYPE,
    MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, MF_SINK_WRITER_DISABLE_THROTTLING, MF_VERSION,
    MFVideoInterlace_Progressive,
};
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
use windows::Win32::System::WinRT::Direct3D11::{
    CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess,
};
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;

use super::audio::{AudioClient, AudioFormat};
use super::{CaptureConfig, ClipResult};

/// One captured frame ready to encode, tightly packed top-down BGRA.
struct Frame {
    data: Vec<u8>,
}

/// A live capture session. Dropping/stopping signals the worker thread and
/// joins it.
pub struct Session {
    stop: Arc<AtomicBool>,
    active: Arc<AtomicBool>,
    save_req: Arc<AtomicBool>,
    outcome: Arc<Mutex<Option<ClipResult>>>,
    last_saved: Arc<Mutex<Option<ClipResult>>>,
    kind: String,
    thread: Mutex<Option<JoinHandle<()>>>,
}

impl Session {
    pub fn active(&self) -> bool {
        self.active.load(Ordering::SeqCst)
    }

    /// Stop a manual recording; returns the finalized clip.
    pub fn stop(self) -> Option<ClipResult> {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(handle) = self.thread.lock().ok().and_then(|mut t| t.take()) {
            let _ = handle.join();
        }
        if self.kind == "record" {
            return self.outcome.lock().ok().and_then(|o| o.clone());
        }
        None
    }

    /// Promote the current replay buffer to a clip without stopping.
    pub fn save_replay(&self) -> Option<ClipResult> {
        if self.kind != "replay" || !self.active() {
            return None;
        }
        if let Ok(mut last) = self.last_saved.lock() {
            *last = None;
        }
        self.save_req.store(true, Ordering::SeqCst);

        let deadline = Instant::now() + Duration::from_secs(6);
        while Instant::now() < deadline {
            if let Ok(last) = self.last_saved.lock() {
                if let Some(clip) = last.clone() {
                    return Some(clip);
                }
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        None
    }
}

pub fn is_supported() -> bool {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        GraphicsCaptureSession::IsSupported().unwrap_or(false)
    }
}

/// Start a capture session. `kind` is `record` or `replay`.
pub fn start(
    config: &CaptureConfig,
    folder: &Path,
    started_at: u64,
    kind: &str,
) -> Result<Session, String> {
    if !is_supported() {
        return Err("Windows Graphics Capture is not supported on this system".to_string());
    }

    let stop = Arc::new(AtomicBool::new(false));
    let active = Arc::new(AtomicBool::new(true));
    let save_req = Arc::new(AtomicBool::new(false));
    let outcome: Arc<Mutex<Option<ClipResult>>> = Arc::new(Mutex::new(None));
    let last_saved: Arc<Mutex<Option<ClipResult>>> = Arc::new(Mutex::new(None));

    let (tx, rx) = mpsc::channel::<Frame>();

    let config = config.clone();
    let folder = folder.to_path_buf();
    let kind_owned = kind.to_string();

    let thread = {
        let stop = stop.clone();
        let active = active.clone();
        let save_req = save_req.clone();
        let outcome = outcome.clone();
        let last_saved = last_saved.clone();
        let kind = kind_owned.clone();
        let folder = folder.clone();
        let game_title = config.game_title.clone();
        std::thread::Builder::new()
            .name("gameindex-capture".to_string())
            .spawn(move || {
                let result = run_capture(
                    &config,
                    &folder,
                    &kind,
                    started_at,
                    &game_title,
                    tx,
                    rx,
                    &stop,
                    &save_req,
                    &last_saved,
                );
                match result {
                    Ok(clip) => {
                        if let Ok(mut o) = outcome.lock() {
                            *o = clip;
                        }
                    }
                    Err(e) => eprintln!("[capture] {e}"),
                }
                active.store(false, Ordering::SeqCst);
            })
            .map_err(|e| format!("failed to spawn capture thread: {e}"))?
    };

    Ok(Session {
        stop,
        active,
        save_req,
        outcome,
        last_saved,
        kind: kind_owned,
        thread: Mutex::new(Some(thread)),
    })
}

#[allow(clippy::too_many_arguments)]
fn run_capture(
    config: &CaptureConfig,
    folder: &Path,
    kind: &str,
    started_at: u64,
    game_title: &str,
    tx: Sender<Frame>,
    rx: Receiver<Frame>,
    stop: &Arc<AtomicBool>,
    save_req: &Arc<AtomicBool>,
    last_saved: &Arc<Mutex<Option<ClipResult>>>,
) -> Result<Option<ClipResult>, String> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        MFStartup(MF_VERSION, MFSTARTUP_FULL).map_err(|e| format!("MFStartup failed: {e}"))?;
    }

    let captured = CaptureContext::new(tx, config.show_cursor)?;
    let (native_w, native_h) = captured.size;

    let scale = config.resolution_scale.clamp(0.25, 1.0);
    let out_w = even(native_w as f64 * scale);
    let out_h = even(native_h as f64 * scale);

    let fps = config.fps.max(15);
    let bitrate = config.bitrate_kbps * 1000;

    // Temporary/live file path. Manual recordings keep their final name; replay
    // sessions write a hidden buffer that is renamed when promoted.
    let date_str = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
    let final_path = match kind {
        "replay" => folder.join(format!("Replay_{date_str}.mp4")),
        _ => folder.join(format!("Record_{date_str}.mp4")),
    };
    let buffer_path = folder.join(format!(".buffer_{date_str}.mp4"));

    // Audio sources. Game audio (render loopback) and the microphone are mixed
    // into a single AAC track so players that ignore extra tracks still hear
    // both; a lone source is written straight through.
    let mut tracks: Vec<AudioTrack> = Vec::new();
    if config.game_audio {
        match AudioClient::open(config.audio_device.as_deref(), true) {
            Ok(client) => tracks.push(AudioTrack::new(client)),
            Err(e) => eprintln!("[capture] game audio unavailable: {e}"),
        }
    }
    if config.microphone {
        match AudioClient::open(config.mic_device.as_deref(), false) {
            Ok(client) => tracks.push(AudioTrack::new(client)),
            Err(e) => eprintln!("[capture] microphone unavailable: {e}"),
        }
    }

    let mixing = tracks.len() > 1;
    let target_rate = tracks.first().map(|t| t.src_rate).unwrap_or(48_000);
    let writer_audio: Vec<AudioFormat> = if mixing {
        vec![AudioFormat {
            channels: 2,
            sample_rate: target_rate,
        }]
    } else {
        tracks.iter().map(|t| t.client.format()).collect()
    };

    let mut writer = Mp4Writer::create(
        if kind == "replay" { &buffer_path } else { &final_path },
        native_w,
        native_h,
        out_w,
        out_h,
        fps,
        bitrate,
        &writer_audio,
    )?;
    let mut audio_streams = writer.audio_streams().to_vec();
    // Timeline for the single-source (direct) path.
    let mut direct_time: i64 = 0;
    // Wall-clock pacing for the mixed path.
    let mut mix_emitted: i64 = 0;
    let mut mix_time: i64 = 0;

    let start = Instant::now();
    let frame_dur_100ns = 10_000_000i64 / fps as i64;
    let mut last_ts = 0i64;
    let max_clip = config.max_clip_seconds as u64;
    let segment_cap = config.replay_seconds.max(5) as u64;

    captured.start()?;

    let mut saved_this_pass: Option<ClipResult> = None;

    loop {
        if stop.load(Ordering::SeqCst) {
            break;
        }

        match rx.recv_timeout(Duration::from_millis(50)) {
            Ok(frame) => {
                let ts = start.elapsed().as_nanos() as i64 / 100;
                let ts = ts.max(last_ts + 1);
                last_ts = ts;
                let _ = writer.write_bgra(&frame.data, native_w as u32, ts, frame_dur_100ns);
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }

        // Pump the audio sources.
        if mixing {
            for track in tracks.iter_mut() {
                track.pull(target_rate);
            }
            if let Some(&stream) = audio_streams.first() {
                pump_mixed(
                    &mut tracks,
                    target_rate,
                    stream,
                    &mut writer,
                    start.elapsed().as_secs_f64(),
                    &mut mix_emitted,
                    &mut mix_time,
                );
            }
        } else if let (Some(track), Some(&stream)) = (tracks.first_mut(), audio_streams.first()) {
            let rate = track.src_rate.max(1) as i64;
            let mut pending: Vec<(Vec<u8>, u32)> = Vec::new();
            if let Err(e) = track
                .client
                .poll(|data, frames| pending.push((data.to_vec(), frames)))
            {
                if !track.logged {
                    eprintln!("[capture] audio capture error: {e}");
                    track.logged = true;
                }
            }
            for (data, frames) in pending {
                if !track.seen {
                    track.seen = true;
                    eprintln!("[capture] audio source streaming ({frames} frames/packet)");
                }
                let dur = (frames as i64 * 10_000_000 / rate).max(1);
                if let Err(e) = writer.write_audio(stream, &data, frames, direct_time, rate as u32) {
                    if !track.logged {
                        eprintln!("[capture] audio encode error: {e}");
                        track.logged = true;
                    }
                }
                direct_time += dur;
            }
        }

        // Warn once per source that never produced any data.
        if start.elapsed().as_secs() >= 5 {
            for (index, track) in tracks.iter_mut().enumerate() {
                if !track.seen && !track.warned {
                    track.warned = true;
                    eprintln!(
                        "[capture] warning: audio source {index} produced no data after 5s \
                         (check the selected device, mic mute, and that audio is playing)"
                    );
                }
            }
        }

        // Manual recording hard cap.
        if kind != "replay" && max_clip > 0 && start.elapsed().as_secs() >= max_clip {
            break;
        }

        // Replay: promote-on-demand, otherwise roll the buffer.
        if kind == "replay" {
            if save_req.swap(false, Ordering::SeqCst) {
                let clip = promote(&mut writer, &buffer_path, folder, game_title, started_at, last_ts)?;
                if let Ok(mut last) = last_saved.lock() {
                    *last = Some(clip.clone());
                }
                saved_this_pass = Some(clip);
                // Continue buffering the next highlight in a fresh file.
                writer = Mp4Writer::create(
                    &buffer_path,
                    native_w,
                    native_h,
                    out_w,
                    out_h,
                    fps,
                    bitrate,
                    &writer_audio,
                )?;
                audio_streams = writer.audio_streams().to_vec();
                direct_time = 0;
                mix_emitted = 0;
                mix_time = 0;
                last_ts = 0;
            } else if start.elapsed().as_secs() >= segment_cap {
                // Roll the rolling buffer: drop the oldest window.
                writer.finalize();
                let _ = std::fs::remove_file(&buffer_path);
                writer = Mp4Writer::create(
                    &buffer_path,
                    native_w,
                    native_h,
                    out_w,
                    out_h,
                    fps,
                    bitrate,
                    &writer_audio,
                )?;
                audio_streams = writer.audio_streams().to_vec();
                direct_time = 0;
                mix_emitted = 0;
                mix_time = 0;
                last_ts = 0;
            }
        }
    }

    let _ = captured.stop();

    if kind == "replay" {
        // Disarming without a save discards the buffer.
        writer.finalize();
        if saved_this_pass.is_none() {
            let _ = std::fs::remove_file(&buffer_path);
        }
        return Ok(None);
    }

    writer.finalize();

    let file_name = final_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "Record.mp4".to_string());

    if !final_path.exists() {
        return Err("recording produced no output (encoder may not be available)".to_string());
    }

    Ok(Some(ClipResult {
        file_path: final_path.to_string_lossy().to_string(),
        file_name,
        game_title: game_title.to_string(),
        timestamp: started_at,
        duration_ms: (last_ts / 10_000) as u64,
        width: out_w as u32,
        height: out_h as u32,
        kind: "record".to_string(),
    }))
}

/// Finalize the current buffer and rename it to a permanent replay clip.
fn promote(
    writer: &mut Mp4Writer,
    buffer_path: &Path,
    folder: &Path,
    game_title: &str,
    started_at: u64,
    last_ts: i64,
) -> Result<ClipResult, String> {
    writer.finalize();
    let date_str = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
    let final_path = folder.join(format!("Replay_{date_str}.mp4"));
    std::fs::rename(buffer_path, &final_path)
        .map_err(|e| format!("failed to finalize replay clip: {e}"))?;

    let file_name = final_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "Replay.mp4".to_string());

    Ok(ClipResult {
        file_path: final_path.to_string_lossy().to_string(),
        file_name,
        game_title: game_title.to_string(),
        timestamp: started_at,
        duration_ms: (last_ts / 10_000) as u64,
        width: writer.out_width(),
        height: writer.out_height(),
        kind: "replay".to_string(),
    })
}

fn even(value: f64) -> i32 {
    let v = value.round() as i32;
    let v = v.max(2);
    if v % 2 == 0 {
        v
    } else {
        v + 1
    }
}

/// Owns the D3D11 device, the WGC frame pool and the live capture session.
struct CaptureContext {
    device: ID3D11Device,
    context: ID3D11DeviceContext,
    pool: Direct3D11CaptureFramePool,
    session: GraphicsCaptureSession,
    handler_token: windows::Foundation::EventRegistrationToken,
    size: (i32, i32),
}

impl CaptureContext {
    fn new(tx: Sender<Frame>, show_cursor: bool) -> Result<Self, String> {
        unsafe {
            let mut device: Option<ID3D11Device> = None;
            let mut d3d_context: Option<ID3D11DeviceContext> = None;
            let levels = [D3D_FEATURE_LEVEL_11_0];
            D3D11CreateDevice(
                None,
                D3D_DRIVER_TYPE_HARDWARE,
                HMODULE(std::ptr::null_mut()),
                D3D11_CREATE_DEVICE_FLAG(0),
                Some(&levels),
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                Some(&mut d3d_context),
            )
            .map_err(|e| format!("D3D11CreateDevice failed: {e}"))?;

            let device = device.ok_or("D3D11CreateDevice returned no device")?;
            let context = d3d_context.ok_or("D3D11CreateDevice returned no context")?;

            let dxgi: IDXGIDevice = device.cast().map_err(|e| format!("IDXGIDevice: {e}"))?;
            let inspectable = CreateDirect3D11DeviceFromDXGIDevice(&dxgi)
                .map_err(|e| format!("CreateDirect3D11DeviceFromDXGIDevice: {e}"))?;
            let winrt_device: IDirect3DDevice = inspectable
                .cast()
                .map_err(|e| format!("IDirect3DDevice: {e}"))?;

            let item = create_primary_monitor_item()?;
            let size = item.Size().map_err(|e| format!("capture item size: {e}"))?;
            let size = (size.Width.max(2), size.Height.max(2));

            let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
                &winrt_device,
                DirectXPixelFormat::B8G8R8A8UIntNormalized,
                2,
                SizeInt32 {
                    Width: size.0,
                    Height: size.1,
                },
            )
            .map_err(|e| format!("CreateFreeThreaded frame pool: {e}"))?;

            let session = pool
                .CreateCaptureSession(&item)
                .map_err(|e| format!("CreateCaptureSession: {e}"))?;
            let _ = session.SetIsCursorCaptureEnabled(show_cursor);
            let _ = session.SetIsBorderRequired(false);

            let handler_device = device.clone();
            let handler_context = context.clone();
            let handler = TypedEventHandler::new(
                move |pool: &Option<Direct3D11CaptureFramePool>,
                      _: &Option<windows::core::IInspectable>| {
                    if let Some(pool) = pool {
                        if let Ok(frame) = pool.TryGetNextFrame() {
                            if let Some(copied) =
                                copy_frame(&handler_device, &handler_context, &frame)
                            {
                                let _ = tx.send(copied);
                            }
                        }
                    }
                    Ok(())
                },
            );
            let token = pool
                .FrameArrived(&handler)
                .map_err(|e| format!("FrameArrived: {e}"))?;

            Ok(Self {
                device,
                context,
                pool,
                session,
                handler_token: token,
                size,
            })
        }
    }

    fn start(&self) -> Result<(), String> {
        self.session
            .StartCapture()
            .map_err(|e| format!("StartCapture: {e}"))
    }

    fn stop(&self) -> Result<(), String> {
        let _ = self.pool.RemoveFrameArrived(self.handler_token);
        let _ = self.session.Close();
        let _ = self.pool.Close();
        let _ = self.device.clone();
        let _ = self.context.clone();
        Ok(())
    }
}

/// Create a WGC capture item for the primary monitor via the WinRT interop.
fn create_primary_monitor_item() -> Result<GraphicsCaptureItem, String> {
    unsafe {
        let hmonitor = MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY);
        let interop: IGraphicsCaptureItemInterop = windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()
            .map_err(|e| format!("capture interop factory: {e}"))?;
        interop
            .CreateForMonitor::<_, GraphicsCaptureItem>(hmonitor)
            .map_err(|e| format!("CreateForMonitor: {e}"))
    }
}

/// Copy a captured frame's D3D texture into a tightly packed BGRA buffer.
fn copy_frame(
    device: &ID3D11Device,
    context: &ID3D11DeviceContext,
    frame: &Direct3D11CaptureFrame,
) -> Option<Frame> {
    unsafe {
        let surface = frame.Surface().ok()?;
        let access: IDirect3DDxgiInterfaceAccess = surface.cast().ok()?;
        let texture: ID3D11Texture2D = access.GetInterface().ok()?;

        let mut desc: D3D11_TEXTURE2D_DESC = std::mem::zeroed();
        texture.GetDesc(&mut desc);

        let mut staging_desc = desc;
        staging_desc.Usage = D3D11_USAGE_STAGING;
        staging_desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ.0 as u32;
        staging_desc.BindFlags = 0;
        staging_desc.MiscFlags = 0;

        let mut staging: Option<ID3D11Texture2D> = None;
        device
            .CreateTexture2D(&staging_desc, None, Some(&mut staging))
            .ok()?;
        let staging = staging?;

        let src_res: ID3D11Resource = texture.cast().ok()?;
        let dst_res: ID3D11Resource = staging.cast().ok()?;
        context.CopyResource(&dst_res, &src_res);

        let mut mapped: D3D11_MAPPED_SUBRESOURCE = std::mem::zeroed();
        context
            .Map(&dst_res, 0, D3D11_MAP_READ, 0, Some(&mut mapped))
            .ok()?;

        let width = desc.Width;
        let height = desc.Height;
        let row_bytes = (width * 4) as usize;
        let mut data = vec![0u8; row_bytes * height as usize];
        let src = mapped.pData as *const u8;
        let pitch = mapped.RowPitch as usize;
        for y in 0..height as usize {
            let src_row = src.add(y * pitch);
            let dst_row = data.as_mut_ptr().add(y * row_bytes);
            std::ptr::copy_nonoverlapping(src_row, dst_row, row_bytes);
        }

        context.Unmap(&dst_res, 0);

        Some(Frame { data })
    }
}

/// One live audio source feeding the recorder.
struct AudioTrack {
    client: AudioClient,
    /// Interleaved stereo PCM at the mixer's target rate, awaiting the mix.
    pending: VecDeque<i16>,
    src_rate: u32,
    seen: bool,
    warned: bool,
    logged: bool,
}

impl AudioTrack {
    fn new(client: AudioClient) -> Self {
        let src_rate = client.format().sample_rate;
        Self {
            client,
            pending: VecDeque::new(),
            src_rate,
            seen: false,
            warned: false,
            logged: false,
        }
    }

    /// Drain the endpoint, resampling to `target_rate` and queueing stereo PCM.
    fn pull(&mut self, target_rate: u32) {
        let mut chunks: Vec<(Vec<u8>, u32)> = Vec::new();
        if let Err(e) = self
            .client
            .poll(|data, frames| chunks.push((data.to_vec(), frames)))
        {
            if !self.logged {
                eprintln!("[capture] audio capture error: {e}");
                self.logged = true;
            }
        }
        for (data, _frames) in chunks {
            if !self.seen {
                self.seen = true;
                eprintln!("[capture] audio source streaming");
            }
            let samples = bytes_to_i16(&data);
            if self.src_rate == target_rate {
                self.pending.extend(samples);
            } else {
                self.pending
                    .extend(resample_stereo(&samples, self.src_rate, target_rate));
            }
        }
        // Bound drift: never queue more than ~1s of audio.
        let cap = target_rate as usize * 2;
        while self.pending.len() > cap {
            self.pending.pop_front();
        }
    }
}

/// Sum every track into one stereo AAC sample, paced by wall-clock time so a
/// silent or lagging source contributes silence instead of stalling the mix.
fn pump_mixed(
    tracks: &mut [AudioTrack],
    target_rate: u32,
    stream: u32,
    writer: &mut Mp4Writer,
    elapsed_secs: f64,
    emitted: &mut i64,
    time_100ns: &mut i64,
) {
    let desired = (elapsed_secs * target_rate as f64) as i64;
    let to_emit = (desired - *emitted).clamp(0, target_rate as i64);
    if to_emit == 0 {
        return;
    }
    let mut out: Vec<u8> = Vec::with_capacity(to_emit as usize * 4);
    for _ in 0..to_emit {
        let (mut left, mut right) = (0i32, 0i32);
        for track in tracks.iter_mut() {
            if track.pending.len() >= 2 {
                let l = track.pending.pop_front().unwrap_or(0);
                let r = track.pending.pop_front().unwrap_or(0);
                left += l as i32;
                right += r as i32;
            }
        }
        out.extend_from_slice(&(left.clamp(-32768, 32767) as i16).to_le_bytes());
        out.extend_from_slice(&(right.clamp(-32768, 32767) as i16).to_le_bytes());
    }
    let duration = (to_emit * 10_000_000 / target_rate as i64).max(1);
    let _ = writer.write_audio(stream, &out, to_emit as u32, *time_100ns, target_rate);
    *time_100ns += duration;
    *emitted += to_emit;
}

fn bytes_to_i16(bytes: &[u8]) -> Vec<i16> {
    bytes
        .chunks_exact(2)
        .map(|c| i16::from_le_bytes([c[0], c[1]]))
        .collect()
}

/// Linear-resample interleaved stereo PCM16 between two sample rates.
fn resample_stereo(input: &[i16], src_rate: u32, dst_rate: u32) -> Vec<i16> {
    if src_rate == dst_rate || input.len() < 4 {
        return input.to_vec();
    }
    let in_frames = input.len() / 2;
    let out_frames = ((in_frames as f64) * dst_rate as f64 / src_rate as f64).round() as usize;
    let step = src_rate as f64 / dst_rate as f64;
    let mut out = Vec::with_capacity(out_frames * 2);
    for i in 0..out_frames {
        let pos = i as f64 * step;
        let i0 = (pos.floor() as usize).min(in_frames - 1);
        let i1 = (i0 + 1).min(in_frames - 1);
        let frac = pos - i0 as f64;
        for ch in 0..2 {
            let a = input[i0 * 2 + ch] as f64;
            let b = input[i1 * 2 + ch] as f64;
            let v = a + (b - a) * frac;
            out.push(v.round().clamp(-32768.0, 32767.0) as i16);
        }
    }
    out
}

/// Thin wrapper over a Media Foundation `IMFSinkWriter` encoding H.264/MP4
/// with optional AAC audio tracks.
struct Mp4Writer {
    writer: IMFSinkWriter,
    stream_index: u32,
    audio_streams: Vec<u32>,
    out_w: u32,
    out_h: u32,
    finalized: bool,
}

impl Mp4Writer {
    #[allow(clippy::too_many_arguments)]
    fn create(
        path: &Path,
        native_w: i32,
        native_h: i32,
        out_w: i32,
        out_h: i32,
        fps: u32,
        bitrate: u32,
        audio: &[AudioFormat],
    ) -> Result<Self, String> {
        unsafe {
            let mut attrs = None;
            MFCreateAttributes(&mut attrs, 2).map_err(|e| format!("MFCreateAttributes: {e}"))?;
            let attrs = attrs.ok_or("MFCreateAttributes returned None")?;
            let _ = attrs.SetUINT32(&MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, 1);
            let _ = attrs.SetUINT32(&MF_SINK_WRITER_DISABLE_THROTTLING, 1);

            let url = HSTRING::from(path.to_string_lossy().as_ref());
            let writer =
                MFCreateSinkWriterFromURL(PCWSTR(url.as_ptr()), None::<&IMFByteStream>, Some(&attrs))
                    .map_err(|e| format!("MFCreateSinkWriterFromURL: {e}"))?;

            // Output: H.264 at the (possibly scaled) target size.
            let out_type: IMFMediaType =
                MFCreateMediaType().map_err(|e| format!("MFCreateMediaType(out): {e}"))?;
            out_type.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video).ok();
            out_type.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_H264).ok();
            out_type.SetUINT32(&MF_MT_AVG_BITRATE, bitrate).ok();
            out_type
                .SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)
                .ok();
            out_type
                .SetUINT64(&MF_MT_FRAME_SIZE, pack(out_w as u32, out_h as u32))
                .ok();
            out_type.SetUINT64(&MF_MT_FRAME_RATE, pack(fps, 1)).ok();

            let stream_index = writer
                .AddStream(&out_type)
                .map_err(|e| format!("AddStream(video): {e}"))?;

            // Input: tightly packed top-down BGRA at native capture size.
            let in_type: IMFMediaType =
                MFCreateMediaType().map_err(|e| format!("MFCreateMediaType(in): {e}"))?;
            in_type.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video).ok();
            in_type.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_RGB32).ok();
            in_type
                .SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)
                .ok();
            in_type
                .SetUINT64(&MF_MT_FRAME_SIZE, pack(native_w as u32, native_h as u32))
                .ok();
            in_type.SetUINT64(&MF_MT_FRAME_RATE, pack(fps, 1)).ok();
            in_type.SetUINT32(&MF_MT_ALL_SAMPLES_INDEPENDENT, 1).ok();
            // WGC frames are top-down; MF expects a *positive* default stride for
            // top-down images (negative would mark them bottom-up and flip them).
            let stride = native_w * 4;
            in_type.SetUINT32(&MF_MT_DEFAULT_STRIDE, stride as u32).ok();

            writer
                .SetInputMediaType(stream_index, &in_type, None)
                .map_err(|e| format!("SetInputMediaType(video): {e}"))?;

            // One AAC track per requested audio source.
            let mut audio_streams = Vec::with_capacity(audio.len());
            for format in audio {
                audio_streams.push(add_audio_stream(&writer, *format)?);
            }

            writer.BeginWriting().map_err(|e| format!("BeginWriting: {e}"))?;

            Ok(Self {
                writer,
                stream_index,
                audio_streams,
                out_w: out_w as u32,
                out_h: out_h as u32,
                finalized: false,
            })
        }
    }

    fn audio_streams(&self) -> &[u32] {
        &self.audio_streams
    }

    fn out_width(&self) -> u32 {
        self.out_w
    }

    fn out_height(&self) -> u32 {
        self.out_h
    }

    fn write_bgra(
        &mut self,
        data: &[u8],
        width: u32,
        time_100ns: i64,
        duration_100ns: i64,
    ) -> Result<(), String> {
        unsafe {
            let len = data.len() as u32;
            let buffer = MFCreateMemoryBuffer(len).map_err(|e| format!("MFCreateMemoryBuffer: {e}"))?;
            let mut ptr: *mut u8 = std::ptr::null_mut();
            buffer
                .Lock(&mut ptr, None, None)
                .map_err(|e| format!("buffer lock: {e}"))?;
            std::ptr::copy_nonoverlapping(data.as_ptr(), ptr, len as usize);
            let _ = buffer.Unlock();
            buffer
                .SetCurrentLength(len)
                .map_err(|e| format!("SetCurrentLength: {e}"))?;

            let sample = MFCreateSample().map_err(|e| format!("MFCreateSample: {e}"))?;
            sample
                .AddBuffer(&buffer)
                .map_err(|e| format!("AddBuffer: {e}"))?;
            sample.SetSampleTime(time_100ns).ok();
            sample.SetSampleDuration(duration_100ns).ok();

            let _ = width;
            self.writer
                .WriteSample(self.stream_index, &sample)
                .map_err(|e| format!("WriteSample: {e}"))
        }
    }

    /// Write one PCM16 packet to an AAC stream. `frames` is the sample-frame
    /// count (per channel); the sample duration is derived from `sample_rate`.
    fn write_audio(
        &mut self,
        stream: u32,
        pcm: &[u8],
        frames: u32,
        time_100ns: i64,
        sample_rate: u32,
    ) -> Result<(), String> {
        if pcm.is_empty() {
            return Ok(());
        }
        unsafe {
            let len = pcm.len() as u32;
            let buffer =
                MFCreateMemoryBuffer(len).map_err(|e| format!("MFCreateMemoryBuffer(audio): {e}"))?;
            let mut ptr: *mut u8 = std::ptr::null_mut();
            buffer
                .Lock(&mut ptr, None, None)
                .map_err(|e| format!("audio buffer lock: {e}"))?;
            std::ptr::copy_nonoverlapping(pcm.as_ptr(), ptr, len as usize);
            let _ = buffer.Unlock();
            buffer.SetCurrentLength(len).ok();

            let sample = MFCreateSample().map_err(|e| format!("MFCreateSample(audio): {e}"))?;
            sample
                .AddBuffer(&buffer)
                .map_err(|e| format!("AddBuffer(audio): {e}"))?;
            sample.SetSampleTime(time_100ns).ok();
            let duration = (frames as i64 * 10_000_000 / sample_rate.max(1) as i64).max(1);
            sample.SetSampleDuration(duration).ok();

            self.writer
                .WriteSample(stream, &sample)
                .map_err(|e| format!("WriteSample(audio): {e}"))
        }
    }

    fn finalize(&mut self) {
        if self.finalized {
            return;
        }
        self.finalized = true;
        unsafe {
            let _ = self.writer.Finalize();
        }
    }
}

impl Drop for Mp4Writer {
    fn drop(&mut self) {
        self.finalize();
    }
}

/// Add one AAC output + PCM16 input stream pair to the sink writer.
fn add_audio_stream(writer: &IMFSinkWriter, format: AudioFormat) -> Result<u32, String> {
    unsafe {
        let channels = format.channels.max(1) as u32;
        let rate = format.sample_rate.max(8_000);

        let out_type =
            MFCreateMediaType().map_err(|e| format!("MFCreateMediaType(aac): {e}"))?;
        out_type.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Audio).ok();
        out_type.SetGUID(&MF_MT_SUBTYPE, &MFAudioFormat_AAC).ok();
        out_type.SetUINT32(&MF_MT_AUDIO_BITS_PER_SAMPLE, 16).ok();
        out_type.SetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND, rate).ok();
        out_type.SetUINT32(&MF_MT_AUDIO_NUM_CHANNELS, channels).ok();
        out_type
            .SetUINT32(&MF_MT_AUDIO_AVG_BYTES_PER_SECOND, 16_000)
            .ok();
        out_type.SetUINT32(&MF_MT_AUDIO_BLOCK_ALIGNMENT, 1).ok();
        // The MP4 muxer expects raw AAC frames, not the encoder's default ADTS
        // payload; without this the audio track lands unplayable/silent.
        out_type.SetUINT32(&MF_MT_AAC_PAYLOAD_TYPE, 0).ok();
        out_type
            .SetUINT32(&MF_MT_AAC_AUDIO_PROFILE_LEVEL_INDICATION, 0x29)
            .ok();

        let index = writer
            .AddStream(&out_type)
            .map_err(|e| format!("AddStream(audio): {e}"))?;

        let in_type =
            MFCreateMediaType().map_err(|e| format!("MFCreateMediaType(pcm): {e}"))?;
        in_type.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Audio).ok();
        in_type.SetGUID(&MF_MT_SUBTYPE, &MFAudioFormat_PCM).ok();
        in_type.SetUINT32(&MF_MT_AUDIO_BITS_PER_SAMPLE, 16).ok();
        in_type.SetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND, rate).ok();
        in_type.SetUINT32(&MF_MT_AUDIO_NUM_CHANNELS, channels).ok();
        in_type.SetUINT32(&MF_MT_AUDIO_BLOCK_ALIGNMENT, channels * 2).ok();
        in_type
            .SetUINT32(&MF_MT_AUDIO_AVG_BYTES_PER_SECOND, rate * channels * 2)
            .ok();
        in_type.SetUINT32(&MF_MT_ALL_SAMPLES_INDEPENDENT, 1).ok();

        writer
            .SetInputMediaType(index, &in_type, None)
            .map_err(|e| format!("SetInputMediaType(audio): {e}"))?;
        Ok(index)
    }
}

/// Pack two `u32`s into the `MFRatio`/`MFSize` UINT64 layout (high << 32 | low).
fn pack(high: u32, low: u32) -> u64 {
    ((high as u64) << 32) | low as u64
}
