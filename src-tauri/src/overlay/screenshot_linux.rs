//! Linux screen capture for the in-game overlay.
//!
//! This is the Linux arm of the overlay's `gdi_capture` module, so it exposes
//! the same two entry points the Windows GDI implementation does. There is no
//! single Linux API for a desktop grab, so the path forks on the session type:
//!
//! - **X11:** `GetImage` on the root window via `x11rb`. That captures the whole
//!   screen (the Windows arm instead targets the foreground monitor; the X11
//!   root is inherently the full virtual desktop).
//! - **Wayland:** there is no client-visible framebuffer, so capture goes
//!   through the XDG Desktop Portal `Screenshot` interface. This requires a
//!   portal backend (xdg-desktop-portal + a desktop-specific implementation) to
//!   be installed and running, and it **prompts the user** with a portal dialog
//!   before returning an image. The portal writes a PNG to a `file://` URI which
//!   we read and normalise to RGBA8.
//!
//! Everything returns `Result` with a readable message; nothing here panics.

use std::path::Path;

use crate::linux_desktop;

/// Grab the whole desktop as top-down RGBA8.
///
/// Prefers the Wayland portal when the session is Wayland: under XWayland an
/// X11 root grab would only see X11 clients, not native Wayland surfaces.
pub fn capture_rgba() -> Result<(u32, u32, Vec<u8>), String> {
    if linux_desktop::is_wayland() {
        return capture_wayland();
    }
    if linux_desktop::is_x11() {
        return capture_x11();
    }
    Err("No supported Linux display server detected (need X11 or Wayland)".into())
}

/// Capture the desktop and write it to `dest` as a PNG. Returns the dimensions.
pub fn capture_desktop(dest: &Path) -> Result<(u32, u32), String> {
    let (width, height, rgba) = capture_rgba()?;
    let png = crate::overlay::encode_uncompressed_png(width, height, &rgba);
    std::fs::write(dest, png)
        .map_err(|e| format!("failed to write screenshot {}: {e}", dest.display()))?;
    Ok((width, height))
}

/// X11 root-window grab. The root depth is almost always 24 (or 32 with a
/// compositor alpha channel); both are 4 bytes/pixel BGRA/X on little-endian.
fn capture_x11() -> Result<(u32, u32, Vec<u8>), String> {
    use x11rb::connection::Connection;
    use x11rb::protocol::xproto::{get_image, ImageFormat};

    let (conn, screen_num) = x11rb::connect(None).map_err(|e| e.to_string())?;
    let screen = &conn.setup().roots[screen_num];
    let root = screen.root;
    let width = screen.width_in_pixels;
    let height = screen.height_in_pixels;

    if width == 0 || height == 0 {
        return Err("X11 root window has no size".into());
    }

    let reply = get_image(&conn, ImageFormat::Z_PIXMAP, root, 0, 0, width, height, !0)
        .map_err(|e| e.to_string())?
        .reply()
        .map_err(|e| e.to_string())?;

    if reply.depth != 24 && reply.depth != 32 {
        return Err(format!("unsupported root depth {}", reply.depth));
    }

    let mut data = reply.data;
    for px in data.chunks_exact_mut(4) {
        px.swap(0, 2); // BGRA -> RGBA
        px[3] = 0xff; // X channel is undefined; force opaque
    }

    Ok((width as u32, height as u32, data))
}

/// Wayland grab via the XDG Desktop Portal. The portal client is tokio/zbus
/// async, so it runs on a dedicated thread with its own runtime: this function
/// is called from an async Tauri command, where blocking on the ambient runtime
/// would panic ("cannot block the current thread from within a runtime").
fn capture_wayland() -> Result<(u32, u32, Vec<u8>), String> {
    std::thread::spawn(capture_wayland_blocking)
        .join()
        .map_err(|_| "portal screenshot thread panicked".to_string())?
}

fn capture_wayland_blocking() -> Result<(u32, u32, Vec<u8>), String> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| e.to_string())?;
    runtime.block_on(capture_wayland_async())
}

async fn capture_wayland_async() -> Result<(u32, u32, Vec<u8>), String> {
    use ashpd::desktop::screenshot::Screenshot;

    let shot = Screenshot::request()
        .interactive(true)
        .modal(true)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .response()
        .map_err(|e| e.to_string())?;

    let path = uri_to_path(shot.uri().as_str())?;
    let bytes = std::fs::read(&path)
        .map_err(|e| format!("failed to read portal screenshot {}: {e}", path.display()))?;

    decode_png_rgba(&bytes)
}

/// Decode an 8-bit RGB/RGBA PNG into top-down RGBA8.
fn decode_png_rgba(bytes: &[u8]) -> Result<(u32, u32, Vec<u8>), String> {
    let decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    let mut reader = decoder.read_info().map_err(|e| e.to_string())?;
    let mut buf = vec![0; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buf).map_err(|e| e.to_string())?;

    if info.bit_depth != png::BitDepth::Eight {
        return Err(format!(
            "unsupported screenshot bit depth {:?}",
            info.bit_depth
        ));
    }

    let src = &buf[..info.buffer_size()];
    let rgba = match info.color_type {
        png::ColorType::Rgba => src.to_vec(),
        png::ColorType::Rgb => {
            let mut out = Vec::with_capacity(src.len() / 3 * 4);
            for px in src.chunks_exact(3) {
                out.extend_from_slice(&[px[0], px[1], px[2], 0xff]);
            }
            out
        }
        other => return Err(format!("unsupported screenshot colour type {other:?}")),
    };

    Ok((info.width, info.height, rgba))
}

/// Turn the portal's `file://` URI into a filesystem path. The portal hands
/// back percent-encoded URIs, so `%20` and friends are decoded here.
fn uri_to_path(uri: &str) -> Result<std::path::PathBuf, String> {
    let rest = uri
        .strip_prefix("file://")
        .ok_or_else(|| format!("portal returned a non-file URI: {uri}"))?;
    // Accept the optional authority form file://localhost/path; anything else
    // is treated as a plain path.
    let rest = rest.strip_prefix("localhost").unwrap_or(rest);
    Ok(std::path::PathBuf::from(percent_decode(rest)))
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                out.push(hi << 4 | lo);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex_val(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}
