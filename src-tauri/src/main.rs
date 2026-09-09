// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    {
        // The workarounds below fix NVIDIA proprietary-driver bugs on
        // WAYLAND (black/flickering webview, torn frames). They trade a
        // slice of WebKitGTK's accelerated rendering path for stability, so
        // they are only applied on the exact combo that exhibited the bugs:
        // NVIDIA GPU + Wayland session. NVIDIA/X11, AMD and Intel all keep
        // full hardware acceleration.
        //
        // `WEBKIT_DISABLE_DMABUF_RENDERER` (the black-webview fix) and
        // `__NV_DISABLE_EXPLICIT_SYNC` (the torn-frames fix) stay automatic:
        // they drop the DMA-BUF zero-copy path but keep the GL compositor,
        // so navigation stays GPU-accelerated and smooth.
        //
        // `WEBKIT_DISABLE_COMPOSITING_MODE` is deliberately NOT auto-set
        // anymore: it falls back to SINGLE-THREADED SOFTWARE painting, which
        // makes every route change / scroll repaint the whole window on the
        // CPU — the classic "hangs while navigating" symptom. The 2.44-era
        // threaded-compositor deadlock it worked around was fixed upstream
        // (2.44.1+ / 2.46), and disabling DMA-BUF already removes the main
        // trigger for that deadlock path. Users who still hit the deadlock
        // can export `WEBKIT_DISABLE_COMPOSITING_MODE=1` (and
        // `__GL_THREADED_OPTIMIZATIONS=0`) themselves — a user-provided env
        // var always wins. Same for `__GL_THREADED_OPTIMIZATIONS`: only
        // honored when the user exported it.
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

            eprintln!(
                "[gameindex] NVIDIA + Wayland detected: applying WebKitGTK rendering workarounds \
                 (DMA-BUF + explicit-sync disabled; threaded compositing kept for smoothness)"
            );
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
