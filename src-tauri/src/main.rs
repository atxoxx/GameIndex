// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    {
        // The workarounds below fix NVIDIA proprietary-driver bugs on
        // WAYLAND (black/flickering webview, torn frames, threaded-
        // compositor deadlocks), but they disable WebKitGTK's hardware-
        // accelerated rendering path — `WEBKIT_DISABLE_DMABUF_RENDERER`
        // drops the DMA-BUF (GPU) compositor and
        // `WEBKIT_DISABLE_COMPOSITING_MODE` falls back to single-threaded
        // software painting. Applied unconditionally they make the whole
        // UI sluggish on every vendor AND on NVIDIA/X11, where DMA-BUF
        // and threaded compositing are the normal accelerated paths. So
        // only apply them on the exact combo that exhibited the bugs:
        // NVIDIA GPU + Wayland session. NVIDIA/X11, AMD and Intel all
        // keep full hardware acceleration. A user-provided env var always
        // wins (the `is_err()` checks below), so anyone who needs a
        // workaround can still opt in/out by exporting it themselves.
        let is_nvidia = gameindex_lib::gpu_detector::linux_has_nvidia_gpu();
        let is_wayland = std::env::var("WAYLAND_DISPLAY").is_ok()
            || std::env::var("XDG_SESSION_TYPE")
                .map(|t| t == "wayland")
                .unwrap_or(false);

        if is_nvidia && is_wayland {
            // NVIDIA + Wayland + DMA-BUF -> black/flickering webview.
            if std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").is_err() {
                std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
            }

            // NVIDIA explicit-sync on Wayland -> torn frames, black rects.
            if std::env::var("__NV_DISABLE_EXPLICIT_SYNC").is_err() {
                std::env::set_var("__NV_DISABLE_EXPLICIT_SYNC", "1");
            }

            // WebKitGTK 2.44+ threaded GPU compositing can deadlock on Wayland + NVIDIA.
            if std::env::var("WEBKIT_DISABLE_COMPOSITING_MODE").is_err() {
                std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
            }

            // Disable NVIDIA GLX threading workaround (conflicts with GTK).
            if std::env::var("__GL_THREADED_OPTIMIZATIONS").is_err() {
                std::env::set_var("__GL_THREADED_OPTIMIZATIONS", "0");
            }

            eprintln!("[gameindex] NVIDIA + Wayland detected: applying WebKitGTK rendering workarounds");
        } else {
            eprintln!("[gameindex] WebKitGTK hardware acceleration enabled (nvidia={is_nvidia}, wayland={is_wayland})");
        }

        // Force GDK to prefer Wayland with X11 fallback (safe for every vendor).
        if std::env::var("GDK_BACKEND").is_err() {
            std::env::set_var("GDK_BACKEND", "wayland,x11");
        }
    }

    gameindex_lib::run()
}
