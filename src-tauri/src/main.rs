// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    {
        // Disable NVIDIA explicit sync (fixes torn frames / black rects on NVIDIA+Wayland).
        // This is an NVIDIA-driver-only var — a no-op on AMD/Intel — so it is safe to set
        // unconditionally. `WEBKIT_DISABLE_DMABUF_RENDERER` is not: it costs the DMA-BUF
        // zero-copy path, so it is applied further down for NVIDIA systems.
        if std::env::var("__NV_DISABLE_EXPLICIT_SYNC").is_err() {
            std::env::set_var("__NV_DISABLE_EXPLICIT_SYNC", "1");
        }

        // Prefer native Wayland with an X11 fallback when the launcher has not selected
        // a backend. The AppImage hook is patched during packaging with the same policy.
        if std::env::var("GDK_BACKEND").is_err() {
            std::env::set_var("GDK_BACKEND", "wayland,x11");
        }

        // WebKitGTK's DMA-BUF renderer commonly fails with NVIDIA's GBM path.
        // AppImages retain DMA-BUF acceleration because their display-stack libraries
        // are filtered during packaging instead of disabling acceleration globally.
        let is_appimage = std::env::var_os("APPIMAGE").is_some();
        if !is_appimage
            && std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").is_err()
            && gameindex_lib::gpu_detector::has_nvidia_drm_device()
        {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }

    gameindex_lib::run()
}
