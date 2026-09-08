// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    {
        // NVIDIA + Wayland + DMA-BUF -> black/flickering webview. Forces CPU-fallback compositing.
        if std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").is_err() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }

        // NVIDIA explicit-sync on Wayland -> torn frames, black rects.
        if std::env::var("__NV_DISABLE_EXPLICIT_SYNC").is_err() {
            std::env::set_var("__NV_DISABLE_EXPLICIT_SYNC", "1");
        }

        // Force GDK to prefer Wayland with X11 fallback.
        if std::env::var("GDK_BACKEND").is_err() {
            std::env::set_var("GDK_BACKEND", "wayland,x11");
        }

        // WebKitGTK 2.44+ threaded GPU compositing can deadlock on Wayland + NVIDIA.
        if std::env::var("WEBKIT_DISABLE_COMPOSITING_MODE").is_err() {
            std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        }

        // Disable NVIDIA GLX threading workaround (conflicts with GTK).
        if std::env::var("__GL_THREADED_OPTIMIZATIONS").is_err() {
            std::env::set_var("__GL_THREADED_OPTIMIZATIONS", "0");
        }
    }

    gameindex_lib::run()
}
