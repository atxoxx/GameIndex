// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    {
        // glibc keeps one allocation arena per thread (up to 8× the core count
        // by default) and rarely hands freed pages back to the OS. This app's
        // long-lived worker threads — process polling, telemetry, torrent and
        // download loops — allocate on every tick, so RSS creeps up over a
        // long session with no true leak behind it. Capping the arena pool
        // makes freed pages reusable across threads before new ones are
        // created. Must run before any worker thread is spawned.
        unsafe {
            libc::mallopt(libc::M_ARENA_MAX, 2);
        }

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

        // WebKitGTK's accelerated (DMA-BUF) renderer is a well-documented source
        // of sustained WebKitWebProcess memory growth on Mesa/NVIDIA + compositor
        // combinations: while the app is being used the render process climbs into
        // multiple gigabytes, its main thread stalls, and WebKit's watchdog then
        // kills it — which the user sees as "the whole app froze". The AppImage's
        // filtered display-stack libraries make that more likely, not less, so
        // every Linux path defaults to the lighter renderer. Keep it that way on
        // Wayland too: the HUD's transparency is kept painted by the layer-surface
        // commit path in `overlay::commit_layer_surface`, not by the renderer.
        //
        // `GAMEINDEX_WEBKIT_RENDERER` lets a user trade memory back for the
        // zero-copy DMA-BUF path without hand-editing WebKit's variables:
        //   (unset) / dmabuf-off - disable the DMA-BUF renderer (default)
        //   compositing-off      - also disable accelerated compositing (lowest VRAM)
        //   accelerated          - keep WebKit's default accelerated renderer
        // Any WEBKIT_* variable the user exports explicitly always wins.
        let renderer = std::env::var("GAMEINDEX_WEBKIT_RENDERER").unwrap_or_default();
        match renderer.as_str() {
            "accelerated" => {}
            "compositing-off" | "dmabuf-off" => {
                if std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").is_err() {
                    std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
                }
                if renderer == "compositing-off"
                    && std::env::var("WEBKIT_DISABLE_COMPOSITING_MODE").is_err()
                {
                    std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
                }
            }
            _ => {
                if std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").is_err() {
                    std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        // Tune WebView2 / Chromium engine arguments for reduced RAM, VRAM, and background CPU usage:
        // - IntensiveWakeUpThrottling: aggressively throttles background JS timers
        // - ThrottleDisplayNoneAndVisibilityHiddenCrossOriginIframes: stops hidden frame paints
        // - CalculateNativeWinOcclusion: uses Windows DWM occlusion to drop GPU surfaces and throttle when obscured
        // - disable-features=Translate,OptimizationHints,MediaRouter: eliminates unused background service allocations
        // - renderer-process-limit=2: prevents unbounded renderer process proliferation
        // - disk-cache-size / media-cache-size: bounds browser media/disk caching
        // - max-old-space-size=256: triggers V8 garbage collection proactively rather than letting heap float
        if std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").is_err() {
            std::env::set_var(
                "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
                "--enable-features=IntensiveWakeUpThrottling,ThrottleDisplayNoneAndVisibilityHiddenCrossOriginIframes,CalculateNativeWinOcclusion --disable-features=Translate,OptimizationHints,MediaRouter --renderer-process-limit=2 --disk-cache-size=33554432 --media-cache-size=16777216 --js-flags=--max-old-space-size=256",
            );
        }
    }

    gameindex_lib::run()
}
