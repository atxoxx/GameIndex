// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    {
        // Disable NVIDIA explicit sync (fixes torn frames / black rects on NVIDIA+Wayland).
        // This is an NVIDIA-driver-only var — a no-op on AMD/Intel — so it is safe to set
        // unconditionally. `WEBKIT_DISABLE_DMABUF_RENDERER` is deliberately NOT set here: it
        // drops the DMA-BUF zero-copy path, and users who hit the NVIDIA black-webview bug
        // on Wayland export it themselves (a user-exported env var always wins).
        if std::env::var("__NV_DISABLE_EXPLICIT_SYNC").is_err() {
            std::env::set_var("__NV_DISABLE_EXPLICIT_SYNC", "1");
        }

        // Force GDK to prefer Wayland with X11 fallback (safe for every vendor).
        // The AppImage's linuxdeploy GTK hook force-sets GDK_BACKEND=x11 before we start,
        // which makes WebKit pick the wrong render device on multi-GPU systems (white
        // webview). Override the hook when a Wayland session is available.
        let appimage_forced_x11 = std::env::var_os("APPIMAGE").is_some()
            && std::env::var_os("WAYLAND_DISPLAY").is_some();
        if std::env::var("GDK_BACKEND").is_err() || appimage_forced_x11 {
            std::env::set_var("GDK_BACKEND", "wayland,x11");
        }
    }

    gameindex_lib::run()
}
